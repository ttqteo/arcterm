// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An expanded initiative's plan, flattened into the Brief's own row list.
//
// The Brief has one cursor: briefsurface publishes `navIds` to useSurfaceListNav, and j/k walks it.
// An inline tracker that kept its own ↑/↓ would be a second cursor fighting the first, so the chunk
// rows of an expanded initiative are spliced INTO that list instead — j/k falls into the plan and
// back out of it, and Enter on a chunk opens its notes the same way Enter on a line opens its target.
//
// Stage headers are drawn only for a staged plan; a flat plan (no chunk has a stage) lists its chunks
// bare. They render but are not navigable: they carry no content of their own, and stopping the
// cursor on them would put two dead rows between every group of chunks.
//
// Pure: no React.

import type { BriefLine } from "./briefrows";
import { groupChunksByStage, nextChunk } from "./effortmodel";
import type { ChunkRowModel } from "./effortstore";
import { proposedRows, type ProposedRow } from "./proposedmodel";

export type TrackerRow =
    | { kind: "line"; id: string; line: BriefLine; expanded: boolean }
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
    // the sheet's folded stage past its preview (initiativeRows): how many chunks the fold hides, and the key that
    // unfolds it (the stage row's id, or a flat plan's flatPlanId)
    | { kind: "more"; id: string; oref: string; stageId: string; n: number }
    | { kind: "pending"; id: string; oref: string; message: string };

// The rows that make up an expanded initiative's block — every TrackerRow except the Brief lines the
// plan is spliced between. InitiativeDetail draws exactly these.
export type DetailRow = Exclude<TrackerRow, { kind: "line" }>;

// A line is expandable when it stands for an effort. Only the "Initiatives" region builds those from
// initiativeLine; a Behind-you digest names the same effort but is a day's summary, not the object.
export function expandableORef(line: BriefLine): string | null {
    if (!line.id.startsWith("initiatives:")) {
        return null;
    }
    const target = line.target;
    return target != null && "oref" in target && target.oref.startsWith("effort:") ? target.oref : null;
}

export const chunkRowId = (lineId: string, label: string): string => `${lineId}/chunk:${label}`;
const proposedRowId = (lineId: string): string => `${lineId}/proposed`;
// position-keyed, because a stage is a label on a run of chunks and the same name can head two runs.
// This doubles as the key an explicit collapse/expand is stored under, so there is one identifier,
// not a row id and a separate override key that can drift apart.
export const stageRowId = (lineId: string, stage: string, at: number): string => `${lineId}/stage:${at}:${stage}`;

/**
 * Which stages start open when an initiative is first expanded — the design's rule (design L1357): a
 * stage of two or more chunks that is entirely done starts folded; every other stage starts open. An
 * explicit toggle always wins over this default.
 */
export function stageStartsOpen(group: { rows: ChunkRowModel[] }): boolean {
    const done = group.rows.filter((r) => r.status === "done").length;
    return !(group.rows.length > 1 && done === group.rows.length);
}

/**
 * A plan with no staged chunk is flat. It draws no stage header: one header over the whole plan would
 * only repeat the initiative row's own fraction, and its folding would hide the plan the row just opened.
 */
export function isFlatPlan(chunks: { stage: string }[]): boolean {
    return chunks.every((c) => c.stage === "");
}

/**
 * The Brief's visible lines with the open initiative's plan spliced in after its row (planRows says how the plan
 * reads). A folded stage here shows its header only.
 */
export function trackerRows(args: {
    lines: BriefLine[];
    openLineId: string | null;
    chunks: ChunkRowModel[] | null;
    noteCounts: Map<string, number>;
    stageOverrides: Record<string, boolean>;
}): TrackerRow[] {
    const { lines, openLineId, noteCounts, stageOverrides } = args;
    const out: TrackerRow[] = [];
    for (const line of lines) {
        const oref = expandableORef(line);
        const expanded = oref != null && line.id === openLineId;
        out.push({ kind: "line", id: line.id, line, expanded });
        if (!expanded || oref == null) {
            continue;
        }
        out.push(...planRows(line.id, oref, args.chunks, noteCounts, stageOverrides, false));
    }
    return out;
}

// A folded stage in the sheet still shows its first chunks, up to this many, then "+N more" (spec decision 7)
export const STAGE_PREVIEW_CAP = 10;

// the key a flat plan's fold is stored under: it has no stage header to own one
export const flatPlanId = (base: string): string => `${base}/flat`;

/**
 * One initiative's plan as the sheet draws it (spec decision 7), its rows keyed under the effort's oref. The rows the
 * Brief's in-place tracker splices under a line (trackerRows), but a folded stage is not shut: it previews its first
 * STAGE_PREVIEW_CAP chunks and a `more` row counts the rest, while an unfolded stage shows every chunk. A flat plan
 * folds the same way, longer than the cap from the start; a stage starts folded by stageStartsOpen.
 */
export function initiativeRows(args: {
    oref: string;
    chunks: ChunkRowModel[] | null;
    noteCounts: Map<string, number>;
    stageOverrides: Record<string, boolean>;
}): DetailRow[] {
    return planRows(args.oref, args.oref, args.chunks, args.noteCounts, args.stageOverrides, true) as DetailRow[];
}

/**
 * The plan's rows under `base` (a Brief line's id, or the effort's oref in the sheet).
 *
 * `chunks` is null while the effort detail is still loading — the row still expands, so the click lands somewhere,
 * and says so rather than flickering an empty plan.
 *
 * The chunks an agent proposed and nobody accepted yet are held out of the plan: they are their own group, first, and
 * are not in the stage groups, the chunk rows or the facts count (the way the summary leaves them out of done/total).
 *
 * `preview`: a folded stage shows its first STAGE_PREVIEW_CAP chunks and a `more` row (the sheet), instead of none
 * (the Brief's in-place tracker).
 */
function planRows(
    base: string,
    oref: string,
    all: ChunkRowModel[] | null,
    noteCounts: Map<string, number>,
    stageOverrides: Record<string, boolean>,
    preview: boolean
): TrackerRow[] {
    const out: TrackerRow[] = [];
    if (all == null) {
        out.push({ kind: "pending", id: base + "/pending", oref, message: "Loading this initiative's plan…" });
        return out;
    }
    if (all.length === 0) {
        out.push({ kind: "pending", id: base + "/pending", oref, message: "No chunks on this initiative yet." });
        return out;
    }
    const proposed = proposedRows(all.map((c) => ({ ...c, notes: c.trail })));
    if (proposed.length > 0) {
        out.push({ kind: "proposed", id: proposedRowId(base), oref, rows: proposed });
    }
    const chunks = all.filter((c) => c.status !== "proposed");
    if (chunks.length === 0) {
        return out;
    }
    const doneN = chunks.filter((c) => c.status === "done").length;
    out.push({
        kind: "facts",
        id: base + "/facts",
        oref,
        count: `${chunks.length} chunk${chunks.length === 1 ? "" : "s"} · ${doneN} done`,
    });
    const next = nextChunk(chunks);
    const pushChunk = (row: ChunkRowModel) =>
        out.push({
            kind: "chunk",
            id: chunkRowId(base, row.label),
            oref,
            row,
            notes: noteCounts.get(row.label) ?? 0,
            next: next != null && row.label === next.label,
        });
    // a folded run in the sheet: its first chunks, then how many it hides
    const pushPreview = (rows: ChunkRowModel[], stageId: string) => {
        rows.slice(0, STAGE_PREVIEW_CAP).forEach(pushChunk);
        if (rows.length > STAGE_PREVIEW_CAP) {
            out.push({ kind: "more", id: stageId + "/more", oref, stageId, n: rows.length - STAGE_PREVIEW_CAP });
        }
    };
    if (isFlatPlan(chunks)) {
        // the in-place tracker shows a flat plan whole; the sheet folds a long one like a stage
        const id = flatPlanId(base);
        if (preview && !(stageOverrides[id] ?? false)) {
            pushPreview(chunks, id);
        } else {
            chunks.forEach(pushChunk);
        }
        return out;
    }
    groupChunksByStage(chunks).forEach((group, at) => {
        const id = stageRowId(base, group.stage, at);
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
        } else if (preview) {
            pushPreview(group.rows, id);
        }
    });
    return out;
}

// Stage headers and the facts/pending rows carry no primary action, so the cursor skips them.
export function trackerNavIds(rows: TrackerRow[]): string[] {
    return rows.filter((r) => r.kind === "line" || r.kind === "chunk").map((r) => r.id);
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
