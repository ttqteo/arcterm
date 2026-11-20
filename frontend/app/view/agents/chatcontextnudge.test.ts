// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { contextNudgeShows, contextNudgeText, stillAnswered } from "./chatcontextnudge";

describe("contextNudgeShows", () => {
    const base = { isClaude: true, state: "idle" as const, level: "hot" as const, live: true, answered: false };

    it("asks an idle Claude agent past the red line", () => {
        expect(contextNudgeShows(base)).toBe(true);
    });

    it("waits under the red line: amber is the gauge's job, not a question", () => {
        expect(contextNudgeShows({ ...base, level: "warn" })).toBe(false);
        expect(contextNudgeShows({ ...base, level: "ok" })).toBe(false);
    });

    it("waits through a turn and asks once it ends", () => {
        expect(contextNudgeShows({ ...base, state: "working" })).toBe(false);
        expect(contextNudgeShows({ ...base, state: "asking" })).toBe(false);
    });

    it("asks once: an answered crossing stays quiet", () => {
        expect(contextNudgeShows({ ...base, answered: true })).toBe(false);
    });

    it("asks nothing of another runtime or an agent with no live terminal", () => {
        expect(contextNudgeShows({ ...base, isClaude: false })).toBe(false);
        expect(contextNudgeShows({ ...base, live: false })).toBe(false);
    });
});

describe("stillAnswered", () => {
    it("holds the answer while the context stays at or above the warn line", () => {
        expect(stillAnswered(true, "hot")).toBe(true);
        expect(stillAnswered(true, "warn")).toBe(true);
    });

    it("lets the next crossing ask again once the context falls under it", () => {
        expect(stillAnswered(true, "ok")).toBe(false);
        expect(stillAnswered(false, "hot")).toBe(false);
    });
});

describe("contextNudgeText", () => {
    it("names what every turn re-reads on a big window", () => {
        expect(contextNudgeText(21, 1_000_000)).toBe(
            "Every turn re-reads 210k. Compact or clear before the next task?"
        );
    });

    it("says the window is nearly full when fullness made it red", () => {
        expect(contextNudgeText(90, 200_000)).toMatch(/^Context nearly full/);
        expect(contextNudgeText(90, undefined)).toMatch(/^Context nearly full/);
    });
});
