// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one way the cockpit types a line into an agent's TUI and submits it: the text (a paste when it has a line break or
// is long), then Enter as a write of its own (chatpending.ts submitSteps says why). Every place that sends a prompt, a
// slash command or a nudge goes through it, never a "text\r" in one write.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { pasteIntoTerm } from "@/app/view/term/termpaste";
import { stringToBase64 } from "@/util/util";
import { submitSteps } from "./chatpending";

function typeRaw(blockId: string, data: string): Promise<void> {
    return RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockId, inputdata64: stringToBase64(data) });
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
                await new Promise((resolve) => setTimeout(resolve, step.ms));
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
