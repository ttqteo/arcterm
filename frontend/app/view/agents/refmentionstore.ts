// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the chat box's `@` picker lists beside its files (refmention.ts): the live agents, the project's runs and
// councils, the conversations of the archive's loaded pages, and the initiatives. Runs, councils and initiatives are read
// again each time an `@` comes into the text, since one started meanwhile is the likeliest one to name; the archive is
// read when nothing has loaded it yet. The initiatives are also what an `effort:` badge resolves against (refEffortsAtom).

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { councilListAtom, loadCouncils } from "./councilstore";
import { devRosterAtom } from "./devmock";
import { loadProjectRuns, projectRunsAtom } from "./projecthistorystore";
import { agentRefs, councilRefs, effortRefs, runRefs, sessionRefs, type RefItem } from "./refmention";
import { loadSessionsArchive, sessionsArchiveAtom } from "./sessionsarchivestore";

/** The initiatives an `effort:` reference can name, from any project and archived ones too (a token can name a finished
 *  one). null until the first list lands; a failed read leaves the last good list. */
export const refEffortsAtom = atom<EffortSummary[] | null>(null) as PrimitiveAtom<EffortSummary[] | null>;

let effortsLoading = false;

/** Reads the initiatives into refEffortsAtom; calls made while a read is on its way make no second request. */
export async function loadRefEfforts(): Promise<void> {
    if (effortsLoading) {
        return;
    }
    effortsLoading = true;
    try {
        const rtn = await RpcApi.EffortListCommand(TabRpcClient, { includearchived: true });
        globalStore.set(refEffortsAtom, rtn?.efforts ?? []);
    } catch (e) {
        console.warn("chat refs: initiatives read failed", e);
    } finally {
        effortsLoading = false;
    }
}

// loadSessionsArchive asked again while a scan runs scans once more: one asker at a time, so an `@` typed again before the
// first scan lands does not queue a second scan
let loadingSessions = false;

function loadSessionsOnce(): void {
    if (loadingSessions) {
        return;
    }
    loadingSessions = true;
    void loadSessionsArchive().finally(() => {
        loadingSessions = false;
    });
}

/** The items the picker can list for a chat: `selfId` is the chat's own tab, left out; `project` the project folder
 *  ("" for a chat outside a project, which lists agents, conversations and initiatives only); `projectName` the
 *  project's registered name, which an initiative's `project` holds, and `projectPath` its registered path, which a
 *  conversation's `projectpath` is compared with (the scan's `projectname` is the last segment of the cwd, not the
 *  registered name); `want` is true while the text holds an `@`. */
export function useRefItems(
    project: string,
    projectName: string,
    projectPath: string,
    selfId: string,
    want: boolean
): RefItem[] {
    // the roster the cockpit shows: a dev fixture's when one is loaded, else the live one
    const agents = useAtomValue(devRosterAtom);
    const runs = useAtomValue(projectRunsAtom(project)).runs;
    const councils = useAtomValue(councilListAtom(project));
    const sessions = useAtomValue(sessionsArchiveAtom);
    const efforts = useAtomValue(refEffortsAtom);
    const sessionsUnread = sessions == null;
    useEffect(() => {
        if (!want || project === "") {
            return;
        }
        void loadProjectRuns(project);
        void loadCouncils(project);
    }, [want, project]);
    // the initiatives are read each time an `@` comes in (one started meanwhile is the likeliest to name), for a chat
    // outside a project too: the list belongs to no project
    useEffect(() => {
        if (want) {
            void loadRefEfforts();
        }
    }, [want]);
    // the archive keeps its own list fresh elsewhere (the Agent tree, History); the picker reads it only when nothing has
    useEffect(() => {
        if (want && sessionsUnread) {
            loadSessionsOnce();
        }
    }, [want, sessionsUnread]);
    return useMemo(
        () => [
            ...agentRefs(agents, selfId),
            ...(project === "" ? [] : runRefs(runs)),
            ...(project === "" ? [] : councilRefs(councils)),
            ...sessionRefs(sessions, projectPath, Date.now()),
            ...effortRefs(efforts, projectName),
        ],
        [agents, selfId, project, runs, councils, sessions, projectPath, efforts, projectName]
    );
}
