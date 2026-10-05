// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure projection of a Claude Code transcript (JSONL lines) into AgentEntry[].
// No React, no Wave runtime imports. Deterministic; no LLM (spec §5.3).

import type { AgentEntry, CardTask } from "./agentsviewmodel";
import { buildEditDiff, parseGrep, sliceRead, toolResultText } from "./tooldetail";

const READ_MODAL_MAX_LINES = 400; // bound stored Read body (modal view); inline uses the per-kind budget

const VERB_BY_TOOL: Record<string, string> = {
    Read: "read",
    Edit: "edited",
    Write: "wrote",
    Bash: "ran",
    Grep: "grep",
    Glob: "glob",
    Task: "spawned",
    Skill: "skill",
};

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
    return "";
}

type ActionEntry = AgentEntry & { kind: "action" };

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

function skillLeaf(skill: string): string {
    const parts = skill.split(":");
    return parts[parts.length - 1] || skill;
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

function mergeCompaction(entries: AgentEntry[], patch: Partial<Extract<AgentEntry, { kind: "compaction" }>>): void {
    const last = entries[entries.length - 1];
    if (last != null && last.kind === "compaction") {
        Object.assign(last, patch);
        return;
    }
    entries.push({ kind: "compaction", ...patch });
}

/** Pure: project transcript JSONL lines into ordered previous-info entries.
 *  assistant text -> message; tool_use -> action; tool_result -> outcome on the matching
 *  action (fail on error; ok only for "ran", to avoid a checkmark on every read/edit).
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
        if (rec.type === "assistant") {
            const content = rec?.message?.content;
            if (!Array.isArray(content)) {
                continue;
            }
            for (const block of content) {
                if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
                    entries.push({ kind: "message", text: block.text });
                    continue;
                }
                if (block?.type === "tool_use" && typeof block.name === "string") {
                    if (block.name === "Skill" && block?.caller?.type === "direct" && typeof block.input?.skill === "string") {
                        const args = typeof block.input.args === "string" ? block.input.args.trim() : "";
                        entries.push({
                            kind: "command",
                            name: skillLeaf(block.input.skill),
                            isSkill: true,
                            ...(args !== "" ? { args } : {}),
                        });
                        continue;
                    }
                    const action: ActionEntry = { kind: "action", verb: verbFor(block.name), target: targetFor(block.input) };
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
                    }
                    // scratch fields (stripped before return): tool_use timestamp for duration, tool name for result
                    // routing, and the raw Bash command (the target line shows the human description instead).
                    (action as any)._useTs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
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
                mergeCompaction(entries, summary.trim() !== "" ? { summary } : {});
                continue;
            }
            const content = rec?.message?.content;
            if (typeof content === "string") {
                const note = parseTaskNotification(content);
                if (note != null) {
                    entries.push(note);
                } else if (content.includes("<local-command-stdout>")) {
                    // slash-command stdout (e.g. "Compacted …", with raw ANSI) — not shown, matching the
                    // system/local_command record that is already skipped. Never a user bubble.
                } else if (isInterrupted(content)) {
                    entries.push({ kind: "interrupted" });
                } else {
                    const cmd = parseCommand(content);
                    if (cmd != null) {
                        entries.push({ kind: "command", ...cmd });
                    } else if (content.trim() !== "") {
                        entries.push({ kind: "user", text: content });
                    }
                }
                continue;
            }
            if (!Array.isArray(content)) {
                continue;
            }
            for (const block of content) {
                if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
                    entries.push(isInterrupted(block.text) ? { kind: "interrupted" } : { kind: "user", text: block.text });
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
                        exit: block.is_error === true ? 1 : 0,
                    };
                }
                const resTs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
                const useTs = (action as any)._useTs as number;
                if (Number.isFinite(resTs) && Number.isFinite(useTs) && resTs >= useTs) {
                    action.durationMs = resTs - useTs;
                }
                if (block.is_error === true) {
                    action.outcome = "fail";
                } else if (action.verb === "ran") {
                    action.outcome = "ok";
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
}

/** Pure: Task/Agent tool_use blocks in a Claude transcript -> subagent spawns, each joined to its
 *  tool_result by tool_use_id (done + failed via is_error). A spawn with no matching result is still
 *  running (done=false). Spawns keep first-seen order; non-Task tools are ignored. */
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
        const content = rec?.message?.content;
        if (!Array.isArray(content)) {
            continue;
        }
        for (const block of content) {
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
                if (s) {
                    s.done = true;
                    s.failed = block.is_error === true;
                }
            }
        }
    }
    return order.map((id) => spawns.get(id)!);
}

export type BackgroundTaskStatus = "running" | "completed" | "failed" | "stopped";

export interface BackgroundTask {
    toolUseId: string;
    taskId?: string;
    label: string;
    command?: string;
    status: BackgroundTaskStatus;
}

// the shell tools that take run_in_background (PowerShell is Claude Code's Windows shell tool)
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

const BG_ID_TEXT = /running in background with ID: ([A-Za-z0-9_-]+)/;

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

/** Pure: the shell (Bash/PowerShell) commands a Claude transcript ran in the background — started with
 *  run_in_background, or a foreground command auto-backgrounded at its timeout (its result carries a
 *  backgroundTaskId) — each with the
 *  status its <task-notification> (joined by tool-use-id) or a later TaskStop/KillShell gave it. Unresolved
 *  tasks stay "running"; the caller decides what that means for a session that is no longer live. First-seen
 *  order. Background subagents are left to extractSubagentSpawns. */
export function extractBackgroundTasks(lines: string[]): BackgroundTask[] {
    const calls = new Map<string, { label: string; command?: string }>();
    const tasks = new Map<string, BackgroundTask>();
    const byTaskId = new Map<string, BackgroundTask>();
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
        tasks.set(toolUseId, t);
        return t;
    };
    for (const line of lines) {
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        const content = rec?.message?.content;
        if (Array.isArray(content)) {
            for (const block of content) {
                if (block?.type === "tool_use" && typeof block.id === "string") {
                    const input = block.input ?? {};
                    if (SHELL_TOOLS.has(block.name)) {
                        const command = typeof input.command === "string" ? input.command : undefined;
                        const desc = typeof input.description === "string" ? input.description.trim() : "";
                        calls.set(block.id, { label: desc || command || "background command", command });
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
                    if (!calls.has(block.tool_use_id)) {
                        continue;
                    }
                    const fromRecord = rec?.toolUseResult?.backgroundTaskId;
                    const taskId =
                        typeof fromRecord === "string"
                            ? fromRecord
                            : BG_ID_TEXT.exec(toolResultText(block.content))?.[1];
                    if (taskId) {
                        const t = startTask(block.tool_use_id)!;
                        t.taskId = taskId;
                        byTaskId.set(taskId, t);
                    }
                }
            }
        }
        if (line.includes("<task-notification>")) {
            for (const text of notificationTexts(rec)) {
                const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text)?.[1]?.trim();
                const status = NOTIFIED_STATUS[/<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim() ?? ""];
                const t = toolUseId ? tasks.get(toolUseId) : undefined;
                if (t && status) {
                    t.status = status;
                }
            }
        }
    }
    return [...tasks.values()];
}
