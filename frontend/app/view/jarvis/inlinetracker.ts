// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An initiative's plan as the initiative sheet draws it (initiativesheet.tsx, spec decision 7): the rows
// InitiativeDetail (inlinetrackerview.tsx) lays out, keyed under the effort's oref.
//
// Stage headers are drawn only for a staged plan; a flat plan (no chunk has a stage) lists its chunks
// bare. The sheet's cursor walks the chunk rows only: a stage header carries no content of its own.
//
// Pure: no React.

import { groupChunksByStage, nextChunk } from "./effortmodel";
import type { ChunkRowModel } from "./effortstore";
import { proposedRows, type ProposedRow } from "./proposedmodel";

export type DetailRow =
    // the plan an agent put forward, decided on the row's own buttons: the cursor skips it, as it skips a stage header
    | { kind: "proposed"; id: string; oref: string; rows: ProposedRow[] }
    | {
          kind: "facts";
          id: string;
          oref: string;
          count: string;
      }
    | {
          kind: "stage";
          id: string;
          oref: string;
          stage: string;
          fraction: string;
          done: number;
          total: number;
          collapsed: boolean;
          at: number;
          first: boolean;
      }
    | { kind: "chunk"; id: string; oref: string; row: ChunkRowModel; notes: number; next: boolean }
    // a folded stage past its preview: how many chunks the fold hides, and the key that unfolds it (the stage row's id,
    // or a flat plan's flatPlanId)
    | { kind: "more"; id: string; oref: string; stageId: string; n: number }
    | { kind: "pending"; id: string; oref: string; message: string };

export const chunkRowId = (oref: string, label: string): string => `${oref}/chunk:${label}`;
const proposedRowId = (oref: string): string => `${oref}/proposed`;
// position-keyed, because a stage is a label on a run of chunks and the same name can head two runs.
// This doubles as the key an explicit collapse/expand is stored under, so there is one identifier,
// not a row id and a separate override key that can drift apart.
export const stageRowId = (oref: string, stage: string, at: number): string => `${oref}/stage:${at}:${stage}`;

/**
 * Which stages start open when an initiative is first shown — the design's rule (design L1357): a
 * stage of two or more chunks that is entirely done starts folded; every other stage starts open. An
 * explicit toggle always wins over this default.
 */
export function stageStartsOpen(group: { rows: ChunkRowModel[] }): boolean {
    const done = group.rows.filter((r) => r.status === "done").length;
    return !(group.rows.length > 1 && done === group.rows.length);
}

// A folded stage still shows its first chunks, up to this many, then "+N more" (spec decision 7)
export const STAGE_PREVIEW_CAP = 10;

// the key a flat plan's fold is stored under: it has no stage header to own one
export const flatPlanId = (oref: string): string => `${oref}/flat`;

/**
 * One initiative's plan, its rows keyed under the effort's oref. A folded stage is not shut: it previews its first
 * STAGE_PREVIEW_CAP chunks and a `more` row counts the rest, while an unfolded stage shows every chunk. A flat plan
 * folds the same way, longer than the cap from the start; a stage starts folded by stageStartsOpen.
 *
 * `chunks` is null while the effort detail is still loading, and the plan says so rather than flickering an empty one.
 *
 * The chunks an agent proposed and nobody accepted yet are held out of the plan: they are their own group, first, and
 * are not in the stage groups, the chunk rows or the facts count (the way the summary leaves them out of done/total).
 */
export function initiativeRows(args: {
    oref: string;
    chunks: ChunkRowModel[] | null;
    noteCounts: Map<string, number>;
    stageOverrides: Record<string, boolean>;
}): DetailRow[] {
    const { oref, chunks: all, noteCounts, stageOverrides } = args;
    const out: DetailRow[] = [];
    if (all == null) {
        out.push({ kind: "pending", id: oref + "/pending", oref, message: "Loading this initiative's plan…" });
        return out;
    }
    if (all.length === 0) {
        out.push({ kind: "pending", id: oref + "/pending", oref, message: "No chunks on this initiative yet." });
        return out;
    }
    const proposed = proposedRows(all.map((c) => ({ ...c, notes: c.trail })));
    if (proposed.length > 0) {
        out.push({ kind: "proposed", id: proposedRowId(oref), oref, rows: proposed });
    }
    const chunks = all.filter((c) => c.status !== "proposed");
    if (chunks.length === 0) {
        return out;
    }
    const doneN = chunks.filter((c) => c.status === "done").length;
    out.push({
        kind: "facts",
        id: oref + "/facts",
        oref,
        count: `${chunks.length} chunk${chunks.length === 1 ? "" : "s"} · ${doneN} done`,
    });
    const next = nextChunk(chunks);
    const pushChunk = (row: ChunkRowModel) =>
        out.push({
            kind: "chunk",
            id: chunkRowId(oref, row.label),
            oref,
            row,
            notes: noteCounts.get(row.label) ?? 0,
            next: next != null && row.label === next.label,
        });
    // a folded run: its first chunks, then how many it hides
    const pushPreview = (rows: ChunkRowModel[], stageId: string) => {
        rows.slice(0, STAGE_PREVIEW_CAP).forEach(pushChunk);
        if (rows.length > STAGE_PREVIEW_CAP) {
            out.push({ kind: "more", id: stageId + "/more", oref, stageId, n: rows.length - STAGE_PREVIEW_CAP });
        }
    };
    // A plan with no staged chunk is flat. It draws no stage header: one header over the whole plan would only repeat
    // the facts row's count. A long one folds like a stage, under its own key.
    if (chunks.every((c) => c.stage === "")) {
        const id = flatPlanId(oref);
        if (stageOverrides[id] ?? false) {
            chunks.forEach(pushChunk);
        } else {
            pushPreview(chunks, id);
        }
        return out;
    }
    groupChunksByStage(chunks).forEach((group, at) => {
        const id = stageRowId(oref, group.stage, at);
        const open = stageOverrides[id] ?? stageStartsOpen(group);
        out.push({
            kind: "stage",
            id,
            oref,
            stage: group.stage,
            fraction: group.fraction,
            done: group.done,
            total: group.total,
            collapsed: !open,
            at,
            first: at === 0,
        });
        if (open) {
            group.rows.forEach(pushChunk);
        } else {
            pushPreview(group.rows, id);
        }
    });
    return out;
}

// today as a chunk's due date is spelled (YYYY-MM-DD), in local time: the day the server holds Due against
export function localDay(now: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// A chunk's due date as its row shows it, in the asking tone once the day has come while the chunk is still open
// (the rule pkg/jarvis/attention.go chunkDueItems puts it in Needs you by). The year is dropped when it is this
// one. null: no date, or the chunk is settled and its date says nothing any more.
export function chunkDueChip(
    due: string | undefined,
    status: string,
    today: string
): { text: string; come: boolean } | null {
    if (!due || (status !== "pending" && status !== "active" && status !== "blocked")) {
        return null;
    }
    const day = due.slice(0, 4) === today.slice(0, 4) ? due.slice(5) : due;
    return { text: "due " + day, come: due <= today };
}
