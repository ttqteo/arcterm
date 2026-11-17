// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Attachment } from "./composerattachments";
import { draftIds } from "./draftmarks";

const file = { kind: "file" } as unknown as Attachment;

describe("draftIds", () => {
    it("counts typed text and attached files, not a blank box", () => {
        const texts = new Map([
            ["a", "half a question"],
            ["b", "  \n "],
        ]);
        const atts = new Map<string, Attachment[]>([
            ["c", [file]],
            ["d", []],
        ]);
        expect([...draftIds(texts, atts)].sort()).toEqual(["a", "c"]);
    });

    it("names an agent once when it has both", () => {
        expect([...draftIds(new Map([["a", "x"]]), new Map([["a", [file]]]))]).toEqual(["a"]);
    });
});
