// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the initiative popover on the agent header reads off an initiative: the chunk this agent is on, the next ones, the
// latest note, the status word, and the rows its keys move over. Pure: no jotai, no RPC.

import { orderOfWork } from "@/app/view/jarvis/chunkorder";
import { chunkTone, type ChunkTone } from "@/app/view/jarvis/effortmodel";
import { planChunks } from "@/app/view/jarvis/laterchunk";

type PopoverChunk = {
    label: string;
    status: string;
    // saved for later (EffortChunk.later): kept on Jarvis, never the plan's work, so every read below leaves it out
    later?: boolean;
    priority?: string;
    workrefs?: { kind: string; oref: string }[];
    notes?: { ts: number; text: string }[];
};
type PopoverEffort = { status?: string; chunks?: PopoverChunk[] };

const settled = (status: string) => status === "done" || status === "skipped";

// "The chunk this agent is on", the one definition the band, `m`, the done: / go on with: chips and the Terminal popover
// share: the live (not done, not skipped) chunk whose workrefs hold this agent's tab, an active one first when legacy
// data attached it to several. Nothing else: the initiative's active chunk does not stand in for an agent that holds none,
// a proposed chunk is nobody's work yet, and a chunk saved for later is not worked. Null when there is no such chunk.
export function agentChunk<T extends PopoverChunk>(effort: { chunks?: T[] }, tabId: string): T | null {
    const ref = "agent:" + tabId;
    const live = planChunks(effort.chunks ?? []).filter(
        (c) => c.status !== "proposed" && !settled(c.status) && (c.workrefs ?? []).some((w) => w.oref === ref)
    );
    return live.find((c) => c.status === "active") ?? live[0] ?? null;
}

// The first `limit` pending chunks of the plan in the order of work (chunkorder.ts: highest rank first, equal ranks in
// plan order), by label, leaving out `label` (the chunk this agent is on, which may itself be pending). Where the chunk
// sits in the plan does not matter, so a pending chunk before the agent's own is listed when it ranks first. A chunk
// that is active, deferred, blocked, proposed or saved for later is not "next": the later ones are filtered out before
// the rank, so a later chunk of any level is never listed.
export function nextChunks(effort: { chunks?: PopoverChunk[] }, label: string | null, limit = 2): string[] {
    return orderOfWork(planChunks(effort.chunks ?? []))
        .filter((c) => c.status === "pending" && c.label !== label)
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

// The bar and the count, over the plan as the Brief's row counts it: a proposed chunk is not work until accepted, a
// skipped one leaves the total, and a chunk saved for later is not the plan's.
export function popoverProgress(effort: { chunks?: PopoverChunk[] }): {
    segments: ChunkTone[];
    done: number;
    total: number;
} {
    const chunks = planChunks(effort.chunks ?? []).filter((c) => c.status !== "proposed" && c.status !== "skipped");
    return {
        segments: chunks.map((c) => chunkTone(c.status)),
        done: chunks.filter((c) => c.status === "done").length,
        total: chunks.length,
    };
}

// The count after an initiative's title in the header's ◇ chip and in a split cell's bar: `done/total` over popoverProgress's
// plan. Null while the initiative is not read yet, or when it has no chunk to count.
export function chipCount(effort: { chunks?: PopoverChunk[] } | undefined): string | null {
    if (effort == null) {
        return null;
    }
    const { done, total } = popoverProgress(effort);
    return total > 0 ? `${done}/${total}` : null;
}

export type PopoverStatusTone = "success" | "working" | "asking" | "muted" | "faint";

// The word at the right of the kicker. Blocked first: it is the one state that waits on someone.
export function popoverStatus(effort: PopoverEffort, agentState: string): { text: string; tone: PopoverStatusTone } {
    const chunks = planChunks(effort.chunks ?? []).filter((c) => c.status !== "proposed");
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

// The chunk linking an agent to an initiative attaches it to: the plan's active chunk, else its highest-ranked pending one
// (chunkorder.ts, equal ranks in plan order). A later chunk, kept rather than worked, is never picked, whatever its level
// and wherever it stands in the list. Undefined when the plan has neither.
export function linkChunk<T extends { status: string; priority?: string; later?: boolean }>(
    chunks: T[]
): T | undefined {
    return orderOfWork(planChunks(chunks)).find((c) => c.status === "active" || c.status === "pending");
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
