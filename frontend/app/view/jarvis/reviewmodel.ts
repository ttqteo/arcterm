// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reviewing initiatives: which ones changed since the person last looked, and which sat idle, in the order they are
// worth a look. Review is not urgent, so none of this reaches the attention queue or Sprout's badge. Pure: no React,
// no Wave runtime imports.

import { formatAge, type AgentVM } from "@/app/view/agents/agentsviewmodel";
import { shortDate } from "./initiativework";

export const DAY = 86_400_000;

// how long an active initiative with nobody on it sits still before it is idle (no setting, spec 2026-10-14 §4)
export const IDLE_MS = 14 * DAY;

export type ReviewCard = {
    oref: string;
    status: string;
    updatedts: number;
    blockedChunks: string[];
    // some chunk holds a workref: somebody is on it
    working: boolean;
    // a plan to review, an ask or a gate waits on the person for this initiative
    asking: boolean;
};

// Active, nobody on it, and neither changed nor reviewed for 14 days. Never reviewed counts as old, so Mark reviewed
// is what takes it out of the queue, until 14 more still days pass.
export function isIdle(
    card: Pick<ReviewCard, "status" | "updatedts" | "working">,
    reviewedAt: number | undefined,
    now: number
): boolean {
    return (
        card.status === "active" &&
        !card.working &&
        now - card.updatedts >= IDLE_MS &&
        (reviewedAt == null || now - reviewedAt >= IDLE_MS)
    );
}

// An update after the mark; an initiative never reviewed reads from the "Since you looked" cursor instead.
export function isChanged(
    card: Pick<ReviewCard, "updatedts">,
    reviewedAt: number | undefined,
    fallback: number
): boolean {
    return card.updatedts > (reviewedAt ?? fallback);
}

export type ReviewReason = "blocked" | "asks you" | "at work" | "changed" | "idle";

// where the next minute goes: what is stuck, what asks you, what an agent is on, what changed, then what sat still
const REASON_RANK: Record<ReviewReason, number> = { blocked: 0, "asks you": 1, "at work": 2, changed: 3, idle: 4 };

export type ReviewItem<T extends ReviewCard = ReviewCard> = { oref: string; card: T; reason: ReviewReason };

// The changed and idle initiatives, in review order; the cards' own order breaks a tie.
export function reviewQueue<T extends ReviewCard>(
    cards: T[],
    reviewed: Record<string, number>,
    fallback: number,
    now: number
): ReviewItem<T>[] {
    const items: ReviewItem<T>[] = [];
    for (const card of cards) {
        const mark = reviewed[card.oref];
        const changed = isChanged(card, mark, fallback);
        if (!changed && !isIdle(card, mark, now)) {
            continue;
        }
        const reason: ReviewReason =
            card.blockedChunks.length > 0
                ? "blocked"
                : card.asking
                  ? "asks you"
                  : card.working
                    ? "at work"
                    : changed
                      ? "changed"
                      : "idle";
        items.push({ oref: card.oref, card, reason });
    }
    return items
        .map((item, at) => ({ item, at }))
        .sort((a, b) => REASON_RANK[a.item.reason] - REASON_RANK[b.item.reason] || a.at - b.at)
        .map((x) => x.item);
}

// "3 initiatives changed · 1 idle": what Sprout's popup says. A blocked, asking or at-work one changed.
export function reviewSummary(queue: ReviewItem[]): { changed: number; idle: number } {
    const idle = queue.filter((q) => q.reason === "idle").length;
    return { changed: queue.length - idle, idle };
}

export function reviewSummaryLine(s: { changed: number; idle: number }): string {
    const plural = (n: number) => `${n} initiative${n === 1 ? "" : "s"}`;
    if (s.changed > 0 && s.idle > 0) {
        return `${plural(s.changed)} changed · ${s.idle} idle`;
    }
    if (s.changed > 0) {
        return `${plural(s.changed)} changed`;
    }
    return s.idle > 0 ? `${plural(s.idle)} idle` : "";
}

// The initiatives an agent or a run is on: a workref on any chunk of the summary.
export function workingOrefs(summaries: Pick<EffortSummary, "oref" | "chunks">[]): Set<string> {
    return new Set(
        summaries.filter((e) => (e.chunks ?? []).some((c) => (c.workrefs ?? []).length > 0)).map((e) => e.oref)
    );
}

// The initiatives something waits on the person for: an attention item that names one (a plan to review, an ask, a
// gate), or an agent open on one that is asking.
export function askingOrefs(
    attention: Pick<AttentionItem, "effortoid">[],
    agents: Pick<AgentVM, "state" | "effortId">[]
): Set<string> {
    const out = new Set<string>();
    for (const a of attention) {
        if (a.effortoid) {
            out.add("effort:" + a.effortoid);
        }
    }
    for (const a of agents) {
        if (a.state === "asking" && a.effortId) {
            out.add("effort:" + a.effortId);
        }
    }
    return out;
}

type ReviewEvent = Pick<EffortEvent, "ts" | "kind" | "label" | "text">;

// What happened to an initiative after the mark, newest first. A batch sharing one stamp reads newest-written first.
export function eventsSince<T extends ReviewEvent>(events: T[] | undefined, mark: number): T[] {
    return [...(events ?? [])]
        .filter((e) => e.ts > mark)
        .reverse()
        .sort((a, b) => b.ts - a.ts);
}

type ReviewChunk = { label: string; notes?: { ts: number; text: string }[] };

// A chunk-status event does not say which status: the note the change wrote beside it ("marked blocked · why") does.
function markedStatus(ev: ReviewEvent, chunks: ReviewChunk[] | undefined): string | undefined {
    const note = chunks
        ?.find((c) => c.label === ev.label)
        ?.notes?.find((n) => n.ts === ev.ts && /^marked \w+/.test(n.text));
    return note != null ? /^marked (\w+)/.exec(note.text)?.[1] : undefined;
}

// One line of the "Since you reviewed" block. `chunks` (the detail's) lets a status change name the status.
export function eventLine(ev: ReviewEvent, chunks?: ReviewChunk[]): string {
    const label = ev.label ?? "";
    switch (ev.kind) {
        case "chunk-done":
            return `✓ ${label} · done`;
        case "chunk-added":
            return `+ ${label} · added`;
        case "chunk-status":
            return `${label} · ${markedStatus(ev, chunks) ?? "status changed"}`;
        case "effort-status":
            return `now ${ev.text ?? ""}`.trim();
        case "effort-note":
            return `note: ${ev.text ?? ""}`;
        case "effort-created":
            return "+ initiative created";
        default:
            return label !== "" ? `${label} · ${ev.kind}` : ev.kind;
    }
}

// "idle 3w": how long it has been still, in weeks (it is only called for one the queue calls idle: 14 days or more)
export function idleLabel(updatedts: number, now: number): string {
    return `idle ${Math.floor((now - updatedts) / (7 * DAY))}w`;
}

// --- one review pass --------------------------------------------------------------------------------------
// A pass keeps the initiatives the queue held when it began, in order: the ones marked since stay listed, faded,
// so "Reviewing 2 of 4" holds still while the queue itself shrinks.

export function reviewedInSession(reviewed: Record<string, number>, oref: string, startedAt: number): boolean {
    return (reviewed[oref] ?? -1) >= startedAt;
}

export function reviewDone(orefs: string[], reviewed: Record<string, number>, startedAt: number): boolean {
    return orefs.every((o) => reviewedInSession(reviewed, o, startedAt));
}

// the neighbour in a direction, wrapping; a cursor that is not in the pass lands on its first
export function sessionStep(orefs: string[], cursor: string, delta: number): string {
    if (orefs.length === 0) {
        return "";
    }
    const at = orefs.indexOf(cursor);
    if (at < 0) {
        return orefs[0];
    }
    return orefs[(at + delta + orefs.length) % orefs.length];
}

// the next one after `from` not yet marked in this pass, wrapping; null when every one is
export function sessionNext(
    orefs: string[],
    reviewed: Record<string, number>,
    startedAt: number,
    from: string
): string | null {
    const start = orefs.indexOf(from);
    for (let i = 1; i <= orefs.length; i++) {
        const oref = orefs[(start + i + orefs.length) % orefs.length];
        if (!reviewedInSession(reviewed, oref, startedAt)) {
            return oref;
        }
    }
    return null;
}

// --- what the views read ----------------------------------------------------------------------------------

// The trackers with what a queue needs that a card does not carry: whether somebody is on one (a workref in the
// summaries) and whether something waits on the person for it (attention, agents).
export function reviewCards<T extends Omit<ReviewCard, "working" | "asking">>(
    trackers: T[],
    summaries: Pick<EffortSummary, "oref" | "chunks">[],
    attention: Pick<AttentionItem, "effortoid">[],
    agents: Pick<AgentVM, "state" | "effortId">[]
): (T & { working: boolean; asking: boolean })[] {
    const working = workingOrefs(summaries);
    const asking = askingOrefs(attention, agents);
    return trackers.map((t) => ({ ...t, working: working.has(t.oref), asking: asking.has(t.oref) }));
}

// the head of the "Since you reviewed" block: when the mark was, or the cursor an unreviewed one reads from
export function sinceHeading(mark: number | undefined): string {
    return mark != null ? `last reviewed ${shortDate(mark)}` : "since you last looked";
}

// what an idle initiative's block says in place of events: nothing moved
export function quietLine(updatedts: number, now: number): string {
    const weeks = Math.floor((now - updatedts) / (7 * DAY));
    return `nothing moved in ${weeks} week${weeks === 1 ? "" : "s"} and no agent is on it`;
}

// "2h ago": how long before now an event was
export function eventAge(ts: number, now: number): string {
    const age = formatAge(now - ts);
    return age === "just now" ? age : `${age} ago`;
}

export type EventTone = "ok" | "accent" | "muted";

export function eventTone(kind: string): EventTone {
    return kind === "chunk-done" ? "ok" : kind === "chunk-added" ? "accent" : "muted";
}

// A line of the block, split into the glyph that heads it and the words after it ("✓ x · done" -> ✓, "x · done");
// a line with no glyph gets a quiet dot, so the lines keep one column.
export function eventParts(line: string): { glyph: string; text: string } {
    const m = /^([✓+]) (.*)$/.exec(line);
    return m != null ? { glyph: m[1], text: m[2] } : { glyph: "·", text: line };
}
