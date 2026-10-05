// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent surface's centre column shows, in one module-level atom (like railstore.ts) so the mode survives
// the surface being hidden (it stays mounted) and any opener can set it without holding the model.
//   terminal  the focused agent's live TUI, or an ended worker's transcript: the centre as it was
//   session   one ended session's transcript with a Resume button; which session is the model's sessionsSelAtom
//             ("<runtime>:<id>"), the atom History's list and detail already use
//   history   Conversation History: the old Sessions surface's master-detail, embedded
// The terminal stack stays mounted, hidden, in the other two, so a live xterm is never torn down and re-fitted.
// "session" is already overloaded in this codebase (workspace tab sessions, the Brief region), so the sessions*Atoms
// on the model keep their names rather than churn a rename.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";
import { runIdOfSel } from "./sessionsruns";

export type CenterMode = "terminal" | "session" | "history";

export const centerModeAtom = atom<CenterMode>("terminal") as PrimitiveAtom<CenterMode>;

type CenterOpener = Pick<AgentsViewModel, "surfaceAtom" | "sessionsSelAtom" | "sessionsMemberAtom">;

/** Pure: where a value written to sessionsSelAtom is read. A run ("run:<id>") and the merged feed ("all") have a
 *  detail only History draws; any other value is one session, which the session pane reads. */
export function centerForSelection(sel: string): Exclude<CenterMode, "terminal"> {
    return sel === "all" || runIdOfSel(sel) != null ? "history" : "session";
}

/** Back to the focused agent's terminal. Every route that chooses an agent calls this, so choosing one never
 *  leaves a transcript over it. */
export function showTerminal(): void {
    globalStore.set(centerModeAtom, "terminal");
}

/** Open Conversation History in the Agent surface. */
export function showHistory(model: Pick<AgentsViewModel, "surfaceAtom">): void {
    globalStore.set(centerModeAtom, "history");
    globalStore.set(model.surfaceAtom, "agent");
}

/** Open one session in the Agent surface: its own transcript, or its run in History. `member` is the run member in
 *  view, as sessionSelection (sessionsruns.ts) names it for a run's session. */
export function showSession(model: CenterOpener, sel: string, member?: string): void {
    globalStore.set(model.sessionsSelAtom, sel);
    if (member != null) {
        globalStore.set(model.sessionsMemberAtom, member);
    }
    globalStore.set(centerModeAtom, centerForSelection(sel));
    globalStore.set(model.surfaceAtom, "agent");
}
