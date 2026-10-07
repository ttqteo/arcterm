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
import { attentionAtom, splitAttention } from "./attentionstore";
import { dockBadgeCount } from "./dockbadge";
import { unreadAgentsAtom } from "./unreadagentsstore";

export function useDockBadge(): void {
    const unread = useAtomValue(unreadAgentsAtom);
    const attention = useAtomValue(attentionAtom);
    const count = dockBadgeCount(unread.size, splitAttention(attention).cockpit.length);
    useEffect(() => {
        if (isWindows()) {
            return;
        }
        getCurrentWindow()
            .setBadgeCount(count)
            .catch((e) => console.warn("dock badge:", e));
    }, [count]);
}
