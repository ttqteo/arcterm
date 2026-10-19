// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { projectNameFromTranscriptPath } from "./projectname";

describe("projectNameFromTranscriptPath", () => {
    it("derives the repo name from the encoded cwd dir", () => {
        const p = "/home/u/.claude/projects/C--Users-kael02-IdeaProjects-waveterm/abc.jsonl";
        expect(projectNameFromTranscriptPath(p)).toBe("waveterm");
    });
    it("handles backslash paths", () => {
        const p = "C:\\Users\\u\\.claude\\projects\\C--Users-kael02-IdeaProjects-cyber_anomaly_detector\\x.jsonl";
        expect(projectNameFromTranscriptPath(p)).toBe("cyber_anomaly_detector");
    });
    it("files an engine or Claude worktree under the checkout it was made from", () => {
        const base = "C:/Users/u/.claude/projects/";
        const run = "D--src-arcterm--waveterm-worktrees-fa79e660-7cba-4917-8097-8bbdd120f4d8";
        expect(projectNameFromTranscriptPath(`${base}${run}-t-1/x.jsonl`)).toBe("arcterm");
        expect(projectNameFromTranscriptPath(`${base}${run}/x.jsonl`)).toBe("arcterm");
        expect(projectNameFromTranscriptPath(`${base}D--src-arcterm--claude-worktrees-fix-x/x.jsonl`)).toBe(
            "arcterm"
        );
        expect(projectNameFromTranscriptPath(`${base}D--src-arcterm--worktrees-release-build/x.jsonl`)).toBe(
            "arcterm"
        );
    });
    it("returns empty for paths without a projects segment", () => {
        expect(projectNameFromTranscriptPath("/tmp/foo.jsonl")).toBe("");
        expect(projectNameFromTranscriptPath("")).toBe("");
    });
    it("returns empty for a missing path", () => {
        expect(projectNameFromTranscriptPath(undefined as unknown as string)).toBe("");
    });
    it("ignores empty path segments", () => {
        expect(projectNameFromTranscriptPath("/h/.claude/projects//C--a-repo/x.jsonl")).toBe("repo");
    });
    it("finds a projects segment at the start of a relative path", () => {
        expect(projectNameFromTranscriptPath("projects/C--a-repo/x.jsonl")).toBe("repo");
    });
    it("returns empty when projects is the last segment", () => {
        expect(projectNameFromTranscriptPath("/a/projects")).toBe("");
    });
    it("ignores a trailing dash in the encoded dir name", () => {
        expect(projectNameFromTranscriptPath("/h/.claude/projects/C--a-repo-/x.jsonl")).toBe("repo");
    });
});
