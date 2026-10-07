// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { extractAgyTitle, projectAgyTranscript } from "./agytranscriptprojection";

const L = JSON.stringify;

// The helpers below build synthetic steps in the shape of agy 1.3.1's transcript_full.jsonl. `realLs` is the
// `ls` conversation (brain/5c4560cf-…) as agy wrote it, with only the Cwd shortened.
const META =
    "\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-10-08T01:07:03+07:00.\n</ADDITIONAL_METADATA>" +
    "\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.8 Flash (Low). No need to comment on this change if the user doesn't ask about it.\n</USER_SETTINGS_CHANGE>";
const userInput = (text: string, idx = 0) =>
    L({
        step_index: idx,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-10-07T18:07:03Z",
        content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>${META}`,
    });
const planner = (idx: number, extra: Record<string, unknown>) =>
    L({
        step_index: idx,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-10-07T18:07:03Z",
        input_tokens: 11977,
        cache_read_tokens: 0,
        output_tokens: 152,
        ...extra,
    });
const generic = (idx: number, body: string, status = "DONE", error?: string) =>
    L({
        step_index: idx,
        source: "MODEL",
        type: "GENERIC",
        status,
        ...(error != null ? { error } : {}),
        created_at: "2026-10-07T18:07:05Z",
        content: `Created At: 2026-10-08T01:07:05+07:00\nCompleted At: 2026-10-08T01:07:05+07:00\n${body}`,
    });

const lsRun = {
    name: "run_command",
    args: {
        CommandLine: "ls",
        Cwd: "/home/u/ws",
        WaitMsBeforeAsync: 5000,
        toolAction: "Running ls",
        toolSummary: "List directory contents",
    },
};

const LS_PROMPT = "Run the shell command 'ls' and tell me how many files you saw. Be brief.";
const realLs = [
    L({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-10-07T18:07:03Z",
        content:
            "<USER_REQUEST>\nRun the shell command 'ls' and tell me how many files you saw. Be brief.\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-10-08T01:07:03+07:00.\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.8 Flash (Low). No need to comment on this change if the user doesn't ask about it. If reporting what model you are, please use a human readable name instead of the exact string.\n</USER_SETTINGS_CHANGE>",
    }),
    L({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-10-07T18:07:03Z",
        input_tokens: 11977,
        cache_read_tokens: 0,
        output_tokens: 152,
        tool_calls: [
            {
                name: "run_command",
                args: {
                    CommandLine: "ls",
                    Cwd: "/tmp/agyprobe/ws",
                    WaitMsBeforeAsync: 5000,
                    toolAction: "Running ls command",
                    toolSummary: "Run ls",
                },
            },
        ],
    }),
    L({
        step_index: 2,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-10-07T18:07:06Z",
        content:
            "Created At: 2026-10-08T01:07:06+07:00\nCompleted At: 2026-10-08T01:07:06+07:00\n\nThe command exited with code 0.\nOutput:\na.txt\r\n\n",
    }),
    L({
        step_index: 3,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-10-07T18:07:06Z",
        input_tokens: 12218,
        cache_read_tokens: 0,
        output_tokens: 10,
        content: "I saw 1 file (`a.txt`).",
    }),
];

describe("projectAgyTranscript", () => {
    it("projects the real ls conversation: user, tool, result, assistant, in order", () => {
        const entries = projectAgyTranscript(realLs);
        expect(entries).toEqual([
            { kind: "user", text: LS_PROMPT },
            {
                kind: "action",
                verb: "run_command",
                target: "Run ls",
                outcome: "ok",
                detail: {
                    kind: "bash",
                    command: "ls",
                    output: "The command exited with code 0.\nOutput:\na.txt",
                    exit: 0,
                },
            },
            { kind: "message", text: "I saw 1 file (`a.txt`)." },
        ]);
    });

    it("normalises CRLF in a multi-line result", () => {
        const entries = projectAgyTranscript([
            planner(1, { tool_calls: [lsRun] }),
            generic(2, "\nOutput:\na.txt\r\nb.txt\r\n\n"),
        ]);
        const a = entries[0];
        expect(a.kind === "action" && a.detail?.kind === "bash" && a.detail.output).toBe("Output:\na.txt\nb.txt");
    });

    it("keeps only the USER_REQUEST body: the metadata blocks never render", () => {
        const [user] = projectAgyTranscript(realLs);
        expect(user.kind === "user" && user.text).not.toMatch(/ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|local time/);
    });

    it("drops thinking: no entry carries it", () => {
        const entries = projectAgyTranscript([planner(1, { thinking: "secret reasoning", content: "answer" })]);
        expect(entries).toEqual([{ kind: "message", text: "answer" }]);
        expect(JSON.stringify(projectAgyTranscript([planner(1, { thinking: "I should run ls." })]))).not.toContain(
            "I should run ls"
        );
    });

    it("strips the Created At / Completed At header from a result", () => {
        const [, action] = projectAgyTranscript(realLs);
        expect(action.kind === "action" && action.detail?.kind === "bash" && action.detail.output).not.toMatch(/At:/);
    });

    it("marks an ERROR result failed and keeps the error text, even when a hook denied it", () => {
        const err = "tool call denied by pre-tool hook: ";
        const entries = projectAgyTranscript([
            userInput("ls"),
            planner(1, { tool_calls: [lsRun] }),
            generic(2, `Encountered error in step execution: ${err}`, "ERROR", err),
        ]);
        expect(entries[1]).toMatchObject({
            kind: "action",
            outcome: "fail",
            detail: { kind: "bash", exit: 1, output: `Encountered error in step execution: ${err}`.trimEnd() },
        });
    });

    it("projects an ask_question denied by the hook with its answer", () => {
        const answer =
            "tool call denied by pre-tool hook: The user answered in the arcterm cockpit: Which color? -> blue";
        const entries = projectAgyTranscript([
            userInput("Use your ask_question tool to ask me which color I prefer."),
            planner(1, {
                tool_calls: [
                    {
                        name: "ask_question",
                        args: {
                            questions: [
                                {
                                    is_multi_select: false,
                                    options: ["Red", "Blue"],
                                    question: "Which color do you prefer?",
                                },
                            ],
                            toolAction: "Asking preferred color",
                            toolSummary: "Color preference question",
                        },
                    },
                ],
            }),
            generic(2, `Encountered error in step execution: ${answer}`, "ERROR", answer),
            planner(3, { content: "blue" }),
        ]);
        expect(entries).toHaveLength(3);
        expect(entries[1]).toMatchObject({
            kind: "action",
            verb: "ask_question",
            target: "Color preference question",
            outcome: "fail",
        });
        expect(
            entries[1].kind === "action" && entries[1].detail?.kind === "bash" && entries[1].detail.output
        ).toContain("Which color? -> blue");
        expect(entries[2]).toEqual({ kind: "message", text: "blue" });
    });

    it("falls back to CommandLine, then the tool name, when there is no toolSummary", () => {
        const entries = projectAgyTranscript([
            planner(1, {
                tool_calls: [
                    { name: "run_command", args: { CommandLine: "git status" } },
                    { name: "view_file", args: {} },
                    { name: "list_dir" },
                ],
            }),
        ]);
        expect(entries.map((e) => e.kind === "action" && e.target)).toEqual(["git status", "view_file", "list_dir"]);
    });

    it("settles several tool calls of one step against the next results in order", () => {
        const entries = projectAgyTranscript([
            planner(1, {
                tool_calls: [
                    { name: "run_command", args: { CommandLine: "one", toolSummary: "first" } },
                    { name: "run_command", args: { CommandLine: "two", toolSummary: "second" } },
                ],
            }),
            generic(2, "out one"),
            generic(3, "out two", "ERROR"),
        ]);
        expect(entries[0]).toMatchObject({ target: "first", outcome: "ok", detail: { output: "out one" } });
        expect(entries[1]).toMatchObject({ target: "second", outcome: "fail", detail: { output: "out two" } });
    });

    it("leaves a tool call with no result yet unsettled", () => {
        const entries = projectAgyTranscript([planner(1, { tool_calls: [lsRun] })]);
        expect(entries).toEqual([{ kind: "action", verb: "run_command", target: "List directory contents" }]);
    });

    it("renders Vietnamese and multi-line text byte for byte", () => {
        const q = "Bạn chọn màu nào?\nDòng hai";
        const entries = projectAgyTranscript([userInput(q), planner(1, { content: "Màu xanh\n- một\n- hai" })]);
        expect(entries).toEqual([
            { kind: "user", text: q },
            { kind: "message", text: "Màu xanh\n- một\n- hai" },
        ]);
    });

    it("skips a malformed line, a non-object line and an unknown step type", () => {
        const entries = projectAgyTranscript([
            "{not json",
            "null",
            "42",
            "[]",
            L({ step_index: 0, type: "SYSTEM_MESSAGE", status: "DONE", content: "system noise" }),
            L({ step_index: 1, type: "BRAND_NEW_STEP", status: "DONE", content: "future" }),
            L({ step_index: 2, type: 7 }),
            planner(3, { content: "still here" }),
        ]);
        expect(entries).toEqual([{ kind: "message", text: "still here" }]);
    });

    it("skips a GENERIC step with no tool call pending", () => {
        expect(projectAgyTranscript([generic(1, "orphan")])).toEqual([]);
    });

    it("truncates a 2 MiB result to 64 KiB with a marker and still projects the rest", () => {
        const huge = "x".repeat(2 * 1024 * 1024);
        const entries = projectAgyTranscript([
            planner(1, { tool_calls: [lsRun] }),
            generic(2, huge),
            planner(3, { content: "done" }),
        ]);
        expect(entries).toHaveLength(2);
        const action = entries[0];
        const output = action.kind === "action" && action.detail?.kind === "bash" ? action.detail.output : "";
        expect(output.length).toBeLessThan(64 * 1024 + 64);
        expect(output.length).toBeGreaterThan(64 * 1024 - 1);
        expect(output.endsWith("… [truncated]")).toBe(true);
        expect(entries[1]).toEqual({ kind: "message", text: "done" });
    });

    it("never cuts a surrogate pair when it truncates", () => {
        const body = "a".repeat(64 * 1024 - 1) + "😀" + "b".repeat(10);
        const entries = projectAgyTranscript([planner(1, { tool_calls: [lsRun] }), generic(2, body)]);
        const a = entries[0];
        const output = a.kind === "action" && a.detail?.kind === "bash" ? a.detail.output : "";
        expect(output).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    });

    it("leaves a result at exactly 64 KiB whole", () => {
        const body = "y".repeat(64 * 1024);
        const entries = projectAgyTranscript([planner(1, { tool_calls: [lsRun] }), generic(2, body)]);
        const a = entries[0];
        expect(a.kind === "action" && a.detail?.kind === "bash" && a.detail.output).toBe(body);
    });

    it("projects an empty transcript to nothing", () => {
        expect(projectAgyTranscript([])).toEqual([]);
    });
});

describe("extractAgyTitle", () => {
    it("is the first USER_REQUEST", () => {
        expect(extractAgyTitle(realLs)).toBe(LS_PROMPT);
    });

    it("skips junk lines before the first request, and is undefined when there is none", () => {
        expect(extractAgyTitle(["oops", planner(0, { content: "hi" }), userInput("later prompt", 1)])).toBe(
            "later prompt"
        );
        expect(extractAgyTitle([planner(0, { content: "hi" })])).toBeUndefined();
        expect(extractAgyTitle([])).toBeUndefined();
    });
});
