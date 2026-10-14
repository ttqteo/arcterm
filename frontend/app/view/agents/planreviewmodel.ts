// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail's Plan to review, as rows: the chunks an agent proposed, and the ones just decided, which keep their place
// and an Undo until the rail re-reads (agent state changes, or a new mount). Pure: no jotai, no RPC.
// planreviewstore.ts holds the decisions, planreviewsection.tsx draws the rows.

import { proposedRows } from "@/app/view/jarvis/proposedmodel";
import type { EditChunk } from "@/app/view/jarvis/trackeredit";

type PlanChunk = {
    label: string;
    status: string;
    stage?: string;
    notes?: { ts: number; text: string }[];
};

export type PlanRowState = "proposed" | "accepted" | "dropped";

export type PlanRow = { label: string; meta: string; state: PlanRowState };

// A decision the person made on one chunk, with what Undo needs. `before` is the labels ahead of the chunk in the
// whole plan when it was decided: a dropped chunk is gone from the plan, so this is all that says where it went.
export type PlanDecision = {
    label: string;
    kind: "accepted" | "dropped";
    stage: string;
    before: string[];
};

// The 1-based place a dropped chunk goes back to: right after the nearest chunk ahead of it that is still in the plan,
// else first. Always within 1..length+1, which is all the server takes for an addChunk position, and it restores a
// whole dropped plan in order whichever row's Undo comes first.
export function restoreAt(before: string[], current: string[]): number {
    for (let i = before.length - 1; i >= 0; i--) {
        const at = current.indexOf(before[i]);
        if (at >= 0) {
            return at + 2;
        }
    }
    return 1;
}

// the plan's rows in its order: proposed ones, then decided ones still held. An accepted chunk is held while it is
// pending (Undo sets it back to proposed, which would be wrong for one that has since started); a dropped one while it
// is out of the plan, at the place it left.
export function planRows(chunks: PlanChunk[], decisions: PlanDecision[]): PlanRow[] {
    const proposed = new Map(proposedRows(chunks).map((r) => [r.label, r]));
    const live = new Map(chunks.map((c) => [c.label, c]));
    const held = decisions.filter((d) =>
        proposed.has(d.label)
            ? false
            : d.kind === "dropped"
              ? !live.has(d.label)
              : live.get(d.label)?.status === "pending"
    );
    const order = chunks.map((c) => c.label);
    // fewest chunks ahead first: a dropped chunk's predecessor is then in `order` before it is placed
    for (const d of held.filter((d) => d.kind === "dropped").sort((a, b) => a.before.length - b.before.length)) {
        order.splice(restoreAt(d.before, order) - 1, 0, d.label);
    }
    const decided = new Map(held.map((d) => [d.label, d]));
    return order.flatMap((label): PlanRow[] => {
        const p = proposed.get(label);
        if (p != null) {
            return [{ ...p, state: "proposed" }];
        }
        const d = decided.get(label);
        if (d == null) {
            return [];
        }
        return [{ label, meta: d.kind === "accepted" ? "accepted · now pending" : "dropped", state: d.kind }];
    });
}

export function proposedCount(rows: PlanRow[]): number {
    return rows.filter((r) => r.state === "proposed").length;
}

// the decisions for these labels, read off the plan as it is before the change is sent
export function decisionsFor(chunks: PlanChunk[], labels: string[], kind: PlanDecision["kind"]): PlanDecision[] {
    return labels.flatMap((label): PlanDecision[] => {
        const at = chunks.findIndex((c) => c.label === label);
        if (at < 0) {
            return [];
        }
        return [{ label, kind, stage: chunks[at].stage ?? "", before: chunks.slice(0, at).map((c) => c.label) }];
    });
}

export function addDecisions(prev: PlanDecision[], add: PlanDecision[]): PlanDecision[] {
    const labels = new Set(add.map((d) => d.label));
    return [...prev.filter((d) => !labels.has(d.label)), ...add];
}

export function removeDecision(prev: PlanDecision[], label: string): PlanDecision[] {
    return prev.filter((d) => d.label !== label);
}

// the whole plan in the shape the store's position-aware calls take
export function planEditChunks(chunks: PlanChunk[]): EditChunk[] {
    return chunks.map((c) => ({ label: c.label, stage: c.stage ?? "" }));
}
