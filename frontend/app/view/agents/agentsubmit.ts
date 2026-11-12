// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one way the cockpit types a line into an agent's TUI and submits it: the text (a paste when it has a line break or
// is long), then, once the box shows it, Enter as a write of its own (chatpending.ts submitSteps says why). Every place that sends a prompt, a
// slash command or a nudge goes through it, never a "text\r" in one write.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { pasteIntoTerm, readTermLines } from "@/app/view/term/termpaste";
import { stringToBase64 } from "@/util/util";
import { ECHO_WAIT_MAX_MS, submitSteps } from "./chatpending";
import { boxShowsTyped } from "./chattakeback";

const ECHO_POLL_MS = 40;
const ECHO_SCREEN_ROWS = 40;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function typeRaw(blockId: string, data: string): Promise<void> {
    return RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockId, inputdata64: stringToBase64(data) });
}

// Waits until the agent's box shows `text`, at most ECHO_WAIT_MAX_MS. Returns at once when there is nothing to read (no
// mounted terminal, no box on screen): the fixed wait before it is all a send has then.
async function waitForEcho(blockId: string, text: string): Promise<void> {
    const until = Date.now() + ECHO_WAIT_MAX_MS;
    for (;;) {
        const lines = readTermLines(blockId, ECHO_SCREEN_ROWS);
        if (lines == null || boxShowsTyped(lines, text) !== false || Date.now() >= until) {
            return;
        }
        await sleep(ECHO_POLL_MS);
    }
}

/** Types `text` into the agent's terminal and presses Enter. A paste goes through the mounted terminal (which brackets it
 *  when the program asked for that); with none mounted it is bracketed here, as the backend's typeWake does. */
export async function submitToAgent(blockId: string, text: string): Promise<void> {
    for (const step of submitSteps(text)) {
        switch (step.kind) {
            case "type":
                await typeRaw(blockId, step.text);
                break;
            case "paste":
                if (!pasteIntoTerm(blockId, step.text)) {
                    await typeRaw(blockId, "\x1b[200~" + step.text + "\x1b[201~");
                }
                break;
            case "wait":
                await sleep(step.ms);
                if (step.echo != null) {
                    await waitForEcho(blockId, step.echo);
                }
                break;
            case "enter":
                await typeRaw(blockId, "\r");
                break;
        }
    }
}

/** Sends `data` to the agent's terminal: a line ending in "\r" is submitted as submitToAgent does, anything else (Esc, a
 *  bare "\r", keys) goes as it is. For callers that hold the old "text\r" strings (NUDGE_INPUT, "/compact\r"). */
export async function sendToAgent(blockId: string, data: string): Promise<void> {
    if (data.length > 1 && data.endsWith("\r")) {
        return submitToAgent(blockId, data.slice(0, -1));
    }
    return typeRaw(blockId, data);
}

/** Chat's /btw: the session's arc mod answers the side question with a fork of the session and writes the answer as a
 *  notice the chat draws (AgentBtwCommand). With no mod to take it (a pi agent, a mod that is not running) the command is
 *  typed instead, and Claude Code answers on its own screen. Resolves whether the mod took it. */
export async function askBtw(blockId: string, question: string): Promise<boolean> {
    try {
        await RpcApi.AgentBtwCommand(TabRpcClient, { blockid: blockId, question });
        return true;
    } catch {
        await submitToAgent(blockId, `/btw ${question}`);
        return false;
    }
}
