// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { runningAfterProcStatus, shellPosition } from "./lastcommand";

describe("runningAfterProcStatus", () => {
    it("clears the mark when the shell is not running", () => {
        expect(runningAfterProcStatus("running", "done")).toBe(false);
        expect(runningAfterProcStatus(null, "done")).toBe(false);
        expect(runningAfterProcStatus(undefined, "init")).toBe(false);
    });

    it("clears the mark when the shell starts again", () => {
        expect(runningAfterProcStatus("done", "running")).toBe(false);
        expect(runningAfterProcStatus("init", "running")).toBe(false);
    });

    it("leaves the mark of a shell that was already running, or first seen running", () => {
        expect(runningAfterProcStatus("running", "running")).toBeNull();
        expect(runningAfterProcStatus(null, "running")).toBeNull();
    });
});

describe("shellPosition", () => {
    it("reads a prompt from A and R, a command from C", () => {
        expect(shellPosition("A")).toBe("prompt");
        expect(shellPosition("R")).toBe("prompt");
        expect(shellPosition('C;{"cmd64":"dGFzayBkZXY="}')).toBe("command");
        expect(shellPosition("C")).toBe("command");
    });

    it("ignores the other marks", () => {
        expect(shellPosition('D;{"exitcode":0}')).toBeNull();
        expect(shellPosition('M;{"shell":"pwsh"}')).toBeNull();
        expect(shellPosition("")).toBeNull();
    });
});
