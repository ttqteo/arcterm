// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// To review's state (runreview.ts derives what is drawn): whether the sheet is open, the ticks, the sheet's j/k cursor,
// and what Later, Drop and Start do. Module scope, as the Brief's other stores: the Brief unmounts on every surface
// switch, and ticks lost on a glance at another surface would be worse than none.

import { globalStore } from "@/app/store/jotaiStore";
import { openLauncher, type LauncherModel } from "@/app/view/agents/launcherstore";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import { briefingStateAtom, refreshBriefing } from "./briefingstore";
import { resolveBriefCursor } from "./briefnav";
import { briefUndo, pendingDeleteKeysAtom } from "./briefundo";
import { setChunkStatus } from "./effortstore";
import {
    neighborKey,
    pruneSettled,
    reviewRowKeys,
    startPlan,
    visibleGroups,
    type ReviewGroup,
    type ReviewItem,
} from "./runreview";

export const runReviewOpenAtom = atom(false) as PrimitiveAtom<boolean>;

// the ticked rows' keys, kept until Clear: closing the sheet, a cancelled launch and a refused start leave them. A tick
// whose row is gone is simply not counted (runreview.ts tickedKeys)
export const runReviewTicksAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;

// the sheet's own j/k cursor: the page's stays where it was under the sheet
const runReviewCursorAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;

// the footer's line when Start refused; the next tick, Clear or close takes it away
export const runReviewRefusalAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// The rows whose Later or Drop went through while the Brief's snapshot still lists their chunk. briefUndo un-hides a key
// as its commit returns, a refetch earlier, so without this the row would come back for that long.
const settledAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;

/** What To review draws now: the snapshot's groups less what is hidden or settled. */
export const runReviewGroupsAtom: Atom<ReviewGroup[]> = atom((get) =>
    visibleGroups(get(briefingStateAtom).snapshot?.state.runreview, get(pendingDeleteKeysAtom), get(settledAtom))
);

/** The sheet's j/k order and the row its cursor stands on (the first, when the cursor's row is gone). */
export const runReviewNavAtom: Atom<{ keys: string[]; cursor: string | undefined }> = atom((get) => {
    const keys = reviewRowKeys(get(runReviewGroupsAtom));
    return { keys, cursor: resolveBriefCursor(keys, get(runReviewCursorAtom)) };
});

/** Called once by the Brief: each snapshot that lands drops the settled keys whose chunk it no longer lists. */
export function useRunReviewSettling(snapshotGroups: RunReviewGroup[] | undefined): void {
    useEffect(() => {
        globalStore.set(settledAtom, (prev) => pruneSettled(prev, snapshotGroups));
    }, [snapshotGroups]);
}

export function openRunReview(): void {
    globalStore.set(runReviewOpenAtom, true);
}

export function closeRunReview(): void {
    globalStore.set(runReviewOpenAtom, false);
    globalStore.set(runReviewRefusalAtom, null);
}

export function setRunReviewCursor(key: string): void {
    globalStore.set(runReviewCursorAtom, key);
}

export function toggleTick(key: string): void {
    globalStore.set(runReviewTicksAtom, (prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) {
            next.add(key);
        }
        return next;
    });
    globalStore.set(runReviewRefusalAtom, null);
}

export function clearTicks(): void {
    globalStore.set(runReviewTicksAtom, new Set<string>());
    globalStore.set(runReviewRefusalAtom, null);
}

const clip = (s: string, n = 60): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export type ReviewFold = "later" | "drop";

const FOLD_STATUS: Record<ReviewFold, string> = { later: "pending", drop: "skipped" };
const FOLD_TOAST: Record<ReviewFold, string> = { later: "Kept for later", drop: "Dropped" };

/**
 * Later keeps the chunk on its initiative (pending), Drop skips it. The row folds at once and the edit goes out when the
 * Brief's undo window closes; Undo cancels it. A commit that fails leaves its key unsettled, so the row comes back with
 * briefUndo's error toast.
 */
export function foldRow(item: ReviewItem, kind: ReviewFold): void {
    const { keys, cursor } = globalStore.get(runReviewNavAtom);
    if (!keys.includes(item.key)) {
        return;
    }
    if (cursor === item.key) {
        globalStore.set(runReviewCursorAtom, neighborKey(keys, item.key));
    }
    briefUndo.schedule([item.key], `${FOLD_TOAST[kind]} “${clip(item.label)}”`, async () => {
        await setChunkStatus("effort:" + item.effortoid, item.label, FOLD_STATUS[kind]);
        globalStore.set(settledAtom, (prev) => new Set(prev).add(item.key));
    });
}

function cursorItem(): ReviewItem | undefined {
    const { cursor } = globalStore.get(runReviewNavAtom);
    return globalStore
        .get(runReviewGroupsAtom)
        .flatMap((g) => g.items)
        .find((i) => i.key === cursor);
}

// the keys act on the row under the sheet's cursor
export function tickCursorRow(): boolean | void {
    const item = cursorItem();
    if (item == null) {
        return false;
    }
    toggleTick(item.key);
}

export function foldCursorRow(kind: ReviewFold): boolean | void {
    const item = cursorItem();
    if (item == null) {
        return false;
    }
    foldRow(item, kind);
}

/**
 * Start a run with the ticked rows: the launcher opens on a goal made from them, with the chunks to attach. Items from two
 * projects say so in the footer and change nothing; nothing ticked does nothing. The launcher opening leaves the ticks
 * where they are, and a run that started refreshes the Brief, since wavesrv moved its chunks out of To review.
 */
export function startRunReview(model: LauncherModel): void {
    const plan = startPlan(globalStore.get(runReviewGroupsAtom), globalStore.get(runReviewTicksAtom));
    if (plan.kind === "none") {
        return;
    }
    if (plan.kind === "refuse") {
        globalStore.set(runReviewRefusalAtom, plan.line);
        return;
    }
    globalStore.set(runReviewRefusalAtom, null);
    openLauncher(model, "run", { ...plan.prefill, handback: { started: () => refreshBriefing() } });
}
