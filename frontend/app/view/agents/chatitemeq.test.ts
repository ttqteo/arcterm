// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import { sameChatItem } from "./chatitemeq";
import { chatItems, type ChatItem } from "./chatmodel";

// the items of a transcript, rebuilt from scratch as the conversation does on every append
const items = (entries: AgentEntry[]): ChatItem[] => chatItems(JSON.parse(JSON.stringify(entries)));

const read = (extra: Record<string, unknown> = {}): AgentEntry =>
    ({
        kind: "action",
        verb: "read",
        target: "a.ts",
        path: "/r/a.ts",
        ...extra,
    }) as AgentEntry;

const base: AgentEntry[] = [
    { kind: "user", text: "do it" },
    { kind: "message", text: "I will read it." },
    read({ outcome: "ok", durationMs: 1000, detail: { kind: "read", snippet: "one\ntwo" } }),
    { kind: "message", text: "Done." },
];

describe("sameChatItem", () => {
    it("sees an item rebuilt from the same entries as the same: nothing keeps its identity across an append", () => {
        const a = items(base);
        const b = items(base);
        expect(a).toHaveLength(2);
        a.forEach((item, i) => {
            expect(item).not.toBe(b[i]);
            expect(sameChatItem(item, b[i])).toBe(true);
        });
    });

    it("keeps the items before a new entry the same, and changes only the one it joins", () => {
        const before = items(base);
        const after = items([...base, { kind: "message", text: "One more thing." }]);
        expect(sameChatItem(before[0], after[0])).toBe(true);
        expect(sameChatItem(before[1], after[1])).toBe(false); // the agent group gained a part
    });

    it("tells a tool whose result landed from the same call without one", () => {
        const pending = items([read()]);
        const done = items([read({ outcome: "ok", durationMs: 800, detail: { kind: "read", snippet: "x" } })]);
        expect(sameChatItem(pending[0], done[0])).toBe(false);
        const failed = items([read({ outcome: "fail", durationMs: 800 })]);
        const ok = items([read({ outcome: "ok", durationMs: 800 })]);
        expect(sameChatItem(failed[0], ok[0])).toBe(false);
    });

    it("tells a detail that grew, by size, without reading it", () => {
        const short = items([read({ outcome: "ok", detail: { kind: "read", snippet: "a" } })]);
        const long = items([read({ outcome: "ok", detail: { kind: "read", snippet: "a\nb\nc" } })]);
        expect(sameChatItem(short[0], long[0])).toBe(false);
        const edit = (n: number): AgentEntry =>
            ({
                kind: "action",
                verb: "edited",
                target: "a.ts",
                outcome: "ok",
                detail: {
                    kind: "edit",
                    files: [{ path: "/r/a.ts", badge: "M", adds: n, dels: 0, lines: [{ sign: "+", text: "x" }] }],
                },
            }) as AgentEntry;
        expect(sameChatItem(items([edit(1)])[0], items([edit(2)])[0])).toBe(false);
        expect(sameChatItem(items([edit(1)])[0], items([edit(1)])[0])).toBe(true);
    });

    it("tells an answer that landed on a question the agent asked", () => {
        const ask = (picked: string[]): AgentEntry =>
            ({
                kind: "action",
                verb: "asked",
                target: "Which?",
                outcome: "ok",
                detail: { kind: "ask", questions: [{ question: "Which?", options: [{ label: "A" }], picked }] },
            }) as AgentEntry;
        expect(sameChatItem(items([ask([])])[0], items([ask(["A"])])[0])).toBe(false);
        expect(sameChatItem(items([ask(["A"])])[0], items([ask(["A"])])[0])).toBe(true);
    });

    describe("the verdict, handoff and run-start parts", () => {
        const review = (summary: string): string =>
            `\`\`\`arc-review\n${JSON.stringify({ kind: "code", pass: false, findings: [{ severity: "Minor", file: "a.ts", summary }] })}\n\`\`\``;
        const spawn = (toolUseId: string): AgentEntry =>
            ({
                kind: "action",
                verb: "agent",
                target: "Review it",
                subagent: { description: "Review it", subagentType: "code-reviewer", toolUseId },
            }) as AgentEntry;
        const ask = (picked: string[]): AgentEntry =>
            ({
                kind: "action",
                verb: "asked",
                target: "Handoff",
                detail: {
                    kind: "ask",
                    questions: [
                        { question: "Run `p.md`?", header: "Handoff", options: [{ label: "Arc engine" }], picked },
                    ],
                },
            }) as AgentEntry;
        const start = (output: string): AgentEntry =>
            ({
                kind: "action",
                verb: "bash",
                target: "wsh runs start",
                outcome: "ok",
                detail: { kind: "bash", command: "wsh runs start --plan p.md", output, exit: 0 },
            }) as AgentEntry;
        const at = (entries: AgentEntry[]): ChatItem => items([{ kind: "user", text: "go" }, ...entries])[1];

        it("sees the same verdict, rebuilt, as the same, and a verdict with other findings as another", () => {
            const say = (text: string): AgentEntry => ({ kind: "message", text });
            expect(sameChatItem(at([say(review("one"))]), at([say(review("one"))]))).toBe(true);
            expect(sameChatItem(at([say(review("one"))]), at([say(review("two"))]))).toBe(false);
        });

        it("tells a verdict that found its reviewer call from the same one that did not", () => {
            const say = (text: string): AgentEntry => ({ kind: "message", text });
            const withCall = at([spawn("t1"), say(review("one"))]);
            expect(sameChatItem(withCall, at([spawn("t1"), say(review("one"))]))).toBe(true);
            expect(sameChatItem(withCall, at([spawn("t2"), say(review("one"))]))).toBe(false);
            expect(sameChatItem(withCall, at([say(review("one"))]))).toBe(false);
        });

        it("tells a handoff once it was answered", () => {
            expect(sameChatItem(at([ask([])]), at([ask([])]))).toBe(true);
            expect(sameChatItem(at([ask([])]), at([ask(["Arc engine"])]))).toBe(false);
        });

        it("tells a run-start part by the run it names", () => {
            expect(
                sameChatItem(at([start("started run aaaaaaaa (x)\n")]), at([start("started run aaaaaaaa (x)\n")]))
            ).toBe(true);
            expect(
                sameChatItem(at([start("started run aaaaaaaa (x)\n")]), at([start("started run bbbbbbbb (x)\n")]))
            ).toBe(false);
            expect(sameChatItem(at([start("started run aaaaaaaa (x)\n")]), at([start("queued aaaaaaaa\n")]))).toBe(
                false
            );
        });
    });

    it("tells your message and the output of a command you ran", () => {
        const you = (text: string): AgentEntry => ({ kind: "user", text });
        expect(sameChatItem(items([you("a")])[0], items([you("a")])[0])).toBe(true);
        expect(sameChatItem(items([you("a")])[0], items([you("b")])[0])).toBe(false);
        const bash = (output: string): AgentEntry => ({
            kind: "command",
            name: "!",
            args: "ls",
            shell: { output, error: "" },
        });
        expect(sameChatItem(items([bash("x")])[0], items([bash("x")])[0])).toBe(true);
        expect(sameChatItem(items([bash("x")])[0], items([bash("y")])[0])).toBe(false);
        // a command that printed nothing yet and the one whose output landed
        const bare: AgentEntry = { kind: "command", name: "!", args: "ls" };
        expect(sameChatItem(items([bare])[0], items([bash("x")])[0])).toBe(false);
    });

    it("tells the same text under another record uuid apart: Fork from here cuts at the uuid", () => {
        const you = (uuid: string): AgentEntry => ({ kind: "user", text: "a", uuid });
        expect(sameChatItem(items([you("u1")])[0], items([you("u1")])[0])).toBe(true);
        expect(sameChatItem(items([you("u1")])[0], items([you("u2")])[0])).toBe(false);
        const says = (uuid: string): AgentEntry => ({ kind: "message", text: "a", uuid });
        expect(sameChatItem(items([says("a1")])[0], items([says("a1")])[0])).toBe(true);
        expect(sameChatItem(items([says("a1")])[0], items([says("a2")])[0])).toBe(false);
    });

    it("tells different kinds and keys apart", () => {
        const a = items([{ kind: "user", text: "x" }]);
        const b = items([{ kind: "message", text: "x" }]);
        expect(sameChatItem(a[0], b[0])).toBe(false);
        const c = items([
            { kind: "message", text: "a" },
            { kind: "user", text: "u" },
        ]);
        const d = items([{ kind: "user", text: "u" }]);
        expect(sameChatItem(c[1], d[0])).toBe(false); // same text and kind, another place in the transcript
    });

    it("tells a marker whose summary changed", () => {
        const compaction = (summary: string): AgentEntry => ({ kind: "compaction", summary });
        expect(sameChatItem(items([compaction("a")])[0], items([compaction("a")])[0])).toBe(true);
        expect(sameChatItem(items([compaction("a")])[0], items([compaction("b")])[0])).toBe(false);
    });
});
