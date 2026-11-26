// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Every tab the cockpit closes goes through closeTabLogged, which writes a `[close]` line (closelog.ts) to waveapp.log
// first, so a close can be traced to its route afterwards. Closing a working agent's tab also closes the judges arcterm
// launched for it, awake or asleep: those of its live pair and those resting from its ended rounds (wavesrv's
// PairCloseWorker names them, and ends the live pair first). Left open, a judge would come out of the tree as a stray row
// with nobody to judge. A judge the person picked from the live list is theirs and stays. Each ended pair keeps both
// sides' session ids, so a resume of the worker in a new tab offers to resume its judge too (pairmodel.ts
// resumableJudgeOf).

import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { WorkspaceService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { shortTabId } from "./agentrowmodel";
import { closeLogLine, type CloseEvent } from "./closelog";
import { pairListAtom, restingJudgesAtom } from "./pairstore";

export function logClose(e: CloseEvent): void {
    try {
        getApi().sendLog(closeLogLine(e));
    } catch {
        // a log line must never stop a close
    }
}

// The judges to close with the worker: wavesrv's answer (it ends the live pair as it answers), else, when it could not
// answer, the resting judges the cockpit knows of. Only those on the roster: a judge off it has no tab left to close. The
// roster is devmock.ts's (the mock or the live one); its module graph leads back here (liveagents → sessionsidebarmodel →
// closetab), so it loads when a close needs it, not at import.
async function judgesToClose(tabId: string): Promise<string[]> {
    let judges: string[];
    try {
        judges = (await RpcApi.PairCloseWorkerCommand(TabRpcClient, { workertab: tabId }))?.judges ?? [];
    } catch (err) {
        console.error(`asking wavesrv for the judges of closing worker ${tabId} failed`, err);
        judges = globalStore
            .get(restingJudgesAtom)
            .filter((r) => r.workertab === tabId)
            .map((r) => r.tab);
    }
    try {
        const { devRosterAtom } = await import("./devmock");
        const roster = globalStore.get(devRosterAtom);
        return judges.filter((j) => j !== tabId && roster.some((a) => a.id === j));
    } catch (err) {
        console.error(`reading the roster to close the judges of ${tabId} failed`, err);
        return [];
    }
}

// Closes the worker, then its judges, each through closeTabLogged (so each has its own [close] line and `why`). The judges
// are read before the worker closes. The worker's close is the one that matters: its failure is the caller's, and a
// judge's failure is logged and leaves the others to close.
async function closeWithJudges(workspaceId: string, tabId: string): Promise<CloseTabRtnType> {
    const judges = await judgesToClose(tabId);
    const rtn = await WorkspaceService.CloseTab(workspaceId, tabId);
    const why = `judge of closed worker ${shortTabId(tabId)}`;
    for (const judge of judges) {
        try {
            await closeTabLogged(workspaceId, judge, why);
        } catch (err) {
            console.error(`closing the judge ${judge} of closed worker ${tabId} failed`, err);
        }
    }
    return rtn;
}

// whether the tab may be a worker with judges: the worker of a live pair, or of an ended one a judge rests from. Any other
// close asks wavesrv nothing.
function mayHaveJudges(tabId: string): boolean {
    return (
        globalStore.get(pairListAtom).some((p) => p.worker.tab === tabId) ||
        globalStore.get(restingJudgesAtom).some((r) => r.workertab === tabId)
    );
}

export function closeTabLogged(workspaceId: string, tabId: string, why: string): Promise<CloseTabRtnType> {
    logClose({ kind: "close", tabId, why });
    if (!mayHaveJudges(tabId)) {
        return WorkspaceService.CloseTab(workspaceId, tabId);
    }
    return closeWithJudges(workspaceId, tabId);
}
