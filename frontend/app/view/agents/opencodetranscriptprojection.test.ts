// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { extractOpencodeTitle, projectOpencodeTranscript } from "./opencodetranscriptprojection";

const SHADOW = [
    `{"type":"session","id":"ses_x","model":"openai/gpt-5.2-codex","title":"Fix the flaky test","ts":100}`,
    `{"type":"state","state":"working","ts":101}`,
    `{"type":"user","text":"fix the flaky test","ts":102}`,
    `{"type":"assistant","text":"Looking at the spec…","ts":103}`,
    `{"type":"tool","name":"bash","state":"running","input":"go test ./...","ts":104}`,
    `{"type":"tool","name":"bash","state":"error","input":"go test ./...","ts":105}`,
];

describe("projectOpencodeTranscript", () => {
    it("projects user/assistant/tool lines into entries", () => {
        const entries = projectOpencodeTranscript(SHADOW);
        expect(entries[0]).toEqual({ kind: "user", text: "fix the flaky test" });
        expect(entries[1]).toEqual({ kind: "message", text: "Looking at the spec…" });
        expect(entries[2]).toMatchObject({ kind: "action", verb: "ran", target: "go test ./...", outcome: "ok" });
        expect(entries[3]).toMatchObject({ kind: "action", verb: "ran", target: "go test ./...", outcome: "fail" });
    });
    it("skips state records and unparseable lines", () => {
        const entries = projectOpencodeTranscript([...SHADOW, "not json"]);
        expect(entries.some((e) => (e as any).kind === "state")).toBe(false);
    });
    it("maps edit/write/read tool targets to a file name", () => {
        const entries = projectOpencodeTranscript([
            `{"type":"tool","name":"edit","state":"completed","input":"{\\"filePath\\":\\"/a/b/auth.go\\"}","ts":1}`,
        ]);
        expect(entries[0]).toMatchObject({ kind: "action", verb: "edited", target: "auth.go" });
    });

    it("keeps the full path of a file tool beside its base name", () => {
        const entries = projectOpencodeTranscript([
            `{"type":"tool","name":"edit","state":"completed","input":"{\\"filePath\\":\\"/a/b/auth.go\\"}","ts":1}`,
        ]);
        expect(entries[0]).toMatchObject({ target: "auth.go", path: "/a/b/auth.go" });
    });
});

describe("extractOpencodeTitle", () => {
    it("prefers the session record title", () => {
        expect(extractOpencodeTitle(SHADOW)).toBe("Fix the flaky test");
    });
    it("falls back to the first user text", () => {
        expect(extractOpencodeTitle([`{"type":"user","text":"do the thing","ts":1}`])).toBe("do the thing");
    });
    it("returns undefined for empty input", () => {
        expect(extractOpencodeTitle([])).toBeUndefined();
    });
});
