// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a council is shown from. A council's views (Discussion, Summary, Map, and the tabs and links between them) read which
// council is open, which view shows and whose messages alone the Discussion lists from the host around them, and move to
// another council or view through it, so one set of views serves Agent's centre column and Library's Councils tab.
//   agent    the global councilSelAtom / councilViewAtom / councilOnlyAtom, and `open` = showCouncil: the council takes the
//            centre of the Agent surface (councilstore.ts, agentcenter.ts)
//   library  Library's own atoms, and `open` sets them without changing the surface (librarystore.ts: LIBRARY_COUNCIL_HOST)
// A view outside any provider gets Agent's host, the default of the context. Council Setup stays Agent only, so a host's
// view atom is read as any CouncilView but `open` takes the three a council opens on.

import type { Atom, PrimitiveAtom } from "jotai";
import { createContext, useContext } from "react";
import { showCouncil } from "./agentcenter";
import type { CouncilView } from "./councilmodel";
import { councilOnlyAtom, councilSelAtom, councilViewAtom } from "./councilstore";

export interface CouncilHost {
    kind: "agent" | "library";
    /** The council open in this host, or null (Library's Councils list shows then). */
    selAtom: Atom<string | null>;
    /** Which view of the open council shows. */
    viewAtom: Atom<CouncilView>;
    /** The seat whose messages alone council `id`'s Discussion shows, or null for everyone. */
    onlyAtom: (id: string) => PrimitiveAtom<string | null>;
    /** Open council `id` here, on `view` when given (else the one the person left it on), with `only` a seat's messages
     *  alone. It changes no surface: the host's views are already on screen. */
    open(id: string, view?: Exclude<CouncilView, "setup">, only?: string): void;
}

/** Agent's host: the council the centre column shows. */
export const AGENT_COUNCIL_HOST: CouncilHost = {
    kind: "agent",
    selAtom: councilSelAtom,
    viewAtom: councilViewAtom,
    onlyAtom: councilOnlyAtom,
    open: (id, view, only) => showCouncil(id, view, undefined, only),
};

export const CouncilHostContext = createContext<CouncilHost>(AGENT_COUNCIL_HOST);

/** The host the calling council view sits in. */
export function useCouncilHost(): CouncilHost {
    return useContext(CouncilHostContext);
}
