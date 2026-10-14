// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The proposed chunks of an initiative: the plan an agent put forward, held out of every count until someone
// accepts it. Pure: no jotai, no RPC. effortstore.ts sends the ops built here; the rail and the popover draw the rows.

import { chunkRef } from "./trackeredit";

type ProposedChunk = {
    label: string;
    status: string;
    stage?: string;
    notes?: { ts: number; text: string }[];
};

export type ProposedRow = { label: string; meta: string };

// the proposed chunks in plan order; meta is the stage, then the newest note, joined with " · "
export function proposedRows(chunks: ProposedChunk[]): ProposedRow[] {
    return chunks
        .filter((c) => c.status === "proposed")
        .map((c) => {
            const newest = (c.notes ?? []).reduce<{ ts: number; text: string } | undefined>(
                (best, n) => (best == null || n.ts >= best.ts ? n : best),
                undefined
            );
            const meta = [c.stage ?? "", newest?.text ?? ""].filter((s) => s !== "").join(" · ");
            return { label: c.label, meta };
        });
}

// accepting makes a proposed chunk an ordinary pending one, which then counts
export function acceptOps(labels: string[]): EffortOp[] {
    return labels.map((chunk) => ({ op: "setChunkStatus", chunk, status: "pending" }));
}

// the Undo of an accept
export function unacceptOps(label: string): EffortOp[] {
    return [{ op: "setChunkStatus", chunk: label, status: "proposed" }];
}

// Highest position first, so an index ref (see chunkRef) is never shifted by an earlier removal. `chunks` is the
// whole plan: a position counts the chunks that are not proposed too.
export function dropOps(chunks: { label: string }[], labels: string[]): EffortOp[] {
    const edit = chunks.map((c) => ({ label: c.label, stage: "" }));
    const idx = (l: string) => chunks.findIndex((c) => c.label === l);
    return [...labels]
        .sort((a, b) => idx(b) - idx(a))
        .map((label) => ({ op: "removeChunk", chunk: chunkRef(edit, label) }));
}

// the Undo of a drop: the chunk back as proposed, in its stage, at its old 1-based position
export function restoreOps(label: string, stage: string, at: number): EffortOp[] {
    return [{ op: "addChunk", label, stage: stage || undefined, status: "proposed", at }];
}

// what Continue types into the agent's terminal; the carriage return submits it
export function continueMessage(first: string): string {
    return `Plan accepted, start with ${first}\r`;
}

export function attachAgentOp(chunk: string, tabId: string): EffortOp {
    return { op: "attachWork", chunk, kind: "agent", oref: "agent:" + tabId };
}

// "" unlinks
export function linkOp(parent: string): EffortOp {
    return { op: "link", parentoid: parent.trim().replace(/^effort:/, "") };
}
