// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { filterProjects, moveCursor, projectPathKey, uniqueProjectName, unregisteredProjects } from "./newprojectmodel";

const p = (name: string, path: string): ClaudeProjectData => ({ name, path, lastactivets: 0, sessions: 1 });

describe("unregisteredProjects", () => {
    it("drops folders already registered, however the path is spelled", () => {
        const scanned = [p("arcterm", "D:\\projects\\arcterm"), p("website", "d:\\Workspace\\website")];
        const got = unregisteredProjects(scanned, [{ path: "d:/projects/arcterm/" }]);
        expect(got.map((x) => x.name)).toEqual(["website"]);
    });
});

describe("projectPathKey", () => {
    it("ignores separators, a trailing slash and case", () => {
        expect(projectPathKey("D:\\a\\B\\")).toBe(projectPathKey("d:/a/b"));
    });
});

describe("filterProjects", () => {
    const list = [p("arcterm", "D:\\projects\\arcterm"), p("website", "D:\\Workspace\\SIEM\\apps\\website")];

    it("keeps everything for an empty query", () => {
        expect(filterProjects(list, "  ")).toHaveLength(2);
    });

    it("matches the name or the path, ignoring case", () => {
        expect(filterProjects(list, "ARC").map((x) => x.name)).toEqual(["arcterm"]);
        expect(filterProjects(list, "siem").map((x) => x.name)).toEqual(["website"]);
    });
});

describe("uniqueProjectName", () => {
    it("keeps a free name", () => {
        expect(uniqueProjectName("website", ["arcterm"])).toBe("website");
    });

    it("suffixes a taken name with the first free number, ignoring case", () => {
        expect(uniqueProjectName("website", ["Website", "website-2"])).toBe("website-3");
    });
});

describe("moveCursor", () => {
    it("clamps to the list", () => {
        expect(moveCursor(0, -1, 3)).toBe(0);
        expect(moveCursor(2, 1, 3)).toBe(2);
        expect(moveCursor(-1, 1, 3)).toBe(0);
        expect(moveCursor(0, 1, 0)).toBe(-1);
    });
});
