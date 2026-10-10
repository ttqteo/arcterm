// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The session a run was started from, read for the agent header and the run sheet, and the one way to open it; and
// the runs a session started, read for its header.

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openTarget } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { showSession } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { channelsAtom, loadChannels } from "./channelsstore";
import { runOrigin, runsStartedBy, type RunOrigin } from "./runorigin";
import { loadSessionsArchive, sessionsArchiveAtom } from "./sessionsarchivestore";

export function useRunOrigin(model: AgentsViewModel, run: Run | undefined): RunOrigin | null {
    const roster = useAtomValue(model.agentsAtom);
    const archive = useAtomValue(sessionsArchiveAtom);
    const origin = runOrigin(run, roster, archive);
    // an ended session is found in Conversation History, which may not have been scanned yet
    const scan = origin?.kind === "gone" && archive == null;
    useEffect(() => {
        if (scan) {
            fireAndForget(loadSessionsArchive);
        }
    }, [scan]);
    return origin;
}

// openRunOrigin goes to the session: its terminal while it lives, its transcript once it has ended
export function openRunOrigin(model: AgentsViewModel, origin: RunOrigin): void {
    if (origin.kind === "live") {
        fireAndForget(() => openTarget(model, { kind: "agent", tabId: origin.tabId }));
    } else if (origin.kind === "ended") {
        showSession(model, origin.sel, origin.member);
    }
}

// every run a session started, by id, as its channel listed it: what the session's header finds its runs among. Only
// the origin is read from these copies, which never changes; a run's status is its live object's.
const originRunsAtom = atom<Record<string, Run>>({}) as PrimitiveAtom<Record<string, Run>>;

// loadOriginRuns reads every channel's runs, or one channel's when a run was just created in it
async function loadOriginRuns(channelId?: string): Promise<void> {
    let channels = globalStore.get(channelsAtom);
    // a run in a project with no channel yet is in one the list has not loaded
    if (channels == null || (channelId != null && !channels.some((c) => c.oid === channelId))) {
        await loadChannels();
        channels = globalStore.get(channelsAtom) ?? [];
    }
    const ids = channelId != null ? [channelId] : channels.map((c) => c.oid);
    const lists = await Promise.all(
        ids.map((id) =>
            RpcApi.GetChannelRunsCommand(TabRpcClient, { channelid: id }).then(
                (rtn) => rtn.runs ?? [],
                () => [] as Run[]
            )
        )
    );
    const found: Record<string, Run> = {};
    for (const run of lists.flat()) {
        if (run.origintabid) {
            found[run.oid] = run;
        }
    }
    globalStore.set(originRunsAtom, (prev) => ({ ...prev, ...found }));
}

// one load and one event subscription however many headers are open
let watchers = 0;
let unwatch: (() => void) | null = null;

function watchOriginRuns(): () => void {
    if (watchers++ === 0) {
        fireAndForget(() => loadOriginRuns());
        // unscoped: a run created in any project may be this session's
        unwatch = waveEventSubscribeSingle({
            eventType: "run:event",
            handler: (event) => {
                const data = event?.data as RunEventData | undefined;
                if (data?.event?.kind === "run-created" && data.channelid) {
                    fireAndForget(() => loadOriginRuns(data.channelid));
                }
            },
        });
    }
    return () => {
        if (--watchers === 0) {
            unwatch?.();
            unwatch = null;
        }
    };
}

// useRunsStartedBy is the runs this session started with `wsh runs start`, live, the ones still going first
export function useRunsStartedBy(agent: Pick<AgentVM, "id" | "transcriptPath">): Run[] {
    useEffect(() => watchOriginRuns(), []);
    const index = useAtomValue(originRunsAtom);
    const mine = useMemo(() => runsStartedBy(agent, Object.values(index)), [index, agent.id, agent.transcriptPath]);
    const live = useMemo(
        () => atom((get) => mine.map((r) => get(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", r.oid))) ?? r)),
        [mine]
    );
    const runs = useAtomValue(live);
    return useMemo(() => runsStartedBy(agent, runs), [runs, agent.id, agent.transcriptPath]);
}
