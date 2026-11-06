// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Plan editing for one initiative (spec decision 7: it stays, inside the sheet). `buildTrackerEdits` is the pure half:
// the TrackerEdits callbacks inlinetrackerview.tsx's plan calls, each a write through effortstore.ts with its Undo
// (briefundo.ts), positions translated to the server's list (which still holds the proposed chunks the plan draws
// apart). `useInitiativeEdits` wraps it for a view: the effort from the detail cache, the mutate error shown rather
// than swallowed, the title's rename draft, the Edit details form, and the chunk open in the sheet.
//
// The Brief's in-place tracker builds its own copy of these callbacks until Task 8 deletes it; this is the one builder
// the sheet and the review pass use.

import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { briefUndo, chunkKey, effortKey, pendingDeleteKeysAtom } from "./briefundo";
import { stageOptions } from "./effortmodel";
import {
    acceptProposed,
    addChunkAt,
    deleteEffort,
    dropProposed,
    effortChunkRows,
    effortDetailAtom,
    moveChunk,
    moveChunkToStage,
    removeChunks,
    renameChunk,
    renameEffort,
    setChunkStage,
    setChunkStatus,
    setEffortStatus,
    unacceptProposed,
    unarchiveEffort,
    type ChunkRowModel,
} from "./effortstore";
import { initiativeSheetAtom, showInitiativeActivity } from "./initiativesheetstore";
import type { TrackerEdits } from "./inlinetrackerview";
import { briefSheetOpenAtom } from "./jarvisstore";
import { clearSubject } from "./jarvissubjectstore";
import { canRemove, chunkRef, moveTarget, stageMoveTarget, stageRunLabels } from "./trackeredit";

export type EditsDeps = {
    oref: string; // "effort:<oid>"
    effort: Effort;
    // the undo window's keys (briefundo.ts): a chunk waiting out its delete still counts toward "keeps one chunk"
    pendingDeletes: Set<string>;
    // every write goes through here, so a rejected op is shown rather than leaving the row unchanged unexplained
    run: (fn: () => Promise<unknown>) => void;
    fail: (message: string) => void;
    onRename: (title: string) => void;
    onDetails: () => void;
    onActivity: (e: React.MouseEvent) => void;
    // the initiative is about to go: its view closes before the delete waits out its undo window
    onDeleted: () => void;
};

export function buildTrackerEdits(deps: EditsDeps): TrackerEdits {
    const { oref, effort, pendingDeletes, run } = deps;
    // index math runs on the server's list, pending deletes included: the server still has them
    const chunks = effortChunkRows(effort);
    // The plan as the tracker draws it. The chunks an agent proposed are a group of their own, outside its stage runs,
    // its cursor and its positions; refs sent to the server still run over `chunks`, which has them all.
    const planOnly = chunks.filter((c) => c.status !== "proposed");
    const indexOf = (label: string) => chunks.findIndex((c) => c.label === label);
    const ref = (label: string) => chunkRef(chunks, label);
    // A position the plan computes (moveTarget, stageMoveTarget, a run's end), as the server counts it: the proposed
    // chunks sit among the real ones there. The chunk now at that place in the drawn plan marks it.
    const serverAt = (at: number) => {
        const there = planOnly[at - 1];
        return there != null ? indexOf(there.label) + 1 : at;
    };
    const afterRun = (runAt: number) => {
        const labels = stageRunLabels(planOnly, runAt);
        const last = labels[labels.length - 1];
        return last != null ? indexOf(last) + 2 : undefined;
    };
    const scheduleRemove = (labels: string[], text: string) => {
        const pending = chunks.filter((c) => pendingDeletes.has(chunkKey(oref, c.label))).map((c) => c.label);
        if (!canRemove(chunks, [...pending, ...labels])) {
            deps.fail("An initiative keeps at least one chunk.");
            return;
        }
        briefUndo.schedule(
            labels.map((l) => chunkKey(oref, l)),
            text,
            () => removeChunks(oref, chunks, labels)
        );
    };
    const status = effort.status;
    return {
        oid: oref.replace(/^effort:/, ""),
        title: effort.title,
        effortStatus: status,
        total: chunks.length,
        stages: stageOptions(chunks),
        onSetStatus: (label, next) => {
            const prev = chunks.find((c) => c.label === label)?.status ?? "pending";
            run(() => setChunkStatus(oref, ref(label), next));
            briefUndo.notify(`Marked “${label}” ${next}`, () => run(() => setChunkStatus(oref, ref(label), prev)));
        },
        onRenameChunk: (label, next) => run(() => renameChunk(oref, chunks, label, next)),
        // Accept is immediate and its Undo puts the chunks back as proposed. Drop waits out the undo window like a
        // deleted chunk, because removing a chunk takes its notes with it and an op sent afterwards cannot bring them
        // back. Neither goes through scheduleRemove's last-chunk guard: the server lets the last proposed one go.
        onAcceptProposed: (labels) => {
            run(() => acceptProposed(oref, labels.map(ref)));
            briefUndo.notify(
                labels.length === 1 ? `Accepted “${labels[0]}”` : `Accepted ${labels.length} proposed chunks`,
                () =>
                    run(async () => {
                        for (const label of labels) {
                            await unacceptProposed(oref, ref(label));
                        }
                    })
            );
        },
        onDropProposed: (labels) =>
            briefUndo.schedule(
                labels.map((l) => chunkKey(oref, l)),
                labels.length === 1 ? `Dropped “${labels[0]}”` : `Dropped ${labels.length} proposed chunks`,
                () => dropProposed(oref, chunks, labels)
            ),
        canMove: (label, dir) => moveTarget(planOnly, label, dir) != null,
        onMoveChunk: (label, dir) => {
            const target = moveTarget(planOnly, label, dir);
            if (target == null) {
                return;
            }
            const at = serverAt(target);
            const back = indexOf(label) + 1;
            run(() => moveChunk(oref, chunks, label, at));
            briefUndo.notify(`Moved “${label}” ${dir}`, () => run(() => moveChunk(oref, chunks, label, back)));
        },
        onMoveToStage: (label, stage) => {
            const target = stageMoveTarget(planOnly, label, stage);
            const prev = chunks.find((c) => c.label === label);
            if (target == null || prev == null) {
                return;
            }
            const at = serverAt(target);
            const back = indexOf(label) + 1;
            run(() => moveChunkToStage(oref, chunks, label, stage, at));
            briefUndo.notify(`Moved to ${stage || "unstaged"}`, () =>
                run(() => moveChunkToStage(oref, chunks, label, prev.stage, back))
            );
        },
        onDeleteChunk: (label) => scheduleRemove([label], `Deleted “${label}”`),
        onRenameStage: (at, next) => run(() => setChunkStage(oref, stageRunLabels(planOnly, at).map(ref), next)),
        onDeleteStage: (at) => {
            const labels = stageRunLabels(planOnly, at);
            const name = chunks.find((c) => c.label === labels[0])?.stage || "unstaged";
            scheduleRemove(labels, `Deleted stage “${name}” · ${labels.length} chunk${labels.length === 1 ? "" : "s"}`);
        },
        onAddChunk: (label, stage, runAt) =>
            run(() => addChunkAt(oref, label, stage, runAt != null ? afterRun(runAt) : undefined)),
        onRename: deps.onRename,
        onDetails: deps.onDetails,
        onActivity: deps.onActivity,
        onTogglePause: () => {
            const next = status === "paused" ? "active" : "paused";
            run(() => setEffortStatus(oref, next));
            briefUndo.notify(next === "paused" ? "Paused" : "Resumed", () => run(() => setEffortStatus(oref, status)));
        },
        onArchive: () => {
            run(() => setEffortStatus(oref, "archived"));
            briefUndo.notify(`Archived “${effort.title}”`, () => run(() => unarchiveEffort(oref)));
        },
        onUnarchive: () => run(() => unarchiveEffort(oref)),
        onDelete: () => {
            deps.onDeleted();
            briefUndo.schedule([effortKey(oref)], `Deleted “${effort.title}”`, () => deleteEffort(oref));
        },
    };
}

// the Brief's sheet closed, as its × does (without the return to the surface the sheet was opened from)
function closeSheet(): void {
    globalStore.set(briefSheetOpenAtom, false);
    clearSubject();
}

export type InitiativeEditsState = {
    effort: Effort | null;
    edits: TrackerEdits | null;
    // the server's list, proposed chunks and chunks waiting out a delete included
    planChunks: ChunkRowModel[];
    mutateError: string | null;
    // the title's rename draft, null while it is not being renamed; commitRename writes it
    renaming: string | null;
    setRenaming: (draft: string | null) => void;
    commitRename: () => void;
    detailsOpen: boolean;
    setDetailsOpen: (open: boolean) => void;
    // the chunk open in the sheet (initiativeSheetAtom.chunk), resolved against the plan; null when none is or it went
    selectedChunk: ChunkRowModel | null;
    run: (fn: () => Promise<unknown>) => void;
};

/**
 * The plan's editing for the initiative `oref` (null: none open). `opts` replaces what Activity and Delete do: the
 * sheet's defaults show the Activity feed in its body and close the sheet.
 */
export function useInitiativeEdits(
    oref: string | null,
    opts: { onActivity?: (e: React.MouseEvent) => void; onDeleted?: () => void } = {}
): InitiativeEditsState {
    const cache = useAtomValue(effortDetailAtom);
    const pendingDeletes = useAtomValue(pendingDeleteKeysAtom);
    const sheet = useAtomValue(initiativeSheetAtom);
    const effort = oref != null ? (cache.get(oref) ?? null) : null;
    const [mutateError, setMutateError] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const run = useCallback((fn: () => Promise<unknown>) => {
        setMutateError(null);
        fn().catch((e) => setMutateError(e instanceof Error ? e.message : String(e)));
    }, []);
    const { onActivity, onDeleted } = opts;
    const edits = useMemo(
        () =>
            oref != null && effort != null
                ? buildTrackerEdits({
                      oref,
                      effort,
                      pendingDeletes,
                      run,
                      fail: setMutateError,
                      onRename: (title) => setRenaming(title),
                      onDetails: () => setDetailsOpen(true),
                      onActivity: onActivity ?? (() => showInitiativeActivity()),
                      onDeleted: onDeleted ?? closeSheet,
                  })
                : null,
        [oref, effort, pendingDeletes, run, onActivity, onDeleted]
    );
    const planChunks = useMemo(() => (effort != null ? effortChunkRows(effort) : []), [effort]);
    const commitRename = useCallback(() => {
        const t = renaming?.trim() ?? "";
        setRenaming(null);
        if (oref != null && t !== "" && t !== effort?.title) {
            run(() => renameEffort(oref, t));
        }
    }, [renaming, oref, effort, run]);
    const selectedChunk =
        sheet.chunk != null
            ? (planChunks.find((c) => c.label === sheet.chunk && !pendingDeletes.has(chunkKey(oref ?? "", c.label))) ??
              null)
            : null;
    return {
        effort,
        edits,
        planChunks,
        mutateError,
        renaming,
        setRenaming,
        commitRename,
        detailsOpen,
        setDetailsOpen,
        selectedChunk,
        run,
    };
}
