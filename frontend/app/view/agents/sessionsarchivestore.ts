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

// one page of the newest-first scan; the older ones come a page at a time through loadMoreSessionsArchive
const PAGE = 100;

// null = not loaded yet; [] = loaded-empty.
export const sessionsArchiveAtom = atom<SessionActivity[] | null>(null) as PrimitiveAtom<SessionActivity[] | null>;
// true = the last scan failed (so an empty list reads as an error, not "no sessions"). Mirrors usagestore.
export const sessionsErrorAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
// where the next older page starts; "" = every session on disk is loaded
export const sessionsCursorAtom = atom<string>("") as PrimitiveAtom<string>;
// true while an older page is being fetched, for the list's "Loading older sessions…" row
export const sessionsLoadingMoreAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

const sessionId = (s: Pick<SessionActivity, "runtime" | "id">) => `${s.runtime}:${s.id}`;

/** Pure: a refreshed first page over the sessions already loaded. The fresh page leads; behind it come the kept
 *  sessions older than its oldest that it does not list, so the older pages a refresh never re-reads survive it, a
 *  session that moved up is listed once, and one that is gone from the fresh page's range drops out. The cursor is the
 *  kept one while such older sessions remain, else the fresh page's own. Identity is runtime + id. */
export function mergeFreshPage(
    fresh: SessionActivity[],
    freshCursor: string,
    kept: SessionActivity[],
    keptCursor: string
): { sessions: SessionActivity[]; cursor: string } {
    if (fresh.length === 0) {
        return { sessions: fresh, cursor: freshCursor };
    }
    const oldest = Math.min(...fresh.map((s) => s.lastactivets));
    const listed = new Set(fresh.map(sessionId));
    const older = kept.filter((s) => !listed.has(sessionId(s)) && s.lastactivets <= oldest);
    if (older.length === 0) {
        return { sessions: fresh, cursor: freshCursor };
    }
    return { sessions: [...fresh, ...older], cursor: keptCursor };
}

function appendPage(have: SessionActivity[], page: SessionActivity[]): SessionActivity[] {
    const listed = new Set(have.map(sessionId));
    return [...have, ...page.filter((s) => !listed.has(sessionId(s)))];
}

let loading = false;
// a refresh asked for while a scan is running (an agent just exited) would be dropped, and the scan under way may have
// read the transcripts before that session ended: it runs once more when this one finishes
let again = false;
let loadingMore = false;

export async function loadSessionsArchive(): Promise<void> {
    if (loading) {
        again = true;
        return;
    }
    loading = true;
    try {
        const rtn = await RpcApi.GetSessionsActivityCommand(TabRpcClient, { limit: PAGE });
        // merged against what is loaded when the answer lands, so a page that arrived meanwhile is not lost
        const merged = mergeFreshPage(
            rtn.sessions ?? [],
            rtn.nextcursor ?? "",
            globalStore.get(sessionsArchiveAtom) ?? [],
            globalStore.get(sessionsCursorAtom)
        );
        globalStore.set(sessionsArchiveAtom, merged.sessions);
        globalStore.set(sessionsCursorAtom, merged.cursor);
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

/** Append the next older page. One request at a time; nothing once every session is loaded (cursor ""), so a list that
 *  never fills ends its refill there instead of asking again. A failed page keeps the cursor: a later scroll retries. */
export async function loadMoreSessionsArchive(): Promise<void> {
    const cursor = globalStore.get(sessionsCursorAtom);
    if (loadingMore || cursor === "" || globalStore.get(sessionsArchiveAtom) == null) {
        return;
    }
    loadingMore = true;
    globalStore.set(sessionsLoadingMoreAtom, true);
    try {
        const rtn = await RpcApi.GetSessionsActivityCommand(TabRpcClient, { limit: PAGE, cursor });
        globalStore.set(sessionsArchiveAtom, (prev) => appendPage(prev ?? [], rtn.sessions ?? []));
        globalStore.set(sessionsCursorAtom, rtn.nextcursor ?? "");
    } catch {
        // the rows already loaded stay as they are
    } finally {
        loadingMore = false;
        globalStore.set(sessionsLoadingMoreAtom, false);
    }
}

/** Take a session's row out now: a delete reloads only the first page, which would leave a row from an older page. */
export function dropFromArchive(transcriptPath: string): void {
    if (transcriptPath === "") {
        return;
    }
    const gone = norm(transcriptPath);
    globalStore.set(sessionsArchiveAtom, (prev) =>
        prev == null ? prev : prev.filter((s) => norm(s.transcriptpath ?? "") !== gone)
    );
}

/** Pure: the sessions the command palette lists: resumable ones outside an engine run, or a run's lead. A run's workers,
 *  reviewers and stage sessions are not conversations to pick from. */
export function paletteSessions<T extends SessionActivity>(list: T[]): T[] {
    return list.filter((s) => s.resumecommand && (!s.role || s.role === "lead"));
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

/** Pure: the roster agent whose tab holds this transcript, awake or asleep (a sleeping agent keeps its transcript path
 *  in its block meta), or undefined. A resume of a session a tab holds goes to that tab: a second tab on it would run
 *  two processes writing one transcript. */
export function sessionHolder<T extends Pick<AgentVM, "transcriptPath">>(
    roster: T[],
    transcriptPath: string | undefined
): T | undefined {
    if (!transcriptPath) {
        return undefined;
    }
    const want = norm(transcriptPath);
    return roster.find((a) => a.transcriptPath && norm(a.transcriptPath) === want);
}

/** A block in a tab, with its meta as the store keeps it: what a launch wrote and the hooks stamped, which outlive
 *  a restart of arcterm. */
export interface StoredAgentBlock {
    tabId: string;
    name: string;
    blockId: string;
    meta: Record<string, unknown>;
}

// the flag each harness's resume key sits behind, first in cmd:args (blockcontroller's agentResumeFlags)
const RESUME_FLAGS: Record<string, string> = {
    claude: "--resume",
    opencode: "-s",
    pi: "--session",
    agy: "--conversation",
    codex: "resume",
};

/** Pure: the agent blocks whose meta says they hold this transcript: the transcript path their hooks stamped, or the
 *  session their cmd:args resume (claude's by the transcript's file stem, pi's by the path whole). sessionHolder reads
 *  the roster, which an agent joins only once it reports in; an agent the server brought back after a restart runs
 *  its session before that, and only its block says so. Whether its process still runs is the caller's to ask. */
export function storedSessionHolders(
    blocks: StoredAgentBlock[],
    transcriptPath: string | undefined
): StoredAgentBlock[] {
    if (!transcriptPath) {
        return [];
    }
    const want = norm(transcriptPath);
    const stem = want.slice(want.lastIndexOf("/") + 1).replace(/\.jsonl$/, "");
    return blocks.filter(({ meta }) => {
        const flag = RESUME_FLAGS[meta["cmd"] as string];
        if (meta["controller"] !== "cmd" || flag == null) {
            return false;
        }
        const stamped = meta["agent:transcriptpath"];
        if (typeof stamped === "string" && stamped !== "" && norm(stamped) === want) {
            return true;
        }
        const args = meta["cmd:args"];
        if (!Array.isArray(args) || args[0] !== flag || typeof args[1] !== "string") {
            return false;
        }
        const key = norm(args[1]);
        return key === want || key === stem;
    });
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
