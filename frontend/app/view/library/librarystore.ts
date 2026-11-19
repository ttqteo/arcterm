// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Library's state and the routes into it. Library is the surface that holds what is over: Conversation History, the Canvas
// gallery and the councils that left the Agent tree. Its state lives in module-level atoms (like railstore.ts), not in the
// surface component, so the tab and the open council survive a switch to another surface (Library unmounts like every
// surface but Agent) and any opener can set them without holding the model.
//   tab          conversations | canvases | councils: which of the three shows
//   conv view    list | session | run, on Conversations: `list` is Conversation History's master-detail (a row read in place);
//                `session` and `run` are one session's or one run's pane at full width, shown when a session is opened from
//                outside Library (showLibrarySession), whose Back leaves it (leaveLibraryDetail)
//   council      which council is open on Councils (null = the list), which of its views shows and whose messages alone the
//                Discussion lists: the same three the Agent centre keeps in councilstore.ts, on Library's own atoms, read by
//                the council views through LIBRARY_COUNCIL_HOST (agents/councilhost.ts)
// This module imports Agent's centre (agentcenter.ts) for showCouncil alone: a council still in the Agent tree opens there.

import { globalStore } from "@/app/store/jotaiStore";
import { backToOrigin, landOn } from "@/app/view/jarvis/returnsurface";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { showCouncil } from "../agents/agentcenter";
import type { AgentsViewModel } from "../agents/agents";
import { councilInTree } from "../agents/agentsidebarmodel";
import type { CouncilHost } from "../agents/councilhost";
import type { CouncilView } from "../agents/councilmodel";
import { councilOpenedAtom } from "../agents/councilopened";
import { councilAtom, councilLastViewAtom, councilListAtom } from "../agents/councilstore";
import { reopenView } from "../agents/councilsummarymodel";
import { runIdOfSel } from "../agents/sessionsruns";

export type LibraryTab = "conversations" | "canvases" | "councils";

/** The tabs, in the order Library draws them (and `1` `2` `3` switch them). */
export const LIBRARY_TABS: readonly LibraryTab[] = ["conversations", "canvases", "councils"];

/** Which tab shows. */
export const libraryTabAtom = atom<LibraryTab>("conversations") as PrimitiveAtom<LibraryTab>;

export type LibraryConvView = "list" | "session" | "run";

/** What Conversations shows: its list with a detail pane, or one session or one run at full width. Which session or run is
 *  the model's sessionsSelAtom, as Conversation History's list and detail already use it. */
export const libraryConvViewAtom = atom<LibraryConvView>("list") as PrimitiveAtom<LibraryConvView>;

/** The council open on Councils, or null while the list of councils shows. */
export const libraryCouncilSelAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

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

/** Back from a session or run opened in Library: the Conversations list again, and the surface the jump came from when
 *  there was one (backToOrigin); with none, the person stays on Library. */
export function leaveLibraryDetail(): void {
    globalStore.set(libraryConvViewAtom, "list");
    backToOrigin();
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
    globalStore.set(libraryTabAtom, "councils");
}

/** Open council `id` in Library's Councils tab from any surface (setLibraryCouncil, then Library). */
export function showLibraryCouncil(
    model: Pick<AgentsViewModel, "surfaceAtom">,
    id: string,
    view?: Exclude<CouncilView, "setup">,
    only?: string
): void {
    setLibraryCouncil(id, view, only);
    landOn(model.surfaceAtom, "library");
}

/** Back from a council opened in Library: the list of councils again, and the surface the jump came from when there was
 *  one (backToOrigin); with none, the person stays on Library. */
export function leaveLibraryCouncil(): void {
    globalStore.set(libraryCouncilSelAtom, null);
    backToOrigin();
}

/** The one route that opens a council from outside its views (Jarvis, a notification, the palette, `wsh ui`, Library's own
 *  Councils list). One the Agent tree still lists (councilInTree: it runs, waits, is pinned, ended a day ago or less, or is
 *  unread), and one not loaded yet, which is new and so live, open in Agent's centre column through showCouncil; any other
 *  opens in Library's Councils tab. Resume does not pass through here: it lands on Agent whatever the council's age. */
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
