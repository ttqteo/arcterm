// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { focusedPanelAgent, panelOwnerOf } from "./pathlinkroute";

const roster = [
    { id: "t-agent", name: "a", task: "", state: "working", blockId: "b-agent" },
    { id: "t-term", name: "sh", task: "", state: "idle", kind: "terminal", blockId: "b-term" },
] as any[];

describe("panelOwnerOf", () => {
    it("gives the agent whose TUI the block is", () => {
        expect(panelOwnerOf(roster, "b-agent")?.id).toBe("t-agent");
    });

    it("gives nothing for a plain terminal or an unknown block: they have no panel", () => {
        expect(panelOwnerOf(roster, "b-term")).toBeUndefined();
        expect(panelOwnerOf(roster, "nope")).toBeUndefined();
    });
});

describe("focusedPanelAgent", () => {
    const base = { surface: "agent", focusId: "t-agent", roster, cwd: "D:/repo", abs: "D:\\repo\\src\\a.ts" } as const;

    it("takes the focused agent when the Agent surface shows and its directory holds the file", () => {
        expect(focusedPanelAgent(base)).toBe("t-agent");
    });

    it("declines on another surface, for a terminal, without a cwd, or for a file outside it", () => {
        expect(focusedPanelAgent({ ...base, surface: "code" })).toBeNull();
        expect(focusedPanelAgent({ ...base, focusId: "t-term" })).toBeNull();
        expect(focusedPanelAgent({ ...base, cwd: null })).toBeNull();
        expect(focusedPanelAgent({ ...base, abs: "C:/elsewhere/a.ts" })).toBeNull();
    });
});
