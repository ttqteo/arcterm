// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { isTranslateTerminal, scratchErrorLine, translateStep } from "./floatnote";

const term = (id: string, toolId?: string): AgentVM => ({ id, name: id, task: "", state: "idle", toolId }) as AgentVM;
const tool = (id: string, found: boolean): ToolStatus => ({ id, name: id, found }) as ToolStatus;

describe("isTranslateTerminal", () => {
    it("is true only for the trans tool's terminal", () => {
        expect(isTranslateTerminal({ toolId: "trans" })).toBe(true);
        expect(isTranslateTerminal({ toolId: "lazygit" })).toBe(false);
        expect(isTranslateTerminal({})).toBe(false);
    });
});

describe("translateStep", () => {
    it("shows the first terminal whose toolId is trans", () => {
        const step = translateStep([term("a"), term("t1", "trans"), term("t2", "trans")], [tool("trans", true)]);
        expect(step).toEqual({ kind: "show", id: "t1" });
    });
    it("opens the tool when no terminal runs it and trans is on PATH", () => {
        const trans = tool("trans", true);
        expect(translateStep([term("a")], [tool("git", true), trans])).toEqual({ kind: "open", tool: trans });
    });
    it("installs the tool when trans is not on PATH", () => {
        const trans = tool("trans", false);
        expect(translateStep([], [trans])).toEqual({ kind: "install", tool: trans });
    });
    it("is missing when the catalog is unread or has no trans", () => {
        expect(translateStep([], null)).toEqual({ kind: "missing" });
        expect(translateStep([], [tool("git", true)])).toEqual({ kind: "missing" });
    });
});

describe("scratchErrorLine", () => {
    it("names the error and says the text stays", () => {
        expect(scratchErrorLine(new Error("open /v/notes/.scratch.md.tmp: permission denied"))).toBe(
            "Couldn't save the note: open /v/notes/.scratch.md.tmp: permission denied. Your text stays here, and your next edit tries again."
        );
    });
    it("drops a leading Error: and a trailing period", () => {
        expect(scratchErrorLine("Error: disk full.")).toBe(
            "Couldn't save the note: disk full. Your text stays here, and your next edit tries again."
        );
    });
});
