// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council centre mode of the Agent surface (agentcenter.ts "council"): the Discussion, the Summary or Setup, whichever
// councilViewAtom names. Thin: each view reads its own council (or the project's draft) from councilstore.ts. The
// Summary takes the model: Brainstorm this opens an agent through launchAgent.

import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { showCouncil, showCouncilSetup } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { CouncilDiscussion } from "./councildiscussion";
import { CouncilSetup } from "./councilsetup";
import { councilOpenProposalAtom, councilViewAtom } from "./councilstore";
import { CouncilSummary } from "./councilsummary";

// DEV only: lets a CDP scenario open a fixture council, or Setup prefilled, without clicking through the tree, and read
// the one piece of UI state it cannot see in the DOM (openProposal: the proposal open in a council's Discussion, null
// while it is the first in the ranking)
if (import.meta.env.DEV) {
    (window as any).__arcCouncil ??= {
        showCouncil,
        showCouncilSetup,
        openProposal: (id: string) => globalStore.get(councilOpenProposalAtom(id)),
    };
}

export function CouncilPane({ model }: { model: AgentsViewModel }) {
    const view = useAtomValue(councilViewAtom);
    return view === "summary" ? (
        <CouncilSummary model={model} />
    ) : view === "setup" ? (
        <CouncilSetup />
    ) : (
        <CouncilDiscussion />
    );
}
