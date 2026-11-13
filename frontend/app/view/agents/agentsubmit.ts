// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one way the cockpit types a line into an agent's TUI and submits it: the text (a paste when it has a line break or
// is long), then, once the box shows it, Enter as a write of its own (chatpending.ts submitSteps says why). Every place that sends a prompt, a
// slash command or a nudge goes through it, never a "text\r" in one write.

import { getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { pasteIntoTerm, readTermLines } from "@/app/view/term/termpaste";
import { stringToBase64 } from "@/util/util";
import {
    ECHO_WAIT_MAX_MS,
    echoStep,
    enterStep,
    sendFailLogLine,
    sendFailure,
    SubmitError,
    submitSteps,
    type SubmitStage,
} from "./chatpending";
import { enterEcho, typedEcho } from "./chattakeback";

const ECHO_POLL_MS = 40;
const ECHO_SCREEN_ROWS = 40;
const ENTER_POLL_MS = 80;
// Backspace as Claude Code reads it (DEL)
const KEY_BACKSPACE = "\x7f";
// the pause before a retried Enter, per retry: any paste Claude Code still took the text for is over by then
const ENTER_RETRY_GAP_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function typeRaw(blockId: string, data: string): Promise<void> {
    return RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockId, inputdata64: stringToBase64(data) });
}

// a step's error as the SubmitError of its stage
async function atStage(stage: SubmitStage, run: () => Promise<void> | void): Promise<void> {
    try {
        await run();
    } catch (e) {
        throw e instanceof SubmitError ? e : new SubmitError(stage, e instanceof Error ? e.message : String(e));
    }
}

// Waits until the agent's box shows `text` (chatpending.ts echoStep): Enter at once when it does or when there is
// nothing to read (no mounted terminal, no box on screen), after ECHO_WAIT_MAX_MS on a box holding something else, and
// a failure, with no Enter, when the box stays empty: the text never reached Claude Code.
async function waitForEcho(blockId: string, text: string): Promise<void> {
    const start = Date.now();
    for (;;) {
        const echo = typedEcho(readTermLines(blockId, ECHO_SCREEN_ROWS), text);
        const step = echoStep(echo, Date.now() - start);
        if (step === "enter") {
            if (echo !== "shown") {
                // an Enter that goes before the box showed the text can land in one read with it: say so in the log
                logLine(
                    `[chat-send] enter-unechoed block=${blockId.slice(0, 8)} echo=${echo} waited=${Date.now() - start}`
                );
            }
            return;
        }
        if (step === "fail") {
            throw new SubmitError("echo", "Claude Code's box stayed empty");
        }
        await sleep(ECHO_POLL_MS);
    }
}

function logLine(line: string): void {
    try {
        getApi().sendLog(line);
    } catch {
        // a log line must never hide the send's own error
    }
}

function logFailure(blockId: string, text: string, e: unknown): void {
    logLine(sendFailLogLine(blockId, text, sendFailure(e)));
}

// Waits after a Backspace until the box shows `text` alone again, at most ECHO_WAIT_MAX_MS; false when it never does.
async function waitForHeld(blockId: string, text: string): Promise<boolean> {
    const until = Date.now() + ECHO_WAIT_MAX_MS;
    while (Date.now() < until) {
        await sleep(ECHO_POLL_MS);
        if (enterEcho(readTermLines(blockId, ECHO_SCREEN_ROWS), text) === "held") {
            return true;
        }
    }
    return false;
}

// Watches the box after the Enter (chatpending.ts enterStep) until the text left it. An Enter Claude Code took as a line
// break is taken back with Backspace and pressed again once the box shows the text alone; one that keeps going in as a
// line break, or a Backspace the box never shows, fails the send at its Enter: the message waits in Claude Code's box.
async function confirmEnter(blockId: string, text: string): Promise<void> {
    let start = Date.now();
    let retries = 0;
    for (;;) {
        await sleep(ENTER_POLL_MS);
        const step = enterStep(enterEcho(readTermLines(blockId, ECHO_SCREEN_ROWS), text), Date.now() - start, retries);
        if (step === "done") {
            return;
        }
        if (step === "fail") {
            throw new SubmitError("enter", "Claude Code took the Enter as a line break");
        }
        if (step === "retry") {
            retries++;
            logLine(`[chat-send] enter-linebreak block=${blockId.slice(0, 8)} retry=${retries}`);
            await atStage("enter", () => typeRaw(blockId, KEY_BACKSPACE));
            if (!(await waitForHeld(blockId, text))) {
                throw new SubmitError("enter", "Claude Code took the Enter as a line break");
            }
            await sleep(ENTER_RETRY_GAP_MS * retries);
            await atStage("enter", () => typeRaw(blockId, "\r"));
            start = Date.now();
        }
    }
}

/** Types `text` into the agent's terminal and presses Enter, then makes sure the Enter submitted it (confirmEnter). A
 *  paste goes through the mounted terminal (which brackets it when the program asked for that); with none mounted it is
 *  bracketed here, as the backend's typeWake does. Rejects with a SubmitError naming the step that failed, written to
 *  waveapp.log first: a caller that only fires and forgets still leaves a trace. */
export async function submitToAgent(blockId: string, text: string): Promise<void> {
    try {
        for (const step of submitSteps(text)) {
            switch (step.kind) {
                case "type":
                    await atStage("type", () => typeRaw(blockId, step.text));
                    break;
                case "paste":
                    await atStage("type", async () => {
                        if (!pasteIntoTerm(blockId, step.text)) {
                            await typeRaw(blockId, "\x1b[200~" + step.text + "\x1b[201~");
                        }
                    });
                    break;
                case "wait":
                    await sleep(step.ms);
                    if (step.echo != null) {
                        await waitForEcho(blockId, step.echo);
                    }
                    break;
                case "enter":
                    await atStage("enter", () => typeRaw(blockId, "\r"));
                    break;
            }
        }
    } catch (e) {
        logFailure(blockId, text, e);
        throw e;
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
