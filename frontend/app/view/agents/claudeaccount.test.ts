// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { restartCandidates, rowQuota } from "./claudeaccount";

describe("restartCandidates", () => {
    it("lists resumable claude agents not on the new account; idle pre-checked, working and asking not", () => {
        const base = { agent: "claude", task: "", usage: {} };
        const agents = [
            { ...base, id: "t1", name: "loom", state: "idle", blockId: "b1", transcriptPath: "/p/s1.jsonl" },
            { ...base, id: "t2", name: "kite", state: "working", blockId: "b2", transcriptPath: "/p/s2.jsonl" },
            { ...base, id: "t6", name: "fern", state: "asking", blockId: "b6", transcriptPath: "/p/s6.jsonl" },
            {
                ...base,
                id: "t3",
                name: "on-a1",
                state: "idle",
                blockId: "b3",
                transcriptPath: "/p/s3.jsonl",
                usage: { account: "a1" },
            },
            {
                ...base,
                id: "t4",
                name: "codex",
                agent: "codex",
                state: "idle",
                blockId: "b4",
                transcriptPath: "/p/s4.jsonl",
            },
            { ...base, id: "t5", name: "no-transcript", state: "idle", blockId: "b5" },
            { ...base, id: "t7", name: "no-block", state: "idle", transcriptPath: "/p/s7.jsonl" },
            {
                ...base,
                id: "t8",
                name: "bg",
                kind: "background",
                state: "idle",
                blockId: "b8",
                transcriptPath: "/p/s8.jsonl",
            },
            {
                ...base,
                id: "t9",
                name: "shell",
                kind: "terminal",
                state: "idle",
                blockId: "b9",
                transcriptPath: "/p/s9.jsonl",
            },
        ] as AgentVM[];
        expect(restartCandidates(agents, "a1")).toEqual([
            { tabId: "t1", blockId: "b1", name: "loom", sessionId: "s1", checked: true, state: "idle" },
            { tabId: "t2", blockId: "b2", name: "kite", sessionId: "s2", checked: false, state: "working" },
            { tabId: "t6", blockId: "b6", name: "fern", sessionId: "s6", checked: false, state: "asking" },
        ]);
    });

    it("treats a missing usage.account as Default", () => {
        const a = {
            id: "t1",
            name: "loom",
            task: "",
            agent: "claude",
            state: "idle",
            blockId: "b1",
            transcriptPath: "/p/s1.jsonl",
        } as AgentVM;
        expect(restartCandidates([a], "")).toEqual([]);
        expect(restartCandidates([a], "a1")).toHaveLength(1);
    });
});

describe("rowQuota", () => {
    const now = 10 * 60 * 60 * 1000;

    it("null when the account was never used", () => {
        expect(rowQuota({}, "a1", now)).toBeNull();
    });

    it("reads a current snapshot", () => {
        const saved = { "claude:a1": { capturedAt: now - 60_000, fivehourpct: 97, weekpct: 40 } };
        expect(rowQuota(saved, "a1", now)).toEqual({ fivehourpct: 97, weekpct: 40, capturedAt: now - 60_000 });
    });

    it("a window past its reset reads 0", () => {
        const saved = {
            "claude:default": {
                capturedAt: now - 60_000,
                fivehourpct: 97,
                fivehourreset: (now - 1000) / 1000,
                weekpct: 40,
            },
        };
        expect(rowQuota(saved, "", now)).toEqual({ fivehourpct: 0, weekpct: 40, capturedAt: now - 60_000 });
    });
});
