// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentActionEntry, AgentEntry, EditFile } from "./agentsviewmodel";
import { withResultLines } from "./chatinitiative";
import {
    agentWentOn,
    bashMode,
    canSendNow,
    CHAT_RENDER_STEP,
    chatItems,
    compactingNow,
    SEND_NOW_KEYS,
    shownItems,
    turnStatsLabel,
    workingLine,
    workingText,
    type AgentPart,
    type ChatItem,
} from "./chatmodel";

// the engine's own texts, written by pkg/orchestrate's TestViewModFixtures (the arc view mod reads them the same way)
const TESTDATA = fileURLToPath(new URL("../../../../claude/arc-view-mod/testdata/", import.meta.url));

function fixture(name: string): string {
    return readFileSync(`${TESTDATA}${name}.txt`, "utf8");
}

const action = (verb: string, extra: Partial<AgentActionEntry> = {}): AgentEntry => ({
    kind: "action",
    verb,
    target: `${verb}-target`,
    ...extra,
});

const file = (path: string, adds: number, dels: number): EditFile => ({
    path,
    badge: "M",
    adds,
    dels,
    lines: [{ sign: "+", text: `${path}:+${adds}` }],
});

const edit = (...files: EditFile[]): AgentEntry => action("edited", { detail: { kind: "edit", files } });

const you = (text: string): AgentEntry => ({ kind: "user", text });
const says = (text: string): AgentEntry => ({ kind: "message", text });

const POINTER =
    "Your instructions are in the file C:/work/app/.arc/prompts/run-1234-lead.md (too long for a command line). Read the whole file now and follow it exactly, as if it were this message.";

function agentOf(items: ChatItem[], at: number) {
    const item = items[at];
    if (item?.kind !== "agent") {
        throw new Error(`item ${at} is ${item?.kind}, not an agent group`);
    }
    return item;
}

describe("chatItems", () => {
    it("carries the record uuid onto your bubble and the agent's prose", () => {
        const items = chatItems([
            { kind: "user", text: "hello", uuid: "u1" },
            { kind: "message", text: "hi", uuid: "a1" },
        ]);
        expect(items[0]).toMatchObject({ kind: "you", text: "hello", uuid: "u1" });
        expect(items[1]).toMatchObject({ kind: "agent", parts: [{ kind: "prose", text: "hi", uuid: "a1" }] });
    });

    it("leaves the uuid off an item whose entry has none", () => {
        const items = chatItems([you("hello"), says("hi")]);
        expect(items[0]).not.toHaveProperty("uuid");
        expect(agentOf(items, 1).parts[0]).not.toHaveProperty("uuid");
    });

    it("turns an empty transcript into no items", () => {
        expect(chatItems([])).toEqual([]);
    });

    it("shows only what the person wrote when their message carried initiative result lines (result line)", () => {
        const sent = withResultLines(["initiative: added note to Auth (effort:ab12) › 2"], "now the tests");
        const wrapped = `<pasted_content id="45ce">\n${sent}\n</pasted_content id="45ce">`;
        for (const text of [sent, wrapped]) {
            const items = chatItems([{ kind: "user", text, uuid: "u1" }, says("ok")]);
            expect(items[0]).toMatchObject({ kind: "you", text: "now the tests", uuid: "u1" });
        }
        // a message that only mentions `initiative:` mid-text is left alone
        const mention = "see below\ninitiative: added by hand";
        expect(chatItems([you(mention)])[0]).toMatchObject({ kind: "you", text: mention });
    });

    it("gives a plain exchange one 'you' and one agent group of prose, work, files, prose", () => {
        const items = chatItems([
            you("fix the parser"),
            says("On it."),
            action("read"),
            edit(file("a.ts", 3, 1)),
            says("Done."),
        ]);
        expect(items.map((i) => i.kind)).toEqual(["you", "agent"]);
        expect(items[0]).toEqual({ kind: "you", key: expect.any(String), text: "fix the parser" });
        const group = agentOf(items, 1);
        expect(group.parts.map((p) => p.kind)).toEqual(["prose", "work", "files", "prose"]);
        expect(group.parts[0]).toEqual({ kind: "prose", text: "On it." });
        const work = group.parts[1];
        expect(work.kind === "work" && work.work.actions.map((a) => a.verb)).toEqual(["read", "edited"]);
        expect(group.parts[2]).toMatchObject({ kind: "files", adds: 3, dels: 1 });
        expect(group.parts[3]).toEqual({ kind: "prose", text: "Done." });
    });

    it("carries the merged per-file counts of the work's edits on its files part", () => {
        const group = agentOf(
            chatItems([edit(file("a.ts", 3, 1)), action("read"), edit(file("a.ts", 4, 2), file("b.ts", 1, 0))]),
            0
        );
        const files = group.parts.find((p) => p.kind === "files");
        expect(files).toMatchObject({ kind: "files", adds: 8, dels: 3 });
        expect(files?.kind === "files" && files.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    });

    it("adds no files part for work that edited nothing", () => {
        const group = agentOf(chatItems([action("read"), action("grep")]), 0);
        expect(group.parts.map((p) => p.kind)).toEqual(["work"]);
    });

    it("starts a new agent group at each message of yours", () => {
        const items = chatItems([you("one"), says("a"), you("two"), action("bash"), says("b")]);
        expect(items.map((i) => i.kind)).toEqual(["you", "agent", "you", "agent"]);
        expect(agentOf(items, 3).parts.map((p) => p.kind)).toEqual(["work", "prose"]);
    });

    it("keeps your pasted images on the bubble", () => {
        const [item] = chatItems([{ kind: "user", text: "look", images: ["data:image/png;base64,AAAA"] }]);
        expect(item).toMatchObject({ kind: "you", text: "look", images: ["data:image/png;base64,AAAA"] });
    });

    it("keeps a bubble that is only an image, with no text", () => {
        const [item] = chatItems([{ kind: "user", text: "", images: ["data:image/png;base64,AAAA"] }]);
        expect(item).toMatchObject({ kind: "you", text: "", images: ["data:image/png;base64,AAAA"] });
    });

    it("leaves images off a bubble that had none", () => {
        const [item] = chatItems([you("hi")]);
        expect("images" in item).toBe(false);
    });

    it("turns a slash command you typed into a 'you' carrying the command", () => {
        const items = chatItems([
            { kind: "command", name: "/review", args: "PR #402" },
            { kind: "command", name: "/clear" },
            { kind: "command", name: "brainstorming", args: "design x", isSkill: true },
        ]);
        expect(items).toEqual([
            { kind: "you", key: expect.any(String), command: "/review PR #402" },
            { kind: "you", key: expect.any(String), command: "/clear" },
            { kind: "you", key: expect.any(String), command: "/brainstorming design x" },
        ]);
    });

    it("turns a bash-mode command you ran into a 'you' carrying the command and, once it lands, its output", () => {
        const items = chatItems([
            { kind: "command", name: "!", args: "task install", shell: { output: "done", error: "" } },
            { kind: "command", name: "!", args: "sleep 60" },
        ]);
        expect(items).toEqual([
            { kind: "you", key: expect.any(String), command: "! task install", shell: { output: "done", error: "" } },
            { kind: "you", key: expect.any(String), command: "! sleep 60" },
        ]);
    });

    it("carries a slash command's output, and says a panel that left nothing to show opened in the terminal", () => {
        const items = chatItems([
            {
                kind: "command",
                name: "/goal",
                args: "tests pass",
                shell: { output: "Goal set: tests pass", error: "" },
            },
            { kind: "command", name: "/config", shell: { output: "Config dialog dismissed", error: "" } },
            { kind: "command", name: "/usage" },
            { kind: "command", name: "/model", shell: { output: "Set model to Opus", error: "" } },
            { kind: "command", name: "/clear" },
        ]);
        expect(items).toEqual([
            {
                kind: "you",
                key: expect.any(String),
                command: "/goal tests pass",
                shell: { output: "Goal set: tests pass", error: "" },
            },
            { kind: "you", key: expect.any(String), command: "/config", terminal: true },
            { kind: "you", key: expect.any(String), command: "/usage", terminal: true },
            {
                kind: "you",
                key: expect.any(String),
                command: "/model",
                shell: { output: "Set model to Opus", error: "" },
            },
            { kind: "you", key: expect.any(String), command: "/clear" },
        ]);
    });

    it("carries a /btw's side answer, or why there is none, on its command", () => {
        const items = chatItems([
            { kind: "command", name: "/btw", args: "which file?", btw: { answer: "`a.ts`" } },
            { kind: "command", name: "/btw", args: "why?", btw: { failure: "the reply was empty" } },
        ]);
        expect(items).toEqual([
            { kind: "you", key: expect.any(String), command: "/btw which file?", btw: { answer: "`a.ts`" } },
            { kind: "you", key: expect.any(String), command: "/btw why?", btw: { failure: "the reply was empty" } },
        ]);
    });

    it("draws compactions, interruptions and background notifications as markers between agent groups", () => {
        const items = chatItems([
            you("go"),
            says("working"),
            { kind: "interrupted" },
            says("resumed"),
            { kind: "compaction", trigger: "auto", preTokens: 100, postTokens: 10 },
            { kind: "notification", summary: "child done", status: "completed" },
        ]);
        expect(items.map((i) => i.kind)).toEqual(["you", "agent", "marker", "agent", "marker", "marker"]);
        expect(items[2]).toMatchObject({ kind: "marker", item: { kind: "interrupted" } });
        expect(items[4]).toMatchObject({
            kind: "marker",
            item: { kind: "compaction", trigger: "auto", preTokens: 100 },
        });
        expect(items[5]).toMatchObject({ kind: "marker", item: { kind: "notification", summary: "child done" } });
    });
});

describe("what arcterm typed", () => {
    it("reads a run's launch prompt as a 'sent' card from the run, never a bubble", () => {
        const items = chatItems([you(fixture("plan-lead"))]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            kind: "sent",
            from: "run",
            header: "run lead · plan submitted · 2 principles",
        });
        const lines = (items[0] as Extract<ChatItem, { kind: "sent" }>).lines;
        expect(lines).toContain("run run-1234");
        expect(lines).toContain("spec C:/work/app/docs/superpowers/specs/2026-11-04-coach-design.md");
        expect(lines).toContain("plan C:/work/app/docs/superpowers/plans/2026-11-04-coach.md");
        expect(lines).toContain("effort effort:eff-9");
    });

    it("reads the pointer line a prompt too long for a command line leaves, naming the file without reading it", () => {
        const [item] = chatItems([you(POINTER)]);
        expect(item).toMatchObject({
            kind: "sent",
            from: "run",
            header: "run prompt · from a file",
            lines: ["C:/work/app/.arc/prompts/run-1234-lead.md"],
        });
    });

    it("reads a message another agent sent through the cockpit as a 'sent' card from the cockpit", () => {
        const [item] = chatItems([you(fixture("agent-message"))]);
        expect(item).toMatchObject({
            kind: "sent",
            from: "cockpit",
            header: "message · from design lead",
            lines: ["tab tab-1234", "rename the helper", "and rerun the tests"],
            tabId: "tab-1234",
        });
    });

    it("reads a wake as a 'sent' card from the cockpit, headed by what the wake holds, one line per event", () => {
        const [item] = chatItems([you(fixture("wake"))]);
        expect(item).toEqual({
            kind: "sent",
            key: expect.any(String),
            from: "cockpit",
            header: "1 event · 1 question",
            lines: ["task t-3 failed (dispatch-unrecorded): the worker exited, retry spent", "1 question waiting"],
        });
    });

    it("reads a prompt that ends on a newline, which a line anchored to its end would otherwise miss", () => {
        const text = fixture("child-done");
        expect(chatItems([you(text)])[0].kind).toBe("sent");
        expect(chatItems([you(`${text}\n`)])[0].kind).toBe("sent");
        expect(chatItems([you(`${fixture("quick")}\n\n`)])[0].kind).toBe("sent");
    });

    it("keeps the text a bubble was typed with, trailing newline and all", () => {
        const [item] = chatItems([you("hello\n")]);
        expect(item).toMatchObject({ kind: "you", text: "hello\n" });
    });

    it("never reads any of the engine's own texts as a bubble of yours", () => {
        const names = [
            "quick",
            "lead-goal",
            "lead-goal-autonomous",
            "plan-lead",
            "plan-lead-replacement",
            "worker",
            "worker-dag",
            "reviewer",
            "plan-reviewer",
            "plan-reviewer-second",
            "verifier",
            "builder-check",
            "judge",
            "agent-message",
            "child-done",
            "child-cancelled",
            "builder-questions",
            "judged",
            "judge-failed",
            "for-later",
            "review-note",
            "wake",
            "autonomous-on",
            "autonomous-off",
        ];
        for (const name of names) {
            const [item] = chatItems([you(fixture(name))]);
            expect(item.kind, name).toBe("sent");
        }
    });

    it("reads a `brainstorm:` line as your message, so it can pair with its send record, not as a sent card", () => {
        const items = chatItems([{ kind: "user", text: "brainstorm: check", uuid: "u9" }]);
        expect(items).toEqual([{ kind: "you", key: "you:0", text: "brainstorm: check", uuid: "u9" }]);
        for (const line of [
            "brainstorm: confirm every guess",
            "brainstorm: builder answer: Fade",
            "brainstorm: run 3fa2c1d4",
            "brainstorm: approved\n",
        ]) {
            expect(chatItems([you(line)])[0], line).toMatchObject({ kind: "you", text: line });
        }
    });

    it("still reads the lines wavesrv sends by itself under `brainstorm:` as sent cards from the cockpit", () => {
        for (const name of ["judged", "judge-failed", "builder-questions"]) {
            expect(chatItems([you(fixture(name))])[0], name).toMatchObject({ kind: "sent", from: "cockpit" });
        }
    });

    it("still reads another agent's message and a child run's line as sent cards", () => {
        expect(chatItems([you(fixture("agent-message"))])[0]).toMatchObject({ kind: "sent", from: "cockpit" });
        for (const name of ["child-done", "child-cancelled"]) {
            expect(chatItems([you(fixture(name))])[0], name).toMatchObject({ kind: "sent", from: "cockpit" });
        }
    });

    it("keeps a sent card to six lines", () => {
        const body = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
        const text = `[Message from agent "lead" (tab tab-1), sent with wsh agents send. Not typed by the user. Its sender reads your reply with wsh agents read, so answer here and do not send one back.]\n${body}`;
        const [item] = chatItems([you(text)]);
        const lines = (item as Extract<ChatItem, { kind: "sent" }>).lines;
        expect(lines).toHaveLength(6);
        expect(lines[0]).toBe("tab tab-1");
        expect(lines[5]).toBe("line 5");
    });

    it("leaves a person's own text that merely mentions the engine as their bubble", () => {
        const [item] = chatItems([you("wake me when the run finished")]);
        expect(item).toMatchObject({ kind: "you", text: "wake me when the run finished" });
    });

    it("splits the exchange around a sent card: the card is neither you nor the agent", () => {
        const items = chatItems([you(POINTER), says("Reading it."), action("read"), you("thanks"), says("welcome")]);
        expect(items.map((i) => i.kind)).toEqual(["sent", "agent", "you", "agent"]);
    });
});

describe("keys", () => {
    it("are unique within a transcript", () => {
        const items = chatItems([
            you("a"),
            says("b"),
            action("read"),
            { kind: "interrupted" },
            { kind: "command", name: "/x" },
            you(POINTER),
            says("c"),
        ]);
        const keys = items.map((i) => i.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("stay the same when entries are appended", () => {
        const entries: AgentEntry[] = [you(POINTER), you("fix it"), says("On it."), action("read")];
        const before = chatItems(entries).map((i) => i.key);
        // more of the same work, a new reply, then a whole new exchange
        const longer = [...entries, action("grep"), says("Done."), you("again"), says("ok")];
        const after = chatItems(longer).map((i) => i.key);
        expect(after.slice(0, before.length)).toEqual(before);
        expect(after.length).toBeGreaterThan(before.length);
    });

    it("name an agent group by its first entry, so a tool landing before its prose still keeps the key", () => {
        const first = chatItems([you("go"), action("read")]);
        const later = chatItems([you("go"), action("read"), says("found it")]);
        expect(first.map((i) => i.key)).toEqual(later.map((i) => i.key));
    });
});

describe("turnStatsLabel", () => {
    const at = Date.parse("2026-11-10T14:30:00.000Z");

    it("reads as the TUI's: how long the turn has run, then its output tokens", () => {
        expect(turnStatsLabel({ startedAt: at, outputTokens: 860 }, at + 34_000)).toBe("34s · ↓ 860 tokens");
        expect(turnStatsLabel({ startedAt: at, outputTokens: 3_140 }, at + 71_000)).toBe("1m 11s · ↓ 3.1k tokens");
        expect(turnStatsLabel({ startedAt: at, outputTokens: 12_600 }, at + 3_725_000)).toBe("1h 2m · ↓ 13k tokens");
        expect(turnStatsLabel({ startedAt: at, outputTokens: 1_250_000 }, at + 5_000)).toBe("5s · ↓ 1.3M tokens");
    });

    it("leaves out tokens before the first reply lands, and a time it cannot know", () => {
        expect(turnStatsLabel({ startedAt: at, outputTokens: 0 }, at + 3_000)).toBe("3s");
        expect(turnStatsLabel({ startedAt: NaN, outputTokens: 42 }, at)).toBe("↓ 42 tokens");
        expect(turnStatsLabel({ startedAt: at, outputTokens: 1 }, at + 2_000)).toBe("2s · ↓ 1 token");
    });
});

describe("bashMode", () => {
    it("is on when the box starts with !, as Claude Code's own box reads it", () => {
        expect(bashMode("!")).toBe(true);
        expect(bashMode("! ls -la")).toBe(true);
        expect(bashMode("!git status")).toBe(true);
    });

    it("is off for text that only holds a ! later on, or starts with a space", () => {
        expect(bashMode("")).toBe(false);
        expect(bashMode("fix it!")).toBe(false);
        expect(bashMode(" !ls")).toBe(false);
        expect(bashMode("/clear")).toBe(false);
    });
});

describe("send now", () => {
    it("is Claude Code's ctrl+x ctrl+s chord, which every terminal sends as itself", () => {
        expect([...SEND_NOW_KEYS].map((c) => c.charCodeAt(0))).toEqual([0x18, 0x13]);
    });

    it("is offered only while Claude works, not while a prompt holds the keys or it waits", () => {
        expect(canSendNow("working")).toBe(true);
        expect(canSendNow("asking")).toBe(false);
        expect(canSendNow("idle")).toBe(false);
    });
});

describe("workingLine", () => {
    it("says Working… while the agent works with nothing to report", () => {
        expect(workingLine("working", undefined)).toBe("Working…");
        expect(workingLine("working", "")).toBe("Working…");
        expect(workingLine("working", "   ")).toBe("Working…");
    });

    it("adds the activity when it has one", () => {
        expect(workingLine("working", "Bash: npm test")).toBe("Working · Bash: npm test");
    });

    it("says Compacting… while a compaction runs", () => {
        expect(workingLine("working", "compacting")).toBe("Compacting…");
        expect(compactingNow("working", "compacting")).toBe(true);
        expect(compactingNow("working", "running ls")).toBe(false);
        expect(compactingNow("idle", "compacting")).toBe(false);
    });

    it("is null when the agent is not working", () => {
        expect(workingLine("idle", "Bash: npm test")).toBeNull();
        expect(workingLine("asking", "Bash: npm test")).toBeNull();
        expect(workingLine("idle", undefined)).toBeNull();
    });
});

describe("workingText", () => {
    it("names the running tool's own description when the last entry is one with no result", () => {
        const entries: AgentEntry[] = [{ kind: "user", text: "go" }, action("ran", { target: "go build ./..." })];
        expect(workingText("working", "running B=$(…", entries)).toBe("Working · go build ./...");
    });

    it("keeps the activity line when the last tool has its result, or the last entry is not a tool", () => {
        const done = [action("ran", { target: "go build", outcome: "ok" })];
        expect(workingText("working", "Bash: npm test", done)).toBe("Working · Bash: npm test");
        const said: AgentEntry[] = [action("ran", { target: "go build" }), { kind: "message", text: "done" }];
        expect(workingText("working", undefined, said)).toBe("Working…");
    });

    it("says Compacting… over a tool with no result", () => {
        const entries: AgentEntry[] = [action("ran", { target: "go build ./..." })];
        expect(workingText("working", "compacting", entries)).toBe("Compacting…");
    });

    it("is null when the agent is not working, whatever the entries", () => {
        expect(workingText("idle", "x", [action("ran", { target: "go build" })])).toBeNull();
    });

    it("falls back to the activity line when the running tool has no target", () => {
        expect(workingText("working", "Bash: npm test", [action("ran", { target: "" })])).toBe(
            "Working · Bash: npm test"
        );
    });
});

// the moments an agent item is cut at: a reviewer's verdict, the plan handoff, a `wsh runs start` call, a
// `wsh council start` call and a Doc review ask
describe("chatItems: verdict, handoff, run-start, council-start and Doc review parts", () => {
    const REVIEW = {
        kind: "code",
        reviewer: "code-reviewer",
        pass: false,
        note: "Two things to fix",
        findings: [{ severity: "Critical", file: "a.ts", line: 3, summary: "bad" }],
    };
    const block = (v: object = REVIEW): string => `\`\`\`arc-review\n${JSON.stringify(v)}\n\`\`\``;
    const kinds = (items: ChatItem[], at = 1): string[] => agentOf(items, at).parts.map((p) => p.kind);
    const part = (items: ChatItem[], p: number, at = 1) => agentOf(items, at).parts[p];

    // an Agent / Task call: the subagent it started
    const spawn = (description: string, subagentType?: string, toolUseId?: string): AgentEntry =>
        action("agent", { subagent: { description, ...(subagentType ? { subagentType } : {}), toolUseId } });
    const reported = (...summaries: string[]): AgentEntry =>
        action("reported", {
            outcome: "ok",
            findings: summaries.map((summary, i) => ({
                file: `f${i}.ts`,
                line: i + 1,
                summary,
                verdict: i === 0 ? "CONFIRMED" : "PLAUSIBLE",
            })),
        });
    const ask = (header: string, picked: string[] = [], extra: Partial<AgentActionEntry> = {}): AgentEntry =>
        action("asked", {
            outcome: picked.length > 0 ? "ok" : undefined,
            detail: {
                kind: "ask",
                questions: [
                    {
                        question: "Plan saved to `docs/plans/p.md`. How to run it?",
                        header,
                        options: [{ label: "Arc engine (Recommended)" }, { label: "Inline in this session" }],
                        picked,
                    },
                ],
            },
            ...extra,
        });
    const runsStart = (output: string, command = "wsh runs start --plan docs/plans/p.md"): AgentEntry =>
        action("bash", { outcome: "ok", detail: { kind: "bash", command, output, exit: 0 } });
    const councilStart = (output: string, command = 'wsh council start --feature "Scheduled tasks"'): AgentEntry =>
        action("bash", { outcome: "ok", detail: { kind: "bash", command, output, exit: 0 } });
    // a Doc review ask: `path` is the question's first line, which `parseDocReview` reads
    const docReview = (
        picked: string[] = [],
        typed?: string,
        path = "paper/intro.tex",
        header = "Doc review"
    ): AgentEntry =>
        action("asked", {
            outcome: picked.length > 0 ? "ok" : undefined,
            detail: {
                kind: "ask",
                questions: [
                    {
                        question: `${path}\n- the second paragraph is new`,
                        header,
                        options: [{ label: "Approve" }, { label: "Request changes" }],
                        picked,
                        ...(typed != null ? { typed } : {}),
                    },
                ],
            },
        });

    describe("an arc-review block in a reply", () => {
        it("cuts a reply with a block between two paragraphs into prose, verdict, prose", () => {
            const items = chatItems([
                you("review it"),
                { kind: "message", text: `Before.\n\n${block()}\n\nAfter.`, uuid: "m1" },
            ]);
            expect(kinds(items)).toEqual(["prose", "verdict", "prose"]);
            expect(part(items, 0)).toEqual({ kind: "prose", text: "Before.", uuid: "m1" });
            expect(part(items, 1)).toMatchObject({ kind: "verdict", key: "verdict:1", verdict: REVIEW });
            expect(part(items, 2)).toEqual({ kind: "prose", text: "After.", uuid: "m1" });
        });

        it("leaves no empty prose part when the block is the whole reply", () => {
            expect(kinds(chatItems([you("x"), says(block())]))).toEqual(["verdict"]);
        });

        it("leaves a block that does not parse in the prose, as one part with the text as written", () => {
            const broken = `Look:\n\n\`\`\`arc-review\n{ not json\n\`\`\`\n\nDone.`;
            const items = chatItems([you("x"), says(broken)]);
            expect(kinds(items)).toEqual(["prose"]);
            expect(part(items, 0)).toEqual({ kind: "prose", text: broken });
        });

        it("leaves a reply with no block exactly as it was written", () => {
            const text = "  A reply with trailing space.  \n\n";
            expect(part(chatItems([you("x"), says(text)]), 0)).toEqual({ kind: "prose", text });
        });

        it("keys one block by its message, and several blocks of one message by their order in it", () => {
            const one = chatItems([you("x"), says(`a\n\n${block()}`)]);
            expect(part(one, 1)).toMatchObject({ key: "verdict:1" });
            const two = chatItems([you("x"), says(`${block()}\n\nand\n\n${block({ ...REVIEW, kind: "plan" })}`)]);
            expect(kinds(two)).toEqual(["verdict", "prose", "verdict"]);
            expect(part(two, 0)).toMatchObject({ key: "verdict:1.0" });
            expect(part(two, 2)).toMatchObject({ key: "verdict:1.1" });
        });

        it("pairs the block with the reviewer call its subagent field names", () => {
            const items = chatItems([
                you("go"),
                spawn("Review the plan", "superpowers:code-reviewer", "toolu_plan"),
                spawn("Review the code", "superpowers:code-reviewer", "toolu_code"),
                says(block({ ...REVIEW, subagent: "review the plan" })),
            ]);
            expect(kinds(items)).toEqual(["work", "verdict"]);
            expect(part(items, 1)).toMatchObject({
                kind: "verdict",
                reviewer: {
                    description: "Review the plan",
                    subagentType: "superpowers:code-reviewer",
                    toolUseId: "toolu_plan",
                    index: 1,
                },
            });
        });

        it("pairs a block that names no subagent with the nearest reviewer call before it", () => {
            const items = chatItems([
                you("go"),
                spawn("Explore the repo", "Explore", "toolu_explore"),
                spawn("Check the diff", "superpowers:code-reviewer", "toolu_old"),
                says("Round one."),
                spawn("Re-check the diff", "superpowers:code-reviewer", "toolu_new"),
                says(block()),
            ]);
            const verdict = agentOf(items, 1).parts.find((p) => p.kind === "verdict");
            expect(verdict).toMatchObject({ reviewer: { toolUseId: "toolu_new", index: 4 } });
        });

        it("pairs nothing when the item holds no reviewer call, and never reaches into an earlier group", () => {
            const lone = chatItems([you("go"), says(block())]);
            expect(part(lone, 0)).not.toHaveProperty("reviewer");
            const earlier = chatItems([
                you("one"),
                spawn("Review it", "superpowers:code-reviewer", "toolu_1"),
                you("two"),
                says(block()),
            ]);
            expect(part(earlier, 0, 3)).not.toHaveProperty("reviewer");
        });
    });

    describe("a ReportFindings call", () => {
        it("cuts the call out of the middle of a work stretch: work, verdict, work", () => {
            const items = chatItems([
                you("review"),
                action("read"),
                action("grep"),
                reported("first", "second"),
                action("bash"),
                edit(file("a.ts", 1, 0)),
            ]);
            expect(kinds(items)).toEqual(["work", "verdict", "work", "files"]);
            const before = part(items, 0);
            const after = part(items, 2);
            expect(before.kind === "work" && before.work.actions.map((a) => a.verb)).toEqual(["read", "grep"]);
            expect(before.kind === "work" && before.work.startIndex).toBe(1);
            expect(after.kind === "work" && after.work.actions.map((a) => a.verb)).toEqual(["bash", "edited"]);
            expect(after.kind === "work" && after.work.startIndex).toBe(4);
            const verdict = part(items, 1);
            expect(verdict).toMatchObject({
                kind: "verdict",
                key: "verdict:3",
                verdict: { kind: "code", reviewer: "code-review", pass: false, note: "2 findings, 1 confirmed" },
            });
            expect(verdict.kind === "verdict" && verdict.verdict.findings.map((f) => f.severity)).toEqual([
                "Important",
                "Minor",
            ]);
        });

        it("leaves no empty work part around a call that is the whole stretch", () => {
            expect(kinds(chatItems([you("review"), reported("only")]))).toEqual(["verdict"]);
        });

        it("reads a clean review as a pass, and never pairs it with a reviewer subagent", () => {
            const items = chatItems([
                you("go"),
                spawn("Review the diff", "superpowers:code-reviewer", "t1"),
                reported(),
            ]);
            expect(kinds(items)).toEqual(["work", "verdict"]);
            const verdict = part(items, 1);
            expect(verdict).toMatchObject({ verdict: { pass: true, note: "No findings" } });
            expect(verdict).not.toHaveProperty("reviewer");
        });

        it("keeps the files each piece of a cut stretch edited after that piece", () => {
            const items = chatItems([you("go"), edit(file("a.ts", 2, 1)), reported("x"), edit(file("b.ts", 4, 0))]);
            expect(kinds(items)).toEqual(["work", "files", "verdict", "work", "files"]);
            expect(part(items, 1)).toMatchObject({ kind: "files", adds: 2, dels: 1 });
            expect(part(items, 4)).toMatchObject({ kind: "files", adds: 4, dels: 0 });
        });
    });

    describe("a Handoff ask", () => {
        it("cuts an unanswered Handoff ask out of its stretch as a handoff part holding the question", () => {
            const items = chatItems([you("plan it"), action("read"), ask("Handoff")]);
            expect(kinds(items)).toEqual(["work", "handoff"]);
            expect(part(items, 1)).toMatchObject({
                kind: "handoff",
                key: "handoff:2",
                question: { header: "Handoff", picked: [] },
            });
        });

        it("keeps the answer on the part once it landed", () => {
            const items = chatItems([you("plan it"), ask("Handoff", ["Arc engine (Recommended)"])]);
            expect(kinds(items)).toEqual(["handoff"]);
            expect(part(items, 0)).toMatchObject({ question: { picked: ["Arc engine (Recommended)"] } });
        });

        it("splits the stretch around it: work, handoff, work", () => {
            const items = chatItems([you("x"), action("read"), ask("Handoff"), action("bash")]);
            expect(kinds(items)).toEqual(["work", "handoff", "work"]);
        });

        it("leaves a plain AskUserQuestion in the work", () => {
            const items = chatItems([you("x"), action("read"), ask("Scope"), action("bash")]);
            expect(kinds(items)).toEqual(["work"]);
            const work = part(items, 0);
            expect(work.kind === "work" && work.work.actions).toHaveLength(3);
        });

        it("leaves an ask of several questions in the work even when one is headed Handoff", () => {
            const two = action("asked", {
                detail: {
                    kind: "ask",
                    questions: [
                        { question: "A?", header: "Handoff", options: [], picked: [] },
                        { question: "B?", header: "Scope", options: [], picked: [] },
                    ],
                },
            });
            expect(kinds(chatItems([you("x"), two]))).toEqual(["work"]);
        });
    });

    describe("a wsh runs start call", () => {
        it("splits the stretch after the call, which stays a tool line in the work before it", () => {
            const items = chatItems([
                you("run it"),
                action("read"),
                runsStart("started run 3fa21b0c (orchestrator, running) in main\n"),
            ]);
            expect(kinds(items)).toEqual(["work", "runstart"]);
            const work = part(items, 0);
            expect(work.kind === "work" && work.work.actions.map((a) => a.verb)).toEqual(["read", "bash"]);
            expect(part(items, 1)).toEqual({
                kind: "runstart",
                key: "runstart:2",
                anchor: { kind: "started", runId: "3fa21b0c" },
            });
        });

        it("goes on with a work part when the stretch goes on", () => {
            const items = chatItems([
                you("run it"),
                runsStart("queued q-17 (#1 in line)\n"),
                action("read"),
                action("grep"),
            ]);
            expect(kinds(items)).toEqual(["work", "runstart", "work"]);
            expect(part(items, 1)).toMatchObject({ key: "runstart:1", anchor: { kind: "queued", entryId: "q-17" } });
            const after = part(items, 2);
            expect(after.kind === "work" && after.work.startIndex).toBe(2);
        });

        it("makes no part for a call whose output names no run, or a command that is not wsh runs start", () => {
            expect(kinds(chatItems([you("x"), runsStart("error: no plan file\n")]))).toEqual(["work"]);
            expect(kinds(chatItems([you("x"), runsStart("started run 3fa21b0c (x)\n", "wsh runs list")]))).toEqual([
                "work",
            ]);
            // a Bash call still running has no output yet, hence no part
            expect(kinds(chatItems([you("x"), action("bash")]))).toEqual(["work"]);
        });

        it("keeps the files the stretch edited before the call after its work part", () => {
            const items = chatItems([you("x"), edit(file("a.ts", 1, 0)), runsStart("started run 3fa21b0c (x)\n")]);
            expect(kinds(items)).toEqual(["work", "files", "runstart"]);
        });
    });

    describe("a wsh council start call", () => {
        const STARTED =
            "council 9f3a1c04d27b58e6 started: Scheduled tasks · review · UI feature panel · 4 experts · ≈ 14 calls · ~0.9M tokens\n";
        const QUEUED =
            "Queued after 0a1b2c3d4e5f6071 (Paper) · council 9f3a1c04d27b58e6 starts by itself when it ends\n";
        const NOT_RUN =
            "Not run: the person chose not to start a council now.\ncouncil 9f3a1c04d27b58e6 saved as not run; Start council in the app runs it\n";

        it("splits the stretch after the call, which stays a tool line in the work before it", () => {
            const items = chatItems([you("ask a council"), action("read"), councilStart(STARTED)]);
            expect(kinds(items)).toEqual(["work", "councilstart"]);
            const work = part(items, 0);
            expect(work.kind === "work" && work.work.actions.map((a) => a.verb)).toEqual(["read", "bash"]);
            expect(part(items, 1)).toEqual({
                kind: "councilstart",
                key: "councilstart:2",
                anchor: { kind: "started", councilId: "9f3a1c04d27b58e6", estimate: "≈ 14 calls · ~0.9M tokens" },
            });
        });

        it("reads a queued start and a refusal into their anchors", () => {
            expect(part(chatItems([you("x"), councilStart(QUEUED)]), 1)).toMatchObject({
                kind: "councilstart",
                anchor: { kind: "queued", councilId: "9f3a1c04d27b58e6" },
            });
            expect(part(chatItems([you("x"), councilStart(NOT_RUN)]), 1)).toMatchObject({
                kind: "councilstart",
                anchor: {
                    kind: "notrun",
                    councilId: "9f3a1c04d27b58e6",
                    reason: "Not run: the person chose not to start a council now.",
                },
            });
        });

        it("goes on with a work part when the stretch goes on", () => {
            const items = chatItems([you("x"), councilStart(STARTED), action("read"), action("grep")]);
            expect(kinds(items)).toEqual(["work", "councilstart", "work"]);
            expect(part(items, 1)).toMatchObject({ key: "councilstart:1" });
            const after = part(items, 2);
            expect(after.kind === "work" && after.work.startIndex).toBe(2);
        });

        it("makes no part for a call whose output names no council, or a command that is not wsh council start", () => {
            expect(kinds(chatItems([you("x"), councilStart("error: --feature is required\n")]))).toEqual(["work"]);
            expect(kinds(chatItems([you("x"), councilStart(STARTED, "wsh council wait 9f3a1c04d27b58e6")]))).toEqual([
                "work",
            ]);
            // a Bash call still running has no output yet, hence no part
            expect(kinds(chatItems([you("x"), action("bash")]))).toEqual(["work"]);
        });

        it("keeps the files the stretch edited before the call after its work part", () => {
            const items = chatItems([you("x"), edit(file("a.ts", 1, 0)), councilStart(STARTED)]);
            expect(kinds(items)).toEqual(["work", "files", "councilstart"]);
        });

        it("leaves a wsh runs start call to the run card", () => {
            const items = chatItems([you("x"), runsStart("started run 3fa21b0c (x)\n")]);
            expect(kinds(items)).toEqual(["work", "runstart"]);
        });
    });

    describe("a Doc review ask", () => {
        it("cuts a Doc review ask out of its stretch as a docreview part holding the question, with no tool line", () => {
            const items = chatItems([you("review it"), action("read"), docReview()]);
            expect(kinds(items)).toEqual(["work", "docreview"]);
            expect(part(items, 1)).toMatchObject({
                kind: "docreview",
                key: "docreview:2",
                question: { header: "Doc review", picked: [] },
            });
            const work = part(items, 0);
            expect(work.kind === "work" && work.work.actions.map((a) => a.verb)).toEqual(["read"]);
        });

        it("leaves no empty work part when the ask is the whole stretch", () => {
            expect(kinds(chatItems([you("x"), docReview()]))).toEqual(["docreview"]);
        });

        it("keeps the answer on the part once it landed", () => {
            const items = chatItems([you("x"), docReview(["Request changes"], "1. [intro] shorter")]);
            expect(kinds(items)).toEqual(["docreview"]);
            expect(part(items, 0)).toMatchObject({
                question: { picked: ["Request changes"], typed: "1. [intro] shorter" },
            });
        });

        it("splits the stretch around it: work, docreview, work", () => {
            const items = chatItems([you("x"), action("read"), docReview(), action("bash")]);
            expect(kinds(items)).toEqual(["work", "docreview", "work"]);
        });

        it("reads a markdown note as well as a LaTeX source", () => {
            expect(kinds(chatItems([you("x"), docReview([], undefined, "docs/notes/ideas.md")]))).toEqual([
                "docreview",
            ]);
        });

        it("leaves a Spec review, a Plan review, a bad path and a plain ask in the work", () => {
            for (const items of [
                chatItems([you("x"), action("read"), docReview([], undefined, "docs/specs/x.md", "Spec review")]),
                chatItems([you("x"), action("read"), docReview([], undefined, "docs/plans/p.md", "Plan review")]),
                chatItems([you("x"), action("read"), docReview([], undefined, "notes/intro.txt")]),
                chatItems([you("x"), action("read"), ask("Scope")]),
            ]) {
                expect(kinds(items)).toEqual(["work"]);
                const work = part(items, 0);
                expect(work.kind === "work" && work.work.actions).toHaveLength(2);
            }
        });

        it("leaves an ask of several questions in the work even when one is a Doc review", () => {
            const two = action("asked", {
                detail: {
                    kind: "ask",
                    questions: [
                        { question: "paper/intro.tex", header: "Doc review", options: [], picked: [] },
                        { question: "B?", header: "Scope", options: [], picked: [] },
                    ],
                },
            });
            expect(kinds(chatItems([you("x"), two]))).toEqual(["work"]);
        });
    });

    describe("keys as the transcript grows", () => {
        it("keeps the key of each part when entries append after it", () => {
            const entries: AgentEntry[] = [
                you("go"),
                says(`Looking.\n\n${block()}`),
                action("read"),
                ask("Handoff"),
                runsStart("started run 3fa21b0c (x)\n"),
            ];
            const keysOf = (es: AgentEntry[]): string[] =>
                agentOf(chatItems(es), 1)
                    .parts.filter((p) => p.kind === "verdict" || p.kind === "handoff" || p.kind === "runstart")
                    .map((p) => (p as { key: string }).key);
            const before = keysOf(entries);
            expect(before).toEqual(["verdict:1", "handoff:3", "runstart:4"]);
            const after = keysOf([...entries, says("More."), action("grep"), reported("late")]);
            expect(after.slice(0, 3)).toEqual(before);
            expect(after).toEqual([...before, "verdict:7"]);
        });

        it("keeps the key of a council start and a Doc review as entries append after them", () => {
            const entries: AgentEntry[] = [
                you("go"),
                action("read"),
                councilStart("council 9f3a1c04d27b58e6 started: x · review · g · 4 experts · ≈ 1 calls · ~1k tokens\n"),
                docReview(),
            ];
            const keysOf = (es: AgentEntry[]): string[] =>
                agentOf(chatItems(es), 1)
                    .parts.filter((p) => p.kind === "councilstart" || p.kind === "docreview")
                    .map((p) => (p as { key: string }).key);
            const before = keysOf(entries);
            expect(before).toEqual(["councilstart:2", "docreview:3"]);
            expect(keysOf([...entries, says("More."), action("grep")])).toEqual(before);
        });
    });

    // when the agent has gone on (its verdict card folds) and when it has not (the card still waits on you)
    describe("agentWentOn", () => {
        const went = (entries: AgentEntry[], p: number): boolean =>
            agentWentOn(entries, agentOf(chatItems(entries), 1).parts, p);

        it("is not the closing words of the reply that holds the block", () => {
            const entries = [you("review"), says(`Here.\n\n${block()}\n\nTell me which of these to fix.`)];
            expect(kinds(chatItems(entries))).toEqual(["prose", "verdict", "prose"]);
            expect(went(entries, 1)).toBe(false);
        });

        it("is a later reply, or a later call, after a block", () => {
            expect(went([you("review"), says(block()), says("I went ahead.")], 0)).toBe(true);
            expect(went([you("review"), says(block()), action("edited")], 0)).toBe(true);
        });

        it("is anything the agent did after a ReportFindings call, closing words or not", () => {
            expect(went([you("review"), reported("one"), says("Taking the first.")], 0)).toBe(true);
            expect(went([you("review"), reported("one")], 0)).toBe(false);
        });

        it("is a reply still being written, which the transcript does not hold yet", () => {
            const entries = [you("review"), says(block())];
            const parts: AgentPart[] = [
                ...agentOf(chatItems(entries), 1).parts,
                { kind: "prose", text: "So", live: true },
            ];
            expect(agentWentOn(entries, parts, 0)).toBe(true);
        });

        it("is not a task notification or an interruption, which the agent did not write", () => {
            expect(went([you("review"), says(block()), { kind: "notification", summary: "done" }], 0)).toBe(false);
        });

        it("is false for a part that is no verdict", () => {
            const entries = [you("review"), says(`Here.\n\n${block()}`), says("More.")];
            expect(agentWentOn(entries, agentOf(chatItems(entries), 1).parts, 0)).toBe(false);
        });
    });
});

describe("shownItems", () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ kind: "marker", key: `m${i}` }) as unknown as ChatItem);

    it("steps in 120 items", () => {
        expect(CHAT_RENDER_STEP).toBe(120);
    });

    it("keeps the last N items, the newest at the end", () => {
        const shown = shownItems(items, CHAT_RENDER_STEP);
        expect(shown).toHaveLength(120);
        expect(shown[0].key).toBe("m180");
        expect(shown[119].key).toBe("m299");
    });

    it("returns everything when N covers it all", () => {
        expect(shownItems(items.slice(0, 5), 120)).toHaveLength(5);
        expect(shownItems(items, 300)).toHaveLength(300);
        expect(shownItems(items, 1000)).toHaveLength(300);
    });

    it("returns nothing for zero rather than everything", () => {
        expect(shownItems(items, 0)).toEqual([]);
        expect(shownItems(items, -3)).toEqual([]);
    });
});
