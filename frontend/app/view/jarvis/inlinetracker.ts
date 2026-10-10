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

export type TrackerRow =
    | { kind: "line"; id: string; line: BriefLine; expanded: boolean }
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
 * The Brief's visible lines with the open initiative's plan spliced in after its row.
 *
 * `chunks` is null while the effort detail is still loading — the row still expands, so the click
 * lands somewhere, and says so rather than flickering an empty plan.
 */
export function trackerRows(args: {
    lines: BriefLine[];
    openLineId: string | null;
    chunks: ChunkRowModel[] | null;
    noteCounts: Map<string, number>;
    stageOverrides: Record<string, boolean>;
}): TrackerRow[] {
    const { lines, openLineId, chunks, noteCounts, stageOverrides } = args;
    const out: TrackerRow[] = [];
    for (const line of lines) {
        const oref = expandableORef(line);
        const expanded = oref != null && line.id === openLineId;
        out.push({ kind: "line", id: line.id, line, expanded });
        if (!expanded || oref == null) {
            continue;
        }
        if (chunks == null) {
            out.push({ kind: "pending", id: line.id + "/pending", oref, message: "Loading this initiative's plan…" });
            continue;
        }
        if (chunks.length === 0) {
            out.push({ kind: "pending", id: line.id + "/pending", oref, message: "No chunks on this initiative yet." });
            continue;
        }
        const doneN = chunks.filter((c) => c.status === "done").length;
        out.push({
            kind: "facts",
            id: line.id + "/facts",
            oref,
            count: `${chunks.length} chunk${chunks.length === 1 ? "" : "s"} · ${doneN} done`,
        });
        const next = nextChunk(chunks);
        const pushChunk = (row: ChunkRowModel) =>
            out.push({
                kind: "chunk",
                id: chunkRowId(line.id, row.label),
                oref,
                row,
                notes: noteCounts.get(row.label) ?? 0,
                next: next != null && row.label === next.label,
            });
        if (isFlatPlan(chunks)) {
            chunks.forEach(pushChunk);
            continue;
        }
        groupChunksByStage(chunks).forEach((group, at) => {
            const id = stageRowId(line.id, group.stage, at);
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
            if (!open) {
                return;
            }
            group.rows.forEach(pushChunk);
        });
    }
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
