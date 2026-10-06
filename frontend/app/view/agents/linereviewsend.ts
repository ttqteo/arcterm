// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Sends the line review message to an agent: pasted into its terminal, so a multi-line message arrives whole
// (typed input would submit at its first newline), then Enter to submit it. A busy agent queues it.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { pasteIntoTerm } from "@/app/view/term/termpaste";
import { stringToBase64 } from "@/util/util";
import type { AgentVM } from "./agentsviewmodel";

export type SendOutcome = { ok: true } | { ok: false; error: string };

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// DEV-only, for the line-review scenario: the sink receives the message in place of a terminal
function devSink(): ((text: string) => unknown) | undefined {
    if (!import.meta.env.DEV || typeof window === "undefined") {
        return undefined;
    }
    const sink = window.__lineReviewSink;
    return typeof sink === "function" ? sink : undefined;
}

export async function sendLineComments(agent: AgentVM, text: string): Promise<SendOutcome> {
    const sink = devSink();
    if (sink != null) {
        try {
            await sink(text);
            return { ok: true };
        } catch (e) {
            return { ok: false, error: errText(e) };
        }
    }
    if (!agent.blockId || !pasteIntoTerm(agent.blockId, text)) {
        return { ok: false, error: `${agent.name}'s terminal is not open` };
    }
    try {
        await RpcApi.ControllerInputCommand(TabRpcClient, {
            blockid: agent.blockId,
            inputdata64: stringToBase64("\r"),
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: errText(e) };
    }
}

declare global {
    interface Window {
        // a function: receives the message instead of a terminal; throwing is a failed send
        __lineReviewSink?: (text: string) => unknown;
    }
}
