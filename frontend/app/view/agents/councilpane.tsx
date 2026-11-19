// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A council's pane: the Discussion, the Summary, the Map or Setup, whichever the host's view atom names (councilhost.ts: the
// Agent centre's councilViewAtom for the `council` mode of the Agent surface, Library's own for its Councils tab; Setup is
// Agent only). Thin: each view reads its own council (or the project's draft) from councilstore.ts and the host around it.
// The Summary takes the model: Start an agent on it opens an agent through launchAgent. Leaving a council (another one
// shown, Setup, or the pane gone) marks it opened in the last-opened map (councilopened.ts).

import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { showCouncil, showCouncilSetup } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { CouncilDiscussion } from "./councildiscussion";
import { useCouncilHost } from "./councilhost";
import { CouncilMap } from "./councilmap";
import { councilOpenedAtom, markCouncilOpened, saveOpenedMap, type CouncilOpenedMap } from "./councilopened";
import { CouncilSetup } from "./councilsetup";
import { councilMapOpenAtom, councilOpenProposalAtom, councilTimelineAtom } from "./councilstore";
import { CouncilSummary } from "./councilsummary";

// DEV only: lets a CDP scenario open a fixture council, or Setup prefilled, without clicking through the tree, and read
// the pieces of UI state it cannot see in the DOM (openProposal: the idea whose thread is open in a council's chat,
// null while none is; timeline: the seat whose timeline the Seats popover is asked to show, set by an expert card on the
// Map, null while none is; mapOpen: the idea whose row is open in the Map's matrix, null while none is; opened /
// setOpened: the last-opened map, read, or replaced and persisted)
if (import.meta.env.DEV) {
    const hook = ((window as any).__arcCouncil ??= {});
    Object.assign(hook, {
        showCouncil,
        showCouncilSetup,
        openProposal: (id: string) => globalStore.get(councilOpenProposalAtom(id)),
        timeline: (id: string) => globalStore.get(councilTimelineAtom(id)),
        mapOpen: (id: string) => globalStore.get(councilMapOpenAtom(id)),
        councilOpenedAtom,
        opened: () => globalStore.get(councilOpenedAtom),
        setOpened: (map: CouncilOpenedMap) => saveOpenedMap(map),
    });
}

export function CouncilPane({ model }: { model: AgentsViewModel }) {
    const host = useCouncilHost();
    const view = useAtomValue(host.viewAtom);
    const sel = useAtomValue(host.selAtom);
    // the council on screen, none while Setup shows; the one left behind is marked opened as it goes
    const shown = view === "setup" ? null : sel;
    useEffect(() => {
        if (shown == null) {
            return;
        }
        return () => markCouncilOpened(shown);
    }, [shown]);
    return view === "summary" ? (
        <CouncilSummary model={model} />
    ) : view === "setup" ? (
        <CouncilSetup model={model} />
    ) : view === "map" ? (
        <CouncilMap model={model} />
    ) : (
        <CouncilDiscussion model={model} />
    );
}
