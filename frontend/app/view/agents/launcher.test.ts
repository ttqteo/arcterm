// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentRuntime,
    draftShown,
    filterProjects,
    footerLine,
    launcherKey,
    launcherTitle,
    primaryLabel,
    projectAfterFilter,
    selectedProject,
    selectedRowId,
    startRows,
    stepIndex,
    type LauncherKeyCtx,
} from "./launcher";

const claudeOnly = [
    { runtime: "claude", installed: true },
    { runtime: "codex", installed: false },
    { runtime: "opencode", installed: false },
    { runtime: "pi", installed: false },
];
const allFive = ["claude", "codex", "opencode", "pi", "agy"].map((runtime) => ({ runtime, installed: true }));

describe("startRows", () => {
    it("numbers the visible rows: Claude Code, Terminal, Quick run, Orchestrate", () => {
        expect(startRows(claudeOnly).map((r) => `${r.key} ${r.id}`)).toEqual([
            "1 claude",
            "2 terminal",
            "3 quick",
            "4 orchestrator",
        ]);
    });
    it("numbers 1 to 8 with every runtime installed", () => {
        const rows = startRows(allFive);
        expect(rows.map((r) => r.id)).toEqual([
            "claude",
            "codex",
            "opencode",
            "pi",
            "agy",
            "terminal",
            "quick",
            "orchestrator",
        ]);
        expect(rows.at(-1)?.key).toBe("8");
    });
    it("offers every runtime while the harness list has not loaded", () => {
        expect(startRows([])).toHaveLength(8);
    });
    it("gives run rows their names and shape descriptions, agent rows no description", () => {
        const rows = startRows(claudeOnly);
        expect(rows.filter((r) => r.kind === "run").map((r) => r.name)).toEqual(["Quick run", "Orchestrate"]);
        expect(rows.find((r) => r.id === "quick")?.desc).toBe("one worker, one goal");
        expect(rows.find((r) => r.id === "orchestrator")?.desc).toBe("lead plans, workers fan out");
        expect(rows.find((r) => r.id === "claude")?.desc).toBeNull();
    });
});

describe("agentRuntime", () => {
    it("keeps the remembered runtime while it is offered", () => {
        expect(agentRuntime(startRows(claudeOnly), "terminal")).toBe("terminal");
    });
    it("falls back to the first agent row when the remembered one is not installed", () => {
        expect(agentRuntime(startRows(claudeOnly), "codex")).toBe("claude");
    });
    it("falls back to the first agent row when nothing is remembered", () => {
        expect(agentRuntime(startRows(claudeOnly), null)).toBe("claude");
    });
});

describe("the words for a pick", () => {
    it("an agent pick selects its runtime row, a run pick the shape's row", () => {
        expect(selectedRowId("agent", "terminal", "orchestrator")).toBe("terminal");
        expect(selectedRowId("run", "terminal", "orchestrator")).toBe("orchestrator");
    });
    it("titles and primary labels follow the pick", () => {
        expect(launcherTitle("agent")).toBe("New agent");
        expect(launcherTitle("run")).toBe("New run");
        expect(primaryLabel("agent", "claude")).toBe("Launch agent");
        expect(primaryLabel("agent", "terminal")).toBe("Open terminal");
        expect(primaryLabel("run", "claude")).toBe("Start run");
    });
});

describe("footerLine", () => {
    const project = { name: "arcterm", path: "/Users/me/arcterm" };
    const base = {
        kind: "agent" as const,
        shape: "quick" as const,
        parallelism: 3,
        project,
        branchNote: "on main",
        blocker: null,
    };
    it("says where an agent starts and on which branch", () => {
        expect(footerLine(base)).toEqual({
            lead: "Starts in ",
            strong: "/Users/me/arcterm",
            tail: " · on main",
            blocked: false,
        });
    });
    it("drops the branch part when the branch is unknown", () => {
        expect(footerLine({ ...base, branchNote: "" }).tail).toBe("");
    });
    it("asks for a project before anything else", () => {
        expect(footerLine({ ...base, project: null })).toEqual({
            lead: "Pick a project",
            strong: "",
            tail: "",
            blocked: true,
        });
    });
    it("shows a run's blocker in place of the summary", () => {
        expect(footerLine({ ...base, kind: "run", blocker: "Write the goal" })).toEqual({
            lead: "Write the goal",
            strong: "",
            tail: "",
            blocked: true,
        });
    });
    it("summarises a quick run and an orchestrator run", () => {
        expect(footerLine({ ...base, kind: "run" })).toEqual({
            lead: "Quick run in ",
            strong: "arcterm",
            tail: "",
            blocked: false,
        });
        expect(footerLine({ ...base, kind: "run", shape: "orchestrator" }).lead).toBe("Orchestrator × 3 in ");
    });
});

describe("the project filter", () => {
    const rows = [{ name: "arcterm" }, { name: "thesis" }, { name: "oki_backend" }, { name: "oki_backend_vip" }];
    it("narrows by a case-insensitive substring of the name", () => {
        expect(filterProjects(rows, "OKI").map((r) => r.name)).toEqual(["oki_backend", "oki_backend_vip"]);
    });
    it("is no filter when blank", () => {
        expect(filterProjects(rows, "  ")).toBe(rows);
    });
    it("keeps the selection while it still matches, else moves to the first match", () => {
        const matches = filterProjects(rows, "oki");
        expect(projectAfterFilter(matches, "oki_backend_vip")).toBe("oki_backend_vip");
        expect(projectAfterFilter(matches, "arcterm")).toBe("oki_backend");
    });
    it("keeps the selection when nothing matches, so clearing the filter finds it where it was", () => {
        expect(projectAfterFilter([], "arcterm")).toBe("arcterm");
    });
    it("selects the picked project, else the first, and nothing with no projects", () => {
        expect(selectedProject(rows, "thesis")?.name).toBe("thesis");
        expect(selectedProject(rows, "")?.name).toBe("arcterm");
        expect(selectedProject(rows, "unregistered")?.name).toBe("arcterm");
        expect(selectedProject([], "")).toBeNull();
    });
});

describe("stepIndex", () => {
    it("wraps both ways", () => {
        expect(stepIndex(4, 3, 1)).toBe(0);
        expect(stepIndex(4, 0, -1)).toBe(3);
    });
    it("starts at the end it heads toward when nothing is selected", () => {
        expect(stepIndex(4, -1, 1)).toBe(0);
        expect(stepIndex(4, -1, -1)).toBe(3);
    });
    it("is -1 for an empty list", () => {
        expect(stepIndex(0, -1, 1)).toBe(-1);
    });
});

describe("draftShown", () => {
    const empty = { task: "", goal: "", planPath: "", prototype: "" };
    it("a kept task, goal, plan path or prototype is a draft, whichever pick opens", () => {
        expect(draftShown({ ...empty, task: "fix it" })).toBe(true);
        expect(draftShown({ ...empty, goal: "fix it" })).toBe(true);
        expect(draftShown({ ...empty, planPath: "/p/plan.md" })).toBe(true);
        expect(draftShown({ ...empty, prototype: "/c/Main.dc.html" })).toBe(true);
    });
    it("nothing kept, or only whitespace, is no draft", () => {
        expect(draftShown(empty)).toBe(false);
        expect(draftShown({ ...empty, task: "  \n" })).toBe(false);
    });
});

describe("launcherKey", () => {
    const at = (
        zone: LauncherKeyCtx["zone"],
        filter = "",
        open: { flagMenuOpen?: boolean; branchListOpen?: boolean } = {}
    ): LauncherKeyCtx => ({
        zone,
        startCount: 4,
        projectCount: 2,
        filter,
        flagMenuOpen: !!open.flagMenuOpen,
        branchListOpen: !!open.branchListOpen,
    });
    const key = (k: string, extra: { shift?: boolean; mod?: boolean } = {}) => ({
        key: k,
        shift: !!extra.shift,
        mod: !!extra.mod,
    });

    it("a digit picks the nth row of the focused column", () => {
        expect(launcherKey(at("start"), key("3"))).toEqual({ kind: "pick-start", index: 2 });
        expect(launcherKey(at("project"), key("2"))).toEqual({ kind: "pick-project", index: 1 });
    });
    it("a digit past the last row does nothing", () => {
        expect(launcherKey(at("start"), key("5"))).toEqual({ kind: "none" });
        expect(launcherKey(at("project"), key("3"))).toEqual({ kind: "none" });
    });
    it("digits type in a text field", () => {
        expect(launcherKey(at("textarea"), key("3"))).toEqual({ kind: "none" });
        expect(launcherKey(at("input"), key("3"))).toEqual({ kind: "none" });
    });
    it("arrows move in either column and nowhere else", () => {
        expect(launcherKey(at("start"), key("ArrowDown"))).toEqual({ kind: "move", column: "start", delta: 1 });
        expect(launcherKey(at("project"), key("ArrowUp"))).toEqual({ kind: "move", column: "project", delta: -1 });
        expect(launcherKey(at("textarea"), key("ArrowDown"))).toEqual({ kind: "none" });
    });
    it("letters filter the Project column, and only there", () => {
        expect(launcherKey(at("project", "ok"), key("i"))).toEqual({ kind: "filter", next: "oki" });
        expect(launcherKey(at("project"), key("-"))).toEqual({ kind: "filter", next: "-" });
        expect(launcherKey(at("start"), key("i"))).toEqual({ kind: "none" });
    });
    it("Backspace shortens the filter and does nothing on an empty one", () => {
        expect(launcherKey(at("project", "oki"), key("Backspace"))).toEqual({ kind: "filter", next: "ok" });
        expect(launcherKey(at("project"), key("Backspace"))).toEqual({ kind: "none" });
    });
    it("Enter launches from a column or a one-line field, not from a textarea or a button", () => {
        expect(launcherKey(at("start"), key("Enter"))).toEqual({ kind: "launch" });
        expect(launcherKey(at("project"), key("Enter"))).toEqual({ kind: "launch" });
        expect(launcherKey(at("input"), key("Enter"))).toEqual({ kind: "launch" });
        expect(launcherKey(at("textarea"), key("Enter"))).toEqual({ kind: "none" });
        expect(launcherKey(at("other"), key("Enter"))).toEqual({ kind: "none" });
    });
    it("Tab is no action: the dialog's focus trap takes it before asking", () => {
        expect(launcherKey(at("textarea"), key("Tab"))).toEqual({ kind: "none" });
        expect(launcherKey(at("project", "ok"), key("Tab", { shift: true }))).toEqual({ kind: "none" });
    });
    it("Escape with the flag menu open closes the menu wherever focus is", () => {
        // the menu opens from the Command row while focus stays in the Task box
        expect(launcherKey(at("textarea", "", { flagMenuOpen: true }), key("Escape"))).toEqual({
            kind: "dismiss-inner",
            what: "flags",
        });
        expect(launcherKey(at("start", "", { flagMenuOpen: true }), key("Escape"))).toEqual({
            kind: "dismiss-inner",
            what: "flags",
        });
    });
    it("Escape closes the innermost open thing: flag menu, branch list, filter, then the dialog", () => {
        const both = { flagMenuOpen: true, branchListOpen: true };
        expect(launcherKey(at("input", "", both), key("Escape"))).toEqual({ kind: "dismiss-inner", what: "flags" });
        expect(launcherKey(at("other", "", { branchListOpen: true }), key("Escape"))).toEqual({
            kind: "dismiss-inner",
            what: "branches",
        });
        expect(launcherKey(at("project", "oki"), key("Escape"))).toEqual({ kind: "dismiss-inner", what: "filter" });
        expect(launcherKey(at("project"), key("Escape"))).toEqual({ kind: "close" });
        expect(launcherKey(at("textarea"), key("Escape"))).toEqual({ kind: "close" });
        expect(launcherKey(at("other"), key("Escape"))).toEqual({ kind: "close" });
    });
    it("leaves modified keys alone: Mod+Enter is the dialog's submit, Mod+digit and Mod+Tab are not picks", () => {
        expect(launcherKey(at("start"), key("Enter", { mod: true }))).toEqual({ kind: "none" });
        expect(launcherKey(at("start"), key("1", { mod: true }))).toEqual({ kind: "none" });
        expect(launcherKey(at("start"), key("Tab", { mod: true }))).toEqual({ kind: "none" });
    });
});
