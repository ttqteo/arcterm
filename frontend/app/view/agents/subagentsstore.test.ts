// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { describe, expect, it, vi } from "vitest";
import { backgroundTasksByIdAtom, PARENT_TAIL_LINES, refreshSubagents } from "./subagentsstore";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GetSubagentsCommand: vi.fn(async () => ({ subagents: [] })),
        GetAgentTranscriptCommand: vi.fn(async () => ({ lines: [] })),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

describe("refreshSubagents", () => {
    it("reads 2000 parent lines, so a chatty Monitor's spawn stays in the tail while it runs", async () => {
        await refreshSubagents("parent", "/t/parent.jsonl");
        expect(PARENT_TAIL_LINES).toBe(2000);
        expect(RpcApi.GetAgentTranscriptCommand).toHaveBeenCalledWith(
            {},
            { path: "/t/parent.jsonl", maxlines: PARENT_TAIL_LINES, tasksdir: true }
        );
    });

    it("gives a running Monitor the output file in the tasks folder the read names", async () => {
        const lines = [
            {
                type: "assistant",
                message: {
                    content: [{ type: "tool_use", id: "m1", name: "Monitor", input: { command: "tail -f a" } }],
                },
            },
            {
                type: "user",
                message: {
                    content: [
                        {
                            type: "tool_result",
                            tool_use_id: "m1",
                            content: "Monitor started (task bm1, expires in 30m)",
                        },
                    ],
                },
            },
        ].map((r) => JSON.stringify(r));
        vi.mocked(RpcApi.GetAgentTranscriptCommand).mockResolvedValueOnce({
            lines,
            start: 0,
            total: lines.length,
            end: 0,
            tasksdir: "C:\\T\\claude\\p\\s\\tasks",
        });
        await refreshSubagents("mon", "/t/mon.jsonl");
        expect(globalStore.get(backgroundTasksByIdAtom).mon?.[0]?.outputFile).toBe(
            "C:\\T\\claude\\p\\s\\tasks\\bm1.output"
        );
    });
});
