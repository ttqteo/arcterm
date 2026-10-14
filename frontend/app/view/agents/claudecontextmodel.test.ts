// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    contextActions,
    contextFileKind,
    contextGroups,
    contextProject,
    contextSelection,
    correctionLine,
    correctTarget,
    memoryAfterRemoval,
} from "./claudecontextmodel";

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

describe("contextActions", () => {
    const row = (group: string, label: string, exists = true) =>
        ({ group, label, path: `/m/${label}`, exists }) as ClaudeContextFile;

    it("offers Correct and Delete on a memory file", () => {
        expect(contextActions(row("memory", "feedback_x.md"))).toEqual({ correct: true, remove: true });
    });
    it("offers Correct but not Delete on the index", () => {
        expect(contextActions(row("memory", "MEMORY.md"))).toEqual({ correct: true, remove: false });
    });
    it("offers nothing outside memory, or on a file that is gone", () => {
        expect(contextActions(row("instructions", "CLAUDE.md"))).toEqual({ correct: false, remove: false });
        expect(contextActions(row("global", "~/.claude/CLAUDE.md"))).toEqual({ correct: false, remove: false });
        expect(contextActions(row("memory", "gone.md", false))).toEqual({ correct: false, remove: false });
    });
});

describe("correctionLine", () => {
    it("names the file by its full path and keeps the note on one line", () => {
        expect(correctionLine("/h/.claude/projects/p/memory/a.md", "  the date is wrong,\n it was 10-14  ")).toBe(
            "fix your memory /h/.claude/projects/p/memory/a.md — the date is wrong, it was 10-14"
        );
    });
    it("is blank when nothing is typed", () => {
        expect(correctionLine("/m/a.md", " \n ")).toBe("");
    });
});

describe("correctTarget", () => {
    const claude = (name: string) => ({ name, agent: "claude" });
    it("sends straight to the project's one Claude agent", () => {
        expect(correctTarget([claude("loom"), { name: "kite", agent: "pi" }])).toEqual({
            kind: "agent",
            agent: claude("loom"),
        });
    });
    it("offers a menu when there are several, and the clipboard when there are none", () => {
        expect(correctTarget([claude("a"), claude("b")])).toEqual({ kind: "menu", agents: [claude("a"), claude("b")] });
        expect(correctTarget([{ name: "kite", agent: "pi" }])).toEqual({ kind: "copy" });
        expect(correctTarget([])).toEqual({ kind: "copy" });
    });
});

describe("memoryAfterRemoval", () => {
    const mem = (label: string, note: string) =>
        ({ group: "memory", label, path: `/m/${label}`, exists: true, note }) as ClaudeContextFile;
    const groups = contextGroups([mem("MEMORY.md", "index"), mem("a.md", "feedback"), mem("b.md", "feedback")]);

    it("moves on to the next memory, else the one before", () => {
        expect(memoryAfterRemoval(groups, "/m/a.md")).toBe("/m/b.md");
        expect(memoryAfterRemoval(groups, "/m/b.md")).toBe("/m/a.md");
    });
    it("is null for a path the group does not list", () => {
        expect(memoryAfterRemoval(groups, "/m/zzz.md")).toBeNull();
    });
});
