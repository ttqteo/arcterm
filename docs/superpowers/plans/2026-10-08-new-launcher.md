# New launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the New agent dialog and the New run window with one keyboard-first dialog: pick what to start from one numbered list, pick a project, fill in the details, launch; an outside click closes it and keeps the draft.

**Architecture:** Pure logic in `launcher.ts` (rows, numbering, footer words, filter, key reducer) and state in `launcherstore.ts` (jotai atoms that outlive a close). Starting a run moves into `launcherrun.ts`. A thin `launchermodal.tsx` over `ModalShell` renders two columns plus a details region that is `launcheragentfields.tsx` or `launcherrunfields.tsx`, and every opener calls `openLauncher(model, door, prefill?)`.

**Tech Stack:** React 19, jotai, Tailwind 4 (`@theme` tokens), lucide-react, motion, vitest, the CDP scenario harness in `scripts/cdp/scenarios.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-08-new-launcher-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/baseds`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: launcher-empty, launcher, new-run-window, capacity-warn and palette-goal need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs launcher-empty launcher new-run-window capacity-warn palette-goal`
**Prototype:** ~/code/arcterm/.superpowers/design/new-launcher/project/Main.dc.html

The frontend and the CDP scenarios are the only things that change: no Go type changes, so no `task generate`. The
`./pkg/baseds` pattern only satisfies `verify.mjs`'s usage; for a frontend merge it runs vitest and the typecheck.

## Global Constraints

- Colours only through `@theme` tokens (`bg-surface-selected`, `text-muted`, `ring-accent-700`, …); never raw hex/rgba in a component (DESIGN.md).
- Inter for UI text; `font-mono` only for keycaps, `<kbd>` hints and the command line.
- Pure logic lives in a `.ts` with a `.test.ts` beside it; no jsdom or render tests. Rendered UI is verified by CDP scenarios.
- Dialog width `w-[min(720px,93vw)]`, `max-h-[86vh]`; Start column 236px.
- Copy, verbatim from the spec: titles "New agent" / "New run"; primary "Launch agent" / "Open terminal" / "Start run" ("Starting…" while a run starts); "· draft restored" + "Clear"; "No projects yet. Agents and runs start in a project folder."; "No project matches “q”. Esc clears the filter."; "Remember these flags for the next agent"; "A plain shell in the project folder. No agent, no task."; "optional · sent as the first prompt"; "one fresh worker; it stops and asks if the goal turns out bigger".
- Every close (Esc, ×, Cancel, backdrop mousedown) keeps the draft; a launch clears task, goal, plan path, prototype, command override and worktree switch.
- Run rows read and write `runShapeAtom` through `setRunShape`; the channel profile keeps hydrating the shape until the user touches it.
- Check only the files you touched with `npx eslint <paths>` and `npx prettier --check <paths>`; never `--write` the tree, never prettier on `scripts/*.mjs`.
- A user-visible change adds its `CHANGELOG.md` line in the same commit.

## Review Focus

- A held Enter, or Enter then Mod+Enter, must start one agent or run, not two. Task 3 pins it with `beginLauncherLaunch` / `endLauncherLaunch`.
- A prefill (palette Orchestrate, "Build this…") that arrives before the project list has loaded must wait for it, not drop its project. Task 3 pins it with `applyLauncherPrefill`.
- Picking another project must reset a hand-typed worktree branch to that project's checked-out branch, or the agent lands on a branch from the wrong repo. Task 3 pins it with `pickLauncherProject`.
- Escape inside the route picker's menu (portaled out of the dialog, focus in its search box) must close the menu, not the dialog. Task 4 pins it with `shellOwnsEscape`; Task 5's `new-run-window` step 7 shows it live.
- An Escape dispatched on `document` or `window` (no element target: most scenarios close dialogs this way) must still close a ModalShell dialog. Task 4's `shellOwnsEscape` owns every target that is not an element, and its test pins it.
- Escape closes the innermost open thing wherever focus is in the dialog: with the flag menu open and focus in the Task box, the menu closes and the dialog stays. The open state of the flag menu and the branch list lives in the store (Task 3), and `launcherKey` returns `dismiss-inner` in every zone (Task 1); Task 5's `launcher` step 12 shows it.
- Enter on the Start column while a run is blocked ("Write the goal") must move focus to the goal field and start nothing. Task 5's `launcher` step 4 shows it.

---

### Task 1: Launcher model
**Depends on:** none
**Files:** `frontend/app/view/agents/launcher.ts`, `frontend/app/view/agents/launcher.test.ts`, `frontend/app/view/agents/runconfig.ts`

The pure half of the dialog: which Start rows exist and their digits, which row is selected, the title, primary label
and footer line for a pick, the project filter, arrow stepping, whether an open shows "draft restored", and what a key
does where focus is. `launcherKey`'s actions are exactly the spec's list (`pick-start`, `pick-project`, `move`,
`filter`, `launch`, `dismiss-inner`, `close`, `none`); Tab is not one of them, because the dialog's focus trap handles
it before asking `launcherKey` (as `dagmodal.tsx` does).

The Quick run row's description comes from `SHAPE_CARDS` (spec "Start column"), and the spec draws it as "one worker,
one goal", the words of the Quick goal's note ("one fresh worker"). `SHAPE_CARDS` says "one agent, one goal" today, so
this task changes that one string in `runconfig.ts`; the Brief launcher's shape card reads the same words.

**Interfaces:**
- Consumes: `isRuntimeOffered`, `runtimeLaunchLabel`, `type Runtime` from `./launch`; `SHAPE_CARDS`, `type RunShape` from `./runconfig`.
- Produces (Tasks 3 and 4 rely on these exact names):
  - `type LauncherKind = "agent" | "run"`, `type StartRowId = Runtime | RunShape`
  - `interface StartRow { id: StartRowId; kind: LauncherKind; name: string; desc: string | null; key: string }`
  - `startRows(harnesses: { runtime: string; installed?: boolean }[]): StartRow[]`
  - `agentRuntime(rows: StartRow[], remembered: Runtime | null): Runtime`
  - `selectedRowId(kind: LauncherKind, runtime: Runtime, shape: RunShape): StartRowId`
  - `launcherTitle(kind: LauncherKind): string`, `primaryLabel(kind: LauncherKind, runtime: Runtime): string`
  - `interface FooterInput { kind; shape; parallelism: number; project: { name: string; path: string } | null; branchNote: string; blocker: string | null }`, `interface FooterLine { lead: string; strong: string; tail: string; blocked: boolean }`, `footerLine(input: FooterInput): FooterLine`
  - `filterProjects<T extends { name: string }>(rows: T[], query: string): T[]`
  - `projectAfterFilter(matches: { name: string }[], current: string): string`
  - `selectedProject<T extends { name: string }>(rows: T[], picked: string): T | null`
  - `stepIndex(count: number, current: number, delta: 1 | -1): number`
  - `interface LauncherDraft { task: string; goal: string; planPath: string; prototype: string }`, `draftShown(draft: LauncherDraft): boolean`
  - `type FocusZone = "start" | "project" | "textarea" | "input" | "other"`, `type LauncherInner = "flags" | "branches" | "filter"`, `interface LauncherKeyCtx { zone: FocusZone; startCount: number; projectCount: number; filter: string; flagMenuOpen: boolean; branchListOpen: boolean }`, `interface LauncherKeyIn { key: string; shift: boolean; mod: boolean }`, `type LauncherKeyAction` (`none`, `pick-start`, `pick-project`, `move` with `column` and `delta`, `filter`, `launch`, `dismiss-inner` with `what: LauncherInner`, `close`), `launcherKey(ctx: LauncherKeyCtx, k: LauncherKeyIn): LauncherKeyAction`

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/view/agents/launcher.test.ts`:

```ts
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
const allFour = ["claude", "codex", "opencode", "pi"].map((runtime) => ({ runtime, installed: true }));

describe("startRows", () => {
    it("numbers the visible rows: Claude Code, Terminal, Quick run, Orchestrate", () => {
        expect(startRows(claudeOnly).map((r) => `${r.key} ${r.id}`)).toEqual([
            "1 claude",
            "2 terminal",
            "3 quick",
            "4 orchestrator",
        ]);
    });
    it("numbers 1 to 7 with every runtime installed", () => {
        const rows = startRows(allFour);
        expect(rows.map((r) => r.id)).toEqual(["claude", "codex", "opencode", "pi", "terminal", "quick", "orchestrator"]);
        expect(rows.at(-1)?.key).toBe("7");
    });
    it("offers every runtime while the harness list has not loaded", () => {
        expect(startRows([])).toHaveLength(7);
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run frontend/app/view/agents/launcher.test.ts`
Expected: FAIL, "Failed to resolve import "./launcher"".

- [ ] **Step 3: Write the model**

Create `frontend/app/view/agents/launcher.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure view-model logic for the New launcher, the one dialog that starts an agent, a terminal or a run
// (docs/superpowers/specs/2026-10-08-new-launcher-design.md): the Start rows and their digits, the words the dialog
// shows for a pick, the project filter, and what a key does where focus is. No React, no Wave runtime imports.

import { isRuntimeOffered, runtimeLaunchLabel, type Runtime } from "./launch";
import { SHAPE_CARDS, type RunShape } from "./runconfig";

// Which half of the Start list is picked, and which door opened the dialog: a door picks its own half.
export type LauncherKind = "agent" | "run";
export type StartRowId = Runtime | RunShape;

export interface StartRow {
    id: StartRowId;
    kind: LauncherKind;
    name: string;
    // a run row's shape description; agent rows have none
    desc: string | null;
    key: string;
}

const AGENT_ROWS: { id: Runtime; name: string }[] = [
    { id: "claude", name: "Claude Code" },
    { id: "codex", name: "Codex" },
    { id: "opencode", name: "OpenCode" },
    { id: "pi", name: "Pi" },
    { id: "terminal", name: "Terminal" },
];

const RUN_ROWS: { id: RunShape; name: string }[] = [
    { id: "quick", name: "Quick run" },
    { id: "orchestrator", name: "Orchestrate" },
];

// An uninstalled runtime stays hidden, so the digits follow the visible rows (spec D2). There are at most seven rows,
// so every row has a digit.
export function startRows(harnesses: { runtime: string; installed?: boolean }[]): StartRow[] {
    const agents: Omit<StartRow, "key">[] = AGENT_ROWS.filter((r) => isRuntimeOffered(r.id, harnesses)).map((r) => ({
        id: r.id,
        kind: "agent",
        name: r.name,
        desc: null,
    }));
    const runs: Omit<StartRow, "key">[] = RUN_ROWS.map((r) => ({
        id: r.id,
        kind: "run",
        name: r.name,
        desc: SHAPE_CARDS.find((c) => c.id === r.id)?.desc ?? null,
    }));
    return [...agents, ...runs].map((r, i) => ({ ...r, key: String(i + 1) }));
}

// The agent row on show: the remembered runtime while it is still offered, else the first agent row.
export function agentRuntime(rows: StartRow[], remembered: Runtime | null): Runtime {
    const offered = rows.filter((r) => r.kind === "agent").map((r) => r.id as Runtime);
    if (remembered != null && offered.includes(remembered)) {
        return remembered;
    }
    return offered[0] ?? "terminal";
}

export function selectedRowId(kind: LauncherKind, runtime: Runtime, shape: RunShape): StartRowId {
    return kind === "run" ? shape : runtime;
}

export function launcherTitle(kind: LauncherKind): string {
    return kind === "run" ? "New run" : "New agent";
}

export function primaryLabel(kind: LauncherKind, runtime: Runtime): string {
    return kind === "run" ? "Start run" : runtimeLaunchLabel(runtime);
}

export interface FooterInput {
    kind: LauncherKind;
    shape: RunShape;
    parallelism: number;
    project: { name: string; path: string } | null;
    // "on main", "worktree on main-agent", or "" while the branch is unknown
    branchNote: string;
    // a run's launchBlocker; always null for an agent
    blocker: string | null;
}

export interface FooterLine {
    lead: string;
    strong: string;
    tail: string;
    blocked: boolean;
}

// The footer's one line: what is missing when something is, else what the launch will do.
export function footerLine(input: FooterInput): FooterLine {
    if (input.project == null) {
        return { lead: "Pick a project", strong: "", tail: "", blocked: true };
    }
    if (input.blocker != null) {
        return { lead: input.blocker, strong: "", tail: "", blocked: true };
    }
    if (input.kind === "agent") {
        const tail = input.branchNote ? ` · ${input.branchNote}` : "";
        return { lead: "Starts in ", strong: input.project.path, tail, blocked: false };
    }
    if (input.shape === "quick") {
        return { lead: "Quick run in ", strong: input.project.name, tail: "", blocked: false };
    }
    return { lead: `Orchestrator × ${input.parallelism} in `, strong: input.project.name, tail: "", blocked: false };
}

export function filterProjects<T extends { name: string }>(rows: T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    return q === "" ? rows : rows.filter((r) => r.name.toLowerCase().includes(q));
}

// The project a filter leaves selected: the current one while it still matches, else the first match. With no match
// the selection stays, so clearing the filter finds it where it was.
export function projectAfterFilter(matches: { name: string }[], current: string): string {
    if (matches.some((m) => m.name === current)) {
        return current;
    }
    return matches[0]?.name ?? current;
}

// The picked project, else the first in recent-first order; null only when no project is registered.
export function selectedProject<T extends { name: string }>(rows: T[], picked: string): T | null {
    return rows.find((r) => r.name === picked) ?? rows[0] ?? null;
}

// Arrow movement over a column. It wraps: a list this short has no scrollbar to say an end was reached.
export function stepIndex(count: number, current: number, delta: 1 | -1): number {
    if (count === 0) {
        return -1;
    }
    if (current < 0) {
        return delta > 0 ? 0 : count - 1;
    }
    return (current + delta + count) % count;
}

export interface LauncherDraft {
    task: string;
    goal: string;
    planPath: string;
    prototype: string;
}

// Whether an open says "draft restored" (spec "Open, close and draft"): a close kept a task, a goal, a plan path or a
// prototype, whichever pick the dialog opens on. Clear empties all four.
export function draftShown(draft: LauncherDraft): boolean {
    return [draft.task, draft.goal, draft.planPath, draft.prototype].some((v) => v.trim() !== "");
}

export type FocusZone = "start" | "project" | "textarea" | "input" | "other";

// What an Escape can close before the dialog, innermost first
export type LauncherInner = "flags" | "branches" | "filter";

export interface LauncherKeyCtx {
    zone: FocusZone;
    startCount: number;
    // the visible project rows
    projectCount: number;
    filter: string;
    // shown on screen, not just set: a branch list with no branches draws nothing
    flagMenuOpen: boolean;
    branchListOpen: boolean;
}

export interface LauncherKeyIn {
    key: string;
    shift: boolean;
    // Cmd, Ctrl or Alt held
    mod: boolean;
}

export type LauncherKeyAction =
    | { kind: "none" }
    | { kind: "pick-start"; index: number }
    | { kind: "pick-project"; index: number }
    | { kind: "move"; column: "start" | "project"; delta: 1 | -1 }
    | { kind: "filter"; next: string }
    | { kind: "launch" }
    | { kind: "dismiss-inner"; what: LauncherInner }
    | { kind: "close" };

const NONE: LauncherKeyAction = { kind: "none" };

// What a key does where focus is (spec "Keyboard"). "none" leaves the key to the browser and to ModalShell, which owns
// Mod+Enter (submit). Tab never gets here: the dialog's focus trap takes it first.
export function launcherKey(ctx: LauncherKeyCtx, k: LauncherKeyIn): LauncherKeyAction {
    const { zone } = ctx;
    // Escape closes the innermost open thing, wherever focus is: the flag menu opens from the Command row while
    // focus can sit in the Task box
    if (k.key === "Escape") {
        if (ctx.flagMenuOpen) {
            return { kind: "dismiss-inner", what: "flags" };
        }
        if (ctx.branchListOpen) {
            return { kind: "dismiss-inner", what: "branches" };
        }
        // the filter clears when focus leaves the Project column, so a filter means focus is there
        return ctx.filter !== "" ? { kind: "dismiss-inner", what: "filter" } : { kind: "close" };
    }
    if (k.mod) {
        return NONE;
    }
    if (k.key === "Enter") {
        return zone === "start" || zone === "project" || zone === "input" ? { kind: "launch" } : NONE;
    }
    if (zone !== "start" && zone !== "project") {
        return NONE;
    }
    if (/^[1-9]$/.test(k.key)) {
        const index = Number(k.key) - 1;
        if (zone === "start") {
            return index < ctx.startCount ? { kind: "pick-start", index } : NONE;
        }
        return index < ctx.projectCount ? { kind: "pick-project", index } : NONE;
    }
    if (k.key === "ArrowDown" || k.key === "ArrowUp") {
        return { kind: "move", column: zone, delta: k.key === "ArrowDown" ? 1 : -1 };
    }
    if (zone === "project") {
        if (k.key === "Backspace") {
            return ctx.filter === "" ? NONE : { kind: "filter", next: ctx.filter.slice(0, -1) };
        }
        if (k.key.length === 1 && !/[0-9]/.test(k.key)) {
            return { kind: "filter", next: ctx.filter + k.key };
        }
    }
    return NONE;
}
```

In `frontend/app/view/agents/runconfig.ts`, change the Quick card of `SHAPE_CARDS` to
`{ id: "quick", desc: "one worker, one goal" },`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/launcher.test.ts frontend/app/view/agents/runconfig.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Lint, format, commit**

```bash
npx eslint frontend/app/view/agents/launcher.ts frontend/app/view/agents/launcher.test.ts frontend/app/view/agents/runconfig.ts
npx prettier --check frontend/app/view/agents/launcher.ts frontend/app/view/agents/launcher.test.ts
git add frontend/app/view/agents/launcher.ts frontend/app/view/agents/launcher.test.ts frontend/app/view/agents/runconfig.ts
git commit -m "feat(launcher): the New launcher's model — Start rows, digits, footer words, filter, key reducer"
```

---

### Task 2: Starting a run outside the dialog
**Depends on:** none
**Files:** `frontend/app/view/agents/launcherrun.ts`, `frontend/app/view/agents/launcherrun.test.ts`, `frontend/app/view/jarvis/newruncontrol.tsx`

Move the body of `NewRunModal.start` (channel, route, `createRun`, note the project, end the config draft) into one
exported async function. The New run window calls it right away, so this task ships no behaviour change; Task 4's
dialog calls the same function.

**Interfaces:**
- Consumes: `launchGoal`, `launchOptsFromConfig`, `type ChannelTarget`, `type RunConfig` from `@/app/view/jarvis/newrun`; `createChannel` from `./channelsstore`; `noteRecentProject` from `./projectsstore`; `createRun`, `resolveChannelLaunchRoute`, `resolvedProfileAtom` from `./runactions`; `endRunConfigDraft` from `./runconfigstore`.
- Produces: `interface LauncherRunInput { target: ChannelTarget; projectName: string; config: RunConfig; goal: string; pickedRoute: RoutePin | null }` and `startLauncherRun(input: LauncherRunInput): Promise<{ channelId: string; run: Run }>`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/view/agents/launcherrun.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { RunConfig } from "@/app/view/jarvis/newrun";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "./channelsstore";
import { startLauncherRun } from "./launcherrun";
import { noteRecentProject } from "./projectsstore";
import { createRun, resolveChannelLaunchRoute, resolvedProfileAtom } from "./runactions";
import { endRunConfigDraft } from "./runconfigstore";

vi.mock("./channelsstore", () => ({ createChannel: vi.fn() }));
vi.mock("./projectsstore", () => ({ noteRecentProject: vi.fn() }));
vi.mock("./runconfigstore", () => ({ endRunConfigDraft: vi.fn() }));
vi.mock("./runactions", async () => {
    const { atom } = await import("jotai");
    return { createRun: vi.fn(), resolveChannelLaunchRoute: vi.fn(), resolvedProfileAtom: atom({}) };
});

const quick: RunConfig = {
    shape: "quick",
    parallelism: 3,
    workerRoute: null,
    start: "goal",
    planPath: "",
    reviewerPicks: false,
    reviewerRoute: null,
};
const route = { runtime: "claude", model: "opus" } as RoutePin;
const run = { id: "run-1" } as Run;

beforeEach(() => {
    vi.mocked(createChannel).mockReset();
    vi.mocked(createRun).mockReset().mockResolvedValue(run);
    vi.mocked(resolveChannelLaunchRoute).mockReset().mockResolvedValue(route);
    vi.mocked(noteRecentProject).mockReset();
    vi.mocked(endRunConfigDraft).mockReset();
    globalStore.set(resolvedProfileAtom, {});
});

describe("startLauncherRun", () => {
    it("runs in the project's channel on its route, then notes the project and ends the draft", async () => {
        const profile = { defaultmode: "quick" } as JarvisProfile;
        globalStore.set(resolvedProfileAtom, { "ch-1": profile });
        const out = await startLauncherRun({
            target: { kind: "existing", oid: "ch-1" },
            projectName: "arcterm",
            config: quick,
            goal: "  fix it  ",
            pickedRoute: null,
        });
        expect(resolveChannelLaunchRoute).toHaveBeenCalledWith("ch-1");
        expect(createRun).toHaveBeenCalledWith("ch-1", "fix it", route, { mode: "quick" });
        expect(noteRecentProject).toHaveBeenCalledWith("arcterm");
        expect(endRunConfigDraft).toHaveBeenCalledWith(profile);
        expect(out).toEqual({ channelId: "ch-1", run });
    });

    it("mints the channel for a project that has none", async () => {
        vi.mocked(createChannel).mockResolvedValue("ch-new");
        await startLauncherRun({
            target: { kind: "create", name: "thesis", path: "/w/thesis" },
            projectName: "thesis",
            config: quick,
            goal: "g",
            pickedRoute: null,
        });
        expect(createChannel).toHaveBeenCalledWith("thesis", "/w/thesis");
        expect(createRun).toHaveBeenCalledWith("ch-new", "g", route, { mode: "quick" });
    });

    it("uses a lead route picked by hand as is", async () => {
        const picked = { runtime: "claude", model: "sonnet" } as RoutePin;
        await startLauncherRun({
            target: { kind: "existing", oid: "ch-1" },
            projectName: "arcterm",
            config: quick,
            goal: "g",
            pickedRoute: picked,
        });
        expect(resolveChannelLaunchRoute).not.toHaveBeenCalled();
        expect(createRun).toHaveBeenCalledWith("ch-1", "g", picked, { mode: "quick" });
    });

    it("leaves the project unnoted and the draft alive when the run is not created", async () => {
        vi.mocked(createRun).mockRejectedValue(new Error("Choose a route"));
        await expect(
            startLauncherRun({
                target: { kind: "existing", oid: "ch-1" },
                projectName: "arcterm",
                config: quick,
                goal: "g",
                pickedRoute: null,
            })
        ).rejects.toThrow("Choose a route");
        expect(noteRecentProject).not.toHaveBeenCalled();
        expect(endRunConfigDraft).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run frontend/app/view/agents/launcherrun.test.ts`
Expected: FAIL, "Failed to resolve import "./launcherrun"".

- [ ] **Step 3: Write the function**

Create `frontend/app/view/agents/launcherrun.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Starting a run from the New launcher: the channel, the route and the run, in that order. Moved out of the old New
// run window's start handler so the dialog stays thin; what a launch dispatches is unchanged.

import { globalStore } from "@/app/store/jotaiStore";
import { launchGoal, launchOptsFromConfig, type ChannelTarget, type RunConfig } from "@/app/view/jarvis/newrun";
import { createChannel } from "./channelsstore";
import { noteRecentProject } from "./projectsstore";
import { createRun, resolveChannelLaunchRoute, resolvedProfileAtom } from "./runactions";
import { endRunConfigDraft } from "./runconfigstore";

export interface LauncherRunInput {
    target: ChannelTarget;
    projectName: string;
    config: RunConfig;
    goal: string;
    // a lead route picked by hand in the Models row; null lets the project's own resolve
    pickedRoute: RoutePin | null;
}

export async function startLauncherRun(input: LauncherRunInput): Promise<{ channelId: string; run: Run }> {
    // a channel minted here and then orphaned by a failed launch is the project's channel either way, so there is
    // nothing to roll back: the next run finds it
    const channelId =
        input.target.kind === "existing"
            ? input.target.oid
            : await createChannel(input.target.name, input.target.path);
    // resolving also checks that the project's route is available right now
    const route = input.pickedRoute ?? (await resolveChannelLaunchRoute(channelId));
    const run = await createRun(channelId, launchGoal(input.config, input.goal), route, launchOptsFromConfig(input.config));
    noteRecentProject(input.projectName);
    // the launch consumed this draft, so the next one starts from the project's saved defaults
    endRunConfigDraft(globalStore.get(resolvedProfileAtom)[channelId]);
    return { channelId, run };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/launcherrun.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Call it from the New run window**

In `frontend/app/view/jarvis/newruncontrol.tsx`, inside `NewRunModal`'s `start`, replace the whole
`fireAndForget(async () => { … })` block (from `let oid: string;` through `await openTarget(…)`) with:

```tsx
        fireAndForget(async () => {
            let started: { channelId: string; run: Run };
            try {
                started = await startLauncherRun({
                    target,
                    projectName: picked,
                    config,
                    goal,
                    pickedRoute: routeTouched ? runRoute : null,
                });
            } catch (e) {
                // only a failure BEFORE the run exists keeps this modal: there is still a launch to retry
                setError(String(e));
                setStarting(false);
                return;
            }
            // The run exists, so the launch has succeeded and the modal's work is done. Landing on it is a
            // separate concern that reports its own failures (openTarget toasts).
            onClose();
            await openTarget(model, { kind: "channel", channelId: started.channelId, runId: started.run.id });
        });
```

Add `import { startLauncherRun } from "../agents/launcherrun";` and remove the imports this leaves unused:
`createChannel` (keep `channelsAtom`, `primeChannels`), `noteRecentProject` (keep `projectListAtom`,
`recentProjectsAtom`), `createRun` and `resolveChannelLaunchRoute` (keep `channelOverrideAtom`, `loadResolvedProfile`,
`resolvedProfileAtom`), `endRunConfigDraft`, `launchGoal` and `launchOptsFromConfig`.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
NODE_OPTIONS=--max-old-space-size=4096 task check:ts
npx eslint frontend/app/view/agents/launcherrun.ts frontend/app/view/agents/launcherrun.test.ts frontend/app/view/jarvis/newruncontrol.tsx
npx prettier --check frontend/app/view/agents/launcherrun.ts frontend/app/view/agents/launcherrun.test.ts frontend/app/view/jarvis/newruncontrol.tsx
git add frontend/app/view/agents/launcherrun.ts frontend/app/view/agents/launcherrun.test.ts frontend/app/view/jarvis/newruncontrol.tsx
git commit -m "refactor(runs): starting a run is one function the New run window calls"
```

Expected: `task check:ts` exits 0 (give it a 5-minute timeout; it takes about 2 minutes).

---

### Task 3: Launcher store
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/launcherstore.ts`, `frontend/app/view/agents/launcherstore.test.ts`

The state a close must keep, and the actions every opener and the dialog use.

**Interfaces:**
- Consumes: `draftShown`, `type LauncherKind` from `./launcher` (Task 1); `prefillToLaunch`, `type NewRunPrefill` from `@/app/view/jarvis/newrun`; `planPathAtom`, `setRunShape`, `setStart` from `./runconfigstore`.
- Produces (Task 4 relies on these exact names):
  - atoms: `launcherKindAtom: PrimitiveAtom<LauncherKind>`, `launcherRuntimeAtom: PrimitiveAtom<Runtime | null>`, `launcherProjectAtom: PrimitiveAtom<string>`, `launcherTaskAtom`, `launcherGoalAtom`, `launcherPrototypeAtom: PrimitiveAtom<string>`, `launcherCommandAtom: PrimitiveAtom<Partial<Record<Runtime, string>>>`, `launcherWorktreeAtom: PrimitiveAtom<boolean>`, `launcherBranchAtom: PrimitiveAtom<string | null>`, `launcherFlagMenuAtom: PrimitiveAtom<boolean>`, `launcherBranchListAtom: PrimitiveAtom<boolean>`, `launcherRestoredAtom: PrimitiveAtom<boolean>`, `launcherBusyAtom: PrimitiveAtom<boolean>`, `launcherPrefillAtom: PrimitiveAtom<NewRunPrefill | null>`
  - `type LauncherModel = { launcherAtom: PrimitiveAtom<LauncherKind | null> }`
  - `openLauncher(model: LauncherModel, door: LauncherKind, prefill?: NewRunPrefill): void`, `closeLauncher(model: LauncherModel): void`
  - `clearLauncherDraft(): void`, `endLauncherDraft(): void`
  - `pickLauncherProject(name: string, current: string): void`
  - `applyLauncherPrefill(projectNames: string[]): boolean`
  - `beginLauncherLaunch(): boolean`, `endLauncherLaunch(): void`

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/view/agents/launcherstore.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import type { LauncherKind } from "./launcher";
import {
    applyLauncherPrefill,
    beginLauncherLaunch,
    clearLauncherDraft,
    closeLauncher,
    endLauncherDraft,
    endLauncherLaunch,
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherBusyAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherGoalAtom,
    launcherKindAtom,
    launcherPrefillAtom,
    launcherProjectAtom,
    launcherPrototypeAtom,
    launcherRestoredAtom,
    launcherRuntimeAtom,
    launcherTaskAtom,
    launcherWorktreeAtom,
    openLauncher,
    pickLauncherProject,
} from "./launcherstore";
import { planPathAtom, resetRunConfig, runShapeAtom, startAtom } from "./runconfigstore";

const model = () => ({ launcherAtom: atom<LauncherKind | null>(null) });

beforeEach(() => {
    globalStore.set(launcherKindAtom, "agent");
    globalStore.set(launcherRuntimeAtom, null);
    globalStore.set(launcherProjectAtom, "");
    globalStore.set(launcherPrefillAtom, null);
    globalStore.set(launcherBusyAtom, false);
    endLauncherDraft();
    resetRunConfig();
});

describe("openLauncher", () => {
    it("opens at the agent door on the agent half", () => {
        const m = model();
        globalStore.set(launcherKindAtom, "run");
        openLauncher(m, "agent");
        expect(globalStore.get(m.launcherAtom)).toBe("agent");
        expect(globalStore.get(launcherKindAtom)).toBe("agent");
    });
    it("opens at the run door on the run half and keeps the agent row for the next agent", () => {
        const m = model();
        globalStore.set(launcherRuntimeAtom, "terminal");
        openLauncher(m, "run");
        expect(globalStore.get(launcherKindAtom)).toBe("run");
        expect(globalStore.get(launcherRuntimeAtom)).toBe("terminal");
    });
    it("a prefill opens on the run half and waits there for the dialog", () => {
        const m = model();
        const prefill = { projectName: "arcterm", goal: "fix it", shape: "orchestrator" as const };
        openLauncher(m, "run", prefill);
        expect(globalStore.get(launcherKindAtom)).toBe("run");
        expect(globalStore.get(launcherPrefillAtom)).toEqual(prefill);
    });
    it("says draft restored when a close kept a task, a goal, a plan path or a prototype, at either door", () => {
        globalStore.set(launcherTaskAtom, "fix it");
        openLauncher(model(), "run");
        expect(globalStore.get(launcherRestoredAtom)).toBe(true);
        endLauncherDraft();
        globalStore.set(planPathAtom, "/p/plan.md");
        openLauncher(model(), "agent");
        expect(globalStore.get(launcherRestoredAtom)).toBe(true);
    });
    it("does not when nothing was kept", () => {
        openLauncher(model(), "agent");
        expect(globalStore.get(launcherRestoredAtom)).toBe(false);
    });
    it("does not for a prefill, which replaces the goal", () => {
        globalStore.set(launcherGoalAtom, "old goal");
        openLauncher(model(), "run", { projectName: "", goal: "new", shape: "quick" });
        expect(globalStore.get(launcherRestoredAtom)).toBe(false);
    });
});

describe("closing, clearing and launching", () => {
    it("a close keeps the draft", () => {
        const m = model();
        openLauncher(m, "agent");
        globalStore.set(launcherTaskAtom, "fix it");
        globalStore.set(launcherWorktreeAtom, true);
        closeLauncher(m);
        expect(globalStore.get(m.launcherAtom)).toBeNull();
        expect(globalStore.get(launcherTaskAtom)).toBe("fix it");
        expect(globalStore.get(launcherWorktreeAtom)).toBe(true);
    });
    it("a close shuts the flag menu and the branch list, so the next open shows neither", () => {
        const m = model();
        openLauncher(m, "agent");
        globalStore.set(launcherFlagMenuAtom, true);
        globalStore.set(launcherBranchListAtom, true);
        closeLauncher(m);
        expect(globalStore.get(launcherFlagMenuAtom)).toBe(false);
        expect(globalStore.get(launcherBranchListAtom)).toBe(false);
    });
    it("Clear empties what a close kept and leaves the pick, the project and the commands", () => {
        globalStore.set(launcherRuntimeAtom, "terminal");
        globalStore.set(launcherProjectAtom, "thesis");
        globalStore.set(launcherTaskAtom, "a");
        globalStore.set(launcherGoalAtom, "b");
        globalStore.set(planPathAtom, "/p/plan.md");
        globalStore.set(launcherPrototypeAtom, "/c/Main.dc.html");
        globalStore.set(launcherWorktreeAtom, true);
        globalStore.set(launcherBranchAtom, "feat/x");
        globalStore.set(launcherRestoredAtom, true);
        globalStore.set(launcherCommandAtom, { claude: "claude --verbose" });
        clearLauncherDraft();
        expect([
            globalStore.get(launcherTaskAtom),
            globalStore.get(launcherGoalAtom),
            globalStore.get(planPathAtom),
            globalStore.get(launcherPrototypeAtom),
            globalStore.get(launcherWorktreeAtom),
            globalStore.get(launcherBranchAtom),
            globalStore.get(launcherRestoredAtom),
        ]).toEqual(["", "", "", "", false, null, false]);
        expect(globalStore.get(launcherRuntimeAtom)).toBe("terminal");
        expect(globalStore.get(launcherProjectAtom)).toBe("thesis");
        expect(globalStore.get(launcherCommandAtom)).toEqual({ claude: "claude --verbose" });
    });
    it("a launch also drops hand-edited commands", () => {
        globalStore.set(launcherCommandAtom, { claude: "claude --verbose" });
        globalStore.set(launcherTaskAtom, "a");
        endLauncherDraft();
        expect(globalStore.get(launcherCommandAtom)).toEqual({});
        expect(globalStore.get(launcherTaskAtom)).toBe("");
    });
    it("one launch at a time: a second begin fails until the first ends", () => {
        expect(beginLauncherLaunch()).toBe(true);
        expect(beginLauncherLaunch()).toBe(false);
        endLauncherLaunch();
        expect(beginLauncherLaunch()).toBe(true);
    });
});

describe("pickLauncherProject", () => {
    it("a different project re-defaults the worktree branch", () => {
        globalStore.set(launcherBranchAtom, "feat/x");
        pickLauncherProject("thesis", "arcterm");
        expect(globalStore.get(launcherProjectAtom)).toBe("thesis");
        expect(globalStore.get(launcherBranchAtom)).toBeNull();
    });
    it("the same project keeps the typed branch", () => {
        globalStore.set(launcherBranchAtom, "feat/x");
        pickLauncherProject("arcterm", "arcterm");
        expect(globalStore.get(launcherBranchAtom)).toBe("feat/x");
    });
});

describe("applyLauncherPrefill", () => {
    const prefill = { projectName: "arcterm", goal: "build it", shape: "quick" as const, prototype: "/c/Main.dc.html" };
    it("waits while the project list is empty", () => {
        globalStore.set(launcherPrefillAtom, prefill);
        expect(applyLauncherPrefill([])).toBe(false);
        expect(globalStore.get(launcherPrefillAtom)).toEqual(prefill);
    });
    it("fills the project, the goal, the prototype and an orchestrator shape once projects are in", () => {
        globalStore.set(launcherPrefillAtom, prefill);
        expect(applyLauncherPrefill(["arcterm", "thesis"])).toBe(true);
        expect(globalStore.get(launcherPrefillAtom)).toBeNull();
        expect(globalStore.get(launcherProjectAtom)).toBe("arcterm");
        expect(globalStore.get(launcherGoalAtom)).toBe("build it");
        expect(globalStore.get(launcherPrototypeAtom)).toBe("/c/Main.dc.html");
        // a prototype only rides an orchestrator run (prefillToLaunch)
        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(startAtom)).toBe("goal");
    });
    it("leaves the project alone when the prefill's is not registered", () => {
        globalStore.set(launcherProjectAtom, "thesis");
        globalStore.set(launcherPrefillAtom, { ...prefill, projectName: "gone" });
        applyLauncherPrefill(["arcterm", "thesis"]);
        expect(globalStore.get(launcherProjectAtom)).toBe("thesis");
    });
    it("does nothing without a prefill", () => {
        expect(applyLauncherPrefill(["arcterm"])).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run frontend/app/view/agents/launcherstore.test.ts`
Expected: FAIL, "Failed to resolve import "./launcherstore"".

- [ ] **Step 3: Write the store**

Create `frontend/app/view/agents/launcherstore.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's state (docs/superpowers/specs/2026-10-08-new-launcher-design.md, "Open, close and draft"). The
// dialog renders its body only while open, so what a close must keep lives here: the pick, the project and everything
// typed. In memory only, as New agent's state was: a draft outlives a close and a surface switch, not an app restart.

import { globalStore } from "@/app/store/jotaiStore";
import { prefillToLaunch, type NewRunPrefill } from "@/app/view/jarvis/newrun";
import { atom, type PrimitiveAtom } from "jotai";
import type { Runtime } from "./launch";
import { draftShown, type LauncherKind } from "./launcher";
import { planPathAtom, setRunShape, setStart } from "./runconfigstore";

export const launcherKindAtom = atom<LauncherKind>("agent") as PrimitiveAtom<LauncherKind>;
// the agent row; null until the first open defaults it from the harness preference
export const launcherRuntimeAtom = atom<Runtime | null>(null) as PrimitiveAtom<Runtime | null>;
// "" means the first project in recent-first order
export const launcherProjectAtom = atom("") as PrimitiveAtom<string>;
export const launcherTaskAtom = atom("") as PrimitiveAtom<string>;
export const launcherGoalAtom = atom("") as PrimitiveAtom<string>;
// a canvas's board, from Build this…; it only rides an orchestrator run
export const launcherPrototypeAtom = atom("") as PrimitiveAtom<string>;
// a hand-edited command per runtime; a runtime with no entry runs its default
export const launcherCommandAtom = atom<Partial<Record<Runtime, string>>>({}) as PrimitiveAtom<
    Partial<Record<Runtime, string>>
>;
export const launcherWorktreeAtom = atom(false) as PrimitiveAtom<boolean>;
// null follows the project's checked-out branch
export const launcherBranchAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// The agent row's two popovers. They live here, not in the fields' state, so the dialog's one key handler can close
// the open one on Escape wherever focus is (the flag menu opens while focus sits in the Task box).
export const launcherFlagMenuAtom = atom(false) as PrimitiveAtom<boolean>;
export const launcherBranchListAtom = atom(false) as PrimitiveAtom<boolean>;
// this open showed a draft a close had kept
export const launcherRestoredAtom = atom(false) as PrimitiveAtom<boolean>;
export const launcherBusyAtom = atom(false) as PrimitiveAtom<boolean>;
// what the next open fills in, read by the dialog once the project list is in
export const launcherPrefillAtom = atom<NewRunPrefill | null>(null) as PrimitiveAtom<NewRunPrefill | null>;

export type LauncherModel = { launcherAtom: PrimitiveAtom<LauncherKind | null> };

function keptDraft() {
    return {
        task: globalStore.get(launcherTaskAtom),
        goal: globalStore.get(launcherGoalAtom),
        planPath: globalStore.get(planPathAtom),
        prototype: globalStore.get(launcherPrototypeAtom),
    };
}

// Every way in. A door picks its own half of the Start list; the agent row and the run shape inside it stay as the
// last open left them. A prefill always opens on the run half.
export function openLauncher(model: LauncherModel, door: LauncherKind, prefill?: NewRunPrefill): void {
    const kind: LauncherKind = prefill != null ? "run" : door;
    globalStore.set(launcherKindAtom, kind);
    globalStore.set(launcherRestoredAtom, prefill == null && draftShown(keptDraft()));
    globalStore.set(launcherPrefillAtom, prefill ?? null);
    globalStore.set(model.launcherAtom, door);
}

// Every way out keeps the draft; that is what lets a click outside close the dialog. An open popover is not draft.
export function closeLauncher(model: LauncherModel): void {
    globalStore.set(launcherFlagMenuAtom, false);
    globalStore.set(launcherBranchListAtom, false);
    globalStore.set(model.launcherAtom, null);
}

// The header's Clear: what a close kept goes; the pick, the project and the commands stay. The plan path is set
// directly, not through setPlanPath, which would mark the run config as touched by hand.
export function clearLauncherDraft(): void {
    globalStore.set(launcherTaskAtom, "");
    globalStore.set(launcherGoalAtom, "");
    globalStore.set(planPathAtom, "");
    globalStore.set(launcherPrototypeAtom, "");
    globalStore.set(launcherWorktreeAtom, false);
    globalStore.set(launcherBranchAtom, null);
    globalStore.set(launcherRestoredAtom, false);
}

// A launch consumed the draft. Hand-edited commands go with it; the pick, the project and the flags stay.
export function endLauncherDraft(): void {
    clearLauncherDraft();
    globalStore.set(launcherCommandAtom, {});
}

// A different project re-defaults the worktree branch to that project's checked-out one: a branch typed for one repo
// means nothing in another. `current` is the project on show, which "" in the atom also names.
export function pickLauncherProject(name: string, current: string): void {
    if (name === current) {
        return;
    }
    globalStore.set(launcherProjectAtom, name);
    globalStore.set(launcherBranchAtom, null);
}

// A prefill waits for the project list: read too early, its project would not be found and would be dropped for good.
export function applyLauncherPrefill(projectNames: string[]): boolean {
    const prefill = globalStore.get(launcherPrefillAtom);
    if (prefill == null || projectNames.length === 0) {
        return false;
    }
    globalStore.set(launcherPrefillAtom, null);
    const p = prefillToLaunch(prefill, projectNames);
    if (p.picked != null) {
        pickLauncherProject(p.picked, globalStore.get(launcherProjectAtom));
    }
    setRunShape(p.shape);
    setStart(p.start);
    globalStore.set(launcherGoalAtom, p.goal);
    globalStore.set(launcherPrototypeAtom, p.prototype);
    return true;
}

// One launch at a time: a held Enter repeats the keydown, and each would start another agent.
export function beginLauncherLaunch(): boolean {
    if (globalStore.get(launcherBusyAtom)) {
        return false;
    }
    globalStore.set(launcherBusyAtom, true);
    return true;
}

export function endLauncherLaunch(): void {
    globalStore.set(launcherBusyAtom, false);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/launcherstore.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Lint, format, commit**

```bash
npx eslint frontend/app/view/agents/launcherstore.ts frontend/app/view/agents/launcherstore.test.ts
npx prettier --check frontend/app/view/agents/launcherstore.ts frontend/app/view/agents/launcherstore.test.ts
git add frontend/app/view/agents/launcherstore.ts frontend/app/view/agents/launcherstore.test.ts
git commit -m "feat(launcher): the New launcher's store — doors, a draft every close keeps, one launch at a time"
```

---

### Task 4: The New dialog replaces New agent and New run
**Depends on:** Task 1, Task 2, Task 3
**Files:** `frontend/app/view/agents/launchermodal.tsx`, `frontend/app/view/agents/launcheragentfields.tsx`, `frontend/app/view/agents/launcherrunfields.tsx`, `frontend/app/view/agents/workercapacity.ts`, `frontend/app/view/agents/workercapacity.test.ts`, `frontend/app/modals/modalfocus.ts`, `frontend/app/modals/modalfocus.test.ts`, `frontend/app/modals/modalshell.tsx`, `frontend/app/view/agents/agents.tsx`, `frontend/app/store/keybindings/dispatcher.ts`, `frontend/app/store/keybindings/dispatcher.test.ts`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/store.test.ts`, `frontend/app/cockpit/app-bar.tsx`, `frontend/app/cockpit/command-palette.tsx`, `frontend/app/cockpit/actions/project.ts`, `frontend/app/cockpit/cockpit-actions.ts`, `frontend/app/cockpit/cockpit-root.tsx`
**Files:** `frontend/app/view/agents/runlauncher.tsx`, `frontend/app/view/agents/canvaspane.tsx`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/agentlaunchhero.tsx`, `frontend/app/view/agents/filessurface.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/conversationhistory.tsx`, `frontend/app/view/agents/naflagsstore.ts`, `frontend/app/view/agents/newagentmodal.tsx`, `frontend/app/view/jarvis/newruncontrol.tsx`, `frontend/app/view/jarvis/projectpickerview.tsx`, `frontend/app/view/jarvis/projectpicker.ts`, `frontend/app/view/jarvis/projectpicker.test.ts`, `frontend/app/view/jarvis/newrun.ts`, `frontend/app/view/jarvis/newrun.test.ts`, `CHANGELOG.md`, `docs/keyboard-shortcuts.md`, `docs/orchestrator-guide.md`, `docs/open-issues.md`

Build the dialog from the mockup (`Main.dc.html` and its boards), mount it in place of the two old ones, point every
opener at `openLauncher`, delete the old dialogs, and update the docs.

**Acceptance:** the unit tests below pass, `task check:ts` exits 0, and Task 5's scenarios show each state. `launcher`:
step 1 (the agent row, Main board), step 2 (Terminal board), step 5 (QuickRun board), step 6 (Orchestrate board),
step 7 (OrchestratePlan board), step 8 (ProjectFilter board), step 9 (no project matches), steps 11 and 15
(AgentOptions board: options, then the restored draft), step 13 (the launch-error line) and step 17 (the Prototype
chip). `capacity-warn`: step 2 (the Orchestrate board's RAM line under the stepper) and step 3 (the RAM line of the
QuickRun and Main boards). `launcher-empty`: step 1 (No projects yet and Register a project).

**Interfaces:**
- Consumes: everything Task 1 and Task 3 produce; `startLauncherRun` from Task 2.
- Produces: `LauncherModal({ model }: { model: AgentsViewModel })` from `launchermodal.tsx`; `AgentsViewModel.launcherAtom: PrimitiveAtom<LauncherKind | null>`; DOM hooks Task 5 reads: `[data-launcher]` on the dialog's root, `[data-launcher-column="start" | "project"]` on the two columns, `[data-start-row=<id>]` and `[data-project-row=<name>]` (with `aria-checked`) on rows, `[data-launcher-filter]`, `[data-launcher-nomatch]`, `[data-launcher-empty]`, `[data-launcher-restored]`, `[data-launcher-footer="line" | "error"]`, `[data-launcher-prototype]`, `[data-ram-warn]`, `[data-capacity-warn]` on the line under the Workers stepper, `#launcher-task`, `input[aria-label="Branch"]`, `textarea[aria-label="Goal"]`, `[data-jarvis-plan-path]`, `[data-jarvis-plan-preview]`, the `Start from` group with its "A goal" / "A plan file" buttons, the DEV-only `window.__openLauncher(door, prefill?)`, and `shellOwnsEscape(panel, target, body): boolean` in `modalfocus.ts`.

- [ ] **Step 1: Write the failing tests**

(a) `frontend/app/view/agents/workercapacity.test.ts`: in `describe("newAgentRamWarning", …)`, replace the "warns with
the numbers" test and add one:

```ts
    it("warns with the numbers when not even one more fits", () => {
        expect(newAgentRamWarning(cap({ moreworkers: 0 }), "pi")).toBe(
            "1.3 GB free of 8 GB. Another agent (~1.5 GB) may make the machine lag."
        );
    });
    it("names a Quick run's worker as a worker", () => {
        expect(newAgentRamWarning(cap({ moreworkers: 0 }), "run", "worker")).toBe(
            "1.3 GB free of 8 GB. Another worker (~1.5 GB) may make the machine lag."
        );
    });
```

(b) `frontend/app/modals/modalfocus.test.ts`: import `shellOwnsEscape` beside `focusTrapTarget` and add:

```ts
describe("shellOwnsEscape", () => {
    // elements are nodeType 1; document is 9, and window has no nodeType
    const inside = { nodeType: 1 } as Node;
    const portaled = { nodeType: 1 } as Node;
    const body = { nodeType: 1 } as Node;
    const panel = { contains: (n: Node | null) => n === inside };
    it("owns an Escape from inside the panel", () => {
        expect(shellOwnsEscape(panel, inside, body)).toBe(true);
    });
    it("leaves an Escape from a popover portaled out of the panel to that popover", () => {
        expect(shellOwnsEscape(panel, portaled, body)).toBe(false);
    });
    it("owns an Escape with nothing focused", () => {
        expect(shellOwnsEscape(panel, body, body)).toBe(true);
        expect(shellOwnsEscape(panel, null, body)).toBe(true);
    });
    it("owns an Escape dispatched on document or window, which no popover can claim", () => {
        expect(shellOwnsEscape(panel, { nodeType: 9 } as unknown as EventTarget, body)).toBe(true);
        expect(shellOwnsEscape(panel, {} as EventTarget, body)).toBe(true);
    });
    it("owns every Escape before the panel exists", () => {
        expect(shellOwnsEscape(null, portaled, body)).toBe(true);
    });
});
```

(c) `frontend/app/store/keybindings/bindings.test.ts`: add `import type { LauncherKind } from "@/app/view/agents/launcher";`
and replace the whole `describe("new run chord", …)` block with:

```ts
describe("new run chord", () => {
    const build = () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit"), launcherAtom: atom<LauncherKind | null>(null) } as any;
        return { model, b: buildGlobalBindings(model).find((x) => x.id === "new-run")! };
    };

    // reachable from a field and the terminal, as New agent's Mod+N is; Mod+R would take Ctrl+R from the shell
    it("is Mod+Shift+R and opens the launcher at the run door from anywhere but a modal", () => {
        const { model, b } = build();
        expect(b.keys).toBe("Mod:Shift:r");
        expect(b.when?.({ ...ctx("agent"), editable: true })).toBe(true);
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
        b.run(ctx());
        expect(globalStore.get(model.launcherAtom)).toBe("run");
    });
});

describe("new agent chord", () => {
    it("is Mod+N and opens the launcher at the agent door", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit"), launcherAtom: atom<LauncherKind | null>(null) } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "new-agent")!;
        expect(b.keys).toBe("Mod:n");
        b.run(ctx());
        expect(globalStore.get(model.launcherAtom)).toBe("agent");
    });
});
```

(d) `frontend/app/store/keybindings/dispatcher.test.ts`: add `import type { LauncherKind } from "@/app/view/agents/launcher";`;
in each of the four stub models (around lines 132, 236, 304 and 372) replace the two lines
`newAgentOpenAtom: atom(false),` and `newRunOpenAtom: atom(false),` with the one line
`launcherAtom: atom<LauncherKind | null>(null),`; and replace the "counts the New run window as a modal" test with:

```ts
    // the launcher opens from the app bar over any surface; uncounted, the Brief's bare-letter keys stayed live
    // behind it
    it("counts the launcher as a modal", () => {
        const model = stubModel("jarvis");
        const unbind = initKeybindingDispatcher(model);
        expect(deriveKeyContext().modalOpen).toBe(false);
        globalStore.set(model.launcherAtom, "run");
        expect(deriveKeyContext().modalOpen).toBe(true);
        unbind();
    });
```

(e) `frontend/app/store/keybindings/store.test.ts`: in the conflict-invariant test, change `newAgentOpenAtom: {}` to
`launcherAtom: {}`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/workercapacity.test.ts frontend/app/modals/modalfocus.test.ts frontend/app/store/keybindings`
Expected: FAIL: the RAM copy differs, `shellOwnsEscape` is not exported, and the bindings and dispatcher tests read a
`launcherAtom` nothing sets.

- [ ] **Step 3: RAM copy and the Escape rule**

In `frontend/app/view/agents/workercapacity.ts`, replace `newAgentRamWarning` and its comment with:

```ts
/** The launcher's low-RAM line: one more agent, or a Quick run's one worker, is one more worker-sized process tree, so
 * it warns when not even one more fits. A plain terminal is light and never warns; no reading, no warning. It blocks
 * nothing; the user decides. */
export function newAgentRamWarning(
    cap: WorkerCapacity | null,
    runtime: string,
    what: "agent" | "worker" = "agent"
): string | null {
    if (cap == null || runtime === "terminal" || !overCapacity(cap, 1)) {
        return null;
    }
    return `${formatGB(cap.availablebytes)} free of ${formatGB(cap.totalbytes)}. Another ${what} (~${formatGB(cap.perworkerbytes)}) may make the machine lag.`;
}
```

In `frontend/app/modals/modalfocus.ts`, append:

```ts
// Whether an Escape is the shell's to act on. A popover portaled out of the panel (a route picker's menu, with focus
// in its search box) closes itself on Escape, and the dialog under it must stay. With nothing focused (<body>), or an
// Escape dispatched on document or window (no element at all, as the CDP scenarios close dialogs), the Escape is the
// shell's: no popover can own it.
export function shellOwnsEscape(
    panel: { contains(node: Node | null): boolean } | null,
    target: EventTarget | null,
    body: EventTarget | null
): boolean {
    if (panel == null || target == null || target === body || (target as Partial<Node>).nodeType !== 1) {
        return true;
    }
    return panel.contains(target as Node);
}
```

In `frontend/app/modals/modalshell.tsx`, import `shellOwnsEscape` beside `takeModalFocus` and change the Escape branch
of the key listener to:

```ts
            if (e.key === "Escape") {
                // a popover portaled out of the panel closes itself; the dialog under it stays
                if (!shellOwnsEscape(panelRef.current, e.target, document.body)) {
                    return;
                }
                onClose();
            } else if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
```

- [ ] **Step 4: One open atom, and every opener through openLauncher**

`frontend/app/view/agents/agents.tsx`: add `import type { LauncherKind } from "./launcher";` and replace

```ts
    // New Project / New Agent / New run modal + command-palette visibility (gated overlays rendered from the cockpit root).
    newProjectOpenAtom = atom(false);
    newAgentOpenAtom = atom(false);
    newRunOpenAtom = atom(false);
```

with

```ts
    // New Project / the New launcher / New initiative + command-palette visibility (gated overlays rendered from the
    // cockpit root). launcherAtom holds the door that opened the launcher (agent or run), null while it is closed.
    newProjectOpenAtom = atom(false);
    launcherAtom = atom<LauncherKind | null>(null);
```

`frontend/app/store/keybindings/dispatcher.ts`: replace the two lines `globalStore.get(model.newAgentOpenAtom) ||` and
`globalStore.get(model.newRunOpenAtom) ||` with `globalStore.get(model.launcherAtom) != null ||`.

`frontend/app/store/keybindings/bindings.ts`: add `import { openLauncher } from "@/app/view/agents/launcherstore";`; the
`new-agent` binding's `run` becomes `() => openLauncher(model, "agent")` and the `new-run` binding's
`() => openLauncher(model, "run")`.

`frontend/app/cockpit/app-bar.tsx`: add the same import; the New run button's `onClick` becomes
`() => openLauncher(model, "run")` (keep `data-new-run`: the Brief's `r` presses it) and the New agent button's
`() => openLauncher(model, "agent")`. `globalStore` stays imported only if something else in the file still uses it.

`frontend/app/cockpit/command-palette.tsx`: replace the `import { newRunPrefillAtom } from "@/app/view/jarvis/newruncontrol";`
line with `import { openLauncher } from "@/app/view/agents/launcherstore";`. In `startItems` replace the `opens` record
and its use:

```tsx
        const opens: Record<StartId, () => void> = {
            run: () => openLauncher(model, "run"),
            agent: () => openLauncher(model, "agent"),
            initiative: () => globalStore.set(model.newInitiativeOpenAtom, true),
        };
```

and in its `run:` `close(); opens[d.id]();`. In the launch deps, `open` becomes:

```tsx
            // the dialog fills the prefill in once its project list loads
            open: (goal, shape) => {
                close();
                openLauncher(model, "run", { projectName, goal, shape });
            },
```

Drop `type PrimitiveAtom` from the `jotai` import if nothing else in the file uses it.

`frontend/app/cockpit/actions/project.ts`: replace the `newRunPrefillAtom` import with the `openLauncher` import; the
"New run in it" action's `run` becomes
`(p, { model }) => openLauncher(model, "run", { projectName: p.name, goal: "", shape: "orchestrator" })`.

`frontend/app/view/agents/canvaspane.tsx`: replace the `newRunPrefillAtom` import with
`import { openLauncher } from "./launcherstore";` and `openBuildRun`'s body with:

```tsx
    openLauncher(model, "run", {
        projectName: projectOf(agent),
        goal: buildGoal(s.dir, shownBoards(s)),
        shape: "orchestrator",
        prototype: prototypePath(s.dir, shownBoards(s)),
    });
```

and update its comment to "the New dialog opens on Orchestrate in the agent's project, with this canvas as the run's
prototype". Remove the `globalStore` import if it is now unused.

Each of these `globalStore.set(model.newAgentOpenAtom, true)` calls becomes `openLauncher(model, "agent")`, with the
`openLauncher` import added and `globalStore`'s import removed where nothing else uses it:
`frontend/app/view/agents/agentheader.tsx` (~line 183), `frontend/app/view/agents/agentlaunchhero.tsx` (line 34;
`globalStore` goes), `frontend/app/view/agents/filessurface.tsx` (~line 379), `frontend/app/view/agents/cockpitsurface.tsx`
(~line 538), `frontend/app/view/agents/conversationhistory.tsx` (~line 332; `globalStore` goes) and
`frontend/app/cockpit/cockpit-actions.ts` (`launchPiTab`'s no-cwd fallback, ~line 156).

`frontend/app/view/agents/naflagsstore.ts`: in its three comments, "NewAgentModal" / "the New Agent modal" / "New Agent
open" become "the New launcher" / "the New launcher" / "New launcher open".

- [ ] **Step 5: The agent details**

Create `frontend/app/view/agents/launcheragentfields.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's details for an agent row: the task, the command with its flags, and the worktree. Moved out of
// the old New agent dialog. The task field is always there (it hid behind "+ Start with a task") so Tab lands in it.
// Whether the flag menu or the branch list is open lives in launcherstore, so the dialog's one key handler closes the
// open one on Escape wherever focus is, and the dialog stays.

import { composerReveal } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, Plus, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import {
    RUNTIME_FLAGS,
    runtimeShowsTask,
    runtimeStartupCommand,
    runtimeSupportsWorktree,
    worktreeOutcome,
    type Runtime,
} from "./launch";
import {
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherTaskAtom,
    launcherWorktreeAtom,
} from "./launcherstore";
import { naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";

export const LAUNCHER_LABEL = "text-[10px] font-semibold uppercase tracking-[0.1em] text-muted";

// The project's branches, newest first, for the worktree field, and its checked-out branch for the field's default
// and the footer. A project that is not a repo reads as no branches and no current branch.
export function useProjectBranches(
    open: boolean,
    projectPath: string,
    wantList: boolean
): { currentBranch: string; branches: BranchInfo[] } {
    const [currentBranch, setCurrentBranch] = useState("");
    const [branches, setBranches] = useState<BranchInfo[]>([]);
    useEffect(() => {
        if (!open || !wantList || !projectPath) {
            setBranches([]);
            return;
        }
        let cancelled = false;
        RpcApi.ListBranchesCommand(TabRpcClient, { projectpath: projectPath })
            .then((rtn) => {
                if (!cancelled) {
                    setBranches(rtn.branches ?? []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setBranches([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [open, wantList, projectPath]);
    useEffect(() => {
        if (!open || !projectPath) {
            setCurrentBranch("");
            return;
        }
        let cancelled = false;
        RpcApi.GitChangesCommand(TabRpcClient, { cwd: projectPath })
            .then((rtn) => {
                if (!cancelled) {
                    setCurrentBranch(rtn?.branch ?? "");
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setCurrentBranch("");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [open, projectPath]);
    return { currentBranch, branches };
}

interface AgentFieldsProps {
    runtime: Runtime;
    currentBranch: string;
    branches: BranchInfo[];
    ramWarning: string | null;
}

export function AgentFields({ runtime, currentBranch, branches, ramWarning }: AgentFieldsProps) {
    const task = useAtomValue(launcherTaskAtom);
    const commands = useAtomValue(launcherCommandAtom);
    const naFlags = useAtomValue(naFlagsAtom);
    const remember = useAtomValue(naRememberFlagsAtom);
    const worktreeOn = useAtomValue(launcherWorktreeAtom);
    const branchPick = useAtomValue(launcherBranchAtom);
    const flagMenuOpen = useAtomValue(launcherFlagMenuAtom);
    const branchListOpen = useAtomValue(launcherBranchListAtom);
    const setFlagMenuOpen = (open: boolean) => globalStore.set(launcherFlagMenuAtom, open);
    const setBranchListOpen = (open: boolean) => globalStore.set(launcherBranchListAtom, open);
    // another runtime has other flags and maybe no worktree: start it with both popovers shut
    useEffect(() => {
        globalStore.set(launcherFlagMenuAtom, false);
        globalStore.set(launcherBranchListAtom, false);
    }, [runtime]);
    const startup = commands[runtime] ?? runtimeStartupCommand(runtime);
    const setStartup = (value: string) =>
        globalStore.set(launcherCommandAtom, (prev) => ({ ...prev, [runtime]: value }));
    // flag state is per runtime: read and write only the picked runtime's record
    const flagCatalog = RUNTIME_FLAGS[runtime];
    const runtimeFlags = naFlags[runtime] ?? {};
    const enabledFlags = flagCatalog.filter((f) => runtimeFlags[f.id]);
    const setFlag = (id: string, on: boolean) =>
        globalStore.set(naFlagsAtom, (prev) => ({ ...prev, [runtime]: { ...prev[runtime], [id]: on } }));
    // the field shows the project's checked-out branch until one is typed or picked
    const effectiveBranch = branchPick ?? currentBranch;
    const branchNames = branches.map((b) => b.name);
    return (
        <>
            {runtimeShowsTask(runtime) ? (
                <div className="flex flex-col gap-2">
                    <div className="flex items-baseline gap-2">
                        <label htmlFor="launcher-task" className={LAUNCHER_LABEL}>
                            Task
                        </label>
                        <span className="text-[11px] text-muted">optional · sent as the first prompt</span>
                    </div>
                    <textarea
                        id="launcher-task"
                        value={task}
                        onChange={(e) => globalStore.set(launcherTaskAtom, e.target.value)}
                        placeholder="What should it work on? Leave empty to just open the session."
                        className="block h-16 w-full resize-none rounded-[10px] border border-edge-mid bg-surface px-3 py-[10px] text-[13px] leading-normal text-primary outline-none placeholder:text-muted focus:border-accent-700"
                    />
                </div>
            ) : null}
            <div className="flex flex-col gap-2">
                <label htmlFor="launcher-cmd" className={LAUNCHER_LABEL}>
                    Command
                </label>
                <div className="flex min-h-[38px] flex-wrap items-center gap-[6px] rounded-[8px] border border-edge-mid bg-surface py-[5px] pl-3 pr-[6px] focus-within:border-accent-700">
                    <span className="font-mono text-[12.5px] font-semibold text-success">›</span>
                    <input
                        id="launcher-cmd"
                        value={startup}
                        onChange={(e) => setStartup(e.target.value)}
                        placeholder={runtime === "terminal" ? "default shell" : runtimeStartupCommand(runtime)}
                        style={{ width: `${Math.max(startup.length + 1, runtime === "terminal" && !startup ? 14 : 4)}ch` }}
                        className="bg-transparent font-mono text-[12.5px] text-secondary outline-none"
                    />
                    {enabledFlags.map((f) => (
                        <span
                            key={f.id}
                            title={f.desc}
                            className="flex items-center gap-0.5 rounded-[6px] border border-accent-700 bg-accentbg py-0.5 pl-2 pr-0.5"
                        >
                            <span className="font-mono text-[11.5px] font-semibold text-accent-soft">{f.flag}</span>
                            <button
                                type="button"
                                aria-label={`Remove ${f.flag}`}
                                onClick={() => setFlag(f.id, false)}
                                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:text-primary"
                            >
                                <X size={11} strokeWidth={2.4} />
                            </button>
                        </span>
                    ))}
                    <div className="flex-1" />
                    {flagCatalog.length > 0 ? (
                        <button
                            type="button"
                            aria-expanded={flagMenuOpen}
                            onClick={() => setFlagMenuOpen(!flagMenuOpen)}
                            className={cn(
                                "flex cursor-pointer items-center gap-[5px] rounded-[6px] px-2 py-1 text-[11.5px] font-semibold",
                                flagMenuOpen
                                    ? "bg-accentbg text-accent-soft"
                                    : "text-ink-mid hover:bg-surface-hover hover:text-primary"
                            )}
                        >
                            <Plus size={12} strokeWidth={2.2} />
                            <span>Flag</span>
                        </button>
                    ) : null}
                </div>
                <AnimatePresence>
                    {flagMenuOpen && flagCatalog.length > 0 && (
                        <motion.div
                            variants={composerReveal}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="flex flex-col overflow-hidden rounded-[10px] border border-edge-mid bg-surface p-1"
                        >
                            {flagCatalog.map((f) => {
                                const on = !!runtimeFlags[f.id];
                                return (
                                    <label
                                        key={f.id}
                                        className={cn(
                                            "flex cursor-pointer items-center gap-[10px] rounded-[7px] px-2 py-[6px]",
                                            on ? "bg-accentbg" : "hover:bg-surface-hover"
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            onChange={() => setFlag(f.id, !on)}
                                            className="m-0 h-[13px] w-[13px] cursor-pointer accent-accent"
                                        />
                                        <span
                                            className={cn(
                                                "shrink-0 font-mono text-[11.5px] font-semibold",
                                                on ? "text-accent-soft" : "text-muted-foreground"
                                            )}
                                        >
                                            {f.flag}
                                        </span>
                                        <span className="flex-1 truncate text-right text-[11px] text-muted">{f.desc}</span>
                                    </label>
                                );
                            })}
                            <label className="-mx-1 -mb-1 mt-1 flex cursor-pointer items-center gap-1.5 border-t border-border px-3 py-[7px] text-[11.5px] text-muted">
                                <input
                                    type="checkbox"
                                    checked={remember}
                                    onChange={() => globalStore.set(naRememberFlagsAtom, (v) => !v)}
                                    className="m-0 h-[13px] w-[13px] cursor-pointer accent-accent"
                                />
                                <span>Remember these flags for the next agent</span>
                            </label>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            {runtime === "terminal" ? (
                <span className="text-[11.5px] text-muted">A plain shell in the project folder. No agent, no task.</span>
            ) : null}
            {runtimeSupportsWorktree(runtime) ? (
                <div className="flex flex-col gap-[7px]">
                    <div className="flex min-h-[34px] items-center gap-3">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={worktreeOn}
                            onClick={() => globalStore.set(launcherWorktreeAtom, (v) => !v)}
                            className="flex cursor-pointer items-center gap-[10px]"
                        >
                            <span
                                className={cn(
                                    "relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors",
                                    worktreeOn ? "bg-accent" : "bg-edge-strong"
                                )}
                            >
                                <span
                                    className={cn(
                                        "absolute top-[3px] h-[14px] w-[14px] rounded-full bg-background transition-all",
                                        worktreeOn ? "left-[18px]" : "left-[2px]"
                                    )}
                                />
                            </span>
                            <span className="whitespace-nowrap text-[12.5px] font-medium text-secondary">
                                Isolated git worktree
                            </span>
                        </button>
                        {worktreeOn ? (
                            <div className="relative flex min-w-0 flex-1 items-center gap-2">
                                <span className="text-[11.5px] text-muted">on branch</span>
                                <div className="flex min-w-0 flex-1 items-center rounded-[8px] border border-edge-mid bg-surface focus-within:border-accent-700">
                                    <input
                                        aria-label="Branch"
                                        value={effectiveBranch}
                                        onChange={(e) => globalStore.set(launcherBranchAtom, e.target.value)}
                                        onFocus={() => setBranchListOpen(true)}
                                        placeholder={currentBranch || "feat/new-agent"}
                                        className="min-w-0 flex-1 bg-transparent px-[10px] py-[7px] text-[12.5px] text-secondary outline-none"
                                    />
                                    {branches.length > 0 ? (
                                        <button
                                            type="button"
                                            aria-label="Show branches"
                                            onClick={() => setBranchListOpen(!branchListOpen)}
                                            className="cursor-pointer px-[10px] py-[7px] text-muted hover:text-primary"
                                        >
                                            <ChevronDown size={12} />
                                        </button>
                                    ) : null}
                                </div>
                                <PopoverReveal
                                    open={branchListOpen && branches.length > 0}
                                    origin="bottom left"
                                    className="absolute bottom-full left-[64px] right-0 z-10 mb-1 max-h-[168px] overflow-y-auto rounded border border-edge-mid bg-modalbg py-1 shadow-popover"
                                >
                                    {branches.map((b) => (
                                        <button
                                            key={b.name}
                                            type="button"
                                            onClick={() => {
                                                globalStore.set(launcherBranchAtom, b.name);
                                                setBranchListOpen(false);
                                            }}
                                            className={cn(
                                                "flex w-full cursor-pointer items-center gap-2 px-3 py-[7px] text-left hover:bg-surface-hover",
                                                b.name === effectiveBranch ? "text-primary" : "text-secondary"
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    "h-[6px] w-[6px] shrink-0 rounded-full",
                                                    b.name === effectiveBranch ? "bg-accent" : "bg-muted"
                                                )}
                                            />
                                            <span className="flex-1 truncate text-[12px]">{b.name}</span>
                                            {b.age ? (
                                                <span className="shrink-0 text-[10.5px] text-muted">{b.age}</span>
                                            ) : null}
                                        </button>
                                    ))}
                                </PopoverReveal>
                            </div>
                        ) : null}
                    </div>
                    {worktreeOn ? (
                        <span className="pl-[44px] text-[11.5px] text-muted">
                            {worktreeOutcome({ branch: effectiveBranch, currentBranch, branchNames })}
                        </span>
                    ) : null}
                </div>
            ) : null}
            {ramWarning ? (
                <div data-ram-warn className="flex items-center gap-1.5 text-[12px] text-warning">
                    <TriangleAlert size={13} className="shrink-0" />
                    <span>{ramWarning}</span>
                </div>
            ) : null}
        </>
    );
}
```

- [ ] **Step 6: The run details**

In `frontend/app/view/agents/runlauncher.tsx`, export `pickTone` and `START_LABEL` (add `export` to each; nothing else
changes): the dialog's Start from buttons are the Brief launcher's, "A goal" / "A plan file" in `pickTone` (spec
"Details, per pick").

Create `frontend/app/view/agents/launcherrunfields.tsx`. `PlanTable`, `PlanPane`, `MODEL_TONE`, `PLAN_GRID` and the
`RoutePicker` props are moved from `newruncontrol.tsx` unchanged, except that the plan input loses `autoFocus` (focus
opens on the Start column) and the table holds its own scroll (`max-h-[240px]`). `CapacityWarn` sits on the line
under the Start from / Workers at once row with its reason beside it, as the spec and the Orchestrate board place it:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's details for a run row. Quick: the goal and the lead model. Orchestrate: where it starts (a goal
// or a plan file) and how wide, then the goal or the plan with its preview, then the three route pickers. Every
// control writes the run launcher's own atoms (runconfigstore), the same ones the Brief's launcher reads.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { TriangleAlert, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import {
    planMixLine,
    planModelRows,
    workersModelName,
    type PlanModelTone,
    type WorkersSetting,
} from "../jarvis/newrunplan";
import { planShapeText, planWarnings } from "../orchestrate/dagdigest";
import { CapacityWarn } from "./capacitywarn";
import { LAUNCHER_LABEL } from "./launcheragentfields";
import { launcherGoalAtom, launcherPrototypeAtom } from "./launcherstore";
import { RoutePicker } from "./routepicker";
import { START_OPTIONS, startNote, type StartFrom } from "./runconfig";
import {
    parallelismAtom,
    planPathAtom,
    reviewerPicksAtom,
    reviewerRouteAtom,
    routeOpenRequestAtom,
    runRouteAtom,
    runShapeAtom,
    setPlanPath,
    setReviewerPicks,
    setReviewerRoute,
    setRunRoute,
    setStart,
    setWorkerRoute,
    startAtom,
    stepParallelism,
    workerRouteAtom,
} from "./runconfigstore";
import { pickTone, START_LABEL, usePlanPreview, WorkerStepper } from "./runlauncher";
import { capacityWarnTitle, extraWorkers, overCapacity } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

// RoutePicker caps its trigger for the inline rows it usually sits in; a Models column gives it the column
const FULL_WIDTH_PICKER =
    "min-w-0 [&>div]:w-full [&>div>button]:w-full [&>div>button]:max-w-none [&>div>button]:justify-between";
const PLAN_GRID = "grid grid-cols-[40px_minmax(0,1fr)_44px_96px_112px] gap-x-2.5 px-3";
const MODEL_TONE: Record<PlanModelTone, string> = {
    "plan-live": "text-accent-soft",
    "plan-ignored": "text-ink-faint line-through",
    "at-review": "text-muted",
    workers: "text-ink-mid",
};
const FIELD =
    "block w-full resize-none rounded-[10px] border border-edge-mid bg-surface px-3 py-[10px] text-[13px] leading-normal text-primary outline-none placeholder:text-muted focus:border-accent-700";

// the Brief launcher's own Start from buttons, side by side on the Workers row
function StartToggle({ start }: { start: StartFrom }) {
    return (
        <div role="group" aria-label="Start from" className="flex flex-none gap-1.5">
            {START_OPTIONS.map((option) => (
                <button
                    key={option}
                    type="button"
                    aria-pressed={start === option}
                    onClick={() => setStart(option)}
                    className={cn(
                        "cursor-pointer rounded-[7px] border px-3 py-[5px] text-[11.5px] font-semibold",
                        pickTone(start === option)
                    )}
                >
                    {START_LABEL[option]}
                </button>
            ))}
        </div>
    );
}

function PlanTable({ result, workers }: { result: CommandDagPlanPreviewRtnData; workers: WorkersSetting }) {
    const tasks = result.tasks ?? [];
    const mix = planMixLine(tasks, workers);
    return (
        <div data-jarvis-plan-preview="ready" className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2.5">
                {result.title ? (
                    <span className="min-w-0 truncate text-[14px] font-semibold text-ink-hi">{result.title}</span>
                ) : null}
                <span className="flex-none text-[10.5px] tabular-nums text-ink-mid">{planShapeText(result.shape)}</span>
                <span
                    className={cn(
                        "ml-auto flex-none text-[10.5px] tabular-nums",
                        mix.accent ? "text-accent-soft" : "text-ink-mid"
                    )}
                >
                    {mix.text}
                </span>
            </div>
            {planWarnings(result.shape, result.verify).map((warning) => (
                <span key={warning} className="text-[10.5px] text-warning">
                    {warning}
                </span>
            ))}
            <div className="max-h-[240px] overflow-y-auto rounded-[8px] border border-border bg-surface">
                <div
                    className={cn(
                        PLAN_GRID,
                        "sticky top-0 border-b border-border bg-surface py-1.5 text-[10px] uppercase tracking-[.08em] text-muted"
                    )}
                >
                    <span>task</span>
                    <span>title</span>
                    <span>lane</span>
                    <span>needs</span>
                    <span>model</span>
                </div>
                {planModelRows(tasks, workers).map((row, i) => (
                    <div
                        key={row.id}
                        className={cn(PLAN_GRID, "items-center py-1.5", i > 0 && "border-t border-edge-faint")}
                    >
                        <span className="text-[10.5px] text-muted">{row.id}</span>
                        <span className="truncate text-[12px] text-ink-hi">{row.title}</span>
                        <span className="text-[10.5px] tabular-nums text-ink-mid">{row.lane}</span>
                        <span className="truncate text-[10.5px] text-muted">{row.needs}</span>
                        <span title={row.model} className={cn("truncate text-[10.5px]", MODEL_TONE[row.tone])}>
                            {row.model}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// The plan is parsed here, before anything is created: a plan that will not run shows the parser's message in place
// of the table and holds the start.
function PlanPane({
    projectPath,
    workers,
    inputRef,
}: {
    projectPath: string;
    workers: WorkersSetting;
    inputRef: RefObject<HTMLInputElement>;
}) {
    const path = useAtomValue(planPathAtom);
    const current = usePlanPreview(path, projectPath);
    return (
        <>
            <input
                ref={inputRef}
                data-jarvis-plan-path
                value={path}
                aria-label="Plan file path"
                onChange={(e) => setPlanPath(e.target.value)}
                placeholder="Plan path, absolute or relative to the project"
                className="w-full rounded-[8px] border border-edge-mid bg-surface px-3 py-[9px] text-[12.5px] text-primary outline-none placeholder:text-muted focus:border-accent-700"
            />
            {current?.error != null ? (
                <span data-jarvis-plan-preview="error" className="text-[11px] leading-[1.45] text-error">
                    {current.error}
                </span>
            ) : current?.result != null ? (
                <PlanTable result={current.result} workers={workers} />
            ) : null}
        </>
    );
}

function ModelPick({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <span className={LAUNCHER_LABEL}>{label}</span>
            <div className={FULL_WIDTH_PICKER}>{children}</div>
        </div>
    );
}

function RunModels({ orchestrator }: { orchestrator: boolean }) {
    const route = useAtomValue(runRouteAtom);
    const workerRoute = useAtomValue(workerRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const reviewerRoute = useAtomValue(reviewerRouteAtom);
    const openRequest = useAtomValue(routeOpenRequestAtom);
    const lead = (
        <RoutePicker
            value={route}
            onChange={setRunRoute}
            placement="bottom-start"
            openRequest={openRequest}
            title="Lead model"
        />
    );
    if (!orchestrator) {
        return (
            <div className="flex items-center gap-2.5">
                <span className={cn(LAUNCHER_LABEL, "w-16 flex-none")}>Model</span>
                <div className="min-w-0">{lead}</div>
            </div>
        );
    }
    return (
        <div className="grid grid-cols-3 gap-2.5">
            <ModelPick label="Lead">{lead}</ModelPick>
            <ModelPick label="Workers">
                <RoutePicker
                    value={workerRoute}
                    onChange={setWorkerRoute}
                    placement="bottom-start"
                    title="Workers model"
                    canInherit
                    inheritedLabel="Same as lead"
                    extraOption={{
                        label: "Reviewer picks",
                        selected: reviewerPicks,
                        onSelect: () => setReviewerPicks(true),
                    }}
                />
            </ModelPick>
            <ModelPick label="Reviewers">
                <RoutePicker
                    value={reviewerRoute}
                    onChange={setReviewerRoute}
                    placement="bottom-start"
                    title="Reviewers model"
                    canInherit
                    inheritedLabel="Same as lead"
                />
            </ModelPick>
        </div>
    );
}

interface RunFieldsProps {
    projectPath: string;
    goalRef: RefObject<HTMLTextAreaElement>;
    planRef: RefObject<HTMLInputElement>;
    // a Quick run's low-RAM line; an orchestrator warns on the line under its stepper instead
    ramWarning: string | null;
}

export function RunFields({ projectPath, goalRef, planRef, ramWarning }: RunFieldsProps) {
    const shape = useAtomValue(runShapeAtom);
    const start = useAtomValue(startAtom);
    const parallelism = useAtomValue(parallelismAtom);
    const workerRoute = useAtomValue(workerRouteAtom);
    const runRoute = useAtomValue(runRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const goal = useAtomValue(launcherGoalAtom);
    const prototype = useAtomValue(launcherPrototypeAtom);
    const cap = useWorkerCapacity();
    const extra = extraWorkers(parallelism);
    const orchestrator = shape === "orchestrator";
    const over = overCapacity(cap, extra);
    // a plan start is named by its plan, so it has no goal field
    const planStart = orchestrator && start === "plan";
    return (
        <>
            {orchestrator ? (
                <div className="flex items-center gap-3">
                    <span className={LAUNCHER_LABEL}>Start from</span>
                    <StartToggle start={start} />
                    <div className="flex-1" />
                    <span className="text-[12px] text-ink-mid">Workers at once</span>
                    <div className="flex items-center gap-1.5">
                        <WorkerStepper value={parallelism} onStep={stepParallelism} warn={over} />
                    </div>
                </div>
            ) : null}
            {orchestrator && cap != null && over ? (
                // the line under the stepper (spec, Orchestrate board): the mark with its reason spelled out
                <div className="-mt-1.5 flex items-center justify-end gap-1.5 text-[11.5px] text-warning">
                    <CapacityWarn cap={cap} extra={extra} />
                    <span>{capacityWarnTitle(cap)}</span>
                </div>
            ) : null}
            {planStart ? (
                <div className="flex flex-col gap-2">
                    <PlanPane
                        projectPath={projectPath}
                        workers={{ picks: reviewerPicks, model: workersModelName(workerRoute, runRoute) }}
                        inputRef={planRef}
                    />
                    <span className="text-[11px] leading-[1.45] text-muted">{startNote("plan")}</span>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {orchestrator ? null : (
                        <div className="flex items-baseline gap-2">
                            <label htmlFor="launcher-goal" className={LAUNCHER_LABEL}>
                                Goal
                            </label>
                            <span className="text-[11px] text-muted">
                                one fresh worker; it stops and asks if the goal turns out bigger
                            </span>
                        </div>
                    )}
                    <textarea
                        id="launcher-goal"
                        ref={goalRef}
                        aria-label="Goal"
                        value={goal}
                        onChange={(e) => globalStore.set(launcherGoalAtom, e.target.value)}
                        placeholder="What should it do?"
                        className={cn(FIELD, orchestrator ? "h-24" : "h-28")}
                    />
                    {orchestrator ? (
                        <span className="text-[11px] leading-[1.45] text-muted">{startNote("goal")}</span>
                    ) : null}
                </div>
            )}
            <RunModels orchestrator={orchestrator} />
            {orchestrator && prototype !== "" ? (
                <div data-launcher-prototype className="flex items-center gap-1.5">
                    <span title={prototype} className="min-w-0 truncate text-[11px] text-muted">
                        Prototype · {prototype}
                    </span>
                    <button
                        type="button"
                        aria-label="Remove prototype"
                        onClick={() => globalStore.set(launcherPrototypeAtom, "")}
                        className="flex flex-none cursor-pointer items-center text-muted hover:text-primary"
                    >
                        <X size={12} aria-hidden />
                    </button>
                </div>
            ) : null}
            {ramWarning ? (
                <div data-ram-warn className="flex items-center gap-1.5 text-[12px] text-warning">
                    <TriangleAlert size={13} className="shrink-0" />
                    <span>{ramWarning}</span>
                </div>
            ) : null}
        </>
    );
}
```

- [ ] **Step 7: The dialog**

Create `frontend/app/view/agents/launchermodal.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher: one dialog that starts an agent, a terminal or a run
// (docs/superpowers/specs/2026-10-08-new-launcher-design.md). It replaced the New agent dialog and the New run window.
// The Start column picks what, the Project column where, the details below fill in the rest. Digits pick in the
// focused column and Tab walks the dialog without leaving it. Every close keeps the draft (launcherstore), which is
// what lets a click outside close it.
//
// The open state is model.launcherAtom, so deriveKeyContext counts the dialog as a modal. The Brief's `r` presses the
// app bar's [data-new-run] button, which opens it at the run door.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { DialogButton } from "@/app/modals/dialogbutton";
import { focusTrapTarget } from "@/app/modals/modalfocus";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { resolveChannelTarget, type NewRunPrefill, type RunConfig } from "@/app/view/jarvis/newrun";
import { openTarget } from "@/app/view/jarvis/openref";
import { homeFromInfo, projectWhere } from "@/app/view/jarvis/projectpicker";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, Network, Search, SquareTerminal, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { channelsAtom, primeChannels } from "./channelsstore";
import { harnessPreferenceAtom, harnessesAtom, resolveDefaultRuntime } from "./harnessstore";
import {
    composeStartupCommand,
    deriveBranch,
    RUNTIME_FLAGS,
    runtimeShowsTask,
    runtimeStartupCommand,
    runtimeSupportsWorktree,
    type Runtime,
} from "./launch";
import {
    agentRuntime,
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
    type FocusZone,
    type LauncherKind,
    type StartRow,
    type StartRowId,
} from "./launcher";
import { AgentFields, LAUNCHER_LABEL, useProjectBranches } from "./launcheragentfields";
import { startLauncherRun } from "./launcherrun";
import { RunFields } from "./launcherrunfields";
import {
    applyLauncherPrefill,
    beginLauncherLaunch,
    clearLauncherDraft,
    closeLauncher,
    endLauncherDraft,
    endLauncherLaunch,
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherBusyAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherGoalAtom,
    launcherKindAtom,
    launcherPrefillAtom,
    launcherProjectAtom,
    launcherPrototypeAtom,
    launcherRestoredAtom,
    launcherRuntimeAtom,
    launcherTaskAtom,
    launcherWorktreeAtom,
    openLauncher,
    pickLauncherProject,
} from "./launcherstore";
import { naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";
import { noteRecentProject, projectListAtom, recentFirst, recentProjectsAtom, type ProjectRow } from "./projectsstore";
import { channelOverrideAtom, loadResolvedProfile, resolvedProfileAtom } from "./runactions";
import { launchBlocker, type RunShape } from "./runconfig";
import {
    hydrateRunConfigFromProfile,
    parallelismAtom,
    planPathAtom,
    planPreviewAtom,
    resetRunConfigForChannel,
    reviewerPicksAtom,
    reviewerRouteAtom,
    routeTouchedAtom,
    runRouteAtom,
    runShapeAtom,
    setRunShape,
    startAtom,
    workerRouteAtom,
} from "./runconfigstore";
import { RuntimeMark } from "./runtimemark";
import { newAgentRamWarning } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

// Tab's stops, in DOM order; the close button is tabIndex -1 because Esc does the same
const FOCUSABLE =
    'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
const KEY_LEGEND = "rounded-[4px] border border-edge-mid bg-surface px-[5px] py-px font-mono text-[10px] text-ink-mid";

function rowTone(selected: boolean, focused: boolean): string {
    return cn(
        "flex cursor-pointer items-center rounded-[7px] px-2",
        selected ? "bg-surface-selected" : "hover:bg-surface-hover",
        // the selected row of the focused column is the keyboard's cursor
        selected && focused && "ring-1 ring-inset ring-accent-700"
    );
}

// A row's digit. It brightens while its column has focus, which is how the eye finds where a digit will land.
function Keycap({ k, lit }: { k: string; lit: boolean }) {
    if (k === "") {
        return <span aria-hidden className="w-[18px] shrink-0" />;
    }
    return (
        <span
            aria-hidden
            className={cn(
                "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border font-mono text-[10px]",
                lit ? "border-edge-strong bg-surface text-ink-hi" : "border-border text-muted"
            )}
        >
            {k}
        </span>
    );
}

function ColumnLabel({
    label,
    hint,
    focused,
    className,
}: {
    label: string;
    hint?: string;
    focused: boolean;
    className?: string;
}) {
    return (
        <div className={cn("flex items-baseline gap-2 px-2 pb-[7px] pt-0.5", className)}>
            <span className={cn(LAUNCHER_LABEL, "flex-1", focused && "text-secondary")}>{label}</span>
            {hint ? <span className="text-[10.5px] text-muted">{hint}</span> : null}
        </div>
    );
}

function StartMark({ id }: { id: StartRowId }) {
    if (id === "terminal") {
        return <SquareTerminal size={16} strokeWidth={1.8} className="text-ink-mid" />;
    }
    if (id === "quick") {
        return <Zap size={15} strokeWidth={1.8} className="text-ink-mid" />;
    }
    if (id === "orchestrator") {
        return <Network size={15} strokeWidth={1.8} className="text-ink-mid" />;
    }
    return (
        <RuntimeMark runtime={id} className="text-[12px] font-bold text-accent-soft" imageClassName="h-4 w-4 rounded-[3px]" />
    );
}

export function LauncherModal({ model }: { model: AgentsViewModel }) {
    const door = useAtomValue(model.launcherAtom);
    const open = door != null;
    const rows = useAtomValue(projectListAtom);
    const recent = useAtomValue(recentProjectsAtom);
    const harnesses = useAtomValue(harnessesAtom);
    const channels = useAtomValue(channelsAtom);
    const profiles = useAtomValue(resolvedProfileAtom);
    const overrides = useAtomValue(channelOverrideAtom);
    const pref = useAtomValue(harnessPreferenceAtom);
    const kind = useAtomValue(launcherKindAtom);
    const remembered = useAtomValue(launcherRuntimeAtom);
    const pickedName = useAtomValue(launcherProjectAtom);
    const task = useAtomValue(launcherTaskAtom);
    const goal = useAtomValue(launcherGoalAtom);
    const prototype = useAtomValue(launcherPrototypeAtom);
    const worktreeOn = useAtomValue(launcherWorktreeAtom);
    const branchPick = useAtomValue(launcherBranchAtom);
    const commands = useAtomValue(launcherCommandAtom);
    const naFlags = useAtomValue(naFlagsAtom);
    const restored = useAtomValue(launcherRestoredAtom);
    const busy = useAtomValue(launcherBusyAtom);
    const prefill = useAtomValue(launcherPrefillAtom);
    const flagMenuOpen = useAtomValue(launcherFlagMenuAtom);
    const branchListOpen = useAtomValue(launcherBranchListAtom);
    const shape = useAtomValue(runShapeAtom);
    const start = useAtomValue(startAtom);
    const planPath = useAtomValue(planPathAtom);
    const preview = useAtomValue(planPreviewAtom);
    const parallelism = useAtomValue(parallelismAtom);
    const workerRoute = useAtomValue(workerRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const reviewerRoute = useAtomValue(reviewerRouteAtom);
    const runRoute = useAtomValue(runRouteAtom);
    const routeTouched = useAtomValue(routeTouchedAtom);
    const cap = useWorkerCapacity();
    const [zone, setZone] = useState<"start" | "project" | null>(null);
    const [filter, setFilter] = useState("");
    const [home, setHome] = useState("");
    const [error, setError] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const startRef = useRef<HTMLDivElement>(null);
    const projectRef = useRef<HTMLDivElement>(null);
    const goalRef = useRef<HTMLTextAreaElement>(null);
    const planRef = useRef<HTMLInputElement>(null);

    const startList = useMemo(() => startRows(harnesses), [harnesses]);
    const runtime = agentRuntime(startList, remembered);
    const selectedRow = selectedRowId(kind, runtime, shape);
    const isRun = kind === "run";
    const candidates = useMemo(() => recentFirst(rows, recent), [rows, recent]);
    const visible = filterProjects(candidates, filter);
    const project = selectedProject(candidates, pickedName);
    const projectPath = project?.path ?? "";
    const { currentBranch, branches } = useProjectBranches(
        open && !isRun,
        projectPath,
        runtimeSupportsWorktree(runtime)
    );
    const branchNames = branches.map((b) => b.name);
    const wantsWorktree = !isRun && worktreeOn && runtimeSupportsWorktree(runtime);
    const chosenBranch = (branchPick ?? currentBranch).trim();
    // git can't reuse the checked-out branch for a worktree; branch a fresh one off it instead
    const landingBranch = chosenBranch === currentBranch ? deriveBranch(currentBranch, branchNames) : chosenBranch;
    const branchNote = wantsWorktree
        ? chosenBranch && `worktree on ${landingBranch}`
        : currentBranch && `on ${currentBranch}`;
    const blocker = isRun ? launchBlocker({ shape, start, goal, planPath, preview }) : null;
    const footer = footerLine({ kind, shape, parallelism, project, branchNote, blocker });
    const config: RunConfig = {
        shape,
        parallelism,
        workerRoute,
        start,
        planPath,
        reviewerPicks,
        reviewerRoute,
        prototype,
    };
    // the project's own channel is where its profile lives; null while the channel list is still loading
    const target = isRun && project != null ? resolveChannelTarget(channels, project.name, project.path) : null;
    const pickedOid = target?.kind === "existing" ? target.oid : null;
    const profileRoute = (pickedOid != null ? overrides[pickedOid]?.route : null) ?? pref.route ?? null;
    const ramWarning = isRun
        ? shape === "quick"
            ? newAgentRamWarning(cap, "run", "worker")
            : null
        : newAgentRamWarning(cap, runtime);
    const primaryDisabled = project == null || blocker != null || busy;
    // what an Escape closes first: a popover only while it is drawn (a branch list with no branches draws nothing)
    const flagMenuShown = !isRun && flagMenuOpen && RUNTIME_FLAGS[runtime].length > 0;
    const branchListShown = wantsWorktree && branchListOpen && branches.length > 0;

    // the first open picks the agent row from the harness preference; later opens keep the last pick
    useEffect(() => {
        if (!open || globalStore.get(launcherRuntimeAtom) != null) {
            return;
        }
        const chosen = resolveDefaultRuntime(pref.route?.runtime ?? "", harnesses);
        if (chosen) {
            globalStore.set(launcherRuntimeAtom, chosen as Runtime);
        }
    }, [open, pref, harnesses]);

    // focus opens on the Start column, so a digit picks at once and Enter launches the defaults. ModalShell's own
    // focus effect runs first (a child's effects do), so this one wins.
    useEffect(() => {
        if (open) {
            startRef.current?.focus();
        }
    }, [open]);

    // home turns a project's path into the folder it sits in (projectWhere)
    useEffect(() => {
        if (!open || home !== "") {
            return;
        }
        let live = true;
        fireAndForget(async () => {
            try {
                const next = homeFromInfo(await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: "~" } }));
                if (live) {
                    setHome(next);
                }
            } catch (e) {
                console.error("launcher: could not read the home folder, showing full paths", e);
            }
        });
        return () => {
            live = false;
        };
    }, [open, home]);

    // only the Brief loads the channel list, and a run needs it to find the project's channel
    useEffect(() => {
        if (open) {
            fireAndForget(primeChannels);
        }
    }, [open]);

    // a prefill can also arrive while the dialog is already open, so it is a dependency too
    useEffect(() => {
        if (open && prefill != null) {
            applyLauncherPrefill(rows.map((r) => r.name));
        }
    }, [open, rows, prefill]);

    // DEV-only seam for the launcher CDP scenario: a canvas's Build this… prefill (the Prototype chip) comes only from
    // an agent's design canvas, which a scenario cannot stand up. A production build drops the branch.
    useEffect(() => {
        if (import.meta.env.DEV) {
            const w = window as unknown as { __openLauncher?: (door: LauncherKind, prefill?: NewRunPrefill) => void };
            w.__openLauncher = (door, p) => openLauncher(model, door, p);
        }
    }, [model]);

    useEffect(() => {
        if (!open || !isRun) {
            return;
        }
        // keepTouched: the project is a field of this launch, so picking it must not rewrite a shape or a width already
        // chosen by hand; an untouched draft still follows the project's saved defaults
        resetRunConfigForChannel(pickedOid, true);
        if (pickedOid != null) {
            loadResolvedProfile(pickedOid);
        }
    }, [open, isRun, pickedOid]);
    useEffect(() => {
        if (open && isRun) {
            hydrateRunConfigFromProfile(pickedOid != null ? profiles[pickedOid] : null);
        }
    }, [open, isRun, pickedOid, profiles]);
    // the lead route opens on the project's saved route, else the harness preference, never over a hand pick
    useEffect(() => {
        if (open && isRun && !routeTouched && profileRoute != null) {
            globalStore.set(runRouteAtom, profileRoute);
        }
    }, [open, isRun, profileRoute, routeTouched]);

    useEffect(() => {
        setError(null);
    }, [kind, runtime, project?.name]);

    const close = () => {
        setError(null);
        setFilter("");
        closeLauncher(model);
    };

    const pickRow = (row: StartRow | undefined) => {
        if (row == null) {
            return;
        }
        if (row.kind === "run") {
            globalStore.set(launcherKindAtom, "run");
            setRunShape(row.id as RunShape);
            return;
        }
        globalStore.set(launcherKindAtom, "agent");
        globalStore.set(launcherRuntimeAtom, row.id as Runtime);
    };

    const pickProject = (name: string) => pickLauncherProject(name, project?.name ?? "");

    const applyFilter = (next: string) => {
        setFilter(next);
        pickProject(projectAfterFilter(filterProjects(candidates, next), project?.name ?? ""));
    };

    const register = () => {
        close();
        globalStore.set(model.newProjectOpenAtom, true);
    };

    const launchAgentRow = async (p: ProjectRow) => {
        let branch: string | undefined;
        if (wantsWorktree) {
            if (!chosenBranch) {
                setError("Enter a branch name or turn off the worktree option.");
                return;
            }
            branch = landingBranch;
        }
        if (!beginLauncherLaunch()) {
            return;
        }
        try {
            await launchAgent(model, {
                runtime,
                startupCommand: composeStartupCommand(
                    commands[runtime] ?? runtimeStartupCommand(runtime),
                    runtime,
                    naFlags[runtime] ?? {}
                ),
                task: runtimeShowsTask(runtime) ? task : "",
                projectPath: p.path,
                projectName: p.name,
                branch,
            });
            // Remember off: flags are single-use, cleared for the next agent
            if (!globalStore.get(naRememberFlagsAtom)) {
                globalStore.set(naFlagsAtom, {});
            }
            noteRecentProject(p.name);
            endLauncherDraft();
            close();
        } catch (e) {
            setError(String(e));
        } finally {
            endLauncherLaunch();
        }
    };

    const startRun = (p: ProjectRow) => {
        if (target == null) {
            setError("Still reading your projects — try again in a moment.");
            return;
        }
        if (!beginLauncherLaunch()) {
            return;
        }
        setError(null);
        fireAndForget(async () => {
            let started: { channelId: string; run: Run };
            try {
                started = await startLauncherRun({
                    target,
                    projectName: p.name,
                    config,
                    goal,
                    pickedRoute: routeTouched ? runRoute : null,
                });
            } catch (e) {
                // only a failure before the run exists keeps the dialog: there is still a launch to retry
                setError(String(e));
                return;
            } finally {
                endLauncherLaunch();
            }
            endLauncherDraft();
            close();
            // landing on the run reports its own failures (openTarget toasts); holding the dialog over a run that is
            // already running would read as a failed launch
            await openTarget(model, { kind: "channel", channelId: started.channelId, runId: started.run.id });
        });
    };

    const launch = () => {
        if (project == null) {
            return;
        }
        if (isRun) {
            if (blocker != null) {
                // Enter or Mod+Enter on a run that cannot start yet goes to the field that blocks it
                (goalRef.current ?? planRef.current)?.focus();
                return;
            }
            startRun(project);
            return;
        }
        void launchAgentRow(project);
    };

    const zoneOf = (target: EventTarget): FocusZone => {
        if (target === startRef.current) {
            return "start";
        }
        if (target === projectRef.current) {
            return "project";
        }
        if (target instanceof HTMLTextAreaElement) {
            return "textarea";
        }
        if (target instanceof HTMLInputElement && target.type !== "checkbox") {
            return "input";
        }
        return "other";
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const root = rootRef.current;
        // a portaled menu (the route picker) bubbles here through React; its keys are its own
        if (root == null || !root.contains(e.target as Node)) {
            return;
        }
        const mod = e.metaKey || e.ctrlKey || e.altKey;
        // Tab walks the dialog's stops and wraps, as the DAG modal's trap does; focus never leaves the dialog
        if (e.key === "Tab" && !mod) {
            e.preventDefault();
            const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
            focusTrapTarget(stops, document.activeElement, e.shiftKey)?.focus();
            return;
        }
        const action = launcherKey(
            {
                zone: zoneOf(e.target),
                startCount: startList.length,
                projectCount: visible.length,
                filter,
                flagMenuOpen: flagMenuShown,
                branchListOpen: branchListShown,
            },
            { key: e.key, shift: e.shiftKey, mod }
        );
        if (action.kind === "none") {
            return;
        }
        e.preventDefault();
        switch (action.kind) {
            case "pick-start":
                pickRow(startList[action.index]);
                return;
            case "pick-project":
                pickProject(visible[action.index].name);
                return;
            case "move": {
                if (action.column === "start") {
                    const at = startList.findIndex((r) => r.id === selectedRow);
                    pickRow(startList[stepIndex(startList.length, at, action.delta)]);
                    return;
                }
                const next = stepIndex(
                    visible.length,
                    visible.findIndex((p) => p.name === project?.name),
                    action.delta
                );
                if (next >= 0) {
                    pickProject(visible[next].name);
                }
                return;
            }
            case "filter":
                applyFilter(action.next);
                return;
            case "launch":
                launch();
                return;
            case "dismiss-inner":
                // the inner thing takes this Escape; ModalShell's would close the dialog
                e.stopPropagation();
                if (action.what === "flags") {
                    globalStore.set(launcherFlagMenuAtom, false);
                } else if (action.what === "branches") {
                    globalStore.set(launcherBranchListAtom, false);
                } else {
                    applyFilter("");
                }
                return;
            case "close":
                // the dialog's own close; ModalShell's listener would only do it again
                e.stopPropagation();
                close();
                return;
        }
    };

    const startFocused = zone === "start";
    const projectFocused = zone === "project";
    let projectHint = "";
    if (projectFocused) {
        projectHint = filter === "" && visible.length > 0 ? `type to filter · 1–${Math.min(9, visible.length)}` : "";
    } else if (candidates.length > 1) {
        projectHint = "last used first";
    }

    const renderStartRow = (row: StartRow) => {
        const selected = row.id === selectedRow;
        return (
            <div
                key={row.id}
                role="radio"
                aria-checked={selected}
                data-start-row={row.id}
                onClick={() => pickRow(row)}
                className={cn(rowTone(selected, startFocused), "gap-[9px]", row.desc ? "py-[7px]" : "py-2")}
            >
                <Keycap k={row.key} lit={startFocused} />
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <StartMark id={row.id} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span
                        className={cn(
                            "text-[12.5px] font-semibold",
                            selected ? "text-primary" : "text-muted-foreground"
                        )}
                    >
                        {row.name}
                    </span>
                    {row.desc ? <span className="text-[10.5px] text-muted">{row.desc}</span> : null}
                </span>
                {selected ? <Check size={14} strokeWidth={2.4} className="text-accent" /> : null}
            </div>
        );
    };

    return (
        <ModalShell
            open={open}
            onClose={close}
            onSubmit={launch}
            className="flex max-h-[86vh] w-[min(720px,93vw)] flex-col"
        >
            {open ? (
                <div ref={rootRef} data-launcher onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-[10px] border-b border-border py-[13px] pl-[18px] pr-3">
                        <h2 className="m-0 text-[15px] font-semibold text-primary">{launcherTitle(kind)}</h2>
                        {restored ? (
                            <span data-launcher-restored className="flex items-center gap-1.5 text-[11.5px] text-muted">
                                · draft restored
                                <button
                                    type="button"
                                    onClick={clearLauncherDraft}
                                    className="cursor-pointer rounded-[5px] px-1 py-0.5 font-semibold text-ink-mid hover:bg-surface-hover hover:text-primary"
                                >
                                    Clear
                                </button>
                            </span>
                        ) : null}
                        <div className="flex-1" />
                        <span className="flex items-center gap-3 text-[11px] text-muted">
                            <span className="flex items-center gap-[5px]">
                                <kbd className={KEY_LEGEND}>1–9</kbd>pick
                            </span>
                            <span className="flex items-center gap-[5px]">
                                <kbd className={KEY_LEGEND}>⇥</kbd>next
                            </span>
                        </span>
                        <button
                            type="button"
                            tabIndex={-1}
                            aria-label="Close"
                            title="Close (Esc)"
                            onClick={close}
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-primary"
                        >
                            <X size={15} strokeWidth={2} />
                        </button>
                    </div>
                    <div className="grid shrink-0 grid-cols-[236px_minmax(0,1fr)] border-b border-border">
                        <div
                            ref={startRef}
                            role="radiogroup"
                            aria-label="Start"
                            tabIndex={0}
                            data-launcher-column="start"
                            onFocus={() => setZone("start")}
                            onBlur={() => setZone(null)}
                            className="flex flex-col gap-px border-r border-border px-2 py-3 outline-none"
                        >
                            <ColumnLabel
                                label="Agent"
                                focused={startFocused}
                                hint={startFocused ? `↑↓ · 1–${startList.length}` : ""}
                            />
                            {startList.filter((r) => r.kind === "agent").map(renderStartRow)}
                            <ColumnLabel label="Run" focused={startFocused} className="pt-[10px]" />
                            {startList.filter((r) => r.kind === "run").map(renderStartRow)}
                        </div>
                        <div
                            ref={projectRef}
                            role="radiogroup"
                            aria-label="Project"
                            tabIndex={0}
                            data-launcher-column="project"
                            onFocus={() => setZone("project")}
                            onBlur={() => {
                                // a list narrowed by a query you can no longer see reads as projects gone missing
                                setZone(null);
                                setFilter("");
                            }}
                            className="flex min-w-0 flex-col gap-px px-2 py-3 outline-none"
                        >
                            <ColumnLabel label="Project" focused={projectFocused} hint={projectHint} />
                            {filter !== "" ? (
                                <div
                                    data-launcher-filter
                                    className="mb-1 flex items-center gap-2 rounded-[7px] border border-accent-700 bg-surface px-2 py-1.5"
                                >
                                    <Search size={13} className="shrink-0 text-muted" />
                                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">{filter}</span>
                                    <span className="text-[10.5px] tabular-nums text-muted">
                                        {visible.length} of {candidates.length}
                                    </span>
                                </div>
                            ) : null}
                            {candidates.length === 0 ? (
                                <div className="flex flex-col items-start gap-2.5 px-2 py-1">
                                    <span data-launcher-empty className="text-[12.5px] leading-normal text-ink-mid">
                                        No projects yet. Agents and runs start in a project folder.
                                    </span>
                                    <button
                                        type="button"
                                        onClick={register}
                                        className="cursor-pointer rounded-[7px] border border-accent/30 bg-accentbg px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-soft hover:bg-accent/20"
                                    >
                                        Register a project
                                    </button>
                                </div>
                            ) : (
                                <div className="flex max-h-[236px] flex-col gap-px overflow-y-auto">
                                    {visible.map((p, i) => {
                                        const selected = p.name === project?.name;
                                        return (
                                            <div
                                                key={p.name}
                                                role="radio"
                                                aria-checked={selected}
                                                data-project-row={p.name}
                                                title={p.path}
                                                onClick={() => pickProject(p.name)}
                                                className={cn(rowTone(selected, projectFocused), "gap-[10px] py-2")}
                                            >
                                                <Keycap k={i < 9 ? String(i + 1) : ""} lit={projectFocused} />
                                                <span
                                                    className={cn(
                                                        "shrink-0 text-[12.5px] font-semibold",
                                                        selected ? "text-primary" : "text-muted-foreground"
                                                    )}
                                                >
                                                    {p.name}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted">
                                                    {projectWhere(p.path, home)}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {visible.length === 0 ? (
                                        <span data-launcher-nomatch className="px-2 py-1.5 text-[12px] text-muted">
                                            No project matches “{filter}”. Esc clears the filter.
                                        </span>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[18px] pb-4 pt-[14px]">
                        {isRun ? (
                            <RunFields
                                projectPath={projectPath}
                                goalRef={goalRef}
                                planRef={planRef}
                                ramWarning={ramWarning}
                            />
                        ) : (
                            <AgentFields
                                runtime={runtime}
                                currentBranch={currentBranch}
                                branches={branches}
                                ramWarning={ramWarning}
                            />
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3 border-t border-border px-[18px] py-[13px]">
                        {error != null ? (
                            <span
                                data-launcher-footer="error"
                                title={error}
                                className="min-w-0 flex-1 truncate text-[12px] text-error"
                            >
                                {error}
                            </span>
                        ) : (
                            <span
                                data-launcher-footer="line"
                                title={projectPath || undefined}
                                className={cn(
                                    "min-w-0 flex-1 truncate text-[12px]",
                                    footer.blocked ? "text-ink-mid" : "text-muted"
                                )}
                            >
                                {footer.lead}
                                {footer.strong ? <span className="text-[11px] text-ink-hi">{footer.strong}</span> : null}
                                {footer.tail}
                            </span>
                        )}
                        <DialogButton variant="secondary" hint="esc" onClick={close}>
                            Cancel
                        </DialogButton>
                        <DialogButton
                            variant="primary"
                            hint={formatChordString("Cmd:Enter")}
                            disabled={primaryDisabled}
                            onClick={launch}
                            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
                        >
                            {busy && isRun ? "Starting…" : primaryLabel(kind, runtime)}
                        </DialogButton>
                    </div>
                </div>
            ) : null}
        </ModalShell>
    );
}
```

- [ ] **Step 8: Mount it and delete the old dialogs**

`frontend/app/cockpit/cockpit-root.tsx`: replace the `NewAgentModal` and `NewRunModalHost` imports with
`import { LauncherModal } from "@/app/view/agents/launchermodal";`, and the two lines `<NewAgentModal model={model} />`
and `<NewRunModalHost model={model} />` with `<LauncherModal model={model} />`.

Delete `frontend/app/view/agents/newagentmodal.tsx`, `frontend/app/view/jarvis/newruncontrol.tsx` and
`frontend/app/view/jarvis/projectpickerview.tsx` (`git rm`).

Replace `frontend/app/view/jarvis/projectpicker.ts` with what the launcher's project column still uses:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a project sits, for the New launcher's project column: the "where" beside each name is what tells two
// same-named checkouts apart.

// The home folder from a FileInfoCommand stat of "~". The server expands "~" to stat it but hands the
// path back re-collapsed (ReplaceHomeDir turns home itself into "~"), so home is rebuilt from the
// expanded parent `dir` plus `name`. Anything else is "unknown", which makes projectWhere show full paths.
export function homeFromInfo(info: FileInfo | null | undefined): string {
    if (info == null || info.notfound) {
        return "";
    }
    const path = info.path ?? "";
    if (path !== "" && !path.startsWith("~")) {
        return path;
    }
    if (path === "~" && info.dir && info.name) {
        return info.dir.replace(/[\\/]+$/, "") + "/" + info.name;
    }
    return "";
}

function splitPath(p: string): { lead: string; segs: string[]; sep: string } {
    const lead = /^[\\/]*/.exec(p)[0];
    return {
        lead,
        segs: p
            .slice(lead.length)
            .split(/[\\/]+/)
            .filter((s) => s !== ""),
        sep: p.includes("\\") ? "\\" : "/",
    };
}

// Windows paths compare case-insensitively, which is also what makes `c:\` and `C:\` one drive.
function sameSegs(a: string[], b: string[], fold: boolean): boolean {
    return a.length === b.length && a.every((s, i) => (fold ? s.toLowerCase() === b[i].toLowerCase() : s === b[i]));
}

// The parent folder of a project: relative to home when inside it, else the full parent path. A project
// directly in home says "~", because a blank there would read as "unknown" rather than "home".
export function projectWhere(path: string, home: string): string {
    const p = splitPath(path);
    const parent = p.segs.slice(0, -1);
    if (home !== "") {
        const h = splitPath(home);
        const fold = /^[a-z]:$/i.test(h.segs[0] ?? "");
        if (sameSegs(p.segs, h.segs, fold)) {
            return "";
        }
        if (parent.length >= h.segs.length && sameSegs(parent.slice(0, h.segs.length), h.segs, fold)) {
            const rel = parent.slice(h.segs.length);
            return rel.length === 0 ? "~" : rel.join(p.sep);
        }
    }
    const full = p.lead + parent.join(p.sep);
    // a bare drive is not a folder until it has its separator back
    return /^[a-z]:$/i.test(full) ? full + p.sep : full;
}
```

In `frontend/app/view/jarvis/projectpicker.test.ts`, change the import to `import { homeFromInfo, projectWhere } from "./projectpicker";`
and delete the `describe("recentNames", …)` and `describe("pickerSections", …)` blocks (from line 80 to the end).

In `frontend/app/view/jarvis/newrun.ts`, delete `stepPick` and its comment (the projects picker that used it is gone);
in `frontend/app/view/jarvis/newrun.test.ts`, drop `stepPick` from the import and delete `describe("stepPick", …)`.

Run `grep -rn "newAgentOpenAtom\|newRunOpenAtom\|newRunPrefillAtom\|NewAgentModal\|NewRunModal\|projectpickerview\|newruncontrol\|stepPick" frontend --include='*.ts' --include='*.tsx'`.
Expected: no output.

- [ ] **Step 9: Docs**

`CHANGELOG.md`: under `## Unreleased`, add as the first bullet of `### Changed`:

```markdown
- **New agent** and **New run** are one dialog. Pick what to start with its number key, Tab to the project column
  (type to filter it, or press a project's number), then `Cmd+Enter` (`Ctrl+Enter` on Windows). A click outside now
  closes it, and opening it again brings back what you had typed.
```

`docs/keyboard-shortcuts.md`: in the Global table, the two rows become

```markdown
| `Mod`+`N` | New agent: opens the New dialog on an agent row |
| `Mod`+`Shift`+`R` | New run: opens the New dialog on a run row |
```

then add this section after the Global section's closing paragraph ("Setup and Settings have no `Mod`+number slot…"),
before `## Go-to surface`:

```markdown
## The New dialog (New agent, New run)

One dialog starts an agent, a terminal or a run. It opens with focus on the Start column.

| Keys | Action |
|---|---|
| `1`…`9` | Pick that row in the focused column (Start or Project) |
| `↑` / `↓` | Move in the focused column |
| letters | In the Project column, filter projects by name; `Backspace` shortens the filter |
| `Tab` / `Shift`+`Tab` | Next / previous: Start, Project, each field, Cancel, the launch button, and round again |
| `Enter` | Launch, from a column or a one-line field; in the task or goal box it starts a new line |
| `Mod`+`Enter` | Launch, from anywhere in the dialog |
| `Esc` | Close the open menu or the project filter first, then the dialog. What you typed is kept for the next open |
```

and in the Search section change "Quick and Orchestrate open the New run window with it filled in" to "Quick and
Orchestrate open the New dialog on that run row with it filled in".

`docs/orchestrator-guide.md`:
- §1, "+ Run lists projects from `projects.json`" → "The New dialog lists projects from `projects.json`".
- Flow 1, the opening paragraph becomes: "Open **New run** in the app bar (`⌘⇧R`, or `r` on the Jarvis Brief): the New
  dialog opens on a run row. Press **Quick run**'s number in the Start column, `Tab` to the project and pick it, write
  the goal, then **Start run** (`⌘⏎`)."
- Flow 2's control table: **Project** reads "Where the lead works and where lanes merge. Tab to the column and type to
  filter, or press its number."; **Shape → Orchestrator** becomes **Start → Orchestrate** ("A lead plus the engine.");
  **Start from → A goal** stays as it is (the dialog keeps those words); **Parallelism** becomes **Workers at once**.
- "When a width you pick on + Run" → "When a width you pick in New run".
- "The New run window lists the parsed plan's tasks" → "The New dialog lists the parsed plan's tasks".

`docs/open-issues.md`: append this row as the last row of the table under `## 1 · Actionable`:

```markdown
| (arcterm) `docs/orchestrator-guide.md` screenshots `02-quick-modal.png` and `04-goal-modal.png` still show the old New run window. Retake them on Windows with CDP (the `launcher` scenario's shots are a start) | docs | S | `docs/superpowers/specs/2026-10-08-new-launcher-design.md` |
```

- [ ] **Step 10: Run the tests, the typecheck and the linters**

```bash
npx vitest run frontend/app/view/agents frontend/app/modals frontend/app/store/keybindings frontend/app/view/jarvis
NODE_OPTIONS=--max-old-space-size=4096 task check:ts
npx eslint frontend/app/view/agents/launchermodal.tsx frontend/app/view/agents/launcheragentfields.tsx frontend/app/view/agents/launcherrunfields.tsx frontend/app/view/agents/runlauncher.tsx frontend/app/view/agents/workercapacity.ts frontend/app/modals/modalfocus.ts frontend/app/modals/modalshell.tsx frontend/app/view/agents/agents.tsx frontend/app/store/keybindings/dispatcher.ts frontend/app/store/keybindings/bindings.ts frontend/app/cockpit/app-bar.tsx frontend/app/cockpit/command-palette.tsx frontend/app/cockpit/actions/project.ts frontend/app/cockpit/cockpit-actions.ts frontend/app/cockpit/cockpit-root.tsx frontend/app/view/agents/canvaspane.tsx frontend/app/view/agents/agentheader.tsx frontend/app/view/agents/agentlaunchhero.tsx frontend/app/view/agents/filessurface.tsx frontend/app/view/agents/cockpitsurface.tsx frontend/app/view/agents/conversationhistory.tsx frontend/app/view/jarvis/projectpicker.ts frontend/app/view/jarvis/newrun.ts
npx prettier --check frontend/app/view/agents/launchermodal.tsx frontend/app/view/agents/launcheragentfields.tsx frontend/app/view/agents/launcherrunfields.tsx frontend/app/modals/modalfocus.ts
```

Expected: vitest PASS; `task check:ts` exits 0 (5-minute timeout); eslint reports nothing new in the touched files;
prettier passes on the new files (several touched older files were not prettier-clean before this change; leave
their unrelated lines alone).

- [ ] **Step 11: Commit**

Stage only this task's paths: the checkout may hold someone's unrelated work in progress. The three deleted files are
already staged by the `git rm` in Step 8.

```bash
git add frontend/app/view/agents/launchermodal.tsx frontend/app/view/agents/launcheragentfields.tsx frontend/app/view/agents/launcherrunfields.tsx frontend/app/view/agents/runlauncher.tsx frontend/app/view/agents/workercapacity.ts frontend/app/view/agents/workercapacity.test.ts frontend/app/modals/modalfocus.ts frontend/app/modals/modalfocus.test.ts frontend/app/modals/modalshell.tsx frontend/app/view/agents/agents.tsx frontend/app/store/keybindings/dispatcher.ts frontend/app/store/keybindings/dispatcher.test.ts frontend/app/store/keybindings/bindings.ts frontend/app/store/keybindings/bindings.test.ts frontend/app/store/keybindings/store.test.ts frontend/app/cockpit/app-bar.tsx frontend/app/cockpit/command-palette.tsx frontend/app/cockpit/actions/project.ts frontend/app/cockpit/cockpit-actions.ts frontend/app/cockpit/cockpit-root.tsx frontend/app/view/agents/canvaspane.tsx frontend/app/view/agents/agentheader.tsx frontend/app/view/agents/agentlaunchhero.tsx frontend/app/view/agents/filessurface.tsx frontend/app/view/agents/cockpitsurface.tsx frontend/app/view/agents/conversationhistory.tsx frontend/app/view/agents/naflagsstore.ts frontend/app/view/jarvis/projectpicker.ts frontend/app/view/jarvis/projectpicker.test.ts frontend/app/view/jarvis/newrun.ts frontend/app/view/jarvis/newrun.test.ts CHANGELOG.md docs/keyboard-shortcuts.md docs/orchestrator-guide.md docs/open-issues.md
git commit -m "feat(launcher): one New dialog for agents and runs — number keys, Tab between columns, outside click keeps the draft"
```

---

### Task 5: CDP scenarios for the New dialog
**Depends on:** Task 4
**Files:** `scripts/cdp/scenarios.mjs`

Add the `launcher` scenario (one step per mockup board, plus the keys, the no-match filter, the launch-error line, the
Prototype chip, and the draft kept through Esc, the backdrop and Cancel) and the `launcher-empty` scenario (no project
registered), move `new-run-window`, `capacity-warn` and `palette-goal` onto the new dialog's hooks, and have
`capacity-warn` show the dialog's RAM line and the line under its Workers stepper. CDP needs WebView2, so on a Mac this
task is written and syntax-checked, and the Final runs it on Windows.

**Interfaces:**
- Consumes: the DOM hooks Task 4 produces (listed in its Interfaces), including the DEV-only `window.__openLauncher`.
- Produces: the scenarios named `launcher` and `launcher-empty` in `SCENARIOS`, `launcher-empty` listed before `newRunWindow`.

- [ ] **Step 1: Point the shared constants at the launcher**

In `scripts/cdp/scenarios.mjs`, replace the `NEW_RUN`, `NEW_RUN_FIELD` and `NEW_RUN_LIST` constants and delete
`newRunListExpr` (nothing will use it):

```js
// the New dialog's root carries the marker; New run opens it at the run door
const NEW_RUN = `document.querySelector('[data-launcher]')`;
```

Keep `NEW_RUN_WORKERS`, `NEW_RUN_PROJECT`, `RECENT_PROJECTS_KEY`, `NEW_RUN_PLAN` and `pickWorkers` as they are.

- [ ] **Step 2: The launcher's helpers, the launcher scenario and launcher-empty**

Insert right after the `newRunWindow` object:

```js
// --- launcher: the one New dialog for agents and runs (docs/superpowers/specs/2026-10-08-new-launcher-design.md).
// One step per board of the design canvas, plus the keys, the error line, the Prototype chip and the kept draft.
const LAUNCHER = NEW_RUN;
const LAUNCHER_PROJECT = "verify-launcher";
const LAUNCHER_PROJECT_B = "verify-launcher-b";

// what the dialog shows, read in one evaluate
const launcherState = `(() => {
    const d = ${LAUNCHER};
    if (!d) return null;
    const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const active = document.activeElement;
    const primary = [...d.querySelectorAll('button')].find((b) => /^(Launch agent|Open terminal|Start run|Starting…)/.test(flat(b)));
    return {
        title: flat(d.querySelector('h2')),
        start: d.querySelector('[data-start-row][aria-checked="true"]')?.getAttribute('data-start-row') ?? null,
        startRows: [...d.querySelectorAll('[data-start-row]')].map((r) => r.getAttribute('data-start-row')),
        project: d.querySelector('[data-project-row][aria-checked="true"]')?.getAttribute('data-project-row') ?? null,
        projects: [...d.querySelectorAll('[data-project-row]')].map((r) => r.getAttribute('data-project-row')),
        focus: active?.getAttribute('data-launcher-column') ?? (active?.id || null),
        filter: d.querySelector('[data-launcher-filter]') ? flat(d.querySelector('[data-launcher-filter]')) : null,
        restored: !!d.querySelector('[data-launcher-restored]'),
        task: d.querySelector('#launcher-task')?.value ?? null,
        goal: d.querySelector('textarea[aria-label="Goal"]')?.value ?? null,
        primary: primary ? { text: flat(primary), disabled: primary.disabled } : null,
        footer: flat(d.querySelector('[data-launcher-footer]')),
        footerError: d.querySelector('[data-launcher-footer]')?.getAttribute('data-launcher-footer') === 'error',
    };
})()`;

// sets a field the way React reads typing: through its own prototype's value setter, then an input event
const setFieldExpr = (elExpr, value) => `(() => {
    const el = ${elExpr};
    if (!el) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
})()`;

// real key events, so a key reaches the dialog the way a person's does
const LAUNCHER_KEYS = {
    Tab: { code: "Tab", keyCode: 9 },
    Escape: { code: "Escape", keyCode: 27 },
    Enter: { code: "Enter", keyCode: 13 },
    "-": { code: "Minus", keyCode: 189 },
};
async function launcherPress(h, key) {
    const spec =
        LAUNCHER_KEYS[key] ??
        (/^[0-9]$/.test(key)
            ? { code: `Digit${key}`, keyCode: 48 + Number(key) }
            : { code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0) });
    for (const type of ["rawKeyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code: spec.code, windowsVirtualKeyCode: spec.keyCode });
    }
    await polishNap(150);
}

const OPEN_NEW_AGENT = `[...document.querySelectorAll('button')].find((b) => (b.title ?? '').startsWith('New agent'))?.click()`;
const focusColumn = (name) => `${LAUNCHER}?.querySelector('[data-launcher-column="${name}"]')?.focus()`;

const launcherScenario = {
    name: "launcher",
    surface: "cockpit",
    async arrange(h) {
        const ctx = { dirs: [], projects: [] };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            for (const name of [LAUNCHER_PROJECT, LAUNCHER_PROJECT_B]) {
                const dir = mkdtempSync(join(tmpdir(), `${name}-`));
                ctx.dirs.push(dir);
                await h.rpc("createproject", { name, path: dir });
                ctx.projects.push(name);
                await waitForProjectInConfig(h, name);
            }
            // recent-first puts verify-launcher on top; put the developer's own list back in teardown
            ctx.prevRecent = await h.ev(`localStorage.getItem(${JSON.stringify(RECENT_PROJECTS_KEY)})`);
            const recent = [LAUNCHER_PROJECT, LAUNCHER_PROJECT_B, ...JSON.parse(ctx.prevRecent ?? "[]")];
            await h.ev(
                `localStorage.setItem(${JSON.stringify(RECENT_PROJECTS_KEY)}, ${JSON.stringify(JSON.stringify(recent))})`
            );
            await polishReload(h);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. two projects were registered and made recent", false, ctx.arrangeError);
            return steps;
        }
        const state = () => h.ev(launcherState);
        await h.cdp("Emulation.setDeviceMetricsOverride", MODELS_VIEWPORT);
        await h.goto("cockpit");

        await h.ev(OPEN_NEW_AGENT);
        await polishWaitFor(h, `!!${LAUNCHER}`, 5000);
        await polishNap(400);
        let s = await state();
        await h.shot("cdp-shots/launcher-1-agent.png");
        rec(
            "1. New agent opens the dialog titled New agent, focus on Start, an agent row picked, the recent project selected",
            s != null &&
                s.title === "New agent" &&
                s.focus === "start" &&
                !["quick", "orchestrator"].includes(s.start) &&
                s.project === LAUNCHER_PROJECT,
            JSON.stringify(s)
        );
        if (s == null) return steps;
        const digit = (id) => String(s.startRows.indexOf(id) + 1);

        await launcherPress(h, digit("terminal"));
        s = await state();
        await h.shot("cdp-shots/launcher-2-terminal.png");
        rec(
            "2. Terminal's digit picks it: Open terminal, and no task field",
            s.start === "terminal" && s.primary?.text.startsWith("Open terminal") && s.task === null,
            JSON.stringify(s)
        );

        await launcherPress(h, digit("quick"));
        s = await state();
        rec(
            "3. Quick run's digit picks it: the title turns New run, and with no goal Start run waits on Write the goal",
            s.start === "quick" && s.title === "New run" && s.primary?.disabled === true && s.footer === "Write the goal",
            JSON.stringify(s)
        );

        await launcherPress(h, "Enter");
        s = await state();
        rec(
            "4. Enter on a run that cannot start goes to the goal field and starts nothing",
            s != null && s.focus === "launcher-goal",
            JSON.stringify(s)
        );

        await h.ev(setFieldExpr(`${LAUNCHER}?.querySelector('textarea[aria-label="Goal"]')`, "verify launcher: do nothing"));
        await polishNap(250);
        s = await state();
        await h.shot("cdp-shots/launcher-3-quick.png");
        rec(
            "5. with a goal, the footer reads Quick run in the project and Start run is live",
            s.footer === `Quick run in ${LAUNCHER_PROJECT}` && s.primary?.disabled === false,
            JSON.stringify(s)
        );

        await h.ev(focusColumn("start"));
        await launcherPress(h, digit("orchestrator"));
        await polishNap(300);
        s = await state();
        const startFrom = await h.ev(`!!${LAUNCHER}?.querySelector('[role="group"][aria-label="Start from"]')`);
        await h.shot("cdp-shots/launcher-4-orchestrate.png");
        rec(
            "6. Orchestrate's digit picks it, keeps the goal, and shows Start from, Workers at once and the three models",
            s.start === "orchestrator" &&
                startFrom &&
                s.goal === "verify launcher: do nothing" &&
                s.footer.startsWith("Orchestrator × ") &&
                s.footer.endsWith(` in ${LAUNCHER_PROJECT}`),
            JSON.stringify({ ...s, startFrom })
        );

        await h.ev(
            `[...(${LAUNCHER}?.querySelectorAll('[role="group"][aria-label="Start from"] button') ?? [])].find((b) => b.textContent.trim() === 'A plan file')?.click()`
        );
        await polishWaitFor(h, `!!${LAUNCHER}?.querySelector('[data-jarvis-plan-path]')`, 3000);
        await h.ev(setFieldExpr(`${LAUNCHER}?.querySelector('[data-jarvis-plan-path]')`, MODELS_PLAN));
        await polishWaitFor(h, `!!${LAUNCHER}?.querySelector('[data-jarvis-plan-preview="ready"]')`, 10000);
        const plan = await h.ev(NEW_RUN_PLAN);
        await h.shot("cdp-shots/launcher-5-plan.png");
        rec(
            "7. a plan file shows its parsed tasks in the dialog",
            plan?.rows?.length === 3,
            JSON.stringify({ plan: MODELS_PLAN, ...plan })
        );

        await h.ev(focusColumn("start"));
        await launcherPress(h, "Tab");
        for (const ch of "r-b") await launcherPress(h, ch);
        s = await state();
        await h.shot("cdp-shots/launcher-6-filter.png");
        rec(
            "8. Tab moves to the Project column, and typing filters it to the matching project",
            s.focus === "project" &&
                s.filter?.startsWith("r-b") &&
                s.projects.includes(LAUNCHER_PROJECT_B) &&
                s.projects.every((p) => p.includes("r-b")) &&
                s.project === LAUNCHER_PROJECT_B,
            JSON.stringify(s)
        );

        for (const ch of "zz") await launcherPress(h, ch);
        s = await state();
        const noMatch = await h.ev(
            `(${LAUNCHER}?.querySelector('[data-launcher-nomatch]')?.textContent ?? '').replace(/\\s+/g, ' ').trim()`
        );
        await h.shot("cdp-shots/launcher-7-nomatch.png");
        rec(
            "9. a filter nothing matches lists no project and says Esc clears it",
            s.projects.length === 0 && noMatch === "No project matches “r-bzz”. Esc clears the filter.",
            JSON.stringify({ noMatch, ...s })
        );

        await launcherPress(h, "Escape");
        s = await state();
        rec(
            "10. Escape clears the filter and leaves the dialog open on the project it picked",
            s != null && s.filter === null && s.project === LAUNCHER_PROJECT_B,
            JSON.stringify(s)
        );

        await h.ev(focusColumn("start"));
        const agentRow = s.startRows.includes("claude") ? "claude" : s.startRows[0];
        await launcherPress(h, digit(agentRow));
        await launcherPress(h, "Tab");
        await launcherPress(h, "Tab");
        const tabbedTo = (await state()).focus;
        await h.ev(setFieldExpr(`${LAUNCHER}?.querySelector('#launcher-task')`, "verify launcher: kept draft"));
        await h.ev(`${LAUNCHER}?.querySelector('button[role="switch"]')?.click()`);
        const hasFlags = await h.ev(`!!${LAUNCHER}?.querySelector('button[aria-expanded]')`);
        if (hasFlags) await h.ev(`${LAUNCHER}?.querySelector('button[aria-expanded]')?.click()`);
        await polishNap(400);
        s = await state();
        const worktree = await h.ev(`${LAUNCHER}?.querySelector('button[role="switch"]')?.getAttribute('aria-checked')`);
        await h.shot("cdp-shots/launcher-8-agent-options.png");
        rec(
            "11. on an agent row, Tab, Tab lands in Task; a task, the worktree switch and the flag menu all take",
            tabbedTo === "launcher-task" && s.task === "verify launcher: kept draft" && worktree === "true",
            JSON.stringify({ tabbedTo, worktree, hasFlags, ...s })
        );

        // focus is still in the Task box: a click opened the menu, and a scripted click moves no focus
        if (hasFlags) {
            await launcherPress(h, "Escape");
            const menu = await h.ev(
                `({ open: !!${LAUNCHER}, expanded: ${LAUNCHER}?.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded'), focus: document.activeElement?.id || null })`
            );
            rec(
                "12. Escape in the Task box with the flag menu open closes the menu, not the dialog",
                menu.open && menu.expanded === "false",
                JSON.stringify(menu)
            );
        }

        // a worktree with no branch is refused before anything starts, so the error line shows without a launch
        await h.ev(setFieldExpr(`${LAUNCHER}?.querySelector('input[aria-label="Branch"]')`, ""));
        await polishNap(200);
        await h.ev(
            `[...(${LAUNCHER}?.querySelectorAll('button') ?? [])].find((b) => /^Launch agent/.test(b.textContent.trim()))?.click()`
        );
        await polishNap(300);
        s = await state();
        await h.shot("cdp-shots/launcher-9-error.png");
        rec(
            "13. Launch agent with the worktree on and no branch puts the error in the footer and starts nothing",
            s != null && s.footerError && s.footer === "Enter a branch name or turn off the worktree option.",
            JSON.stringify(s)
        );

        await launcherPress(h, "Escape");
        const escClosed = await polishWaitFor(h, `!${LAUNCHER}`, 3000);
        rec("14. Escape with nothing open inside closes the dialog", escClosed, `closed=${escClosed}`);

        await h.ev(OPEN_NEW_AGENT);
        await polishWaitFor(h, `!!${LAUNCHER}`, 5000);
        await polishNap(400);
        s = await state();
        await h.shot("cdp-shots/launcher-10-restored.png");
        rec(
            "15. reopened, it says draft restored and the task is still there",
            s != null && s.restored && s.task === "verify launcher: kept draft",
            JSON.stringify(s)
        );

        await h.ev(`(() => {
            const backdrop = ${LAUNCHER}?.closest('[role="dialog"]')?.parentElement;
            backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            return !!backdrop;
        })()`);
        const closed = await polishWaitFor(h, `!${LAUNCHER}`, 3000);
        rec("16. a mousedown outside the dialog closes it", closed, `closed=${closed}`);

        // the Prototype chip rides a canvas's Build this… prefill, which only an agent's design canvas sends; the
        // dialog's DEV seam sends the same prefill
        const prototype = join(ctx.dirs[0], "Main.dc.html");
        const seam = await polishWaitFor(h, `typeof window.__openLauncher === 'function'`, 3000);
        await h.ev(
            `window.__openLauncher?.('run', ${JSON.stringify({ projectName: LAUNCHER_PROJECT, goal: "verify launcher: build the canvas", shape: "orchestrator", prototype })})`
        );
        await polishWaitFor(h, `!!${LAUNCHER}?.querySelector('[data-launcher-prototype]')`, 5000);
        await polishNap(300);
        s = await state();
        const chip = await h.ev(`(${LAUNCHER}?.querySelector('[data-launcher-prototype]')?.textContent ?? '').trim()`);
        await h.shot("cdp-shots/launcher-11-prototype.png");
        rec(
            "17. a canvas's Build this… prefill opens on Orchestrate in its project, with its goal and the Prototype chip",
            seam &&
                s?.start === "orchestrator" &&
                s.project === LAUNCHER_PROJECT &&
                s.goal === "verify launcher: build the canvas" &&
                chip.startsWith("Prototype · ") &&
                chip.includes(prototype),
            JSON.stringify({ seam, chip, ...s })
        );

        await h.ev(`[...(${LAUNCHER}?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith('Cancel'))?.click()`);
        const cancelled = await polishWaitFor(h, `!${LAUNCHER}`, 3000);
        rec("18. Cancel closes the dialog", cancelled, `closed=${cancelled}`);

        // the task kept since step 11 still shows the note; Clear takes it away
        await h.ev(OPEN_NEW_AGENT);
        await polishWaitFor(h, `!!${LAUNCHER}`, 5000);
        await polishNap(400);
        await h.ev(
            `[...(${LAUNCHER}?.querySelectorAll('[data-launcher-restored] button') ?? [])].find((b) => b.textContent.trim() === 'Clear')?.click()`
        );
        await polishNap(250);
        s = await state();
        rec("19. Clear empties the kept task and drops the note", s != null && !s.restored && s.task === "", JSON.stringify(s));
        return steps;
    },
    async teardown(h, ctx) {
        await h.ev(PEEKS_ESC).catch(() => {});
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`launcher teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        if (ctx.prevRecent !== undefined) {
            const key = JSON.stringify(RECENT_PROJECTS_KEY);
            await step("restore the recent projects", () =>
                h.ev(
                    ctx.prevRecent === null
                        ? `localStorage.removeItem(${key})`
                        : `localStorage.setItem(${key}, ${JSON.stringify(ctx.prevRecent)})`
                )
            );
        }
        for (const name of ctx.projects ?? []) {
            await step(`delete ${name}`, () => h.rpc("deleteproject", { name }));
        }
        // deleteproject leaves the channel createproject made, so the channels at the projects' paths go too
        await step("delete the projects' channels", async () => {
            const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
            const dirs = (ctx.dirs ?? []).map(norm);
            const channels = (await h.rpc("getchannels", null))?.channels ?? [];
            for (const c of channels.filter((c) => dirs.includes(norm(c.projectpath)))) {
                await h.rpc("deletechannel", { channelid: c.oid });
            }
        });
        // the dialog's draft lives in memory; a reload hands the next scenario a fresh one
        await step("reload", async () => {
            await h.ev("location.reload()");
            await new Promise((r) => setTimeout(r, 2500));
        });
        for (const dir of ctx.dirs ?? []) {
            await step("remove a temp dir", () => rmSync(dir, { recursive: true, force: true }));
        }
    },
};

// --- launcher-empty: the New dialog with no registered project (spec "Project column": No projects yet, and Register
// a project, which opens New project). It needs an empty registry, which the Final's fresh store has; on a dev app
// with projects, step 0 says so rather than delete them. SCENARIOS lists it before every scenario that registers a
// project, so the Final runs it first.
const launcherEmpty = {
    name: "launcher-empty",
    surface: "cockpit",
    async arrange(h) {
        const ctx = {};
        try {
            const projects = Object.keys((await h.rpc("getfullconfig", null))?.projects ?? {});
            if (projects.length > 0) {
                ctx.arrangeError = `needs a store with no registered project, as the Final's fresh one; this one has ${projects.length}`;
            }
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null) {
            rec("0. no project is registered", false, ctx.arrangeError);
            return steps;
        }
        await h.goto("cockpit");
        await h.ev(OPEN_NEW_AGENT);
        await polishWaitFor(h, `!!${LAUNCHER}`, 5000);
        await polishNap(400);
        const empty = await h.ev(`(() => {
            const d = ${LAUNCHER};
            if (!d) return null;
            const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
            return {
                note: flat(d.querySelector('[data-launcher-empty]')),
                register: [...d.querySelectorAll('button')].some((b) => flat(b) === 'Register a project'),
                rows: d.querySelectorAll('[data-project-row]').length,
                footer: flat(d.querySelector('[data-launcher-footer]')),
            };
        })()`);
        await h.shot("cdp-shots/launcher-empty-1.png");
        rec(
            "1. with no project registered the column says No projects yet, offers Register a project, and the footer asks for one",
            empty != null &&
                empty.note === "No projects yet. Agents and runs start in a project folder." &&
                empty.register &&
                empty.rows === 0 &&
                empty.footer === "Pick a project",
            JSON.stringify(empty)
        );

        await h.ev(
            `[...(${LAUNCHER}?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Register a project')?.click()`
        );
        const swapped = await polishWaitFor(h, `!${LAUNCHER} && !!document.querySelector('[data-new-project-mode]')`, 3000);
        await h.shot("cdp-shots/launcher-empty-2-register.png");
        rec("2. Register a project closes the dialog and opens New project", swapped, `swapped=${swapped}`);
        return steps;
    },
    async teardown(h) {
        // closes New project, or the dialog if step 2 failed
        await h.ev(PEEKS_ESC).catch(() => {});
        await polishNap(300);
    },
};
```

Register `launcherScenario` in `SCENARIOS` right after `newRunWindow,`, and `launcherEmpty` right before
`newRunWindow,`, so the Final runs `launcher-empty` before any of its scenarios registers a project.

- [ ] **Step 3: Move new-run-window onto the dialog**

In `newRunWindow.assert`, replace steps 2 to 4 (from `await h.ev(\`${NEW_RUN_FIELD}?.click()\`);` through the
"4. picking the project closes the list on it" `rec`) with:

```js
        const listed = await h.ev(launcherState);
        await h.shot("cdp-shots/new-run-window-1-picker.png");
        rec(
            "2. New run opens on a run row, with the recent project first in the project column",
            listed != null && ["quick", "orchestrator"].includes(listed.start) && listed.projects[0] === NEW_RUN_PROJECT,
            JSON.stringify(listed)
        );

        await h.ev(focusColumn("project"));
        for (const ch of "new-run-w") await launcherPress(h, ch);
        const searched = await h.ev(launcherState);
        rec(
            "3. typing in the project column filters it to the project",
            searched?.filter?.startsWith("new-run-w") &&
                searched.projects.includes(NEW_RUN_PROJECT) &&
                searched.projects.every((p) => p.includes("new-run-w")),
            JSON.stringify(searched)
        );

        await launcherPress(h, "1");
        const picked = await h.ev(launcherState);
        rec("4. its digit picks the project", picked?.project === NEW_RUN_PROJECT, JSON.stringify(picked));
```

Replace the orchestrator pick
`` `[...(${NEW_RUN}?.querySelectorAll('button[aria-pressed]') ?? [])].find((b) => b.firstElementChild?.textContent.trim() === 'orchestrator')?.click()` ``
with `` `${NEW_RUN}?.querySelector('[data-start-row="orchestrator"]')?.click()` ``.

Before the Cancel step, add the route picker's Escape (Review Focus):

```js
        await h.ev(`${NEW_RUN_WORKERS}?.click()`);
        await polishWaitFor(h, `!!document.querySelector('[data-testid="route-option-inherit"]')`, 3000);
        await polishNap(200);
        await launcherPress(h, "Escape");
        const afterEsc = await h.ev(
            `({ open: !!${NEW_RUN}, menu: !!document.querySelector('[data-testid="route-option-inherit"]') })`
        );
        rec(
            "7. Escape in the Workers menu closes the menu and leaves the dialog open",
            afterEsc.open && !afterEsc.menu,
            JSON.stringify(afterEsc)
        );
```

Renumber the Cancel step to "8. Cancel closes the window and starts no run", and change its button lookup from
`b.textContent.trim() === 'Cancel'` to `b.textContent.trim().startsWith('Cancel')` (the button now carries an `esc`
hint).

- [ ] **Step 4: capacity-warn and palette-goal**

capacity-warn shows the New dialog's two RAM states: the Orchestrate board's line under the Workers stepper, and the
QuickRun and Main boards' RAM line. Right after `pickOrchestrator`, add:

```js
// the New dialog's Workers stepper: the number before "+", and the CapacityWarn on the line under the row with its
// reason spelled out
const launcherWarnExpr = `(() => {
    const plus = ${CAPACITY_PLUS(NEW_RUN)};
    if (!plus) return null;
    const num = plus.previousElementSibling;
    const warn = ${NEW_RUN}?.querySelector('[data-capacity-warn]');
    return {
        value: num ? num.textContent.trim() : null,
        amber: !!num && num.classList.contains("text-warning"),
        warn: !!warn,
        title: warn ? warn.title : null,
        line: warn?.parentElement ? warn.parentElement.textContent.trim() : null,
    };
})()`;
// the New dialog's low-RAM line for an agent row or a Quick run
const ramWarnText = (root) =>
    `(${root}?.querySelector('[data-ram-warn]')?.textContent ?? '').replace(/\\s+/g, ' ').trim() || null`;
```

`capacityWarn.assert`, step 2: replace `await h.ev(pickOrchestrator(NEW_RUN));` with
``await h.ev(`${NEW_RUN}?.querySelector('[data-start-row="orchestrator"]')?.click()`);`` and
`newRun = await h.ev(stepperWarnExpr(CAPACITY_PLUS(NEW_RUN)));` with `newRun = await h.ev(launcherWarnExpr);`, and
make its `rec`:

```js
        rec(
            "2. New run's Workers at once warns: amber number, and ⚠ with its reason on the line under it",
            stepperWarned(newRun) && newRun.line === CAPACITY_WARN_TITLE,
            JSON.stringify(newRun)
        );
```

Keep `pickOrchestrator` and `stepperWarnExpr` for the Brief sheet's launcher and Adjust, whose steppers keep the mark
beside them. Between that `rec` and the `await h.ev(PEEKS_ESC)` after it, add:

```js
        // CAPACITY_FULL has room for no more worker, so a Quick run's one worker and one more agent both warn
        let ram = null;
        try {
            await h.ev(`${NEW_RUN}?.querySelector('[data-start-row="quick"]')?.click()`);
            await polishNap(300);
            const quick = await h.ev(ramWarnText(NEW_RUN));
            await h.shot("cdp-shots/capacity-warn-quick-ram.png");
            const agentRow = await h.ev(
                `[...(${NEW_RUN}?.querySelectorAll('[data-start-row]') ?? [])].map((r) => r.getAttribute('data-start-row')).find((id) => !['terminal', 'quick', 'orchestrator'].includes(id)) ?? null`
            );
            await h.ev(`${NEW_RUN}?.querySelector('[data-start-row="${agentRow}"]')?.click()`);
            await polishNap(300);
            const agent = await h.ev(ramWarnText(NEW_RUN));
            await h.shot("cdp-shots/capacity-warn-agent-ram.png");
            ram = { quick, agentRow, agent };
        } catch (e) {
            ram = { error: String(e?.message ?? e) };
        }
        rec(
            "3. the New dialog's RAM line warns for a Quick run's worker and for one more agent",
            ram?.quick === "1 GB free of 8 GB. Another worker (~1.5 GB) may make the machine lag." &&
                ram?.agent === "1 GB free of 8 GB. Another agent (~1.5 GB) may make the machine lag.",
            JSON.stringify(ram)
        );
```

Renumber the Brief launcher's step to "4. the Brief launcher's workers stepper warns" and Adjust's to "5. a live run's
Adjust → Worker parallelism warns above its running tasks".

`paletteGoal.assert`, step 4: in the `filled` evaluate, replace `project: ${flatText(NEW_RUN_FIELD)},` with
``project: ${NEW_RUN}?.querySelector('[data-project-row][aria-checked="true"]')?.getAttribute('data-project-row') ?? '',``,
and in its `rec` condition replace ``filled.text.includes(`orchestrator × `)`` with
`filled.text.includes("Orchestrator × ")`.

- [ ] **Step 5: Syntax check and commit**

```bash
node --check scripts/cdp/scenarios.mjs
grep -n "NEW_RUN_FIELD\|NEW_RUN_LIST\|newRunListExpr" scripts/cdp/scenarios.mjs
git add scripts/cdp/scenarios.mjs
git commit -m "test(cdp): the launcher scenario, and New run, capacity and palette scenarios on the New dialog"
```

Expected: `node --check` prints nothing; the grep prints nothing. On Windows, `task verify:ui -- launcher new-run-window capacity-warn palette-goal`
against the dev app passes every step, and `launcher-empty` passes on a store with no registered project (the Final's
fresh one); on a Mac, the Final reports unverified (exit 3).
