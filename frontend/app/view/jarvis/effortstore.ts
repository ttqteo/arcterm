// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The effort store: an on-demand full-effort cache, and the mutate helpers that write through and
// refresh the briefing's summary leg.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { briefingStateAtom, loadBriefingAsync, stateRpcTimeoutMs } from "./briefingstore";
import { chunkTone, type ChunkTone } from "./effortmodel";
import { acceptOps, attachAgentOp, dropOps, linkOp, restoreOps, unacceptOps } from "./proposedmodel";
import { chunkRef, type EditChunk } from "./trackeredit";

export const effortDetailAtom = atom<Map<string, Effort>>(new Map()) as PrimitiveAtom<Map<string, Effort>>;

export type ChunkRowModel = {
    label: string;
    status: string;
    stage: string;
    tone: ChunkTone;
    latestNote?: string;
    trail: EffortNote[];
    owner?: string;
    due?: string; // YYYY-MM-DD, `wsh effort chunk due`
    workrefs: ChunkWorkRef[];
};

// notes are append-only; the latest entry is the newest
export function effortChunkRows(effort: Effort): ChunkRowModel[] {
    return (effort.chunks ?? []).map((c) => {
        const trail = [...(c.notes ?? [])].sort((a, b) => a.ts - b.ts);
        return {
            label: c.label,
            status: c.status,
            stage: c.stage ?? "",
            tone: chunkTone(c.status),
            latestNote: trail.length > 0 ? trail[trail.length - 1].text : undefined,
            trail,
            owner: c.owner,
            due: c.due,
            workrefs: c.workrefs ?? [],
        };
    });
}

const effortOid = (oref: string) => oref.replace(/^effort:/, "");

async function mutateEffort(oref: string, ops: EffortOp[]): Promise<void> {
    const rtn = await RpcApi.EffortMutateCommand(
        TabRpcClient,
        { effortoid: effortOid(oref), ops, author: "you" },
        { timeout: stateRpcTimeoutMs }
    );
    const cache = new Map(globalStore.get(effortDetailAtom));
    cache.set(oref, rtn.effort);
    globalStore.set(effortDetailAtom, cache);
    void loadBriefingAsync(); // summary leg refresh; failure degrades to the next load
    // archive and unarchive move a row between the Brief's two initiative lists
    void loadArchivedEfforts().catch(() => {});
}

// One batch of ops written and the cache refreshed, for a caller that builds its own ops (the initiative band's chunk
// switch sends two batches: the server validates a batch against the state before any of its ops).
export const mutateEffortOps = mutateEffort;

// the archived initiatives the Brief can reveal (design L251, "Show N archived"); the briefing leg drops
// archived efforts server-side, so these come from the effort list with includearchived.
export const archivedEffortsAtom = atom<EffortSummary[]>([]) as PrimitiveAtom<EffortSummary[]>;
export async function loadArchivedEfforts(): Promise<void> {
    const rtn = await RpcApi.EffortListCommand(TabRpcClient, { includearchived: true }, { timeout: stateRpcTimeoutMs });
    globalStore.set(
        archivedEffortsAtom,
        (rtn.efforts ?? []).filter((e) => e.status === "archived")
    );
}

// The cache was fetch-once, and only a mutate made THROUGH this store replaced an entry. An effort
// ticked out of band — `wsh effort` in a terminal, or an agent advancing its own chunk — therefore left
// every rendered row frozen at whatever the app read first, while the header's count came off the
// briefing that reloads on each Brief entry. A count disagreeing with the rows beneath it is exactly the
// defect invariant 5 names. The briefing already carries each effort's updatedts, so the load that keeps
// the count honest is also what proves the detail stale: pass it, and the cache can tell.
export function effortDetailIsFresh(cached: Effort | undefined, freshTs?: number): boolean {
    return cached != null && (freshTs == null || cached.updatedts >= freshTs);
}

// Cache fill for the sheet and the composer; a successful mutate has already replaced the cache entry, so
// callers may skip this. Failures throw to the caller, which owns the error state. The stale entry is left
// in place across a refetch on purpose — dropping it first would blank an open sheet's rows.
export async function loadEffortDetail(oref: string, freshTs?: number): Promise<void> {
    if (effortDetailIsFresh(globalStore.get(effortDetailAtom).get(oref), freshTs)) {
        return;
    }
    const rtn = await RpcApi.EffortGetCommand(
        TabRpcClient,
        { effortoid: effortOid(oref) },
        { timeout: stateRpcTimeoutMs }
    );
    const cache = new Map(globalStore.get(effortDetailAtom));
    cache.set(oref, rtn.effort);
    globalStore.set(effortDetailAtom, cache);
}

export async function advanceChunk(oref: string, note?: string): Promise<void> {
    await mutateEffort(oref, note != null ? [{ op: "advance", note }] : [{ op: "advance" }]);
}
export async function setChunkStatus(oref: string, chunk: string, status: string, note?: string): Promise<void> {
    await mutateEffort(oref, [{ op: "setChunkStatus", chunk, status, note }]);
}
export async function reopenChunk(oref: string, chunk: string): Promise<void> {
    await mutateEffort(oref, [{ op: "reopen", chunk }]);
}
export async function addChunkOp(oref: string, label: string): Promise<void> {
    await mutateEffort(oref, [{ op: "addChunk", label }]);
}

// One batch, so re-staging a whole run is atomic: the server validates every op before applying any,
// and a run half-renamed would split into two groups on screen. Passing "" clears the stage.
export async function setChunkStage(oref: string, chunks: string[], stage: string): Promise<void> {
    await mutateEffort(
        oref,
        chunks.map((chunk) => ({ op: "setChunkStage", chunk, stage }))
    );
}
export async function appendChunkNote(oref: string, chunk: string | null, text: string): Promise<void> {
    await mutateEffort(oref, [{ op: "appendNote", chunk: chunk ?? undefined, note: text }]);
}
export async function setEffortStatus(oref: string, status: string): Promise<void> {
    await mutateEffort(oref, [{ op: "setStatus", status }]);
}

// not setStatus("active"): the server restores whatever the archive replaced, which is the only
// place that knows — an initiative archived while paused or done comes back as it went in.
export async function unarchiveEffort(oref: string): Promise<void> {
    await mutateEffort(oref, [{ op: "unarchive" }]);
}

// hard delete: the record and its whole note trail go. Callers gate this behind an archived status
// and a confirm, mirroring the CLI's own EC-NOT-ARCHIVED refusal.
export async function deleteEffort(oref: string): Promise<void> {
    await RpcApi.EffortDeleteCommand(TabRpcClient, { effortoid: effortOid(oref) }, { timeout: stateRpcTimeoutMs });
    const cache = new Map(globalStore.get(effortDetailAtom));
    cache.delete(oref);
    globalStore.set(effortDetailAtom, cache);
    void loadBriefingAsync();
}

export type EffortDetails = { title: string; project: string; ticket: string; parent: string };

const bareOid = (s: string) => s.trim().replace(/^effort:/, "");

// only what changed, so saving details that were never touched writes nothing to the trail
export function detailOps(cur: EffortDetails, next: EffortDetails): EffortOp[] {
    const ops: EffortOp[] = [];
    if (next.title.trim() !== cur.title.trim()) {
        ops.push({ op: "rename", title: next.title.trim() });
    }
    if (next.project.trim() !== cur.project.trim()) {
        ops.push({ op: "setProject", project: next.project.trim() });
    }
    if (next.ticket.trim() !== cur.ticket.trim()) {
        ops.push({ op: "setTicket", ticket: next.ticket.trim() });
    }
    if (bareOid(next.parent) !== bareOid(cur.parent)) {
        ops.push({ op: "link", parentoid: bareOid(next.parent) });
    }
    return ops;
}

export async function setEffortProject(oref: string, project: string): Promise<void> {
    await mutateEffort(oref, [{ op: "setProject", project: project.trim() }]);
}
export async function renameEffort(oref: string, title: string): Promise<void> {
    await mutateEffort(oref, [{ op: "rename", title: title.trim() }]);
}
export async function setEffortDetails(oref: string, cur: EffortDetails, next: EffortDetails): Promise<void> {
    const ops = detailOps(cur, next);
    if (ops.length > 0) {
        await mutateEffort(oref, ops);
    }
}
// The writes below take labels and resolve the positional ref (chunkRef) when they run, one at a time per
// initiative, against the effort the write before them returned. A ref taken when the write was scheduled goes
// stale: an undoable delete commits seconds later, leaving the Brief flushes several at once, and the Undo of a
// move runs after other writes. An all-digit label sent raw is read by the server as a position, so deleting "1"
// then "2" within the undo window would otherwise delete "3". `chunks` is only the fallback for a client that
// has no plan cached and cannot read one.
const effortWrites = new Map<string, Promise<unknown>>();

function serialWrite(oref: string, write: () => Promise<void>): Promise<void> {
    const run = (effortWrites.get(oref) ?? Promise.resolve()).then(write);
    effortWrites.set(
        oref,
        run.catch(() => {})
    );
    return run;
}

// the effort's chunks as this client last read them, read once if it never has; `fallback` when even that fails
async function liveChunks(oref: string, fallback: EditChunk[]): Promise<EditChunk[]> {
    if (globalStore.get(effortDetailAtom).get(oref) == null) {
        await loadEffortDetail(oref).catch(() => {});
    }
    const chunks = globalStore.get(effortDetailAtom).get(oref)?.chunks;
    return chunks != null ? chunks.map((c) => ({ label: c.label, stage: c.stage ?? "" })) : fallback;
}

// a label that is not all digits is its own ref, so only those cost a read
async function liveRef(oref: string, label: string, fallback: EditChunk[]): Promise<string> {
    return /^\d+$/.test(label) ? chunkRef(await liveChunks(oref, fallback), label) : label;
}

export function renameChunk(oref: string, chunks: EditChunk[], label: string, next: string): Promise<void> {
    return serialWrite(oref, async () => {
        const ref = await liveRef(oref, label, chunks);
        await mutateEffort(oref, [{ op: "renameChunk", chunk: ref, label: next.trim() }]);
    });
}
export function moveChunk(oref: string, chunks: EditChunk[], label: string, at: number): Promise<void> {
    return serialWrite(oref, async () => {
        await mutateEffort(oref, [{ op: "moveChunk", chunk: await liveRef(oref, label, chunks), at }]);
    });
}
// one batch: a chunk restaged but not yet moved would render as a one-chunk run of its new stage
export function moveChunkToStage(
    oref: string,
    chunks: EditChunk[],
    label: string,
    stage: string,
    at: number
): Promise<void> {
    return serialWrite(oref, async () => {
        const ref = await liveRef(oref, label, chunks);
        await mutateEffort(oref, [
            { op: "setChunkStage", chunk: ref, stage },
            { op: "moveChunk", chunk: ref, at },
        ]);
    });
}
// highest position first, so an index ref (see chunkRef) is never shifted by an earlier removal
export function removeChunks(oref: string, chunks: EditChunk[], labels: string[]): Promise<void> {
    return serialWrite(oref, async () => {
        await mutateEffort(oref, dropOps(await liveChunks(oref, chunks), labels));
    });
}
export async function addChunkAt(oref: string, label: string, stage: string, at?: number): Promise<void> {
    await mutateEffort(oref, [{ op: "addChunk", label: label.trim(), stage: stage || undefined, at }]);
}
export async function editNote(oref: string, chunk: string, at: number, ts: number, text: string): Promise<void> {
    await mutateEffort(oref, [{ op: "editNote", chunk, at, notets: ts, note: text.trim() }]);
}
export async function removeNote(oref: string, chunk: string, at: number, ts: number): Promise<void> {
    await mutateEffort(oref, [{ op: "removeNote", chunk, at, notets: ts }]);
}

// the plan an agent proposed: accepting makes the chunks pending (and so counted), dropping removes them.
// restoreProposed and unacceptProposed are the Undo of a drop and of an accept.
export async function acceptProposed(oref: string, labels: string[]): Promise<void> {
    await mutateEffort(oref, acceptOps(labels));
}
export async function unacceptProposed(oref: string, label: string): Promise<void> {
    await mutateEffort(oref, unacceptOps(label));
}
export function dropProposed(oref: string, chunks: EditChunk[], labels: string[]): Promise<void> {
    return serialWrite(oref, async () => {
        await mutateEffort(oref, dropOps(await liveChunks(oref, chunks), labels));
    });
}
export async function restoreProposed(oref: string, label: string, stage: string, at: number): Promise<void> {
    await mutateEffort(oref, restoreOps(label, stage, at));
}

// tie an agent's terminal tab to a chunk, so the chunk reads as that agent's work
export async function attachAgent(oref: string, chunk: string, tabId: string): Promise<void> {
    await mutateEffort(oref, [attachAgentOp(chunk, tabId)]);
}

// "" unlinks
export async function linkEffort(oref: string, parentOref: string): Promise<void> {
    await mutateEffort(oref, [linkOp(parentOref)]);
}

// The pin as the app last read it: the briefing's summary (reloaded after each pin), else the cached detail.
function pinnedNow(oref: string): { pinned: boolean; title: string } {
    const summary = globalStore.get(briefingStateAtom).snapshot?.state.efforts?.find((e) => e.oref === oref);
    const detail = globalStore.get(effortDetailAtom).get(oref);
    return {
        pinned: (summary != null ? (summary.pinnedts ?? 0) : (detail?.pinnedts ?? 0)) > 0,
        title: summary?.title ?? detail?.title ?? "",
    };
}

// a pin moves no updatedts, so effortDetailIsFresh would never refetch the cached detail: patch its pin here
function patchDetailPin(oref: string, pinned: boolean): void {
    const cached = globalStore.get(effortDetailAtom).get(oref);
    if (cached == null || (cached.pinnedts ?? 0) > 0 === pinned) {
        return;
    }
    const cache = new Map(globalStore.get(effortDetailAtom));
    cache.set(oref, { ...cached, pinnedts: pinned ? Date.now() : 0 });
    globalStore.set(effortDetailAtom, cache);
}

async function requestPin(oref: string, pin: boolean, title: string, replaceOldest: boolean): Promise<void> {
    let rtn: CommandEffortPinRtnData;
    try {
        rtn = await RpcApi.EffortPinCommand(
            TabRpcClient,
            replaceOldest
                ? { effortoid: effortOid(oref), pin, replaceoldest: true }
                : { effortoid: effortOid(oref), pin },
            { timeout: stateRpcTimeoutMs }
        );
    } catch (err) {
        pushToast({
            title: `Couldn't ${pin ? "pin" : "unpin"} ${title ? `“${title}”` : "the initiative"}`,
            message: err instanceof Error ? err.message : String(err),
            level: "error",
        });
        return;
    }
    if (rtn.capreached) {
        const oldest = rtn.oldest?.title || "the oldest pin";
        pushToast({
            title: `${MAX_PINNED_EFFORTS} initiatives are pinned`,
            message: `Unpin “${oldest}” to pin ${title ? `“${title}”` : "this one"} in its place.`,
            level: "info",
            action: { label: `Unpin ${oldest}`, run: () => void requestPin(oref, pin, title, true) },
        });
        return;
    }
    patchDetailPin(oref, rtn.pinned);
    void loadBriefingAsync(); // the cards and the list read the pin off the summary
}

// mirrors jarvis.MaxPinnedEfforts: only the cap toast's wording uses it, the server enforces the cap
export const MAX_PINNED_EFFORTS = 6;

// The one pin flow: every pin control (card menu, list row, sheet head, the `p` key) calls it. It pins an
// unpinned initiative and unpins a pinned one. At the cap it offers to unpin the oldest; a failure is an error
// toast, never thrown to the control.
export async function togglePin(oref: string): Promise<void> {
    const { pinned, title } = pinnedNow(oref);
    await requestPin(oref, !pinned, title, false);
}

// an idea is a title written down to come back to: no project, no chunks, no form. It returns the new
// initiative's oref, for a caller that goes on to link or attach something to it.
export async function createIdea(title: string): Promise<string> {
    const rtn = await RpcApi.EffortCreateCommand(TabRpcClient, { title, chunks: [] }, { timeout: stateRpcTimeoutMs });
    void loadBriefingAsync();
    return "effort:" + rtn.effortoid;
}
