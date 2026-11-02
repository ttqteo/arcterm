// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    filterProjects,
    moveCursor,
    onDiskProjects,
    projectPathKey,
    searchPath,
    uniqueProjectName,
    unregisteredProjects,
} from "./newprojectmodel";

const p = (name: string, path: string): ClaudeProjectData => ({ name, path, lastactivets: 0, sessions: 1 });

describe("unregisteredProjects", () => {
    it("drops folders already registered, however the path is spelled", () => {
        const scanned = [p("arcterm", "D:\\projects\\arcterm"), p("website", "d:\\Workspace\\website")];
        const got = unregisteredProjects(scanned, [{ path: "d:/projects/arcterm/" }]);
        expect(got.map((x) => x.name)).toEqual(["website"]);
    });
});

describe("onDiskProjects", () => {
    const d = (name: string, path: string): ProjectFolderData => ({ name, path, kind: "git", modts: 0 });
    const found = [
        d("oki_backend", "/ws/vcyber/oki_backend"),
        d("oki_backend_vip", "/ws/vcyber/oki_backend_vip"),
        d("oki_admin", "/ws/vcyber/oki_admin"),
        d("lingua", "/ws/dev/lingua"),
    ];

    it("shows nothing until the person types", () => {
        expect(onDiskProjects(found, [], [], " ")).toEqual([]);
    });

    it("matches the name or the path, leaving out what Claude Code lists and what is registered", () => {
        const claude = [p("oki_backend", "/ws/vcyber/oki_backend/")];
        const got = onDiskProjects(found, claude, [{ path: "/WS/vcyber/oki_admin" }], "OKI");
        expect(got.map((x) => x.name)).toEqual(["oki_backend_vip"]);
        expect(onDiskProjects(found, [], [], "dev/").map((x) => x.name)).toEqual(["lingua"]);
    });

    it("does not match the home folder's own name", () => {
        expect(onDiskProjects(found, [], [], "ws", "/ws")).toEqual([]);
        expect(onDiskProjects(found, [], [], "~/dev", "/ws").map((x) => x.name)).toEqual(["lingua"]);
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

    const home = "/Users/someone";
    const mac = [
        p("cuscofi-app", "/Users/someone/Workspaces/freelancer/cuscofi/cuscofi-app"),
        p("arcterm", "/Users/someone/Workspaces/dev/arcterm"),
        p("cuscofi", "/Users/someone/Workspaces/dev/cuscofi"),
    ];

    it("reads the path from ~, so the user's own name matches nothing", () => {
        expect(filterProjects(mac, "someone", home)).toEqual([]);
        expect(filterProjects(mac, "~/workspaces/dev", home).map((x) => x.name)).toEqual(["arcterm", "cuscofi"]);
        expect(filterProjects(mac, "/Users/someone/Workspaces/dev/arc", home).map((x) => x.name)).toEqual(["arcterm"]);
    });

    it("lists the name matches before the path-only ones", () => {
        const list = [p("app", "/Users/someone/w/cuscofi/app"), ...mac];
        expect(filterProjects(list, "cuscofi", home).map((x) => x.name)).toEqual(["cuscofi-app", "cuscofi", "app"]);
    });

    it("reads a Windows path from ~ whatever its separators and case", () => {
        const win = [p("arcterm", "C:\\Users\\Quang\\projects\\arcterm")];
        expect(filterProjects(win, "quang", "c:/users/quang/")).toEqual([]);
        expect(filterProjects(win, "projects\\arc", "c:/users/quang/")).toHaveLength(1);
    });
});

describe("searchPath", () => {
    it("starts a path under home at ~ and leaves the rest alone", () => {
        expect(searchPath("/Users/someone/ws/a", "/Users/someone")).toBe("~/ws/a");
        expect(searchPath("/Users/someone", "/Users/someone/")).toBe("~");
        expect(searchPath("/Users/someone2/a", "/Users/someone")).toBe("/users/someone2/a");
        expect(searchPath("/opt/x", "")).toBe("/opt/x");
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
