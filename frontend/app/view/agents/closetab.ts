// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Every tab the cockpit closes goes through closeTabLogged, which writes a `[close]` line (closelog.ts) to waveapp.log
// first, so a close can be traced to its route afterwards.

import { getApi } from "@/app/store/global";
import { WorkspaceService } from "@/app/store/services";
import { closeLogLine, type CloseEvent } from "./closelog";

export function logClose(e: CloseEvent): void {
    try {
        getApi().sendLog(closeLogLine(e));
    } catch {
        // a log line must never stop a close
    }
}

export function closeTabLogged(workspaceId: string, tabId: string, why: string): Promise<CloseTabRtnType> {
    logClose({ kind: "close", tabId, why });
    return WorkspaceService.CloseTab(workspaceId, tabId);
}
