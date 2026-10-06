// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Impure Run lifecycle: thin wrappers over the Piece 1 RPCs. CreateRun sources the active workspace id
// from the boot-resolved global atom (mirrors agentactions.ts). Approve/send-back drive the review gate;
// cancel stops the run. Phase *completion* is reported by the external ~/.claude hook, not from here.

import { atoms } from "@/app/store/global-atoms";
import { getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { sayIfOverCapacity } from "@/app/view/jarvis/petcapacity";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import type { PendingRunDraft } from "./radarmodel";
import { normalizeProfileOverrideRoute, normalizeRoute, resolveEffectiveRoute } from "./route";
import { harnessesAtom, harnessPreferenceAtom } from "./harnessstore";

// The pending Run draft handed from Radar's "Start investigation" to the Channels Run composer. Ephemeral
// (lost on reload, which is fine for a review step); cleared on explicit Start or Discard.
export const pendingRunDraftAtom = atom<PendingRunDraft | null>(null) as PrimitiveAtom<PendingRunDraft | null>;

// Run ids whose Cancel RPC is in flight. CancelRunCommand is synchronous — it returns only after each
// worker's graceful stop completes — so this real interval drives the transient "Cancelling…" button
// label until the run flips to cancelled. Frontend-only (lost on reload, which lands on the already-
// cancelled run).
export const cancellingRunIdsAtom = atom<Set<string>>(new Set<string>());

// Worker tab ids whose per-worker Stop RPC is in flight (partial-failure surface). Mirrors
// cancellingRunIdsAtom: StopRunWorkerCommand is synchronous, so this drives a transient "Stopping…" label
// on the survivor's Stop button. Frontend-only.
export const stoppingWorkerIdsAtom = atom<Set<string>>(new Set<string>());

// Stop one surviving worker of a cancelled run (partial-failure surface). workerORef is the worker's tab
// oref ("tab:<id>"). Tracks the in-flight tab id so the button reads "Stopping…"; the roster flips the
// row to idle on success, which drops it from cancelSurvivors.
export async function stopRunWorker(channelId: string, runId: string, workerORef: string): Promise<void> {
    const tabId = workerORef.startsWith("tab:") ? workerORef.slice(4) : workerORef;
    globalStore.set(stoppingWorkerIdsAtom, (prev) => new Set(prev).add(tabId));
    try {
        await RpcApi.StopRunWorkerCommand(TabRpcClient, { channelid: channelId, runid: runId, workeroref: workerORef });
    } finally {
        globalStore.set(stoppingWorkerIdsAtom, (prev) => {
            const next = new Set(prev);
            next.delete(tabId);
            return next;
        });
    }
}

// an engine launch builds a git worktree and starts a worker per lane before CreateRun returns, so the
// budget has to cover the widest run the launcher allows rather than a typical RPC round trip. The server
// derives its own handler deadline from this same field.
const CREATE_RUN_TIMEOUT_MS = 180_000;

export interface CreateRunOpts {
    mode?: string;
    deferStart?: boolean;
    radarOrigin?: { reportid: string; findingid: string; fingerprint: string };
    workerRoute?: RoutePin | null;
    orchestration?: string;
    parallelism?: number;
    planPath?: string;
    reviewerPicks?: boolean;
    reviewerRoute?: RoutePin | null;
    prototype?: string;
}

export function createRunPayload(
    workspaceId: string,
    channelId: string,
    goal: string,
    route: RoutePin,
    opts?: CreateRunOpts
): CommandCreateRunData {
    const orchestrator = opts?.mode === "orchestrator";
    return {
        channelid: channelId,
        workspaceid: workspaceId,
        goal,
        runtime: route.runtime,
        ...(route.model ? { model: route.model } : {}),
        ...(orchestrator && opts.workerRoute ? { workerroute: opts.workerRoute } : {}),
        ...(orchestrator && opts.orchestration ? { orchestration: opts.orchestration } : {}),
        ...(orchestrator && opts.parallelism ? { parallelism: opts.parallelism } : {}),
        ...(orchestrator && opts.planPath ? { planpath: opts.planPath } : {}),
        // false is sent too: unset means "the profile's", which is not what a launcher showing false chose
        ...(orchestrator && opts.reviewerPicks != null ? { reviewerpicks: opts.reviewerPicks } : {}),
        ...(orchestrator && opts.reviewerRoute ? { reviewerroute: opts.reviewerRoute } : {}),
        ...(orchestrator && opts.prototype ? { prototype: opts.prototype } : {}),
        mode: opts?.mode,
        deferstart: opts?.deferStart,
        ...(opts?.radarOrigin ? { radarorigin: opts.radarOrigin } : {}),
    };
}

export async function createRun(channelId: string, goal: string, route: RoutePin, opts?: CreateRunOpts): Promise<Run> {
    if (!route.runtime) throw new Error("Choose a route");
    const workspaceId = globalStore.get(atoms.workspaceId);
    const rtn = await RpcApi.CreateRunCommand(
        TabRpcClient,
        createRunPayload(workspaceId, channelId, goal, route, opts),
        { timeout: CREATE_RUN_TIMEOUT_MS }
    );
    if (rtn?.run == null) {
        // the launcher opens whatever comes back, and a null here surfaced as a TypeError about `id`
        throw new Error("creating the run returned no run");
    }
    if (opts?.mode === "orchestrator" && opts.parallelism) {
        sayIfOverCapacity({ picked: opts.parallelism, extra: opts.parallelism, live: false });
    }
    return rtn.run;
}

// Restart a failed phase's stopped worker in its own session and tab; the backend refuses, with the reason,
// a run it cannot resume.
export async function resumeRun(channelId: string, runId: string, phaseIdx: number): Promise<void> {
    await RpcApi.AdvanceRunCommand(TabRpcClient, {
        channelid: channelId,
        runid: runId,
        phaseidx: phaseIdx,
        action: "resume",
    });
}

export async function cancelRun(channelId: string, runId: string): Promise<void> {
    globalStore.set(cancellingRunIdsAtom, (prev) => new Set(prev).add(runId));
    try {
        await RpcApi.CancelRunCommand(TabRpcClient, { channelid: channelId, runid: runId });
    } finally {
        globalStore.set(cancellingRunIdsAtom, (prev) => {
            const next = new Set(prev);
            next.delete(runId);
            return next;
        });
    }
}

export type FinalEndOutcome = "unverified" | "failed";

// as long as `wsh runs` waits on a cancel (runsCancelTimeoutMs): stopping the verifier stops its worker
const END_FINAL_TIMEOUT_MS = 60_000;

// endFinalStage ends a run's running final stage on the human's word; the engine records the reason on the
// stage.
export function endFinalStage(
    channelId: string,
    runId: string,
    outcome: FinalEndOutcome,
    reason: string
): Promise<void> {
    return RpcApi.DagActionCommand(
        TabRpcClient,
        { channelid: channelId, runid: runId, taskid: "", action: `final-end-${outcome}`, notes: reason },
        { timeout: END_FINAL_TIMEOUT_MS }
    );
}

// Cancel a run, confirming first when it has live workers (goal: never silently stop running agents).
// liveCount 0 (e.g. the worker already exited — the "blocked · worker exited" card) cancels directly.
// Copy reassures that completed work is kept: the backend stops the processes but keeps worker tabs,
// transcripts, and completed phases.
export function confirmCancelRun(channelId: string, runId: string, liveCount: number): void {
    const doCancel = () => fireAndForget(() => cancelRun(channelId, runId));
    if (liveCount <= 0) {
        doCancel();
        return;
    }
    const n = liveCount === 1 ? "1 running worker" : `${liveCount} running workers`;
    modalsModel.pushModal("ConfirmModal", {
        title: "Cancel run",
        message: `Stop ${n} and cancel this run? Completed phases, transcripts, and artifacts are kept.`,
        confirmLabel: "Cancel run",
        cancelLabel: "Keep running",
        destructive: true,
        onConfirm: doCancel,
    });
}

export async function getJarvisProfile(channelId: string): Promise<CommandGetJarvisProfileRtnData> {
    return RpcApi.GetJarvisProfileCommand(TabRpcClient, { channelid: channelId });
}

// The resolved (global + channel override) Jarvis profile, keyed by channel id. Module scope so ⚙'s Save
// refreshes every reader at once: a Stage-local copy went stale the moment the drawer wrote, and the
// composer went on labelling the run strategy the user had just replaced.
export const resolvedProfileAtom = atom<Record<string, JarvisProfile>>({}) as PrimitiveAtom<
    Record<string, JarvisProfile>
>;

export const channelOverrideAtom = atom<Record<string, ProfileOverride>>({}) as PrimitiveAtom<
    Record<string, ProfileOverride>
>;

export function loadResolvedProfile(channelId: string): void {
    if (globalStore.get(resolvedProfileAtom)[channelId] != null) {
        return;
    }
    fireAndForget(() => refreshResolvedProfile(channelId));
}

export function cacheJarvisProfile(channelId: string, response: CommandGetJarvisProfileRtnData): void {
    globalStore.set(channelOverrideAtom, { ...globalStore.get(channelOverrideAtom), [channelId]: response.override ?? {} });
    if (response.resolved != null) {
        globalStore.set(resolvedProfileAtom, { ...globalStore.get(resolvedProfileAtom), [channelId]: response.resolved });
    }
}

export async function refreshResolvedProfile(channelId: string): Promise<void> {
    const r = await getJarvisProfile(channelId);
    cacheJarvisProfile(channelId, r);
}

// A global-profile write re-resolves every channel, not just the one the drawer was opened on.
export function clearResolvedProfiles(): void {
    globalStore.set(resolvedProfileAtom, {});
    globalStore.set(channelOverrideAtom, {});
}

export async function resolveChannelLaunchRoute(channelId: string): Promise<RoutePin> {
    const response = await getJarvisProfile(channelId);
    cacheJarvisProfile(channelId, response);
    const settingsRuntime = (globalStore.get(getSettingsKeyAtom("harness:preferredruntime")) as string) ?? "";
    const settingsModel = (globalStore.get(getSettingsKeyAtom("harness:preferredmodel")) as string) ?? "";
    const pref = globalStore.get(harnessPreferenceAtom);
    const settings = pref.route ?? normalizeRoute(settingsRuntime, settingsModel);
    const effective = resolveEffectiveRoute({
        settings,
        channel: response.override?.route ?? null,
        harnesses: globalStore.get(harnessesAtom),
    });
    if (effective == null || effective.capability == null) {
        throw new Error("Selected route is unavailable");
    }
    return effective.pin;
}

export async function setChannelProfile(channelId: string, override: ProfileOverride): Promise<void> {
    await RpcApi.SetChannelProfileCommand(TabRpcClient, {
        channelid: channelId,
        override: normalizeProfileOverrideRoute(override),
    });
}

export async function getGlobalProfile(): Promise<JarvisProfile> {
    return RpcApi.GetGlobalProfileCommand(TabRpcClient);
}

export async function setGlobalProfile(profile: JarvisProfile): Promise<void> {
    await RpcApi.SetGlobalProfileCommand(TabRpcClient, { profile });
}
