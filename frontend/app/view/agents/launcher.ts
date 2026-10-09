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
    { id: "agy", name: "Antigravity" },
    { id: "terminal", name: "Terminal" },
];

const RUN_ROWS: { id: RunShape; name: string }[] = [
    { id: "quick", name: "Quick run" },
    { id: "orchestrator", name: "Orchestrate" },
];

// An uninstalled runtime stays hidden, so the digits follow the visible rows (spec D2). There are at most eight rows,
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

export function primaryLabel(kind: LauncherKind, runtime: Runtime, resuming = false): string {
    if (kind === "run") {
        return "Start run";
    }
    return resuming ? "Resume agent" : runtimeLaunchLabel(runtime);
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
    // the session an agent launch resumes; null or left out starts a new one
    resume?: { title: string; branch: string } | null;
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
    if (input.kind === "agent" && input.resume) {
        return {
            lead: "Resumes ",
            strong: input.resume.title,
            tail: input.resume.branch ? ` · ${input.resume.branch}` : "",
            blocked: false,
        };
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
    // how many images sit under the Task box
    images: number;
}

// Whether an open says "draft restored" (spec "Open, close and draft"): a close kept a task, a goal, a plan path, a
// prototype or an image, whichever pick the dialog opens on. Clear empties all five.
export function draftShown(draft: LauncherDraft): boolean {
    return [draft.task, draft.goal, draft.planPath, draft.prototype].some((v) => v.trim() !== "") || draft.images > 0;
}

// "resume" is the Resume list: it takes ↑↓ itself (launcheragentfields), so only Enter is the dialog's
export type FocusZone = "start" | "project" | "resume" | "textarea" | "input" | "other";

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
    | { kind: "column"; to: "start" | "project" }
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
        return zone === "start" || zone === "project" || zone === "resume" || zone === "input"
            ? { kind: "launch" }
            : NONE;
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
    // → is the step from Start to Project, ← the step back; the columns sit side by side, so the arrows read as such
    if (k.key === "ArrowRight") {
        return zone === "start" ? { kind: "column", to: "project" } : NONE;
    }
    if (k.key === "ArrowLeft") {
        return zone === "project" ? { kind: "column", to: "start" } : NONE;
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
