// frontend/app/view/code/codestore.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { canRestoreProject, codeBodyPhase, registeredProjects } from "./codestore";

const registry = {
    alpha: { path: "C:\\repos\\alpha" },
    beta: { path: "/home/u/beta" },
} as Record<string, ProjectKeywords>;

describe("canRestoreProject", () => {
    it("rejects when nothing was stored", () => {
        expect(canRestoreProject(null, registry)).toBe(false);
    });

    it("restores a project still in the registry", () => {
        expect(canRestoreProject({ name: "alpha", path: "C:\\repos\\alpha" }, registry)).toBe(true);
    });

    it("ignores separator and case differences in the path", () => {
        expect(canRestoreProject({ name: "alpha", path: "c:/repos/ALPHA" }, registry)).toBe(true);
    });

    it("rejects a project the registry no longer knows", () => {
        expect(canRestoreProject({ name: "gone", path: "C:\\repos\\gone" }, registry)).toBe(false);
    });

    it("rejects while the registry has not loaded yet", () => {
        expect(canRestoreProject({ name: "alpha", path: "C:\\repos\\alpha" }, {})).toBe(false);
    });
});

describe("registeredProjects", () => {
    it("lists every entry that has a path, sorted by name", () => {
        const unsorted = { zeta: { path: "C:\\z" }, blank: {}, ...registry } as Record<string, ProjectKeywords>;
        expect(registeredProjects(unsorted)).toEqual([
            { name: "alpha", path: "C:\\repos\\alpha" },
            { name: "beta", path: "/home/u/beta" },
            { name: "zeta", path: "C:\\z" },
        ]);
    });

    it("is empty while the registry has not loaded yet", () => {
        expect(registeredProjects(undefined)).toEqual([]);
    });
});

describe("codeBodyPhase", () => {
    const alpha = { name: "alpha", path: "C:\\repos\\alpha" };
    const idx = (isRepo: boolean) => ({ paths: [], ignored: [], isRepo, truncated: false });
    const base = { registry, project: alpha, stored: null, index: idx(true), indexError: null };

    it("is loading while a stored project is about to be restored, not no-project", () => {
        expect(codeBodyPhase({ ...base, project: null, stored: alpha })).toBe("loading");
    });
    it("is no-project when nothing restorable was stored", () => {
        expect(codeBodyPhase({ ...base, project: null })).toBe("no-project");
        expect(codeBodyPhase({ ...base, project: null, stored: { name: "gone", path: "/gone" } })).toBe("no-project");
    });
    it("is loading while the file list has not arrived", () => {
        expect(codeBodyPhase({ ...base, index: null })).toBe("loading");
    });
    it("keeps the existing branches", () => {
        expect(codeBodyPhase({ ...base, registry: {} })).toBe("no-projects");
        expect(codeBodyPhase({ ...base, index: null, indexError: "boom" })).toBe("error");
        expect(codeBodyPhase({ ...base, index: idx(false) })).toBe("not-repo");
        expect(codeBodyPhase(base)).toBe("ready");
    });
});
