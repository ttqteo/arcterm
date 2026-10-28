// frontend/app/view/code/codedifftarget.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { diffBaseOf, diffTargetLabel, headMatches, nextDiffStep } from "./codedifftarget";

describe("nextDiffStep", () => {
    it("cycles off, HEAD, base, off when the base is usable", () => {
        expect(nextDiffStep("off", true)).toBe("head");
        expect(nextDiffStep("head", true)).toBe("base");
        expect(nextDiffStep("base", true)).toBe("off");
    });

    it("skips the base when it is not usable", () => {
        expect(nextDiffStep("off", false)).toBe("head");
        expect(nextDiffStep("head", false)).toBe("off");
    });

    it("leaves the base whatever the base answers now", () => {
        expect(nextDiffStep("base", false)).toBe("off");
    });
});

describe("diffTargetLabel", () => {
    it("names HEAD", () => {
        expect(diffTargetLabel("head")).toBe("Against HEAD");
    });

    it("names the base branch and the merge-base's short sha", () => {
        expect(diffTargetLabel("base", { branch: "origin/main", sha: "abc1234def5678" })).toBe(
            "Against the merge-base with origin/main (abc1234)"
        );
    });

    it("falls back to a generic name while the base is unknown", () => {
        expect(diffTargetLabel("base")).toBe("Against the branch base");
    });
});

describe("diffBaseOf", () => {
    const commit = { hash: "f00", parents: [], author: "a", email: "e", ts: 0, subject: "s" };
    const div = { ahead: [commit], mergebase: "abc1234def", isrepo: true };

    it("is usable on a branch with commits ahead of the default", () => {
        expect(diffBaseOf("origin/main", div)).toEqual({ kind: "usable", branch: "origin/main", sha: "abc1234def" });
    });

    it("skips on the default branch, where the merge-base is HEAD", () => {
        expect(diffBaseOf("main", { ...div, ahead: [] })).toEqual({ kind: "skip" });
        expect(diffBaseOf("main", { ...div, ahead: undefined })).toEqual({ kind: "skip" });
    });

    it("skips when the repository has no default branch", () => {
        expect(diffBaseOf("", null)).toEqual({ kind: "skip" });
    });

    it("skips outside a repository", () => {
        expect(diffBaseOf("main", { ahead: [], mergebase: "", isrepo: false })).toEqual({ kind: "skip" });
    });

    it("is an error, not a skip, when commits are ahead but no merge-base came back", () => {
        expect(diffBaseOf("main", { ...div, mergebase: "" }).kind).toBe("error");
    });
});

describe("headMatches", () => {
    const head = { kind: "text" as const, path: "a.go", ref: "HEAD", text: "x" };

    it("matches the same path and ref", () => {
        expect(headMatches(head, "a.go", "HEAD")).toBe(true);
    });

    it("never shows a HEAD read as the base, or the reverse", () => {
        expect(headMatches(head, "a.go", "abc1234")).toBe(false);
        expect(headMatches({ ...head, ref: "abc1234" }, "a.go", "HEAD")).toBe(false);
    });

    it("rejects another file's read and a base that is not resolved", () => {
        expect(headMatches(head, "b.go", "HEAD")).toBe(false);
        expect(headMatches(head, "a.go", null)).toBe(false);
        expect(headMatches({ kind: "idle" }, "a.go", "HEAD")).toBe(false);
    });
});
