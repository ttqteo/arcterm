// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    HINT_LINES,
    HINTS_SEEN_KEY,
    hintsSeen,
    markHintsSeen,
    shouldShowHints,
    START_LINE,
    type HintStore,
} from "./brainstormhints";

function fakeStore(initial: Record<string, string> = {}): HintStore & { data: Record<string, string> } {
    const data = { ...initial };
    return {
        data,
        getItem: (k) => data[k] ?? null,
        setItem: (k, v) => {
            data[k] = v;
        },
    };
}

const broken: HintStore = {
    getItem: () => {
        throw new Error("SecurityError");
    },
    setItem: () => {
        throw new Error("QuotaExceededError");
    },
};

describe("brainstorm hints: whether the first-open card shows", () => {
    it("is remembered under brainstorm.hintsSeen", () => {
        expect(HINTS_SEEN_KEY).toBe("brainstorm.hintsSeen");
    });

    it("shows on a machine that never dismissed it", () => {
        expect(hintsSeen(fakeStore())).toBe(false);
        expect(shouldShowHints(hintsSeen(fakeStore()), false)).toBe(true);
    });

    it("stays gone once it was dismissed, across a reload (a fresh read of the same store)", () => {
        const store = fakeStore();
        markHintsSeen(store);
        expect(store.data).toEqual({ "brainstorm.hintsSeen": "1" });
        expect(hintsSeen(store)).toBe(true);
        expect(shouldShowHints(hintsSeen(store), false)).toBe(false);
    });

    it("shows on a failed read, and on no store at all", () => {
        expect(hintsSeen(broken)).toBe(false);
        expect(hintsSeen(undefined)).toBe(false);
        expect(shouldShowHints(hintsSeen(broken), false)).toBe(true);
    });

    it("a failed write throws nothing, and the dismissal still holds for the session", () => {
        expect(() => markHintsSeen(broken)).not.toThrow();
        expect(() => markHintsSeen(undefined)).not.toThrow();
        expect(shouldShowHints(hintsSeen(broken), true)).toBe(false);
    });

    it("reads only the value it wrote: anything else in the key shows the card", () => {
        expect(hintsSeen(fakeStore({ [HINTS_SEEN_KEY]: "true" }))).toBe(false);
        expect(hintsSeen(fakeStore({ [HINTS_SEEN_KEY]: "" }))).toBe(false);
    });
});

describe("brainstorm hints: the words", () => {
    it("is four short lines, one per thing a newcomer has to know", () => {
        expect(HINT_LINES).toHaveLength(4);
        for (const line of HINT_LINES) {
            expect(line.length).toBeLessThan(100);
        }
        expect(HINT_LINES[0]).toMatch(/Enter sends/);
        expect(HINT_LINES[1]).toMatch(/Guess for me/);
        expect(HINT_LINES[1]).toMatch(/That’s right/);
        expect(HINT_LINES[2]).toMatch(/Ctrl\+Shift\+B/);
        expect(HINT_LINES[3]).toMatch(/Check with a builder/);
        expect(HINT_LINES[3]).toMatch(/Approve/);
    });

    it("says where to start one, naming the skill, in the words the plan gives", () => {
        expect(START_LINE).toBe(
            "Ask the agent to brainstorm a feature (superpowers:brainstorming) and Arc opens it here, one question at a time."
        );
    });

    it("uses plain words: no file names, commands or wire terms", () => {
        for (const line of HINT_LINES) {
            expect(line).not.toMatch(/\.json|\bwsh\b|\bRPC\b|--|`/);
        }
    });
});
