// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Library's state and the routes into it. Library is the surface that holds what is over: Conversation History (its sessions,
// runs, councils and judge pairs), the Canvas gallery and the boards agents drew. Its state lives in module-level atoms (like
// railstore.ts), not in the surface component, so the tab and the open council survive a switch to another surface (Library
// unmounts like every surface but Agent) and any opener can set them without holding the model.
//   tab          conversations | canvases | boards: which of the three shows
//   board        which board is open on Boards (null = none picked yet), by project and id
//   conv view    list | session | run | council | pair, on Conversations: `list` is Conversation History's master-detail (a row
//                read in place); the other four are one session's, run's, council's or pair's view at full width, shown when
//                one is opened from outside Library (showLibrarySession, showLibraryCouncil, showLibraryPair), whose Back
//                leaves it (leaveLibraryDetail)
//   council      which council is open in the `council` view, which of its views shows and whose messages alone the
//                Discussion lists: the same three the Agent centre keeps in councilstore.ts, on Library's own atoms, read by
//                the council views through LIBRARY_COUNCIL_HOST (agents/councilhost.ts)
//   pair         which pair is open in the `pair` view (openPair routes a pair here or to Agent's centre)
//   kinds        the Judge and Council chips over Conversations' list (the list itself is conversationhistory.tsx's)
// This module imports Agent's centre (agentcenter.ts) for showCouncil and showPair alone: a council or a pair still live in
// the Agent tree opens there.

import { globalStore } from "@/app/store/jotaiStore";
import { backToOrigin, landOn } from "@/app/view/jarvis/returnsurface";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { showCouncil, showPair } from "../agents/agentcenter";
import type { AgentsViewModel } from "../agents/agents";
import { councilInTree } from "../agents/agentsidebarmodel";
import type { CouncilHost } from "../agents/councilhost";
import type { CouncilView } from "../agents/councilmodel";
import { councilOpenedAtom } from "../agents/councilopened";
import { councilAtom, councilLastViewAtom, councilListAtom } from "../agents/councilstore";
import { reopenView } from "../agents/councilsummarymodel";
import { pairListAtom } from "../agents/pairstore";
import { runIdOfSel } from "../agents/sessionsruns";

export type LibraryTab = "conversations" | "canvases" | "boards";

/** The tabs, in the order Library draws them (and `1` `2` `3` switch them). */
export const LIBRARY_TABS: readonly LibraryTab[] = ["conversations", "canvases", "boards"];

/** Which tab shows. */
export const libraryTabAtom = atom<LibraryTab>("conversations") as PrimitiveAtom<LibraryTab>;

export type LibraryConvView = "list" | "session" | "run" | "council" | "pair";

/** What Conversations shows: its list with a detail pane, or one session, run, council or pair at full width. Which session or
 *  run is the model's sessionsSelAtom, as Conversation History's list and detail already use it; the council and the pair
 *  have their own atoms below. */
export const libraryConvViewAtom = atom<LibraryConvView>("list") as PrimitiveAtom<LibraryConvView>;

/** The filter chips over Conversations' list. With one on the list shows only pairs (Judge) or councils (Council), flat, newest
 *  first, and with both on both kinds; both off is the nested list of sessions. */
export const libraryConvKindsAtom = atom({ judge: false, council: false }) as PrimitiveAtom<{
    judge: boolean;
    council: boolean;
}>;

export interface LibraryBoardSel {
    project: string;
    boardId: string;
}

/** The board open on Boards (its canvas and turns beside the list), or null before one is picked. */
export const libraryBoardSelAtom = atom<LibraryBoardSel | null>(null) as PrimitiveAtom<LibraryBoardSel | null>;

/** The council open in Conversations' full-width `council` view, or null while none is. */
export const libraryCouncilSelAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

/** The pair open in Conversations' full-width `pair` view, or null while none is. */
export const libraryPairSelAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

/** Which view of the open council shows. Never `setup`: council Setup stays on the Agent surface. */
export const libraryCouncilViewAtom = atom<CouncilView>("discussion") as PrimitiveAtom<CouncilView>;

/** The seat whose messages alone a council's Discussion shows, per council; null shows everyone. As councilOnlyAtom, for
 *  Library's host. */
export const libraryCouncilOnlyAtom = atomFamily(
    (_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>
);

/** Open Library, on `tab` when given, else on the tab it was left on. From another surface it remembers where the person
 *  came from, so Back and Escape return there (landOn). */
export function showLibrary(model: Pick<AgentsViewModel, "surfaceAtom">, tab?: LibraryTab): void {
    if (tab != null) {
        globalStore.set(libraryTabAtom, tab);
    }
    landOn(model.surfaceAtom, "library");
}

/** Open Conversation History: Library's Conversations tab on its list, even when a session or run was left open full width
 *  there (showLibrary would show that one again). The list's selection is kept. */
export function showConversationHistory(model: Pick<AgentsViewModel, "surfaceAtom">): void {
    globalStore.set(libraryConvViewAtom, "list");
    showLibrary(model, "conversations");
}

/** Open one session in Library's Conversations tab, full width: its own transcript, or its run's detail. `member` is the run
 *  member in view, as sessionSelection (sessionsruns.ts) names it for a run's session; without one the member in view is left
 *  alone. A run ("run:<id>") has its own pane, the merged feed ("all") is the list; any other value is one session. */
export function showLibrarySession(
    model: Pick<AgentsViewModel, "surfaceAtom" | "sessionsSelAtom" | "sessionsMemberAtom">,
    sel: string,
    member?: string
): void {
    globalStore.set(model.sessionsSelAtom, sel);
    if (member != null) {
        globalStore.set(model.sessionsMemberAtom, member);
    }
    globalStore.set(libraryTabAtom, "conversations");
    globalStore.set(libraryConvViewAtom, sel === "all" ? "list" : runIdOfSel(sel) != null ? "run" : "session");
    landOn(model.surfaceAtom, "library");
}

/** Open one board in Library's Boards tab, from any surface: the list with the board's canvas and turns beside it. The route
 *  for a board whose agent ended; a live agent's board opens beside its Chat instead (openref.ts, `board` target). */
export function showLibraryBoard(model: Pick<AgentsViewModel, "surfaceAtom">, project: string, boardId: string): void {
    globalStore.set(libraryBoardSelAtom, { project, boardId });
    globalStore.set(libraryTabAtom, "boards");
    landOn(model.surfaceAtom, "library");
}

/** Back from a session, run, council or pair opened in Library: the Conversations list again, and the surface the jump came
 *  from when there was one (backToOrigin); with none, the person stays on Library. */
export function leaveLibraryDetail(): void {
    globalStore.set(libraryConvViewAtom, "list");
    globalStore.set(libraryCouncilSelAtom, null);
    globalStore.set(libraryPairSelAtom, null);
    backToOrigin();
}

/** Open Conversations' list with the Council chip alone on, from any surface (`g o`, `surface:councils`). Lands on the list
 *  even when a session, run, council or pair was left open full width. */
export function showLibraryCouncils(model: Pick<AgentsViewModel, "surfaceAtom">): void {
    globalStore.set(libraryConvKindsAtom, { judge: false, council: true });
    globalStore.set(libraryConvViewAtom, "list");
    showLibrary(model, "conversations");
}

/** Open one pair in Conversations' full-width `pair` view, from any surface. The route for a pair that is not live (ended or
 *  synced); openPair picks between this and Agent's centre. */
export function showLibraryPair(model: Pick<AgentsViewModel, "surfaceAtom">, id: string): void {
    globalStore.set(libraryPairSelAtom, id);
    globalStore.set(libraryTabAtom, "conversations");
    globalStore.set(libraryConvViewAtom, "pair");
    landOn(model.surfaceAtom, "library");
}

/** The one route that opens a pair from outside a pair's views (Jarvis, `wsh ui`, the Overview's History, a list row). A pair
 *  in the live list (pairListAtom) opens on Agent's centre, where it is driven (showPair); any other, an ended or synced one,
 *  opens read-only in Library's full-width pair view. */
export function openPair(model: Pick<AgentsViewModel, "surfaceAtom">, id: string): void {
    if (globalStore.get(pairListAtom).some((p) => p.id === id)) {
        showPair(id, model);
        return;
    }
    showLibraryPair(model, id);
}

// the council `id` as loaded by id, else as the list of every council has it, else null
function knownCouncil(id: string): Council | null {
    return globalStore.get(councilAtom(id)) ?? globalStore.get(councilListAtom(""))?.find((c) => c.id === id) ?? null;
}

/** Open council `id` in Library's atoms, on `view` when given, else on the view the person left it on unless a summary was
 *  written since (reopenView), else on its report when it has ended with one and its Discussion otherwise: showCouncil's choice,
 *  and councilLastViewAtom, which keeps what the person last read of a council wherever they read it. `only`, an expert's id,
 *  has the Discussion show that seat's messages alone; every call without it shows everyone again. Changes no surface: for the
 *  views already on screen (LIBRARY_COUNCIL_HOST.open). */
export function setLibraryCouncil(id: string, view?: Exclude<CouncilView, "setup">, only?: string): void {
    const known = knownCouncil(id);
    globalStore.set(libraryCouncilSelAtom, id);
    globalStore.set(libraryCouncilOnlyAtom(id), only ?? null);
    const shown = view ?? reopenView(known, globalStore.get(councilLastViewAtom(id)));
    globalStore.set(libraryCouncilViewAtom, shown);
    globalStore.set(councilLastViewAtom(id), { view: shown, summaryAt: known?.summary?.at ?? 0 });
    globalStore.set(libraryTabAtom, "conversations");
    globalStore.set(libraryConvViewAtom, "council");
}

/** Open council `id` in Conversations' full-width council view from any surface (setLibraryCouncil, then Library). Its Back is
 *  leaveLibraryDetail. */
export function showLibraryCouncil(
    model: Pick<AgentsViewModel, "surfaceAtom">,
    id: string,
    view?: Exclude<CouncilView, "setup">,
    only?: string
): void {
    setLibraryCouncil(id, view, only);
    landOn(model.surfaceAtom, "library");
}

/** The one route that opens a council from outside its views (Jarvis, a notification, the palette, `wsh ui`, Conversations'
 *  own council rows). One the Agent tree still lists (councilInTree: it runs, waits, is pinned, ended a day ago or less, or is
 *  unread), and one not loaded yet, which is new and so live, open in Agent's centre column through showCouncil; any other
 *  opens in Conversations' full-width council view. Resume does not pass through here: it lands on Agent whatever the
 *  council's age. */
export function openCouncil(
    model: Pick<AgentsViewModel, "surfaceAtom">,
    id: string,
    view?: Exclude<CouncilView, "setup">,
    only?: string
): void {
    const known = knownCouncil(id);
    if (known == null || councilInTree(known, globalStore.get(councilOpenedAtom), Date.now())) {
        showCouncil(id, view, model, only);
        return;
    }
    showLibraryCouncil(model, id, view, only);
}

/** Library's council host: its own selection, view and seat filter, and `open` sets them with no surface change. */
export const LIBRARY_COUNCIL_HOST: CouncilHost = {
    kind: "library",
    selAtom: libraryCouncilSelAtom,
    viewAtom: libraryCouncilViewAtom,
    onlyAtom: libraryCouncilOnlyAtom,
    open: setLibraryCouncil,
};
