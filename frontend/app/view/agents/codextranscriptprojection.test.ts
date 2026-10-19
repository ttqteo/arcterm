import { describe, expect, it } from "vitest";
import { extractCodexTasks, projectCodexTranscript } from "./codextranscriptprojection";

// codex rollout records are {timestamp, type, payload}; the meaningful conversation lives in
// `response_item`. event_msg carries guardian/auto-review noise + a duplicate of each assistant turn.
const ri = (payload: unknown) => JSON.stringify({ timestamp: "t", type: "response_item", payload });
const em = (payload: unknown) => JSON.stringify({ timestamp: "t", type: "event_msg", payload });

const LINES: string[] = [
    JSON.stringify({ type: "session_meta", payload: { id: "x" } }), // skipped
    ri({ type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/proj</cwd>\n</environment_context>" }] }), // synthetic env -> skipped
    ri({ type: "message", role: "user", content: [{ type: "input_text", text: "list the files" }] }), // user
    ri({ type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] }), // skipped
    ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Listing the directory now." }] }), // message
    ri({ type: "function_call", name: "shell_command", arguments: JSON.stringify({ command: "ls -la", workdir: "/proj" }), call_id: "c1" }), // ran ls -la
    em({ type: "guardian_assessment", text: "⚠ Automatic approval review approved (risk: low, authorization: unknown)" }), // NOISE -> skipped
    ri({ type: "function_call_output", call_id: "c1", output: "Exit code: 0\nWall time: 0.4 seconds\nOutput:\n..." }), // c1 -> ok
    ri({ type: "function_call", name: "shell_command", arguments: JSON.stringify({ command: "go test ./..." }), call_id: "c2" }), // ran go test
    ri({ type: "function_call_output", call_id: "c2", output: "Exit code: 1\nWall time: 2s\nOutput:\nFAIL" }), // c2 -> fail
    ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Tests fail; patching." }] }), // message
    ri({ type: "custom_tool_call", status: "completed", name: "apply_patch", call_id: "c3", input: "*** Begin Patch\n*** Update File: app/foo.py\n@@\n-old\n+new\n*** End Patch" }), // edited foo.py
    ri({ type: "custom_tool_call_output", call_id: "c3", output: JSON.stringify({ output: "Success. Updated the following files:\nM app/foo.py\n", metadata: { exit_code: 0 } }) }), // edit ok -> no outcome
    ri({ type: "message", role: "developer", content: [{ type: "input_text", text: "system instructions" }] }), // developer -> skipped
    em({ type: "agent_message", message: "Tests fail; patching." }), // duplicate of assistant turn -> skipped
];

describe("projectCodexTranscript", () => {
    it("projects user/assistant messages, tool calls, and outcomes in order", () => {
        expect(projectCodexTranscript(LINES)).toEqual([
            { kind: "user", text: "list the files" },
            { kind: "message", text: "Listing the directory now." },
            { kind: "action", verb: "ran", target: "ls -la", outcome: "ok" },
            { kind: "action", verb: "ran", target: "go test ./...", outcome: "fail" },
            { kind: "message", text: "Tests fail; patching." },
            { kind: "action", verb: "edited", target: "foo.py" },
        ]);
    });

    it("returns [] for empty input and skips unparseable lines", () => {
        expect(projectCodexTranscript([])).toEqual([]);
        expect(projectCodexTranscript(["garbage", "{bad"])).toEqual([]);
    });

    it("filters out event_msg guardian/auto-review noise entirely", () => {
        const out = projectCodexTranscript([
            em({ type: "guardian_assessment", text: "⚠ Automatic approval review approved (risk: low, authorization: unknown): Auto-review returned a low-risk allow decision." }),
            em({ type: "token_count", info: { total: 100 } }),
        ]);
        expect(out).toEqual([]);
    });

    it("skips the synthetic environment_context user message", () => {
        const out = projectCodexTranscript([
            ri({ type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/x</cwd>\n</environment_context>" }] }),
        ]);
        expect(out).toEqual([]);
    });

    it("emits an action with no outcome when the call output is missing", () => {
        const out = projectCodexTranscript([
            ri({ type: "function_call", name: "shell_command", arguments: JSON.stringify({ command: "ls" }), call_id: "z" }),
        ]);
        expect(out).toEqual([{ kind: "action", verb: "ran", target: "ls" }]);
    });

    it("skips injected <skill> context blocks but keeps the real prompt", () => {
        const out = projectCodexTranscript([
            ri({ type: "message", role: "user", content: [{ type: "input_text", text: "$superpowers:brainstorming what else should i add" }] }),
            ri({ type: "message", role: "user", content: [{ type: "input_text", text: "<skill>\n<name>superpowers:brainstorming</name>\n<path>/x/SKILL.md</path>\n# big skill body ..." }] }),
        ]);
        expect(out).toEqual([{ kind: "user", text: "$superpowers:brainstorming what else should i add" }]);
    });

    it("renders update_plan as 'updated plan · <in-progress step>'", () => {
        const out = projectCodexTranscript([
            ri({
                type: "function_call",
                name: "update_plan",
                arguments: JSON.stringify({
                    plan: [
                        { step: "Explore project context", status: "completed" },
                        { step: "Ask clarifying questions", status: "in_progress" },
                        { step: "Propose approaches", status: "pending" },
                    ],
                }),
                call_id: "p1",
            }),
        ]);
        expect(out).toEqual([{ kind: "action", verb: "updated plan", target: "Ask clarifying questions" }]);
    });

    it("renders update_plan with no in-progress step as a bare label", () => {
        const out = projectCodexTranscript([
            ri({
                type: "function_call",
                name: "update_plan",
                arguments: JSON.stringify({ plan: [{ step: "done step", status: "completed" }] }),
                call_id: "p2",
            }),
        ]);
        expect(out).toEqual([{ kind: "action", verb: "updated plan", target: "" }]);
    });
});

describe("projectCodexTranscript malformed and mistyped records", () => {
    const message = (role: string, content: unknown[]) => ri({ type: "message", role, content });
    const shell = (callId: string) => ri({ type: "function_call", name: "shell_command", arguments: JSON.stringify({ command: "ls" }), call_id: callId });

    it("skips a null line, an event_msg turn and a response_item without a payload", () => {
        const out = projectCodexTranscript([
            "null",
            em({ type: "message", role: "assistant", content: [{ type: "output_text", text: "duplicate" }] }),
            JSON.stringify({ type: "response_item" }),
        ]);
        expect(out).toEqual([]);
    });

    it("keeps only output_text blocks with text from an assistant turn", () => {
        const out = projectCodexTranscript([
            message("assistant", [
                null,
                { type: "input_text", text: "leak" },
                { type: "refusal", text: "leak too" },
                { type: "output_text" },
                { type: "output_text", text: "  " },
                { type: "output_text", text: "kept" },
            ]),
        ]);
        expect(out).toEqual([{ kind: "message", text: "kept" }]);
    });

    it("keeps only input_text blocks with real text from a user turn", () => {
        const out = projectCodexTranscript([
            message("user", [
                null,
                { type: "input_image", image_url: "x" },
                { type: "output_text", text: "leak" },
                { type: "input_text" },
                { type: "input_text", text: "  " },
                { type: "input_text", text: "real" },
            ]),
        ]);
        expect(out).toEqual([{ kind: "user", text: "real" }]);
    });

    it("skips a function_call without a name", () => {
        expect(projectCodexTranscript([ri({ type: "function_call", call_id: "n" })])).toEqual([]);
    });

    it("ignores an output whose call_id matches no action", () => {
        expect(projectCodexTranscript([ri({ type: "function_call_output", call_id: "nope", output: "Exit code: 0" })])).toEqual([]);
    });

    it("fails an action whose custom tool output reports a non-zero exit", () => {
        const out = projectCodexTranscript([
            ri({ type: "custom_tool_call", name: "apply_patch", call_id: "c", input: "*** Update File: app/foo.py" }),
            ri({ type: "custom_tool_call_output", call_id: "c", output: JSON.stringify({ metadata: { exit_code: 1 } }) }),
        ]);
        expect(out).toEqual([{ kind: "action", verb: "edited", target: "foo.py", outcome: "fail" }]);
    });

    it("does not settle an action from a payload of another type that shares its call_id", () => {
        const out = projectCodexTranscript([shell("c1"), ri({ type: "web_search_call", call_id: "c1", output: "Exit code: 0" })]);
        expect(out).toEqual([{ kind: "action", verb: "ran", target: "ls" }]);
    });
});

const plan = (steps: Array<{ step?: unknown; status?: unknown }>) =>
    ri({ type: "function_call", name: "update_plan", arguments: JSON.stringify({ plan: steps }), call_id: "p" });

describe("extractCodexTasks", () => {
    it("projects the latest update_plan into CardTask[] (completed -> done)", () => {
        const out = extractCodexTasks([
            plan([{ step: "Explore", status: "completed" }]),
            plan([
                { step: "Explore", status: "completed" },
                { step: "Ask questions", status: "in_progress" },
                { step: "Propose", status: "pending" },
            ]),
        ]);
        expect(out).toEqual([
            { text: "Explore", done: true },
            { text: "Ask questions", done: false },
            { text: "Propose", done: false },
        ]);
    });

    it("returns undefined when the transcript has no update_plan", () => {
        expect(
            extractCodexTasks([ri({ type: "function_call", name: "shell_command", arguments: "{}", call_id: "c" })])
        ).toBeUndefined();
        expect(extractCodexTasks([])).toBeUndefined();
    });

    it("returns [] for an empty plan and skips malformed steps", () => {
        expect(extractCodexTasks([plan([])])).toEqual([]);
        expect(extractCodexTasks([plan([{ step: 42, status: "pending" }, { step: "real", status: "pending" }])])).toEqual([
            { text: "real", done: false },
        ]);
    });

    it("ignores malformed arguments (returns undefined if no valid plan seen)", () => {
        expect(
            extractCodexTasks([ri({ type: "function_call", name: "update_plan", arguments: "not json", call_id: "p" })])
        ).toBeUndefined();
    });
});
