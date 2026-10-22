// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent surface's centre column shows, in one module-level atom (like railstore.ts) so the mode survives
// the surface being hidden (it stays mounted) and any opener can set it without holding the model.
//   terminal  the focused agent's live TUI, or an ended worker's transcript: the centre as it was
//   session   one ended session's transcript with a Resume button; which session is the model's sessionsSelAtom
//             ("<runtime>:<id>"), the atom History's list and detail already use
//   run       one orchestrator run's detail (its members, and the one in view read): sessionsSelAtom's "run:<id>",
//             and the member sessionsMemberAtom, as History's run detail reads them
//   history   Conversation History: the old Sessions surface's master-detail, embedded
//   canvases  Canvas gallery: the gallery of every project's design canvases, and its viewer (canvasgallerystore.ts)
//   council   one council's Discussion or report (Summary), or a project's council Setup (councilpane.tsx); which council, which
//             of the three views and which project's draft are councilstore.ts's councilSelAtom, councilViewAtom and
//             councilSetupProjectAtom
//   project   one project's Overview (projectoverview.tsx): what in it waits on you and runs; which project is overviewProjectAtom
// The terminal stack stays mounted, hidden, in the others, so a live xterm is never torn down and re-fitted.
// "session" is already overloaded in this codebase (workspace tab sessions, the Brief region), so the sessions*Atoms
// on the model keep their names rather than churn a rename.

import { globalStore } from "@/app/store/jotaiStore";
import { landOn } from "@/app/view/jarvis/returnsurface";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";
import { emptyCouncilDraft, type CouncilSetupDraft, type CouncilView } from "./councilmodel";
import {
    councilAtom,
    councilListAtom,
    councilSelAtom,
    councilSetupDraftAtom,
    councilSetupProjectAtom,
    councilViewAtom,
} from "./councilstore";
import { defaultCouncilView } from "./councilsummarymodel";
import { runIdOfSel } from "./sessionsruns";

export type CenterMode = "terminal" | "session" | "run" | "history" | "canvases" | "council" | "project";

export const centerModeAtom = atom<CenterMode>("terminal") as PrimitiveAtom<CenterMode>;

// the project whose Overview the `project` mode shows: a registry name, as the tree's folders name it
export const overviewProjectAtom = atom("") as PrimitiveAtom<string>;

type CenterOpener = Pick<AgentsViewModel, "surfaceAtom" | "sessionsSelAtom" | "sessionsMemberAtom">;

/** Pure: where a value written to sessionsSelAtom is read. A run ("run:<id>") has its own pane, the merged feed ("all")
 *  a detail only History draws; any other value is one session, which the session pane reads. */
export function centerForSelection(sel: string): Exclude<CenterMode, "terminal"> {
    return sel === "all" ? "history" : runIdOfSel(sel) != null ? "run" : "session";
}

/** Back to the focused agent's terminal. Every route that chooses an agent calls this, so choosing one never
 *  leaves a transcript over it. */
export function showTerminal(): void {
    globalStore.set(centerModeAtom, "terminal");
}

/** Open Conversation History in the Agent surface. */
export function showHistory(model: Pick<AgentsViewModel, "surfaceAtom">): void {
    globalStore.set(centerModeAtom, "history");
    landOn(model.surfaceAtom, "agent");
}

/** Open the Canvas gallery in the Agent surface. */
export function showCanvases(model: Pick<AgentsViewModel, "surfaceAtom">): void {
    globalStore.set(centerModeAtom, "canvases");
    landOn(model.surfaceAtom, "agent");
}

/** Open a project's Overview in the Agent surface. From the tree nothing more is needed; from another surface pass the
 *  model, which lands on Agent. */
export function showProjectOverview(project: string, model?: Pick<AgentsViewModel, "surfaceAtom">): void {
    globalStore.set(overviewProjectAtom, project);
    globalStore.set(centerModeAtom, "project");
    if (model != null) {
        landOn(model.surfaceAtom, "agent");
    }
}

/** Open one council in the Agent surface, on `view` when given, else on its report when it has ended with a summary and
 *  on its Discussion otherwise (defaultCouncilView, read from the council's atom, else from the list of every council;
 *  a council not loaded yet opens on its Discussion). From the Agent surface itself (a tree row) nothing more is needed;
 *  from any other (the palette) pass the model, which lands on Agent. */
export function showCouncil(
    id: string,
    view?: Exclude<CouncilView, "setup">,
    model?: Pick<AgentsViewModel, "surfaceAtom">
): void {
    const known =
        globalStore.get(councilAtom(id)) ?? globalStore.get(councilListAtom(""))?.find((c) => c.id === id) ?? null;
    globalStore.set(councilSelAtom, id);
    globalStore.set(councilViewAtom, view ?? defaultCouncilView(known));
    globalStore.set(centerModeAtom, "council");
    if (model != null) {
        landOn(model.surfaceAtom, "agent");
    }
}

/** Open a project's council Setup in the Agent surface. With `prefill` the project's draft starts again from it (over an
 *  empty one: Run again, Ask the council); with none the draft the person left stays, or a blank one starts. */
export function showCouncilSetup(
    project: string,
    prefill?: Partial<CouncilSetupDraft>,
    model?: Pick<AgentsViewModel, "surfaceAtom">
): void {
    const draft = councilSetupDraftAtom(project);
    if (prefill != null || globalStore.get(draft) == null) {
        globalStore.set(draft, { ...emptyCouncilDraft(project), ...prefill });
    }
    globalStore.set(councilSetupProjectAtom, project);
    globalStore.set(councilViewAtom, "setup");
    globalStore.set(centerModeAtom, "council");
    if (model != null) {
        landOn(model.surfaceAtom, "agent");
    }
}

/** Open one session in the Agent surface: its own transcript, or its run's detail. `member` is the run member in
 *  view, as sessionSelection (sessionsruns.ts) names it for a run's session. */
export function showSession(model: CenterOpener, sel: string, member?: string): void {
    globalStore.set(model.sessionsSelAtom, sel);
    if (member != null) {
        globalStore.set(model.sessionsMemberAtom, member);
    }
    globalStore.set(centerModeAtom, centerForSelection(sel));
    landOn(model.surfaceAtom, "agent");
}
