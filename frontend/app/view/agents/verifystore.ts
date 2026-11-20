// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Each agent's Verify state as the cockpit holds it (spec 2026-11-20-rail-verify-design.md): wavesrv derives it from the
// scenario runs the agent's harness reported, against the agent's checkout, so a read names the block and its cwd. It is
// read when a view mounts, when the cwd changes and on each `verify:changed` event for a block a view is showing; wavesrv
// never polls and neither does this.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect } from "react";

// null until the first reading, and while wavesrv could not be asked
export const verifyStateAtom = atomFamily(
    (_blockId: string) => atom<VerifyStateData | null>(null) as PrimitiveAtom<VerifyStateData | null>
);

// the blocks a mounted view is showing, with the cwd each reads against: an event reloads only these
const watched = new Map<string, { cwd: string; refs: number }>();
// a read that lands after a newer one for the same block is dropped, so a slow read never puts back an older state
const serials = new Map<string, number>();
let logged = false;

function logOnce(what: string, e: unknown): void {
    if (!logged) {
        logged = true;
        console.error(`${what} failed`, e);
    }
}

/** Reads the block's Verify state against `cwd` into its atom. A failed read keeps the last state and logs once. */
export async function loadVerify(blockId: string, cwd: string): Promise<void> {
    const serial = (serials.get(blockId) ?? 0) + 1;
    serials.set(blockId, serial);
    try {
        const st = await RpcApi.GetVerifyStateCommand(TabRpcClient, { blockid: blockId, cwd });
        if (serials.get(blockId) === serial) {
            globalStore.set(verifyStateAtom(blockId), st ?? null);
        }
    } catch (e) {
        logOnce("GetVerifyStateCommand", e);
    }
}

let feeding = false;

/** One subscription to `verify:changed` for the whole app: an event reloads the block it names, if a view shows it.
 * Idempotent. */
export function ensureVerifyFeed(): void {
    if (feeding) {
        return;
    }
    feeding = true;
    waveEventSubscribeSingle({
        eventType: "verify:changed",
        handler: (e) => {
            const blockId = (e.data as VerifyChangedData | undefined)?.blockid;
            const w = blockId ? watched.get(blockId) : undefined;
            if (blockId && w) {
                void loadVerify(blockId, w.cwd);
            }
        },
    });
}

/** The agent's Verify state, null without a block or a cwd to read against. Loads on mount and when the cwd changes. */
export function useVerify(blockId: string | undefined, cwd: string | undefined): VerifyStateData | null {
    const st = useAtomValue(verifyStateAtom(blockId ?? ""));
    useEffect(() => {
        if (!blockId || !cwd) {
            return;
        }
        ensureVerifyFeed();
        const w = watched.get(blockId);
        watched.set(blockId, { cwd, refs: (w?.refs ?? 0) + 1 });
        void loadVerify(blockId, cwd);
        return () => {
            const now = watched.get(blockId);
            if (!now) {
                return;
            }
            if (now.refs <= 1) {
                watched.delete(blockId);
            } else {
                watched.set(blockId, { cwd: now.cwd, refs: now.refs - 1 });
            }
        };
    }, [blockId, cwd]);
    return blockId && cwd ? st : null;
}

/** Sets a scenario (empty for the not-run warning) aside, or takes it back (`undo`), then reads the state again. A failure
 * keeps the last state and logs once. */
export async function skipVerify(blockId: string, cwd: string, scenario: string, undo: boolean): Promise<void> {
    try {
        await RpcApi.VerifySkipCommand(TabRpcClient, { blockid: blockId, scenario, undo });
    } catch (e) {
        logOnce("VerifySkipCommand", e);
        return;
    }
    await loadVerify(blockId, cwd);
}
