// frontend/app/view/code/codesearchopts.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_OPTS, grepData, toPathspecs } from "./codesearchopts";

describe("toPathspecs", () => {
    it("splits on commas and trims each pathspec", () => {
        expect(toPathspecs(" *.go, pkg/sub ")).toEqual(["*.go", "pkg/sub"]);
    });

    it("drops empty entries", () => {
        expect(toPathspecs(",, *.ts ,")).toEqual(["*.ts"]);
    });

    it("is empty for a blank field", () => {
        expect(toPathspecs("   ")).toEqual([]);
    });
});

describe("grepData", () => {
    it("sends the default options as a plain substring search", () => {
        expect(grepData("C:\\repo", "needle", DEFAULT_SEARCH_OPTS)).toEqual({
            cwd: "C:\\repo",
            allowplain: true,
            query: "needle",
            regex: false,
            wholeword: false,
            casesensitive: false,
            include: [],
            exclude: [],
        });
    });

    it("maps each filter onto its wire field", () => {
        const opts = {
            regex: true,
            wholeWord: true,
            caseSensitive: true,
            include: "*.go",
            exclude: "vendor, *_test.go",
        };
        expect(grepData("C:\\repo", "need(le)?", opts)).toEqual({
            cwd: "C:\\repo",
            allowplain: true,
            query: "need(le)?",
            regex: true,
            wholeword: true,
            casesensitive: true,
            include: ["*.go"],
            exclude: ["vendor", "*_test.go"],
        });
    });
});
