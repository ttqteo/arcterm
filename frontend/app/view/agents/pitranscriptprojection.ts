// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure projection of a Pi v3 native session transcript (JSONL lines) into AgentEntry[].
// No React, no Wave runtime imports. Deterministic; no LLM. Sibling of transcriptprojection.ts
// (Claude Code) and codextranscriptprojection.ts (Codex); both produce the shared AgentEntry[]
// contract, selected via the projection registry.
//
// Renders the same entry kinds as the Claude projector, adapted to Pi's record shapes:
// skill invocations are user messages carrying a <skill> block (chip + separate user bubble,
// mirroring Pi's own TUI parse); edit/write calls carry inline diffs; read/grep/bash results
// enrich their action with detail (routed by the result's toolName); TaskCreate/TaskUpdate/
// TaskList power the card task list (extractPiTasks); subagent/TaskExecute read as "spawned".
//
// Pi records are parent-linked ({id, parentId}): abandoned sibling branches stay on disk but are
// never rendered. The active branch is the parent chain of the final record, projected root-first.
// Malformed lines are skipped; a broken/missing/cyclic parent chain terminates at the reachable
// suffix instead of erroring — strict file diagnostics are backend-owned (pkg/pisession), the
// frontend projection must survive any file shape.

import type { AgentEntry, CardTask } from "./agentsviewmodel";
import { buildEditDiff, parseGrep, sliceRead, toolResultText } from "./tooldetail";

const READ_MODAL_MAX_LINES = 400; // bound stored Read body (modal view); inline uses the per-kind budget

interface PiBlock {
    type?: string;
    text?: string;
    id?: string;
    toolCallId?: string;
    name?: string;
    args?: unknown;
    arguments?: unknown;
    isError?: boolean;
    is_error?: boolean;
}

interface PiMessage {
    role?: string;
    content?: unknown;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    is_error?: boolean;
}

interface PiRecord {
    type?: string;
    id?: string;
    parentId?: string | null;
    timestamp?: string;
    message?: PiMessage;
    name?: string;
    summary?: string;
    tokensBefore?: number;
}

// Pi tool names are lowercase file tools plus the capitalized pi-tasks / pi-subagents family.
// Verbs match the Claude projector's vocabulary so shared renderers read identically.
const VERB_BY_TOOL: Record<string, string> = {
    bash: "ran",
    read: "read",
    write: "wrote",
    edit: "edited",
    grep: "grep",
    ls: "listed",
    find: "searched",
    TaskCreate: "created task",
    TaskUpdate: "updated task",
    TaskList: "listed tasks",
    TaskGet: "read task",
    TaskExecute: "spawned",
    subagent: "spawned",
};

function verbFor(name: string): string {
    return VERB_BY_TOOL[name] ?? name.toLowerCase();
}

function baseName(p: string): string {
    const parts = p.split(/[/\\]/);
    return parts[parts.length - 1] || p;
}

const FILE_TOOLS = new Set(["read", "write", "edit"]);

// the target line for a tool call: the bash command, else a file/pattern when the args carry one,
// else a task subject/id for the task tools, else the tool name (bare verb line).
function targetFor(name: string, args: unknown): string {
    if (typeof args === "string") {
        return args.trim();
    }
    if (args != null && typeof args === "object") {
        const a = args as Record<string, unknown>;
        if (typeof a.command === "string" && a.command.trim() !== "") {
            return a.command.trim();
        }
        if (typeof a.path === "string" && a.path !== "") {
            return baseName(a.path);
        }
        if (typeof a.pattern === "string" && a.pattern !== "") {
            return a.pattern;
        }
        if (typeof a.subject === "string" && a.subject !== "") {
            return a.subject;
        }
        if (typeof a.taskId === "string" && a.taskId !== "") {
            return `task #${a.taskId}`;
        }
        if (Array.isArray(a.task_ids)) {
            return a.task_ids.map((t: unknown) => `task #${String(t)}`).join(", ");
        }
        if (typeof a.agent === "string" && a.agent !== "") {
            return a.agent;
        }
    }
    return name;
}

function textBlocks(content: unknown): string[] {
    if (typeof content === "string") {
        return content.trim() === "" ? [] : [content.trim()];
    }
    if (!Array.isArray(content)) {
        return [];
    }
    const out: string[] = [];
    for (const b of content as PiBlock[]) {
        if (b != null && b.type === "text" && typeof b.text === "string" && b.text.trim() !== "") {
            out.push(b.text);
        }
    }
    return out;
}

type ActionEntry = AgentEntry & { kind: "action" };

// Edit details are derived from the call's args (no result round-trip needed); the raw args keep
// buildEditDiff in sync with the tool schemas (edit: {path, edits:[{oldText,newText}]}, write:
// {path, content}).
function editDetailFor(name: string, args: unknown): ActionEntry["detail"] {
    if (args == null || typeof args !== "object") {
        return undefined;
    }
    const a = args as Record<string, unknown>;
    const path = typeof a.path === "string" ? a.path : "";
    if (name === "write" && typeof a.content === "string") {
        return { kind: "edit", files: [buildEditDiff(path, "", a.content)] };
    }
    if (name === "edit" && Array.isArray(a.edits)) {
        const files = a.edits
            .filter((e): e is { oldText: string; newText: string } => {
                const ed = e as { oldText?: unknown; newText?: unknown };
                return typeof ed.oldText === "string" && typeof ed.newText === "string";
            })
            .map((e) => buildEditDiff(path, e.oldText, e.newText));
        if (files.length > 0) {
            return { kind: "edit", files };
        }
    }
    return undefined;
}

function mapAssistantContent(rec: PiRecord, entries: AgentEntry[], actionById: Map<string, ActionEntry>): void {
    const content = rec.message?.content;
    for (const text of textBlocks(content)) {
        entries.push({ kind: "message", text });
    }
    if (!Array.isArray(content)) {
        return;
    }
    for (const b of content as PiBlock[]) {
        // Pi records tool calls as {type:"toolCall", id, name, arguments}; tolerate the older
        // tool_use/toolCallId/args spelling too so both file generations project.
        if (b == null || (b.type !== "toolCall" && b.type !== "tool_use") || typeof b.name !== "string" || b.name === "") {
            continue;
        }
        const args = b.arguments ?? b.args;
        const action: ActionEntry = { kind: "action", verb: verbFor(b.name), target: targetFor(b.name, args) };
        const p = args != null && typeof args === "object" ? (args as Record<string, unknown>).path : undefined;
        if (FILE_TOOLS.has(b.name) && typeof p === "string" && p !== "") {
            action.path = p;
        }
        const detail = editDetailFor(b.name, args);
        if (detail) {
            action.detail = detail;
        }
        // scratch fields (stripped before return): tool name for result routing, tool_use timestamp
        // (the assistant record's) for duration, and the raw bash command (the target line shows
        // the human description instead)
        (action as any)._tool = b.name;
        (action as any)._useTs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
        if (b.name === "bash" && args != null && typeof args === "object") {
            const command = (args as Record<string, unknown>).command;
            if (typeof command === "string") {
                (action as any)._command = command;
            }
        }
        entries.push(action);
        const callId = typeof b.toolCallId === "string" && b.toolCallId !== "" ? b.toolCallId : typeof b.id === "string" ? b.id : "";
        if (callId !== "") {
            actionById.set(callId, action);
        }
    }
}

// Pi tool results are their own message record (role "toolResult"); the call id lives on the
// message, the tool name identifies which detail to attach, and the failure flag may be
// message-level or on a content block. Never rendered as a user entry — it only settles the
// matching action's outcome and detail.
function applyToolResult(rec: PiRecord, actionById: Map<string, ActionEntry>): void {
    const msg = rec.message;
    if (msg == null) {
        return;
    }
    let toolCallId = typeof msg.toolCallId === "string" ? msg.toolCallId : "";
    if (toolCallId === "" && Array.isArray(msg.content)) {
        for (const b of msg.content as PiBlock[]) {
            if (b?.type === "tool_result" && typeof b.toolCallId === "string") {
                toolCallId = b.toolCallId;
                break;
            }
        }
    }
    if (toolCallId === "") {
        return;
    }
    const action = actionById.get(toolCallId);
    if (action == null) {
        return;
    }
    const failed = toolResultFailed(msg);
    const tool = (action as any)._tool as string | undefined;
    const body = toolResultText(msg.content);
    if (tool === "read" && body) {
        const { snippet, truncated } = sliceRead(body, READ_MODAL_MAX_LINES);
        action.detail = { kind: "read", snippet, truncated };
        action.summary = `${body.split("\n").length} lines`;
    } else if (tool === "grep" && body) {
        const matches = parseGrep(body);
        action.detail = { kind: "grep", matches };
        action.summary = `${matches.length} match${matches.length === 1 ? "" : "es"}`;
    } else if (tool === "bash" && body) {
        action.detail = {
            kind: "bash",
            command: (action as any)._command as string | undefined,
            output: body,
            exit: failed ? 1 : 0,
        };
    }
    const resTs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
    const useTs = (action as any)._useTs as number;
    if (Number.isFinite(resTs) && Number.isFinite(useTs) && resTs >= useTs) {
        action.durationMs = resTs - useTs;
    }
    if (failed) {
        action.outcome = "fail";
    } else if (action.verb === "ran") {
        action.outcome = "ok";
    }
}

function toolResultFailed(msg: PiMessage): boolean {
    if (msg.isError === true || msg.is_error === true) {
        return true;
    }
    if (Array.isArray(msg.content)) {
        for (const b of msg.content as PiBlock[]) {
            if (b?.type === "tool_result" && (b.isError === true || b.is_error === true)) {
                return true;
            }
        }
    }
    return false;
}

// A Pi skill invocation is a user message whose text is a <skill> block (expanded from /skill:name
// or a prompt-template by Pi's own _expandSkillCommand). Mirrors Pi's parseSkillBlock so the
// cockpit splits it the same way Pi's TUI does: a skill chip + the trailing user message.
function parseSkillBlock(text: string): { name: string; userMessage?: string } | null {
    const m = /^<skill name="([^"]+)" location="[^"]+">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/.exec(text);
    if (m == null) {
        return null;
    }
    return { name: m[1], userMessage: m[3]?.trim() || undefined };
}

function skillLeaf(skill: string): string {
    const parts = skill.split(":");
    return parts[parts.length - 1] || skill;
}

function mapUserMessage(text: string, entries: AgentEntry[]): void {
    const skill = parseSkillBlock(text);
    if (skill != null) {
        entries.push({ kind: "command", name: skillLeaf(skill.name), isSkill: true });
        if (skill.userMessage) {
            entries.push({ kind: "user", text: skill.userMessage });
        }
        return;
    }
    entries.push({ kind: "user", text });
}

function mapRecord(rec: PiRecord, entries: AgentEntry[], actionById: Map<string, ActionEntry>): void {
    if (rec == null || rec.type !== "message" || rec.message == null) {
        return;
    }
    const msg = rec.message;
    if (msg.role === "user") {
        for (const text of textBlocks(msg.content)) {
            mapUserMessage(text, entries);
        }
        return;
    }
    if (msg.role === "assistant") {
        mapAssistantContent(rec, entries, actionById);
        return;
    }
    if (msg.role === "toolResult") {
        applyToolResult(rec, actionById);
    }
}

// Parse valid records, tolerating malformed lines (skipped). A v3 session starts with a header and
// every later record carries id + parentId; the header itself and non-message entries (model_change,
// compaction, branch_summary, session_info) simply produce no entry.
function parseRecords(lines: string[]): PiRecord[] {
    const records: PiRecord[] = [];
    for (const line of lines) {
        try {
            const rec = JSON.parse(line) as PiRecord;
            if (rec != null) {
                records.push(rec);
            }
        } catch {
            // malformed line: skip
        }
    }
    return records;
}

// activeBranch follows parentId from the final record to a root, returning indices root-first.
// A missing parent or a cycle terminates at the reachable suffix (frontend safety; the backend
// parser reports these as errors instead).
function activeBranch(records: PiRecord[]): number[] {
    if (records.length === 0) {
        return [];
    }
    const idxById = new Map<string, number>();
    records.forEach((rec, i) => {
        if (rec != null && typeof rec.id === "string" && rec.id !== "") {
            idxById.set(rec.id, i);
        }
    });
    const chain: number[] = [];
    const onChain = new Set<number>();
    let cur = records.length - 1;
    for (;;) {
        if (cur < 0 || onChain.has(cur)) {
            break;
        }
        onChain.add(cur);
        chain.push(cur);
        const rec = records[cur];
        const parentId = rec?.parentId;
        if (parentId == null || parentId === "") {
            break;
        }
        const parent = idxById.get(parentId);
        if (parent == null) {
            break;
        }
        cur = parent;
    }
    return chain.reverse();
}

/** Pure: project Pi v3 JSONL lines into ordered entries, following only the active parent branch.
 *  user -> asked (skill blocks become a skill chip + the trailing text), assistant text -> message,
 *  toolCall -> action (joined to its toolResult by toolCallId; read/grep/bash enrich with detail,
 *  edit/write carry inline diffs), compaction -> compaction. branch_summary / model_change /
 *  session_info never render. */
export function projectPiTranscript(lines: string[]): AgentEntry[] {
    const records = parseRecords(lines);
    const branch = activeBranch(records);
    const entries: AgentEntry[] = [];
    const actionById = new Map<string, ActionEntry>();
    for (const idx of branch) {
        const rec = records[idx];
        if (rec?.type === "compaction") {
            const entry: AgentEntry = { kind: "compaction" };
            if (typeof rec.summary === "string" && rec.summary.trim() !== "") {
                entry.summary = rec.summary;
            }
            if (typeof rec.tokensBefore === "number") {
                entry.preTokens = rec.tokensBefore;
            }
            entries.push(entry);
            continue;
        }
        mapRecord(rec, entries, actionById);
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

const TASK_CREATED_RE = /^Task #(\d+) created successfully: (.+)$/;
const TASK_LIST_RE = /^#(\d+) \[(\w+)\] (.+)$/;

/** Pure: the card task list from the pi-tasks tools in the transcript, or undefined when the agent
 *  never used them. TaskCreate results ("Task #N created successfully: X") seed subjects,
 *  TaskUpdate {taskId, status} flips done flags, and a TaskList result ("#N [status] subject") is a
 *  full snapshot. `completed` -> done; every other status is not-done. Tasks keep creation order. */
export function extractPiTasks(lines: string[]): CardTask[] | undefined {
    const byId = new Map<string, { text: string; done: boolean }>();
    const order: string[] = [];
    for (const line of lines) {
        let rec: PiRecord;
        try {
            rec = JSON.parse(line) as PiRecord;
        } catch {
            continue;
        }
        if (rec?.type !== "message" || rec.message == null) {
            continue;
        }
        const msg = rec.message;
        if (msg.role === "toolResult") {
            if (msg.toolName === "TaskCreate") {
                const m = TASK_CREATED_RE.exec(toolResultText(msg.content).trim());
                if (m != null && !byId.has(m[1])) {
                    byId.set(m[1], { text: m[2].trim(), done: false });
                    order.push(m[1]);
                }
                continue;
            }
            if (msg.toolName === "TaskList") {
                const text = toolResultText(msg.content);
                let updated = false;
                for (const l of text.split("\n")) {
                    const m = TASK_LIST_RE.exec(l.trim());
                    if (m == null) {
                        continue;
                    }
                    const id = m[1];
                    if (!byId.has(id)) {
                        byId.set(id, { text: m[3], done: m[2] === "completed" });
                        order.push(id);
                    } else {
                        byId.get(id)!.done = m[2] === "completed";
                    }
                    updated = true;
                }
                if (updated) {
                    continue;
                }
            }
            continue;
        }
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const b of msg.content as PiBlock[]) {
                if ((b?.type !== "toolCall" && b?.type !== "tool_use") || b.name !== "TaskUpdate") {
                    continue;
                }
                const a = (b.arguments ?? b.args) as Record<string, unknown> | null;
                if (a == null || typeof a !== "object") {
                    continue;
                }
                const id = String(a.taskId ?? "");
                const task = byId.get(id);
                if (task != null && typeof a.status === "string") {
                    task.done = a.status === "completed";
                }
            }
        }
    }
    if (order.length === 0) {
        return undefined;
    }
    return order.map((id) => ({ text: byId.get(id)!.text, done: byId.get(id)!.done }));
}

/** Pure: the session's display title — the latest session_info.name on the active branch, else the
 *  first active user text. Mirrors the backend's piBranchMeta so Conversation History and the history
 *  scan agree on what a Pi session is called. */
export function extractPiTitle(lines: string[]): string | undefined {
    const records = parseRecords(lines);
    let title: string | undefined;
    for (const idx of activeBranch(records)) {
        const rec = records[idx];
        if (rec?.type === "session_info" && typeof rec.name === "string" && rec.name.trim() !== "") {
            title = rec.name.trim();
        }
    }
    if (title) {
        return title;
    }
    for (const idx of activeBranch(records)) {
        const rec = records[idx];
        if (rec?.type === "message" && rec.message?.role === "user") {
            const raw = textBlocks(rec.message.content)[0];
            if (!raw) {
                continue;
            }
            const skill = parseSkillBlock(raw);
            const text = skill?.userMessage ?? raw;
            if (text) {
                return text;
            }
        }
    }
    return undefined;
}
