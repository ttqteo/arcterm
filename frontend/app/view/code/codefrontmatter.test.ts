// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./codefrontmatter";

describe("splitFrontmatter", () => {
    it("takes the leading YAML block off the body and lists its fields", () => {
        const doc = "---\nname: paper\ndescription: Use when drafting\n---\n\n# Paper\n";
        expect(splitFrontmatter(doc)).toEqual({
            fields: [
                ["name", "paper"],
                ["description", "Use when drafting"],
            ],
            body: "\n# Paper\n",
        });
    });
    it("reads CRLF files", () => {
        expect(splitFrontmatter("---\r\nname: a\r\n---\r\nbody")).toEqual({ fields: [["name", "a"]], body: "body" });
    });
    it("folds indented continuation and block-scalar lines into their field", () => {
        const doc = "---\ndescription: >\n  first line\n  second line\nmetadata:\n  type: user\n---\n";
        expect(splitFrontmatter(doc).fields).toEqual([
            ["description", "first line second line"],
            ["metadata", "type: user"],
        ]);
    });
    it("drops quotes around a whole value", () => {
        expect(splitFrontmatter("---\ntitle: \"Hi: there\"\nb: 'x'\n---\n").fields).toEqual([
            ["title", "Hi: there"],
            ["b", "x"],
        ]);
    });
    it("leaves a document without a leading block alone", () => {
        expect(splitFrontmatter("# Title\n---\nname: x\n---\n")).toEqual({
            fields: [],
            body: "# Title\n---\nname: x\n---\n",
        });
        // a thematic break with no closing fence is prose, not frontmatter
        expect(splitFrontmatter("---\nname: x\n\nmore")).toEqual({ fields: [], body: "---\nname: x\n\nmore" });
    });
    it("leaves a block that is not key: value lines alone", () => {
        const doc = "---\njust a sentence\n---\n";
        expect(splitFrontmatter(doc)).toEqual({ fields: [], body: doc });
    });
});
