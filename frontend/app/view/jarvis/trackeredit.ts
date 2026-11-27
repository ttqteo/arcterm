// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The index math behind editing an initiative's plan in place. Every position here is the one the
// server's effort ops take: `at` is 1-based, and moveChunk removes the chunk before inserting it, so a
// target is counted in the list WITHOUT the moving chunk.
//
// A stage is a label on a run of consecutive chunks, not a container, and the same name can head two
// runs — so a run is addressed by its position (`at`, the same key stageRowId uses), never by name.
//
// Pure: no React.

import { planChunks } from "./laterchunk";

export type EditChunk = { label: string; stage: string; later?: boolean };
export type StageRun = { at: number; stage: string; start: number; end: number };

export function stageRuns(chunks: EditChunk[]): StageRun[] {
    const runs: StageRun[] = [];
    chunks.forEach((c, i) => {
        const last = runs[runs.length - 1];
        if (last != null && last.stage === c.stage) {
            last.end = i + 1;
            return;
        }
        runs.push({ at: runs.length, stage: c.stage, start: i, end: i + 1 });
    });
    return runs;
}

const runOf = (runs: StageRun[], idx: number) => runs.find((r) => idx >= r.start && idx < r.end);

// up/down stays inside the chunk's run: crossing a boundary would silently change its stage
export function moveTarget(chunks: EditChunk[], label: string, dir: "up" | "down"): number | null {
    const idx = chunks.findIndex((c) => c.label === label);
    const run = runOf(stageRuns(chunks), idx);
    if (idx < 0 || run == null) {
        return null;
    }
    if (dir === "up") {
        return idx === run.start ? null : idx;
    }
    return idx === run.end - 1 ? null : idx + 2;
}

export function stageMoveTarget(chunks: EditChunk[], label: string, stage: string): number | null {
    const idx = chunks.findIndex((c) => c.label === label);
    if (idx < 0 || chunks[idx].stage === stage) {
        return null;
    }
    // the run is found in the plan as shown: dropping the chunk first could merge two runs around it
    const run = stageRuns(chunks).find((r) => r.stage === stage);
    const end = run != null ? run.end : chunks.length;
    return (idx < end ? end - 1 : end) + 1;
}

export function stageRunLabels(chunks: EditChunk[], at: number): string[] {
    const run = stageRuns(chunks)[at];
    return run == null ? [] : chunks.slice(run.start, run.end).map((c) => c.label);
}

export function appendInStageAt(chunks: EditChunk[], at: number): number {
    const run = stageRuns(chunks)[at];
    return (run != null ? run.end : chunks.length) + 1;
}

// the server only refuses removing the LAST chunk as seen before the batch, so a batch that removes
// every chunk would pass it and leave an empty initiative. A chunk saved for later goes freely, even alone (the server
// lets it, so Move to… works from an initiative that holds just the saved item), and does not stand in for the plan:
// removing plan chunks still leaves at least one plan chunk.
export function canRemove(chunks: EditChunk[], labels: string[]): boolean {
    const gone = new Set(labels);
    const plan = planChunks(chunks);
    return !plan.some((c) => gone.has(c.label)) || plan.some((c) => !gone.has(c.label));
}

// ResolveChunkIndex reads an all-digit ref as a 1-based index, so such a label goes as "=<label>", which the server
// reads as a label only: a position worked out here can name another chunk by the time the edit commits (one removed
// out of band in between). A label that starts with "=" takes the prefix too, so the server strips only that.
export function chunkRef(_chunks: EditChunk[], label: string): string {
    return /^\d+$/.test(label) || label.startsWith("=") ? "=" + label : label;
}

export function stepChunk(
    chunks: EditChunk[],
    label: string,
    dir: "prev" | "next"
): { label: string; runAt: number } | null {
    const idx = chunks.findIndex((c) => c.label === label);
    const to = idx < 0 ? -1 : dir === "prev" ? idx - 1 : idx + 1;
    if (to < 0 || to >= chunks.length) {
        return null;
    }
    const run = runOf(stageRuns(chunks), to);
    return { label: chunks[to].label, runAt: run?.at ?? 0 };
}
