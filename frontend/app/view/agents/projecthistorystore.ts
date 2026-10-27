// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a project's Overview History column reads (projecthistory.tsx): the project's runs, read from each channel bound
// to its path, with their loading and error state; the sessions archive, read back far enough to cover the window; and
// the column's search, per project, since the centre mode unmounts. Councils are councilstore.ts's; the rows
// they all make are projectoverviewmodel.ts's.

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
import {
    loadMoreSessionsArchive,
    loadSessionsArchive,
    overlayLive,
    sessionsArchiveAtom,
    sessionsCursorAtom,
    sessionsErrorAtom,
    type LiveSession,
} from "./sessionsarchivestore";

export type RunsState = { runs: Run[] | null; error: string | null };

export const historyQueryAtom = atomFamily((_path: string) => atom("") as PrimitiveAtom<string>);
export const projectRunsAtom = atomFamily(
    (_path: string) => atom<RunsState>({ runs: null, error: null }) as PrimitiveAtom<RunsState>
);

// the archive's older pages read past the first to cover the window, at most: 1,000 sessions across every project
export const MAX_PAGES = 10;

// how long the walk waits for a scan another reader started, when it has nothing of its own to page over
const SCAN_WAIT_MS = 15_000;

const samePath = (a: string, b: string) => normProjectPath(a).toLowerCase() === normProjectPath(b).toLowerCase();

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

// resolves on the archive's next change, or after the bound
function nextArchiveChange(boundMs: number): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            unsub();
            resolve();
        };
        const timer = setTimeout(done, boundMs);
        const unsub = globalStore.sub(sessionsArchiveAtom, done);
    });
}

// loadSessionsArchive returns at once, having read nothing, when a scan is already running (another reader's, which
// only queues a rerun). A scan that lands always sets the archive to a new list, so a list still the one held before
// the call means the call was dropped: the archive is null, or the stale list the running scan is about to replace,
// and paging from it would stop early. Wait for that scan's answer, for a bounded time.
async function reloadArchive(): Promise<void> {
    const held = globalStore.get(sessionsArchiveAtom);
    await loadSessionsArchive();
    if (globalStore.get(sessionsArchiveAtom) === held) {
        await nextArchiveChange(SCAN_WAIT_MS);
    }
}

/** Reloads the sessions archive, then reads older pages until its oldest session is older than the window, none are
 *  left, or MAX_PAGES were read. */
export async function loadSessionsWindow(now: number): Promise<void> {
    await reloadArchive();
    for (let i = 0; i < MAX_PAGES; i++) {
        const list = globalStore.get(sessionsArchiveAtom);
        const cursor = globalStore.get(sessionsCursorAtom);
        if (list == null || cursor === "" || list.length === 0) {
            return;
        }
        if (Math.min(...list.map((s) => s.lastactivets)) < now - HISTORY_WINDOW_MS) {
            return;
        }
        await loadMoreSessionsArchive();
        if (globalStore.get(sessionsCursorAtom) === cursor) {
            return; // a failed page keeps the cursor: stop rather than ask again
        }
    }
}

export interface ProjectHistory {
    sessions: LiveSession[] | null; // null while the archive loads
    sessionsError: boolean;
    councils: Council[] | null;
    runs: RunsState;
    retrySessions: () => void;
    retryRuns: () => void;
}

/** A project's history, read each time the Overview shows it and when its path changes; not polled. The page calls it
 *  once and hands it to the History column and the header's counts. */
export function useProjectHistory(model: AgentsViewModel, path: string): ProjectHistory {
    const archive = useAtomValue(sessionsArchiveAtom);
    const sessionsError = useAtomValue(sessionsErrorAtom);
    const roster = useAtomValue(model.agentsAtom);
    const councils = useCouncils(path || null);
    const runs = useAtomValue(projectRunsAtom(path));
    useEffect(() => {
        if (!path) {
            return;
        }
        fireAndForget(() => loadSessionsWindow(Date.now()));
        fireAndForget(() => loadProjectRuns(path));
    }, [path]);
    const sessions = useMemo(() => (archive == null ? null : overlayLive(archive, roster, 0)), [archive, roster]);
    return {
        sessions,
        sessionsError,
        councils,
        runs,
        retrySessions: () => fireAndForget(() => loadSessionsWindow(Date.now())),
        retryRuns: () => fireAndForget(() => loadProjectRuns(path)),
    };
}
