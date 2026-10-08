// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
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
    reopenLauncher,
} from "./launcherstore";
import { planPathAtom, resetRunConfig, runShapeAtom, setRunShape, startAtom } from "./runconfigstore";

// the cast: without strictNullChecks, null picks atom's read-only overload
const model = () => ({ launcherAtom: atom<LauncherKind | null>(null) as PrimitiveAtom<LauncherKind | null> });

beforeEach(() => {
    globalStore.set(launcherKindAtom, "agent");
    globalStore.set(launcherRuntimeAtom, null);
    globalStore.set(launcherProjectAtom, "");
    globalStore.set(launcherPrefillAtom, null);
    globalStore.set(launcherBusyAtom, false);
    endLauncherDraft();
    resetRunConfig();
});

describe("reopenLauncher", () => {
    it("opens on the half the last open left picked", () => {
        const m = model();
        globalStore.set(launcherKindAtom, "run");
        reopenLauncher(m);
        expect(globalStore.get(m.launcherAtom)).toBe("run");
        expect(globalStore.get(launcherKindAtom)).toBe("run");
    });
    it("says draft restored like any other open", () => {
        globalStore.set(launcherTaskAtom, "fix it");
        reopenLauncher(model());
        expect(globalStore.get(launcherKindAtom)).toBe("agent");
        expect(globalStore.get(launcherRestoredAtom)).toBe(true);
    });
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
    it("the agent door keeps an agent row already picked", () => {
        globalStore.set(launcherRuntimeAtom, "terminal");
        globalStore.set(launcherKindAtom, "agent");
        openLauncher(model(), "agent");
        expect(globalStore.get(launcherKindAtom)).toBe("agent");
        expect(globalStore.get(launcherRuntimeAtom)).toBe("terminal");
    });
    it("the run door keeps a run shape already picked", () => {
        setRunShape("orchestrator");
        globalStore.set(launcherKindAtom, "run");
        openLauncher(model(), "run");
        expect(globalStore.get(launcherKindAtom)).toBe("run");
        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
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
