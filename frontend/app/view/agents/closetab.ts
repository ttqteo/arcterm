// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Every tab the cockpit closes goes through closeTabLogged, which writes a `[close]` line (closelog.ts) to waveapp.log
// first, so a close can be traced to its route afterwards. Closing a working agent's tab also closes its resting judges
// that are asleep (pairmodel.ts hiddenJudgesOf): the tree hides them under the worker's row, so nobody could close them
// afterwards. A resting judge that something woke is a plain row the person can see, and it stays.

import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { WorkspaceService } from "@/app/store/services";
import { shortTabId } from "./agentrowmodel";
import { closeLogLine, type CloseEvent } from "./closelog";
import { hiddenJudgesOf } from "./pairmodel";
import { restingJudgesAtom } from "./pairstore";

export function logClose(e: CloseEvent): void {
    try {
        getApi().sendLog(closeLogLine(e));
    } catch {
        // a log line must never stop a close
    }
}

// Closes the worker, then the judges it hid, each through closeTabLogged (so each has its own [close] line and `why`). The
// roster is devmock.ts's (the mock or the live one); its module graph leads back here (liveagents → sessionsidebarmodel →
// closetab), so it loads when a close needs it, not at import. Both lists are read before the worker closes. The worker's
// close is the one that matters: its failure is the caller's, and a judge's failure is logged and leaves the others to close.
async function closeWithHiddenJudges(
    workspaceId: string,
    tabId: string,
    resting: PairResting[]
): Promise<CloseTabRtnType> {
    let hidden: PairResting[] = [];
    try {
        const { devRosterAtom } = await import("./devmock");
        hidden = hiddenJudgesOf(tabId, resting, globalStore.get(devRosterAtom));
    } catch (err) {
        console.error(`reading the roster to close the judges of ${tabId} failed`, err);
    }
    const rtn = await WorkspaceService.CloseTab(workspaceId, tabId);
    const why = `judge of closed worker ${shortTabId(tabId)}`;
    for (const judge of hidden) {
        try {
            await closeTabLogged(workspaceId, judge.tab, why);
        } catch (err) {
            console.error(`closing the judge ${judge.tab} of closed worker ${tabId} failed`, err);
        }
    }
    return rtn;
}

export function closeTabLogged(workspaceId: string, tabId: string, why: string): Promise<CloseTabRtnType> {
    logClose({ kind: "close", tabId, why });
    const resting = globalStore.get(restingJudgesAtom).filter((r) => r.workertab === tabId);
    if (resting.length === 0) {
        return WorkspaceService.CloseTab(workspaceId, tabId);
    }
    return closeWithHiddenJudges(workspaceId, tabId, resting);
}
