// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { laterKey, laterSince, laterTitle, withLater } from "./latermodel";

describe("laterKey", () => {
    it("is the transcript's file stem, on either separator", () => {
        expect(laterKey("C:\\Users\\me\\.claude\\projects\\x\\abc-123.jsonl")).toBe("abc-123");
        expect(laterKey("/home/me/.pi/sessions/s9.jsonl")).toBe("s9");
    });

    it("is undefined with no transcript, which cannot be marked", () => {
        expect(laterKey(undefined)).toBeUndefined();
        expect(laterKey("")).toBeUndefined();
    });
});

describe("withLater", () => {
    it("marks a session at now and clears it with Done", () => {
        const on = withLater({}, "a", true, 100);
        expect(on).toEqual({ a: 100 });
        expect(withLater(on, "a", false, 200)).toEqual({});
    });

    it("keeps the first time when marked again, and leaves the others", () => {
        expect(withLater({ a: 100, b: 5 }, "a", true, 900)).toEqual({ a: 100, b: 5 });
    });

    it("does not change the marks it was given", () => {
        const marks = { a: 1 };
        withLater(marks, "a", false, 2);
        expect(marks).toEqual({ a: 1 });
    });
});

describe("laterSince", () => {
    it("reads a mark through the transcript path", () => {
        expect(laterSince({ s1: 42 }, "/x/s1.jsonl")).toBe(42);
        expect(laterSince({ s1: 42 }, "/x/s2.jsonl")).toBeUndefined();
        expect(laterSince({ s1: 42 }, undefined)).toBeUndefined();
    });
});

describe("laterTitle", () => {
    it("says how long ago it was marked", () => {
        expect(laterTitle(1000, 4000, (ms) => `${ms / 1000}s`)).toBe("Later · marked 3s ago");
    });
});
