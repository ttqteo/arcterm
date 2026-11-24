// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Runs a take-back (chattakeback.ts has the rules): the key into the agent's terminal, a wait until Claude Code's box
// holds the text, Ctrl+U to clear it there, and the text into the chat box. Nothing comes back when the box never shows
// the text (Claude took the message, or answered first); a box that would not clear gets its text queued again with
// Enter, so a take-back that fails leaves things as they were. An Esc take-back is kept per agent (TakenBack), so the
// conversation hides the record Claude Code wrote before the Esc (withoutTakenBack). takeBackAfterKey does the same after
// a dialog's pick that puts the last prompt back in the box (the safeguards' "Edit prompt and retry").

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { readTermLines } from "@/app/view/term/termpaste";
import { stringToBase64 } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useMemo } from "react";
import { dropPendingIds } from "./chatpendingstore";
import { boxHolds, inputBoxRows, type TakeBack, type TakenBack } from "./chattakeback";

/** each agent's last Esc take-back, by agent id */
const takenBackAtom = atom<Record<string, TakenBack>>({}) as PrimitiveAtom<Record<string, TakenBack>>;

/** Keeps `taken` as the agent's last Esc take-back, in place of the one before. */
export function noteTakenBack(agentId: string, taken: TakenBack): void {
    globalStore.set(takenBackAtom, { ...globalStore.get(takenBackAtom), [agentId]: taken });
}

/** The agent's last Esc take-back, or undefined: a pane reads only its own. */
export function useTakenBack(agentId: string): TakenBack | undefined {
    const one = useMemo(() => atom((get) => get(takenBackAtom)[agentId]), [agentId]);
    return useAtomValue(one);
}

const KEY_UP = "\x1b[A";
const KEY_ESC = "\x1b";
// Ctrl+U: delete to the line's start, again across lines; Claude Code leaves the caret at the end of what it put back
const KEY_CLEAR = "\x15";
const KEY_ENTER = "\r";
const SCREEN_ROWS = 40;
const POLL_MS = 120;
// ↑ puts the queue back at once; Esc first has to stop the turn
const WAIT_MS = { queued: 2_000, interrupt: 5_000 } as const;
const KEY_GAP_MS = 40;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const keys = (blockid: string, data: string) =>
    RpcApi.ControllerInputCommand(TabRpcClient, { blockid, inputdata64: stringToBase64(data) });

// one take-back at a time per agent: a second key would land in the first one's wait
const running = new Set<string>();

// the bottom rows once Claude Code's box holds the text, or null when it never does before `until`
async function waitForBox(blockId: string, texts: string[], until: number): Promise<string[] | null> {
    while (Date.now() < until) {
        await sleep(POLL_MS);
        const lines = readTermLines(blockId, SCREEN_ROWS);
        if (lines != null && boxHolds(lines, texts)) {
            return lines;
        }
    }
    return null;
}

/** How a take-back ended: `done` put the text back; `busy` found another take-back of this agent's still running; `none`
 *  never saw the text in Claude Code's box (Claude took it, or answered first), so nothing came back; `stuck` saw it but
 *  the box would not clear, and left it where it was. */
export type TakeBackResult = "done" | "busy" | "none" | "stuck";

/** Takes `plan` back from the agent's terminal into the chat box through `put`. */
export async function takeBack(
    agentId: string,
    blockId: string,
    plan: TakeBack,
    put: (texts: string[]) => void
): Promise<TakeBackResult> {
    return run(agentId, blockId, plan.kind === "queued" ? KEY_UP : KEY_ESC, plan.texts, {
        waitMs: WAIT_MS[plan.kind],
        requeue: plan.kind === "queued",
        put: (texts) => {
            dropPendingIds(agentId, plan.ids);
            put(texts);
        },
    });
}

// a dialog's pick first draws the prompt back in, after the dialog closes
const AFTER_KEY_WAIT_MS = 5_000;

/** Types `key` into a dialog whose pick puts the last prompt back in Claude Code's box (the safeguards' "Edit prompt and
 *  retry"), then takes that prompt on into the chat box as an Esc take-back would, through `put`. `texts` is the prompt
 *  as the transcript holds it, for knowing the box holds it. */
export function takeBackAfterKey(
    agentId: string,
    blockId: string,
    key: string,
    texts: string[],
    put: (texts: string[]) => void
): Promise<TakeBackResult> {
    return run(agentId, blockId, key, texts, { waitMs: AFTER_KEY_WAIT_MS, requeue: false, put });
}

// a hook that puts the dropped prompt back (the arc mod's @mention) has done so by the time the drop's notice is read
const DROPPED_WAIT_MS = 1_500;

/** Takes a message a hook dropped (chatpending.ts droppedIds) back into the chat box through `put`: out of Claude Code's
 *  box first when the hook put it back there, so the next send does not type it after the copy; straight into the chat
 *  box when the box never shows it (a hook that kept nothing). Left where it is when the box would not clear. */
export async function takeBackDropped(
    agentId: string,
    blockId: string,
    texts: string[],
    put: (texts: string[]) => void
): Promise<TakeBackResult> {
    const result = await run(agentId, blockId, null, texts, { waitMs: DROPPED_WAIT_MS, requeue: false, put });
    if (result === "none") {
        put(texts);
    }
    return result;
}

async function run(
    agentId: string,
    blockId: string,
    key: string | null,
    texts: string[],
    opts: { waitMs: number; requeue: boolean; put: (texts: string[]) => void }
): Promise<TakeBackResult> {
    if (running.has(agentId)) {
        return "busy";
    }
    running.add(agentId);
    try {
        if (key != null) {
            await keys(blockId, key);
        }
        const lines = await waitForBox(blockId, texts, Date.now() + opts.waitMs);
        if (lines == null) {
            return "none";
        }
        const rows = inputBoxRows(lines)?.length ?? 1;
        for (let i = 0; i <= rows; i++) {
            await keys(blockId, KEY_CLEAR);
            await sleep(KEY_GAP_MS);
        }
        await sleep(POLL_MS);
        const after = readTermLines(blockId, SCREEN_ROWS);
        if (after == null || boxHolds(after, texts)) {
            // the box would not clear: a queued message goes back in the queue, where it was
            if (opts.requeue) {
                await keys(blockId, KEY_ENTER);
            }
            return "stuck";
        }
        opts.put(texts);
        return "done";
    } finally {
        running.delete(agentId);
    }
}
