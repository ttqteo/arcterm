// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the run card (chatruncard.tsx) says, pure: the body of a run that has started, the header's tag, and where a queued
// start stands with the entry's own name and kind. The conversation-level rules (which run a call started, where a card
// sits, the `[arc] Run` message) are chatruncards.ts.

import type { RunCardView } from "./chatbrainstorm";
import type { CardState } from "./chatbrainstormparts";
import { queuedView, type QueuedView } from "./chatruncards";
import type { QueuedRow } from "./runqueuemodel";
import type { StageTone } from "./runstage";

/** What the card's body says: the run is still being read, Arc cannot find it, or its name and one stage line. The queued
 *  stage is the card's own (`runStage` has none), so `line.key` is a plain string and `queued` marks the Queued line. */
export type RunBody =
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "shown"; name: string; line: { key: string; label: string; tone: StageTone } | null; queued?: boolean };

/** The body of a run that has started: loading until the store has read it, "cannot find" when it is loaded but unknown
 *  to Arc (deleted), else its name and stage. */
export function runBody(view: RunCardView, loaded: boolean): RunBody {
    if (!loaded) {
        return { kind: "loading" };
    }
    return view.stage == null ? { kind: "missing" } : { kind: "shown", name: view.name, line: view.stage };
}

/** What the header's tag says. A live run is the engine's work, not the person's turn, so the tag says Working and turns
 *  amber (Waiting on you) only when the run itself needs the person; an exited agent is static whatever the run does. */
export function runTag(live: boolean, needsYou: boolean): CardState {
    return !live ? "static" : needsYou ? "waiting" : "working";
}

/** What a queued start looks like now: where it stands, and the entry's own name and kind for the card that draws while the
 *  entry is in the queue. */
export type QueuedState = { view: QueuedView; name: string; head: "Orchestrator run" | "Quick run" };

/** Reads one queued start from the queue: `queue` and `started` as the run queue store holds them, `rows` the tree's rows
 *  (`queuedRows`), which resolve the title of the run an entry waits after. An After that has landed leaves only room to
 *  wait for, as the tree's row reads it, so the card says "Queued", not "Queued · after <run>". */
export function queuedState(
    entryId: string,
    queue: readonly RunQueueEntry[],
    started: Readonly<Record<string, string>>,
    rows: readonly QueuedRow[]
): QueuedState {
    const row = rows.find((r) => r.entry.id === entryId);
    const afterTitle = (id: string) => (row?.entry.after === id ? row.afterTitle : undefined);
    const view = queuedView(entryId, queue, started, afterTitle);
    const entry = queue.find((e) => e.id === entryId);
    return {
        view: view.state === "waiting" && row?.afterMet ? { state: "waiting" } : view,
        name: entry?.title ?? "",
        head: entry?.data.mode === "quick" ? "Quick run" : "Orchestrator run",
    };
}
