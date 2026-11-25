// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { codePaste, endQuotes, looksLikeCode } from "./chatmarks";

const STACK = [
    "    at ReleaseDetail (http://localhost:4310/src/components/releases/ReleaseDetail.tsx?t=1794992591545:38:41)",
    "    at div",
    "    at ReleasesApp (http://localhost:4310/src/components/releases/ReleasesApp.tsx:8:39)",
    "",
    "Consider adding an error boundary to your tree to customize error handling behavior.",
    "Visit https://reactjs.org/link/error-boundaries to learn more about error boundaries.",
    "react-dom.development.js:26962 Uncaught TypeError: Cannot read properties of undefined (reading 'filter')",
    "    at MergeChecks (MergeChecks.tsx:11:38)",
].join("\r\n");

describe("endQuotes", () => {
    it("ends a quote that a line of text follows at once", () => {
        expect(endQuotes(">xx\nsss")).toBe(">xx\n\nsss");
        expect(endQuotes("> a\n> b\nc\n> d")).toBe("> a\n> b\n\nc\n> d");
    });
    it("leaves a quote that ends the message, a blank line or a fence alone", () => {
        expect(endQuotes("> a\n\nb")).toBe("> a\n\nb");
        expect(endQuotes("a\n> b")).toBe("a\n> b");
        expect(endQuotes("```\n> a\nb\n```")).toBe("```\n> a\nb\n```");
    });
});

describe("looksLikeCode", () => {
    it("takes a stack trace", () => {
        expect(looksLikeCode(STACK)).toBe(true);
    });
    it("takes code", () => {
        expect(looksLikeCode("function f(a) {\n  return a + 1;\n}")).toBe(true);
        expect(looksLikeCode("2026-11-18 10:02:11 INFO start\n2026-11-18 10:02:12 ERROR boom")).toBe(true);
    });
    it("leaves prose, lists, quotes and one line", () => {
        expect(looksLikeCode("Mình đã thử lại.\nVẫn lỗi như cũ, bạn xem giúp.")).toBe(false);
        expect(looksLikeCode("- one\n- two\n- three")).toBe(false);
        expect(looksLikeCode("> quoted\n> more")).toBe(false);
        expect(looksLikeCode("const a = 1;")).toBe(false);
    });
    it("leaves a paste that is fenced already", () => {
        expect(looksLikeCode("```\nconst a = 1;\nconst b = 2;\n```")).toBe(false);
    });
});

describe("codePaste", () => {
    const code = "const a = 1;\r\nconst b = 2;\r\n\r\n";
    it("fences a paste at the start of an empty box", () => {
        expect(codePaste("", 0, 0, code)).toEqual({
            raw: "const a = 1;\nconst b = 2;\n\n",
            fenced: "```\nconst a = 1;\nconst b = 2;\n```",
        });
    });
    it("puts the fence on lines of its own", () => {
        expect(codePaste("look: ", 6, 6, code)?.fenced).toBe("\n```\nconst a = 1;\nconst b = 2;\n```");
        expect(codePaste("look: X then", 6, 7, code)?.fenced).toBe("\n```\nconst a = 1;\nconst b = 2;\n```\n");
    });
    it("is null for prose and inside a fence", () => {
        expect(codePaste("", 0, 0, "hello\nworld")).toBeNull();
        expect(codePaste("```\n", 4, 4, code)).toBeNull();
    });
    it("closes a fence the person typed when the paste goes right after it", () => {
        const log = 'PID 768\r\n"node" vite.js preview --port 5174\r\n';
        expect(codePaste("```", 3, 3, log)).toEqual({
            raw: 'PID 768\n"node" vite.js preview --port 5174\n',
            fenced: '\nPID 768\n"node" vite.js preview --port 5174\n```',
        });
        expect(codePaste("look:\n~~~~bash", 14, 14, "npm i\nnpm t")?.fenced).toBe("\nnpm i\nnpm t\n~~~~");
    });
    it("leaves a paste after a fence alone when it is a language, the fence is closed, or text follows", () => {
        expect(codePaste("```", 3, 3, "bash")).toBeNull();
        expect(codePaste("```\n```", 3, 3, "a b")).toBeNull();
        expect(codePaste("``` x", 3, 3, "a b")).toBeNull();
    });
});
