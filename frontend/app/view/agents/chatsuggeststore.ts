// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The model half of Chat's suggested replies (chatsuggest.ts has the rules and the merge): one ChatSuggestCommand per
// turn, its answer kept by turn (suggestKey) so the pane unmounting, a surface switch or a second look at the same turn
// asks nothing again. wavesrv keeps the answers too and joins a second ask for a call still running (pkg/chatsuggest).
// A turn that ends in a choice question also has a judge record (chatjudge.ts, pkg/chatjudge): wavesrv keeps it for good,
// the chips' answer, the list of an agent's records and the deep judge's answer fill chatJudgeAtom with it, and the deep
// judge's calls are made here. Also the initiative chip's Mark done, shared with the Initiative tab's.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { advanceChunk, attachAgent, effortDetailAtom, setChunkStatus } from "@/app/view/jarvis/effortstore";
import { chunkRef } from "@/app/view/jarvis/trackeredit";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useMemo } from "react";
import { choiceTurn } from "./chatjudge";
import type { ModelSuggest } from "./chatsuggest";
import { carryForward, doneIsAdvance } from "./initiativeband";
import { planEditChunks } from "./planreviewmodel";

// the turns kept: past this the oldest go
const KEEP = 40;

// the call is claude starting on haiku, 8-11 s; past this it is given up
const TIMEOUT_MS = 70_000;

// the deep judge reads the code for up to 180 s (pkg/chatjudge); the call waits a little longer than that
const JUDGE_TIMEOUT_MS = 200_000;

/** What a DEV fake answers with: the replies, or the whole answer (a judge record with them). */
type FakeSuggestAnswer = string[] | CommandChatSuggestRtnData;

/** The deep judge's three commands a DEV fake answers: the record for "judge", the records (CommandChatJudgeListRtnData)
 *  for "list", nothing for "stop". */
type JudgeFakeCmd = "judge" | "stop" | "list";
type JudgeFakeData = CommandChatJudgeData | CommandChatJudgeStopData | CommandChatJudgeListData;

declare global {
    interface Window {
        // DEV: a CDP scenario answers the call itself (no haiku call, and an answer it chooses), and reads what was asked
        __chatSuggestFake?: (data: CommandChatSuggestData) => FakeSuggestAnswer | Promise<FakeSuggestAnswer>;
        // DEV: the same for the judge's commands (no sonnet session)
        __chatJudgeFake?: (cmd: JudgeFakeCmd, data: JudgeFakeData) => unknown | Promise<unknown>;
        // DEV: empties chatJudgeAtom and the once-per-agent list memo: a scenario's stand-in for an app restart
        __chatJudgeReset?: () => void;
    }
}

/** each turn's model answer by suggestKey, oldest first */
export const modelSuggestAtom = atom<Record<string, ModelSuggest>>({}) as PrimitiveAtom<Record<string, ModelSuggest>>;

function put(key: string, state: ModelSuggest): void {
    const cur = globalStore.get(modelSuggestAtom);
    const keys = Object.keys(cur).filter((k) => k !== key);
    const kept: Record<string, ModelSuggest> = {};
    for (const k of keys.slice(Math.max(0, keys.length - (KEEP - 1)))) {
        kept[k] = cur[k];
    }
    kept[key] = state;
    globalStore.set(modelSuggestAtom, kept);
}

/** One turn's model answer, or undefined before it is asked: a pane reads only its own turn's, so an answer landing for
 *  another agent draws nothing here. */
export function useModelSuggest(key: string | null): ModelSuggest | undefined {
    const one = useMemo(() => atom((get) => (key == null ? undefined : get(modelSuggestAtom)[key])), [key]);
    return useAtomValue(one);
}

/** Ticks `label` done on the initiative `oref` for the agent in tab `tabId`, as the Initiative tab's Mark done does: from
 *  the first active chunk it is `advance` (done, and the next one active); from any other it marks that chunk done and
 *  moves on only when nothing is active, since `advance` finishes the first active chunk, which may be another agent's
 *  (doneIsAdvance). Then the agent goes with it: the chunk that woke in that write gets the agent attached, unless
 *  someone already holds it (carryForward), so the tab and the chips read the agent on the next chunk and not on
 *  nothing. The initiative must be loaded (effortDetailAtom). */
export async function markChunkDone(oref: string, label: string, tabId: string): Promise<void> {
    const before = globalStore.get(effortDetailAtom).get(oref);
    const chunks = before?.chunks ?? [];
    if (before == null || !chunks.some((c) => c.label === label)) {
        return;
    }
    if (doneIsAdvance(before, label)) {
        await advanceChunk(oref);
    } else {
        await setChunkStatus(oref, chunkRef(planEditChunks(chunks), label), "done");
        const mid = globalStore.get(effortDetailAtom).get(oref);
        if (!(mid?.chunks ?? []).some((c) => c.status === "active")) {
            await advanceChunk(oref);
        }
    }
    const after = globalStore.get(effortDetailAtom).get(oref);
    const next = after != null ? carryForward(before, after, tabId) : null;
    if (after == null || next == null) {
        return;
    }
    try {
        await attachAgent(oref, chunkRef(planEditChunks(after.chunks ?? []), next), tabId);
    } catch (e) {
        // the chunk is done: the caller's "could not mark it done" would be false
        throw new Error(
            `Marked done, but could not move this agent to “${next}”: ${e instanceof Error ? e.message : String(e)}`
        );
    }
}

/** The initiative `oref`'s detail, or undefined until it is loaded: a pane reads only its own. */
export function useEffortDetail(oref: string | null): Effort | undefined {
    const one = useMemo(() => atom((get) => (oref == null ? undefined : get(effortDetailAtom).get(oref))), [oref]);
    return useAtomValue(one);
}

/** Asks the model about one turn, once: a turn already asked (answered, failed or on its way) asks nothing. The ask
 *  carries the turn's `key` and whether it is a choice (choiceTurn), which is what wavesrv keeps a judge record for; the
 *  record it answers with goes to chatJudgeAtom, ahead of the replies, so the row never shows before its pick. */
export function requestModelSuggest(key: string, data: CommandChatSuggestData): void {
    if (key in globalStore.get(modelSuggestAtom)) {
        return;
    }
    put(key, { status: "loading" });
    const ask: CommandChatSuggestData = { ...data, key, choice: choiceTurn(data.reply) };
    const fake = import.meta.env.DEV && typeof window !== "undefined" ? window.__chatSuggestFake : undefined;
    fireAndForget(async () => {
        try {
            const answer =
                fake != null
                    ? await fake(ask)
                    : await RpcApi.ChatSuggestCommand(TabRpcClient, ask, { timeout: TIMEOUT_MS });
            const rtn: CommandChatSuggestRtnData | undefined = Array.isArray(answer) ? { replies: answer } : answer;
            if (rtn?.judge != null) {
                putRecord(key, rtn.judge);
            }
            put(key, { status: "done", replies: rtn?.replies ?? [] });
        } catch {
            put(key, { status: "failed" });
        }
    });
}

// ---- the judge record of each choice turn, and the deep judge ----

/** each choice turn's judge record by suggestKey: from the chips' answer, an agent's list and the deep judge's answers */
export const chatJudgeAtom = atom<Record<string, ChatJudgeRecord>>({}) as PrimitiveAtom<
    Record<string, ChatJudgeRecord>
>;

/** One turn's judge record, or undefined when it has none (not a choice turn, or the model's answer not here yet). */
export function useChatJudge(key: string | null): ChatJudgeRecord | undefined {
    const one = useMemo(() => atom((get) => (key == null ? undefined : get(chatJudgeAtom)[key])), [key]);
    return useAtomValue(one);
}

/** Keeps wavesrv's answer for one turn: it is the freshest read of that turn there is. */
function putRecord(key: string, rec: ChatJudgeRecord): void {
    globalStore.set(chatJudgeAtom, { ...globalStore.get(chatJudgeAtom), [key]: rec });
}

/** Sets the deep judge's part of a turn's record, when it has one. */
function putDeep(key: string, deep: (cur: ChatJudgeDeep | undefined) => ChatJudgeDeep | null): void {
    const rec = globalStore.get(chatJudgeAtom)[key];
    const next = rec == null ? null : deep(rec.deep);
    if (rec != null && next != null) {
        putRecord(key, { ...rec, deep: next });
    }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function judgeFake(): Window["__chatJudgeFake"] {
    return import.meta.env.DEV && typeof window !== "undefined" ? window.__chatJudgeFake : undefined;
}

// the agents whose records were asked for: once each per app life
const judgesLoaded = new Set<string>();

/** Reads an agent's judge records from wavesrv, once per agent per app life, so the line under an old message survives a
 *  pane unmount and an app restart. A record Chat already holds is the fresher one and stays. A read that failed is
 *  logged and asked again the next time a pane mounts. */
export function loadChatJudges(agentId: string): void {
    if (judgesLoaded.has(agentId)) {
        return;
    }
    judgesLoaded.add(agentId);
    const fake = judgeFake();
    fireAndForget(async () => {
        try {
            const data: CommandChatJudgeListData = { agentid: agentId };
            const rtn = (await (fake != null
                ? fake("list", data)
                : RpcApi.ChatJudgeListCommand(TabRpcClient, data))) as CommandChatJudgeListRtnData | undefined;
            const cur = globalStore.get(chatJudgeAtom);
            const fill: Record<string, ChatJudgeRecord> = {};
            for (const rec of rtn?.records ?? []) {
                fill[rec.key] = rec;
            }
            globalStore.set(chatJudgeAtom, { ...fill, ...cur });
        } catch (e) {
            judgesLoaded.delete(agentId);
            throw e;
        }
    });
}

// the deep judge calls in flight in this window, one per turn: a stop forgets its call, so its late answer is not kept
const judging = new Map<string, symbol>();

/** Starts the deep judge on a turn, or joins one wavesrv already runs for it (a record that arrives `reading`: another
 *  window, a pane remounted after a reload, which keeps the start time it was given). The record goes `reading` at once;
 *  the call blocks until the judge ends (200 s at most) and its record is kept, an error setting `failed` with its
 *  message. A stopped or failed judge is sent with `retry`, so Stop and then Judge kỹ runs again. A second call for a turn
 *  whose call is in flight here does nothing. */
export function requestDeepJudge(key: string, cwd: string, retry = false): void {
    const rec = globalStore.get(chatJudgeAtom)[key];
    if (rec == null || judging.has(key)) {
        return;
    }
    const was = rec.deep?.state;
    if (was !== "reading") {
        putDeep(key, () => ({ state: "reading", startts: Date.now() }));
    }
    const data: CommandChatJudgeData = { key, cwd, retry: retry || was === "stopped" || was === "failed" };
    const mine = Symbol(key);
    judging.set(key, mine);
    const fake = judgeFake();
    fireAndForget(async () => {
        try {
            const rtn = (await (fake != null
                ? fake("judge", data)
                : RpcApi.ChatJudgeCommand(TabRpcClient, data, { timeout: JUDGE_TIMEOUT_MS }))) as
                | ChatJudgeRecord
                | null
                | undefined;
            if (rtn == null) {
                throw new Error("the judge gave no answer");
            }
            if (judging.get(key) === mine) {
                putRecord(key, rtn);
            }
        } catch (e) {
            if (judging.get(key) === mine) {
                putDeep(key, (cur) =>
                    cur?.state === "reading"
                        ? { ...cur, state: "failed", error: errorText(e), endts: Date.now() }
                        : null
                );
            }
        } finally {
            if (judging.get(key) === mine) {
                judging.delete(key);
            }
        }
    });
}

/** Stops the deep judge reading a turn: the record goes `stopped` at once, and wavesrv is told. Anything but a reading
 *  judge is left as it is (a result is never turned into a stop). */
export function stopDeepJudge(key: string): void {
    if (globalStore.get(chatJudgeAtom)[key]?.deep?.state !== "reading") {
        return;
    }
    judging.delete(key);
    putDeep(key, (cur) => (cur == null ? null : { ...cur, state: "stopped", endts: Date.now() }));
    const fake = judgeFake();
    const data: CommandChatJudgeStopData = { key };
    fireAndForget(async () => {
        await (fake != null ? fake("stop", data) : RpcApi.ChatJudgeStopCommand(TabRpcClient, data));
    });
}

/** What a pane's live turn offers as its line's action (chatjudge.ts judgeLine), and where to run it. */
export interface LiveJudge {
    key: string;
    cwd: string;
    action: "judge" | "retry" | "stop";
}

/** Each agent's live turn as its Chat pane's line offers it: the pane writes it (chatpane.tsx), and the Alt+J binding,
 *  which cannot see the pane's state, reads it (runLiveJudge). Undefined when the pane offers nothing. */
export const liveJudgeAtom = atom<Record<string, LiveJudge | undefined>>({}) as PrimitiveAtom<
    Record<string, LiveJudge | undefined>
>;

/** The pane's write to liveJudgeAtom: what its live turn offers, or undefined to take the offer back (the turn changed,
 *  or the pane is gone). No component subscribes to the atom, so writing it redraws nothing. */
export function setLiveJudge(agentId: string, live: LiveJudge | undefined): void {
    globalStore.set(liveJudgeAtom, { ...globalStore.get(liveJudgeAtom), [agentId]: live });
}

/** Runs the action the agent's pane offers on its live turn: judge or retry starts the deep judge, stop stops it. */
export function runLiveJudge(agentId: string): void {
    const live = globalStore.get(liveJudgeAtom)[agentId];
    if (live == null) {
        return;
    }
    if (live.action === "stop") {
        stopDeepJudge(live.key);
    } else {
        requestDeepJudge(live.key, live.cwd, live.action === "retry");
    }
}

/** Forgets every judge record, which agents were read and the deep judge calls in flight (their late answers are not
 *  kept): what an app restart does (DEV: window.__chatJudgeReset). */
export function resetChatJudges(): void {
    globalStore.set(chatJudgeAtom, {});
    judgesLoaded.clear();
    judging.clear();
}

if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__chatJudgeReset = resetChatJudges;
}
