// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    activeFile,
    backFromInitiative,
    clampWideWidth,
    closeFile,
    closeSummary,
    currentFileView,
    FILE_TABS_MAX,
    fileKey,
    fileLabel,
    filePinTarget,
    fileRel,
    fileTabLabel,
    fileViews,
    followFile,
    goBack,
    goForward,
    nextTab,
    openFile,
    openSummary,
    panelFor,
    RAIL_WIDE_DEFAULT_PX,
    RAIL_WIDE_MIN_PX,
    RAIL_WIDTHS,
    railSummaryShown,
    selectFile,
    selectKey,
    selectTab,
    shownKey,
    shownTab,
    stripKeys,
    visibleTabs,
    wideTabOf,
    wideWidthMax,
    type RailHas,
    type RailTab,
} from "./agentrailtabs";

const has = (o: Partial<RailHas> = {}): RailHas => ({
    tree: false,
    transcript: false,
    council: false,
    brainstorm: false,
    initiative: false,
    ...o,
});
// the three booleans the older tests pass: a worktree, a transcript, a council
const h = (tree: boolean, transcript: boolean, council = false): RailHas => has({ tree, transcript, council });

const a = { abs: "D:/repo/src/a.ts", root: "D:/repo", line: 4 };
const b = { abs: "D:/repo/src/b.ts", root: "D:/repo" };
const c = { abs: "D:/repo/src/c.ts", root: "D:/repo" };

describe("panelFor", () => {
    it("starts an unseen agent on the default tab, never on File, Files or Transcript", () => {
        expect(panelFor({}, "x", "overview").tab).toBe("overview");
        expect(panelFor({}, "x", "file").tab).toBe("overview");
        expect(panelFor({}, "x", "tree").tab).toBe("overview");
        expect(panelFor({}, "x", "transcript").tab).toBe("overview");
    });

    it("keeps the panel an agent already has", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "tree", h(true, false));
        expect(panelFor({ x: p }, "x", "overview")).toBe(p);
    });
});

describe("the tabs", () => {
    it("lists Overview, then Files while there is a worktree, then Changes, then File while a file is open", () => {
        const p = panelFor({}, "x", "overview");
        expect(visibleTabs(p, h(false, false))).toEqual(["overview", "changes"]);
        expect(visibleTabs(p, h(true, false))).toEqual(["overview", "tree", "changes"]);
        const withFile = openFile(p, a);
        expect(visibleTabs(withFile, h(false, false))).toEqual(["overview", "changes", "file"]);
        expect(visibleTabs(withFile, h(true, false))).toEqual(["overview", "tree", "changes", "file"]);
    });

    it("puts Transcript after Changes and before File while the agent has a transcript", () => {
        const p = panelFor({}, "x", "overview");
        expect(visibleTabs(p, h(true, true))).toEqual(["overview", "tree", "changes", "transcript"]);
        expect(visibleTabs(p, h(false, true))).toEqual(["overview", "changes", "transcript"]);
        const withFile = openFile(p, a);
        expect(visibleTabs(withFile, h(true, true))).toEqual(["overview", "tree", "changes", "transcript", "file"]);
        expect(visibleTabs(withFile, h(false, true))).toEqual(["overview", "changes", "transcript", "file"]);
    });

    it("selects Files and remembers the tab it came from", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "tree", h(true, false));
        expect(p).toMatchObject({ tab: "tree", prevTab: "overview" });
    });

    it("does not select Files without a worktree", () => {
        const p = panelFor({}, "x", "overview");
        expect(selectTab(p, "tree", h(false, false))).toBe(p);
    });

    it("selects Transcript with or without a worktree, and remembers the tab it came from", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "changes", h(true, true));
        expect(selectTab(p, "transcript", h(true, true))).toMatchObject({ tab: "transcript", prevTab: "changes" });
        expect(selectTab(p, "transcript", h(false, true))).toMatchObject({ tab: "transcript", prevTab: "changes" });
    });

    it("does not select Transcript while the agent has no transcript", () => {
        const p = panelFor({}, "x", "overview");
        expect(selectTab(p, "transcript", h(true, false))).toBe(p);
        expect(selectTab(p, "transcript", h(false, false))).toBe(p);
    });

    it("draws Overview for a Files tab that has no worktree to list, and keeps the stored tab", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "tree", h(true, false));
        expect(shownTab(p, h(true, false))).toBe("tree");
        expect(shownTab(p, h(false, false))).toBe("overview");
        expect(p.tab).toBe("tree");
        expect(shownTab(openFile(p, a), h(false, false))).toBe("file");
    });

    it("draws Overview for a Transcript tab that has no transcript, and keeps the stored tab", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "transcript", h(true, true));
        expect(shownTab(p, h(true, true))).toBe("transcript");
        expect(shownTab(p, h(true, false))).toBe("overview");
        expect(shownTab(p, h(false, true))).toBe("transcript");
        expect(p.tab).toBe("transcript");
    });

    it("leaves Files for Overview when Files has no worktree", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "tree", h(true, false));
        expect(selectTab(p, "overview", h(false, false))).toMatchObject({ tab: "overview", prevTab: "tree" });
    });

    it("leaves Transcript for Overview when the agent has no transcript", () => {
        const p = selectTab(panelFor({}, "x", "overview"), "transcript", h(true, true));
        expect(selectTab(p, "overview", h(true, false))).toMatchObject({ tab: "overview", prevTab: "transcript" });
    });
});

describe("the File tab", () => {
    it("opens a file on the File tab and remembers the tab it came from", () => {
        const p = openFile(panelFor({}, "x", "overview"), a);
        expect(p).toMatchObject({ tab: "file", prevTab: "overview" });
        expect(activeFile(p)?.current).toEqual(a);
        expect(visibleTabs(p, h(false, false))).toEqual(["overview", "changes", "file"]);
    });

    it("opens a file from Files and closes back to Files", () => {
        const onTree = selectTab(panelFor({}, "x", "overview"), "tree", h(true, false));
        const opened = openFile(onTree, a);
        expect(opened).toMatchObject({ tab: "file", prevTab: "tree" });
        expect(closeFile(opened).tab).toBe("tree");
    });

    it("opens each file in a tab of its own, the new one on show", () => {
        const p = openFile(openFile(panelFor({}, "x", "overview"), a), b);
        expect(p.files.map((f) => f.current)).toEqual([a, b]);
        expect(activeFile(p)?.current).toEqual(b);
        expect(p.files.map((f) => f.back)).toEqual([[], []]);
        expect(new Set(p.files.map((f) => f.id)).size).toBe(2);
    });

    it("brings back the tab a file is already open in, at the new line, without a second tab", () => {
        const p = openFile(openFile(openFile(panelFor({}, "x", "overview"), a), b), {
            ...a,
            abs: "d:\\repo\\src\\a.ts",
            line: 9,
        });
        expect(p.files).toHaveLength(2);
        expect(p.active).toBe(0);
        expect(activeFile(p)?.current?.line).toBe(9);
        expect(activeFile(p)?.back).toEqual([]);
    });

    it("closes the oldest tab past the cap", () => {
        let p = panelFor({}, "x", "overview");
        for (let i = 0; i <= FILE_TABS_MAX; i++) {
            p = openFile(p, { abs: `D:/repo/${i}.ts`, root: "D:/repo" });
        }
        expect(p.files).toHaveLength(FILE_TABS_MAX);
        expect(p.files[0].current?.abs).toBe("D:/repo/1.ts");
        expect(activeFile(p)?.current?.abs).toBe(`D:/repo/${FILE_TABS_MAX}.ts`);
    });

    it("follows a link in the same tab, with Back and Forward there only", () => {
        let p = followFile(openFile(openFile(panelFor({}, "x", "overview"), c), a), b);
        expect(p.files.map((f) => f.current)).toEqual([c, b]);
        expect(activeFile(p)?.back).toEqual([a]);
        p = goBack(p);
        expect(activeFile(p)?.current).toEqual(a);
        expect(activeFile(p)?.forward).toEqual([b]);
        expect(p.files[0]).toEqual({ id: p.files[0].id, back: [], current: c, forward: [] });
        p = goForward(p);
        expect(activeFile(p)?.current).toEqual(b);
        expect(activeFile(followFile(goBack(p), b))?.forward).toEqual([]);
    });

    it("follows a link to a file another tab shows by bringing that tab forward", () => {
        const p = followFile(openFile(openFile(panelFor({}, "x", "overview"), b), a), b);
        expect(p.files).toHaveLength(2);
        expect(p.active).toBe(0);
        expect(p.files[1].back).toEqual([]);
    });

    it("follows a link into a new tab when no file is open", () => {
        const p = followFile(panelFor({}, "x", "overview"), a);
        expect(p.files.map((f) => f.current)).toEqual([a]);
        expect(p.tab).toBe("file");
    });

    it("moves to a new line in the same file without a Back entry", () => {
        const p = followFile(openFile(panelFor({}, "x", "overview"), a), { ...a, abs: "d:\\repo\\src\\a.ts", line: 9 });
        expect(activeFile(p)?.back).toEqual([]);
        expect(activeFile(p)?.current?.line).toBe(9);
    });

    it("opens a file from Transcript and closes back to Transcript", () => {
        const onTranscript = selectTab(panelFor({}, "x", "overview"), "transcript", h(true, true));
        const opened = openFile(onTranscript, a);
        expect(opened).toMatchObject({ tab: "file", prevTab: "transcript" });
        expect(closeFile(opened).tab).toBe("transcript");
    });

    it("selects another file's tab and keeps where File was opened from", () => {
        const onTree = selectTab(panelFor({}, "x", "overview"), "tree", h(true, false));
        const p = openFile(openFile(onTree, a), b);
        const back = selectFile(p, p.files[0].id);
        expect(back).toMatchObject({ tab: "file", prevTab: "tree", active: 0 });
        expect(selectFile(back, back.files[0].id)).toBe(back);
        expect(selectFile(back, 999)).toBe(back);
        const fromOverview = selectFile(selectTab(p, "overview", h(true, false)), p.files[0].id);
        expect(fromOverview).toMatchObject({ tab: "file", prevTab: "overview", active: 0 });
    });

    it("closing the tab on show hands File to its right neighbour, else its left", () => {
        const p = openFile(openFile(openFile(panelFor({}, "x", "overview"), a), b), c);
        const middle = selectFile(p, p.files[1].id);
        expect(activeFile(closeFile(middle))?.current).toEqual(c);
        expect(activeFile(closeFile(p))?.current).toEqual(b);
        expect(closeFile(p).tab).toBe("file");
    });

    it("closing another tab keeps the file on show", () => {
        const p = openFile(openFile(openFile(panelFor({}, "x", "overview"), a), b), c);
        const closed = closeFile(p, p.files[0].id);
        expect(closed.files.map((f) => f.current)).toEqual([b, c]);
        expect(activeFile(closed)?.current).toEqual(c);
        expect(closeFile(p, 999)).toBe(p);
    });

    it("closes the last file back to the tab it came from", () => {
        const p = closeFile(openFile(panelFor({}, "x", "overview"), a));
        expect(p.tab).toBe("overview");
        expect(p.files).toEqual([]);
        expect(activeFile(p)).toBeNull();
        expect(visibleTabs(p, h(false, false))).toEqual(["overview", "changes"]);
    });

    it("does not select File while no file is open", () => {
        const p = panelFor({}, "x", "overview");
        expect(selectTab(p, "file", h(false, false))).toBe(p);
        expect(selectTab(p, "file", h(true, false))).toBe(p);
        expect(selectTab(p, "file", h(true, true))).toBe(p);
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

    it("names a file at the root by its name alone, so the File tab's header is never empty", () => {
        expect(fileLabel({ abs: "D:/repo/AGENTS.md", root: "D:/repo" })).toEqual({ dir: "", name: "AGENTS.md" });
    });

    it("gives the path to copy relative to the root, and none for a file outside it or with no root", () => {
        expect(fileRel(a)).toBe("src/a.ts");
        expect(fileRel({ abs: "C:/elsewhere/x.go", root: "D:/repo" })).toBeNull();
        expect(fileRel({ abs: "C:/tmp/tasks/x.output", root: null })).toBeNull();
    });
});

describe("filePinTarget", () => {
    it("pins under the agent's folder first, so the pin lists in its Files tab", () => {
        expect(filePinTarget({ abs: "D:/repo/sub/x.md", root: "D:/repo/sub" }, "D:/repo")).toEqual({
            folder: "D:/repo",
            rel: "sub/x.md",
        });
    });

    it("falls back to the folder the file was opened against", () => {
        expect(filePinTarget(a, "D:/other")).toEqual({ folder: "D:/repo", rel: "src/a.ts" });
        expect(filePinTarget(a, null)).toEqual({ folder: "D:/repo", rel: "src/a.ts" });
    });

    it("has nowhere to pin a file under neither, or a background task's output", () => {
        expect(filePinTarget({ abs: "C:/elsewhere/x.go", root: "D:/repo" }, "D:/repo")).toBeNull();
        expect(filePinTarget({ abs: "D:/repo/out.log", root: "D:/repo", live: true }, "D:/repo")).toBeNull();
    });
});

describe("widths", () => {
    it("leaves the centre 640px beside the nav, the tree and the panel", () => {
        expect(wideWidthMax(1920, 78)).toBe(1920 - 78 - 280 - 640);
        expect(wideWidthMax(1920, 78, 248)).toBe(1920 - 78 - 248 - 640);
        expect(wideWidthMax(1000, 78)).toBe(RAIL_WIDE_MIN_PX);
    });

    it("clamps a dragged width between the minimum and the maximum", () => {
        expect(clampWideWidth(200, 900)).toBe(RAIL_WIDE_MIN_PX);
        expect(clampWideWidth(2000, 900)).toBe(900);
        expect(clampWideWidth(Number.NaN, 900)).toBe(RAIL_WIDE_DEFAULT_PX);
    });

    it("gives Transcript File's minimum and default", () => {
        expect(clampWideWidth(200, 900, "transcript")).toBe(RAIL_WIDE_MIN_PX);
        expect(clampWideWidth(2000, 900, "transcript")).toBe(900);
        expect(clampWideWidth(Number.NaN, 900, "transcript")).toBe(RAIL_WIDE_DEFAULT_PX);
        expect(clampWideWidth(Number.NaN, 300, "transcript")).toBe(RAIL_WIDE_MIN_PX);
        expect(clampWideWidth(700, 900, "transcript")).toBe(clampWideWidth(700, 900, "file"));
        expect(RAIL_WIDTHS.transcript).toEqual(RAIL_WIDTHS.file);
    });

    it("widens File, Transcript, Council, Summary and Changes with a dragged width, and keeps the rest at Overview's", () => {
        expect(wideTabOf("file")).toBe("file");
        expect(wideTabOf("transcript")).toBe("transcript");
        expect(wideTabOf("council")).toBe("file");
        expect(wideTabOf("summary")).toBe("file");
        expect(wideTabOf("overview")).toBeNull();
        expect(wideTabOf("tree")).toBeNull();
        expect(wideTabOf("changes")).toBe("file");
    });
});

describe("the Summary tab", () => {
    it("opens on show after Council and before File, and remembers the tab it came from", () => {
        const p = openSummary(openFile(panelFor({}, "x", "overview"), a));
        expect(p.tab).toBe("summary");
        expect(p.prevTab).toBe("file");
        expect(visibleTabs(p, h(true, true, true))).toEqual([
            "overview",
            "tree",
            "changes",
            "transcript",
            "council",
            "summary",
            "file",
        ]);
        expect(shownTab(p, h(true, true, true))).toBe("summary");
    });

    it("is never an unseen agent's first tab", () => {
        expect(panelFor({}, "x", "summary").tab).toBe("overview");
    });

    it("opened again, only shows it and keeps where it came from", () => {
        const p = openSummary(panelFor({}, "x", "overview"));
        const away = selectTab(p, "changes", h(false, false));
        const back = openSummary(away);
        expect(back.tab).toBe("summary");
        expect(openSummary(back).prevTab).toBe(back.prevTab);
    });

    it("closes back to the tab it was opened from, and off show leaves the tab on show", () => {
        const p = openSummary(selectTab(panelFor({}, "x", "overview"), "changes", h(false, false)));
        const closed = closeSummary(p);
        expect(closed.summary).toBe(false);
        expect(closed.tab).toBe("changes");
        expect(visibleTabs(closed, h(false, false))).toEqual(["overview", "changes"]);
        const off = selectTab(p, "overview", h(false, false));
        expect(closeSummary(off).tab).toBe("overview");
        expect(closeSummary(closed)).toBe(closed);
    });

    it("stays open while a file opens and its last file closes back to it", () => {
        const p = openFile(openSummary(panelFor({}, "x", "overview")), a);
        expect(p.summary).toBe(true);
        const closed = closeFile(p);
        expect(closed.summary).toBe(true);
        expect(closed.tab).toBe("summary");
    });

    it("draws Overview for a stored Summary tab that is closed", () => {
        const p = { ...panelFor({}, "x", "overview"), tab: "summary" as RailTab };
        expect(shownTab(p, h(false, false))).toBe("overview");
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

describe("the strip's keys", () => {
    it("lists every file on File, and folds them into the one on show elsewhere", () => {
        const p = openFile(openFile(panelFor({}, "x", "overview"), a), b);
        const [ka, kb] = p.files.map((f) => fileKey(f.id));
        expect(stripKeys(p, h(true, false))).toEqual(["overview", "tree", "changes", ka, kb]);
        expect(shownKey(p, h(true, false))).toBe(kb);
        const onTree = selectTab(p, "tree", h(true, false));
        expect(stripKeys(onTree, h(true, false))).toEqual(["overview", "tree", "changes", kb]);
        expect(shownKey(onTree, h(true, false))).toBe("tree");
        expect(stripKeys(panelFor({}, "x", "overview"), h(false, false))).toEqual(["overview", "changes"]);
    });

    it("puts Transcript between Changes and the file tabs, with no tree too", () => {
        const p = openFile(openFile(panelFor({}, "x", "overview"), a), b);
        const [ka, kb] = p.files.map((f) => fileKey(f.id));
        expect(stripKeys(p, h(true, true))).toEqual(["overview", "tree", "changes", "transcript", ka, kb]);
        expect(stripKeys(p, h(false, true))).toEqual(["overview", "changes", "transcript", ka, kb]);
        const onTranscript = selectTab(p, "transcript", h(true, true));
        expect(stripKeys(onTranscript, h(true, true))).toEqual(["overview", "tree", "changes", "transcript", kb]);
        expect(shownKey(onTranscript, h(true, true))).toBe("transcript");
        expect(shownKey(onTranscript, h(true, false))).toBe("overview");
        expect(stripKeys(panelFor({}, "x", "overview"), h(true, true))).toEqual([
            "overview",
            "tree",
            "changes",
            "transcript",
        ]);
    });

    it("selects a tab or a file by its key", () => {
        const p = openFile(openFile(panelFor({}, "x", "overview"), a), b);
        expect(activeFile(selectKey(p, fileKey(p.files[0].id), h(true, false)))?.current).toEqual(a);
        expect(selectKey(p, "overview", h(true, false)).tab).toBe("overview");
        expect(nextTab(stripKeys(p, h(true, false)), shownKey(p, h(true, false)), "ArrowLeft")).toBe(
            fileKey(p.files[0].id)
        );
    });

    it("selects Transcript by its key only while there is a transcript", () => {
        const p = panelFor({}, "x", "overview");
        expect(selectKey(p, "transcript", h(true, true)).tab).toBe("transcript");
        expect(selectKey(p, "transcript", h(true, false))).toBe(p);
    });

    it("walks the arrows through Transcript on the way to File", () => {
        const p = openFile(selectTab(panelFor({}, "x", "overview"), "changes", h(true, true)), a);
        const keys = stripKeys(p, h(true, true));
        expect(nextTab(keys, "changes", "ArrowRight")).toBe("transcript");
        expect(nextTab(keys, "transcript", "ArrowRight")).toBe(fileKey(p.files[0].id));
    });
});

describe("the Council tab", () => {
    it("shows after Transcript only while the agent has a council", () => {
        const p = panelFor({}, "x", "overview");
        expect(visibleTabs(p, h(true, true, true))).toEqual(["overview", "tree", "changes", "transcript", "council"]);
        expect(visibleTabs(p, h(false, false, true))).toEqual(["overview", "changes", "council"]);
        expect(visibleTabs(p, h(true, true))).not.toContain("council");
    });

    it("is never a default", () => {
        expect(panelFor({}, "x", "council").tab).toBe("overview");
    });

    it("is selected only when there is a council, and falls back to Overview while there is none", () => {
        const p = panelFor({}, "x", "overview");
        expect(selectTab(p, "council", h(true, true))).toBe(p);
        const on = selectTab(p, "council", h(false, false, true));
        expect(on).toMatchObject({ tab: "council", prevTab: "overview" });
        expect(shownTab(on, h(false, false, true))).toBe("council");
        expect(shownTab(on, h(false, false, false))).toBe("overview");
        expect(shownKey(on, h(false, false, true))).toBe("council");
    });

    it("sits in the strip's keys before an open file", () => {
        const p = openFile(panelFor({}, "x", "overview"), { abs: "D:/a.ts", root: "D:/" });
        const keys = stripKeys(p, h(false, true, true));
        expect(keys).toEqual(["overview", "changes", "transcript", "council", ...p.files.map((f) => fileKey(f.id))]);
        expect(selectKey(p, "council", h(false, true, true)).tab).toBe("council");
    });
});

describe("brainstorm and initiative tabs", () => {
    const p = panelFor({}, "a", "overview");
    it("list after Council and before Summary, only while the agent has them", () => {
        expect(visibleTabs(p, has())).toEqual(["overview", "changes"]);
        expect(
            visibleTabs({ ...p, summary: true }, has({ council: true, brainstorm: true, initiative: true }))
        ).toEqual(["overview", "changes", "council", "brainstorm", "initiative", "summary"]);
    });
    it("fall back to Overview when the thing is gone, keeping the stored tab", () => {
        const q = selectTab(p, "initiative", has({ initiative: true }));
        expect(q.tab).toBe("initiative");
        expect(shownTab(q, has())).toBe("overview");
        expect(shownTab(q, has({ initiative: true }))).toBe("initiative");
        const r = selectTab(p, "brainstorm", has({ brainstorm: true }));
        expect(shownTab(r, has())).toBe("overview");
        expect(shownTab(r, has({ brainstorm: true }))).toBe("brainstorm");
    });
    it("are never selected while the agent lacks them, and never a panel's default", () => {
        expect(selectTab(p, "initiative", has({ brainstorm: true }))).toBe(p);
        expect(selectTab(p, "brainstorm", has({ initiative: true }))).toBe(p);
        expect(panelFor({}, "a", "brainstorm").tab).toBe("overview");
        expect(panelFor({}, "a", "initiative").tab).toBe("overview");
    });
    it("sit in the strip's keys between Council and an open file", () => {
        const f = openFile(p, a);
        const all = has({ transcript: true, council: true, brainstorm: true, initiative: true });
        expect(stripKeys(f, all)).toEqual([
            "overview",
            "changes",
            "transcript",
            "council",
            "brainstorm",
            "initiative",
            ...f.files.map((x) => fileKey(x.id)),
        ]);
        expect(selectKey(p, "brainstorm", all).tab).toBe("brainstorm");
        expect(selectKey(p, "initiative", has({ brainstorm: true }))).toBe(p);
        expect(shownKey(selectTab(p, "initiative", all), all)).toBe("initiative");
    });
    it("stay at Overview's fixed width", () => {
        expect(wideTabOf("brainstorm")).toBeNull();
        expect(wideTabOf("initiative")).toBeNull();
    });
    it("toggle back from Initiative to the tab before it, whatever that tab needs", () => {
        const q = selectTab({ ...p, tab: "transcript" }, "initiative", has({ initiative: true }));
        expect(backFromInitiative(q)).toMatchObject({ tab: "transcript", prevTab: "initiative" });
        // opened with nothing before it (prevTab is the tab itself): back is Overview
        expect(backFromInitiative({ ...p, tab: "initiative", prevTab: "initiative" })).toMatchObject({
            tab: "overview",
        });
    });
});

describe("railSummaryShown", () => {
    const base = panelFor({}, "a", "overview");
    it("is on only when the rail is visible and the Summary tab is the one shown", () => {
        const open = openSummary(base);
        expect(railSummaryShown(open, true)).toBe(true);
        expect(railSummaryShown(open, false)).toBe(false);
        expect(railSummaryShown(base, true)).toBe(false);
        expect(railSummaryShown({ ...open, tab: "overview" }, true)).toBe(false);
        expect(railSummaryShown(closeSummary(open), true)).toBe(false);
        expect(railSummaryShown(undefined, true)).toBe(false);
    });
});
