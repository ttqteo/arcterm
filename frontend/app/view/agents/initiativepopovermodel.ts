// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the initiative popover on the agent header reads off an initiative: the chunk this agent is on, the next ones, the
// latest note, the status word, and the rows its keys move over. Pure: no jotai, no RPC.

import { chunkTone, type ChunkTone } from "@/app/view/jarvis/effortmodel";

type PopoverChunk = {
    label: string;
    status: string;
    workrefs?: { kind: string; oref: string }[];
    notes?: { ts: number; text: string }[];
};
type PopoverEffort = { status?: string; chunks?: PopoverChunk[] };

const settled = (status: string) => status === "done" || status === "skipped";

// The chunk whose workrefs hold this agent's tab; the active chunk stands in for an agent with none of its own (it
// was started on the initiative, not attached to a chunk). A proposed chunk is nobody's work yet. Null when neither
// exists.
export function agentChunk<T extends PopoverChunk>(effort: { chunks?: T[] }, tabId: string): T | null {
    const chunks = (effort.chunks ?? []).filter((c) => c.status !== "proposed");
    const ref = "agent:" + tabId;
    const held = chunks.filter((c) => (c.workrefs ?? []).some((w) => w.oref === ref));
    return (
        held.find((c) => c.status === "active") ??
        held.find((c) => !settled(c.status)) ??
        chunks.find((c) => c.status === "active") ??
        null
    );
}

// The next pending chunks after `label` in plan order (from the top with none), by label. A chunk that is deferred,
// blocked or proposed is not "next".
export function nextChunks(effort: { chunks?: PopoverChunk[] }, label: string | null, limit = 2): string[] {
    const chunks = effort.chunks ?? [];
    const from = label == null ? 0 : chunks.findIndex((c) => c.label === label) + 1;
    return chunks
        .slice(from)
        .filter((c) => c.status === "pending")
        .slice(0, limit)
        .map((c) => c.label);
}

// the newest note of a chunk, with its stamp for the age beside it
export function latestNoteEntry(chunk: PopoverChunk | null | undefined): { ts: number; text: string } | undefined {
    return (chunk?.notes ?? []).reduce<{ ts: number; text: string } | undefined>(
        (best, n) => (best == null || n.ts >= best.ts ? n : best),
        undefined
    );
}

export function latestNote(chunk: PopoverChunk | null | undefined): string | undefined {
    return latestNoteEntry(chunk)?.text;
}

// the chunks an agent proposed and nobody decided on
export function proposedCount(effort: { chunks?: PopoverChunk[] }): number {
    return (effort.chunks ?? []).filter((c) => c.status === "proposed").length;
}

// The bar and the count, over the plan as the Brief's row counts it: a proposed chunk is not work until accepted and a
// skipped one leaves the total.
export function popoverProgress(effort: { chunks?: PopoverChunk[] }): {
    segments: ChunkTone[];
    done: number;
    total: number;
} {
    const chunks = (effort.chunks ?? []).filter((c) => c.status !== "proposed" && c.status !== "skipped");
    return {
        segments: chunks.map((c) => chunkTone(c.status)),
        done: chunks.filter((c) => c.status === "done").length,
        total: chunks.length,
    };
}

export type PopoverStatusTone = "success" | "working" | "asking" | "muted" | "faint";

// The word at the right of the kicker. Blocked first: it is the one state that waits on someone.
export function popoverStatus(effort: PopoverEffort, agentState: string): { text: string; tone: PopoverStatusTone } {
    const chunks = (effort.chunks ?? []).filter((c) => c.status !== "proposed");
    if (chunks.some((c) => c.status === "blocked")) {
        return { text: "blocked", tone: "asking" };
    }
    if (
        effort.status === "completed" ||
        effort.status === "done" ||
        (chunks.length > 0 && chunks.every((c) => settled(c.status)))
    ) {
        return { text: "done", tone: "muted" };
    }
    if (effort.status === "paused") {
        return { text: "paused", tone: "faint" };
    }
    return agentState === "working" ? { text: "at work", tone: "working" } : { text: "agent open", tone: "success" };
}

// The rows the cursor moves over: the chunk this agent is on, then the next ones.
export type PopoverRow = { kind: "current" | "next"; label: string };

export function popoverRows(effort: { chunks?: PopoverChunk[] }, tabId: string): PopoverRow[] {
    const mine = agentChunk(effort, tabId);
    return [
        ...(mine != null ? [{ kind: "current" as const, label: mine.label }] : []),
        ...nextChunks(effort, mine?.label ?? null).map((label) => ({ kind: "next" as const, label })),
    ];
}

// the cursor one row on, stopping at the ends
export function stepRow(count: number, cur: number, delta: number): number {
    return count === 0 ? 0 : Math.min(count - 1, Math.max(0, cur + delta));
}

// A chunk's small menu: the statuses it can be set to (done is Mark done's), then Rename.
export const CHUNK_RENAME = "rename";
const MENU_STATUSES = ["pending", "active", "blocked", "deferred", "skipped"] as const;

export function chunkMenuItems(status: string): { id: string; label: string; current: boolean }[] {
    return [
        ...MENU_STATUSES.map((s) => ({ id: s as string, label: s as string, current: s === status })),
        { id: CHUNK_RENAME, label: "Rename", current: false },
    ];
}
