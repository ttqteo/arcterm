// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Always-mounted (cockpit root) 10s poll driver for the cockpit-wide attention list. Renders nothing.
// 10s mirrors BackgroundAgentsPoller, which picked it so a blocked agent surfaces quickly; a review
// gate has the same urgency. Polling rather than server push is deliberate — a missed poll self-heals
// on the next tick, whereas a missed push event goes stale while still looking live.
//
// It also carries the list out of the app: the in-app badges are invisible while another window has
// focus, so a new item flashes the taskbar button until Arc is focused again.

import { fireAndForget } from "@/util/util";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { attentionAtom, loadAttention, taskbarSignal } from "./attentionstore";

export function AttentionPoller() {
    useEffect(() => {
        void loadAttention();
        const t = setInterval(() => void loadAttention(), 10_000);
        return () => clearInterval(t);
    }, []);
    const attention = useAtomValue(attentionAtom);
    const seen = useRef<AttentionItem[]>([]);
    useEffect(() => {
        const signal = taskbarSignal(seen.current, attention, document.hasFocus());
        seen.current = attention;
        if (signal != null) {
            const request = signal === "flash" ? UserAttentionType.Informational : null;
            fireAndForget(() => getCurrentWindow().requestUserAttention(request));
        }
    }, [attention]);
    return null;
}
