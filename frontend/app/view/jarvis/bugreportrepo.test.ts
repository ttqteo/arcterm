// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { newRepoProjectName, projectAtPath, repoBaseName } from "./bugreportrepo";

describe("projectAtPath", () => {
    const registry = { arcterm: { path: "D:/work/arcterm" }, other: { path: "D:/work/other" }, bare: {} };

    it("finds the project registered at the folder, across slash styles, a trailing slash and case", () => {
        expect(projectAtPath(registry, "D:/work/arcterm")).toBe("arcterm");
        expect(projectAtPath(registry, "D:\\work\\arcterm\\")).toBe("arcterm");
        expect(projectAtPath(registry, "d:\\Work\\Arcterm")).toBe("arcterm");
    });

    it("finds nothing for an unregistered folder, an empty path or no registry", () => {
        expect(projectAtPath(registry, "D:/work/arcterm-fork")).toBeUndefined();
        expect(projectAtPath(registry, "")).toBeUndefined();
        expect(projectAtPath(null, "D:/work/arcterm")).toBeUndefined();
        expect(projectAtPath(undefined, "D:/work/arcterm")).toBeUndefined();
    });
});

describe("repoBaseName", () => {
    it("is the folder's own name", () => {
        expect(repoBaseName("D:\\work\\arcterm")).toBe("arcterm");
        expect(repoBaseName("/Users/me/code/arcterm/")).toBe("arcterm");
        expect(repoBaseName("arcterm")).toBe("arcterm");
    });

    it("falls back to arcterm for a path with no segment", () => {
        expect(repoBaseName("")).toBe("arcterm");
        expect(repoBaseName("/")).toBe("arcterm");
    });
});

describe("newRepoProjectName", () => {
    it("names the project after the folder", () => {
        expect(newRepoProjectName({}, "D:/work/arcterm")).toBe("arcterm");
    });

    // CreateProjectCommand treats a name that exists as an update that moves the project: a taken name gets -2, -3…
    it("takes the first free suffix when another path already holds the name", () => {
        const registry = { arcterm: { path: "D:/old/arcterm" }, "arcterm-2": { path: "D:/older/arcterm" } };
        expect(newRepoProjectName(registry, "D:/work/arcterm")).toBe("arcterm-3");
        expect(newRepoProjectName({ ARCTERM: { path: "D:/old/arcterm" } }, "D:/work/arcterm")).toBe("arcterm-2");
    });
});
