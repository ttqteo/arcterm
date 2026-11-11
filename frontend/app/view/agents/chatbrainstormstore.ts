// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The record of the answers Arc sent to an agent's brainstorm questions (a click in the Chat card or the Brainstorm
// pane, or the box while a question waits), kept in localStorage `chat.brainstorm.sent` so it survives a reload and a
// sleeping agent. Chat pairs it with the transcript's user messages (chatbrainstorm.ts pairAnswers) to draw each answered
// question as one ✓ row in place of the bubble. Module-level atoms, as every surface but Agent unmounts on a switch.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { addAnswer, parseSentStore, pruneAnswerAgents, type SentAnswer, type SentByAgent } from "./chatbrainstorm";

export const SENT_STORAGE_KEY = "chat.brainstorm.sent";

// a storage that throws (a private window, a restricted webview) degrades to no ✓ rows; it is said once, not on every send
let warned = false;
function warnOnce(what: string, e: unknown): void {
    if (!warned) {
        warned = true;
        console.warn(`[chat] brainstorm answers not ${what}:`, e instanceof Error ? e.message : String(e));
    }
}

function readStored(): SentByAgent {
    try {
        return parseSentStore(globalThis.localStorage?.getItem(SENT_STORAGE_KEY));
    } catch (e) {
        warnOnce("read", e);
        return {};
    }
}

function writeStored(map: SentByAgent): void {
    try {
        globalThis.localStorage?.setItem(SENT_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
        warnOnce("saved", e);
    }
}

// seeded from localStorage at module load, so a reload still draws the ✓ rows
export const brainstormSentAtom = atom<SentByAgent>(readStored()) as PrimitiveAtom<SentByAgent>;

const NONE: SentAnswer[] = [];

// own keys only: an agent id of "constructor" must not read an Object.prototype member
function recordsOf(map: SentByAgent, agentId: string): SentAnswer[] {
    return Object.prototype.hasOwnProperty.call(map, agentId) ? map[agentId] : NONE;
}

/** One agent's records, oldest first; a new record redraws whatever reads this. */
export const brainstormAnswersAtom = atomFamily((agentId: string) =>
    atom((get) => recordsOf(get(brainstormSentAtom), agentId))
);

export function brainstormAnswers(agentId: string): SentAnswer[] {
    return recordsOf(globalStore.get(brainstormSentAtom), agentId);
}

/** Keeps the answer just sent: at most 50 per agent, the oldest dropped. */
export function recordBrainstormAnswer(agentId: string, record: SentAnswer): void {
    const prev = globalStore.get(brainstormSentAtom);
    const next = pruneAnswerAgents({ ...prev, [agentId]: addAnswer(recordsOf(prev, agentId), record) });
    globalStore.set(brainstormSentAtom, next);
    writeStored(next);
}
