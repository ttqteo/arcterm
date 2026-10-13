// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentRuntime,
    draftShown,
    filterProjects,
    focusLaunchProject,
    footerLine,
    HOME_NAME,
    HOME_PICK,
    homeOffered,
    launcherKey,
    launcherTitle,
    letterHint,
    pickedTool,
    primaryLabel,
    projectAfterFilter,
    projectColumnPicks,
    selectedProject,
    selectedRowId,
    startRows,
    stepIndex,
    toolAboutLine,
    toolBlocker,
    toolFolder,
    toolRowNote,
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
    it("numbers the visible rows: Claude Code, Terminal, Quick run, Orchestrate, Tool", () => {
        expect(startRows(claudeOnly).map((r) => `${r.key} ${r.id}`)).toEqual([
            "1 claude",
            "2 terminal",
            "3 quick",
            "4 orchestrator",
            "5 tool",
        ]);
    });
    it("numbers 1 to 9 with every runtime installed", () => {
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
            "tool",
        ]);
        expect(rows.at(-1)?.key).toBe("9");
    });
    it("offers every runtime while the harness list has not loaded", () => {
        expect(startRows([])).toHaveLength(9);
    });
    it("gives run rows their names and shape descriptions, agent rows no description", () => {
        const rows = startRows(claudeOnly);
        expect(rows.filter((r) => r.kind === "run").map((r) => r.name)).toEqual(["Quick run", "Orchestrate"]);
        expect(rows.find((r) => r.id === "quick")?.desc).toBe("one worker, one goal");
        expect(rows.find((r) => r.id === "orchestrator")?.desc).toBe("lead plans, workers fan out");
        expect(rows.find((r) => r.id === "claude")?.desc).toBeNull();
    });
    it("ends with one Tool row after the run rows, so no earlier row changes its digit", () => {
        const rows = startRows(claudeOnly);
        expect(rows.filter((r) => r.kind === "tool")).toEqual([
            { id: "tool", kind: "tool", name: "Tool", desc: "lazygit, yazi, btop…", key: "5" },
        ]);
        expect(rows.at(-1)?.kind).toBe("tool");
        expect(rows.slice(0, -1).map((r) => r.key)).toEqual(["1", "2", "3", "4"]);
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
    it("an agent pick selects its runtime row, a run pick the shape's row, a tool pick the Tool row", () => {
        expect(selectedRowId("agent", "terminal", "orchestrator")).toBe("terminal");
        expect(selectedRowId("run", "terminal", "orchestrator")).toBe("orchestrator");
        expect(selectedRowId("tool", "terminal", "orchestrator")).toBe("tool");
    });
    it("titles and primary labels follow the pick", () => {
        expect(launcherTitle("agent")).toBe("New agent");
        expect(launcherTitle("run")).toBe("New run");
        expect(launcherTitle("tool")).toBe("Open a tool");
        expect(primaryLabel("agent", "claude")).toBe("Launch agent");
        expect(primaryLabel("agent", "terminal")).toBe("Open terminal");
        expect(primaryLabel("run", "claude")).toBe("Start run");
    });
    it("primaryLabel says Resume agent for an agent with a session picked", () => {
        expect(primaryLabel("agent", "claude", true)).toBe("Resume agent");
        expect(primaryLabel("agent", "claude", false)).toBe("Launch agent");
        expect(primaryLabel("run", "claude", true)).toBe("Start run");
    });
    it("primaryLabel names the picked tool, and a session is no part of it", () => {
        expect(primaryLabel("tool", "claude", false, "lazygit")).toBe("Open lazygit");
        expect(primaryLabel("tool", "claude", true, "PR dashboard")).toBe("Open PR dashboard");
        expect(primaryLabel("tool", "claude", false, "")).toBe("Open a tool");
    });
    it("the letter hint names what a letter does in the pick", () => {
        expect(letterHint("agent")).toBe("task");
        expect(letterHint("run")).toBe("goal");
        expect(letterHint("tool")).toBe("tool");
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
    it("says which session a resume picks up, and on which branch", () => {
        expect(footerLine({ ...base, resume: { title: "fix the build", branch: "main" } })).toEqual({
            lead: "Resumes ",
            strong: "fix the build",
            tail: " · main",
            blocked: false,
        });
        expect(footerLine({ ...base, resume: { title: "fix the build", branch: "" } }).tail).toBe("");
    });
    it("a resume does not hide a missing project", () => {
        expect(footerLine({ ...base, project: null, resume: { title: "x", branch: "" } }).blocked).toBe(true);
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
    it("says where a tool opens and on which branch", () => {
        expect(footerLine({ ...base, kind: "tool" })).toEqual({
            lead: "Opens in ",
            strong: "/Users/me/arcterm",
            tail: " · on main",
            blocked: false,
        });
        expect(footerLine({ ...base, kind: "tool", branchNote: "" }).tail).toBe("");
    });
    it("a tool with no project, or one that cannot open, says so instead", () => {
        expect(footerLine({ ...base, kind: "tool", project: null })).toEqual({
            lead: "Pick a project",
            strong: "",
            tail: "",
            blocked: true,
        });
        expect(footerLine({ ...base, kind: "tool", blocker: "lazydocker is not on PATH" })).toEqual({
            lead: "lazydocker is not on PATH",
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

describe("Home", () => {
    it("is offered to Claude Code and Terminal agents once the home folder is known", () => {
        expect(homeOffered("agent", "claude", "/Users/me")).toBe(true);
        expect(homeOffered("agent", "terminal", "/Users/me")).toBe(true);
        expect(homeOffered("agent", "codex", "/Users/me")).toBe(false);
        expect(homeOffered("run", "claude", "/Users/me")).toBe(false);
        expect(homeOffered("agent", "claude", "")).toBe(false);
    });

    it("is offered to every tool, whichever agent row was picked last, once the home folder is known", () => {
        expect(homeOffered("tool", "codex", "/Users/me")).toBe(true);
        expect(homeOffered("tool", "claude", "")).toBe(false);
    });

    it("sits after the projects and is filtered by its name", () => {
        const rows = [{ name: "arcterm" }, { name: "thesis" }];
        expect(projectColumnPicks(rows, true, "")).toEqual(["arcterm", "thesis", HOME_PICK]);
        expect(projectColumnPicks(rows, false, "")).toEqual(["arcterm", "thesis"]);
        expect(projectColumnPicks([], true, "HO")).toEqual([HOME_PICK]);
        expect(projectColumnPicks([{ name: "thesis" }], true, "the")).toEqual(["thesis"]);
    });

    it("is never the fallback pick", () => {
        const rows = [{ name: "arcterm" }];
        expect(selectedProject(rows, HOME_PICK)).toEqual({ name: "arcterm" });
        expect(selectedProject([], HOME_PICK)).toBeNull();
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
    const empty = { task: "", goal: "", planPath: "", prototype: "", images: 0 };
    it("a kept task, goal, plan path or prototype is a draft, whichever pick opens", () => {
        expect(draftShown({ ...empty, task: "fix it" })).toBe(true);
        expect(draftShown({ ...empty, goal: "fix it" })).toBe(true);
        expect(draftShown({ ...empty, planPath: "/p/plan.md" })).toBe(true);
        expect(draftShown({ ...empty, prototype: "/c/Main.dc.html" })).toBe(true);
    });
    it("draftShown counts images", () => {
        expect(draftShown({ ...empty, images: 1 })).toBe(true);
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
        open: { flagMenuOpen?: boolean; branchListOpen?: boolean; resumePicked?: boolean } = {}
    ): LauncherKeyCtx => ({
        zone,
        startCount: 4,
        projectCount: 2,
        toolCount: 3,
        filter,
        flagMenuOpen: !!open.flagMenuOpen,
        branchListOpen: !!open.branchListOpen,
        resumePicked: !!open.resumePicked,
        textField: true,
    });
    const key = (k: string, extra: { shift?: boolean; mod?: boolean; paste?: boolean } = {}) => ({
        key: k,
        shift: !!extra.shift,
        mod: !!extra.mod,
        paste: !!extra.paste,
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
    it("→ goes from Start to Project and ← comes back; neither leaves the pair", () => {
        expect(launcherKey(at("start"), key("ArrowRight"))).toEqual({ kind: "column", to: "project" });
        expect(launcherKey(at("project", "ok"), key("ArrowLeft"))).toEqual({ kind: "column", to: "start" });
        expect(launcherKey(at("start"), key("ArrowLeft"))).toEqual({ kind: "none" });
        expect(launcherKey(at("project"), key("ArrowRight"))).toEqual({ kind: "none" });
        expect(launcherKey(at("input"), key("ArrowLeft"))).toEqual({ kind: "none" });
    });
    it("letters filter the Project column", () => {
        expect(launcherKey(at("project", "ok"), key("i"))).toEqual({ kind: "filter", next: "oki" });
        expect(launcherKey(at("project"), key("-"))).toEqual({ kind: "filter", next: "-" });
        expect(launcherKey(at("start"), key("i"))).toEqual({ kind: "write" });
    });
    it("a letter in the Start column writes into the pick's Task or Goal box, when it has one", () => {
        expect(launcherKey(at("start"), key("F", { shift: true }))).toEqual({ kind: "write" });
        expect(launcherKey(at("start"), key("-"))).toEqual({ kind: "write" });
        expect(launcherKey({ ...at("start"), textField: false }, key("f"))).toEqual({ kind: "none" });
        // a space starts no task; a key held with Cmd, Ctrl or Alt, a named key, or an IME's key is not a letter
        expect(launcherKey(at("start"), key(" "))).toEqual({ kind: "none" });
        expect(launcherKey(at("start"), key("f", { mod: true }))).toEqual({ kind: "none" });
        expect(launcherKey(at("start"), key("Process"))).toEqual({ kind: "none" });
        expect(launcherKey(at("start"), key("Dead"))).toEqual({ kind: "none" });
        // the digits still pick
        expect(launcherKey(at("start"), key("2"))).toEqual({ kind: "pick-start", index: 1 });
    });
    it("a paste outside a text field writes into the pick's Task or Goal box", () => {
        const paste = key("v", { mod: true, paste: true });
        expect(launcherKey(at("start"), paste)).toEqual({ kind: "write" });
        expect(launcherKey(at("project", "ok"), paste)).toEqual({ kind: "write" });
        expect(launcherKey(at("resume"), paste)).toEqual({ kind: "write" });
        expect(launcherKey(at("other"), paste)).toEqual({ kind: "write" });
        // a text field takes its own paste, and a pick with no box leaves it alone
        expect(launcherKey(at("textarea"), paste)).toEqual({ kind: "none" });
        expect(launcherKey(at("input"), paste)).toEqual({ kind: "none" });
        expect(launcherKey({ ...at("start"), textField: false }, paste)).toEqual({ kind: "none" });
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
    it("Enter in the resume zone launches", () => {
        expect(launcherKey(at("resume"), key("Enter"))).toEqual({ kind: "launch" });
        // the list handles its own arrows; the dialog's column navigation must not see them
        expect(launcherKey(at("resume"), key("ArrowDown"))).toEqual({ kind: "none" });
        expect(launcherKey(at("resume"), key("ArrowUp"))).toEqual({ kind: "none" });
        expect(launcherKey(at("resume"), key("3"))).toEqual({ kind: "none" });
    });
    it("Shift+Enter on a picked session takes the footer's second button (Open asleep, or Transcript) instead of resuming it", () => {
        const picked = at("resume", "", { resumePicked: true });
        expect(launcherKey(picked, key("Enter", { shift: true }))).toEqual({ kind: "resume-secondary" });
        expect(launcherKey(picked, key("Enter"))).toEqual({ kind: "launch" });
        // the New session row has no session to open asleep or read
        expect(launcherKey(at("resume"), key("Enter", { shift: true }))).toEqual({ kind: "launch" });
        // wherever Enter launches, as the footer's second button says; the Task box keeps it as its newline
        expect(launcherKey(at("project", "", { resumePicked: true }), key("Enter", { shift: true }))).toEqual({
            kind: "resume-secondary",
        });
        expect(launcherKey(at("start", "", { resumePicked: true }), key("Enter", { shift: true }))).toEqual({
            kind: "resume-secondary",
        });
        expect(launcherKey(at("textarea", "", { resumePicked: true }), key("Enter", { shift: true }))).toEqual({
            kind: "none",
        });
    });
    it("in the Tool list a letter picks the nth tool, a for the first", () => {
        expect(launcherKey(at("tools"), key("a"))).toEqual({ kind: "pick-tool", index: 0 });
        expect(launcherKey(at("tools"), key("c"))).toEqual({ kind: "pick-tool", index: 2 });
        expect(launcherKey(at("tools"), key("C", { shift: true }))).toEqual({ kind: "pick-tool", index: 2 });
    });
    it("a letter past the last tool, a digit or a space does nothing in the Tool list", () => {
        expect(launcherKey(at("tools"), key("d"))).toEqual({ kind: "none" });
        expect(launcherKey(at("tools"), key("z"))).toEqual({ kind: "none" });
        expect(launcherKey(at("tools"), key("1"))).toEqual({ kind: "none" });
        expect(launcherKey(at("tools"), key(" "))).toEqual({ kind: "none" });
        expect(launcherKey(at("tools"), key("Process"))).toEqual({ kind: "none" });
        expect(launcherKey({ ...at("tools"), toolCount: 0 }, key("a"))).toEqual({ kind: "none" });
    });
    it("arrows move in the Tool list, which leaves → and ← to Tab", () => {
        expect(launcherKey(at("tools"), key("ArrowDown"))).toEqual({ kind: "move", column: "tools", delta: 1 });
        expect(launcherKey(at("tools"), key("ArrowUp"))).toEqual({ kind: "move", column: "tools", delta: -1 });
        expect(launcherKey(at("tools"), key("ArrowRight"))).toEqual({ kind: "none" });
        expect(launcherKey(at("tools"), key("ArrowLeft"))).toEqual({ kind: "none" });
    });
    it("Enter in the Tool list opens the picked tool; Escape and a modified key behave as everywhere", () => {
        expect(launcherKey(at("tools"), key("Enter"))).toEqual({ kind: "launch" });
        expect(launcherKey(at("tools"), key("Escape"))).toEqual({ kind: "close" });
        expect(launcherKey(at("tools"), key("a", { mod: true }))).toEqual({ kind: "none" });
        // a Tool pick has no Task or Goal box for a paste to land in
        expect(launcherKey({ ...at("tools"), textField: false }, key("v", { mod: true, paste: true }))).toEqual({
            kind: "none",
        });
    });
    it("a letter in the Start column still goes only to a Task or Goal box", () => {
        expect(launcherKey({ ...at("start"), textField: false }, key("a"))).toEqual({ kind: "none" });
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

describe("the Tool pick", () => {
    const tools = [{ id: "lazygit" }, { id: "yazi" }, { id: "btop" }];
    it("keeps the remembered tool while it is listed, else the first", () => {
        expect(pickedTool(tools, "yazi")?.id).toBe("yazi");
        expect(pickedTool(tools, "gone")?.id).toBe("lazygit");
        expect(pickedTool(tools, null)?.id).toBe("lazygit");
    });
    it("picks nothing from an empty list", () => {
        expect(pickedTool([], "yazi")).toBeNull();
    });

    it("opens in the picked project, or Home for a tool that lives there or when Home is picked", () => {
        const project = { name: "arcterm", path: "/Users/me/arcterm" };
        const home = { name: HOME_NAME, path: "/Users/me" };
        expect(toolFolder({ opensin: "agent" }, project, "/Users/me")).toEqual(project);
        expect(toolFolder({ opensin: "root" }, project, "/Users/me")).toEqual(project);
        expect(toolFolder({ opensin: "home" }, project, "/Users/me")).toEqual(home);
        expect(toolFolder({ opensin: "agent" }, home, "/Users/me")).toEqual(home);
    });
    it("has no folder until the project, or the home folder a home tool needs, is known", () => {
        expect(toolFolder({ opensin: "agent" }, null, "/Users/me")).toBeNull();
        expect(toolFolder({ opensin: "home" }, { name: "a", path: "/a" }, "")).toBeNull();
        expect(toolFolder(null, { name: "a", path: "/a" }, "/Users/me")).toEqual({ name: "a", path: "/a" });
    });

    it("a row's note is the category, or what is missing", () => {
        expect(toolRowNote({ category: "Git", found: true })).toBe("Git");
        expect(toolRowNote({ category: "Yours", found: true })).toBe("Yours");
        expect(toolRowNote({ category: "Containers", found: false })).toBe("not installed");
        expect(toolRowNote({ category: "Yours", found: false })).toBe("not on PATH");
    });

    it("blocks the launch while the list is unread and on a tool that is not on PATH", () => {
        expect(toolBlocker(null, "loading")).toBe("Reading the tool list…");
        expect(toolBlocker(null, "error")).toBe("Could not read the tool list");
        expect(toolBlocker(null, "ready")).toBe("No tool to open");
        expect(toolBlocker({ name: "lazygit", found: true }, "ready")).toBeNull();
        expect(toolBlocker({ name: "lazydocker", found: false }, "ready")).toBe("lazydocker is not on PATH");
    });

    it("about: where the tool runs, and what to do about one that is not on PATH", () => {
        expect(toolAboutLine({ opensin: "agent", found: true }, false)).toBe(
            "Runs in the project's root. To open it in an agent's worktree, use Tool on that agent."
        );
        expect(toolAboutLine({ opensin: "root", found: true }, false)).toBe("Runs in the project's root.");
        expect(toolAboutLine({ opensin: "home", found: true }, false)).toBe("Runs in your home folder.");
        expect(toolAboutLine({ opensin: "agent", found: true }, true)).toBe("Runs in your home folder.");
        expect(toolAboutLine({ opensin: "root", found: false }, false)).toBe(
            "Runs in the project's root. Not found on PATH: Setup → Tools can install it or fix its command."
        );
    });
});

describe("focusLaunchProject", () => {
    const names = ["arcterm", "thesis", "IT2058_EdgeAI"];
    it("starts New on the project of the agent or terminal in focus", () => {
        expect(focusLaunchProject("thesis", names)).toBe("thesis");
    });
    it("leaves the dialog's own pick when the focused one is in no registered project", () => {
        expect(focusLaunchProject("", names)).toBeNull();
        expect(focusLaunchProject("scratch", names)).toBeNull();
    });
});
