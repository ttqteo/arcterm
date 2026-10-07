// frontend/app/view/agents/sessionsarchivestore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Sessions archive store, read by Conversation History, the Agent sidebar's ended sessions and the session pane: the
// loaded SessionActivity[] from GetSessionsActivity (one Go parser feeds summary + per-session lifecycle events), a
// pure live-roster overlay, and pure grouping/filter/feed helpers. Replaces the retired Activity FE extraction stack
// (activitystore/activityevents/discovery).

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentVM } from "./agentsviewmodel";

const WINDOW_DAYS = 30;
const LIMIT = 100;

// null = not loaded yet; [] = loaded-empty.
export const sessionsArchiveAtom = atom<SessionActivity[] | null>(null) as PrimitiveAtom<SessionActivity[] | null>;
// true = the last scan failed (so an empty list reads as an error, not "no sessions"). Mirrors usagestore.
export const sessionsErrorAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

let loading = false;
// a refresh asked for while a scan is running (an agent just exited) would be dropped, and the scan under way may have
// read the transcripts before that session ended: it runs once more when this one finishes
let again = false;

export async function loadSessionsArchive(): Promise<void> {
    if (loading) {
        again = true;
        return;
    }
    loading = true;
    try {
        const rtn = await RpcApi.GetSessionsActivityCommand(TabRpcClient, { windowdays: WINDOW_DAYS, limit: LIMIT });
        globalStore.set(sessionsArchiveAtom, rtn.sessions ?? []);
        globalStore.set(sessionsErrorAtom, false);
    } catch {
        // surface the failure distinctly instead of an indistinguishable empty list. Keep any last-good
        // data; mark loaded (null -> []) so the surface shows the error banner, not a permanent skeleton.
        globalStore.set(sessionsErrorAtom, true);
        globalStore.set(sessionsArchiveAtom, (prev) => prev ?? []);
    } finally {
        loading = false;
        if (again) {
            again = false;
            void loadSessionsArchive();
        }
    }
}

export type SessionStatusFilter = "all" | "live" | "done" | "needs";

export interface LiveSession extends SessionActivity {
    live: boolean;
    liveId?: string; // roster tabId when live (jump target)
    needsAttention: boolean;
}

function norm(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase();
}

// Overlay the live roster onto the scanned sessions: match on transcript path, strip the synthetic
// "finished" event for live sessions, and compute needsAttention (live+asking, or ended waiting).
export function overlayLive(base: SessionActivity[], roster: AgentVM[], _now: number): LiveSession[] {
    const liveByPath = new Map<string, { id: string; asking: boolean }>();
    for (const a of roster) {
        if (a.transcriptPath) {
            liveByPath.set(norm(a.transcriptPath), { id: a.id, asking: a.state === "asking" });
        }
    }
    return base.map((s) => {
        const hit = s.transcriptpath ? liveByPath.get(norm(s.transcriptpath)) : undefined;
        const live = hit != null;
        const events = live ? s.events.filter((e) => e.type !== "finished") : s.events;
        const needsAttention = live ? !!hit?.asking : s.status === "waiting";
        return { ...s, events, live, liveId: hit?.id, needsAttention };
    });
}

export function filterByStatus(list: LiveSession[], f: SessionStatusFilter): LiveSession[] {
    if (f === "all") {
        return list;
    }
    if (f === "live") {
        return list.filter((s) => s.live);
    }
    if (f === "done") {
        return list.filter((s) => !s.live && s.status === "done");
    }
    return list.filter((s) => s.needsAttention); // "needs"
}

export function resolveSelectedSession(list: LiveSession[], selection: string): LiveSession | undefined {
    return selection === "all" ? undefined : list.find((session) => `${session.runtime}:${session.id}` === selection);
}

export interface RecencyGroup<T = LiveSession> {
    key: "live" | "today" | "earlier";
    label: string;
    items: T[];
}

type Recent = { live: boolean; lastactivets: number };

export function groupByRecency<T extends Recent>(list: T[], now: number): RecencyGroup<T>[] {
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const live: T[] = [];
    const today: T[] = [];
    const earlier: T[] = [];
    for (const s of list) {
        if (s.live) {
            live.push(s);
        } else if (s.lastactivets >= startOfToday) {
            today.push(s);
        } else {
            earlier.push(s);
        }
    }
    const desc = (a: T, b: T) => b.lastactivets - a.lastactivets;
    live.sort(desc);
    today.sort(desc);
    earlier.sort(desc);
    return (
        [
            { key: "live", label: "Live now", items: live },
            { key: "today", label: "Today", items: today },
            { key: "earlier", label: "Earlier", items: earlier },
        ] as RecencyGroup<T>[]
    ).filter((g) => g.items.length > 0);
}

export interface MergedItem {
    key: string;
    type: string;
    ts: number;
    text: string;
    sessionKey: string; // `${runtime}:${id}` — selection target
    sessionTitle: string;
    project: string;
    runtime: string;
}

export function mergedFeed(
    list: LiveSession[],
    label: (s: LiveSession) => string = (s) => s.task || "(untitled session)"
): MergedItem[] {
    const items: MergedItem[] = [];
    for (const s of list) {
        const sessionKey = `${s.runtime}:${s.id}`;
        for (let i = 0; i < s.events.length; i++) {
            const e = s.events[i];
            items.push({
                key: `${sessionKey}#${i}`,
                type: e.type,
                ts: e.ts,
                text: e.text,
                sessionKey,
                sessionTitle: label(s),
                project: s.projectname,
                runtime: s.runtime,
            });
        }
    }
    items.sort((a, b) => b.ts - a.ts);
    return items;
}

export function totalEvents(list: LiveSession[]): number {
    return list.reduce((n, s) => n + s.events.length, 0);
}
