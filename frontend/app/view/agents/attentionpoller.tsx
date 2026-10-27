// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Always-mounted (cockpit root) 10s poll driver for the cockpit-wide attention list. Renders nothing.
// 10s mirrors BackgroundAgentsPoller, which picked it so a blocked agent surfaces quickly; a review
// gate has the same urgency. Polling rather than server push is deliberate — a missed poll self-heals
// on the next tick, whereas a missed push event goes stale while still looking live.
//
// It also carries the list out of the app: the in-app badges are invisible while another window has
// focus, so a new item flashes the taskbar button until Arc is focused again. A question a brainstorm asks is in that
// outward list only (brainstormAttentionItems): the server has no such item, and the in-app lists stay the server's.

import { fireAndForget } from "@/util/util";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { atom, useAtomValue, type Atom } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import type { AgentsViewModel } from "./agents";
import { attentionAtom, brainstormAttentionItems, loadAttention, taskbarSignal } from "./attentionstore";
import { brainstormsAtom } from "./brainstormstore";

function brainstormItemsAtom(model: AgentsViewModel): Atom<AttentionItem[]> {
    return atom((get) => brainstormAttentionItems(get(model.baseRosterAtom), get(brainstormsAtom)));
}

export function AttentionPoller({ model }: { model: AgentsViewModel }) {
    useEffect(() => {
        void loadAttention();
        const t = setInterval(() => void loadAttention(), 10_000);
        return () => clearInterval(t);
    }, []);
    const attention = useAtomValue(attentionAtom);
    const brainstormItems = useAtomValue(useMemo(() => brainstormItemsAtom(model), [model]));
    // server items first, so their rank wins
    const outward = useMemo(() => [...attention, ...brainstormItems], [attention, brainstormItems]);
    const seen = useRef<AttentionItem[]>([]);
    useEffect(() => {
        const signal = taskbarSignal(seen.current, outward, document.hasFocus());
        seen.current = outward;
        if (signal != null) {
            const request = signal === "flash" ? UserAttentionType.Informational : null;
            fireAndForget(() => getCurrentWindow().requestUserAttention(request));
        }
    }, [outward]);
    return null;
}
