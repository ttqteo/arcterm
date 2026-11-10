import { describe, expect, it } from "vitest";
import {
    bashNeverRan,
    compactSummaryText,
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
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] } }), // edited, a result landed -> ok
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
            { kind: "action", verb: "edited", target: "sessionmodel.go", path: "/home/u/proj/sessionmodel.go", outcome: "ok" },
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

    it("reads a Bash call refused before it ran as blocked, with no exit code, and one that ran and failed as fail", () => {
        const refusal =
            "<tool_use_error>Refused by arcterm: Claude Code already saves a background command's output to its output file.</tool_use_error>";
        const out = projectTranscript([
            JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "task build > log", description: "build" } }] } }),
            JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b1", is_error: true, content: refusal }] } }),
            JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "b2", name: "Bash", input: { command: "grep x f", description: "find x" } }] } }),
            JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b2", is_error: true, content: "Exit code 1\n" }] } }),
        ]);
        expect(out[0]).toMatchObject({ verb: "blocked", outcome: "blocked", detail: { kind: "bash", exit: null, output: refusal } });
        expect(out[1]).toMatchObject({ verb: "ran", outcome: "fail", detail: { kind: "bash", exit: 1 } });
    });

    it("keeps the full path of a file tool beside its base name", () => {
        const out = projectTranscript([
            JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "r", name: "Read", input: { file_path: "D:\\repo\\src\\a.ts" } }] } }),
        ]);
        expect(out[0]).toMatchObject({ kind: "action", target: "a.ts", path: "D:\\repo\\src\\a.ts" });
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

    it("carries a pasted image on the prompt it was sent with, as a data URL", () => {
        const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0K" } };
        const out = projectTranscript([
            L({ type: "user", message: { content: [{ type: "text", text: "[Image #3] two columns?" }, img] } }),
        ]);
        expect(out).toEqual([
            { kind: "user", text: "[Image #3] two columns?", images: ["data:image/png;base64,iVBORw0K"] },
        ]);
    });

    it("projects an image sent with no text as a prompt of its own", () => {
        const img = { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/" } };
        const out = projectTranscript([L({ type: "user", message: { content: [img] } })]);
        expect(out).toEqual([{ kind: "user", text: "", images: ["data:image/jpeg;base64,/9j/"] }]);
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

    // `! cmd` in Claude Code's box (bash mode) is written as two user records, as this session's transcript holds them
    it("reads a bash-mode command you ran and its output as one shell command entry", () => {
        const out = projectTranscript([
            L({ type: "user", message: { content: "<bash-input> task install</bash-input>" } }),
            L({
                type: "user",
                message: {
                    content:
                        "<bash-stdout>task: [install:macos] node scripts/install-mac.mjs\n\x1b[32mreopens\x1b[0m in a few seconds.</bash-stdout><bash-stderr></bash-stderr>",
                },
            }),
            L({ type: "user", message: { content: "<bash-input>ls nope</bash-input>" } }),
            L({ type: "user", message: { content: "<bash-stdout></bash-stdout><bash-stderr>ls: nope: No such file or directory</bash-stderr>" } }),
            L({ type: "user", message: { content: "<bash-input>sleep 60</bash-input>" } }),
        ]);
        expect(out).toEqual([
            {
                kind: "command",
                name: "!",
                args: "task install",
                shell: { output: "task: [install:macos] node scripts/install-mac.mjs\nreopens in a few seconds.", error: "" },
            },
            { kind: "command", name: "!", args: "ls nope", shell: { output: "", error: "ls: nope: No such file or directory" } },
            // its output has not landed yet
            { kind: "command", name: "!", args: "sleep 60" },
        ]);
    });

    it("drops a bash output whose command is not in the lines read, rather than drawing its tags", () => {
        const out = projectTranscript([
            L({ type: "user", message: { content: "<bash-stdout>orphan</bash-stdout><bash-stderr></bash-stderr>" } }),
        ]);
        expect(out).toEqual([]);
    });

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
    // Claude Code writes caller {type: "direct"} on every tool call the model makes, so a Skill call is the agent's own
    // step, never a command you ran: yours arrive as <command-name> user records
    it("reads a Skill call the agent made as a skill action, not a command of yours", () => {
        const out = projectTranscript([
            L({
                type: "assistant",
                message: {
                    content: [
                        { type: "tool_use", id: "s1", name: "Skill", input: { skill: "arc:design", args: "Chat header" }, caller: { type: "direct" } },
                    ],
                },
            }),
            L({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s1", content: "Launching skill: arc:design" }] } }),
        ]);
        expect(out).toEqual([
            {
                kind: "action",
                verb: "skill",
                target: "arc:design",
                outcome: "ok",
                detail: { kind: "skill", name: "arc:design", args: "Chat header" },
            },
        ]);
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

describe("compactSummaryText", () => {
    it("drops the model-facing wrapper around Claude Code's summary", () => {
        const raw =
            "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n" +
            "<system-reminder>\n<tools-used-before-summary>Bash, Read</tools-used-before-summary>\n</system-reminder>\n" +
            "Summary:\n1. Primary Request and Intent:\n   The user asked for buttons.\n   - I suggested slash commands.\n\n2. Key Technical Concepts:\n   - brainstorm.json\n\n" +
            "If you need specific details from before compaction (like exact code snippets), read the full transcript at: C:\\x.jsonl\n" +
            "Continue the conversation from where it left off without asking the user any further questions.\n\n" +
            "The messages after this summary are the most recent messages from before compaction, kept verbatim.";
        expect(compactSummaryText(raw)).toBe(
            "1. Primary Request and Intent:\n   The user asked for buttons.\n   - I suggested slash commands.\n\n2. Key Technical Concepts:\n   - brainstorm.json"
        );
    });

    it("keeps a summary with no wrapper as it is", () => {
        expect(compactSummaryText("**kept**")).toBe("**kept**");
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

    it("ignores records that are not an ai-title, and an ai-title that is blank or not a string", () => {
        const lines = [
            JSON.stringify({ type: "ai-title", aiTitle: "Real title" }),
            JSON.stringify({ type: "summary", aiTitle: "Other record" }),
            JSON.stringify({ type: "assistant", message: { content: [] } }),
            JSON.stringify({ type: "ai-title" }),
            JSON.stringify({ type: "ai-title", aiTitle: 5 }),
            JSON.stringify({ type: "ai-title", aiTitle: "" }),
            JSON.stringify({ type: "ai-title", aiTitle: "   " }),
        ];
        expect(extractAiTitle(lines)).toBe("Real title");
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

    it("ignores a TodoWrite in a record that is not an assistant message", () => {
        const user = JSON.stringify({
            type: "user",
            message: { content: [{ type: "tool_use", id: "u1", name: "TodoWrite", input: { todos: [{ content: "x" }] } }] },
        });
        expect(extractTasks([user])).toBeUndefined();
    });

    it("skips an assistant record without a content array and still finds a later list", () => {
        const noContent = JSON.stringify({ type: "assistant", message: {} });
        const stringContent = JSON.stringify({ type: "assistant", message: { content: "plain" } });
        const out = extractTasks([noContent, stringContent, todoUse([{ content: "later", status: "pending" }])]);
        expect(out).toEqual([{ text: "later", done: false }]);
    });

    it("takes only a tool_use block named TodoWrite whose todos are an array", () => {
        const block = (b: unknown) => JSON.stringify({ type: "assistant", message: { content: [b] } });
        const todos = [{ content: "wrong", status: "completed" }];
        const lines = [
            block({ type: "text", text: "hello" }),
            block(null),
            block({ type: "tool_use", id: "o1", name: "Other", input: { todos } }),
            block({ type: "text", name: "TodoWrite", input: { todos } }),
            block({ type: "tool_use", id: "o2", name: "TodoWrite", input: { todos: "not a list" } }),
            block({ type: "tool_use", id: "o3", name: "TodoWrite" }),
        ];
        expect(extractTasks(lines)).toBeUndefined();
        expect(extractTasks([todoUse([{ content: "kept" }]), ...lines])).toEqual([{ text: "kept", done: false }]);
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

    it("sets startedAt from the tool_use record's timestamp, and leaves it off without one", () => {
        const out = projectTranscript([
            L({ type: "assistant", timestamp: "2026-07-08T00:00:00.000Z", message: { content: [{ type: "tool_use", id: "s1", name: "Bash", input: { command: "x" } }] } }),
            L({ type: "assistant", message: { content: [{ type: "tool_use", id: "s2", name: "Read", input: { file_path: "/a/b.ts" } }] } }),
        ]);
        expect((out[0] as any).startedAt).toBe(Date.parse("2026-07-08T00:00:00.000Z"));
        expect("startedAt" in out[1]).toBe(false);
    });

    it("marks a tool whose result landed ok, whatever the tool, and leaves one with no result unmarked", () => {
        const out = projectTranscript([
            L({ type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/a/b.ts" } }] } }),
            L({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "r1", is_error: false, content: "x" }] } }),
            L({ type: "assistant", message: { content: [{ type: "tool_use", id: "r2", name: "Read", input: { file_path: "/a/c.ts" } }] } }),
        ]);
        expect((out[0] as any).outcome).toBe("ok");
        expect((out[1] as any).outcome).toBeUndefined();
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

    it("does not take the copy of a request (api-request-blob) for a new spawn", () => {
        const spawn = {
            type: "tool_use",
            id: "t1",
            name: "Task",
            input: { subagent_type: "Explore", prompt: "look at X" },
        };
        const lines = [
            asst([spawn]),
            usr([{ type: "tool_result", tool_use_id: "t1", is_error: false }]),
            JSON.stringify({ type: "api-request-blob", hash: "h", message: { role: "assistant", content: [spawn] } }),
        ];
        expect(extractSubagentSpawns(lines)).toEqual([
            { toolUseId: "t1", subagentType: "Explore", prompt: "look at X", done: true, failed: false },
        ]);
    });

    it("does not take a background agent's launch receipt for its result", () => {
        const lines = [
            asst([{ type: "tool_use", id: "bg", name: "Agent", input: { subagent_type: "Explore", prompt: "map it" } }]),
            usr([
                {
                    type: "tool_result",
                    tool_use_id: "bg",
                    content: [{ type: "text", text: "Async agent launched successfully. (This tool result is internal metadata)" }],
                },
            ]),
        ];
        expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: false, failed: false, async: true });
    });

    describe("a background agent's launch ack and its notification", () => {
        const spawnBg = (id: string) =>
            asst([
                {
                    type: "tool_use",
                    id,
                    name: "Agent",
                    input: { subagent_type: "Explore", prompt: "dig", run_in_background: true },
                },
            ]);
        // the ack's own text is left different from the receipt text, so only the record's toolUseResult says it
        const ack = (id: string, toolUseResult: any, isError = false) =>
            JSON.stringify({
                type: "user",
                toolUseResult,
                message: {
                    content: [{ type: "tool_result", tool_use_id: id, content: "Started.", is_error: isError }],
                },
            });
        const notice = (id: string, status: string) =>
            `<task-notification>\n<task-id>x</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>s</summary>\n</task-notification>`;
        const noticeRec = (id: string, status: string) =>
            JSON.stringify({ type: "user", message: { content: notice(id, status) } });

        it("reads an ack carrying toolUseResult.isAsync as a launch, whatever its text says", () => {
            const out = extractSubagentSpawns([spawnBg("b1"), ack("b1", { isAsync: true })]);
            expect(out[0]).toMatchObject({ done: false, failed: false, async: true });
        });

        it("reads an ack carrying toolUseResult.status async_launched as a launch", () => {
            const out = extractSubagentSpawns([spawnBg("b1"), ack("b1", { status: "async_launched" })]);
            expect(out[0]).toMatchObject({ done: false, failed: false, async: true });
        });

        it("does not read an errored result as a launch even when its record says async", () => {
            const out = extractSubagentSpawns([spawnBg("b1"), ack("b1", { isAsync: true }, true)]);
            expect(out[0]).toMatchObject({ done: true, failed: true });
            expect(out[0].async).toBeUndefined();
        });

        it("does not read a foreground agent's completed result as a launch", () => {
            const out = extractSubagentSpawns([spawnBg("f1"), ack("f1", { status: "completed" })]);
            expect(out[0]).toMatchObject({ done: true, failed: false });
            expect(out[0].async).toBeUndefined();
        });

        it("ends the spawn as a success at a completed notification", () => {
            const lines = [spawnBg("b1"), ack("b1", { isAsync: true }), noticeRec("b1", "completed")];
            expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: true, failed: false, async: true });
        });

        it("ends the spawn as a failure at a failed or stopped notification", () => {
            for (const status of ["failed", "killed", "stopped"]) {
                const lines = [spawnBg("b1"), ack("b1", { status: "async_launched" }), noticeRec("b1", status)];
                expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: true, failed: true, async: true });
            }
        });

        it("ends the spawn at a notification that is a text block, a queue-operation or a queued command", () => {
            const textBlock = JSON.stringify({
                type: "user",
                message: { content: [{ type: "text", text: notice("b1", "completed") }] },
            });
            const queued = JSON.stringify({ type: "queue-operation", operation: "enqueue", content: notice("b1", "completed") });
            const attached = JSON.stringify({
                type: "attachment",
                attachment: { type: "queued_command", prompt: notice("b1", "completed") },
            });
            for (const rec of [textBlock, queued, attached]) {
                const lines = [spawnBg("b1"), ack("b1", { isAsync: true }), rec];
                expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: true, failed: false });
            }
        });

        it("keeps the spawn running at a notification that is not an end, or names another spawn", () => {
            const lines = [
                spawnBg("b1"),
                ack("b1", { isAsync: true }),
                noticeRec("b1", "running"),
                noticeRec("other", "completed"),
                JSON.stringify({ type: "user", message: { content: "<task-notification><task-id>x</task-id></task-notification>" } }),
            ];
            expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: false, failed: false, async: true });
        });

        it("keeps a foreground spawn's result: a notification naming it changes nothing", () => {
            const lines = [spawnBg("f1"), ack("f1", { status: "completed" }), noticeRec("f1", "failed")];
            expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: true, failed: false });
        });

        it("does not take a notification for a spawn still waiting on its result", () => {
            const lines = [spawnBg("f2"), noticeRec("f2", "completed")];
            expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: false, failed: false });
        });

        it("keeps the receipt-text check: a launch receipt with no toolUseResult is still a launch", () => {
            const lines = [
                spawnBg("b1"),
                usr([{ type: "tool_result", tool_use_id: "b1", content: "Async agent launched successfully. agentId: a1" }]),
                noticeRec("b1", "completed"),
            ];
            expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: true, failed: false, async: true });
        });

        it("does not take the copy of a notification (api-request-blob) for its end", () => {
            const blob = JSON.stringify({
                type: "api-request-blob",
                hash: "h",
                message: { role: "user", content: notice("b1", "completed") },
            });
            const lines = [spawnBg("b1"), ack("b1", { isAsync: true }), blob];
            expect(extractSubagentSpawns(lines)[0]).toMatchObject({ done: false, failed: false, async: true });
        });
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

    it("lists an Agent tool_use as a spawn like a Task", () => {
        const lines = [asst([{ type: "tool_use", id: "g1", name: "Agent", input: { subagent_type: "Plan", prompt: "plan it" } }])];
        expect(extractSubagentSpawns(lines)).toStrictEqual([
            { toolUseId: "g1", subagentType: "Plan", prompt: "plan it", done: false, failed: false },
        ]);
    });

    it("reads a missing or non-string subagent_type and prompt as empty strings", () => {
        const lines = [
            asst([{ type: "tool_use", id: "e1", name: "Task", input: { prompt: 5 } }]),
            asst([{ type: "tool_use", id: "e2", name: "Task", input: { subagent_type: 7 } }]),
            asst([{ type: "tool_use", id: "e3", name: "Task" }]),
        ];
        expect(extractSubagentSpawns(lines)).toStrictEqual([
            { toolUseId: "e1", subagentType: "", prompt: "", done: false, failed: false },
            { toolUseId: "e2", subagentType: "", prompt: "", done: false, failed: false },
            { toolUseId: "e3", subagentType: "", prompt: "", done: false, failed: false },
        ]);
    });

    it("ignores records without content, blocks that are not Task tool_use with an id, and results for no spawn", () => {
        const lines = [
            JSON.stringify({ type: "system" }),
            asst([
                null,
                { type: "text", name: "Task", id: "x1" },
                { type: "tool_use", name: "Task", input: { prompt: "no id" } },
                { type: "tool_use", id: 9, name: "Task", input: { prompt: "numeric id" } },
                { type: "tool_use", id: "k1", name: "Task", input: { prompt: "real" } },
            ]),
            usr([
                { type: "tool_result", tool_use_id: "unknown", is_error: true },
                { type: "text", tool_use_id: "k1" },
                { type: "tool_result" },
            ]),
        ];
        expect(extractSubagentSpawns(lines)).toStrictEqual([
            { toolUseId: "k1", subagentType: "", prompt: "real", done: false, failed: false },
        ]);
    });
});

describe("projectTranscript SubagentHandback", () => {
    const asst = (blocks: any[]) => JSON.stringify({ type: "assistant", message: { content: blocks } });
    const usr = (blocks: any[]) => JSON.stringify({ type: "user", message: { content: blocks } });

    it("drops the handback call and its result, keeping the work around them", () => {
        const lines = [
            asst([
                { type: "tool_use", id: "h1", name: "SubagentHandback", input: { report: "all done" } },
                { type: "tool_use", id: "r1", name: "Read", input: { file_path: "/a/b.ts" } },
            ]),
            usr([
                { type: "tool_result", tool_use_id: "h1", content: "handed back" },
                { type: "tool_result", tool_use_id: "r1", content: "x" },
            ]),
        ];
        const out = projectTranscript(lines);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ kind: "action", verb: "read", target: "b.ts" });
    });

    it("drops a handback that is the whole turn, whatever its result says", () => {
        const lines = [
            asst([{ type: "tool_use", id: "h1", name: "SubagentHandback", input: { report: "all done" } }]),
            usr([{ type: "tool_result", tool_use_id: "h1", content: "boom", is_error: true }]),
        ];
        expect(projectTranscript(lines)).toEqual([]);
    });

    it("still shows an assistant's text beside the handback", () => {
        const lines = [
            asst([
                { type: "text", text: "Found it." },
                { type: "tool_use", id: "h1", name: "SubagentHandback", input: { report: "Found it." } },
            ]),
            usr([{ type: "tool_result", tool_use_id: "h1", content: "ok" }]),
        ];
        expect(projectTranscript(lines)).toEqual([{ kind: "message", text: "Found it." }]);
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

    it("keeps where the output is written, from the start result or the notification", () => {
        const start = [
            bash("t7", { command: "task check:ts", description: "Typecheck", run_in_background: true }),
            result(
                "t7",
                "Command running in background with ID: b7. Output is being written to: C:\\tmp\\tasks\\b7.output. You will be notified when it completes."
            ),
        ];
        expect(extractBackgroundTasks(start)[0].outputFile).toBe("C:\\tmp\\tasks\\b7.output");
        const quiet = [
            bash("t8", { command: "npm test", run_in_background: true }),
            result("t8", "", { toolUseResult: { backgroundTaskId: "b8" } }),
            JSON.stringify({
                type: "user",
                message: {
                    content:
                        "<task-notification><tool-use-id>t8</tool-use-id><output-file>/tmp/b8.output</output-file><status>completed</status></task-notification>",
                },
            }),
        ];
        expect(extractBackgroundTasks(quiet)[0]).toMatchObject({ status: "completed", outputFile: "/tmp/b8.output" });
    });

    it("keeps when a task started and when its first end notification landed", () => {
        const at = (line: string, timestamp: string) => JSON.stringify({ ...JSON.parse(line), timestamp });
        const lines = [
            at(bash("t9", { command: "pnpm run dev", run_in_background: true }), "2026-10-13T06:49:45Z"),
            result("t9", "Command running in background with ID: b9"),
            at(notify("t9", "completed"), "2026-10-13T06:53:22Z"),
            at(notify("t9", "completed"), "2026-10-13T06:50:49Z"),
        ];
        expect(extractBackgroundTasks(lines)[0]).toMatchObject({
            status: "completed",
            startMs: Date.parse("2026-10-13T06:49:45Z"),
            endMs: Date.parse("2026-10-13T06:50:49Z"),
        });
        expect(extractBackgroundTasks(lines.slice(0, 2))[0].endMs).toBeUndefined();
    });

    it("a plain foreground command is not a task", () => {
        expect(extractBackgroundTasks([bash("t3", { command: "ls" }), result("t3", "a\nb")])).toEqual([]);
        // its output only quotes a start result (a grep of a transcript, a read of this file)
        const quoted = result("t3", 'result("t1", "Command running in background with ID: b1abc"),');
        expect(extractBackgroundTasks([bash("t3", { command: "sed -n 1,9p x.test.ts" }), quoted])).toEqual([]);
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

    it("a resumed session's orphan summary, which names tasks only by task id, stops each of them", () => {
        const lines = [
            bash("t9", { command: "uv run fastapi", run_in_background: true }),
            result("t9", "Command running in background with ID: b9"),
            bash("t10", { command: "pnpm run start", run_in_background: true }),
            result("t10", "Command running in background with ID: b10"),
            JSON.stringify({
                type: "user",
                message: {
                    content:
                        "<task-notification>\n<task-id>b9</task-id>\n<task-id>b10</task-id>\n<task-id>__orphan_summary__:shell</task-id>\n<status>stopped</status>\n<summary>2 background shell command tasks didn't finish before the previous session ended.</summary>\n</task-notification>",
                },
            }),
        ];
        expect(extractBackgroundTasks(lines).map((t) => t.status)).toEqual(["stopped", "stopped"]);
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

    it("a background command refused before it started is not a task", () => {
        const refused = JSON.stringify({
            type: "user",
            message: {
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "t11",
                        content: "<tool_use_error>Refused by arcterm: drop the stdout redirect</tool_use_error>",
                        is_error: true,
                    },
                ],
            },
        });
        const lines = [bash("t11", { command: "make > out.log", run_in_background: true }), refused];
        expect(extractBackgroundTasks(lines)).toEqual([]);
        // Claude Code (2.1.299+) writes the request it sent as an api-request-blob, which repeats the tool_use
        const copy = JSON.stringify({
            type: "api-request-blob",
            hash: "h",
            message: {
                role: "assistant",
                content: [
                    {
                        type: "tool_use",
                        id: "t11",
                        name: "Bash",
                        input: { command: "make > out.log", run_in_background: true },
                    },
                ],
            },
        });
        expect(extractBackgroundTasks([...lines, copy])).toEqual([]);
    });

    it("a start whose result is not in the tail stays running with no task id", () => {
        expect(extractBackgroundTasks([bash("t6", { command: "sleep 99", run_in_background: true })])).toEqual([
            { toolUseId: "t6", label: "sleep 99", command: "sleep 99", status: "running" },
        ]);
    });

    const monitor = (id: string) =>
        asst([
            {
                type: "tool_use",
                id,
                name: "Monitor",
                input: { description: "Fit progress", command: "tail -f fit.log", timeout_ms: 1800000 },
            },
        ]);
    // an event notification names only the task id and carries no status; the expiry notice is one of them
    const eventText = (taskId: string, event: string) =>
        `<task-notification>\n<task-id>${taskId}</task-id>\n<summary>Monitor event: "Fit progress"</summary>\n<event>${event}</event>\n</task-notification>`;
    const monitorEvent = (taskId: string, event: string) =>
        JSON.stringify({ type: "user", message: { content: eventText(taskId, event) } });

    it("a Monitor is a task from its start result until its stream ends, through its events", () => {
        const start = [
            monitor("m1"),
            result("m1", "Monitor started (task bm1, expires in 30m unless the source ends first).", {
                toolUseResult: { taskId: "bm1", timeoutMs: 1800000, persistent: false },
            }),
            monitorEvent("bm1", "epoch 3/30"),
        ];
        expect(extractBackgroundTasks(start)).toEqual([
            {
                toolUseId: "m1",
                taskId: "bm1",
                label: "Fit progress",
                command: "tail -f fit.log",
                status: "running",
                monitor: true,
                timeoutMs: 1800000,
                persistent: false,
                events: [{ lines: ["epoch 3/30"] }],
            },
        ]);
        expect(extractBackgroundTasks([...start, notify("m1", "completed")])[0].status).toBe("completed");
        expect(extractBackgroundTasks([...start, notify("m1", "killed")])[0].status).toBe("stopped");
    });

    it("a Monitor's expiry notice stops it", () => {
        const lines = [
            monitor("m2"),
            result("m2", "Monitor started (task bm2, expires in 30m unless the source ends first)."),
            monitorEvent(
                "bm2",
                "[Monitor expired after 30m with no events delivered. Re-arm it if you still need the watch.]"
            ),
        ];
        expect(extractBackgroundTasks(lines)[0]).toMatchObject({ taskId: "bm2", status: "stopped" });
    });

    it("a Monitor whose start was refused is not a task", () => {
        expect(extractBackgroundTasks([monitor("m3"), result("m3", "Monitor is not available")])).toEqual([]);
    });

    describe("monitor events and expiry", () => {
        // a task starts when the agent ran the command: its tool_use record, a second before its result
        const CALL_TS = "2026-10-27T09:00:00.000Z";
        const START_MS = Date.parse(CALL_TS);
        const TIMEOUT = 1800000;
        const at = (line: string, timestamp: string) => JSON.stringify({ ...JSON.parse(line), timestamp });
        // a start whose records carry timestamps, as a real transcript's do
        const startLogs = (toolResult: object = { taskId: "bm1", timeoutMs: TIMEOUT, persistent: false }) => [
            at(monitor("m1"), CALL_TS),
            at(
                result("m1", "Monitor started (task bm1, expires in 30m unless the source ends first).", {
                    toolUseResult: toolResult,
                }),
                "2026-10-27T09:00:01.000Z"
            ),
        ];
        const enqueue = (content: string, timestamp = "2026-10-27T09:01:00.000Z") =>
            JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp, content });
        const userText = (content: string, timestamp = "2026-10-27T09:01:00.050Z") =>
            JSON.stringify({ type: "user", timestamp, message: { role: "user", content } });
        const ev1 = eventText("bm1", "ERROR one\nERROR two");
        const eventsOf = (lines: string[], opts?: { now?: number }) => extractBackgroundTasks(lines, opts)[0]?.events;

        it("a Monitor that has reported nothing has an empty event list and its timeout from the start result", () => {
            expect(extractBackgroundTasks(startLogs())[0]).toMatchObject({
                monitor: true,
                status: "running",
                startMs: START_MS,
                timeoutMs: TIMEOUT,
                persistent: false,
                events: [],
            });
        });

        it("a persistent Monitor says so, and a start result with no timeout leaves it unset", () => {
            expect(
                extractBackgroundTasks(startLogs({ taskId: "bm1", timeoutMs: TIMEOUT, persistent: true }))[0]
            ).toMatchObject({
                persistent: true,
            });
            const bare = extractBackgroundTasks([
                monitor("m1"),
                result("m1", "Monitor started (task bm1, expires in 30m)"),
            ])[0];
            expect(bare.events).toEqual([]);
            expect(bare).not.toHaveProperty("timeoutMs");
            expect(bare).not.toHaveProperty("persistent");
        });

        it("a shell task has no event list", () => {
            const lines = [
                bash("t1", { command: "npm run dev", run_in_background: true }),
                result("t1", "", { toolUseResult: { backgroundTaskId: "b1" } }),
            ];
            expect(extractBackgroundTasks(lines)[0]).not.toHaveProperty("events");
        });

        it("each event counts once and keeps its time and its lines", () => {
            expect(eventsOf([...startLogs(), enqueue(ev1), userText(ev1)])).toEqual([
                { ts: Date.parse("2026-10-27T09:01:00.000Z"), lines: ["ERROR one", "ERROR two"] },
            ]);
        });

        it("an event delivered mid-turn counts once", () => {
            const remove = JSON.stringify({
                type: "queue-operation",
                operation: "remove",
                timestamp: "2026-10-27T09:01:01.000Z",
            });
            const attachment = JSON.stringify({
                type: "attachment",
                timestamp: "2026-10-27T09:01:01.000Z",
                attachment: { type: "queued_command", prompt: ev1, commandMode: "task-notification" },
            });
            expect(eventsOf([...startLogs(), enqueue(ev1), remove, attachment])).toHaveLength(1);
        });

        it("a user-record event with no enqueue counts", () => {
            expect(eventsOf([...startLogs(), userText(ev1, "2026-10-27T09:02:00.000Z")])).toEqual([
                { ts: Date.parse("2026-10-27T09:02:00.000Z"), lines: ["ERROR one", "ERROR two"] },
            ]);
        });

        it("two identical events both count", () => {
            const twice = (...records: string[]) => eventsOf([...startLogs(), ...records])?.length;
            expect(twice(enqueue(ev1), enqueue(ev1), userText(ev1), userText(ev1))).toBe(2);
            expect(twice(enqueue(ev1), userText(ev1), enqueue(ev1), userText(ev1))).toBe(2);
        });

        it("matches a user-record copy to its enqueue by body", () => {
            const ev2 = eventText("bm1", "ERROR three");
            expect(eventsOf([...startLogs(), enqueue(ev1), userText(ev2), userText(ev1)])).toHaveLength(2);
        });

        it("an event for an id with no Monitor start, or for a shell task, is ignored", () => {
            const stray = eventText("bother", "x");
            expect(extractBackgroundTasks([enqueue(stray), userText(stray)])).toEqual([]);
            expect(eventsOf([...startLogs(), enqueue(stray), userText(stray)])).toEqual([]);
            const shell = [
                bash("t1", { command: "npm run dev", run_in_background: true }),
                result("t1", "", { toolUseResult: { backgroundTaskId: "b1" } }),
                enqueue(eventText("b1", "not a monitor")),
            ];
            expect(extractBackgroundTasks(shell)[0]).not.toHaveProperty("events");
        });

        it("the expiry notice ends the Monitor and is not one of its events", () => {
            const expired = eventText(
                "bm1",
                "[Monitor expired after 30m with no events delivered. Re-arm it if you still need the watch.]"
            );
            const copy = userText(expired, "2026-10-27T09:30:01.050Z");
            const [t] = extractBackgroundTasks([...startLogs(), enqueue(expired, "2026-10-27T09:30:01.000Z"), copy]);
            expect(t).toMatchObject({ status: "stopped", endMs: Date.parse("2026-10-27T09:30:01.000Z"), events: [] });
        });

        it("an ended Monitor keeps its events, and TaskStop stops one", () => {
            const end = userText(
                "<task-notification>\n<task-id>bm1</task-id>\n<tool-use-id>m1</tool-use-id>\n<output-file>/tmp/bm1.output</output-file>\n<status>completed</status>\n<summary>Monitor stream ended</summary>\n</task-notification>",
                "2026-10-27T09:05:00.000Z"
            );
            const [done] = extractBackgroundTasks([...startLogs(), enqueue(ev1), userText(ev1), end]);
            expect(done).toMatchObject({
                status: "completed",
                endMs: Date.parse("2026-10-27T09:05:00.000Z"),
                outputFile: "/tmp/bm1.output",
            });
            expect(done.events).toHaveLength(1);
            const stop = asst([{ type: "tool_use", id: "s1", name: "TaskStop", input: { task_id: "bm1" } }]);
            expect(extractBackgroundTasks([...startLogs(), stop])[0].status).toBe("stopped");
        });

        it("reads a Monitor past its timeout as stopped at the expiry, when given the time", () => {
            const lines = startLogs();
            const expires = START_MS + TIMEOUT;
            expect(extractBackgroundTasks(lines, { now: expires - 1 })[0].status).toBe("running");
            expect(extractBackgroundTasks(lines, { now: expires })[0]).toMatchObject({
                status: "stopped",
                endMs: expires,
            });
            // without the time the clock is not consulted, and a notice that landed first still wins
            expect(extractBackgroundTasks(lines)[0].status).toBe("running");
            const ended = userText(
                "<task-notification><task-id>bm1</task-id><tool-use-id>m1</tool-use-id><status>completed</status></task-notification>",
                "2026-10-27T09:10:00.000Z"
            );
            expect(extractBackgroundTasks([...lines, ended], { now: expires + 1 })[0]).toMatchObject({
                status: "completed",
                endMs: Date.parse("2026-10-27T09:10:00.000Z"),
            });
        });

        it("never expires a persistent Monitor, or one whose start time or timeout is unknown", () => {
            const far = START_MS + TIMEOUT * 100;
            const persistent = startLogs({ taskId: "bm1", timeoutMs: TIMEOUT, persistent: true });
            expect(extractBackgroundTasks(persistent, { now: far })[0].status).toBe("running");
            const untimed = [monitor("m1"), result("m1", "Monitor started (task bm1, expires in 30m)")];
            expect(extractBackgroundTasks(untimed, { now: far })[0].status).toBe("running");
            const undated = startLogs().map((l) => JSON.stringify({ ...JSON.parse(l), timestamp: undefined }));
            expect(extractBackgroundTasks(undated, { now: far })[0].status).toBe("running");
        });

        it("a Monitor with no command (a ws: source) is a task labelled by its description", () => {
            const ws = asst([
                {
                    type: "tool_use",
                    id: "m9",
                    name: "Monitor",
                    input: { description: "Watch the socket", timeout_ms: TIMEOUT, ws: { url: "ws://x" } },
                },
            ]);
            const [t] = extractBackgroundTasks([ws, result("m9", "Monitor started (task bm9, expires in 30m)")]);
            expect(t).toMatchObject({ taskId: "bm9", label: "Watch the socket", monitor: true });
            expect(t).not.toHaveProperty("command");
        });
    });
});

describe("projectTranscript AskUserQuestion", () => {
    const store = {
        question: "Which store?",
        header: "Store",
        multiSelect: false,
        options: [
            { label: "SQLite", description: "Reuse the object store" },
            { label: "In-memory map", description: "" },
        ],
    };
    const checks = {
        question: "Which checks?",
        header: "Checks",
        multiSelect: true,
        options: [{ label: "Go tests" }, { label: "CDP scenario" }, { label: "Lint" }],
    };
    const ask = (questions: unknown[]) =>
        JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "tool_use", id: "q1", name: "AskUserQuestion", input: { questions } }] },
        });
    const result = (toolUseResult: unknown, isError = false) =>
        JSON.stringify({
            type: "user",
            toolUseResult,
            message: { content: [{ type: "tool_result", tool_use_id: "q1", is_error: isError, content: "x" }] },
        });

    it("shows the question as the target and lists the options before an answer comes", () => {
        expect(projectTranscript([ask([store])])).toEqual([
            {
                kind: "action",
                verb: "asked",
                target: "Which store?",
                detail: {
                    kind: "ask",
                    questions: [
                        {
                            question: "Which store?",
                            header: "Store",
                            options: [{ label: "SQLite", description: "Reuse the object store" }, { label: "In-memory map" }],
                            picked: [],
                        },
                    ],
                },
            },
        ]);
    });

    it("puts a single answer in the summary and marks the picked option", () => {
        const [action] = projectTranscript([ask([store]), result({ answers: { "Which store?": "SQLite" } })]) as any[];
        expect(action.summary).toBe("SQLite");
        expect(action.outcome).toBe("ok");
        expect(action.detail.questions[0].picked).toEqual(["SQLite"]);
        expect(action.detail.questions[0].typed).toBeUndefined();
    });

    it("splits several picks from a typed answer, and counts answers across questions", () => {
        const [action] = projectTranscript([
            ask([store, checks]),
            result({ answers: { "Which store?": "a bolt file", "Which checks?": "Go tests, CDP scenario, a soak run" } }),
        ]) as any[];
        expect(action.summary).toBe("2 answers");
        expect(action.detail.questions[0]).toMatchObject({ picked: [], typed: "a bolt file" });
        expect(action.detail.questions[1]).toMatchObject({ picked: ["Go tests", "CDP scenario"], typed: "a soak run" });
    });

    it("cuts a long single answer so the summary cannot push the question out", () => {
        const long = "x".repeat(60);
        const [action] = projectTranscript([ask([store]), result({ answers: { "Which store?": long } })]) as any[];
        expect(action.summary).toBe("x".repeat(31) + "…");
        expect(action.detail.questions[0].typed).toBe(long);
    });

    it("fails a rejected question and leaves it unanswered", () => {
        const [action] = projectTranscript([ask([store]), result("User rejected tool use", true)]) as any[];
        expect(action.outcome).toBe("fail");
        expect(action.summary).toBeUndefined();
        expect(action.detail.questions[0].picked).toEqual([]);
    });
});

describe("projectTranscript: a message queued while Claude worked", () => {
    const queued = (prompt: unknown, commandMode = "prompt") =>
        JSON.stringify({
            type: "attachment",
            attachment: { type: "queued_command", prompt, commandMode, origin: { kind: "human" } },
            timestamp: "2026-11-09T15:06:17.661Z",
        });
    const assistant = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });

    it("draws a queued_command prompt as your message, in order", () => {
        const entries = projectTranscript([assistant("before"), queued("bị overlay kìa"), assistant("after")]);
        expect(entries).toEqual([
            { kind: "message", text: "before" },
            { kind: "user", text: "bị overlay kìa" },
            { kind: "message", text: "after" },
        ]);
    });

    it("keeps the text and the pictures of a block-array prompt in one entry", () => {
        const entries = projectTranscript([
            queued([
                { type: "text", text: "match this" },
                { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
            ]),
        ]);
        const viaUser = projectTranscript([
            JSON.stringify({
                type: "user",
                message: {
                    content: [
                        { type: "text", text: "match this" },
                        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
                    ],
                },
            }),
        ]);
        expect(entries).toEqual([{ kind: "user", text: "match this", images: ["data:image/png;base64,AAA"] }]);
        expect(entries).toEqual(viaUser);
    });

    it("draws nothing for a task-notification command mode or a queue-operation record", () => {
        const entries = projectTranscript([
            queued("<task-notification>x</task-notification>", "task-notification"),
            JSON.stringify({ type: "queue-operation", operation: "enqueue", content: "bị overlay kìa" }),
            JSON.stringify({ type: "attachment", attachment: { type: "hook_success" } }),
        ]);
        expect(entries).toEqual([]);
    });
});

// the shapes of errored Bash results Claude Code writes, as seen in real transcripts
describe("bashNeverRan", () => {
    it("reads a refusal before the command started as never ran", () => {
        for (const body of [
            "<tool_use_error>Refused by arcterm: Claude Code already saves a background command's output…</tool_use_error>",
            "<tool_use_error>Blocked: sleep 30 followed by: tail -20 out.log. To wait for a condition, use Monitor…</tool_use_error>",
            "<tool_use_error>InputValidationError: Bash failed due to the following issue:\nThe required parameter `command` is missing</tool_use_error>",
            "The server-side auto mode classifier gave no verdict for Bash: a hook changed this call's input…",
            "Permission for this action was denied by the Claude Code auto mode classifier. Reason: …",
            "The user doesn't want to proceed with this tool use. The tool use was rejected…",
            "This command requires approval",
            "This Bash command contains multiple operations. The following part requires approval: awk …",
            "This session is isolated in the worktree /repo/.claude/worktrees/x, but this command changes directory…",
        ]) {
            expect(bashNeverRan(body), body).toBe(true);
        }
    });

    it("reads a command that ran, or may have, as a failure", () => {
        for (const body of [
            "Exit code 1",
            "Exit code 1\nTraceback (most recent call last):",
            "Exit code 143\nCommand timed out after 2m 0s\n",
            "Interrupted: the response that made this tool call was stopped by a safety classifier while the call was running; it may have partially or fully completed.",
            "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown.]",
            "",
        ]) {
            expect(bashNeverRan(body), body).toBe(false);
        }
    });
});
