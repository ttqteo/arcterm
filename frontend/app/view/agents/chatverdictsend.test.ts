// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { brainstormAnswers, brainstormSentAtom, SENT_STORAGE_KEY } from "./chatbrainstormstore";
import { fixLine, skipLine, VERDICT_TOPIC, type Verdict } from "./chatverdict";
import { sendVerdict } from "./chatverdictsend";

// the loaded transcript comes from the Chat window's cache (railtranscript.tsx); a test passes its own entries through
// the io, so the pane's module graph is not loaded for it
vi.mock("./railtranscript", () => ({ cachedTranscriptEntries: () => null }));

const AGENT = { id: "a1", name: "lag-alerts", blockId: "blk-1", project: "siem" } as AgentVM;

const VERDICT: Verdict = {
    kind: "code",
    reviewer: "code-reviewer",
    pass: false,
    note: "Two things to fix.",
    findings: [
        { severity: "Important", file: "pkg/a.go", line: 12, summary: "Nil map write." },
        { severity: "Minor", file: "frontend/c.ts", summary: "A stale comment." },
    ],
};

// a prompt / wake pair that keeps what it was given, or fails with a reason
function fakeIO(fail = false, entries: AgentEntry[] | null = null) {
    const sent: [string, string][] = [];
    const woken: [string, string][] = [];
    return {
        sent,
        woken,
        wake: async (tabId: string, text: string) => {
            if (fail) {
                throw new Error("the session file is gone");
            }
            woken.push([tabId, text]);
        },
        prompt: async (blockId: string, text: string) => {
            if (fail) {
                throw new Error("boom");
            }
            sent.push([blockId, text]);
        },
        stopJudge: async () => {},
        sleepAfterRun: async () => {},
        entries: () => entries,
    };
}

// a localStorage that holds what is written, as the webview's does
function mockLocalStorage(): Record<string, string> {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
            store[k] = v;
        },
        removeItem: (k: string) => {
            delete store[k];
        },
    };
    return store;
}

afterEach(() => {
    globalStore.set(brainstormSentAtom, {});
    delete (globalThis as any).localStorage;
});

describe("sendVerdict", () => {
    const user = (text: string): AgentEntry => ({ kind: "user", text });

    it("sends the fix line to the agent's block as a prompt and keeps its record", async () => {
        const store = mockLocalStorage();
        const io = fakeIO();
        const line = fixLine(VERDICT, [0]);
        await sendVerdict(AGENT, "verdict:7", { kind: "fix", fixed: 1 }, line, io, 1000);
        expect(io.sent).toEqual([["blk-1", line]]);
        expect(brainstormAnswers(AGENT.id)).toEqual([
            {
                topic: VERDICT_TOPIC,
                n: 0,
                part: "",
                text: line,
                sentAt: 1000,
                seen: 0,
                kind: "verdict",
                verdictKey: "verdict:7",
                verdictOutcome: "fix",
                fixed: 1,
            },
        ]);
        // and it is kept for a reload
        expect(JSON.parse(store[SENT_STORAGE_KEY])).toEqual({ [AGENT.id]: brainstormAnswers(AGENT.id) });
    });

    it("sends the skip line and records a skip that fixed none", async () => {
        const io = fakeIO();
        await sendVerdict(AGENT, "verdict:7", { kind: "skip" }, skipLine(), io, 1000);
        expect(io.sent).toEqual([["blk-1", skipLine()]]);
        expect(brainstormAnswers(AGENT.id)).toMatchObject([
            { verdictKey: "verdict:7", verdictOutcome: "skip", fixed: 0 },
        ]);
    });

    it("counts the messages that already held the line, so a repeat pairs with the new one", async () => {
        const line = skipLine();
        const io = fakeIO(false, [user("hello"), user(line), user("later")]);
        await sendVerdict(AGENT, "verdict:9", { kind: "skip" }, line, io, 1000);
        expect(brainstormAnswers(AGENT.id)[0].seen).toBe(1);
    });

    it("counts none already there when no transcript is loaded", async () => {
        await sendVerdict(AGENT, "verdict:9", { kind: "skip" }, skipLine(), fakeIO(false, null), 1000);
        expect(brainstormAnswers(AGENT.id)[0].seen).toBe(0);
    });

    it("wakes a sleeping agent with the line instead of typing into its stopped terminal", async () => {
        const io = fakeIO();
        const asleep = { ...AGENT, sleeping: { since: 1, freedBytes: 0 } };
        await sendVerdict(asleep, "verdict:7", { kind: "skip" }, skipLine(), io, 1000);
        expect(io.sent).toEqual([]);
        expect(io.woken).toEqual([["a1", skipLine()]]);
        expect(brainstormAnswers(AGENT.id)).toHaveLength(1);
    });

    it("a prompt that fails throws with the agent's name and records nothing", async () => {
        await expect(sendVerdict(AGENT, "verdict:7", { kind: "skip" }, skipLine(), fakeIO(true), 1000)).rejects.toThrow(
            "Couldn't send to lag-alerts: boom"
        );
        expect(brainstormAnswers(AGENT.id)).toEqual([]);
    });

    it("a wake that fails throws with the agent's name and records nothing", async () => {
        const asleep = { ...AGENT, sleeping: { since: 1, freedBytes: 0 } };
        await expect(
            sendVerdict(asleep, "verdict:7", { kind: "skip" }, skipLine(), fakeIO(true), 1000)
        ).rejects.toThrow("Couldn't wake lag-alerts: the session file is gone");
        expect(brainstormAnswers(AGENT.id)).toEqual([]);
    });

    it("an agent with no terminal throws and records nothing", async () => {
        const io = fakeIO();
        const noBlock = { ...AGENT, blockId: undefined } as unknown as AgentVM;
        await expect(sendVerdict(noBlock, "verdict:7", { kind: "skip" }, skipLine(), io, 1000)).rejects.toThrow(
            "This agent has no terminal to send to"
        );
        expect(io.sent).toEqual([]);
        expect(brainstormAnswers(AGENT.id)).toEqual([]);
    });
});
