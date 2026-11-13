// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Add to an initiative from Chat keeps (docs/superpowers/specs/2026-11-12-chat-add-to-initiative-design.md §8), in
// localStorage so a reload keeps the folded rows and a handled card never comes back: the handled records of the cards an
// agent proposed (`chat.initiative.handled`, by the block's key), the cards the person opened from a message
// (`chat.initiative.cards`, by agent), the drafts of cards being edited (`chat.initiative.drafts`, by card) and the result
// lines waiting for an agent's next message (`chat.initiative.pending`, by agent). Module-level atoms, as every surface but
// Agent unmounts on a switch. The updates are chatinitiative.ts's pure halves; this file adds the I/O: storage, jotai and
// the one write, through effortstore.ts and EffortCreateCommand.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { briefingStateAtom, loadBriefingAsync, stateRpcTimeoutMs } from "@/app/view/jarvis/briefingstore";
import { addChunkOp, appendChunkNote, effortDetailAtom, loadEffortDetail } from "@/app/view/jarvis/effortstore";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import {
    addedRecord,
    blockDraftKey,
    chunkLinesOf,
    clipLabel,
    coerceCards,
    coerceDraft,
    coerceHandled,
    coerceLines,
    effortOref,
    fitBytes,
    messageDraftKey,
    putBackLines,
    queueLine,
    readStoredMap,
    resultLine,
    settleCard,
    takeLines,
    withDraft,
    withHandled,
    withMessageCard,
    withoutKey,
    type CardsMap,
    type DraftsMap,
    type HandledMap,
    type HandledRecord,
    type InitiativeDraft,
    type MessageCard,
    type PendingMap,
} from "./chatinitiative";

export const HANDLED_STORAGE_KEY = "chat.initiative.handled";
export const CARDS_STORAGE_KEY = "chat.initiative.cards";
export const DRAFTS_STORAGE_KEY = "chat.initiative.drafts";
export const PENDING_STORAGE_KEY = "chat.initiative.pending";

// wavesrv's limit on a new initiative's title and first chunks' labels (EffortCreate counts bytes)
const MAX_CREATE_BYTES = 200;

// a storage that throws (a private window, a restricted webview) degrades to cards that forget; it is said once per
// failure, not on every write
const warned = new Set<string>();
function warnOnce(what: string, e: unknown): void {
    if (!warned.has(what)) {
        warned.add(what);
        console.warn(`[chat] initiative cards not ${what}:`, e instanceof Error ? e.message : String(e));
    }
}

// a map read from localStorage: one that cannot be read starts empty, and a map that is not one says why
function readMap<T>(key: string, coerce: (v: unknown) => T | undefined): Record<string, T> {
    try {
        const { map, reason } = readStoredMap(globalThis.localStorage?.getItem(key), coerce);
        if (reason != null) {
            console.warn(`[chat] ${key} ignored (${reason}); starting empty`);
        }
        return map;
    } catch (e) {
        warnOnce("read", e);
        return {};
    }
}

function writeMap(key: string, map: object): void {
    try {
        globalThis.localStorage?.setItem(key, JSON.stringify(map));
    } catch (e) {
        warnOnce("saved", e);
    }
}

// seeded from localStorage at module load, so a reload still draws the rows and sends the lines
const handledAtom = atom<HandledMap>(readMap(HANDLED_STORAGE_KEY, coerceHandled)) as PrimitiveAtom<HandledMap>;
const cardsAtom = atom<CardsMap>(readMap(CARDS_STORAGE_KEY, coerceCards)) as PrimitiveAtom<CardsMap>;
const draftsAtom = atom<DraftsMap>(readMap(DRAFTS_STORAGE_KEY, coerceDraft)) as PrimitiveAtom<DraftsMap>;
const pendingAtom = atom<PendingMap>(readMap(PENDING_STORAGE_KEY, coerceLines)) as PrimitiveAtom<PendingMap>;

const has = (map: object, key: string): boolean => Object.prototype.hasOwnProperty.call(map, key);

function update<T extends object>(target: PrimitiveAtom<T>, storageKey: string, change: (prev: T) => T): void {
    const prev = globalStore.get(target);
    const next = change(prev);
    if (next !== prev) {
        globalStore.set(target, next);
        writeMap(storageKey, next);
    }
}

// ---- handled records (a card an agent proposed) ----

const handledOf = atomFamily((key: string) =>
    atom((get) => (has(get(handledAtom), key) ? get(handledAtom)[key] : undefined))
);

/** What became of the card the block with this key drew, or undefined while it waits. A change redraws whatever reads it. */
export function useHandled(key: string): HandledRecord | undefined {
    return useAtomValue(handledOf(key));
}

/** Keeps the outcome of a proposed card (its draft is dropped), and queues its result line for the agent's next message. */
export function markHandled(key: string, rec: HandledRecord, agentId: string): void {
    update(handledAtom, HANDLED_STORAGE_KEY, (prev) => withHandled(prev, key, rec));
    dropDraft(blockDraftKey(key));
    queueResultLine(agentId, resultLine(rec));
}

// ---- cards opened from a message ----

const NO_CARDS: MessageCard[] = [];

const cardsOf = atomFamily((agentId: string) =>
    atom((get) => (has(get(cardsAtom), agentId) ? get(cardsAtom)[agentId] : NO_CARDS))
);

/** One agent's message cards, oldest first. */
export function useMessageCards(agentId: string): MessageCard[] {
    return useAtomValue(cardsOf(agentId));
}

/** Opens a card from a message's text, anchored to the key of the chat item it opened after; returns its id. Its draft is
 *  `draftFromMessage(text, ctx)`, which the card derives where the host's initiative list is known (the draft is stored once
 *  the person edits it). */
export function openMessageCard(agentId: string, anchor: string, text: string): string {
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    update(cardsAtom, CARDS_STORAGE_KEY, (prev) => withMessageCard(prev, agentId, { id, anchor, text }));
    return id;
}

/** Settles a message card: a record folds it into its row (an added one also queues its line for the agent), null removes
 *  it (a Cancel: no row, no line). */
export function settleMessageCard(agentId: string, id: string, rec: HandledRecord | null): void {
    const prev = globalStore.get(cardsAtom);
    if (settleCard(prev, agentId, id, rec) === prev) {
        return; // not there, or already settled
    }
    update(cardsAtom, CARDS_STORAGE_KEY, (cards) => settleCard(cards, agentId, id, rec));
    dropDraft(messageDraftKey(id));
    if (rec?.outcome === "added") {
        queueResultLine(agentId, resultLine(rec));
    }
}

// ---- drafts ----

const draftOf = atomFamily((key: string) =>
    atom((get) => (has(get(draftsAtom), key) ? get(draftsAtom)[key] : undefined))
);

/** The draft being edited under a card's key (blockDraftKey / messageDraftKey), else `initial`: the card's first draft,
 *  derived where the initiative list is known. A draft is stored once the person changes it, so a switch to Terminal and
 *  back keeps the trimmed text. */
export function useDraft(cardKey: string, initial: InitiativeDraft): InitiativeDraft {
    return useAtomValue(draftOf(cardKey)) ?? initial;
}

export function setDraft(cardKey: string, draft: InitiativeDraft): void {
    update(draftsAtom, DRAFTS_STORAGE_KEY, (prev) => withDraft(prev, cardKey, draft));
}

export function dropDraft(cardKey: string): void {
    update(draftsAtom, DRAFTS_STORAGE_KEY, (prev) => withoutKey(prev, cardKey));
}

// ---- result lines waiting for an agent's next message ----

/** Keeps a line to put in front of the agent's next plain message. */
export function queueResultLine(agentId: string, line: string): void {
    update(pendingAtom, PENDING_STORAGE_KEY, (prev) => queueLine(prev, agentId, line));
}

/** The agent's waiting lines, oldest first; they are cleared. A send that fails puts them back (putBackResultLines). */
export function takeResultLines(agentId: string): string[] {
    const { lines, next } = takeLines(globalStore.get(pendingAtom), agentId);
    update(pendingAtom, PENDING_STORAGE_KEY, () => next);
    return lines;
}

/** Lines a send did not use, back at the front of the agent's queue. */
export function putBackResultLines(agentId: string, lines: readonly string[]): void {
    update(pendingAtom, PENDING_STORAGE_KEY, (prev) => putBackLines(prev, agentId, lines));
}

// ---- the write ----

// an initiative's title as the app last read it: the briefing's summary, else the cached detail, else a read; undefined
// when none has it (the row then names no topic)
async function titleOf(oref: string): Promise<string | undefined> {
    const summary = globalStore.get(briefingStateAtom).snapshot?.state.efforts?.find((e) => e.oref === oref);
    if (summary != null) {
        return summary.title;
    }
    const cached = globalStore.get(effortDetailAtom).get(oref);
    if (cached != null) {
        return cached.title;
    }
    try {
        await loadEffortDetail(oref);
        return globalStore.get(effortDetailAtom).get(oref)?.title;
    } catch {
        return undefined;
    }
}

/** Writes the card's draft: a note on a chunk (appendChunkNote), a chunk at the end of the initiative (addChunkOp, its label
 *  clipped), or a new initiative (EffortCreateCommand, as effortcreateform.tsx calls it, with its topic and first chunks and
 *  in `project`). Resolves with the record of what was added. A refusal rejects with wavesrv's message, for the card to show;
 *  nothing is swallowed. */
export async function writeInitiative(draft: InitiativeDraft, project: string | undefined): Promise<HandledRecord> {
    if (draft.kind === "initiative") {
        const title = fitBytes(draft.title, MAX_CREATE_BYTES);
        const parent = draft.parent != null ? effortOref(draft.parent) : "";
        const rtn = await RpcApi.EffortCreateCommand(
            TabRpcClient,
            {
                title,
                project: project?.trim() || undefined,
                parentoid: parent === "" ? undefined : parent.replace(/^effort:/, ""),
                chunks: chunkLinesOf(draft.chunks).map((label) => ({ label })),
            },
            { timeout: stateRpcTimeoutMs }
        );
        void loadBriefingAsync();
        const topic = parent === "" ? undefined : await titleOf(parent);
        return addedRecord(draft, { initiative: title, effort: effortOref(rtn.effortoid), topic }, Date.now());
    }
    const oref = draft.effort != null ? effortOref(draft.effort) : "";
    if (oref === "") {
        throw new Error("Pick an initiative first");
    }
    if (draft.kind === "note") {
        if (draft.chunk == null) {
            throw new Error("Pick a chunk first");
        }
        await appendChunkNote(oref, draft.chunk, draft.text.trim());
    } else {
        await addChunkOp(oref, clipLabel(draft.text));
    }
    // the write refreshed the detail cache: the title and the chunk's place are read off it
    const detail = globalStore.get(effortDetailAtom).get(oref);
    const chunks = detail?.chunks ?? [];
    const place = draft.kind === "note" ? chunks.findIndex((c) => c.label === draft.chunk) + 1 : chunks.length;
    return addedRecord(
        draft,
        {
            initiative: detail?.title ?? (await titleOf(oref)) ?? oref,
            effort: oref,
            chunkNumber: place > 0 ? place : undefined,
        },
        Date.now()
    );
}
