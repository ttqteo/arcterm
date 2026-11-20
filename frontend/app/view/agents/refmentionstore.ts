// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the chat box's `@` picker lists beside its files (refmention.ts): the live agents, the project's runs and
// councils, the conversations of the archive's loaded pages, the initiatives and the project's boards (read from the
// every-project list, which a `board:` badge resolves against too, and kept current by board:update). Runs, councils and initiatives are read
// again each time an `@` comes into the text, since one started meanwhile is the likeliest one to name; the archive is
// read when nothing has loaded it yet. The initiatives are also what an `effort:` badge resolves against (refEffortsAtom).

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { boardSplitAtom } from "../boards/boardsplitstore";
import { boardListAtom, loadBoardList } from "../boards/boardstore";
import { buildAgentTree } from "./agenttreemodel";
import { councilListAtom, loadCouncils } from "./councilstore";
import { devRosterAtom } from "./devmock";
import { loadProjectRuns, projectRunsAtom } from "./projecthistorystore";
import {
    agentRefs,
    boardRefs,
    councilRefs,
    effortRefs,
    runRefs,
    sessionRefs,
    topLevelAgentIds,
    type RefItem,
} from "./refmention";
import { lineageAtomFor } from "./runlineagestore";
import { loadSessionsArchive, sessionsArchiveAtom } from "./sessionsarchivestore";

// which of the roster's agents work a run's task or judge for it, so the picker lists only the Agent tree's top-level rows
const refLineageAtom = lineageAtomFor(devRosterAtom);

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

// loadSessionsArchive asked again while a scan runs scans once more: one asker at a time, so neither an `@` typed again
// before the first scan lands, nor ten conversation badges, nor a badge and the picker together queue a second scan
let loadingSessions = false;

/** Reads the conversation archive for a ref badge or the picker; calls made while a scan is on its way start no second one. */
export function loadRefSessions(): void {
    if (loadingSessions) {
        return;
    }
    loadingSessions = true;
    void loadSessionsArchive().finally(() => {
        loadingSessions = false;
    });
}

let boardsLoading = false;

/** Reads every project's boards into boardListAtom(""), which board:update keeps current from then on; calls made while
 *  a read is on its way make no second request. */
export function loadRefBoards(): void {
    if (boardsLoading) {
        return;
    }
    boardsLoading = true;
    loadBoardList("")
        .catch((e) => console.warn("chat refs: boards read failed", e))
        .finally(() => {
            boardsLoading = false;
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
    const lineage = useAtomValue(refLineageAtom);
    const runs = useAtomValue(projectRunsAtom(project)).runs;
    const councils = useAtomValue(councilListAtom(project));
    const sessions = useAtomValue(sessionsArchiveAtom);
    const efforts = useAtomValue(refEffortsAtom);
    const boards = useAtomValue(boardListAtom(""));
    // the board open beside this Chat, which the picker lists first
    const openBoardId = useAtomValue(boardSplitAtom(selfId))?.boardId;
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
    // the boards too: one drawn meanwhile is the likeliest to name
    useEffect(() => {
        if (want && projectName !== "") {
            loadRefBoards();
        }
    }, [want, projectName]);
    // the archive keeps its own list fresh elsewhere (the Agent tree, History); the picker reads it only when nothing has
    useEffect(() => {
        if (want && sessionsUnread) {
            loadRefSessions();
        }
    }, [want, sessionsUnread]);
    return useMemo(() => {
        const runItems = project === "" ? [] : runRefs(runs);
        // the Agent tree's top level only: a run's workers and stage sessions, and a brainstorm's checks, sit under
        // the row that started them there and are read through it
        const topLevel = topLevelAgentIds(buildAgentTree(agents, [], lineage));
        return [
            // a run's lead is left to its run's row
            ...agentRefs(agents, selfId, new Set(runItems.map((r) => r.id)), topLevel),
            ...runItems,
            ...(project === "" ? [] : councilRefs(councils)),
            ...sessionRefs(sessions, projectPath, Date.now()),
            ...effortRefs(efforts, projectName),
            ...boardRefs(boards, projectName, openBoardId),
        ];
    }, [
        agents,
        lineage,
        selfId,
        project,
        runs,
        councils,
        sessions,
        projectPath,
        efforts,
        projectName,
        boards,
        openBoardId,
    ]);
}
