// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentActionEntry, AgentEntry, EditFile } from "./agentsviewmodel";
import {
    bashMode,
    canSendNow,
    CHAT_RENDER_STEP,
    chatItems,
    SEND_NOW_KEYS,
    shownItems,
    turnStatsLabel,
    workingLine,
    workingText,
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
    it("turns an empty transcript into no items", () => {
        expect(chatItems([])).toEqual([]);
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

    it("is null when the agent is not working, whatever the entries", () => {
        expect(workingText("idle", "x", [action("ran", { target: "go build" })])).toBeNull();
    });

    it("falls back to the activity line when the running tool has no target", () => {
        expect(workingText("working", "Bash: npm test", [action("ran", { target: "" })])).toBe(
            "Working · Bash: npm test"
        );
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
