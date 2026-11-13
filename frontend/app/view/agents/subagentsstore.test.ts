// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { describe, expect, it, vi } from "vitest";
import { PARENT_TAIL_LINES, refreshSubagents } from "./subagentsstore";

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
            { path: "/t/parent.jsonl", maxlines: PARENT_TAIL_LINES }
        );
    });
});
