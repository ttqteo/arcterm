// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure projection of an Antigravity CLI (agy) transcript — `transcript_full.jsonl`, one JSON step
// per line — into AgentEntry[]. No React, no Wave runtime imports. Sibling of pitranscriptprojection.ts
// and the Claude/Codex/opencode projectors; selected through the projection registry.
//
// Step shapes (agy 1.3.1): USER_INPUT wraps the prompt in <USER_REQUEST> followed by metadata blocks;
// PLANNER_RESPONSE carries `content` (assistant text), `thinking` and `tool_calls[{name, args}]`; the
// next GENERIC step is the result of a tool call, its `content` opening with Created At / Completed At
// lines and its `status` ERROR when the call failed (or a pre-tool hook denied it). Thinking is dropped,
// as every other projector drops reasoning. Unknown step types and malformed lines are skipped: agy adds
// types between releases, and a projection must survive any file shape.

import type { AgentEntry } from "./agentsviewmodel";

// a tool result's stored output is bounded: a GENERIC step can carry a whole file or build log
const RESULT_MAX_CHARS = 64 * 1024;
const TRUNCATION_MARKER = "\n… [truncated]";

interface AgyToolCall {
    name?: unknown;
    args?: unknown;
}

interface AgyStep {
    type?: unknown;
    status?: unknown;
    content?: unknown;
    tool_calls?: unknown;
}

type ActionEntry = AgentEntry & { kind: "action" };

// a pending tool call: the action it produced and the command line its result's output belongs to
interface PendingCall {
    action: ActionEntry;
    command?: string;
}

function parseSteps(lines: string[]): AgyStep[] {
    const steps: AgyStep[] = [];
    for (const line of lines) {
        try {
            const step = JSON.parse(line);
            if (step != null && typeof step === "object" && !Array.isArray(step)) {
                steps.push(step as AgyStep);
            }
        } catch {
            // malformed line: skip
        }
    }
    return steps;
}

const USER_REQUEST_RE = /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/;
const METADATA_BLOCK_RE = /<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>[\s\S]*?<\/\1>/g;

// the prompt the person typed: the <USER_REQUEST> body, else the content with the metadata blocks dropped
function userRequest(step: AgyStep): string {
    if (typeof step.content !== "string") {
        return "";
    }
    const m = USER_REQUEST_RE.exec(step.content);
    if (m != null) {
        return m[1].trim();
    }
    return step.content.replace(METADATA_BLOCK_RE, "").trim();
}

function str(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

function toolEntry(call: AgyToolCall): PendingCall | null {
    const name = str(call?.name);
    if (name === "") {
        return null;
    }
    const args = call.args != null && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {};
    const command = str(args.CommandLine);
    const target = str(args.toolSummary) || command || name;
    return { action: { kind: "action", verb: name, target }, command: command === "" ? undefined : command };
}

// strip the Created At / Completed At header lines a result opens with
function stripResultHeader(content: string): string {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    let i = 0;
    while (i < lines.length && /^(Created|Completed) At:/.test(lines[i])) {
        i++;
    }
    return lines
        .slice(i)
        .join("\n")
        .replace(/^\s*\n/, "")
        .trimEnd();
}

function capResult(text: string): string {
    if (text.length <= RESULT_MAX_CHARS) {
        return text;
    }
    let end = RESULT_MAX_CHARS;
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
        end--; // never split a surrogate pair
    }
    return text.slice(0, end) + TRUNCATION_MARKER;
}

function applyResult(step: AgyStep, pending: PendingCall): void {
    const failed = step.status === "ERROR";
    const output = typeof step.content === "string" ? capResult(stripResultHeader(step.content)) : "";
    pending.action.outcome = failed ? "fail" : "ok";
    if (output !== "") {
        pending.action.detail = { kind: "bash", command: pending.command, output, exit: failed ? 1 : 0 };
    }
}

/** Pure: project agy transcript lines into ordered entries. USER_INPUT -> asked (the request only),
 *  PLANNER_RESPONSE content -> message and each tool call -> action (settled by the next GENERIC step:
 *  its output as a bash detail, outcome fail when status is ERROR). Thinking never renders. */
export function projectAgyTranscript(lines: string[]): AgentEntry[] {
    const entries: AgentEntry[] = [];
    const pending: PendingCall[] = [];
    for (const step of parseSteps(lines)) {
        switch (step.type) {
            case "USER_INPUT": {
                const text = userRequest(step);
                if (text !== "") {
                    entries.push({ kind: "user", text });
                }
                break;
            }
            case "PLANNER_RESPONSE": {
                if (typeof step.content === "string" && step.content.trim() !== "") {
                    entries.push({ kind: "message", text: step.content });
                }
                if (Array.isArray(step.tool_calls)) {
                    for (const call of step.tool_calls as AgyToolCall[]) {
                        const entry = toolEntry(call);
                        if (entry != null) {
                            entries.push(entry.action);
                            pending.push(entry);
                        }
                    }
                }
                break;
            }
            case "GENERIC": {
                const next = pending.shift();
                if (next != null) {
                    applyResult(step, next);
                }
                break;
            }
        }
    }
    return entries;
}

/** Pure: the session's display title — the first USER_REQUEST. */
export function extractAgyTitle(lines: string[]): string | undefined {
    for (const step of parseSteps(lines)) {
        if (step.type === "USER_INPUT") {
            const text = userRequest(step);
            if (text !== "") {
                return text;
            }
        }
    }
    return undefined;
}
