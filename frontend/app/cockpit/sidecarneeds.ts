// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What waits on you in Sidecar (spec 2026-11-17-sidecar-orbit-dashboard-design.md, "What waits on you"): the asks the
// snapshot carries, a finished agent whose last message ends in a question (a heuristic: never a 1-9 answer), and what
// Jarvis holds for you (attentionAtom's jarvis half). One list, oldest first. Pure.

import { IDLE_GRACE_MS, type AgentEntry } from "@/app/view/agents/agentsviewmodel";
import { kindWord } from "@/app/view/jarvis/briefingmodel";
import type { PetAct } from "@/app/view/jarvis/petacts";
import type { PeekRow } from "@/app/view/jarvis/petpeekmodel";
import type { SidecarNeed, SidecarNeedAct, SidecarTile } from "./sidecartypes";

const FENCE = /```[\s\S]*?```/g;
// closing marks a question may carry after its "?": markdown emphasis, code, quotes, brackets
const TRAILING = /[\s*_`"'”’)\]»]+$/;

/** The last sentence of `text` when it ends in a question mark (ASCII or full-width), else null. */
export function endsInQuestion(text: string): string | null {
    const t = text.replace(FENCE, "").replace(TRAILING, "");
    if (!t.endsWith("?") && !t.endsWith("？")) {
        return null;
    }
    const body = t.slice(0, -1);
    // a sentence ends at a stop, bang or question mark followed by a space (a dot inside `file.json` or 1.9.0 does not),
    // at a full-width mark or ideographic stop, or at a newline
    let cut = 0;
    for (const m of body.matchAll(/[.!?](?=\s)|[？。]|\n/g)) {
        cut = m.index + 1;
    }
    const sentence = t.slice(cut).trim();
    return sentence === "" ? null : sentence;
}

/** The question an agent's last message ends on, unless the person has written to it since. */
export function lastQuestion(entries: readonly AgentEntry[]): string | null {
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "user") {
            return null;
        }
        if (e.kind === "message") {
            return endsInQuestion(e.text);
        }
    }
    return null;
}

export interface NeedsInput {
    tiles: readonly SidecarTile[]; // the whole roster's tiles (the base snapshot), not the orbit's 8
    entriesById: Readonly<Record<string, AgentEntry[]>>; // per agent: entriesToShow(live, previousInfo) (decision 4)
    jarvis: readonly AttentionItem[];
    now: number; // UnixMilli: the `since` of a tile that has none
}

// Only a task that failed is a failure. An unverified run finished: one thing in it was not checked, which waits on a
// look and an Accept, not on a repair, so it no longer frames the window red (2026-11-19).
function isFailedItem(i: AttentionItem): boolean {
    return i.kind === "dag-blocked" && i.retry === true;
}

// What kind of thing waits, in words a glance reads, by AttentionItem.kind (pkg/jarvis/attention.go)
const KIND_LABEL: Record<string, string> = {
    "dag-gate": "Gate to approve",
    escalation: "Asks you",
    "dag-blocked": "Blocked",
    "chunk-due": "Due",
    "plan-review": "Plan to review",
    "run-unverified": "Run to check",
    "run-land-held": "Land held",
    "run-queue-blocked": "Run not started",
    "learn-proposal": "Rule to approve",
    council: "Council report",
    "bug-reports": "Báo lỗi",
    "session-ideas": "Ideas",
};

/** A Jarvis item's label: its kind in words, "Task failed" for a blocked task a retry can rerun. */
export function needLabel(kind: string, retry = false): string {
    if (kind === "dag-blocked" && retry) {
        return "Task failed";
    }
    return KIND_LABEL[kind] ?? "Waiting";
}

/**
 * A Jarvis row's buttons, from the tray peek's row for the same item (petpeekmodel.queueRows): the act that settles it
 * (Accept, Approve, Retry, Land again, Work on, Start now), the options of a question one key answers, then the rest
 * (Dismiss, the Open escort). A learned rule has none there: its Accept and Dismiss are the Needs you strip's
 * (LearnDecideCommand), named `<key>:learn-accept` and `<key>:learn-dismiss`.
 */
export function needActsOf(row: PeekRow | undefined, item: AttentionItem | undefined): SidecarNeedAct[] {
    if (item?.kind === "learn-proposal" && item.learnid) {
        return [
            { id: `${item.key}:learn-accept`, label: "Accept", strong: true },
            { id: `${item.key}:learn-dismiss`, label: "Dismiss" },
        ];
    }
    if (row == null) {
        return [];
    }
    const out: SidecarNeedAct[] = [];
    const seen = new Set<string>();
    const add = (act: PetAct | null, label = act?.label) => {
        if (act == null || label == null || seen.has(act.id)) {
            return;
        }
        seen.add(act.id);
        // an Open (to the Brief too) is a way to read the row, not the act that settles it; neither is Next week on the
        // ideas' line, which puts the row off
        const quiet = act.verb === "open" || act.verb === "open-brief" || act.verb === "snooze-ideas";
        out.push({ id: act.id, label, ...(quiet ? {} : { strong: true }) });
    };
    add(row.primary);
    row.answers.forEach((a, i) => add(a, `${i + 1} ${a.label}`));
    row.links.forEach((a) => add(a));
    return out;
}

/** The id of a learned rule's Accept or Dismiss, and which it is; null for any other act. */
export function learnActOf(actId: string): { key: string; accept: boolean } | null {
    const m = /^(.*):learn-(accept|dismiss)$/.exec(actId);
    return m == null ? null : { key: m[1], accept: m[2] === "accept" };
}

export function sidecarNeeds(input: NeedsInput): SidecarNeed[] {
    const asks: SidecarNeed[] = [];
    const questions: SidecarNeed[] = [];
    for (const t of input.tiles) {
        if (t.state === "asking" && t.ask != null) {
            const n: SidecarNeed = {
                key: `ask:${t.id}`,
                kind: "ask",
                id: t.id,
                who: t.name,
                label: "Asks you",
                since: t.since ?? input.now,
                text: t.ask.question,
                options: t.ask.options,
                answerable: t.ask.answerable,
            };
            if (t.ask.key != null) {
                n.askKey = t.ask.key;
            }
            if (t.sent) {
                n.sent = true;
            }
            asks.push(n);
        } else if (
            t.state === "review" ||
            (t.state === "idle" && input.now - (t.since ?? input.now) <= IDLE_GRACE_MS)
        ) {
            const q = lastQuestion(input.entriesById[t.id] ?? []);
            if (q != null) {
                questions.push({
                    key: `q:${t.id}`,
                    kind: "question",
                    id: t.id,
                    who: t.name,
                    label: "Question",
                    since: t.since ?? input.now,
                    text: q,
                });
            }
        }
    }
    // AttentionItem.waitingsince is UnixMilli (pkg/jarvis/attention.go: WaitingSince is a message Ts or d.UnixMilli()),
    // the same clock as a tile's `since`, so the two sources sort together.
    const jarvis: SidecarNeed[] = input.jarvis
        .filter((i) => i.kind !== "ask")
        .map((i) => {
            const n: SidecarNeed = {
                key: i.key,
                kind: "jarvis",
                who: i.channelname || i.source,
                since: i.waitingsince,
                text: i.text,
                word: kindWord(i.kind, i.retry),
                label: needLabel(i.kind, i.retry === true),
            };
            // a chunk's waitingsince is its due day: its age is how late it is
            if (i.kind === "chunk-due") {
                n.late = true;
            }
            if (isFailedItem(i)) {
                n.failed = true;
            }
            return n;
        });
    // a stable sort: equal ages keep asks, then questions, then Jarvis
    return [...asks, ...questions, ...jarvis].sort((a, b) => a.since - b.since);
}
