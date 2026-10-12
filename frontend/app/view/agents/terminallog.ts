// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A terminal-held server's Log: open its terminal, then its search box.

import { openTarget } from "@/app/view/jarvis/openref";
import { requestTermSearch } from "@/app/view/term/termsearch";
import { fireAndForget } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import type { TerminalLog } from "./devserversmodel";

export function openTerminalLog(model: AgentsViewModel, log: TerminalLog): void {
    fireAndForget(async () => {
        const result = await openTarget(model, { kind: "agent", tabId: log.tabId });
        // a landing that failed or was superseded leaves no search request behind for the terminal to find later
        if (result.ok) {
            requestTermSearch(log.blockId);
        }
    });
}
