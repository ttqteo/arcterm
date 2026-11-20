// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's Council tab (canvas rail-council-chat, board B): the chat of the council the focused agent started,
// narrowed to the panel. Which council that is, the tab's dot and title, the head over the chat, the messages it lists
// and the row that says whose move it is. Pure: no React, no Wave runtime.

import { councilChannel, type ChannelItem } from "./councilchatmodel";
import { draftsWaitWord, headerChip, heldDrafts, panel, shownState, treeMeta, type CouncilTone } from "./councilmodel";

/** The council the agent started most recently, or null for none. A council records the session that started it in
 *  `sessionid` (wsh council start inside an agent's terminal: its transcript's session id), so `sessions` are the ids
 *  the agent goes by; an empty one matches nothing. One refused at the start (not-run) has no discussion to show, so it
 *  is passed over. */
export function agentCouncil(
    councils: readonly Council[] | null | undefined,
    sessions: readonly (string | null | undefined)[]
): Council | null {
    const ids = new Set(sessions.filter((s): s is string => s != null && s !== ""));
    let best: Council | null = null;
    for (const c of councils ?? []) {
        const mine = c.sessionid != null && ids.has(c.sessionid);
        if (mine && c.state !== "not-run" && (best == null || c.created > best.created)) {
            best = c;
        }
    }
    return best;
}

export type RailCouncilDot = Exclude<CouncilTone, "muted">;

export interface RailCouncilTab {
    /** The dot on the tab's icon, in the tone the council's row in the tree takes; null when it is calm (done, stopped). */
    dot: RailCouncilDot | null;
    /** The tooltip: what the council is about and where it stands, and its key. */
    title: string;
}

const featureOf = (c: Council) => c.feature.trim() || "Council";

export function railCouncilTab(c: Council): RailCouncilTab {
    const tone = treeMeta(c).tone;
    return { dot: tone === "muted" ? null : tone, title: `${featureOf(c)} · ${headerChip(c)} (c)` };
}

/** The head over the chat: what the council is about, and a line with where it stands and how many seats it has. */
export interface RailCouncilHead {
    title: string;
    dot: RailCouncilDot | null;
    line: string; // `Round 2 of 2 · 3 seats`
}

export function railCouncilHead(c: Council): RailCouncilHead {
    const n = panel(c).length;
    return {
        title: featureOf(c),
        dot: railCouncilTab(c).dot,
        line: `${headerChip(c)} · ${n} ${n === 1 ? "seat" : "seats"}`,
    };
}

/** The council's messages as the tab lists them: the Discussion's channel with every reply in it, a reply on an idea
 *  naming its idea, since the panel has no thread to open. */
export function railCouncilFeed(c: Council): ChannelItem[] {
    return councilChannel(c, undefined, true);
}

/** How many messages the tab draws at first, and adds on each Show earlier. */
export const RAIL_FEED_STEP = 40;

/** The last `n` items; the newest stay at the end, as a chat reads. */
export function feedWindow<T>(items: readonly T[], n: number): T[] {
    return n <= 0 ? [] : items.slice(Math.max(0, items.length - n));
}

/** The row under the messages when the council waits on the person or is over: `drafts`, held drafts to send on;
 *  `pause`, the pause after the first round, whose choices (what to cut, a steer) are the Discussion's; `done`, the
 *  report is written; `failed`. Null while it runs with nothing held, or once stopped without a report. `drafts` holds
 *  the held drafts' ids, which Send to the others sends. */
export type RailCouncilMove =
    | { kind: "drafts"; text: string; drafts: string[] }
    | { kind: "pause"; text: string }
    | { kind: "done"; text: string }
    | { kind: "failed"; text: string };

export function railCouncilMove(c: Council): RailCouncilMove | null {
    const held = heldDrafts(c);
    const state = shownState(c);
    if (held.length > 0 && (state === "running" || state === "awaiting-you" || state === "done")) {
        return { kind: "drafts", text: draftsWaitWord(held.length), drafts: held.map((d) => d.id) };
    }
    switch (state) {
        case "awaiting-you":
            return { kind: "pause", text: "Paused: the council waits on you" };
        case "done":
            return { kind: "done", text: "Done · the report is written" };
        case "failed":
            return { kind: "failed", text: "The council failed" };
        default:
            return null;
    }
}
