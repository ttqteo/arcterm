// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { extractPiTasks, extractPiTitle, projectPiTranscript } from "./pitranscriptprojection";

const L = JSON.stringify;
const session = L({
    type: "session",
    version: 3,
    id: "s1",
    timestamp: "2026-08-11T03:00:00Z",
    cwd: "/repo",
});

// Pi v3 records tool calls as {type:"toolCall", id, name, arguments} and joins them to a
// {role:"toolResult", toolCallId, toolName, content, isError} message record. Sequential calls
// in one fixture must chain: each call's parentId points at the previous record (defaults to the
// user seed "u"), or the later calls become abandoned sibling branches and never render.
const toolCall = (id: string, name: string, args: unknown, ts = "2026-08-11T03:00:00.000Z", parent = "u") =>
    L({
        type: "message",
        id: "call-" + id,
        parentId: parent,
        timestamp: ts,
        message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] },
    });
const toolResult = (id: string, name: string, text: string, isError = false, ts = "2026-08-11T03:00:01.000Z", parent = "call-" + id) =>
    L({
        type: "message",
        id: "res-" + id,
        parentId: parent,
        timestamp: ts,
        message: {
            role: "toolResult",
            toolCallId: id,
            toolName: name,
            content: [{ type: "text", text }],
            isError,
        },
    });
const user = (id: string, text: string) =>
    L({ type: "message", id, parentId: null, message: { role: "user", content: text } });

describe("projectPiTranscript", () => {
    it("keeps the full path of a file tool beside its base name", () => {
        const out = projectPiTranscript([session, user("u", "go"), toolCall("1", "read", { path: "/repo/src/a.ts" })]);
        expect(out.find((e) => e.kind === "action")).toMatchObject({ target: "a.ts", path: "/repo/src/a.ts" });
    });

    it("projects only the active parent branch root-first, joining tool results to calls", () => {
        const lines = [
            session,
            user("root", "implement it"),
            // abandoned sibling: on disk, never on the active chain
            L({
                type: "message",
                id: "abandoned",
                parentId: "root",
                message: { role: "assistant", content: "Approach A failed" },
            }),
            L({
                type: "message",
                id: "inspecting",
                parentId: "root",
                timestamp: "2026-08-11T03:01:00Z",
                message: {
                    role: "assistant",
                    content: [
                        { type: "text", text: "Inspecting." },
                        { type: "toolCall", id: "t1", name: "bash", arguments: { command: "go test ./pkg/..." } },
                    ],
                },
            }),
            L({
                type: "message",
                id: "tr1",
                parentId: "inspecting",
                timestamp: "2026-08-11T03:01:05Z",
                message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: "ok" },
            }),
            L({
                type: "message",
                id: "approachb",
                parentId: "tr1",
                message: { role: "user", content: "use approach B" },
            }),
            L({
                type: "message",
                id: "final",
                parentId: "approachb",
                message: { role: "assistant", content: "Approach B works." },
            }),
        ];
        expect(projectPiTranscript(lines)).toEqual([
            { kind: "user", text: "implement it" },
            { kind: "message", text: "Inspecting." },
            {
                kind: "action",
                verb: "ran",
                target: "go test ./pkg/...",
                outcome: "ok",
                durationMs: 5000,
                detail: { kind: "bash", command: "go test ./pkg/...", output: "ok", exit: 0 },
            },
            { kind: "user", text: "use approach B" },
            { kind: "message", text: "Approach B works." },
        ]);
        expect(projectPiTranscript(lines).some((e) => JSON.stringify(e).includes("Approach A failed"))).toBe(false);
    });

    it("marks a failed tool call fail via the tool result's error flag", () => {
        const lines = [
            session,
            user("u", "build it"),
            toolCall("b1", "bash", { command: "make build" }),
            toolResult("b1", "bash", "build failed", true),
        ];
        expect(projectPiTranscript(lines)).toEqual([
            { kind: "user", text: "build it" },
            {
                kind: "action",
                verb: "ran",
                target: "make build",
                outcome: "fail",
                durationMs: 1000,
                detail: { kind: "bash", command: "make build", output: "build failed", exit: 1 },
            },
        ]);
    });

    it("renders a skill-block user message as a skill chip plus the trailing user bubble", () => {
        const skillText = `<skill name="superpowers:brainstorming" location="C:\\skills\\brainstorming\\SKILL.md">\nReferences are relative to C:\\skills\\brainstorming.\n\n# Brainstorming\n\nUse this before any creative work.\n</skill>\n\nplan the dashboard`;
        const lines = [
            session,
            L({ type: "message", id: "u", parentId: null, message: { role: "user", content: skillText } }),
        ];
        expect(projectPiTranscript(lines)).toEqual([
            { kind: "command", name: "brainstorming", isSkill: true },
            { kind: "user", text: "plan the dashboard" },
        ]);
    });

    it("renders a bare skill-block user message (no trailing text) as just the skill chip", () => {
        const skillText = `<skill name="grilling" location="C:\\skills\\grilling\\SKILL.md">\nReferences are relative to C:\\skills\\grilling.\n\n# Grilling\n\nStress-test the plan.\n</skill>`;
        const lines = [session, L({ type: "message", id: "u", parentId: null, message: { role: "user", content: skillText } })];
        expect(projectPiTranscript(lines)).toEqual([{ kind: "command", name: "grilling", isSkill: true }]);
    });

    it("keeps plain user text as a user bubble", () => {
        const lines = [session, user("u", "just a question")];
        expect(projectPiTranscript(lines)).toEqual([{ kind: "user", text: "just a question" }]);
    });

    it("carries inline edit diffs for edit (multi-edit) and write tool calls", () => {
        const lines = [
            session,
            user("u", "refactor"),
            toolCall("e1", "edit", {
                path: "src/a.ts",
                edits: [
                    { oldText: "const x = 1;", newText: "const x = 2;" },
                    { oldText: "old", newText: "new" },
                ],
            }),
            toolResult("e1", "edit", ""),
            toolCall("w1", "write", { path: "src/b.ts", content: "export const b = 1;" }, "2026-08-11T03:00:02.000Z", "res-e1"),
            toolResult("w1", "write", ""),
        ];
        const entries = projectPiTranscript(lines);
        const edit = entries.find((e) => e.kind === "action" && e.verb === "edited");
        expect(edit).toBeDefined();
        expect(edit!.kind).toBe("action");
        const detail = (edit as any).detail;
        expect(detail.kind).toBe("edit");
        expect(detail.files).toHaveLength(2);
        expect(detail.files[0].path).toBe("src/a.ts");
        expect(detail.files[0].badge).toBe("M");
        expect(detail.files[0].adds).toBe(1);
        expect(detail.files[0].dels).toBe(1);
        const write = entries.find((e) => e.kind === "action" && e.verb === "wrote");
        expect((write as any).detail.files[0]).toMatchObject({ path: "src/b.ts", badge: "A", adds: 1, dels: 0 });
    });

    it("enriches read and grep actions with detail from the tool result", () => {
        const readBody = ["line1", "line2", "line3"].join("\n");
        const grepBody = "src/a.ts:12: const x = 1;\nsrc/a.ts:14: const y = 2;";
        const lines = [
            session,
            user("u", "inspect"),
            toolCall("r1", "read", { path: "src/a.ts", offset: 1, limit: 3 }),
            toolResult("r1", "read", readBody),
            toolCall("g1", "grep", { pattern: "const", path: "src" }, "2026-08-11T03:00:02.000Z", "res-r1"),
            toolResult("g1", "grep", grepBody),
        ];
        const entries = projectPiTranscript(lines);
        const read = entries.find((e) => e.kind === "action" && e.verb === "read") as any;
        expect(read.detail).toEqual({ kind: "read", snippet: readBody, truncated: false });
        expect(read.summary).toBe("3 lines");
        expect(read.outcome).toBeUndefined(); // non-bash success: no explicit ok (renders ✓)
        const grep = entries.find((e) => e.kind === "action" && e.verb === "grep") as any;
        expect(grep.detail.kind).toBe("grep");
        expect(grep.detail.matches).toEqual([
            { loc: "src/a.ts:12", code: " const x = 1;" },
            { loc: "src/a.ts:14", code: " const y = 2;" },
        ]);
        expect(grep.summary).toBe("2 matches");
    });

    it("enriches bash actions with command + output + exit and computes duration", () => {
        const lines = [
            session,
            user("u", "run tests"),
            toolCall("b1", "bash", { command: "npm test" }, "2026-08-11T03:00:10.000Z"),
            toolResult("b1", "bash", "12 passing\n3 failing", false, "2026-08-11T03:00:16.500Z"),
        ];
        const entries = projectPiTranscript(lines);
        const bash = entries.find((e) => e.kind === "action" && e.verb === "ran") as any;
        expect(bash.target).toBe("npm test");
        expect(bash.detail).toEqual({ kind: "bash", command: "npm test", output: "12 passing\n3 failing", exit: 0 });
        expect(bash.outcome).toBe("ok");
        expect(bash.durationMs).toBe(6500);
    });

    it("maps the task/subagent tool family to descriptive verbs and targets", () => {
        const lines = [
            session,
            user("u", "organize"),
            toolCall("t1", "TaskCreate", { subject: "Fix auth bug", description: "details" }),
            toolResult("t1", "TaskCreate", "Task #1 created successfully: Fix auth bug"),
            toolCall("t2", "TaskUpdate", { taskId: "1", status: "completed" }, "2026-08-11T03:00:02.000Z", "res-t1"),
            toolResult("t2", "TaskUpdate", "Task #1 updated"),
            toolCall("s1", "subagent", { agent: "reviewer", task: "review the diff" }, "2026-08-11T03:00:03.000Z", "res-t2"),
            toolResult("s1", "subagent", "done"),
        ];
        const entries = projectPiTranscript(lines);
        const verbs = entries.filter((e) => e.kind === "action").map((e) => ({ verb: (e as any).verb, target: (e as any).target }));
        expect(verbs).toEqual([
            { verb: "created task", target: "Fix auth bug" },
            { verb: "updated task", target: "task #1" },
            { verb: "spawned", target: "reviewer" },
        ]);
    });

    it("maps compaction records to the compaction entry kind", () => {
        const lines = [
            session,
            user("u", "long task"),
            L({ type: "message", id: "a1", parentId: "u", message: { role: "assistant", content: "part one" } }),
            L({
                type: "compaction",
                id: "c",
                parentId: "a1",
                timestamp: "2026-08-11T03:01:00Z",
                summary: "kept the essentials",
                tokensBefore: 120000,
            }),
            L({ type: "message", id: "a2", parentId: "c", message: { role: "assistant", content: "resumed" } }),
        ];
        expect(projectPiTranscript(lines)).toEqual([
            { kind: "user", text: "long task" },
            { kind: "message", text: "part one" },
            { kind: "compaction", summary: "kept the essentials", preTokens: 120000 },
            { kind: "message", text: "resumed" },
        ]);
    });

    it("never renders branch_summary as content", () => {
        const lines = [
            session,
            user("u", "task"),
            L({
                type: "branch_summary",
                id: "bs",
                parentId: "u",
                timestamp: "2026-08-11T03:02:00Z",
                summary: "did things",
            }),
        ];
        const entries = projectPiTranscript(lines);
        expect(entries).toEqual([{ kind: "user", text: "task" }]);
        expect(entries.some((e) => JSON.stringify(e).includes("did things"))).toBe(false);
    });

    it("skips malformed lines and keeps the reachable branch", () => {
        const lines = [
            session,
            user("u", "keep me"),
            "{ this is not json",
            L({ type: "message", id: "a", parentId: "u", message: { role: "assistant", content: "done" } }),
        ];
        expect(projectPiTranscript(lines)).toEqual([
            { kind: "user", text: "keep me" },
            { kind: "message", text: "done" },
        ]);
    });

    it("terminates on a parent cycle and projects the reachable suffix", () => {
        const lines = [
            session,
            L({ type: "message", id: "a", parentId: "b", message: { role: "assistant", content: "one" } }),
            L({ type: "message", id: "b", parentId: "a", message: { role: "assistant", content: "two" } }),
        ];
        expect(() => projectPiTranscript(lines)).not.toThrow();
        expect(projectPiTranscript(lines)).toEqual([
            { kind: "message", text: "one" },
            { kind: "message", text: "two" },
        ]);
    });
});

describe("extractPiTasks", () => {
    it("tracks tasks from TaskCreate results and TaskUpdate statuses", () => {
        const lines = [
            session,
            user("u", "plan"),
            toolCall("t1", "TaskCreate", { subject: "Fix auth bug" }),
            toolResult("t1", "TaskCreate", "Task #1 created successfully: Fix auth bug"),
            toolCall("t2", "TaskCreate", { subject: "Ship dashboard" }),
            toolResult("t2", "TaskCreate", "Task #2 created successfully: Ship dashboard"),
            toolCall("t3", "TaskUpdate", { taskId: "1", status: "in_progress" }),
            toolResult("t3", "TaskUpdate", "Task #1 updated"),
            toolCall("t4", "TaskUpdate", { taskId: "1", status: "completed" }),
            toolResult("t4", "TaskUpdate", "Task #1 updated"),
        ];
        expect(extractPiTasks(lines)).toEqual([
            { text: "Fix auth bug", done: true },
            { text: "Ship dashboard", done: false },
        ]);
    });

    it("uses a TaskList snapshot as a full-state fallback", () => {
        const lines = [
            session,
            user("u", "check"),
            toolCall("t1", "TaskList", {}),
            toolResult("t1", "TaskList", "#1 [completed] Fix auth bug\n#2 [pending] Ship dashboard"),
        ];
        expect(extractPiTasks(lines)).toEqual([
            { text: "Fix auth bug", done: true },
            { text: "Ship dashboard", done: false },
        ]);
    });

    it("returns undefined when the task tools were never used", () => {
        const lines = [session, user("u", "hello"), L({ type: "message", id: "a", parentId: "u", message: { role: "assistant", content: "hi" } })];
        expect(extractPiTasks(lines)).toBeUndefined();
    });

    it("ignores a TaskList result that reports no tasks", () => {
        const lines = [
            session,
            user("u", "check"),
            toolCall("t1", "TaskCreate", { subject: "Seed" }),
            toolResult("t1", "TaskCreate", "Task #1 created successfully: Seed"),
            toolCall("t2", "TaskList", {}),
            toolResult("t2", "TaskList", "No tasks found"),
        ];
        expect(extractPiTasks(lines)).toEqual([{ text: "Seed", done: false }]);
    });
});

describe("extractPiTitle", () => {
    it("uses the latest session_info name on the active branch", () => {
        const lines = [
            session,
            L({ type: "session_info", id: "si1", parentId: null, name: "old title" }),
            L({ type: "message", id: "u", parentId: "si1", message: { role: "user", content: "task" } }),
            L({ type: "session_info", id: "si2", parentId: "u", name: "new title" }),
        ];
        expect(extractPiTitle(lines)).toBe("new title");
    });

    it("falls back to the first active user text", () => {
        const lines = [session, user("u", "fix the bug")];
        expect(extractPiTitle(lines)).toBe("fix the bug");
    });

    it("skips the skill block when deriving a title from user text", () => {
        const skillText = `<skill name="grilling" location="C:\\skills\\grilling\\SKILL.md">\nReferences are relative to C:\\skills\\grilling.\n\n# Grilling\n\nBody\n</skill>\n\nstress-test my plan`;
        const lines = [session, L({ type: "message", id: "u", parentId: null, message: { role: "user", content: skillText } })];
        expect(extractPiTitle(lines)).toBe("stress-test my plan");
    });
});
