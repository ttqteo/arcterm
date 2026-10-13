// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { describe, expect, it, vi } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { loadSleeperTitle, sleepersToTitle, titleKey, transcriptTitlesAtom } from "./sleepertitles";

const getTranscript = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetAgentTranscriptCommand: (...a: any[]) => getTranscript(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

const asleep = { since: 1, freedBytes: 0 };
const mk = (over: Partial<AgentVM>): AgentVM =>
    ({ id: "t1", name: "arcterm", task: "", state: "idle", agent: "claude", ...over }) as AgentVM;

describe("sleepersToTitle", () => {
    it("lists each sleeping agent with a transcript whose title was not asked for yet", () => {
        const agents = [
            mk({ id: "a", sleeping: asleep, transcriptPath: "/t/A.jsonl" }),
            mk({ id: "b", transcriptPath: "/t/b.jsonl" }), // awake: its status reports its title
            mk({ id: "c", sleeping: asleep }), // no transcript to read
            mk({ id: "d", sleeping: asleep, transcriptPath: "/t/d.jsonl" }),
        ];
        expect(sleepersToTitle(agents, new Set([titleKey("/t/d.jsonl")]))).toEqual([
            { path: "/t/A.jsonl", agent: "claude" },
        ]);
    });
    it("lists a transcript two sleeping tabs share once", () => {
        const agents = [
            mk({ id: "a", sleeping: asleep, transcriptPath: "/t/a.jsonl" }),
            mk({ id: "b", sleeping: asleep, transcriptPath: "\\t\\A.jsonl" }),
        ];
        expect(sleepersToTitle(agents, new Set())).toHaveLength(1);
    });
});

describe("loadSleeperTitle", () => {
    it("keeps the last ai-title in the transcript's tail under its path", async () => {
        getTranscript.mockResolvedValueOnce({
            lines: [
                JSON.stringify({ type: "ai-title", aiTitle: "Old" }),
                JSON.stringify({ type: "user", message: { content: "hi" } }),
                JSON.stringify({ type: "ai-title", aiTitle: "Jarvis modes Phase 1–2" }),
            ],
        });
        await loadSleeperTitle("/Users/me/.claude/projects/p/s.jsonl", "claude");
        expect(getTranscript.mock.calls[0][1]).toMatchObject({ path: "/Users/me/.claude/projects/p/s.jsonl" });
        expect(globalStore.get(transcriptTitlesAtom)[titleKey("/Users/me/.claude/projects/p/s.jsonl")]).toBe(
            "Jarvis modes Phase 1–2"
        );
    });
    it("keeps nothing for a tail with no title", async () => {
        getTranscript.mockResolvedValueOnce({ lines: [JSON.stringify({ type: "user" })] });
        await loadSleeperTitle("/t/untitled.jsonl", "claude");
        expect(globalStore.get(transcriptTitlesAtom)[titleKey("/t/untitled.jsonl")]).toBeUndefined();
    });
});
