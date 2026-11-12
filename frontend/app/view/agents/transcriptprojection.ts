// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure projection of a Claude Code transcript (JSONL lines) into AgentEntry[].
// No React, no Wave runtime imports. Deterministic; no LLM (spec §5.3).

import { parseBtwNotice } from "../../../../claude/arc-mod/hooks/btw-core";
import type { AgentEntry, CardTask } from "./agentsviewmodel";
import { parseAnsiLines } from "./ansitext";
import { answerAsk, askQuestions, buildEditDiff, parseGrep, sliceRead, toolResultText } from "./tooldetail";

const READ_MODAL_MAX_LINES = 400; // bound stored Read body (modal view); inline uses the per-kind budget

// Claude Code (2.1.299+) also writes each message it sent the API as an api-request-blob record, a copy that repeats
// tool_use and tool_result blocks already in the transcript: a reader that does not check a record's type reads them
// again, and a tool_use read after its result starts over
function isRequestCopy(rec: any): boolean {
    return rec?.type === "api-request-blob";
}

const VERB_BY_TOOL: Record<string, string> = {
    Read: "read",
    Edit: "edited",
    Write: "wrote",
    Bash: "ran",
    Grep: "grep",
    Glob: "glob",
    Task: "spawned",
    Skill: "skill",
    AskUserQuestion: "asked",
};

/** Pure: did an errored Bash result come back without the command ever running? One that ran and failed starts with its
 *  exit code (`Exit code 1`; a timeout is `Exit code 143`), and one stopped mid-run says it was interrupted, so it may have
 *  run. Every other error is Claude Code refusing the call before it started: a hook (`Refused by arcterm: …`), a
 *  permission rule or the auto mode classifier, the person declining it, a malformed call. An empty body stays a failure. */
export function bashNeverRan(body: string): boolean {
    const t = body.trimStart();
    return t !== "" && !/^Exit code \d+/.test(t) && !/^(Interrupted\b|\[Tool call interrupted)/.test(t);
}

function verbFor(name: string): string {
    return VERB_BY_TOOL[name] ?? name.toLowerCase();
}

function baseName(p: string): string {
    const parts = p.split(/[/\\]/);
    return parts[parts.length - 1] || p;
}

// the most salient input field, in priority order
function targetFor(input: any): string {
    if (input == null) {
        return "";
    }
    if (typeof input.file_path === "string") {
        return baseName(input.file_path);
    }
    if (typeof input.pattern === "string") {
        return input.pattern;
    }
    if (typeof input.description === "string") {
        return input.description;
    }
    if (typeof input.command === "string") {
        return input.command;
    }
    if (typeof input.skill === "string") {
        return input.skill;
    }
    if (typeof input.questions?.[0]?.question === "string") {
        return input.questions[0].question;
    }
    return "";
}

type ActionEntry = AgentEntry & { kind: "action" };

// the tool a background subagent reports back with: plumbing, not work it did
const HANDBACK_TOOL = "SubagentHandback";

function parseCommand(content: string): { name: string; args?: string } | null {
    const nameMatch = /<command-name>([^]*?)<\/command-name>/.exec(content);
    if (nameMatch == null) {
        return null;
    }
    const raw = nameMatch[1].trim();
    const name = raw.startsWith("/") ? raw : "/" + raw;
    const argsMatch = /<command-args>([^]*?)<\/command-args>/.exec(content);
    const args = argsMatch ? argsMatch[1].trim() : "";
    return args !== "" ? { name, args } : { name };
}

// `! cmd` typed in Claude Code's box (bash mode) is written as a user record holding <bash-input>, then one holding
// <bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr> once it finishes
const BASH_INPUT = /^\s*<bash-input>([^]*)<\/bash-input>\s*$/;
const BASH_STDOUT = /<bash-stdout>([^]*?)<\/bash-stdout>/;
const BASH_STDERR = /<bash-stderr>([^]*?)<\/bash-stderr>/;
// what Claude Code writes as the stdout of a command that printed nothing: no output of the command's own
const BASH_NO_OUTPUT = "(Bash completed with no output)";

// captured output as plain text: the colours and cursor moves a terminal would draw, dropped
function plainOutput(text: string): string {
    return parseAnsiLines(text.split("\n"))
        .map((runs) => runs.map((r) => r.text).join(""))
        .join("\n")
        .trim();
}

// What a slash command printed comes after its command as a record of its own: a user string, or a system record of
// subtype local_command (a panel command such as /login writes its name that way too, and only once it closes)
const LOCAL_STDOUT = /<local-command-stdout>([^]*?)<\/local-command-stdout>/;
const LOCAL_STDERR = /<local-command-stderr>([^]*?)<\/local-command-stderr>/;

function isLocalOutput(content: string): boolean {
    return content.includes("<local-command-stdout>") || content.includes("<local-command-stderr>");
}

function joinOutput(a: string, b: string): string {
    return a === "" ? b : b === "" ? a : `${a}\n${b}`;
}

// puts a slash command's output on the command right before it, as bash mode's goes on its `!` command. One whose
// command is not in the lines read, follows a bash command, or printed nothing is dropped, never a bubble.
function attachLocalOutput(entries: AgentEntry[], content: string): void {
    const last = entries[entries.length - 1];
    if (last?.kind !== "command" || last.name === "!" || last.isSkill) {
        return;
    }
    const output = plainOutput(LOCAL_STDOUT.exec(content)?.[1] ?? "");
    const error = plainOutput(LOCAL_STDERR.exec(content)?.[1] ?? "");
    if (output === "" && error === "") {
        return;
    }
    last.shell =
        last.shell == null
            ? { output, error }
            : { output: joinOutput(last.shell.output, output), error: joinOutput(last.shell.error, error) };
}

// Claude interruption marker, both "[Request interrupted by user]" and the "...for tool use]" variant.
function isInterrupted(text: string): boolean {
    return text.trimStart().startsWith("[Request interrupted by user");
}

// A finished background Task/subagent arrives as a user-role record whose string content is a
// <task-notification> XML block. Parse the human-facing fields; the full <result> is the child's report.
function parseTaskNotification(content: string): Extract<AgentEntry, { kind: "notification" }> | null {
    if (!content.includes("<task-notification>")) {
        return null;
    }
    const grab = (tag: string): string | undefined => {
        const m = new RegExp(`<${tag}>([^]*?)</${tag}>`).exec(content);
        return m ? m[1].trim() : undefined;
    };
    const result = grab("result");
    return { kind: "notification", summary: grab("summary") ?? "", status: grab("status"), ...(result ? { result } : {}) };
}

// Claude Code wraps a compaction summary in text meant for the model: a preamble, a <system-reminder> block that runs
// straight into "Summary:" (markdown reads both as one raw HTML block up to the next blank line), and closing
// instructions with the transcript path. Only the summary itself is for the person.
const COMPACT_PREAMBLE = "This session is being continued from a previous conversation that ran out of context.";
const COMPACT_TAIL_MARKERS = [
    "If you need specific details from before compaction",
    "Continue the conversation from where it left off",
    "Please continue the conversation from where we left it off",
    "The messages after this summary are the most recent messages",
];

/** Pure: the part of a compaction summary a person reads, with the model-facing wrapper removed. */
export function compactSummaryText(raw: string): string {
    let text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
    const cut = Math.min(...COMPACT_TAIL_MARKERS.map((m) => text.indexOf(m)).filter((i) => i > 0));
    if (Number.isFinite(cut)) {
        text = text.slice(0, cut);
    }
    text = text.trim();
    if (text.startsWith(COMPACT_PREAMBLE)) {
        const para = text.indexOf("\n\n");
        text = para < 0 ? "" : text.slice(para).trim();
    }
    return text.replace(/^Summary:[ \t]*\n/, "").trim();
}

function mergeCompaction(entries: AgentEntry[], patch: Partial<Extract<AgentEntry, { kind: "compaction" }>>): void {
    const last = entries[entries.length - 1];
    if (last != null && last.kind === "compaction") {
        Object.assign(last, patch);
        return;
    }
    entries.push({ kind: "compaction", ...patch });
}

/** The turn under way: when its prompt was sent (NaN when the record has no time) and the output tokens of the model's
 *  replies since, as the TUI's "(1m 11s · ↓ 3.1k tokens)" counts them. */
export interface TurnStats {
    startedAt: number;
    outputTokens: number;
}

// a prompt you sent: a user record of your text, not a tool's result, a meta record or a compaction's summary (a
// message queued mid-turn is an attachment record, which joins the turn under way as the TUI's counter does)
function isPrompt(rec: any): boolean {
    if (rec?.type !== "user" || rec.isMeta === true || rec.isCompactSummary === true) {
        return false;
    }
    const content = rec.message?.content;
    if (typeof content === "string") {
        return content.trim() !== "";
    }
    return Array.isArray(content) && content.some((b: any) => b?.type === "text" && typeof b.text === "string");
}

/** Pure: the turn at the end of a Claude transcript, read back from its last line to its prompt: each reply's output
 *  tokens once (Claude Code writes every block of a reply as its own record, repeating the reply's usage; a request's
 *  copy is skipped). Null when the lines hold no prompt. */
export function turnStats(lines: string[]): TurnStats | null {
    const byReply = new Map<string, number>();
    for (let i = lines.length - 1; i >= 0; i--) {
        let rec: any;
        try {
            rec = JSON.parse(lines[i]);
        } catch {
            continue;
        }
        if (isPrompt(rec)) {
            const startedAt = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
            let outputTokens = 0;
            for (const n of byReply.values()) {
                outputTokens += n;
            }
            return { startedAt, outputTokens };
        }
        const out = rec?.message?.usage?.output_tokens;
        if (rec?.type === "assistant" && !isRequestCopy(rec) && typeof out === "number") {
            const id = typeof rec.message.id === "string" ? rec.message.id : `line:${i}`;
            byReply.set(id, Math.max(byReply.get(id) ?? 0, out));
        }
    }
    return null;
}

/** Pure: project transcript JSONL lines into ordered previous-info entries.
 *  assistant text -> message; tool_use -> action; tool_result -> outcome on the matching
 *  action (ok, fail on error, or blocked for a Bash refused before it ran; see bashNeverRan).
 *  Unparseable lines and unknown record types are skipped. */
export function projectTranscript(lines: string[]): AgentEntry[] {
    const entries: AgentEntry[] = [];
    const actionById = new Map<string, ActionEntry>();
    for (const line of lines) {
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        // A message queued while Claude worked and taken in mid-turn is written as an attachment, not a user record. Only
        // its `prompt` mode is a message of yours (a task-notification is drawn from its own record); it then goes the
        // user record's way, so text rules, task notifications and pasted images stay one code path.
        if (rec?.type === "attachment") {
            const queued = rec.attachment;
            if (queued?.type !== "queued_command" || queued.commandMode !== "prompt") {
                continue;
            }
            rec = { type: "user", message: { content: queued.prompt }, timestamp: rec.timestamp, uuid: rec.uuid };
        }
        // the record's own id, which a message of yours or a reply carries so Fork from here can cut the transcript at it
        const uuid = typeof rec?.uuid === "string" ? rec.uuid : undefined;
        const tag = uuid != null ? { uuid } : {};
        if (rec.type === "assistant") {
            const content = rec?.message?.content;
            if (!Array.isArray(content)) {
                continue;
            }
            for (const block of content) {
                if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
                    entries.push({ kind: "message", text: block.text, ...tag });
                    continue;
                }
                if (block?.type === "tool_use" && typeof block.name === "string") {
                    // no action is made for it, so its tool_result below finds none and is dropped too
                    if (block.name === HANDBACK_TOOL) {
                        continue;
                    }
                    // a Skill call is the agent's own step, drawn as a skill action: Claude Code writes caller "direct" on
                    // every tool call the model makes, and a skill you run arrives as a <command-name> user record
                    const action: ActionEntry = { kind: "action", verb: verbFor(block.name), target: targetFor(block.input) };
                    if (typeof block.input?.file_path === "string" && block.input.file_path !== "") {
                        action.path = block.input.file_path;
                    }
                    if (block.name === "Edit" && block.input && typeof block.input.old_string === "string") {
                        action.detail = {
                            kind: "edit",
                            files: [buildEditDiff(String(block.input.file_path ?? ""), block.input.old_string, String(block.input.new_string ?? ""))],
                        };
                    } else if (block.name === "Write" && block.input && typeof block.input.content === "string") {
                        action.detail = {
                            kind: "edit",
                            files: [buildEditDiff(String(block.input.file_path ?? ""), "", block.input.content)],
                        };
                    } else if (block.name === "Skill" && block.input && typeof block.input.skill === "string") {
                        const args = typeof block.input.args === "string" ? block.input.args.trim() : "";
                        action.detail = { kind: "skill", name: block.input.skill, args: args !== "" ? args : undefined };
                    } else if (block.name === "AskUserQuestion" && Array.isArray(block.input?.questions)) {
                        action.detail = { kind: "ask", questions: askQuestions(block.input.questions) };
                    }
                    // scratch fields (stripped before return): tool_use timestamp for duration, tool name for result
                    // routing, and the raw Bash command (the target line shows the human description instead).
                    (action as any)._useTs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
                    if (Number.isFinite((action as any)._useTs)) {
                        action.startedAt = (action as any)._useTs;
                    }
                    (action as any)._tool = block.name;
                    if (block.name === "Bash" && typeof block.input?.command === "string") {
                        (action as any)._command = block.input.command;
                    }
                    entries.push(action);
                    if (typeof block.id === "string") {
                        // same object lives in entries and the map; a later tool_result mutates
                        // outcome/detail through the map reference and the entries copy updates with it
                        actionById.set(block.id, action);
                    }
                }
            }
            continue;
        }
        if (rec.type === "user") {
            if (rec.isMeta === true) {
                continue;
            }
            if (rec.isCompactSummary === true) {
                const raw = rec?.message?.content;
                const summary =
                    typeof raw === "string"
                        ? raw
                        : Array.isArray(raw)
                          ? raw
                                .filter((b: any) => b?.type === "text")
                                .map((b: any) => b.text)
                                .join("\n")
                          : "";
                const text = compactSummaryText(summary);
                mergeCompaction(entries, text !== "" ? { summary: text } : {});
                continue;
            }
            const content = rec?.message?.content;
            if (typeof content === "string") {
                const note = parseTaskNotification(content);
                if (note != null) {
                    entries.push(note);
                } else if (isLocalOutput(content)) {
                    // a slash command's output ("Compacted …", with raw ANSI): it goes on its command, never a bubble
                    attachLocalOutput(entries, content);
                } else if (BASH_INPUT.test(content)) {
                    entries.push({ kind: "command", name: "!", args: BASH_INPUT.exec(content)![1].trim() });
                } else if (BASH_STDOUT.test(content) || BASH_STDERR.test(content)) {
                    // it goes on its command; one whose command is not in the lines read is dropped, never a bubble
                    const last = entries[entries.length - 1];
                    if (last?.kind === "command" && last.name === "!" && last.shell == null) {
                        const output = plainOutput(BASH_STDOUT.exec(content)?.[1] ?? "");
                        last.shell = {
                            output: output === BASH_NO_OUTPUT ? "" : output,
                            error: plainOutput(BASH_STDERR.exec(content)?.[1] ?? ""),
                        };
                    }
                } else if (isInterrupted(content)) {
                    entries.push({ kind: "interrupted" });
                } else {
                    const cmd = parseCommand(content);
                    if (cmd != null) {
                        entries.push({ kind: "command", ...cmd });
                    } else if (content.trim() !== "") {
                        entries.push({ kind: "user", text: content, ...tag });
                    }
                }
                continue;
            }
            if (!Array.isArray(content)) {
                continue;
            }
            // a pasted image rides in the same record as the prompt's text: it goes on that prompt, or is one alone
            const images = content.flatMap((b: any) =>
                b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string"
                    ? [`data:${b.source.media_type ?? "image/png"};base64,${b.source.data}`]
                    : []
            );
            let prompt: { kind: "user"; text: string; images?: string[]; uuid?: string } | undefined;
            for (const block of content) {
                if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
                    if (isInterrupted(block.text)) {
                        entries.push({ kind: "interrupted" });
                    } else {
                        prompt = { kind: "user", text: block.text, ...tag };
                        entries.push(prompt);
                    }
                    continue;
                }
                if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") {
                    continue;
                }
                const action = actionById.get(block.tool_use_id);
                if (action == null) {
                    continue;
                }
                const body = toolResultText(block.content);
                const tool = (action as any)._tool as string | undefined;
                // a refused command reads as blocked, not ran: it never started, and it is no failure of the work
                const blocked = tool === "Bash" && block.is_error === true && bashNeverRan(body);
                if (blocked) {
                    action.verb = "blocked";
                }
                if (tool === "Grep" && body) {
                    const matches = parseGrep(body);
                    action.detail = { kind: "grep", matches };
                    action.summary = `${matches.length} match${matches.length === 1 ? "" : "es"}`;
                } else if ((tool === "Read" || tool === "Glob") && body) {
                    const { snippet, truncated } = sliceRead(body, READ_MODAL_MAX_LINES);
                    action.detail = { kind: "read", snippet, truncated };
                    action.summary = `${body.split("\n").length} lines`;
                } else if (tool === "Bash" && body) {
                    action.detail = {
                        kind: "bash",
                        command: (action as any)._command,
                        output: body,
                        exit: blocked ? null : block.is_error === true ? 1 : 0,
                    };
                } else if (action.detail?.kind === "ask" && typeof rec.toolUseResult?.answers === "object") {
                    // the answers ride on the record, keyed by question text; a rejected call carries a string there
                    action.summary = answerAsk(action.detail.questions, rec.toolUseResult.answers ?? {});
                }
                const resTs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
                const useTs = (action as any)._useTs as number;
                if (Number.isFinite(resTs) && Number.isFinite(useTs) && resTs >= useTs) {
                    action.durationMs = resTs - useTs;
                }
                // a result that landed is an outcome, whatever the tool: a tool with none is still running (inFlight)
                action.outcome = blocked ? "blocked" : block.is_error === true ? "fail" : "ok";
            }
            if (images.length > 0) {
                if (prompt != null) {
                    prompt.images = images;
                } else if (!content.some((b: any) => b?.type === "tool_result")) {
                    entries.push({ kind: "user", text: "", images });
                }
            }
            continue;
        }
        // a /btw sent from Chat, which the arc mod answered with a fork of the session and wrote as a notice the model
        // never reads (stored as a system record of subtype informational): a /btw of yours, carrying its side answer
        const btw = rec.type === "system" && typeof rec.content === "string" ? parseBtwNotice(rec.content) : null;
        if (btw != null) {
            const { question, ...answer } = btw;
            entries.push({ kind: "command", name: "/btw", args: question, btw: answer });
            continue;
        }
        if (rec.type === "system" && rec.subtype === "local_command" && typeof rec.content === "string") {
            if (isLocalOutput(rec.content)) {
                attachLocalOutput(entries, rec.content);
            } else {
                const cmd = parseCommand(rec.content);
                if (cmd != null) {
                    entries.push({ kind: "command", ...cmd });
                }
            }
            continue;
        }
        if (rec.type === "system" && rec.subtype === "compact_boundary") {
            const m = rec.compactMetadata ?? {};
            const patch: Partial<Extract<AgentEntry, { kind: "compaction" }>> = {};
            if (typeof m.trigger === "string") {
                patch.trigger = m.trigger;
            }
            if (typeof m.preTokens === "number") {
                patch.preTokens = m.preTokens;
            }
            if (typeof m.postTokens === "number") {
                patch.postTokens = m.postTokens;
            }
            mergeCompaction(entries, patch);
            continue;
        }
    }
    // strip private scratch fields so they never leak into the AgentEntry contract
    for (const e of entries) {
        if (e.kind === "action") {
            delete (e as any)._useTs;
            delete (e as any)._tool;
            delete (e as any)._command;
        }
    }
    return entries;
}

/** Pure: the task list from the LATEST TodoWrite tool_use in the transcript, or undefined if the
 *  agent never wrote a todo list. `completed` -> done; every other status is not-done. Malformed
 *  todo entries (missing/non-string content) are skipped; an empty todo list yields []. */
export function extractTasks(lines: string[]): CardTask[] | undefined {
    let latest: unknown[] | undefined;
    for (const line of lines) {
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        if (rec?.type !== "assistant" || !Array.isArray(rec?.message?.content)) {
            continue;
        }
        for (const block of rec.message.content) {
            if (block?.type === "tool_use" && block.name === "TodoWrite" && Array.isArray(block.input?.todos)) {
                latest = block.input.todos;
            }
        }
    }
    if (latest == null) {
        return undefined;
    }
    const tasks: CardTask[] = [];
    for (const todo of latest) {
        const t = todo as any;
        if (typeof t?.content !== "string") {
            continue;
        }
        tasks.push({ text: t.content, done: t.status === "completed" });
    }
    return tasks;
}

/** Pure: the most recent ai-title in the transcript, or undefined. Claude Code emits multiple
 *  `{type:"ai-title", aiTitle}` records as the title is refined; the last one is current. */
export function extractAiTitle(lines: string[]): string | undefined {
    let title: string | undefined;
    for (const line of lines) {
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        if (rec?.type === "ai-title" && typeof rec.aiTitle === "string" && rec.aiTitle.trim() !== "") {
            title = rec.aiTitle;
        }
    }
    return title;
}

export interface SubagentSpawn {
    toolUseId: string;
    subagentType: string;
    prompt: string;
    done: boolean;
    failed: boolean;
    // a background agent: its tool_result was only the launch ack, so it is done (and failed or not) when a
    // <task-notification> names it; until then its own transcript is all that says whether it ended
    async?: true;
}

// how claude answers the tool_use of an agent it starts in the background, before the agent has done anything: the
// result's text is a receipt, and its record's toolUseResult says the agent went async
const ASYNC_LAUNCH_RECEIPT = "Async agent launched successfully";

// a tool_result that is that ack: either mark is enough, since the receipt's wording is not ours to rely on
function isAsyncLaunchAck(block: any, rec: any): boolean {
    return (
        block.is_error !== true &&
        (rec?.toolUseResult?.isAsync === true ||
            rec?.toolUseResult?.status === "async_launched" ||
            toolResultText(block.content).startsWith(ASYNC_LAUNCH_RECEIPT))
    );
}

// Ends the background spawns the <task-notification>s in a record name. A completed one is a success, any other end
// (failed, killed, stopped) a failure; a "running" one ends nothing. A foreground spawn is ended by its tool_result
// alone, so a notification that names one changes nothing.
function endBackgroundSpawns(spawns: Map<string, SubagentSpawn>, rec: any): void {
    for (const text of notificationTexts(rec)) {
        for (const note of text.matchAll(/<task-notification>[^]*?<\/task-notification>/g)) {
            const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(note[0])?.[1]?.trim();
            const status = NOTIFIED_STATUS[/<status>([^<]+)<\/status>/.exec(note[0])?.[1]?.trim() ?? ""];
            const s = toolUseId ? spawns.get(toolUseId) : undefined;
            if (s?.async && status != null && status !== "running") {
                s.done = true;
                s.failed = status !== "completed";
            }
        }
    }
}

/** Pure: Task/Agent tool_use blocks in a Claude transcript -> subagent spawns, each joined to its
 *  tool_result by tool_use_id (done + failed via is_error). A spawn with no matching result is still
 *  running (done=false), and so is a background one whose result was only its launch ack (async) until a
 *  <task-notification> naming its tool-use id ends it: completed is done, any other status failed.
 *  Spawns keep first-seen order; non-Task tools are ignored. */
export function extractSubagentSpawns(lines: string[]): SubagentSpawn[] {
    const spawns = new Map<string, SubagentSpawn>();
    const order: string[] = [];
    for (const line of lines) {
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        if (isRequestCopy(rec)) {
            continue;
        }
        const content = rec?.message?.content;
        for (const block of Array.isArray(content) ? content : []) {
            if (
                block?.type === "tool_use" &&
                (block.name === "Task" || block.name === "Agent") &&
                typeof block.id === "string"
            ) {
                const input = block.input ?? {};
                spawns.set(block.id, {
                    toolUseId: block.id,
                    subagentType: typeof input.subagent_type === "string" ? input.subagent_type : "",
                    prompt: typeof input.prompt === "string" ? input.prompt : "",
                    done: false,
                    failed: false,
                });
                order.push(block.id);
            } else if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
                const s = spawns.get(block.tool_use_id);
                if (s && isAsyncLaunchAck(block, rec)) {
                    s.async = true;
                } else if (s) {
                    s.done = true;
                    s.failed = block.is_error === true;
                }
            }
        }
        if (line.includes("<task-notification>")) {
            endBackgroundSpawns(spawns, rec);
        }
    }
    return order.map((id) => spawns.get(id)!);
}

export type BackgroundTaskStatus = "running" | "completed" | "failed" | "stopped";

/** One thing a Monitor reported: its notification's <event> body. */
export interface MonitorEvent {
    ts?: number; // when it was delivered: its record's timestamp
    lines: string[]; // its text, a line each
}

export interface BackgroundTask {
    toolUseId: string;
    taskId?: string;
    label: string;
    command?: string;
    status: BackgroundTaskStatus;
    outputFile?: string; // where Claude Code writes the command's output, from its start result or its notification
    monitor?: true; // a Monitor, which only watches, not a shell command
    startMs?: number; // when the agent ran the command: its tool_use record's timestamp
    endMs?: number; // when it ended: the first notification that gave it an end status
    // a Monitor only
    timeoutMs?: number; // how long it runs before it expires, from its start result
    persistent?: boolean; // it never expires, from its start result
    events?: MonitorEvent[]; // what it has reported so far, oldest first; empty until it reports
}

/** Pure: when a Monitor expires, or null for a shell task, a persistent Monitor, or one whose start or timeout is not
 *  known. */
export function monitorExpiresAt(
    t: Pick<BackgroundTask, "monitor" | "persistent" | "startMs" | "timeoutMs">
): number | null {
    if (!t.monitor || t.persistent || t.startMs == null || t.timeoutMs == null) {
        return null;
    }
    return t.startMs + t.timeoutMs;
}

/** Pure: the tasks of an agent still running, which ending its process would end too. */
export function runningBackgroundTasks(tasks: BackgroundTask[] | undefined): BackgroundTask[] {
    return (tasks ?? []).filter((t) => t.status === "running");
}

// the shell tools that take run_in_background (PowerShell is Claude Code's Windows shell tool)
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

// a start result opens with it; a foreground command whose output only quotes one (a grep of a transcript) is no task
const BG_ID_TEXT = /^\s*Command running in background with ID: ([A-Za-z0-9_-]+)/;
// a Monitor's start result: "Monitor started (task <id>, expires in 30m…"
const MONITOR_ID_TEXT = /Monitor started \(task ([A-Za-z0-9_-]+)/;
// a Monitor's expiry comes as one of its events, which name only its task id and carry no status
const MONITOR_EXPIRED = /<event>\s*\[Monitor expired\b/;
// the start result's "Output is being written to: <path>. You will be notified…"; the path runs to the sentence's end
const BG_OUTPUT_TEXT = /Output is being written to: (.+?)\.(?:\s|$)/;

// <task-notification> status -> ours; "killed" and "stopped" are the same thing to the reader
const NOTIFIED_STATUS: Record<string, BackgroundTaskStatus> = {
    running: "running",
    completed: "completed",
    failed: "failed",
    killed: "stopped",
    stopped: "stopped",
};

// A notification can arrive as a user message, a queue-operation's content or a queued-command attachment, so
// every string in the record that carries the tag is read rather than one known field.
function notificationTexts(rec: any): string[] {
    const out: string[] = [];
    const visit = (v: any, depth: number): void => {
        if (typeof v === "string") {
            if (v.includes("<task-notification>")) {
                out.push(v);
            }
            return;
        }
        if (depth >= 5 || v == null || typeof v !== "object") {
            return;
        }
        for (const k of Object.keys(v)) {
            visit(v[k], depth + 1);
        }
    };
    visit(rec, 0);
    return out;
}

// a Monitor's event: a notification for a task id with an <event> body and no status. Its expiry notice is one too,
// but it ends the Monitor and reports nothing from it.
function monitorEventOf(text: string): { id: string; body: string } | undefined {
    if (text.includes("<status>") || MONITOR_EXPIRED.test(text)) {
        return undefined;
    }
    const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim();
    const body = /<event>([^]*?)<\/event>/.exec(text)?.[1]?.trim();
    return id && body !== undefined ? { id, body } : undefined;
}

/** Pure: the shell (Bash/PowerShell) commands a Claude transcript ran in the background — started with
 *  run_in_background, or a foreground command auto-backgrounded at its timeout (its result carries a
 *  backgroundTaskId) — and the Monitors it armed (a task once its result names the task id), each with the
 *  status its <task-notification> (joined by tool-use-id), a Monitor's expiry notice or a later TaskStop/KillShell
 *  gave it. Unresolved tasks stay "running"; the caller decides what that means for a session that is no longer
 *  live. First-seen order. Background subagents are left to extractSubagentSpawns.
 *
 *  A Monitor also carries its timeout and what it reported: its events are its status-less notifications, each
 *  written as an enqueue and then as a user record or a queued_command attachment, so a copy counts only when no
 *  enqueue of the same body is waiting for it. A Monitor past its timeout writes no record, so with `now` a
 *  running one that is past its expiry reads stopped at the expiry; without it the clock is not consulted. */
export function extractBackgroundTasks(lines: string[], opts: { now?: number } = {}): BackgroundTask[] {
    const calls = new Map<string, { label: string; command?: string; ts: number; monitor: boolean }>();
    const tasks = new Map<string, BackgroundTask>();
    const byTaskId = new Map<string, BackgroundTask>();
    // per Monitor task id, the enqueued event bodies whose copy is still to come
    const pendingEvents = new Map<string, string[]>();
    const startTask = (toolUseId: string): BackgroundTask | undefined => {
        const existing = tasks.get(toolUseId);
        const call = calls.get(toolUseId);
        if (existing || !call) {
            return existing;
        }
        const t: BackgroundTask = { toolUseId, label: call.label, status: "running" };
        if (call.command !== undefined) {
            t.command = call.command;
        }
        if (!Number.isNaN(call.ts)) {
            t.startMs = call.ts;
        }
        if (call.monitor) {
            t.monitor = true;
            t.events = [];
        }
        tasks.set(toolUseId, t);
        return t;
    };
    const addMonitorEvent = (task: BackgroundTask | undefined, body: string, rec: any, ts: number): void => {
        if (!task?.monitor || !task.taskId) {
            return;
        }
        const pending = pendingEvents.get(task.taskId) ?? [];
        if (rec?.type === "queue-operation") {
            pendingEvents.set(task.taskId, [...pending, body]);
        } else {
            const copyOf = pending.indexOf(body);
            if (copyOf >= 0) {
                pending.splice(copyOf, 1);
                return;
            }
        }
        task.events!.push({ ...(Number.isNaN(ts) ? {} : { ts }), lines: body.split(/\r?\n/) });
    };
    for (const line of lines) {
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        if (isRequestCopy(rec)) {
            continue;
        }
        const ts = typeof rec?.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
        const content = rec?.message?.content;
        if (Array.isArray(content)) {
            for (const block of content) {
                if (block?.type === "tool_use" && typeof block.id === "string") {
                    const input = block.input ?? {};
                    if (SHELL_TOOLS.has(block.name) || block.name === "Monitor") {
                        const command = typeof input.command === "string" ? input.command : undefined;
                        const desc = typeof input.description === "string" ? input.description.trim() : "";
                        const monitor = block.name === "Monitor";
                        calls.set(block.id, { label: desc || command || "background command", command, ts, monitor });
                        if (input.run_in_background === true) {
                            startTask(block.id);
                        }
                    } else if (block.name === "TaskStop" || block.name === "KillShell") {
                        const id = typeof input.task_id === "string" ? input.task_id : input.shell_id;
                        const t = typeof id === "string" ? byTaskId.get(id) : undefined;
                        if (t) {
                            t.status = "stopped";
                        }
                    }
                } else if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
                    const call = calls.get(block.tool_use_id);
                    if (!call) {
                        continue;
                    }
                    const fromRecord = call.monitor ? rec?.toolUseResult?.taskId : rec?.toolUseResult?.backgroundTaskId;
                    const taskId =
                        typeof fromRecord === "string"
                            ? fromRecord
                            : (call.monitor ? MONITOR_ID_TEXT : BG_ID_TEXT).exec(toolResultText(block.content))?.[1];
                    if (taskId) {
                        const t = startTask(block.tool_use_id)!;
                        t.taskId = taskId;
                        byTaskId.set(taskId, t);
                        if (call.monitor && typeof rec?.toolUseResult?.timeoutMs === "number") {
                            t.timeoutMs = rec.toolUseResult.timeoutMs;
                            t.persistent = rec.toolUseResult.persistent === true;
                        }
                        const outputFile = BG_OUTPUT_TEXT.exec(toolResultText(block.content))?.[1]?.trim();
                        if (outputFile) {
                            t.outputFile = outputFile;
                        }
                    } else if (block.is_error === true) {
                        // refused before it started (a hook's deny, a bad input): it never ran
                        tasks.delete(block.tool_use_id);
                    }
                }
            }
        }
        if (line.includes("<task-notification>")) {
            for (const text of notificationTexts(rec)) {
                const event = monitorEventOf(text);
                if (event) {
                    addMonitorEvent(byTaskId.get(event.id), event.body, rec, ts);
                    continue;
                }
                const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text)?.[1]?.trim();
                const status =
                    NOTIFIED_STATUS[/<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim() ?? ""] ??
                    (MONITOR_EXPIRED.test(text) ? "stopped" : undefined);
                const outputFile = /<output-file>([^<]+)<\/output-file>/.exec(text)?.[1]?.trim();
                // a resumed session's orphan summary carries no tool-use-id, only one <task-id> per unfinished task
                const targets = toolUseId
                    ? [tasks.get(toolUseId)]
                    : [...text.matchAll(/<task-id>([^<]+)<\/task-id>/g)].map((m) => byTaskId.get(m[1].trim()));
                for (const t of targets) {
                    if (t && status) {
                        t.status = status;
                        // one notification is written several times (queued, then dequeued): the earliest is the end
                        if (status !== "running" && !Number.isNaN(ts) && (t.endMs == null || ts < t.endMs)) {
                            t.endMs = ts;
                        }
                    }
                    if (t && outputFile) {
                        t.outputFile = outputFile;
                    }
                }
            }
        }
    }
    if (opts.now != null) {
        for (const t of tasks.values()) {
            const expires = t.status === "running" ? monitorExpiresAt(t) : null;
            if (expires != null && opts.now >= expires) {
                t.status = "stopped";
                t.endMs = expires;
            }
        }
    }
    return [...tasks.values()];
}
