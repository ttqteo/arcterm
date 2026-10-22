// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The notice a council gives when it ends (councilnotifysync.tsx draws it): what the toast says, whether the person is
// already looking at the council, and the unread set the Agent tree's dot reads. Pure: no atoms, no rpc.

import { answerLine } from "./notifyevents";

const LIVE = new Set(["running", "awaiting-you"]);
const ENDED_TITLE: Record<string, string> = {
    done: "Council done",
    stopped: "Council stopped",
    failed: "Council failed",
};

/** Pure: the toast a council that just ended gets, or null. Only a council that was running or waiting on you and now
 *  is done, stopped or failed says anything, and not one the person is looking at (`viewing`); `prev` undefined is
 *  the first load, which says nothing. The body is the answer, else the first sentence of the summary, else the error
 *  (else the feature, so the toast is never empty). */
export function endedNotice(
    prev: Council | undefined,
    next: Council,
    viewing: boolean
): { title: string; body: string } | null {
    const title = ENDED_TITLE[next.state];
    if (prev == null || title == null || !LIVE.has(prev.state) || viewing) {
        return null;
    }
    const answer = next.summary?.answer?.trim() ?? "";
    const body = answer || answerLine(next.summary?.text ?? "") || (next.error ?? "").trim() || next.feature.trim();
    return { title, body };
}

/** Pure: whether the person is looking at council `id`: the Agent surface shows its Discussion or Summary. */
export function viewingCouncil(
    surface: string,
    center: string,
    view: string,
    selected: string | null,
    id: string
): boolean {
    return surface === "agent" && center === "council" && view !== "setup" && selected === id;
}

/** Pure: the unread set with `id` added; the same set when it is already in. */
export function markUnread(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    return set.has(id) ? set : new Set([...set, id]);
}

/** Pure: the unread set without `id`; the same set when it was not in. */
export function markRead(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    if (!set.has(id)) {
        return set;
    }
    const out = new Set(set);
    out.delete(id);
    return out;
}
