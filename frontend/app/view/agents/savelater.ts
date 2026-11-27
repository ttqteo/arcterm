// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Saving into an initiative for later: Chat's Save for later (one selected passage) and the agent's later card (a list)
// write their items as later chunks (EffortChunk.later), and the toast's Move to… moves one to another initiative. The
// batches are built by pure helpers (laterBatch, moveOps); the two actions read the initiative they write to, so a
// label is made unique against what it holds now. Errors are not caught here: the caller toasts them.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { stateRpcTimeoutMs } from "@/app/view/jarvis/briefingstore";
import { createIdea, mutateEffortOps } from "@/app/view/jarvis/effortstore";
import { isLater, laterChunkOp, uniqueLabel } from "@/app/view/jarvis/laterchunk";
import { chunkRef } from "@/app/view/jarvis/trackeredit";
import { clipLabel, effortOref, fitBytes, MAX_CHUNK_LABEL } from "./chatinitiative";
import { savedBody } from "./chatsaveselection";

/** One thing to keep for later: the chunk's label, and its first note (savedBody's passage under where it was said). */
export interface LaterItem {
    label: string;
    note: string;
}

/** Where the items came from: the agent (its tab, its name and project) and the conversation's id when it has one.
 *  `title` names the initiative a "new" save makes (a card's heading); without it the first item's label does. */
export interface LaterFrom {
    agentId: string;
    name: string;
    project?: string;
    conversation?: string;
    title?: string;
}

// EffortCreate counts a title's bytes, not its characters
const MAX_TITLE_BYTES = 200;

// `text` cut to at most `max` characters, ending in an ellipsis when cut, never half an emoji
function cutTo(text: string, max: number): string {
    if (text.length <= max) {
        return text;
    }
    let cut = text.slice(0, max - 1);
    if (/[\uD800-\uDBFF]$/.test(cut)) {
        cut = cut.slice(0, -1);
    }
    return cut.trimEnd() + "…";
}

// `label` as it stands, or numbered (" (2)", " (3)"…) until no `taken` label holds it, and always within the server's
// limit: a label of full length is cut to leave room for its number before it is numbered
function fitUnique(taken: readonly string[], label: string): string {
    const next = uniqueLabel(taken, label);
    if (next.length <= MAX_CHUNK_LABEL) {
        return next;
    }
    for (let n = 2; ; n++) {
        const suffix = ` (${n})`;
        const candidate = cutTo(label, MAX_CHUNK_LABEL - suffix.length) + suffix;
        if (!taken.includes(candidate)) {
            return candidate;
        }
    }
}

/** The one batch that saves `items` for later: an addChunk per item, in order, each marked later, with its note and the
 *  agent's session and conversation (the server records them on the chunk's first note, from the cockpit only). A label
 *  is folded to one line, clipped to the server's limit and numbered against `existingLabels` and the items before it:
 *  the server checks a batch against the state before it, so two like items would otherwise both land. */
export function laterBatch(
    existingLabels: readonly string[],
    items: readonly LaterItem[],
    from: LaterFrom
): EffortOp[] {
    const taken = [...existingLabels];
    return items.map((item) => {
        const label = fitUnique(taken, clipLabel(item.label));
        taken.push(label);
        return laterChunkOp({
            label,
            note: item.note,
            session: "agent:" + from.agentId,
            conversation: from.conversation,
        });
    });
}

/** The two batches that move a later chunk to another initiative: `add` goes to the picked one (the chunk with its
 *  label made unique against `toLabels`, its mark, its due, and its first note's text, session and conversation), then
 *  `remove` goes to the one it leaves. The removal names the chunk whatever else the initiative holds: the server lets
 *  a later chunk go even when it is the initiative's only chunk. */
export function moveOps(from: EffortChunk, toLabels: readonly string[]): { add: EffortOp[]; remove: EffortOp[] } {
    // notes are append-only, so the first by time is the one the save wrote
    const first = [...(from.notes ?? [])].sort((a, b) => a.ts - b.ts)[0];
    const add = laterChunkOp({
        label: fitUnique(toLabels, from.label),
        note: first?.text ?? "",
        session: first?.session,
        conversation: first?.conversation,
        due: from.due,
    });
    return { add: [add], remove: [{ op: "removeChunk", chunk: chunkRef([], from.label) }] };
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function readEffort(oref: string): Promise<Effort> {
    const rtn = await RpcApi.EffortGetCommand(
        TabRpcClient,
        { effortoid: oref.replace(/^effort:/, "") },
        { timeout: stateRpcTimeoutMs }
    );
    return rtn.effort;
}

// the new initiative's first note: the passage when one was saved, else the list under where it was said
function ideaNote(items: readonly LaterItem[], from: LaterFrom): string {
    if (items.length === 1) {
        return items[0].note;
    }
    const list = items.map((item) => "- " + item.label).join("\n");
    return savedBody(list, { agentId: from.agentId, name: from.name }, new Date());
}

/** Saves `items` as later chunks of `target`, one batch, so the add is all or nothing. `target` is an initiative's oref,
 *  or "new" for a new initiative made as Save as idea makes one (the agent's project, the passage and its session as the
 *  first note), named by `from.title` or the first label, which then holds the chunks. Returns the initiative and the
 *  labels the chunks took. A failure reaches the caller; a "new" one may leave the empty initiative behind, in Ideas. */
export async function saveLaterTo(
    target: string,
    items: readonly LaterItem[],
    from: LaterFrom
): Promise<{ oref: string; title: string; labels: string[] }> {
    if (items.length === 0) {
        throw new Error("There is nothing to save for later");
    }
    let oref: string;
    let title: string;
    let held: string[];
    if (target === "new") {
        title = fitBytes(from.title ?? items[0].label, MAX_TITLE_BYTES);
        oref = await createIdea(title, {
            project: from.project,
            note: ideaNote(items, from),
            agentId: from.agentId,
        });
        held = [];
    } else {
        oref = effortOref(target);
        const effort = await readEffort(oref);
        title = effort.title;
        held = (effort.chunks ?? []).map((c) => c.label);
    }
    const ops = laterBatch(held, items, from);
    await mutateEffortOps(oref, ops);
    return { oref, title, labels: ops.map((op) => op.label ?? "") };
}

/** Moves the later chunk `label` from `fromOref` to `toOref`: added there, then removed here, two writes. When the
 *  removal fails the chunk is in both, and the error names both initiatives so the person can delete the copy. Returns
 *  the picked initiative's title, for the toast. */
export async function moveLaterChunk(fromOref: string, label: string, toOref: string): Promise<{ title: string }> {
    const from = effortOref(fromOref);
    const to = effortOref(toOref);
    if (from === to) {
        throw new Error("It is already in that initiative");
    }
    const [source, dest] = await Promise.all([readEffort(from), readEffort(to)]);
    const chunk = (source.chunks ?? []).find((c) => c.label === label);
    if (chunk == null) {
        throw new Error(`“${label}” is no longer in “${source.title}”`);
    }
    if (!isLater(chunk)) {
        throw new Error(`“${label}” is no longer saved for later in “${source.title}”`);
    }
    const { add, remove } = moveOps(
        chunk,
        (dest.chunks ?? []).map((c) => c.label)
    );
    await mutateEffortOps(to, add);
    try {
        await mutateEffortOps(from, remove);
    } catch (e) {
        throw new Error(
            `Added to “${dest.title}”, but couldn't remove it from “${source.title}” (${messageOf(e)}). ` +
                `It is in both now: delete the copy you don't want.`
        );
    }
    return { title: dest.title };
}
