// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Resume-on-reopen. Agent blocks already survive quit+reopen: the tab/block/layout
// are DB-backed and ResyncController relaunches each block from its persisted cmd:args when the term
// view mounts. But that replay is a *fresh* session — it re-runs the original task prompt. As a running
// agent reports its live session via agent:status, we bake that session's resume key (`--resume <id>`,
// `codex resume <id>`, ...) into the block's persisted cmd:args, so the very same relaunch reattaches to the
// session instead of starting over.

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    resumeArgsForAgy,
    resumeArgsForClaude,
    resumeArgsForCodex,
    resumeArgsForOpencode,
    resumeArgsForPi,
    sessionIdFromTranscript,
} from "../launch";
import { naRememberFlagsAtom } from "../naflagsstore";

// oref -> resume key already baked into the block this session, to skip redundant SetMeta writes
const bakedResumeId = new Map<string, string>();

// the harnesses whose session a relaunch can reattach to
const RESUMABLE = ["claude", "codex", "opencode", "pi", "agy"];

// Pure: resume-on-reopen is gated on the user's "Remember flags" New Agent default. When that setting is off the
// user wants a clean slate, so the agent relaunches fresh on reopen; when on (the default) reopening reattaches to
// the live session.
export function shouldPersistResume(provider: string | undefined, rememberFlags: boolean): boolean {
    return RESUMABLE.includes((provider ?? "").toLowerCase()) && rememberFlags === true;
}

// a blocked run's worker stopped (the app restarted, or its process exited): it comes back through the run's
// Resume, in its own session, never through a remount replaying its launch prompt
const NO_RELAUNCH_RUN_STATUSES = ["done", "failed", "cancelled", "blocked"];

// Pure: whether ResyncController may relaunch an agent block when its terminal view mounts. A block an
// engine stamped with agent:runid belongs to a run; once that run is over or blocked, relaunching would
// resurrect a worker the run no longer expects. An unknown status (run not loadable) and a block with no
// agent:runid (hand-launched) relaunch as before.
export function shouldRelaunchWorker(
    meta: Record<string, unknown> | undefined,
    runStatus: string | undefined
): boolean {
    if (!meta?.["agent:runid"]) {
        return true;
    }
    return !NO_RELAUNCH_RUN_STATUSES.includes(runStatus ?? "");
}

function sameArgs(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Bake the live session's resume key into the block's persisted cmd:args. Fire-and-forget: any
// failure just leaves the block to relaunch fresh (today's behavior), so callers ignore the result.
export async function persistResume(
    oref: string,
    provider: string | undefined,
    transcriptPath: string | undefined,
    sessionId?: string
): Promise<void> {
    if (!shouldPersistResume(provider, globalStore.get(naRememberFlagsAtom))) {
        return;
    }
    const block = WOS.getObjectValue<Block>(oref);
    const meta = block?.meta as Record<string, unknown> | undefined;
    const cmd = meta?.["cmd"];
    if (!meta || meta["controller"] !== "cmd" || !RESUMABLE.includes(cmd as string)) {
        return;
    }
    const baseArgs = meta["agent:baseargs"] as string[] | undefined;
    if (baseArgs == null) {
        return; // launched before resume support: relaunches fresh
    }
    // pi's resume key is the full transcript path (--session takes a path, never an id), so the dedup
    // cache key is the path too — sessionIdFromTranscript must never run on a pi path.
    // agy's is the status's session id: every agy transcript is named transcript_full.jsonl, so its stem is no key.
    // codex's is too (its rollout's stem has a timestamp before the id), once the rollout it resumes from exists.
    const cacheKey =
        cmd === "pi"
            ? transcriptPath
            : cmd === "agy"
              ? sessionId
              : cmd === "codex"
                ? transcriptPath && sessionId
                : sessionIdFromTranscript(transcriptPath);
    if (!cacheKey || bakedResumeId.get(oref) === cacheKey) {
        return;
    }
    const nextArgs =
        cmd === "pi"
            ? resumeArgsForPi(transcriptPath!, baseArgs)
            : cmd === "opencode"
              ? resumeArgsForOpencode(cacheKey, baseArgs)
              : cmd === "agy"
                ? resumeArgsForAgy(cacheKey, baseArgs)
                : cmd === "codex"
                  ? resumeArgsForCodex(cacheKey, baseArgs)
                  : resumeArgsForClaude(cacheKey, baseArgs);
    const curArgs = (meta["cmd:args"] as string[] | undefined) ?? [];
    if (sameArgs(nextArgs, curArgs)) {
        bakedResumeId.set(oref, cacheKey);
        return;
    }
    try {
        await RpcApi.SetMetaCommand(TabRpcClient, { oref, meta: { "cmd:args": nextArgs } });
        await WOS.reloadWaveObject(oref); // keep the cached block fresh for the next comparison
        bakedResumeId.set(oref, cacheKey);
    } catch {
        // leave bakedResumeId unset so a later status retries
    }
}
