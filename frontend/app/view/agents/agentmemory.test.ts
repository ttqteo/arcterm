// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { agentMemory, retainAgentMemories } from "./agentmemory";

describe("retainAgentMemories", () => {
    test("drops every memory's entries for agents that left the roster, and a subagent interior's", () => {
        const a = agentMemory<number>();
        const b = agentMemory<string>();
        a.set("live", 1);
        a.set("gone", 2);
        b.set("gone", "x");
        b.set("sub:s1", "y");
        retainAgentMemories(new Set(["live"]));
        expect([a.get("live"), a.get("gone"), b.get("gone"), b.get("sub:s1")]).toEqual([
            1,
            undefined,
            undefined,
            undefined,
        ]);
    });

    test("keeps everything on an empty roster, the boot window before it loads", () => {
        const a = agentMemory<number>();
        a.set("x", 1);
        retainAgentMemories(new Set());
        expect(a.get("x")).toBe(1);
    });
});
