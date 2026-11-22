// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent surface's centre column shows, in one module-level atom (like railstore.ts) so the mode survives
// the surface being hidden (it stays mounted) and any opener can set it without holding the model.
//   terminal  the focused agent's live TUI, or an ended worker's transcript: the centre as it was
//   council   one council's Discussion, report (Summary) or Map, or a project's council Setup (councilpane.tsx); which council,
//             which of the four views and which project's draft are councilstore.ts's councilSelAtom, councilViewAtom and
//             councilSetupProjectAtom
//   project   one project's Overview (projectoverview.tsx): what in it waits on you and runs; which project is overviewProjectAtom
//   held      one agent arcterm held while the machine was busy (heldpane.tsx): its task, Start now, Add to initiative;
//             which one is heldSelAtom, a parked launch's id (parkedstore.ts)
//   board     one board alone, over the whole centre (boards/boardsplit.tsx BoardCell): a click on its tree row. Which
//             board is boardAloneAtom; it still reads its own chat, and is dragged into a split from its bar
// The terminal stack stays mounted, hidden, in the others, so a live xterm is never torn down and re-fitted.
// Conversation History, the Canvas gallery, the Councils list and an ended session's or run's transcript are not centre
// modes: they are the Library surface (view/library/librarystore.ts), and a council that is still in the tree opens here.

import { globalStore } from "@/app/store/jotaiStore";
import { landOn } from "@/app/view/jarvis/returnsurface";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";
import {
    draftWithAgents,
    emptyCouncilDraft,
    type CouncilSetupDraft,
    type CouncilView,
    type SeatableAgent,
} from "./councilmodel";
import {
    councilAtom,
    councilLastViewAtom,
    councilListAtom,
    councilOnlyAtom,
    councilSelAtom,
    councilSetupDraftAtom,
    councilSetupProjectAtom,
    councilViewAtom,
} from "./councilstore";
import { reopenView } from "./councilsummarymodel";

export type CenterMode = "terminal" | "council" | "project" | "held" | "board";

export const centerModeAtom = atom<CenterMode>("terminal") as PrimitiveAtom<CenterMode>;

// the project whose Overview the `project` mode shows: a registry name, as the tree's folders name it
export const overviewProjectAtom = atom("") as PrimitiveAtom<string>;

// the held agent the `held` mode shows, by its parked launch's id
export const heldSelAtom = atom("") as PrimitiveAtom<string>;

// the board the `board` mode shows alone
export const boardAloneAtom = atom<{ project: string; boardId: string } | null>(null) as PrimitiveAtom<{
    project: string;
    boardId: string;
} | null>;

/** Show one board alone over the Agent surface's centre: a peer of an agent shown alone, the split kept aside as it is.
 *  From another surface pass the model, which lands on Agent. */
export function showBoardAlone(
    board: { project: string; boardId: string },
    model?: Pick<AgentsViewModel, "surfaceAtom">
): void {
    globalStore.set(boardAloneAtom, { project: board.project, boardId: board.boardId });
    globalStore.set(centerModeAtom, "board");
    if (model != null) {
        landOn(model.surfaceAtom, "agent");
    }
}

/** Back from the centre to the focused agent's terminal. */
export function leaveCenter(): void {
    globalStore.set(centerModeAtom, "terminal");
}

/** Back to the focused agent's terminal. Every route that chooses an agent calls this, so choosing one never
 *  leaves a transcript over it. */
export function showTerminal(): void {
    globalStore.set(centerModeAtom, "terminal");
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

/** Open one council in the Agent surface, on `view` when given (its Discussion, its report, or its Map), else on the view
 *  the person left it on, unless a summary was written since (reopenView); a council not shown before opens on its report
 *  when it has ended with a summary and on its Discussion otherwise (defaultCouncilView, read from the council's atom, else
 *  from the list of every council; a council not loaded yet opens on its Discussion). From the Agent surface itself (a tree
 *  row) nothing more is needed; from any other (the palette) pass the model, which lands on Agent. `only`, an expert's id,
 *  has the Discussion show that seat's messages alone (the Summary's column); every call without it shows everyone again. */
export function showCouncil(
    id: string,
    view?: Exclude<CouncilView, "setup">,
    model?: Pick<AgentsViewModel, "surfaceAtom">,
    only?: string
): void {
    const known =
        globalStore.get(councilAtom(id)) ?? globalStore.get(councilListAtom(""))?.find((c) => c.id === id) ?? null;
    globalStore.set(councilSelAtom, id);
    // the Discussion shows one seat's messages only when the way in asked for it
    globalStore.set(councilOnlyAtom(id), only ?? null);
    // with no view named, the one the person left it on (reopenView), and each view shown is kept for next time
    const shown = view ?? reopenView(known, globalStore.get(councilLastViewAtom(id)));
    globalStore.set(councilViewAtom, shown);
    globalStore.set(councilLastViewAtom(id), { view: shown, summaryAt: known?.summary?.at ?? 0 });
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

/** Discuss together: open council Setup with `agents` seated (two or more live agents the tree has selected), in the first
 *  one's project, over a fresh draft: the panel is empty for Setup to fill and the person writes the question there. */
export function showCouncilSetupWithAgents(
    agents: readonly SeatableAgent[],
    model?: Pick<AgentsViewModel, "surfaceAtom">
): void {
    const draft = draftWithAgents(agents);
    showCouncilSetup(draft.project, draft, model);
}
