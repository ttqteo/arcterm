// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Run lineage over the live roster: each agent's run and its dag read straight from the object store,
// and the engine's digest for every run in view, which alone knows lanes and who holds a question. The
// digest is reloaded when the dag changes and when a question is raised, forwarded, answered or cleared.

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import { type AgentVM } from "./agentsviewmodel";
import { taskFoldKey, type TreeFolds } from "./agenttreemodel";
import {
    endedRoles,
    endedWorkerVM,
    isEndedWorkerId,
    runRoleOf,
    runTitle,
    type Lineage,
    type RunInfo,
    type RunRole,
} from "./runlineage";

export const runDigestsAtom = atom<Record<string, DagStatusDigest>>({}) as PrimitiveAtom<
    Record<string, DagStatusDigest>
>;

export const treeFoldsAtom = atom<TreeFolds>({
    collapsed: new Set<string>(),
    doneOpen: new Map<string, number>(),
    queuedOpen: new Set<string>(),
    extrasOpen: new Set<string>(),
}) as PrimitiveAtom<TreeFolds>;

function toggled(set: ReadonlySet<string>, id: string): Set<string> {
    const next = new Set(set);
    if (!next.delete(id)) {
        next.add(id);
    }
    return next;
}

export function toggleRunCollapsed(runId: string): void {
    globalStore.set(treeFoldsAtom, (f) => ({ ...f, collapsed: toggled(f.collapsed, runId) }));
}

// a fold the next landing closed is still in the map under an older count, so open must come from the row
export function toggleRunDoneOpen(runId: string, open: boolean, doneCount: number): void {
    globalStore.set(treeFoldsAtom, (f) => {
        const doneOpen = new Map(f.doneOpen);
        if (open) {
            doneOpen.delete(runId);
        } else {
            doneOpen.set(runId, doneCount);
        }
        return { ...f, doneOpen };
    });
}

export function toggleRunQueuedOpen(runId: string): void {
    globalStore.set(treeFoldsAtom, (f) => ({ ...f, queuedOpen: toggled(f.queuedOpen, runId) }));
}

export function toggleTaskExtrasOpen(runId: string, taskId: string): void {
    globalStore.set(treeFoldsAtom, (f) => ({ ...f, extrasOpen: toggled(f.extrasOpen, taskFoldKey(runId, taskId)) }));
}

function lastPathSegment(path: string | undefined): string {
    return (path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}

// lineageAtomFor derives the lineage of the agents in agentsAtom. Reading a run or dag atom loads it on
// first use, so an agent nests as soon as its run and dag arrive.
export function lineageAtomFor(agentsAtom: Atom<AgentVM[]>): Atom<Lineage> {
    return atom((get) => {
        const digests = get(runDigestsAtom);
        const runOf = (id: string) => get(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", id)));
        const roles: Record<string, RunRole> = {};
        const runs: Record<string, RunInfo> = {};
        for (const a of get(agentsAtom)) {
            if (!a.runId) {
                continue;
            }
            const run = runOf(a.runId);
            // dagoref holds the dag's bare id, whatever its name says
            const dag = run?.dagoref
                ? get(WOS.getWaveObjectAtom<TaskGroup>(WOS.makeORef("dag", run.dagoref)))
                : undefined;
            const block = a.blockId ? get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", a.blockId))) : undefined;
            const role = runRoleOf(run, dag, block?.meta?.["agent:taskid"]);
            if (role == null) {
                continue;
            }
            roles[a.id] = role;
            const leadRunId = role.kind === "lead" ? role.runId : role.leadRunId;
            if (runs[leadRunId]) {
                continue;
            }
            const leadRun = role.kind === "lead" ? run : runOf(leadRunId);
            runs[leadRunId] = {
                runId: leadRunId,
                channelId: leadRun?.channeloid || run.channeloid || "",
                title: runTitle(leadRun, dag),
                project: lastPathSegment(leadRun?.projectpath),
                leadStarted: (leadRun?.phases ?? []).some((p) => (p.workerorefs ?? []).length > 0),
                originId: leadRun?.origintabid || undefined,
                status: leadRun?.status,
                landPath: leadRun?.landpath,
                land: leadRun?.land,
                dag,
                digest: digests[leadRunId],
            };
        }
        return { roles: { ...roles, ...endedRoles(runs) }, runs };
    });
}

// runTranscriptPathsAtom holds each child run's transcript path once looked up, "" when none was found.
export const runTranscriptPathsAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

// loadRunTranscriptPath looks a child run's transcript up by the session id it was launched under.
export function loadRunTranscriptPath(channelId: string, runId: string): void {
    if (runId in globalStore.get(runTranscriptPathsAtom)) {
        return;
    }
    fireAndForget(async () => {
        let path = "";
        try {
            path = (await RpcApi.RunTranscriptPathCommand(TabRpcClient, { channelid: channelId, runid: runId })) ?? "";
        } catch (err) {
            console.warn(`finding the transcript of run ${runId} failed`, err);
        }
        globalStore.set(runTranscriptPathsAtom, (prev) => ({ ...prev, [runId]: path }));
    });
}

export interface EndedWorker {
    agent: AgentVM;
    // the files its run sealed; the worktree it changed them in is gone
    files: EvidenceFile[];
    // the lane branch it committed on, deleted with the worktree; runs launched before it was recorded have none
    branch?: string;
}

// endedWorkerAtomFor is the done task's worker the surface is focused on, if the focus is one.
export function endedWorkerAtomFor(
    focusIdAtom: Atom<string | undefined>,
    lineageAtom: Atom<Lineage>
): Atom<EndedWorker | undefined> {
    return atom((get) => {
        const id = get(focusIdAtom);
        const lineage = get(lineageAtom);
        const role = id ? lineage.roles[id] : undefined;
        if (!isEndedWorkerId(id ?? "") || role?.kind !== "worker") {
            return undefined;
        }
        const run = lineage.runs[role.leadRunId];
        const task = run.dag?.tasks?.find((t) => t.id === role.taskId);
        if (task == null) {
            return undefined;
        }
        const child = task.runid ? get(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", task.runid))) : undefined;
        const path = task.runid ? get(runTranscriptPathsAtom)[task.runid] : undefined;
        return {
            agent: endedWorkerVM(run.runId, task, child, path),
            files: child?.evidence?.files ?? [],
            branch: child?.branch || undefined,
        };
    });
}

const loadTokens = new Map<string, number>();

// loadRunDigest fetches a run's digest; only the newest request per run may land, so a slow response
// cannot put back a question that was answered since.
function loadRunDigest(channelId: string, runId: string): void {
    const token = (loadTokens.get(runId) ?? 0) + 1;
    loadTokens.set(runId, token);
    fireAndForget(async () => {
        try {
            const rtn = await RpcApi.DagStatusCommand(TabRpcClient, { channelid: channelId, runid: runId });
            if (loadTokens.get(runId) !== token) {
                return;
            }
            globalStore.set(runDigestsAtom, (prev) => ({ ...prev, [runId]: rtn.digest }));
        } catch (err) {
            // the held digest stays: lanes and question owners are only ever as stale as the last load
            console.warn(`loading digest for run ${runId} failed`, err);
        }
    });
}

const QUESTION_EVENT_KINDS = new Set(["child-ask", "child-answered", "child-ask-cleared", "task-forwarded"]);

// useRunDigests keeps the digest of every run in view current while the caller is mounted.
export function useRunDigests(runs: RunInfo[]): void {
    const withDag = runs.filter((r) => r.dag != null && r.channelId);
    const versionKey = withDag.map((r) => `${r.runId}:${r.dag!.version}`).join(",");
    useEffect(() => {
        for (const r of withDag) {
            loadRunDigest(r.channelId, r.runId);
        }
    }, [versionKey]);

    const runKey = withDag.map((r) => `${r.runId}:${r.channelId}`).join(",");
    useEffect(() => {
        const unsubs = withDag.flatMap((r) => {
            const scope = WOS.makeORef("run", r.runId);
            const reload = () => loadRunDigest(r.channelId, r.runId);
            return [
                waveEventSubscribeSingle({ eventType: "dag:child-ask", scope, handler: reload }),
                waveEventSubscribeSingle({
                    eventType: "run:event",
                    scope,
                    handler: (event) => {
                        const kind = (event.data as RunEventData | undefined)?.event?.kind;
                        if (kind && QUESTION_EVENT_KINDS.has(kind)) {
                            reload();
                        }
                    },
                }),
            ];
        });
        return () => unsubs.forEach((unsub) => unsub());
    }, [runKey]);
}
