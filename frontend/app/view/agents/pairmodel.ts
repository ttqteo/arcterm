// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rules of a pair (pkg/agentpair; spec docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md), pure: the
// conversation as the timeline draws it, where the composer sends a message, what is new since the person last looked,
// and the words of the header button. The server parses the agents' blocks and keeps the lists; this file only shapes
// what it sends. The state that outlives a view is pairstore.ts.

import { shortTabId } from "./agentrowmodel";
import type { AgentVM } from "./agentsviewmodel";
import { pauseHead } from "./pairpause";

/** An agent a pair can take on either side: claude or pi (the harnesses whose reply wavesrv reads), a real tab. The one
 *  rule: the header's Add judge, its judge menu and the tree's Pair: worker + judge all ask it. */
export function canPair(agent: Pick<AgentVM, "agent" | "kind" | "blockId">): boolean {
    return (
        (agent.agent === "claude" || agent.agent === "pi") &&
        agent.kind !== "terminal" &&
        agent.kind !== "background" &&
        agent.blockId != null
    );
}

/** Which side a message leans to: the working agent left, a judge right, the person across the width, a system line
 *  ("Paused: …") alone in the middle. */
export type PairRowSide = "left" | "right" | "wide" | "system";

export type PairRole = "worker" | "judge";

export type PairRow = {
    id: string;
    side: PairRowSide;
    ts: number;
    /** the head's name: the working agent's name, "Judge", "You"; "" for a system line */
    who: string;
    /** the judge's short id, on a right-side message, only while the pair has more than one judge */
    judge: string | null;
    /** the person's message: whom it went to (both, worker, judge, judge <short id>); "" on every other row */
    toLabel: string;
    text: string;
    /** the line this message answers, shown at its top */
    quote: string | null;
    /** the message the quote scrolls to; null with no quote or when that message is not in the conversation */
    quoteId: string | null;
    /** the heavy commands the hold refused in this message (the dashed lines); `runts` is set once Run now let one through */
    held: PairHeld[];
    /** the snapshot a pause message carries (why the pair paused, the judge's summary, the Decided list then): such a system
     *  row draws as a pause card. null on every other row, a "Paused: …" line from before the snapshot included. */
    pause: PairPause | null;
};

const SIDE: Record<string, PairRowSide> = { worker: "left", judge: "right", person: "wide", system: "system" };

function toLabel(to: string): string {
    switch (to) {
        case "":
        case "both":
            return "both";
        case "worker":
        case "judge":
            return to;
        default:
            // a judge's tab
            return `judge ${shortTabId(to)}`;
    }
}

/** The name a side goes by now: the roster's (the agent's title, as the tree and header show it), else the one the pair
 *  stored when it joined, which an older pair holds as the tab's launch name (often the project's). */
export function liveName(side: PairSide, roster: readonly Pick<AgentVM, "id" | "name">[]): string {
    return roster.find((a) => a.id === side.tab)?.name || side.name;
}

/** One row per message, in the order the pair holds them (time order). `workerName` is the working agent's name as it
 *  shows now (liveName). */
export function timelineRows(view: PairView, workerName: string = view.worker.name): PairRow[] {
    const messages = view.messages ?? [];
    const ids = new Set(messages.map((m) => m.id));
    const several = (view.judges ?? []).length > 1;
    return messages.map((m) => {
        const side = SIDE[m.from] ?? "system";
        const quoted = (m.quote ?? "") !== "";
        return {
            id: m.id,
            side,
            ts: m.ts,
            who:
                m.from === "worker"
                    ? workerName
                    : m.from === "judge"
                      ? "Judge"
                      : m.from === "person"
                        ? "You"
                        : "",
            judge: side === "right" && several ? shortTabId(m.tab) : null,
            toLabel: m.from === "person" ? toLabel(m.to) : "",
            text: m.text,
            quote: quoted ? m.quote : null,
            quoteId: quoted && ids.has(m.replyto) ? m.replyto : null,
            held: m.held ?? [],
            pause: side === "system" ? (m.pause ?? null) : null,
        };
    });
}

/** Where the composer sends `text`: an `@worker`, `@judge` or `@<judge short id>` at its start names the one it is for
 *  (a judge by its tab, which is what PairSay wants) and leaves the rest as the message; anything else goes to both. */
export function composerTarget(text: string, view: PairView): { to: string; text: string } {
    const trimmed = text.trim();
    const at = /^@(\S+)(?:\s+|$)/.exec(trimmed);
    if (at != null) {
        const name = at[1].toLowerCase();
        const rest = trimmed.slice(at[0].length);
        if (name === "worker" || name === "judge") {
            return { to: name, text: rest };
        }
        const judge = (view.judges ?? []).find((j) => shortTabId(j.tab).toLowerCase() === name);
        if (judge != null) {
            return { to: judge.tab, text: rest };
        }
    }
    return { to: "both", text: trimmed };
}

/** What the composer holds once Judge again's draft (`@judge `) is taken: the draft alone in an empty box; otherwise what the
 *  person had already written, kept, behind the draft, with the @ target it started with (if any) turned into the draft's,
 *  so a click never throws away a half-written message. A box that already starts with the draft is left as it is. */
export function withDraft(current: string, draft: string): string {
    if (current.trim() === "") {
        return draft;
    }
    if (current.startsWith(draft)) {
        return current;
    }
    return draft + current.replace(/^\s*@\S+\s*/, "");
}

/** How many messages the person has not seen: those past the first `seen`, not counting their own. */
export function newCount(view: PairView, seen: number): number {
    return (view.messages ?? []).slice(seen).filter((m) => m.from !== "person").length;
}

/** The header button's words: the working agent's own button names its judge and the new messages ("Paired with judge
 *  4c6ba858 · 2 new"; "Paired with 2 judges" when there are several); a judge's names the working agent it judges. */
export function pairButtonLabel(view: PairView, role: PairRole, seen: number): string {
    if (role === "judge") {
        return `Judging ${shortTabId(view.worker.tab)}`;
    }
    const judges = view.judges ?? [];
    const who = judges.length === 1 ? `judge ${shortTabId(judges[0].tab)}` : `${judges.length} judges`;
    const fresh = newCount(view, seen);
    return `Paired with ${who}${fresh > 0 ? ` · ${fresh} new` : ""}`;
}

/** The working agent's state line reads "waiting on judge" while this holds: a judge owes an answer to its newest message and
 *  the pair is relaying. A stopped pair's judge works on nothing until it resumes (pausedStateText says so instead), and an
 *  ended pair owes nothing. */
export function waitingOnJudge(info: PairInfo): boolean {
    return info.owed && info.state === "relaying";
}

/** The working agent's idle state line while its pair is stopped: the pause card's head words (pauseHead), in English as the
 *  header's state words are everywhere, and with no cap, since a PairInfo carries none ("Paused: judge token cap reached":
 *  the cap counts the judges' tokens). null on a pair that is not stopped. */
export function pausedStateText(info: PairInfo): string | null {
    return info.state === "stopped" ? pauseHead(info.stopreason, false) : null;
}

/** What localStorage held for the seen counts (parsed): each pair's count where it is a whole number, anything else dropped. */
export function parseSeen(value: unknown): Record<string, number> {
    const seen: Record<string, number> = {};
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        return seen;
    }
    for (const [pairId, count] of Object.entries(value)) {
        if (Number.isInteger(count) && (count as number) >= 0) {
            seen[pairId] = count as number;
        }
    }
    return seen;
}

/** The pair a tab is in, as the working agent or as a judge, among the active pairs; null when it is in none. An agent is
 *  in at most one active pair, on either side (PairStart refuses a second). */
export function pairOf(pairs: readonly PairInfo[], tabId: string | null): { pair: PairInfo; role: PairRole } | null {
    if (tabId == null || tabId === "") {
        return null;
    }
    for (const pair of pairs) {
        if (pair.state === "ended") {
            continue;
        }
        if (pair.worker.tab === tabId) {
            return { pair, role: "worker" };
        }
        if ((pair.judges ?? []).some((j) => j.tab === tabId)) {
            return { pair, role: "judge" };
        }
    }
    return null;
}

/** The resting judges of `workerTab` that are hidden: on the roster and asleep, in the list's order (the server lists the
 *  newest first). A resting judge that something woke is a plain row the person can see, and one off the roster has no tab
 *  left, so neither is here. The one rule behind Add judge's "Wake" entry (restingJudgeOf) and the close of a worker, which
 *  closes these with it (closetab.ts). */
export function hiddenJudgesOf(
    workerTab: string,
    resting: readonly PairResting[],
    roster: readonly Pick<AgentVM, "id" | "sleeping">[]
): PairResting[] {
    return resting.filter((r) => r.workertab === workerTab && roster.some((a) => a.id === r.tab && a.sleeping != null));
}
