import { describe, expect, it } from "vitest";
import {
    extractAiTitle,
    extractBackgroundTasks,
    extractSubagentSpawns,
    extractTasks,
    projectTranscript,
} from "./transcriptprojection";

const LINES: string[] = [
    JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "fix the race" }] } }), // human prompt -> user entry
    JSON.stringify({
        type: "assistant",
        message: {
            content: [
                { type: "thinking", thinking: "let me look" }, // skipped
                { type: "text", text: "The clone re-reads the source block by id, so a stale id slips through." },
                { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/home/u/proj/sessionmodel.go" } },
            ],
        },
    }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] } }), // edited, non-ran -> no outcome
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "go test ./...", description: "go test ./..." } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true }] } }), // ran + error -> fail
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Bash", input: { description: "go build" } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", is_error: false }] } }), // ran + success -> ok
    "{ not valid json", // skipped
    JSON.stringify({ type: "file-history-snapshot", foo: 1 }), // unknown type -> ignored
];

describe("projectTranscript", () => {
    it("projects messages, actions, and outcomes in order", () => {
        expect(projectTranscript(LINES)).toEqual([
            { kind: "user", text: "fix the race" },
            { kind: "message", text: "The clone re-reads the source block by id, so a stale id slips through." },
            { kind: "action", verb: "edited", target: "sessionmodel.go" },
            { kind: "action", verb: "ran", target: "go test ./...", outcome: "fail" },
            { kind: "action", verb: "ran", target: "go build", outcome: "ok" },
        ]);
    });

    it("returns [] for empty input and skips unparseable lines", () => {
        expect(projectTranscript([])).toEqual([]);
        expect(projectTranscript(["garbage", "{bad"])).toEqual([]);
    });

    it("maps unknown tools to a lowercased verb and the salient input", () => {
        const out = projectTranscript([
            JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "WebFetch", input: { pattern: "abc" } }] } }),
        ]);
        expect(out).toEqual([{ kind: "action", verb: "webfetch", target: "abc" }]);
    });

    it("emits an action with no outcome when tool_use has no id (result can't be matched)", () => {
        const out = projectTranscript([
            JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { description: "go test ./..." } }] } }),
            JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "missing", is_error: true }] } }),
        ]);
        expect(out).toEqual([{ kind: "action", verb: "ran", target: "go test ./..." }]);
    });
});

describe("projectTranscript user turns", () => {
    const L = (obj: unknown) => JSON.stringify(obj);

    it("projects a user string turn as a user entry, in order", () => {
        const out = projectTranscript([
            L({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } }),
            L({ type: "user", message: { content: "do the thing" } }),
        ]);
        expect(out).toEqual([
            { kind: "message", text: "Hello" },
            { kind: "user", text: "do the thing" },
        ]);
    });

    it("projects a user text block as a user entry", () => {
        const out = projectTranscript([L({ type: "user", message: { content: [{ type: "text", text: "option B" }] } })]);
        expect(out).toEqual([{ kind: "user", text: "option B" }]);
    });

    it("emits no user entry for a tool_result-only record but still applies the outcome", () => {
        const out = projectTranscript([
            L({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }),
            L({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] } }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ kind: "action", verb: "ran", outcome: "ok" });
    });
});

describe("projectTranscript commands and isMeta", () => {
    const L = (o: unknown) => JSON.stringify(o);

    it("parses a <command-name> user string into a command entry (slash kept, message dropped, args when present)", () => {
        const withArgs = "<command-name>/review</command-name>\n  <command-message>review</command-message>\n  <command-args>PR #402</command-args>";
        const bare = "<command-name>/clear</command-name>\n  <command-message>clear</command-message>\n  <command-args></command-args>";
        expect(projectTranscript([L({ type: "user", message: { content: withArgs } })])).toEqual([
            { kind: "command", name: "/review", args: "PR #402" },
        ]);
        expect(projectTranscript([L({ type: "user", message: { content: bare } })])).toEqual([
            { kind: "command", name: "/clear" },
        ]);
    });

    it("normalizes a command-name that lacks a leading slash", () => {
        const out = projectTranscript([
            L({ type: "user", message: { content: "<command-name>compact</command-name><command-args></command-args>" } }),
        ]);
        expect(out).toEqual([{ kind: "command", name: "/compact" }]);
    });

    it("skips synthetic isMeta user records (skill body dumps, caveats, continuation)", () => {
        const out = projectTranscript([
            L({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "# Skill body\n\nlong markdown" }] } }),
            L({ type: "user", isMeta: true, message: { content: "<local-command-caveat>Caveat...</local-command-caveat>" } }),
            L({ type: "user", message: { content: "real prompt" } }),
        ]);
        expect(out).toEqual([{ kind: "user", text: "real prompt" }]);
    });
    it("renders a user-invoked skill (caller.direct) as a skill command chip with the leaf name", () => {
        const out = projectTranscript([
            L({
                type: "assistant",
                message: {
                    content: [
                        { type: "tool_use", id: "s1", name: "Skill", input: { skill: "superpowers:brainstorming", args: "design the cache" }, caller: { type: "direct" } },
                    ],
                },
            }),
        ]);
        expect(out).toEqual([{ kind: "command", name: "brainstorming", isSkill: true, args: "design the cache" }]);
    });

    it("omits args for a skill chip with no args", () => {
        const out = projectTranscript([
            L({ type: "assistant", message: { content: [{ type: "tool_use", id: "s2", name: "Skill", input: { skill: "commit" }, caller: { type: "direct" } }] } }),
        ]);
        expect(out).toEqual([{ kind: "command", name: "commit", isSkill: true }]);
    });
});

describe("projectTranscript compaction", () => {
    const L = (o: unknown) => JSON.stringify(o);
    const boundary = L({
        type: "system",
        subtype: "compact_boundary",
        content: "Conversation compacted",
        compactMetadata: { trigger: "manual", preTokens: 415334, postTokens: 22859 },
    });
    const summary = L({ type: "user", isCompactSummary: true, message: { content: "This session is being continued...\n\nSummary:\n**kept**" } });

    it("merges an adjacent boundary + summary into one compaction entry", () => {
        expect(projectTranscript([boundary, summary])).toEqual([
            { kind: "compaction", trigger: "manual", preTokens: 415334, postTokens: 22859, summary: "This session is being continued...\n\nSummary:\n**kept**" },
        ]);
    });

    it("produces a summary-only compaction when there is no boundary", () => {
        expect(projectTranscript([summary])).toEqual([{ kind: "compaction", summary: "This session is being continued...\n\nSummary:\n**kept**" }]);
    });

    it("produces a stats-only compaction when there is no summary", () => {
        expect(projectTranscript([boundary])).toEqual([{ kind: "compaction", trigger: "manual", preTokens: 415334, postTokens: 22859 }]);
    });

    it("does not fold a real user turn into the compaction", () => {
        const out = projectTranscript([boundary, L({ type: "user", message: { content: "next thing" } }), summary]);
        expect(out).toEqual([
            { kind: "compaction", trigger: "manual", preTokens: 415334, postTokens: 22859 },
            { kind: "user", text: "next thing" },
            { kind: "compaction", summary: "This session is being continued...\n\nSummary:\n**kept**" },
        ]);
    });
});

describe("projectTranscript task-notification, stdout, and interrupts", () => {
    const L = (o: unknown) => JSON.stringify(o);

    it("projects a task-notification user string into a notification entry (summary/status/result)", () => {
        const content = [
            "<task-notification>",
            "<task-id>abc123</task-id>",
            "<tool-use-id>toolu_1</tool-use-id>",
            "<status>completed</status>",
            '<summary>Agent "Map layout" finished</summary>',
            "<note>a note</note>",
            "<result>Here is the report.</result>",
            "</task-notification>",
        ].join("\n");
        expect(projectTranscript([L({ type: "user", message: { content } })])).toEqual([
            { kind: "notification", summary: 'Agent "Map layout" finished', status: "completed", result: "Here is the report." },
        ]);
    });

    it("omits result when the task-notification has none", () => {
        const content = "<task-notification>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>";
        expect(projectTranscript([L({ type: "user", message: { content } })])).toEqual([
            { kind: "notification", summary: "done", status: "completed" },
        ]);
    });

    it("skips a user-string <local-command-stdout> record (with ANSI) rather than leaking the raw tag", () => {
        const content = "<local-command-stdout>[2mCompacted (ctrl+o to see full summary)[22m</local-command-stdout>";
        expect(projectTranscript([L({ type: "user", message: { content } })])).toEqual([]);
    });

    it("projects [Request interrupted by user] as an interrupted marker, both as a text block and a string", () => {
        expect(projectTranscript([L({ type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } })])).toEqual([
            { kind: "interrupted" },
        ]);
        expect(projectTranscript([L({ type: "user", message: { content: "[Request interrupted by user for tool use]" } })])).toEqual([
            { kind: "interrupted" },
        ]);
    });
});

describe("extractAiTitle", () => {
    it("returns the LAST ai-title's aiTitle", () => {
        const lines = [
            JSON.stringify({ type: "mode", mode: "normal" }),
            JSON.stringify({ type: "ai-title", aiTitle: "First guess" }),
            JSON.stringify({ type: "last-prompt", lastPrompt: "do the thing" }),
            JSON.stringify({ type: "ai-title", aiTitle: "Fix duplicate-session race" }),
        ];
        expect(extractAiTitle(lines)).toBe("Fix duplicate-session race");
    });

    it("returns undefined when there is no ai-title, and skips unparseable lines", () => {
        expect(extractAiTitle([JSON.stringify({ type: "assistant", message: { content: [] } }), "{bad"])).toBeUndefined();
        expect(extractAiTitle([])).toBeUndefined();
    });
});

describe("extractTasks", () => {
    const todoUse = (todos: unknown[]) =>
        JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "tool_use", id: "tw1", name: "TodoWrite", input: { todos } }] },
        });

    it("returns undefined when the transcript has no TodoWrite", () => {
        expect(extractTasks([])).toBeUndefined();
        expect(
            extractTasks([
                JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "e", name: "Edit", input: {} }] } }),
            ])
        ).toBeUndefined();
    });

    it("maps content to text and completed status to done:true, others to false", () => {
        const out = extractTasks([
            todoUse([
                { content: "Read the failing test", status: "completed", activeForm: "Reading the failing test" },
                { content: "Patch the handler", status: "in_progress", activeForm: "Patching the handler" },
                { content: "Add a regression test", status: "pending", activeForm: "Adding a regression test" },
            ]),
        ]);
        expect(out).toEqual([
            { text: "Read the failing test", done: true },
            { text: "Patch the handler", done: false },
            { text: "Add a regression test", done: false },
        ]);
    });

    it("uses the LAST TodoWrite when several are present", () => {
        const out = extractTasks([
            todoUse([{ content: "old task", status: "pending" }]),
            todoUse([
                { content: "new a", status: "completed" },
                { content: "new b", status: "pending" },
            ]),
        ]);
        expect(out).toEqual([
            { text: "new a", done: true },
            { text: "new b", done: false },
        ]);
    });

    it("returns [] for an empty todos list", () => {
        expect(extractTasks([todoUse([])])).toEqual([]);
    });

    it("skips unparseable lines and malformed todo entries", () => {
        const out = extractTasks([
            "{ not json",
            todoUse([{ content: "kept", status: "completed" }, { status: "pending" }, { content: 42, status: "pending" }]),
        ]);
        expect(out).toEqual([{ text: "kept", done: true }]);
    });
});

describe("projectTranscript thinking blocks", () => {
    it("skips assistant thinking blocks (internal chain-of-thought is not narration)", () => {
        const lines = [
            JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "secret reasoning" }] } }),
            JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "visible narration" }] } }),
        ];
        const entries = projectTranscript(lines);
        expect(entries).toEqual([{ kind: "message", text: "visible narration" }]);
    });
});

describe("projectTranscript detail", () => {
    const L = (o: unknown) => JSON.stringify(o);

    it("attaches an edit diff from Edit old/new strings", () => {
        const out = projectTranscript([
            L({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "/p/a.ts", old_string: "a\nb", new_string: "c" } }] } }),
            L({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e1", is_error: false }] } }),
        ]);
        expect(out[0]).toMatchObject({ kind: "action", verb: "edited", target: "a.ts" });
        expect((out[0] as any).detail).toEqual({
            kind: "edit",
            files: [
                {
                    path: "/p/a.ts",
                    badge: "M",
                    adds: 1,
                    dels: 2,
                    lines: [
                        { sign: "-", text: "a" },
                        { sign: "-", text: "b" },
                        { sign: "+", text: "c" },
                    ],
                },
            ],
        });
    });

    it("attaches the raw command (not the description) plus output + exit to a bash detail", () => {
        const out = projectTranscript([
            L({ type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "npm test", description: "run tests" } }] } }),
            L({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b1", is_error: false, content: "24 passing" }] } }),
        ]);
        // the line shows the human description; the raw command lives in the detail
        expect(out[0]).toMatchObject({ kind: "action", verb: "ran", target: "run tests" });
        expect((out[0] as any).detail).toEqual({ kind: "bash", command: "npm test", output: "24 passing", exit: 0 });
    });

    it("renders a Skill call as a labeled line (verb + skill name) with an args detail", () => {
        const out = projectTranscript([
            L({ type: "assistant", message: { content: [{ type: "tool_use", id: "s1", name: "Skill", input: { skill: "brainstorming", args: "design the cache" } }] } }),
        ]);
        expect(out[0]).toMatchObject({ kind: "action", verb: "skill", target: "brainstorming" });
        expect((out[0] as any).detail).toEqual({ kind: "skill", name: "brainstorming", args: "design the cache" });
    });

    it("omits the args detail field when a Skill call has no args", () => {
        const out = projectTranscript([
            L({ type: "assistant", message: { content: [{ type: "tool_use", id: "s2", name: "Skill", input: { skill: "commit" } }] } }),
        ]);
        expect(out[0]).toMatchObject({ kind: "action", verb: "skill", target: "commit" });
        expect((out[0] as any).detail).toEqual({ kind: "skill", name: "commit" });
    });

    it("computes durationMs from record timestamps", () => {
        const out = projectTranscript([
            L({ type: "assistant", timestamp: "2026-07-08T00:00:00.000Z", message: { content: [{ type: "tool_use", id: "b2", name: "Bash", input: { command: "x" } }] } }),
            L({ type: "user", timestamp: "2026-07-08T00:00:03.200Z", message: { content: [{ type: "tool_result", tool_use_id: "b2", is_error: false, content: "" }] } }),
        ]);
        expect((out[0] as any).durationMs).toBe(3200);
    });

    it("does not leak private scratch fields (_useTs/_tool)", () => {
        const out = projectTranscript([
            L({ type: "assistant", timestamp: "2026-07-08T00:00:00.000Z", message: { content: [{ type: "tool_use", id: "b3", name: "Bash", input: { command: "x" } }] } }),
            L({ type: "user", timestamp: "2026-07-08T00:00:01.000Z", message: { content: [{ type: "tool_result", tool_use_id: "b3", is_error: false, content: "out" }] } }),
        ]);
        expect(Object.keys(out[0])).not.toContain("_useTs");
        expect(Object.keys(out[0])).not.toContain("_tool");
        expect(Object.keys(out[0])).not.toContain("_command");
    });
});

describe("extractSubagentSpawns", () => {
    const asst = (blocks: any[]) => JSON.stringify({ type: "assistant", message: { content: blocks } });
    const usr = (blocks: any[]) => JSON.stringify({ type: "user", message: { content: blocks } });

    it("pairs a completed Task with its ok result", () => {
        const lines = [
            asst([{ type: "tool_use", id: "t1", name: "Task", input: { subagent_type: "Explore", prompt: "look at X" } }]),
            usr([{ type: "tool_result", tool_use_id: "t1", is_error: false }]),
        ];
        expect(extractSubagentSpawns(lines)).toEqual([
            { toolUseId: "t1", subagentType: "Explore", prompt: "look at X", done: true, failed: false },
        ]);
    });

    it("marks a still-running Task as not done", () => {
        const lines = [asst([{ type: "tool_use", id: "t2", name: "Task", input: { subagent_type: "Plan", prompt: "plan Y" } }])];
        expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: false, failed: false });
    });

    it("marks an errored Task as failed", () => {
        const lines = [
            asst([{ type: "tool_use", id: "t3", name: "Task", input: { subagent_type: "Test", prompt: "test Z" } }]),
            usr([{ type: "tool_result", tool_use_id: "t3", is_error: true }]),
        ];
        expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: true, failed: true });
    });

    it("keeps parallel spawns in first-seen order and ignores non-Task tools", () => {
        const lines = [
            asst([{ type: "tool_use", id: "r", name: "Read", input: { file_path: "a" } }]),
            asst([{ type: "tool_use", id: "a", name: "Task", input: { subagent_type: "Explore", prompt: "P1" } }]),
            asst([{ type: "tool_use", id: "b", name: "Task", input: { subagent_type: "Explore", prompt: "P2" } }]),
        ];
        expect(extractSubagentSpawns(lines).map((s) => s.toolUseId)).toEqual(["a", "b"]);
    });
});

describe("extractBackgroundTasks", () => {
    const asst = (blocks: any[]) => JSON.stringify({ type: "assistant", message: { content: blocks } });
    const result = (id: string, text: string, extra: object = {}) =>
        JSON.stringify({
            type: "user",
            message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] },
            ...extra,
        });
    const notify = (toolUseId: string, status: string) =>
        JSON.stringify({
            type: "user",
            message: {
                content: `<task-notification>\n<task-id>x</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>s</summary>\n</task-notification>`,
            },
        });
    const bash = (id: string, input: object) => asst([{ type: "tool_use", id, name: "Bash", input }]);

    it("an explicit background command is running until its notification lands", () => {
        const start = [
            bash("t1", { command: "npm test", description: "Run tests", run_in_background: true }),
            result("t1", "Command running in background with ID: b1abc"),
        ];
        expect(extractBackgroundTasks(start)).toEqual([
            { toolUseId: "t1", taskId: "b1abc", label: "Run tests", command: "npm test", status: "running" },
        ]);
        expect(extractBackgroundTasks([...start, notify("t1", "completed")])[0].status).toBe("completed");
        expect(extractBackgroundTasks([...start, notify("t1", "failed")])[0].status).toBe("failed");
        expect(extractBackgroundTasks([...start, notify("t1", "killed")])[0].status).toBe("stopped");
    });

    it("a foreground command that timed out into the background is a task too", () => {
        const lines = [
            bash("t2", { command: "cargo build", description: "Build" }),
            result("t2", "", { toolUseResult: { backgroundTaskId: "b2", timedOutAfterMs: 120000 } }),
        ];
        expect(extractBackgroundTasks(lines)).toEqual([
            { toolUseId: "t2", taskId: "b2", label: "Build", command: "cargo build", status: "running" },
        ]);
    });

    it("a plain foreground command is not a task", () => {
        expect(extractBackgroundTasks([bash("t3", { command: "ls" }), result("t3", "a\nb")])).toEqual([]);
    });

    it("TaskStop on its id stops it", () => {
        const lines = [
            bash("t4", { command: "npm run dev", run_in_background: true }),
            result("t4", "", { toolUseResult: { backgroundTaskId: "b4" } }),
            asst([{ type: "tool_use", id: "s1", name: "TaskStop", input: { task_id: "b4" } }]),
        ];
        expect(extractBackgroundTasks(lines)[0]).toMatchObject({ label: "npm run dev", status: "stopped" });
    });

    it("a notification queued as a queue-operation record still resolves the task", () => {
        const lines = [
            bash("t5", { command: "go test ./...", run_in_background: true }),
            JSON.stringify({
                type: "queue-operation",
                content:
                    "<task-notification><tool-use-id>t5</tool-use-id><status>completed</status></task-notification>",
            }),
        ];
        expect(extractBackgroundTasks(lines)[0].status).toBe("completed");
    });

    it("a PowerShell background command is a task too", () => {
        const lines = [
            asst([
                {
                    type: "tool_use",
                    id: "p1",
                    name: "PowerShell",
                    input: { command: "npm run dev", run_in_background: true },
                },
            ]),
            result("p1", "", { toolUseResult: { backgroundTaskId: "bp1" } }),
        ];
        expect(extractBackgroundTasks(lines)).toEqual([
            { toolUseId: "p1", taskId: "bp1", label: "npm run dev", command: "npm run dev", status: "running" },
        ]);
    });

    it("a start whose result is not in the tail stays running with no task id", () => {
        expect(extractBackgroundTasks([bash("t6", { command: "sleep 99", run_in_background: true })])).toEqual([
            { toolUseId: "t6", label: "sleep 99", command: "sleep 99", status: "running" },
        ]);
    });
});
