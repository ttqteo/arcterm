// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instructionCandidates, instructionsFileAtom, instructionsKey, loadInstructionsFile } from "./instructionsfile";

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { FileInfoCommand: vi.fn() } }));

// files that exist, by path; anything else answers notfound
function withFiles(...paths: string[]) {
    vi.mocked(RpcApi.FileInfoCommand).mockImplementation(async (_c: any, d: any) => {
        const path = d.info.path;
        return paths.includes(path) ? { path, name: path } : { path, name: path, notfound: true };
    });
}

describe("instructionCandidates", () => {
    it("reads CLAUDE.md first for claude, then AGENTS.md", () => {
        expect(instructionCandidates("claude")).toEqual(["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"]);
        expect(instructionCandidates(undefined)).toEqual(instructionCandidates("claude"));
    });

    it("reads only AGENTS.md for the other harnesses", () => {
        expect(instructionCandidates("pi")).toEqual(["AGENTS.md"]);
        expect(instructionCandidates("codex")).toEqual(["AGENTS.md"]);
    });
});

describe("loadInstructionsFile", () => {
    beforeEach(() => {
        globalStore.set(instructionsFileAtom, {});
        vi.mocked(RpcApi.FileInfoCommand).mockReset();
    });

    it("finds CLAUDE.md before AGENTS.md for claude", async () => {
        withFiles("/r/CLAUDE.md", "/r/AGENTS.md");
        await loadInstructionsFile("/r", "claude");
        expect(globalStore.get(instructionsFileAtom)[instructionsKey("/r", "claude")]).toBe("/r/CLAUDE.md");
    });

    it("falls back to AGENTS.md for claude when the project has no CLAUDE.md", async () => {
        withFiles("/r/AGENTS.md");
        await loadInstructionsFile("/r", "claude");
        expect(globalStore.get(instructionsFileAtom)[instructionsKey("/r", "claude")]).toBe("/r/AGENTS.md");
    });

    it("gives pi AGENTS.md even when a CLAUDE.md is there", async () => {
        withFiles("/r/CLAUDE.md", "/r/AGENTS.md");
        await loadInstructionsFile("/r", "pi");
        expect(globalStore.get(instructionsFileAtom)[instructionsKey("/r", "pi")]).toBe("/r/AGENTS.md");
    });

    it("records null when the project has neither", async () => {
        withFiles();
        await loadInstructionsFile("/r", "claude");
        expect(globalStore.get(instructionsFileAtom)[instructionsKey("/r", "claude")]).toBeNull();
    });

    it("reads a root once", async () => {
        withFiles("/r/CLAUDE.md");
        await loadInstructionsFile("/r", "claude");
        await loadInstructionsFile("/r", "claude");
        expect(RpcApi.FileInfoCommand).toHaveBeenCalledTimes(1);
    });

    it("skips a directory of that name", async () => {
        vi.mocked(RpcApi.FileInfoCommand).mockImplementation(async (_c: any, d: any) =>
            d.info.path === "/r/CLAUDE.md"
                ? { path: "/r/CLAUDE.md", isdir: true }
                : { path: d.info.path, notfound: true }
        );
        await loadInstructionsFile("/r", "claude");
        expect(globalStore.get(instructionsFileAtom)[instructionsKey("/r", "claude")]).toBeNull();
    });
});
