// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the chat box's `@` picker lists beside its files (refmention.ts): the live agents, and the project's runs and
// councils, read again each time an `@` comes into the text, since a run or a council started meanwhile is the likeliest
// one to name.

import { useAtomValue } from "jotai";
import { useEffect, useMemo } from "react";
import { councilListAtom, loadCouncils } from "./councilstore";
import { liveAgentsAtom } from "./liveagents";
import { loadProjectRuns, projectRunsAtom } from "./projecthistorystore";
import { agentRefs, councilRefs, runRefs, type RefItem } from "./refmention";

/** The items the picker can list for a chat: `selfId` is the chat's own tab, left out; `project` the project folder
 *  ("" for a chat outside a project, which lists agents only); `want` is true while the text holds an `@`. */
export function useRefItems(project: string, selfId: string, want: boolean): RefItem[] {
    const agents = useAtomValue(liveAgentsAtom);
    const runs = useAtomValue(projectRunsAtom(project)).runs;
    const councils = useAtomValue(councilListAtom(project));
    useEffect(() => {
        if (!want || project === "") {
            return;
        }
        void loadProjectRuns(project);
        void loadCouncils(project);
    }, [want, project]);
    return useMemo(
        () => [
            ...agentRefs(agents, selfId),
            ...(project === "" ? [] : runRefs(runs)),
            ...(project === "" ? [] : councilRefs(councils)),
        ],
        [agents, selfId, project, runs, councils]
    );
}
