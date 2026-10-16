// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's detail sheet draws the active subject, so this is the routing table that decides which
// subjects it owns. It replaces stagecompose.ts, which answered the same question for the Stage's panes —
// and it stays exhaustive on purpose: with the Stage gone, "none" is a claim that another Brief surface
// renders that kind, so a kind that fell through by accident would vanish rather than fail to compile.
//
// `run` is the resolved run for a channel subject (stageRunAtom). A channel with no run is not an empty
// sheet: it is the launcher, which is the only place a run can be started from in the Brief.

import type { ActiveSubject } from "./jarvissubjectstore";

export type SheetFace =
    | { kind: "none" }
    | { kind: "channel"; channelId: string; body: "run" | "launcher" }
    | { kind: "effort"; effortId: string }
    | { kind: "queued"; entryId: string };

export function sheetFace(
    subject: ActiveSubject | null,
    run: Run | null,
    queuedEntryId: string | null = null
): SheetFace {
    // a queue entry is no subject (briefqueuestore.ts); opening one clears the subject, and opening a subject clears it
    if (queuedEntryId != null) {
        return { kind: "queued", entryId: queuedEntryId };
    }
    if (subject == null) {
        return { kind: "none" };
    }
    if (subject.kind === "channel") {
        // Composing a new run needs no case of its own: stageRunAtom already resolves NO run while a channel
        // is composing, so the launcher below is what that state produces. Re-deciding it here from
        // composingRunAtom would be a second copy of one rule, free to disagree with the first.
        return { kind: "channel", channelId: subject.id, body: run != null ? "run" : "launcher" };
    }
    if (subject.kind === "effort") {
        return { kind: "effort", effortId: subject.id };
    }
    // dossier -> the record peek, briefing -> the Brief
    return { kind: "none" };
}
