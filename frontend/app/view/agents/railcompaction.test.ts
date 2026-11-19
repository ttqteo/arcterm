// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { compactionFacts, extractCompactions } from "./railcompaction";

const boundary = (meta: object, ts = "2026-11-19T10:00:00.000Z") =>
    JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: meta, timestamp: ts });
const summary = (text: string) =>
    JSON.stringify({ type: "user", isCompactSummary: true, message: { role: "user", content: text } });
const prompt = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } });

describe("extractCompactions", () => {
    it("joins each boundary with the summary after it", () => {
        const lines = [
            prompt("hi"),
            boundary({ trigger: "manual", preTokens: 202000, postTokens: 13000 }),
            summary("Summary:\nwe built the rail"),
            prompt("go on"),
        ];
        expect(extractCompactions(lines)).toEqual([
            {
                trigger: "manual",
                preTokens: 202000,
                postTokens: 13000,
                summary: "we built the rail",
                at: Date.parse("2026-11-19T10:00:00.000Z"),
            },
        ]);
    });

    it("keeps every compaction, oldest first", () => {
        const lines = [
            boundary({ trigger: "auto", preTokens: 160000, postTokens: 20000 }),
            summary("first"),
            boundary({ trigger: "manual", preTokens: 90000, postTokens: 9000 }),
            summary("second"),
        ];
        expect(extractCompactions(lines).map((c) => c.summary)).toEqual(["first", "second"]);
    });

    it("counts a summary whose boundary the tail cut off", () => {
        expect(extractCompactions([summary("orphan"), prompt("x")])).toEqual([{ summary: "orphan" }]);
    });

    it("ignores a prompt that only quotes the words, and a broken line", () => {
        expect(extractCompactions([prompt('what is "compact_boundary"?'), "{not json compact_boundary"])).toEqual([]);
    });
});

describe("compactionFacts", () => {
    const now = Date.parse("2026-11-19T10:12:00.000Z");

    it("says nothing without a compaction", () => {
        expect(compactionFacts(undefined, now)).toBeNull();
        expect(compactionFacts([], now)).toBeNull();
    });

    it("words the last compaction", () => {
        const at = Date.parse("2026-11-19T10:00:00.000Z");
        expect(compactionFacts([{ trigger: "manual", preTokens: 202000, postTokens: 13000, at }], now)).toBe(
            "202k → 13k · manual · 12m ago"
        );
    });

    it("leads with the count when the tail holds more than one", () => {
        expect(
            compactionFacts([{ trigger: "auto" }, { trigger: "manual", preTokens: 90000, postTokens: 9000 }], now)
        ).toBe("×2 · 90k → 9k · manual");
    });
});
