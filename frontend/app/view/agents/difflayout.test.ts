// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    clampLogSplit,
    clampPanelWidth,
    commitTabCount,
    defaultPanelTab,
    PANEL_FOLD_PX,
    panelTabToApply,
    resolvePanelFolded,
    sourceTitle,
} from "./difflayout";
import type { DiffScope } from "./diffscope";

describe("resolvePanelFolded", () => {
    // about 920px: the shipped 1000px window less the nav
    it("folds by default below the threshold", () => {
        expect(resolvePanelFolded(null, 920)).toBe(true);
    });

    it("stays open by default at and above the threshold", () => {
        expect(resolvePanelFolded(null, PANEL_FOLD_PX)).toBe(false);
        expect(resolvePanelFolded(null, 1600)).toBe(false);
    });

    it("keeps the threshold at 1000px", () => {
        expect(PANEL_FOLD_PX).toBe(1000);
    });

    // an explicit choice is a choice: resizing must not silently undo it
    it("lets an explicit choice win at any width", () => {
        expect(resolvePanelFolded(false, 900)).toBe(false);
        expect(resolvePanelFolded(true, 1900)).toBe(true);
    });

    // width is 0 before the first ResizeObserver callback; folding then would flash the panel away
    it("does not fold on an unmeasured width", () => {
        expect(resolvePanelFolded(null, 0)).toBe(false);
    });
});

describe("clampPanelWidth", () => {
    it("keeps a width inside 280–560", () => {
        expect(clampPanelWidth(340)).toBe(340);
        expect(clampPanelWidth(280)).toBe(280);
        expect(clampPanelWidth(560)).toBe(560);
    });

    it("pulls a width outside the range back to the nearest end", () => {
        expect(clampPanelWidth(100)).toBe(280);
        expect(clampPanelWidth(900)).toBe(560);
    });

    it("falls back to the default on a value that is not a number", () => {
        expect(clampPanelWidth(Number.NaN)).toBe(340);
    });
});

describe("clampLogSplit", () => {
    it("keeps a fraction inside 0.25–0.8", () => {
        expect(clampLogSplit(0.55)).toBe(0.55);
        expect(clampLogSplit(0.25)).toBe(0.25);
        expect(clampLogSplit(0.8)).toBe(0.8);
    });

    it("pulls a fraction outside the range back to the nearest end", () => {
        expect(clampLogSplit(0.05)).toBe(0.25);
        expect(clampLogSplit(0.99)).toBe(0.8);
    });

    it("falls back to the default on a value that is not a number", () => {
        expect(clampLogSplit(Number.NaN)).toBe(0.55);
    });
});

describe("defaultPanelTab", () => {
    it("opens Log for an agent origin, dirty or not", () => {
        expect(defaultPanelTab("agent", "session", 4)).toBe("log");
        expect(defaultPanelTab("agent", "working", 4)).toBe("log");
    });

    it("opens Log for a session, run or compare range", () => {
        expect(defaultPanelTab("project", "session", 4)).toBe("log");
        expect(defaultPanelTab("project", "run", 4)).toBe("log");
        expect(defaultPanelTab("worktree", "compare", 4)).toBe("log");
    });

    it("opens Commit on a project or worktree with changes", () => {
        expect(defaultPanelTab("project", "working", 3)).toBe("commit");
        expect(defaultPanelTab("worktree", "working", 1)).toBe("commit");
    });

    it("opens Log on a clean project or worktree", () => {
        expect(defaultPanelTab("project", "working", 0)).toBe("log");
        expect(defaultPanelTab("worktree", "working", 0)).toBe("log");
    });
});

describe("panelTabToApply", () => {
    it("waits while the list for the key is still loading", () => {
        expect(panelTabToApply("", "project:a|working", false, "project", "working", 0)).toBeNull();
    });

    // a fresh pick of a dirty tree must open Commit, never Log off a list that has not arrived
    it("returns Commit for a loaded fresh key with dirty files", () => {
        expect(panelTabToApply("", "project:a|working", true, "project", "working", 3)).toBe("commit");
    });

    it("returns Log for a loaded fresh key with a clean tree", () => {
        expect(panelTabToApply("", "project:a|working", true, "project", "working", 0)).toBe("log");
    });

    it("returns Log for a loaded fresh agent key", () => {
        expect(panelTabToApply("project:a|working", "agent:x|session:x", true, "agent", "session", 5)).toBe("log");
    });

    it("applies again when the key changes", () => {
        expect(panelTabToApply("project:a|working", "project:b|working", true, "project", "working", 2)).toBe("commit");
    });

    // a poll tick re-reads the list: the person's later choice of tab must survive it
    it("returns null for a reload of an applied key, even when its dirty count changes", () => {
        expect(panelTabToApply("project:a|working", "project:a|working", true, "project", "working", 0)).toBeNull();
        expect(panelTabToApply("project:a|working", "project:a|working", true, "project", "working", 9)).toBeNull();
    });

    it("returns null for an applied key that is not loaded either", () => {
        expect(panelTabToApply("project:a|working", "project:a|working", false, "project", "working", 0)).toBeNull();
    });
});

describe("sourceTitle", () => {
    const scope = (origin: DiffScope["repo"]["origin"], label: string): DiffScope => ({
        repo: { origin, label },
        range: { kind: "working" },
    });

    it("names a project and its branch", () => {
        expect(sourceTitle(scope({ kind: "project", name: "arcterm", path: "/r" }, "arcterm"), "main")).toEqual({
            name: "arcterm",
            branch: "main",
        });
    });

    it("names an agent by its label", () => {
        expect(sourceTitle(scope({ kind: "agent", id: "a1" }, "jarvis-recall"), "feat/x")).toEqual({
            name: "jarvis-recall",
            branch: "feat/x",
        });
    });

    it("names a linked worktree by its project, not its folder", () => {
        expect(
            sourceTitle(scope({ kind: "worktree", path: "/r/.wt/feat", project: "arcterm" }, "feat"), "feat")
        ).toEqual({ name: "arcterm", branch: "feat" });
    });

    it("reads a detached HEAD as detached", () => {
        expect(sourceTitle(scope({ kind: "project", name: "arcterm", path: "/r" }, "arcterm"), "HEAD").branch).toBe(
            "detached"
        );
    });

    it("asks for a source when nothing is picked", () => {
        expect(sourceTitle(null, "")).toEqual({ name: "Pick a source", branch: "" });
    });
});

describe("commitTabCount", () => {
    const changes = (n: number) => ({ files: Array.from({ length: n }, () => ({})) });

    it("counts the working tree's files on a live read", () => {
        expect(commitTabCount({ ref: "", changes: changes(7) })).toBe(7);
        expect(commitTabCount({ ref: "", changes: changes(0) })).toBe(0);
    });

    it("has no count for a read anchored at a base, which lists committed work too", () => {
        expect(commitTabCount({ ref: "9f2c1de", changes: changes(7) })).toBeNull();
    });

    it("has no count before a list has loaded", () => {
        expect(commitTabCount(null)).toBeNull();
        expect(commitTabCount({ ref: "", changes: null })).toBeNull();
    });
});
