# Project Overview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A project's folder row in the Agent tree gets a right-click menu whose Open overview shows, in the Agent
surface's centre, what in the project waits on you, what runs in it, and buttons to start work there.

**Architecture:** A new centre mode `"project"` in `agentcenter.ts` beside History, Canvases and Council. The page
(`projectoverview.tsx`) is thin over a pure model (`projectoverviewmodel.ts`); its Needs you items beyond an agent's ask
are the Cockpit strip's own (`useNeedsYou`, given the project instead of the app bar's filter). The folder row's click
is unchanged; it gains `onContextMenu` and a selected fill.

**Tech Stack:** React 19, jotai, Tailwind 4 tokens, vitest, CDP scenarios (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-22-project-overview-design.md`

**Prototype:** <repo>/.superpowers/design/project-overview/project

**Verify:** `npx vitest run frontend/app/view/agents`

**Final:** `node scripts/cdp/final-verify.mjs project-overview`

---

### Task 1: The pure model
**Depends on:** none
**Files:** `frontend/app/view/agents/projectoverviewmodel.ts`, `frontend/app/view/agents/projectoverviewmodel.test.ts`

**Step 1: Write the failing test**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { askLine, changesLabel, doingLine, isQuiet, overviewRows } from "./projectoverviewmodel";

const vm = (id: string, over: Partial<AgentVM> = {}): AgentVM => ({ id, name: id, task: "", state: "idle", ...over });

describe("overviewRows", () => {
    const agents = [
        vm("a1", { project: "arc", state: "asking", blockedMs: 1_000 }),
        vm("a2", { project: "arc", state: "asking", blockedMs: 9_000 }),
        vm("w1", { project: "arc", state: "working" }),
        vm("i1", { project: "arc", state: "idle" }),
        vm("x1", { project: "other", state: "working" }),
    ];
    const terminals = [
        vm("t1", { project: "arc", kind: "terminal", running: true }),
        vm("t2", { project: "arc", kind: "terminal", running: false }),
        vm("t3", { project: "other", kind: "terminal", running: true }),
    ];

    it("keeps only the project's agents, asking longest-blocked first, then working", () => {
        const rows = overviewRows(agents, terminals, "arc");
        expect(rows.asking.map((a) => a.id)).toEqual(["a2", "a1"]);
        expect(rows.working.map((a) => a.id)).toEqual(["w1"]);
    });

    it("lists the project's terminals that run a command, never an idle shell", () => {
        expect(overviewRows(agents, terminals, "arc").terminals.map((t) => t.id)).toEqual(["t1"]);
    });

    it("leaves another project's rows out", () => {
        const rows = overviewRows(agents, terminals, "other");
        expect(rows.asking).toEqual([]);
        expect(rows.working.map((a) => a.id)).toEqual(["x1"]);
        expect(rows.terminals.map((t) => t.id)).toEqual(["t3"]);
    });
});

describe("isQuiet", () => {
    const empty = { asking: [], working: [], terminals: [] };
    it("is quiet with nothing asking, running or waiting", () => {
        expect(isQuiet(empty, 0)).toBe(true);
    });
    it("is not quiet while a Needs you item waits", () => {
        expect(isQuiet(empty, 1)).toBe(false);
    });
    it("is not quiet while a terminal runs", () => {
        expect(isQuiet({ ...empty, terminals: [vm("t")] }, 0)).toBe(false);
    });
});

describe("lines", () => {
    it("reads an ask's first question, else the activity", () => {
        expect(askLine(vm("a", { ask: { questions: [{ question: "Which table?" }] } }))).toBe("Which table?");
        expect(askLine(vm("a", { activity: "waiting on approval" }))).toBe("waiting on approval");
    });
    it("reads the live activity, else the task", () => {
        expect(doingLine(vm("a", { activity: "Editing x.ts", task: "t" }))).toBe("Editing x.ts");
        expect(doingLine(vm("a", { task: "Fix the row" }))).toBe("Fix the row");
    });
    it("words the change count", () => {
        expect(changesLabel(null)).toBe("");
        expect(changesLabel({ files: 0 })).toBe("no uncommitted changes");
        expect(changesLabel({ files: 1 })).toBe("1 file");
        expect(changesLabel({ files: 6 })).toBe("6 files");
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/app/view/agents/projectoverviewmodel.test.ts`
Expected: FAIL, cannot resolve `./projectoverviewmodel`.

**Step 3: Write the implementation**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A project's Overview (agentcenter.ts' `project` mode), as data: its agents that ask, what in it is at work, and the
// words the header and the rows read. Pure; projectoverview.tsx draws it.

import { projectOf, sortAgents, type AgentVM } from "./agentsviewmodel";

export interface OverviewRows {
    asking: AgentVM[]; // the project's agents asking, longest-blocked first
    working: AgentVM[]; // its agents at work; a lead counts, its run being its agent
    terminals: AgentVM[]; // its terminals running a command
}

export function overviewRows(agents: readonly AgentVM[], terminals: readonly AgentVM[], project: string): OverviewRows {
    const mine = sortAgents(agents.filter((a) => a.kind !== "terminal" && projectOf(a) === project));
    return {
        asking: mine.filter((a) => a.state === "asking"),
        working: mine.filter((a) => a.state === "working"),
        terminals: terminals.filter((t) => t.running === true && projectOf(t) === project),
    };
}

// what an asking agent asks, or why it waits when its ask carries no question
export function askLine(a: AgentVM): string {
    return a.ask?.questions?.[0]?.question ?? a.activity ?? "";
}

// what an agent or a terminal is doing now
export function doingLine(a: AgentVM): string {
    return a.activity || a.task || "";
}

// nothing waits and nothing runs: the page says so in one line instead of drawing two empty blocks
export function isQuiet(rows: OverviewRows, waiting: number): boolean {
    return waiting === 0 && rows.asking.length === 0 && rows.working.length === 0 && rows.terminals.length === 0;
}

// the header's change count, its adds and dels drawn beside it; null (no repo, not read yet) says nothing
export function changesLabel(stats: { files: number } | null): string {
    if (stats == null) {
        return "";
    }
    return stats.files === 0 ? "no uncommitted changes" : `${stats.files} ${stats.files === 1 ? "file" : "files"}`;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/app/view/agents/projectoverviewmodel.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git commit -m "feat(overview): the project Overview's pure model" -- frontend/app/view/agents/projectoverviewmodel.ts frontend/app/view/agents/projectoverviewmodel.test.ts
```

(`git commit -- <paths>` takes new files only once they are known to git: run `git add -N <new files>` first.)

### Task 2: The `project` centre mode
**Depends on:** none
**Files:** `frontend/app/view/agents/agentcenter.ts`, `frontend/app/view/agents/agentcenter.test.ts`, `frontend/app/view/agents/agenttree.tsx`

Besides the mode, this task exports `selectAgentRow` from `agenttree.tsx` (line 262: `function selectAgentRow(` becomes
`export function selectAgentRow(`), which Task 4's page calls. It lives here so Task 4 and Task 5 never edit
`agenttree.tsx` at the same time.

**Step 1: Write the failing test** — append to `agentcenter.test.ts`, and add `overviewProjectAtom` and
`showProjectOverview` to its import from `./agentcenter`:

```ts
describe("showProjectOverview", () => {
    it("opens the project's Overview in the centre", () => {
        showProjectOverview("arcterm");
        expect(globalStore.get(centerModeAtom)).toBe("project");
        expect(globalStore.get(overviewProjectAtom)).toBe("arcterm");
    });

    it("lands on the Agent surface when given the model", () => {
        const model = stub();
        showProjectOverview("arcterm", model);
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("leaves the Overview when an agent is chosen", () => {
        showProjectOverview("arcterm");
        showTerminal();
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run frontend/app/view/agents/agentcenter.test.ts`
Expected: FAIL, `showProjectOverview` is not exported.

**Step 3: Implement** in `agentcenter.ts`:
- Add a line to the header comment's mode list:
  `//   project   one project's Overview (projectoverview.tsx): what in it waits on you and runs; which project is overviewProjectAtom`
- `export type CenterMode = "terminal" | "session" | "run" | "history" | "canvases" | "council" | "project";`
- After `centerModeAtom`:

```ts
// the project whose Overview the `project` mode shows: a registry name, as the tree's folders name it
export const overviewProjectAtom = atom("") as PrimitiveAtom<string>;
```

- After `showCanvases`:

```ts
/** Open a project's Overview in the Agent surface. From the tree nothing more is needed; from another surface pass the
 *  model, which lands on Agent. */
export function showProjectOverview(project: string, model?: Pick<AgentsViewModel, "surfaceAtom">): void {
    globalStore.set(overviewProjectAtom, project);
    globalStore.set(centerModeAtom, "project");
    if (model != null) {
        landOn(model.surfaceAtom, "agent");
    }
}
```

**Step 4: Run the test** — `npx vitest run frontend/app/view/agents/agentcenter.test.ts`, expected PASS. Then
`task check:ts` (about 2 minutes; give it a 5-minute timeout): `AgentCenterPane` (`agentsurface.tsx:870`) falls through
to `SessionPane` for an unknown mode, so it still compiles; Task 4 adds the branch. Fix any other exhaustive use of
`CenterMode` it reports.

**Step 5: Commit**

```bash
git commit -m "feat(overview): the Agent surface's project centre mode" -- frontend/app/view/agents/agentcenter.ts frontend/app/view/agents/agentcenter.test.ts frontend/app/view/agents/agenttree.tsx
```

### Task 3: Needs you, scoped to one project
**Depends on:** none
**Files:** `frontend/app/view/agents/needsyou.ts`, `frontend/app/view/agents/needsyoustrip.tsx`

`needsyou.ts` holds the `useNeedsYou` hook; `needsyoustrip.tsx` holds `NeedsYouStrip` (lines 154–261).

**Step 1: Give the hook a project.** In `useNeedsYou(model, onFocusAgent)` add a third parameter and use it in place of
the app bar's filter. The atom is still read every render (rules of hooks):

```ts
export function useNeedsYou(
    model: AgentsViewModel,
    // an escalation's Open, when its asking agent is in the roster: the Cockpit knows where that card is
    onFocusAgent: (agentId: string) => void,
    // a project's Overview scopes the items to its project; left out, the app bar's filter does, as on the Cockpit
    project?: string
): NeedsYou {
    ...
    const appFilter = useAtomValue(model.projectFilterAtom);
    const filter = project ?? appFilter;
```

(replace the existing `const filter = useAtomValue(model.projectFilterAtom);` line). Update the file's header comment:
"shared by the Cockpit's strip (needsyoustrip.tsx), the Office's notice board and a project's Overview".

**Step 2: Export the rows.** In `needsyoustrip.tsx`, move the `rows.map(...)` body of `NeedsYouStrip` (the
`LearnRow` / row `<div>` ternary, lines 179–258) unchanged into a new exported component above `NeedsYouStrip`:

```tsx
// the strip's rows without its frame, for a page that frames them itself (a project's Overview)
export function NeedsYouRows({ ny }: { ny: NeedsYou }) {
    const { rows, now, busy, open, act, decideLearn } = ny;
    return <>{rows.map((row) => /* the moved ternary, unchanged */)}</>;
}
```

and make `NeedsYouStrip` use it:

```tsx
    const ny = useNeedsYou(model, onFocusAgent);
    if (ny.rows.length === 0) {
        return null;
    }
    // ...the <section> and its header as before, the count reading ny.rows.length...
            <div className="flex max-h-[30vh] flex-col overflow-y-auto">
                <NeedsYouRows ny={ny} />
            </div>
```

Import `type NeedsYou` from `./needsyou`.

**Step 3: Check** — `task check:ts` (5-minute timeout) exits 0, and
`npx vitest run frontend/app/view/agents/needsyoustripmodel.test.ts` still passes. The Cockpit strip must look the same:
Final's scenarios that open the Cockpit cover it.

**Step 4: Commit**

```bash
git commit -m "refactor(needs-you): the hook takes a project, the rows render on their own" -- frontend/app/view/agents/needsyou.ts frontend/app/view/agents/needsyoustrip.tsx
```

### Task 4: The Overview page
**Depends on:** Task 1 (renders overviewRows and its lines), Task 2 (reads overviewProjectAtom and calls the exported selectAgentRow), Task 3 (uses useNeedsYou's project and NeedsYouRows)
**Files:** `frontend/app/view/agents/projectoverview.tsx`, `frontend/app/view/agents/agentsurface.tsx`

`agentsurface.tsx` holds `AgentCenterPane` (line 870).

The prototype's `Main.dc.html` and `QuietNarrow.dc.html` boards are the target. DESIGN.md applies: tokens only, Inter
for every name and path, the accent on New agent alone, status as a dot plus a word.

**Step 1:** `selectAgentRow` is exported by Task 2.

**Step 2: Write `projectoverview.tsx`:**

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A project's Overview, the Agent surface's `project` centre mode (agentcenter.ts): what in the project waits on you,
// what runs in it, and the buttons that start work there. The rows are projectoverviewmodel.ts's; the Needs you items
// beyond an agent's ask are the Cockpit strip's own (needsyou.ts), scoped to this project.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useAtomValue } from "jotai";
import { GitBranch, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { overviewProjectAtom, showCouncilSetup } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { formatAge, type AgentVM } from "./agentsviewmodel";
import { quickTerminal, selectAgentRow } from "./agenttree";
import { diffStatsFromChanges } from "./cardgitstore";
import { parseGitChanges } from "./gitstatus";
import type { LauncherKind } from "./launcher";
import { launcherProjectAtom, openLauncher, pickLauncherProject } from "./launcherstore";
import { useNeedsYou } from "./needsyou";
import { NeedsYouRows } from "./needsyoustrip";
import { askLine, changesLabel, doingLine, isQuiet, overviewRows } from "./projectoverviewmodel";
import { projectsAtom } from "./projectsstore";
import { StatusDot } from "./statusdot";

type ProjectGit = { branch: string; files: number; adds: number; dels: number };

// the branch and the uncommitted change count of the project's checkout, read once per project shown
function useProjectGit(path: string | undefined): ProjectGit | null {
    const [git, setGit] = useState<ProjectGit | null>(null);
    useEffect(() => {
        setGit(null);
        if (!path) {
            return;
        }
        let live = true;
        RpcApi.GitChangesCommand(TabRpcClient, { cwd: path })
            .then((ch) => {
                if (live && ch.isrepo) {
                    setGit({ branch: ch.branch, ...diffStatsFromChanges(parseGitChanges(ch.statusz, ch.numstat)) });
                }
            })
            .catch(() => {});
        return () => {
            live = false;
        };
    }, [path]);
    return git;
}

const PRIMARY_BTN =
    "flex h-[30px] cursor-pointer items-center gap-[6px] rounded-[8px] bg-accent px-3 text-[13px] font-medium text-background hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SECONDARY_BTN =
    "h-[30px] cursor-pointer rounded-[8px] border border-edge-mid bg-surface-raised px-3 text-[13px] text-muted hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const PANEL = "overflow-hidden rounded-[8px] border border-edge-mid bg-surface-raised";
const ROW = "flex w-full items-center gap-[10px] border-t border-edge-mid px-3 py-[9px] text-left first:border-t-0";

function SectionHead({ label, count }: { label: string; count: number }) {
    return (
        <h2 className="text-[12px] font-semibold text-secondary">
            {label} <span className="font-normal tabular-nums text-muted">{count}</span>
        </h2>
    );
}

export function ProjectOverview({ model }: { model: AgentsViewModel }) {
    const project = useAtomValue(overviewProjectAtom);
    const registry = useAtomValue(projectsAtom);
    const path = registry?.[project]?.path;
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const now = useAtomValue(model.nowAtom);
    const git = useProjectGit(path);
    const rows = useMemo(() => overviewRows(agents, terminals, project), [agents, terminals, project]);
    const ny = useNeedsYou(model, (id) => selectAgentRow(model, id), project);
    if (project === "") {
        return null;
    }
    const launch = (door: LauncherKind) => {
        pickLauncherProject(project, globalStore.get(launcherProjectAtom));
        openLauncher(model, door);
    };
    const since = (a: AgentVM) => (a.stateSince != null ? formatAge(Math.max(0, now - a.stateSince)) : "");
    const waiting = rows.asking.length + ny.rows.length;
    const running = rows.working.length + rows.terminals.length;

    return (
        <div data-project-overview={project} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            <div className="mx-auto flex max-w-[760px] flex-col gap-[22px]">
                <header className="flex flex-col gap-[10px]">
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-[18px] font-semibold text-primary">{project}</h1>
                        {git != null ? (
                            <span className="flex h-[22px] items-center gap-[5px] rounded-full bg-pill px-2 text-[12px] text-secondary">
                                <GitBranch size={12} aria-hidden className="text-muted" />
                                {git.branch}
                            </span>
                        ) : null}
                        {git != null ? (
                            <span data-overview-changes className="text-[12px] tabular-nums text-muted">
                                {changesLabel(git)}
                                {git.files > 0 ? (
                                    <>
                                        {" · "}
                                        <span className="text-diff-added">+{git.adds}</span>{" "}
                                        <span className="text-diff-removed">−{git.dels}</span>
                                    </>
                                ) : null}
                            </span>
                        ) : null}
                        <span className="flex-1" />
                        {path ? <span className="truncate text-[12px] text-muted">{path}</span> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" data-overview-action="agent" onClick={() => launch("agent")} className={PRIMARY_BTN}>
                            <Plus size={13} aria-hidden />
                            New agent
                        </button>
                        {path ? (
                            <button
                                type="button"
                                data-overview-action="terminal"
                                onClick={() => quickTerminal(model, project, path)}
                                className={SECONDARY_BTN}
                            >
                                Terminal
                            </button>
                        ) : null}
                        <button type="button" data-overview-action="run" onClick={() => launch("run")} className={SECONDARY_BTN}>
                            Run
                        </button>
                        {path ? (
                            <button
                                type="button"
                                data-overview-action="council"
                                onClick={() => showCouncilSetup(path)}
                                className={SECONDARY_BTN}
                            >
                                Council
                            </button>
                        ) : null}
                    </div>
                </header>

                {isQuiet(rows, ny.rows.length) ? (
                    <p data-overview-quiet className="rounded-[8px] bg-surface p-3 text-[13px] text-muted">
                        Nothing needs you and nothing is running in {project}.
                    </p>
                ) : null}

                {waiting > 0 ? (
                    <section data-overview-needs aria-label="Needs you" className="flex flex-col gap-2">
                        <SectionHead label="Needs you" count={waiting} />
                        <div className={PANEL}>
                            {rows.asking.map((a) => (
                                <div key={a.id} data-overview-asking={a.id} className={ROW}>
                                    <StatusDot state="asking" pulse />
                                    <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                        <span className="truncate text-[13px] text-primary">{a.name}</span>
                                        <span className="truncate text-[12px] text-muted">
                                            <span className="text-asking">asking</span> {askLine(a)}
                                        </span>
                                    </div>
                                    <span className="text-[11px] tabular-nums text-ink-faint">{since(a)}</span>
                                    <button
                                        type="button"
                                        onClick={() => selectAgentRow(model, a.id)}
                                        className="h-[26px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface px-[10px] text-[12px] text-secondary hover:border-edge-strong"
                                    >
                                        Answer
                                    </button>
                                </div>
                            ))}
                            {ny.rows.length > 0 ? (
                                <div className="px-3">
                                    <NeedsYouRows ny={ny} />
                                </div>
                            ) : null}
                        </div>
                    </section>
                ) : null}

                {running > 0 ? (
                    <section data-overview-running aria-label="Running" className="flex flex-col gap-2">
                        <SectionHead label="Running" count={running} />
                        <div className={PANEL}>
                            {[...rows.working, ...rows.terminals].map((a) => (
                                <button
                                    key={a.id}
                                    type="button"
                                    data-overview-running-row={a.id}
                                    onClick={() => selectAgentRow(model, a.id)}
                                    className={`${ROW} cursor-pointer hover:bg-surface-hover`}
                                >
                                    <StatusDot state="working" pulse />
                                    <span className="w-[160px] flex-none truncate text-[13px] text-primary">{a.name}</span>
                                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{doingLine(a)}</span>
                                    <span className="w-[64px] flex-none text-right text-[11px] tabular-nums text-ink-faint">
                                        {since(a)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                ) : null}
            </div>
        </div>
    );
}
```

Check `StatusDot`'s `state` type (`statusdot.tsx:19`, `ShownState`) accepts `"asking"` and `"working"`; if `pulse`
takes another shape, follow the tree's `RunningBadge` (`agenttree.tsx:591`).

**Step 3: Route the mode.** In `AgentCenterPane` (`agentsurface.tsx:870`) add, before the final `SessionPane` branch:

```tsx
            ) : mode === "project" ? (
                <ProjectOverview model={model} />
```

and import `ProjectOverview` from `./projectoverview`. Update the comment above it: "History, the canvases, a council, a
project's Overview and a session's transcript take the centre column".

**Step 4: Check** — `task check:ts` (5-minute timeout) exits 0; `npx eslint frontend/app/view/agents/projectoverview.tsx`
and `npx prettier --check frontend/app/view/agents/projectoverview.tsx` are clean.

**Step 5: Commit**

```bash
git commit -m "feat(overview): the project Overview page" -- frontend/app/view/agents/projectoverview.tsx frontend/app/view/agents/agentsurface.tsx
```

### Task 5: The folder row's menu and selected fill
**Depends on:** Task 2
**Files:** `frontend/app/view/agents/agenttree.tsx`

`FolderRow` is at line 1961, its call sites at ~2604 and ~2902.

**Step 1: The menu.** Above `FolderRow` add:

```tsx
// A project folder's right-click menu: its Overview, then its path's copy and reveal (the Code tree's items). Home has
// none: it is no project and has no path. Shift+F10 on the focused row raises the same contextmenu event.
function openFolderMenu(project: string, e: React.MouseEvent): void {
    if (project === HOME_PROJECT) {
        return;
    }
    const root = globalStore.get(projectsAtom)?.[project]?.path;
    const items: ContextMenuItem[] = [
        {
            label: "Open overview",
            icon: <LayoutDashboard size={13} strokeWidth={1.8} />,
            click: () => showProjectOverview(project),
        },
    ];
    if (root) {
        items.push({ type: "separator" }, ...pathMenuItems(root, null));
    }
    ContextMenuModel.getInstance().showContextMenu(items, e);
}
```

Imports: `LayoutDashboard` from `lucide-react`; `pathMenuItems` from `@/app/view/code/pathmenu`; `showProjectOverview` and
`overviewProjectAtom` from `./agentcenter` (beside `centerModeAtom`); `HOME_PROJECT` from `./agentsidebarmodel` if the
file does not import it yet. `pathMenuItems` gives "Copy Absolute Path" and the OS's reveal label ("Show in Explorer" on
Windows, "Reveal in Finder" on a Mac).

**Step 2: `FolderRow`** gets `selected?: boolean` in its props, `onContextMenu={(e) => openFolderMenu(project, e)}` on its
`<button>`, and its fill swapped so selection is the one grey fill (DESIGN.md: selected rows `bg-surface-selected`):

```tsx
            className={cn(
                "flex w-full cursor-pointer items-center gap-[7px] overflow-hidden rounded-[6px] px-[8px] py-[6px] text-left",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
```

and `{label ?? project}`'s span reads `selected ? "text-primary" : "text-secondary"`. Update its comment: "…and, at the far
end, `trailing`…; a right-click opens its menu (openFolderMenu), and its Overview in the centre fills it".

**Step 3: The call sites.** In `AgentTree` (the Active section, ~2902) and `ConversationsSection` (~2604) read
`const overviewProject = useAtomValue(overviewProjectAtom);` beside the existing `centerModeAtom` read (`center` in
`AgentTree`, `mode` in `ConversationsSection`) and pass
`selected={center === "project" && overviewProject === r.project}` (and `mode === … && … === head.project`).

**Step 4: Check** — `task check:ts` exits 0; `npx eslint frontend/app/view/agents/agenttree.tsx` is clean.

**Step 5: Commit**

```bash
git commit -m "feat(overview): a project folder's right-click opens its Overview" -- frontend/app/view/agents/agenttree.tsx
```

### Task 6: The CDP scenario
**Depends on:** Task 4 (the page it opens and checks), Task 5 (the folder menu it right-clicks)
**Files:** `scripts/cdp/scenarios.mjs`

A `project-overview` scenario, registered where the others are.

The scenario follows `canvas-gallery` (`scenarios.mjs:27940`) for registering a throwaway project
(`h.rpc("createproject", …)`, `waitForProjectInConfig`) and `rail-servers` (`scenarios.mjs:29153`, its step 10) for a
throwaway terminal tab whose `cmd:cwd` is the project, which puts the project's folder in the Active section. Teardown
closes the tab and removes the temp dir as they do. Right-click with a dispatched `contextmenu` event as
`agent-sleep` does (`scenarios.mjs:34528`) and pick the item with `caMenuHas` / `caMenuClick` (`scenarios.mjs:36017`).

Arrange: a temp dir with `git init -b main` and one untracked file, registered as `verify-overview`, and the terminal in
it (left at its prompt, so nothing runs).

Steps, each with a `h.shot("cdp-shots/project-overview-*.png")`:
1. Right-clicking `[data-project-folder="verify-overview"]` shows a menu holding "Open overview" and "Copy Absolute
   Path"; the shot is the open menu (prototype board FolderRow).
2. Clicking Open overview shows `[data-project-overview="verify-overview"]` with the branch `main`,
   `[data-overview-changes]` reading "1 file", the four `[data-overview-action]` buttons, and `[data-overview-quiet]`
   saying "Nothing needs you and nothing is running in verify-overview." (prototype board QuietNarrow).
3. The folder row reads as selected (`bg-surface-selected` in its class) while the Overview shows, and clicking it folds
   it (`aria-expanded` flips) with the Overview still in the centre.
4. Typing `echo hi && sleep 5` into the terminal (`controllerinput`, as `rail-servers` does) shows it under
   `[data-overview-running]` within the 5 seconds, and the quiet line is gone (prototype board Main's Running block).
5. Clicking `[data-overview-running-row]` puts the centre back on the terminal (`[data-project-overview]` is gone).

**Check:** with the dev app running (`task dev`), `task verify:ui -- project-overview` passes. If the dev app cannot be
started here, say so and leave the run to Final.

**Commit**

```bash
git commit -m "test(cdp): the project-overview scenario" -- scripts/cdp/scenarios.mjs
```

### Task 7: CHANGELOG and the hand check
**Depends on:** Task 4 (the page the line announces), Task 5 (the commit the hand-check line names)
**Files:** `CHANGELOG.md`, `docs/open-issues.md`

**Step 1:** The top section of `CHANGELOG.md` is dated (`## 0.15.17 — 2026-10-21`), so open a new one above it:

```markdown
## Unreleased

### Added

- Right-click a project's folder in the Agent tree and pick Open overview: one page with what in the project waits on
  you, what is running in it, and buttons to start an agent, a terminal, a run or a council there.
```

**Step 2:** Add to "0 · Waiting on a hand check" in `docs/open-issues.md`:

```markdown
- [ ] In the installed app, right-click a project folder in the Agent tree → Open overview: the page shows that project's
  asking agents and running work; Tab to a folder row and press Shift+F10: the same menu opens (project Overview, <commit>).
```

with `<commit>` the short hash of Task 5's commit.

**Step 3: Commit**

```bash
git commit -m "docs: the project Overview in What's new and the hand-check list" -- CHANGELOG.md docs/open-issues.md
```
