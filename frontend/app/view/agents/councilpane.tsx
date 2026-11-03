// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council centre mode of the Agent surface (agentcenter.ts "council"): the Discussion, the Summary or Setup, whichever
// councilViewAtom names. Thin: each view reads its own council (or the project's draft) from councilstore.ts. The
// Summary takes the model: Start an agent on it opens an agent through launchAgent. Leaving a council (another one shown,
// Setup, or the pane gone) marks it opened in the last-opened map (councilopened.ts).

import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { showCouncil, showCouncilSetup } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { CouncilDiscussion } from "./councildiscussion";
import { councilOpenedAtom, markCouncilOpened, saveOpenedMap, type CouncilOpenedMap } from "./councilopened";
import { CouncilSetup } from "./councilsetup";
import { councilOpenProposalAtom, councilSelAtom, councilViewAtom } from "./councilstore";
import { CouncilSummary } from "./councilsummary";

// DEV only: lets a CDP scenario open a fixture council, or Setup prefilled, without clicking through the tree, and read
// the pieces of UI state it cannot see in the DOM (openProposal: the idea whose thread is open in a council's chat,
// null while none is; opened / setOpened: the last-opened map, read, or replaced and persisted)
if (import.meta.env.DEV) {
    const hook = ((window as any).__arcCouncil ??= {});
    Object.assign(hook, {
        showCouncil,
        showCouncilSetup,
        openProposal: (id: string) => globalStore.get(councilOpenProposalAtom(id)),
        councilOpenedAtom,
        opened: () => globalStore.get(councilOpenedAtom),
        setOpened: (map: CouncilOpenedMap) => saveOpenedMap(map),
    });
}

export function CouncilPane({ model }: { model: AgentsViewModel }) {
    const view = useAtomValue(councilViewAtom);
    const sel = useAtomValue(councilSelAtom);
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
    ) : (
        <CouncilDiscussion model={model} />
    );
}
