// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Overview's Activity card reads (projectactivitycard.tsx): a project's daily tally, from wavesrv. Read each
// time the Overview shows a project, and on Retry; not polled. The grid built from it is projectactivity.ts's.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect } from "react";
import { ACTIVITY_WEEKS } from "./projectactivity";

export type ActivityState = { rtn: CommandGetProjectActivityRtnData | null; error: string | null; loading: boolean };

export const projectActivityAtom = atomFamily(
    (_path: string) => atom<ActivityState>({ rtn: null, error: null, loading: false }) as PrimitiveAtom<ActivityState>
);

// the read in flight per path: an answer that is no longer the latest asked for is dropped
const latest = new Map<string, number>();

/** Reads a project's daily tally. A failure keeps what was read before, with the error. */
export async function loadProjectActivity(path: string): Promise<void> {
    const at = projectActivityAtom(path);
    const seq = (latest.get(path) ?? 0) + 1;
    latest.set(path, seq);
    globalStore.set(at, { ...globalStore.get(at), error: null, loading: true });
    try {
        // the window starts `weeks` weeks before this week's Monday, so the grid's 53 columns ask for 52: one more would
        // count sessions from the week before the grid in the header's distinct-session number
        const rtn = await RpcApi.GetProjectActivityCommand(TabRpcClient, { path, weeks: ACTIVITY_WEEKS - 1 });
        if (latest.get(path) === seq) {
            globalStore.set(at, { rtn: { ...rtn, days: rtn.days ?? [] }, error: null, loading: false });
        }
    } catch (e) {
        if (latest.get(path) === seq) {
            globalStore.set(at, {
                rtn: globalStore.get(at).rtn,
                error: e instanceof Error ? e.message : String(e),
                loading: false,
            });
        }
    }
}

export interface ProjectActivity extends ActivityState {
    retry: () => void;
}

/** A project's activity, read each time the Overview mounts for the path. */
export function useProjectActivity(path: string): ProjectActivity {
    const state = useAtomValue(projectActivityAtom(path));
    useEffect(() => {
        if (path) {
            fireAndForget(() => loadProjectActivity(path));
        }
    }, [path]);
    return { ...state, retry: () => fireAndForget(() => loadProjectActivity(path)) };
}
