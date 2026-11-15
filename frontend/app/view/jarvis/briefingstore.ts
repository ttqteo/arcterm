// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Briefing load lifecycle: one RPC per entry, a validated persisted visit cursor, generation-guarded
// snapshot writes, the launch-local landing guard, and the Brief composer's draft.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { BRIEFING_FIXTURES, type BriefingFixtureName } from "./briefingfixtures";
import { SEVEN_DAYS_MS } from "./briefingmodel";

export interface BriefingSnapshot {
    state: WorkState;
    queryStartedAt: number;
    actualCursor: number;
    complete: boolean;
}

export interface BriefingLoadState {
    snapshot: BriefingSnapshot | null;
    loading: boolean;
    error: string | null;
}

// The visit cursor: browser-profile-wide and all-project (Briefing ignores Space scope by design).
// getOnInit is load-bearing — the boot landing reads the stored value in the same tick it decides.
export const briefingCursorAtom = atomWithStorage<number | null>("jarvis.briefing.lastseen", null, undefined, {
    getOnInit: true,
});

const fetchedBriefingStateAtom = atom<BriefingLoadState>({
    snapshot: null,
    loading: false,
    error: null,
}) as PrimitiveAtom<BriefingLoadState>;

// DEV/CDP fixture seam (mirrors jarvisstore's activeFixtureAtom): a selected fixture replaces the
// fetched load state. Compiled out of production builds.
const DEV_FIXTURES = import.meta.env.DEV;
export const briefingFixtureAtom = atom<BriefingFixtureName | null>(null) as PrimitiveAtom<BriefingFixtureName | null>;

export const briefingStateAtom: Atom<BriefingLoadState> = atom((get) => {
    if (DEV_FIXTURES) {
        const fixture = get(briefingFixtureAtom);
        if (fixture != null) {
            return BRIEFING_FIXTURES[fixture].load;
        }
    }
    return get(fetchedBriefingStateAtom);
});

// FetchWorkState walks every ledger leg (channel runs, transcript scans, vault) and routinely takes
// well past the server's 5s default RPC budget (measured ~14s on a warm corpus) — the same EC-TIME
// trap the ask CLI raised its timeout for. Raised here so the briefing landing actually loads.
export const stateRpcTimeoutMs = 180_000;

// every load gets a generation; only the latest may write the snapshot. Guards React remounts and
// rapid subject changes without a backend write or lock.
let loadGeneration = 0;

function validCursor(v: unknown, at: number): v is number {
    return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= at;
}

export async function loadBriefingAsync(): Promise<void> {
    const gen = ++loadGeneration;
    const queryStartedAt = Date.now();
    const sevenDaysAgo = queryStartedAt - SEVEN_DAYS_MS;
    const stored = globalStore.get(briefingCursorAtom);
    const actualCursor = validCursor(stored, queryStartedAt) ? stored : sevenDaysAgo;
    // min() serves both requirements in one request: the client filters Delta back to actualCursor,
    // while the response still carries the stable seven-day Shipped window when the cursor is newer.
    const fetchSince = Math.min(actualCursor, sevenDaysAgo);
    globalStore.set(fetchedBriefingStateAtom, {
        snapshot: globalStore.get(fetchedBriefingStateAtom).snapshot,
        loading: true,
        error: null,
    });
    try {
        const rtn = await RpcApi.JarvisStateCommand(
            TabRpcClient,
            { project: "", sincems: fetchSince },
            { timeout: stateRpcTimeoutMs }
        );
        if (gen !== loadGeneration) {
            return; // superseded
        }
        const state = rtn.state;
        const complete = state.sources.runs === true && state.sources.dossiers === true;
        globalStore.set(briefingAckAtom, "waiting");
        globalStore.set(fetchedBriefingStateAtom, {
            snapshot: { state, queryStartedAt, actualCursor, complete },
            loading: false,
            error: null,
        });
    } catch (e) {
        if (gen !== loadGeneration) {
            return;
        }
        // keep any previous snapshot visible; the view renders the failure banner from `error`.
        globalStore.set(fetchedBriefingStateAtom, {
            snapshot: globalStore.get(fetchedBriefingStateAtom).snapshot,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
        });
    }
}

export function loadBriefing(): void {
    void loadBriefingAsync();
}

// For a reader outside the Brief (Sprout's review line): the briefing loaded once, when no snapshot is in and none is
// on its way. A load never advances the visit cursor (that waits on the Brief's dwell, ackBriefingVisit), so loading
// it here leaves the Brief's "since you looked" as it was.
export function loadBriefingIfNone(): void {
    const st = globalStore.get(fetchedBriefingStateAtom);
    if (st.snapshot == null && !st.loading) {
        loadBriefing();
    }
}

// --- visit acknowledgment (dwell-based; the safe consequence of skipping it is repetition) --------
export type BriefingAckState = "idle" | "waiting" | "saved" | "failed";
export const briefingAckAtom = atom<BriefingAckState>("idle") as PrimitiveAtom<BriefingAckState>;

// Advances the visit cursor to the current snapshot's query start. Called by the view after a short
// dwell on loaded content, not at load completion — a glance-and-close must not mark the delta seen.
export function ackBriefingVisit(): void {
    const st = globalStore.get(fetchedBriefingStateAtom);
    if (st.snapshot == null || !st.snapshot.complete || st.loading) {
        return;
    }
    try {
        // re-read before the write: a slower second window must not regress a cursor another window
        // already advanced past its own query start. Only positivity is re-checked — a peer's cursor
        // may legitimately exceed this snapshot's queryStartedAt.
        const cur = globalStore.get(briefingCursorAtom);
        const curValid = typeof cur === "number" && Number.isFinite(cur) && cur > 0;
        globalStore.set(briefingCursorAtom, Math.max(curValid ? cur : 0, st.snapshot.queryStartedAt));
        globalStore.set(briefingAckAtom, "saved");
    } catch {
        // keep the accepted snapshot and say the marker was not saved; repetition beats a lost event.
        globalStore.set(briefingAckAtom, "failed");
    }
}

// "mark seen" (design L287, L1794): the visit cursor jumps to this snapshot's query start now instead of
// after the dwell, and the Brief re-reads so Behind you empties. Returns the undo.
export function markBriefingSeen(): () => void {
    const prev = globalStore.get(briefingCursorAtom);
    const st = globalStore.get(fetchedBriefingStateAtom);
    if (st.snapshot == null) {
        return () => {};
    }
    globalStore.set(briefingCursorAtom, st.snapshot.queryStartedAt);
    loadBriefing();
    return () => {
        globalStore.set(briefingCursorAtom, prev);
        loadBriefing();
    };
}

// Refresh uses the same load and cursor rules as reopening Briefing.
export function refreshBriefing(): void {
    loadBriefing();
}

// --- launch-local landing guard (once per Wave frontend load, survives surface unmounts) ----------
let landingConsumed = false;
export function briefingLandingConsumed(): boolean {
    return landingConsumed;
}
export function consumeBriefingLanding(): void {
    landingConsumed = true;
}

// the Brief composer's draft. Module scope so it survives the surface unmounting on a nav switch.
export const briefDraftAtom = atom("");

// The once-per-launch guard on the Brief's subject restore. Session-scoped: the Brief unmounts on every nav
// switch, so a restore keyed to the surface would re-run — and re-open a peek the user had already closed —
// every time they came back.
export const briefRestoreConsumedAtom = atom(false) as PrimitiveAtom<boolean>;
