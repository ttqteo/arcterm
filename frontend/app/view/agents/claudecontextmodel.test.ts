// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { contextFileKind, contextGroups, contextProject, contextSelection } from "./claudecontextmodel";

const f = (group: string, label: string, extra: Partial<ClaudeContextFile> = {}): ClaudeContextFile => ({
    group,
    label,
    path: `/p/${label}`,
    exists: true,
    ...extra,
});

describe("contextGroups", () => {
    it("lists the six groups in order, empty ones with no sections", () => {
        const groups = contextGroups([f("instructions", "CLAUDE.md")]);
        expect(groups.map((g) => g.key)).toEqual(["instructions", "memory", "settings", "skills", "setup", "global"]);
        expect(groups[1].sections).toEqual([]);
    });

    it("keeps the backend's order outside memory and counts only files that exist", () => {
        const groups = contextGroups([
            f("settings", ".claude/settings.json"),
            f("settings", ".claude/settings.local.json", { exists: false }),
            f("settings", ".mcp.json"),
        ]);
        const settings = groups.find((g) => g.key === "settings")!;
        expect(settings.sections[0].rows.map((r) => r.label)).toEqual([
            ".claude/settings.json",
            ".claude/settings.local.json",
            ".mcp.json",
        ]);
        expect(settings.count).toBe(2);
    });

    it("puts MEMORY.md first, then memory by type in a fixed order, untyped last", () => {
        const groups = contextGroups([
            f("memory", "z.md", { note: "user" }),
            f("memory", "b.md", { note: "feedback" }),
            f("memory", "MEMORY.md", { note: "index" }),
            f("memory", "a.md", { note: "feedback" }),
            f("memory", "odd.md"),
        ]);
        const memory = groups.find((g) => g.key === "memory")!;
        expect(memory.sections.map((s) => [s.head, s.rows.map((r) => r.label)])).toEqual([
            [null, ["MEMORY.md"]],
            ["user", ["z.md"]],
            ["feedback", ["a.md", "b.md"]],
            ["other", ["odd.md"]],
        ]);
    });
});

describe("contextProject", () => {
    const projects = [{ name: "alpha" }, { name: "beta" }];
    it("keeps the chosen project while it is registered", () => {
        expect(contextProject(projects, "beta", "alpha")).toBe("beta");
    });
    it("falls back to the app bar's filter, then the first project", () => {
        expect(contextProject(projects, "gone", "beta")).toBe("beta");
        expect(contextProject(projects, null, "all")).toBe("alpha");
    });
    it("is null with no projects", () => {
        expect(contextProject([], null, "all")).toBeNull();
    });
});

describe("contextSelection", () => {
    const groups = contextGroups([
        f("instructions", "CLAUDE.md", { exists: false }),
        f("instructions", "AGENTS.md"),
        f("memory", "MEMORY.md", { note: "index" }),
    ]);
    it("keeps a selection that is still listed", () => {
        expect(contextSelection(groups, "/p/MEMORY.md")).toBe("/p/MEMORY.md");
    });
    it("falls back to the first file that exists", () => {
        expect(contextSelection(groups, "/p/gone.md")).toBe("/p/AGENTS.md");
        expect(contextSelection(groups, null)).toBe("/p/AGENTS.md");
    });
    it("never selects a missing file", () => {
        expect(contextSelection(groups, "/p/CLAUDE.md")).toBe("/p/AGENTS.md");
    });
});

describe("contextFileKind", () => {
    it("reads markdown, JSON, and the rest as text", () => {
        expect(contextFileKind("C:\\p\\CLAUDE.MD")).toBe("markdown");
        expect(contextFileKind("/p/.mcp.json")).toBe("json");
        expect(contextFileKind("/p/.arc/setup")).toBe("text");
    });
});
