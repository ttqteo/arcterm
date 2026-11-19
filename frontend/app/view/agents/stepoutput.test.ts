// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { codeOutputLine, namesCodeFile, readsCode, splitLocation } from "./stepoutput";

describe("readsCode", () => {
    it("is true for a command that prints a source file", () => {
        expect(readsCode("sed -n 44,95p chatinsert.ts; sed -n 440,470p chatcomposer.tsx")).toBe(true);
        expect(readsCode('grep -n "^export" chatinsert.ts | head')).toBe(true);
        expect(readsCode("cd /d/x && cat pkg/a/b.go")).toBe(true);
        expect(readsCode("git show HEAD:frontend/app/x.tsx")).toBe(true);
    });

    it("is false for a command that prints no source", () => {
        expect(readsCode("npx vitest run frontend/app/view/agents/x.test.ts")).toBe(false);
        expect(readsCode("git status --short")).toBe(false);
        expect(readsCode("cat notes.md")).toBe(false);
        expect(readsCode("grep -n foo docs/a.txt")).toBe(false);
    });
});

describe("namesCodeFile", () => {
    it("is true for a grep location in a source file", () => {
        expect(namesCodeFile("frontend/app/x.tsx:12")).toBe(true);
        expect(namesCodeFile("D:\\x\\a.go:7")).toBe(true);
    });

    it("is false for prose and an empty location", () => {
        expect(namesCodeFile("docs/notes.md:3")).toBe(false);
        expect(namesCodeFile("")).toBe(false);
    });
});

describe("splitLocation", () => {
    it("takes grep's line number, with or without a path", () => {
        expect(splitLocation("12:export function insertAt(")).toEqual({
            loc: "12:",
            code: "export function insertAt(",
        });
        expect(splitLocation("src/a.ts:30:const x = 1;")).toEqual({ loc: "src/a.ts:30:", code: "const x = 1;" });
        expect(splitLocation("D:\\x\\a.ts:7:let y")).toEqual({ loc: "D:\\x\\a.ts:7:", code: "let y" });
        expect(splitLocation("a.ts-8-  context line")).toEqual({ loc: "a.ts-8-", code: "  context line" });
    });

    it("takes cat -n's number and tab", () => {
        expect(splitLocation("    12\treturn x;")).toEqual({ loc: "    12\t", code: "return x;" });
    });

    it("leaves a plain code line whole", () => {
        expect(splitLocation("export interface ChatBox {")).toEqual({ loc: "", code: "export interface ChatBox {" });
        expect(splitLocation("    text(): string;")).toEqual({ loc: "", code: "    text(): string;" });
    });
});

describe("codeOutputLine", () => {
    it("dims the location and highlights the code", () => {
        const toks = codeOutputLine("40:export function insertIntoChatBox(");
        expect(toks[0]).toEqual({ t: "40:", cls: "text-muted" });
        expect(toks.find((t) => t.t === "export")?.cls).toBe("text-syntax-keyword");
        expect(toks.map((t) => t.t).join("")).toBe("40:export function insertIntoChatBox(");
    });
});
