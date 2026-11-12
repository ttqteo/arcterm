// frontend/app/view/code/codependingjump.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { resolvePendingJump } from "./codependingjump";
import type { CodeFile } from "./codestore";

const text = (path: string): CodeFile => ({ kind: "text", path, text: "", size: 0, modtime: 1 });
const headings = [
    { name: "Intro", line: 1 },
    { name: "The final stage", line: 40 },
    { name: "Setup", line: 60 },
    { name: "Setup", line: 80 },
];

describe("resolvePendingJump", () => {
    it("waits while another file is showing", () => {
        const jump = { path: "b.ts", line: 12 };
        expect(resolvePendingJump(jump, text("a.ts"), [])).toEqual({ kind: "wait" });
        expect(resolvePendingJump(jump, { kind: "none" }, [])).toEqual({ kind: "wait" });
        expect(resolvePendingJump(jump, { kind: "loading", path: "b.ts" }, [])).toEqual({ kind: "wait" });
        expect(resolvePendingJump(jump, { kind: "binary", path: "a.png", size: 3 }, [])).toEqual({ kind: "wait" });
    });

    it("applies the line once its file is the text showing", () => {
        expect(resolvePendingJump({ path: "b.ts", line: 12 }, text("b.ts"), [])).toEqual({ kind: "line", line: 12 });
    });

    it("drops a jump whose file did not open as text", () => {
        const jump = { path: "b.ts", line: 12 };
        for (const file of [
            { kind: "binary", path: "b.ts", size: 3 },
            { kind: "toolarge", path: "b.ts", size: 3 },
            { kind: "missing", path: "b.ts" },
            { kind: "error", path: "b.ts", message: "denied" },
            { kind: "image", path: "b.ts", size: 3, modtime: 1 },
        ] as CodeFile[]) {
            expect(resolvePendingJump(jump, file, []), file.kind).toEqual({ kind: "drop" });
        }
    });

    it("resolves an anchor to its heading line", () => {
        const file = text("doc.md");
        expect(resolvePendingJump({ path: "doc.md", anchor: "the-final-stage" }, file, headings)).toEqual({
            kind: "line",
            line: 40,
        });
        expect(resolvePendingJump({ path: "doc.md", anchor: "setup-1" }, file, headings)).toEqual({
            kind: "line",
            line: 80,
        });
    });

    it("drops an unknown anchor", () => {
        expect(resolvePendingJump({ path: "doc.md", anchor: "nowhere" }, text("doc.md"), headings)).toEqual({
            kind: "drop",
        });
    });
});
