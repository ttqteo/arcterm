// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { noteMetaLine, notePeekFacts } from "./peeknotemodel";

describe("notePeekFacts", () => {
    it("is gone when the read was rejected", () => {
        expect(notePeekFacts("error")).toEqual({ gone: true });
    });

    it("is present, with nothing to focus, when the read landed", () => {
        expect(notePeekFacts("ok")).toEqual({ gone: false });
    });
});

describe("noteMetaLine", () => {
    const sept24 = new Date(2026, 8, 24, 15, 30).getTime();

    it("names the project, then the day it was updated", () => {
        expect(noteMetaLine({ project: "waveterm", updated: sept24 })).toBe("waveterm · 09-24");
    });

    it("leaves out what the note does not have", () => {
        expect(noteMetaLine({ updated: sept24 })).toBe("09-24");
        expect(noteMetaLine({ project: "waveterm", updated: 0 })).toBe("waveterm");
        expect(noteMetaLine({ updated: 0 })).toBe("");
    });
});
