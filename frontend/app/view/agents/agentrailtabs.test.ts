// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    clampWideWidth,
    closeFile,
    currentFileView,
    fileLabel,
    fileTabLabel,
    fileViews,
    goBack,
    goForward,
    nextTab,
    openFile,
    panelFor,
    RAIL_WIDE_DEFAULT_PX,
    RAIL_WIDE_MIN_PX,
    selectTab,
    shownTab,
    visibleTabs,
    wideWidthMax,
    type RailTab,
} from "./agentrailtabs";

const a = { abs: "D:/repo/src/a.ts", root: "D:/repo", line: 4 };
const b = { abs: "D:/repo/src/b.ts", root: "D:/repo" };

describe("panelFor", () => {
    it("starts an unseen agent on the default tab, never on File or Files", () => {
        expect(panelFor({}, "x", "overview").tab).toBe("overview");
        expect(panelFor({}, "x", "file").tab).toBe("overview");
        expect(panelFor({}, "x", "tree").tab).toBe("overview");
    });

    it("keeps the panel an agent already has", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "tree", true);
        expect(panelFor({ x: p }, "x", "overview")).toBe(p);
    });
});

describe("the tabs", () => {
    it("lists Overview, then Files while there is a worktree, then File while a file is open", () => {
        const p = panelFor({}, "x", "overview");
        expect(visibleTabs(p, false)).toEqual(["overview"]);
        expect(visibleTabs(p, true)).toEqual(["overview", "tree"]);
        const withFile = openFile(p, a);
        expect(visibleTabs(withFile, false)).toEqual(["overview", "file"]);
        expect(visibleTabs(withFile, true)).toEqual(["overview", "tree", "file"]);
    });

    it("selects Files and remembers the tab it came from", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "tree", true);
        expect(p).toMatchObject({ tab: "tree", prevTab: "overview" });
    });

    it("does not select Files without a worktree", () => {
        const p = panelFor({}, "x", "overview");
        expect(selectTab(p, "tree", false)).toBe(p);
    });

    it("draws Overview for a Files tab that has no worktree to list, and keeps the stored tab", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "tree", true);
        expect(shownTab(p, true)).toBe("tree");
        expect(shownTab(p, false)).toBe("overview");
        expect(p.tab).toBe("tree");
        expect(shownTab(openFile(p, a), false)).toBe("file");
    });

    it("leaves Files for Overview when Files has no worktree", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "tree", true);
        expect(selectTab(p, "overview", false)).toMatchObject({ tab: "overview", prevTab: "tree" });
    });
});

describe("the File tab", () => {
    it("opens a file on the File tab and remembers the tab it came from", () => {
        const p = openFile(panelFor({}, "x", "overview"), a);
        expect(p).toMatchObject({ tab: "file", prevTab: "overview" });
        expect(p.file.current).toEqual(a);
        expect(visibleTabs(p, false)).toEqual(["overview", "file"]);
    });

    it("opens a file from Files and closes back to Files", () => {
        const onTree = selectTab(panelFor({}, "x", "overview"), "tree", true);
        const opened = openFile(onTree, a);
        expect(opened).toMatchObject({ tab: "file", prevTab: "tree" });
        expect(closeFile(opened).tab).toBe("tree");
    });

    it("pushes the open file onto Back and clears Forward when another opens", () => {
        let p = openFile(openFile(panelFor({}, "x", "overview"), a), b);
        expect(p.file.back).toEqual([a]);
        p = goBack(p);
        expect(p.file.current).toEqual(a);
        expect(p.file.forward).toEqual([b]);
        p = goForward(p);
        expect(p.file.current).toEqual(b);
        expect(openFile(goBack(p), b).file.forward).toEqual([]);
    });

    it("moves to a new line in the same file without a Back entry", () => {
        const p = openFile(openFile(panelFor({}, "x", "overview"), a), { ...a, abs: "d:\\repo\\src\\a.ts", line: 9 });
        expect(p.file.back).toEqual([]);
        expect(p.file.current?.line).toBe(9);
    });

    it("closes back to the tab it came from and forgets the history", () => {
        const p = closeFile(openFile(panelFor({}, "x", "overview"), a));
        expect(p.tab).toBe("overview");
        expect(p.file).toEqual({ back: [], current: null, forward: [] });
        expect(visibleTabs(p, false)).toEqual(["overview"]);
    });

    it("does not select File while no file is open", () => {
        const p = panelFor({}, "x", "overview");
        expect(selectTab(p, "file", false)).toBe(p);
        expect(selectTab(p, "file", true)).toBe(p);
    });

    it("names the tab by the title it was opened with, else by the file name", () => {
        const log = { abs: "C:/tmp/tasks/bwwscwi9k.output", root: null, live: true };
        expect(fileTabLabel(log)).toBe("bwwscwi9k.output");
        expect(fileTabLabel({ ...log, title: ":8100 uvicorn app.main:app" })).toBe(":8100 uvicorn app.main:app");
    });

    it("labels a file by its path under the root, else by its absolute path", () => {
        expect(fileLabel(a)).toEqual({ dir: "src/", name: "a.ts" });
        expect(fileLabel({ abs: "C:/elsewhere/x.go", root: "D:/repo" })).toEqual({
            dir: "C:/elsewhere/",
            name: "x.go",
        });
    });
});

describe("widths", () => {
    it("leaves the centre 640px beside the nav, the tree and the panel", () => {
        expect(wideWidthMax(1920, 78)).toBe(1920 - 78 - 248 - 640);
        expect(wideWidthMax(1000, 78)).toBe(RAIL_WIDE_MIN_PX);
    });

    it("clamps a dragged width between the minimum and the maximum", () => {
        expect(clampWideWidth(200, 900)).toBe(RAIL_WIDE_MIN_PX);
        expect(clampWideWidth(2000, 900)).toBe(900);
        expect(clampWideWidth(Number.NaN, 900)).toBe(RAIL_WIDE_DEFAULT_PX);
    });
});

describe("nextTab", () => {
    it("moves with the arrows, wrapping, and jumps with Home and End", () => {
        const tabs = ["overview", "file"] as const;
        expect(nextTab([...tabs], "overview", "ArrowRight")).toBe("file");
        expect(nextTab([...tabs], "file", "ArrowRight")).toBe("overview");
        expect(nextTab([...tabs], "overview", "ArrowLeft")).toBe("file");
        expect(nextTab([...tabs], "file", "Home")).toBe("overview");
        expect(nextTab([...tabs], "overview", "End")).toBe("file");
    });

    it("walks Overview, Files and File, wrapping at both ends", () => {
        const tabs: RailTab[] = ["overview", "tree", "file"];
        expect(nextTab(tabs, "overview", "ArrowRight")).toBe("tree");
        expect(nextTab(tabs, "tree", "ArrowRight")).toBe("file");
        expect(nextTab(tabs, "file", "ArrowRight")).toBe("overview");
        expect(nextTab(tabs, "overview", "ArrowLeft")).toBe("file");
        expect(nextTab(tabs, "file", "ArrowLeft")).toBe("tree");
        expect(nextTab(tabs, "tree", "Home")).toBe("overview");
        expect(nextTab(tabs, "tree", "End")).toBe("file");
    });
});

describe("the File tab's views", () => {
    it("offers Diff only for a file opened from Files changed", () => {
        expect(fileViews(false, false)).toEqual([]);
        expect(fileViews(true, false)).toEqual(["preview", "source"]);
        expect(fileViews(false, true)).toEqual(["source", "diff"]);
        expect(fileViews(true, true)).toEqual(["preview", "source", "diff"]);
    });

    it("shows the diff while it is chosen, and the file's own view otherwise", () => {
        expect(currentFileView(false, true, "preview", true)).toBe("diff");
        expect(currentFileView(true, true, "preview", false)).toBe("preview");
        expect(currentFileView(false, true, "preview", false)).toBe("source");
    });

    it("never shows a diff it has no base for", () => {
        expect(currentFileView(false, false, "preview", true)).toBe("source");
        expect(currentFileView(true, false, "source", true)).toBe("source");
    });
});
