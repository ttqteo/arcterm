// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Keeps the app icon's badge (dockbadge.ts) in step with the nav rail. Runs in the always-mounted shell, beside
// useUnreadTracking, since either count can change while any surface shows. The badge is app wide (the Dock icon
// on macOS); Windows has no badge count, so it is left alone there.

import { isWindows } from "@/util/platformutil";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import { attentionAtom, cockpitWaitingCount, splitAttention } from "./attentionstore";
import { channelMessagesAtom } from "./channelsstore";
import { dockBadgeCount } from "./dockbadge";
import { answeredAskIdsAcross } from "./jarvisderive";
import { unreadAgentsAtom } from "./unreadagentsstore";

export function useDockBadge(model: AgentsViewModel): void {
    const unread = useAtomValue(unreadAgentsAtom);
    const attention = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const answered = answeredAskIdsAcross(Object.values(useAtomValue(channelMessagesAtom)));
    const count = dockBadgeCount(unread.size, cockpitWaitingCount(splitAttention(attention).cockpit, agents, answered));
    useEffect(() => {
        if (isWindows()) {
            return;
        }
        getCurrentWindow()
            .setBadgeCount(count)
            .catch((e) => console.warn("dock badge:", e));
    }, [count]);
}
