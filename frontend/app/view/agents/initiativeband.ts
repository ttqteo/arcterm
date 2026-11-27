// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chunk logic of a linked agent's initiative, first written for the Chat band (docs/superpowers/specs/
// 2026-11-14-chat-initiative-link-design.md) and read now by the rail's Initiative tab (railinitiative.ts,
// railinitiativepane.tsx; spec 2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md): the rows of its Chunks
// section, which chunks offer Work on this and who holds the others, the two writes of a chunk switch with the line that
// tells the agent, and what Mark done carries the agent to. The Band* names are the band's, kept. Reuses
// initiativepopovermodel.ts, whose `agentChunk` is the one definition of "the chunk this agent is on". Pure: no jotai, no
// RPC; initiativebandstore.ts sends the writes.

import { isLater } from "@/app/view/jarvis/laterchunk";
import { attachAgentOp } from "@/app/view/jarvis/proposedmodel";
import { chunkRef } from "@/app/view/jarvis/trackeredit";
import { switchLine } from "./chatinitiative";
import { agentChunk, nextChunks } from "./initiativepopovermodel";
import { planEditChunks } from "./planreviewmodel";

type BandWorkRef = { kind: string; oref: string; ts?: number };

/** The part of a chunk the Initiative tab reads. */
export type BandChunk = {
    label: string;
    status: string;
    stage?: string;
    // saved for later (EffortChunk.later): the tab never lists it, offers it or counts it
    later?: boolean;
    workrefs?: BandWorkRef[];
};

/** The part of an initiative the Initiative tab reads: `oid` (a bare oid) names it in the switch line. */
export type BandEffort = { oid?: string; chunks?: BandChunk[] };

const settled = (status: string) => status === "done" || status === "skipped";

/** Who holds a chunk: an agent (by its tab id) or a run (by its oid). */
export type BandHolder = { kind: "agent" | "run"; id: string };

/** One row of the Initiative tab's chunk list. `n` is the chunk's place in the plan from 1 (a proposed chunk or a chunk saved for
 *  later before it counts), as the switch line numbers it. `kind` says why it is listed: `done` the chunk this agent finished last, `mine` the one it
 *  is on, `next` one of the next two, `other` a live chunk someone else holds, `plan` only in the full list. */
export type BandRow = {
    label: string;
    n: number;
    kind: "done" | "mine" | "next" | "other" | "plan";
    status: string;
    holders: BandHolder[];
    workOn: boolean;
};

// "agent:<tabId>" or "run:<oid>", as a holder
function holderOf(w: BandWorkRef): BandHolder {
    return { kind: w.kind === "run" ? "run" : "agent", id: w.oref.slice(w.oref.indexOf(":") + 1) };
}

/** Pure: whether a chunk offers Work on this: it is pending, active, blocked or deferred, and no one holds it (any
 *  workref at all: the agent's own, another agent's or a run's). So never the agent's own chunk, nor a done, skipped or
 *  proposed one, nor a chunk saved for later. */
export function canWorkOn(chunk: BandChunk): boolean {
    return (
        chunk.later !== true &&
        (chunk.status === "pending" ||
            chunk.status === "active" ||
            chunk.status === "blocked" ||
            chunk.status === "deferred") &&
        (chunk.workrefs ?? []).length === 0
    );
}

/** Pure: the Chunks section's rows. `window` is the fixed window the section shows, in plan order and without repeats:
 *  the last done chunk this agent holds (the newest of its workrefs among its done chunks), its own chunk, the next two
 *  (`nextChunks`, as the popover has them: a pending chunk before its own is not next), and every live chunk another
 *  holder has. `all` is every non-proposed chunk in plan order, the window's rows keeping their kinds and the rest `plan`
 *  (the `All chunks (N)` list); `total` is N. */
export function bandRows(effort: BandEffort, tabId: string): { window: BandRow[]; all: BandRow[]; total: number } {
    const ref = "agent:" + tabId;
    const own = agentChunk(effort, tabId);
    // a chunk saved for later is held out, but still counts in `n`: the server's list, which the switch line numbers, has it
    const entries = (effort.chunks ?? [])
        .map((c, i) => ({ c, n: i + 1 }))
        .filter(({ c }) => c.status !== "proposed" && !isLater(c));

    // the last chunk this agent finished: the newest workref of its own among its done chunks, the later chunk on a tie
    let lastDone: BandChunk | null = null;
    let lastTs = -1;
    for (const { c } of entries) {
        const w = c.status === "done" ? (c.workrefs ?? []).find((x) => x.oref === ref) : undefined;
        if (w != null && (w.ts ?? 0) >= lastTs) {
            lastDone = c;
            lastTs = w.ts ?? 0;
        }
    }
    const next = new Set(nextChunks(effort, own?.label ?? null));

    const kindOf = (c: BandChunk): BandRow["kind"] => {
        if (own != null && c.label === own.label) {
            return "mine";
        }
        if (lastDone != null && c.label === lastDone.label) {
            return "done";
        }
        // a chunk someone else is on is theirs, even when it falls among the next two
        if (!settled(c.status) && (c.workrefs ?? []).some((w) => w.oref !== ref)) {
            return "other";
        }
        return next.has(c.label) ? "next" : "plan";
    };

    const all = entries.map(
        ({ c, n }): BandRow => ({
            label: c.label,
            n,
            kind: kindOf(c),
            status: c.status,
            holders: (c.workrefs ?? []).map(holderOf),
            workOn: canWorkOn(c),
        })
    );
    return { window: all.filter((r) => r.kind !== "plan"), all, total: all.length };
}

/** Pure: the tag on a row for one of its holders: `this agent` for the agent's own tab, another agent's roster name
 *  (`nameOf`), `an agent` when its tab is not in the roster, `a run` for a run. */
export function holderTag(holder: BandHolder, tabId: string, nameOf: (tabId: string) => string | undefined): string {
    if (holder.kind === "run") {
        return "a run";
    }
    return holder.id === tabId ? "this agent" : (nameOf(holder.id) ?? "an agent");
}

/** Pure: the index of the first row that offers Work on this, or -1: where Pick a chunk…'s cursor goes, and with -1 the
 *  tab shows no Pick a chunk…. The caller picks the rows: the window's, or `all`'s when the window has none. */
export function firstWorkOn(rows: readonly { workOn: boolean }[]): number {
    return rows.findIndex((r) => r.workOn);
}

/** The two writes of a chunk switch and the line that tells the agent. The batch validates against the state before any
 *  op, so the switch is two `mutateEffort` calls: `detach` (null for an agent with no chunk), then `attach`; when `attach`
 *  fails, `rollback` (null with no old chunk) puts the old chunk back. An empty `attach` means there is nothing to do. */
export type SwitchPlan = { detach: EffortOp[] | null; attach: EffortOp[]; rollback: EffortOp[] | null; line: string };

/** Pure: the switch of this agent's chunk to `toLabel` (decisions 5 and 11 of the plan). Write 1 detaches the agent from
 *  its old chunk and, when that was active and no one but this agent holds it, sets it back to pending; write 2 attaches
 *  the chosen chunk and makes it active (no status op when it already is); the rollback attaches the old chunk again and
 *  re-activates it when write 1 demoted it. A chunk is addressed by `chunkRef` (an all-digit label by its position).
 *  Throws for a label the initiative does not have. Switching to the chunk the agent is already on does nothing. */
export function switchPlan(effort: BandEffort, tabId: string, toLabel: string): SwitchPlan {
    const chunks = effort.chunks ?? [];
    const idx = chunks.findIndex((c) => c.label === toLabel);
    if (idx < 0) {
        throw new Error(`No chunk “${toLabel}” in this initiative`);
    }
    const to = chunks[idx];
    const line = switchLine(idx + 1, to.label, effort.oid ?? "");
    const own = agentChunk(effort, tabId);
    if (own != null && own.label === to.label) {
        return { detach: null, attach: [], rollback: null, line };
    }

    const plan = planEditChunks(chunks);
    const ref = (c: BandChunk) => chunkRef(plan, c.label);
    const setStatus = (c: BandChunk, status: string): EffortOp => ({ op: "setChunkStatus", chunk: ref(c), status });
    const demote =
        own != null && own.status === "active" && (own.workrefs ?? []).every((w) => w.oref === "agent:" + tabId);

    return {
        detach:
            own == null
                ? null
                : [
                      { op: "detachWork", chunk: ref(own), kind: "agent", oref: "agent:" + tabId },
                      ...(demote ? [setStatus(own, "pending")] : []),
                  ],
        attach: [attachAgentOp(ref(to), tabId), ...(to.status === "active" ? [] : [setStatus(to, "active")])],
        rollback: own == null ? null : [attachAgentOp(ref(own), tabId), ...(demote ? [setStatus(own, "active")] : [])],
        line,
    };
}

/** Pure: after Mark done, the chunk to attach the agent to: the chunk that became active in that write (active in
 *  `after`, not in `before`), unless any workref is already on it (an agent or a run is on it; the agent itself is, then)
 *  or the agent still holds a live chunk (the server lets an agent hold one). Null when there is none. */
export function carryForward(before: BandEffort, after: BandEffort, tabId: string): string | null {
    if (agentChunk(after, tabId) != null) {
        return null;
    }
    const wasActive = new Set((before.chunks ?? []).filter((c) => c.status === "active").map((c) => c.label));
    const woke = (after.chunks ?? []).find((c) => c.status === "active" && !wasActive.has(c.label));
    return woke != null && (woke.workrefs ?? []).length === 0 ? woke.label : null;
}

/** Pure: whether Mark done on `label` is `advance`: only the first active chunk in plan order, since the server's
 *  `advance` finishes that one. Any other chunk is set done by its status, and `advance` follows only when no chunk is
 *  active. */
export function doneIsAdvance(effort: BandEffort, label: string): boolean {
    return (effort.chunks ?? []).find((c) => c.status === "active")?.label === label;
}
