// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { scratchErrorLine } from "./floatnote";

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
