// frontend/app/cockpit/openfileroute.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { routeOpenFile } from "./openfileroute";

const repo = { name: "waveterm", path: "C:\\Users\\kael02\\IdeaProjects\\waveterm" };

describe("routeOpenFile", () => {
    test("file inside current project stays in it, git-style rel", () => {
        const r = routeOpenFile("C:\\Users\\kael02\\IdeaProjects\\WAVETERM\\pkg\\wps\\wpstypes.go", false, repo, []);
        expect(r.project).toBe(repo);
        expect(r.rel).toBe("pkg/wps/wpstypes.go");
    });

    test("file outside current project synthesizes a project at its dirname", () => {
        const r = routeOpenFile("D:\\notes\\todo.md", false, repo, []);
        expect(r.project).toEqual({ name: "notes", path: "D:\\notes" });
        expect(r.rel).toBe("todo.md");
    });

    test("file with no current project still routes", () => {
        const r = routeOpenFile("C:\\work\\app\\src\\main.go", false, null, []);
        expect(r.project).toEqual({ name: "src", path: "C:\\work\\app\\src" });
        expect(r.rel).toBe("main.go");
    });

    test("file outside current project opens in the registered project that contains it", () => {
        const app = { name: "app", path: "C:\\work\\app" };
        const r = routeOpenFile("C:\\work\\app\\src\\main.go", false, repo, [repo, app]);
        expect(r.project).toEqual(app);
        expect(r.rel).toBe("src/main.go");
    });

    test("the deepest registered project wins when registered projects nest", () => {
        const outer = { name: "outer", path: "C:\\work" };
        const inner = { name: "inner", path: "C:/work/app" };
        const r = routeOpenFile("C:\\work\\app\\src\\main.go", false, null, [outer, inner]);
        expect(r.project).toEqual(inner);
        expect(r.rel).toBe("src/main.go");
    });

    test("mixed separators compare equal to the project root", () => {
        const r = routeOpenFile("C:/Users/kael02/IdeaProjects/waveterm/README.md", false, repo, []);
        expect(r.project).toBe(repo);
        expect(r.rel).toBe("README.md");
    });

    test("a project root written with a trailing separator still strips only its own segments", () => {
        const slashed = { name: "app", path: "C:\\work\\app\\" };
        const r = routeOpenFile("C:\\work\\app\\src\\main.go", false, slashed, []);
        expect(r.project).toBe(slashed);
        expect(r.rel).toBe("src/main.go");
    });

    test("a path ending in a separator leaves no empty segment in rel", () => {
        expect(routeOpenFile("C:\\Users\\kael02\\IdeaProjects\\waveterm\\pkg\\", false, repo, []).rel).toBe("pkg");
    });

    test("directory becomes the browsed project itself", () => {
        const r = routeOpenFile("D:\\some\\repo", true, repo, []);
        expect(r.project).toEqual({ name: "repo", path: "D:\\some\\repo" });
        expect(r.rel).toBeNull();
    });

    test("directory that is a registered project takes the registered name", () => {
        const app = { name: "my-app", path: "C:\\work\\app" };
        const r = routeOpenFile("c:/work/app/", true, null, [app]);
        expect(r.project).toEqual(app);
        expect(r.rel).toBeNull();
    });

    test("directory equal to current project keeps it and just browses", () => {
        const r = routeOpenFile(repo.path, true, repo, []);
        // sameRepoPath equality is handled by the caller; routing a dir always yields that dir
        expect(r.project).toEqual({ name: "waveterm", path: repo.path });
        expect(r.rel).toBeNull();
    });

    test("a degenerate drive-only root does not swallow paths on the drive", () => {
        const poisoned = { name: "C:", path: "C:" };
        const r = routeOpenFile("C:\\Users\\kael02\\work\\notes.md", false, poisoned, [poisoned]);
        expect(r.project).toEqual({ name: "work", path: "C:\\Users\\kael02\\work" });
        expect(r.rel).toBe("notes.md");
    });
});
