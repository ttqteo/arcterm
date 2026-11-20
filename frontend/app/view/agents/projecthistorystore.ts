// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a project's Overview History column reads (projecthistory.tsx): the project's runs, read from each channel bound
// to its path, with their loading and error state; the project's own sessions of the window, read a page at a time as
// History scrolls (never the whole archive of every project); and the column's search, per project, since the centre
// mode unmounts. Councils are councilstore.ts's; the rows they all make are projectoverviewmodel.ts's.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect, useMemo } from "react";
import type { AgentsViewModel } from "./agents";
import { normProjectPath } from "./channelderive";
import { channelsAtom, loadChannels } from "./channelsstore";
import { useCouncils } from "./councilstore";
import { HISTORY_WINDOW_MS } from "./projectoverviewmodel";
import { appendPage, mergeFreshPage, overlayLive, sessionsArchiveAtom, type LiveSession } from "./sessionsarchivestore";

export type RunsState = { runs: Run[] | null; error: string | null };

export const historyQueryAtom = atomFamily((_path: string) => atom("") as PrimitiveAtom<string>);
export const projectRunsAtom = atomFamily(
    (_path: string) => atom<RunsState>({ runs: null, error: null }) as PrimitiveAtom<RunsState>
);

// A project's sessions as History has read them: newest first, a page at a time. `cursor` is where the next older page
// starts ("" = none of the window is left unread); `error` is the last first-page read failing; `readAt` is when the
// last first page that landed was asked for (ms, 0 = never), so a session active since is one that read could not see.
export type ProjectSessionsState = {
    sessions: SessionActivity[] | null;
    cursor: string;
    error: boolean;
    readAt: number;
};

export const projectSessionsAtom = atomFamily(
    (_path: string) =>
        atom<ProjectSessionsState>({
            sessions: null,
            cursor: "",
            error: false,
            readAt: 0,
        }) as PrimitiveAtom<ProjectSessionsState>
);

// sessions per page: History draws 15 top-level rows at first, so one page fills its first screen and the next
export const PROJECT_SESSIONS_PAGE = 30;

// the backend's window in whole days; it walks transcripts touched a day past it, and projectSessions cuts to the ms
const WINDOW_DAYS = Math.ceil(HISTORY_WINDOW_MS / 86_400_000);

const samePath = (a: string, b: string) => normProjectPath(a).toLowerCase() === normProjectPath(b).toLowerCase();
const sessionId = (s: Pick<SessionActivity, "runtime" | "id">) => `${s.runtime}:${s.id}`;

/** Reads the runs of every channel bound to the project's path. A failure keeps the runs read before, with the error. */
export async function loadProjectRuns(path: string): Promise<void> {
    const at = projectRunsAtom(path);
    try {
        if (globalStore.get(channelsAtom) == null) {
            await loadChannels();
        }
        const ids = (globalStore.get(channelsAtom) ?? [])
            .filter((c) => c.projectpath && samePath(c.projectpath, path))
            .map((c) => c.oid);
        const lists = await Promise.all(
            ids.map((id) => RpcApi.GetChannelRunsCommand(TabRpcClient, { channelid: id }).then((r) => r.runs ?? []))
        );
        globalStore.set(at, { runs: lists.flat(), error: null });
    } catch (e) {
        globalStore.set(at, { runs: globalStore.get(at).runs, error: e instanceof Error ? e.message : String(e) });
    }
}

// the paths whose sessions were read, so a delete can take its row out of each; and the reads under way, per path
const readPaths = new Set<string>();
const loadingFirst = new Set<string>();
const loadingMore = new Set<string>();

/** Reads the newest page of the project's sessions in the window, over what is already read: the older pages read
 *  before stay (mergeFreshPage). A failure keeps them, and marks the error. One read per path at a time. */
export async function loadProjectSessions(path: string): Promise<void> {
    if (loadingFirst.has(path)) {
        return;
    }
    loadingFirst.add(path);
    readPaths.add(path);
    const at = projectSessionsAtom(path);
    const asked = Date.now();
    try {
        const rtn = await RpcApi.GetSessionsActivityCommand(TabRpcClient, {
            projectpath: path,
            windowdays: WINDOW_DAYS,
            limit: PROJECT_SESSIONS_PAGE,
        });
        const held = globalStore.get(at);
        const merged = mergeFreshPage(rtn.sessions ?? [], rtn.nextcursor ?? "", held.sessions ?? [], held.cursor);
        globalStore.set(at, { sessions: merged.sessions, cursor: merged.cursor, error: false, readAt: asked });
    } catch (e) {
        console.warn("project sessions: read failed", e);
        globalStore.set(at, (prev) => ({ ...prev, sessions: prev.sessions ?? [], error: true }));
    } finally {
        loadingFirst.delete(path);
    }
}

/** Reads the project's next older page, when one is left and none is being read. A failed page keeps the cursor, so a
 *  later scroll asks again. */
export async function loadMoreProjectSessions(path: string): Promise<void> {
    const at = projectSessionsAtom(path);
    const cursor = globalStore.get(at).cursor;
    if (cursor === "" || loadingMore.has(path) || globalStore.get(at).sessions == null) {
        return;
    }
    loadingMore.add(path);
    try {
        const rtn = await RpcApi.GetSessionsActivityCommand(TabRpcClient, {
            projectpath: path,
            windowdays: WINDOW_DAYS,
            limit: PROJECT_SESSIONS_PAGE,
            cursor,
        });
        globalStore.set(at, (prev) => ({
            ...prev,
            sessions: appendPage(prev.sessions ?? [], rtn.sessions ?? []),
            // a first page that landed meanwhile and found nothing older left has the last word
            cursor: prev.cursor === cursor ? (rtn.nextcursor ?? "") : prev.cursor,
        }));
    } catch (e) {
        console.warn("project sessions: older page failed", e);
    } finally {
        loadingMore.delete(path);
    }
}

/** Take a deleted session's row out of every project's list read so far. */
export function dropFromProjectSessions(transcriptPath: string): void {
    if (transcriptPath === "") {
        return;
    }
    const gone = transcriptPath.replace(/\\/g, "/").toLowerCase();
    for (const path of readPaths) {
        globalStore.set(projectSessionsAtom(path), (prev) =>
            prev.sessions == null
                ? prev
                : {
                      ...prev,
                      sessions: prev.sessions.filter(
                          (s) => (s.transcriptpath ?? "").replace(/\\/g, "/").toLowerCase() !== gone
                      ),
                  }
        );
    }
}

/** Pure: the project's sessions as History lists them: the pages read, joined by the project's sessions the shared
 *  archive holds that were active after the first page was asked for (the archive is refreshed when an agent exits, so
 *  a session that just ended shows without a reread), the newer copy of a session kept. An older one the archive holds
 *  is not added: the project's own read is the newer word on it, and leaving it out may mean it is gone. `frontier` is
 *  the time of the oldest session read while older pages are unread, null once nothing is unread. */
export function projectSessionList(
    state: ProjectSessionsState,
    archive: readonly SessionActivity[] | null,
    path: string
): { sessions: SessionActivity[] | null; frontier: number | null } {
    if (state.sessions == null) {
        return { sessions: null, frontier: null };
    }
    const frontier =
        state.cursor !== "" && state.sessions.length > 0
            ? Math.min(...state.sessions.map((s) => s.lastactivets))
            : null;
    const byId = new Map<string, SessionActivity>();
    for (const s of state.sessions) {
        byId.set(sessionId(s), s);
    }
    for (const s of archive ?? []) {
        if (!samePath(s.projectpath, path) || s.lastactivets <= state.readAt) {
            continue;
        }
        const held = byId.get(sessionId(s));
        if (held == null || s.lastactivets > held.lastactivets) {
            byId.set(sessionId(s), s);
        }
    }
    return { sessions: [...byId.values()], frontier };
}

export interface ProjectHistory {
    sessions: LiveSession[] | null; // null while the first page loads
    sessionsError: boolean;
    councils: Council[] | null;
    runs: RunsState;
    /** older sessions of the window are still unread: History asks for them as it scrolls (loadMoreProjectSessions) */
    more: boolean;
    /** while `more`, the time of the oldest session read: rows older than it wait for the next page */
    frontier: number | null;
    retrySessions: () => void;
    retryRuns: () => void;
}

/** A project's history, read each time the Overview shows it and when its path changes; not polled. The page calls it
 *  once and hands it to the History column and the header's counts. */
export function useProjectHistory(model: AgentsViewModel, path: string): ProjectHistory {
    const state = useAtomValue(projectSessionsAtom(path));
    const archive = useAtomValue(sessionsArchiveAtom);
    const roster = useAtomValue(model.agentsAtom);
    const councils = useCouncils(path || null);
    const runs = useAtomValue(projectRunsAtom(path));
    useEffect(() => {
        if (!path) {
            return;
        }
        fireAndForget(() => loadProjectSessions(path));
        fireAndForget(() => loadProjectRuns(path));
    }, [path]);
    const list = useMemo(() => projectSessionList(state, archive, path), [state, archive, path]);
    const sessions = useMemo(
        () => (list.sessions == null ? null : overlayLive(list.sessions, roster, 0)),
        [list.sessions, roster]
    );
    return {
        sessions,
        sessionsError: state.error,
        councils,
        runs,
        more: list.frontier != null,
        frontier: list.frontier,
        retrySessions: () => fireAndForget(() => loadProjectSessions(path)),
        retryRuns: () => fireAndForget(() => loadProjectRuns(path)),
    };
}
