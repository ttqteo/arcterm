// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { toneLine } from "./outputtone";

describe("toneLine", () => {
    it("reads vitest's lines", () => {
        expect(toneLine(" ✓ frontend/a.test.ts > chotText > is a title 0ms")).toEqual({
            tone: "pass",
            mark: " ✓",
            body: " frontend/a.test.ts > chotText > is a title",
            time: " 0ms",
        });
        expect(toneLine(" × frontend/a.test.ts > breaks 12ms")).toMatchObject({
            tone: "fail",
            mark: " ×",
            time: " 12ms",
        });
        expect(toneLine(" ↓ frontend/a.test.ts > skipped one")).toMatchObject({ tone: "skip", time: "" });
        expect(toneLine("      Tests  45 passed (45)").tone).toBe("pass");
        expect(toneLine("      Tests  1 failed | 44 passed (45)").tone).toBe("fail");
    });
    it("reads go test's lines", () => {
        expect(toneLine("ok  \tgithub.com/x/pkg/chatsuggest\t2.769s")).toMatchObject({
            tone: "pass",
            mark: "ok",
            time: "\t2.769s",
        });
        expect(toneLine("--- FAIL: TestX (0.31s)")).toMatchObject({
            tone: "fail",
            mark: "--- FAIL:",
            time: " (0.31s)",
        });
        expect(toneLine("FAIL\tgithub.com/x/pkg/y\t1.2s").tone).toBe("fail");
        expect(toneLine("?   \tgithub.com/x/pkg/z\t[no test files]").tone).toBe("skip");
        expect(toneLine("panic: runtime error: index out of range").tone).toBe("fail");
    });
    it("reads headings, errors and warnings", () => {
        expect(toneLine("task: [check:ts] node tsc.js --noEmit")).toMatchObject({ tone: "head", time: "" });
        expect(toneLine("$ go test -timeout 30s")).toMatchObject({ tone: "head", time: "" });
        expect(toneLine("TypeError: Cannot read properties of undefined").tone).toBe("fail");
        expect(toneLine("Warning: something odd").tone).toBe("warn");
    });
    it("leaves a test named for a failure green, and prose plain", () => {
        expect(toneLine(" ✓ a.test.ts > reports the step failed 1ms").tone).toBe("pass");
        expect(toneLine("for the person's own entry, whose view writes You").tone).toBe("plain");
        expect(toneLine("")).toEqual({ tone: "plain", mark: "", body: "", time: "" });
    });
    it("reads a background task's exit line and git status -s", () => {
        expect(toneLine("[exited with code 0]")).toMatchObject({ tone: "pass", mark: "[exited with code 0]" });
        expect(toneLine("[exited with code 2]").tone).toBe("fail");
        expect(toneLine(" M frontend/app/view/agents/councilchat.tsx")).toMatchObject({ tone: "mod", mark: " M" });
        expect(toneLine("M  frontend/a.tsx")).toMatchObject({ tone: "pass", mark: "M " });
        expect(toneLine("A  docs/x.md")).toMatchObject({ tone: "pass", mark: "A " });
        expect(toneLine("?? docs/superpowers/plans/x.md")).toMatchObject({ tone: "skip", mark: "??" });
        expect(toneLine("A big change landed").tone).toBe("plain");
    });
});
