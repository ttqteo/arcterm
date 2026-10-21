// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council centre mode of the Agent surface (agentcenter.ts "council"): the Discussion, the Summary or Setup, whichever
// councilViewAtom names. Thin: each view reads its own council (or the project's draft) from councilstore.ts.

import { useAtomValue } from "jotai";
import { showCouncil, showCouncilSetup } from "./agentcenter";
import { CouncilDiscussion } from "./councildiscussion";
import { CouncilSetup } from "./councilsetup";
import { councilViewAtom } from "./councilstore";
import { CouncilSummary } from "./councilsummary";

// DEV only: lets a CDP scenario open a fixture council, or Setup prefilled, without clicking through the tree
if (import.meta.env.DEV) {
    (window as any).__arcCouncil ??= { showCouncil, showCouncilSetup };
}

export function CouncilPane() {
    const view = useAtomValue(councilViewAtom);
    return view === "summary" ? <CouncilSummary /> : view === "setup" ? <CouncilSetup /> : <CouncilDiscussion />;
}
