// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildTree, visibleRows } from "@/app/view/code/codetree";
import { describe, expect, it } from "vitest";
import {
    clickRow,
    dragPaths,
    EMPTY_RAIL_TREE,
    moveCursorTo,
    pruneExpanded,
    shouldReloadTree,
    toggleExpanded,
    type RailTreeState,
} from "./railtree";

// build/ is an ignored directory not listed yet; the rest is tracked. Fully expanded, the rows read:
// build, docs, docs/guide.md, docs/my notes.md, src, src/app, src/app/main.ts, src/util.ts, README.md
const TREE = buildTree(
    ["README.md", "docs/guide.md", "docs/my notes.md", "src/app/main.ts", "src/util.ts"],
    ["build/"]
);

function rowsOf(expanded: string[] = []) {
    return visibleRows(TREE, new Set(expanded));
}

function state(over: Partial<RailTreeState> = {}): RailTreeState {
    return { ...EMPTY_RAIL_TREE, ...over };
}

describe("EMPTY_RAIL_TREE", () => {
    it("starts with nothing expanded, selected or focused", () => {
        expect(EMPTY_RAIL_TREE).toEqual({ expanded: [], selected: [], anchor: null, cursor: null });
    });
});

describe("clickRow: plain", () => {
    it("selects only the clicked file and makes it the anchor and the cursor", () => {
        const s = clickRow(EMPTY_RAIL_TREE, rowsOf(), "README.md", "none");
        expect(s).toEqual({ expanded: [], selected: ["README.md"], anchor: "README.md", cursor: "README.md" });
    });

    it("replaces an earlier selection", () => {
        const first = clickRow(EMPTY_RAIL_TREE, rowsOf(), "README.md", "none");
        const second = clickRow(first, rowsOf(), "docs", "none");
        expect(second.selected).toEqual(["docs"]);
        expect(second.anchor).toBe("docs");
    });

    it("opens a collapsed directory it selects", () => {
        const s = clickRow(EMPTY_RAIL_TREE, rowsOf(), "src", "none");
        expect(s.expanded).toEqual(["src"]);
        expect(s.selected).toEqual(["src"]);
    });

    it("closes an expanded directory it selects", () => {
        const s = clickRow(state({ expanded: ["src", "docs"] }), rowsOf(["src", "docs"]), "src", "none");
        expect(s.expanded).toEqual(["docs"]);
        expect(s.selected).toEqual(["src"]);
    });

    it("leaves expanded alone for a file", () => {
        const s = clickRow(state({ expanded: ["src"] }), rowsOf(["src"]), "src/util.ts", "none");
        expect(s.expanded).toEqual(["src"]);
    });

    it("does not change the state it was given", () => {
        const before = state({ expanded: ["docs"], selected: ["docs"], anchor: "docs", cursor: "docs" });
        const copy = structuredClone(before);
        clickRow(before, rowsOf(["docs"]), "src", "none");
        expect(before).toEqual(copy);
    });
});

describe("clickRow: toggle (Ctrl/Cmd)", () => {
    it("adds a row to the selection and moves the anchor and cursor to it", () => {
        const first = clickRow(EMPTY_RAIL_TREE, rowsOf(["src"]), "README.md", "none");
        const s = clickRow(first, rowsOf(["src"]), "src/util.ts", "toggle");
        expect(s.selected).toEqual(["README.md", "src/util.ts"]);
        expect(s.anchor).toBe("src/util.ts");
        expect(s.cursor).toBe("src/util.ts");
    });

    it("removes a row that is already selected", () => {
        const a = clickRow(EMPTY_RAIL_TREE, rowsOf(), "README.md", "none");
        const b = clickRow(a, rowsOf(), "docs", "toggle");
        const c = clickRow(b, rowsOf(), "README.md", "toggle");
        expect(c.selected).toEqual(["docs"]);
        expect(c.anchor).toBe("README.md");
    });

    it("does not open or close a directory", () => {
        const s = clickRow(EMPTY_RAIL_TREE, rowsOf(), "src", "toggle");
        expect(s.selected).toEqual(["src"]);
        expect(s.expanded).toEqual([]);
        const open = clickRow(state({ expanded: ["src"] }), rowsOf(["src"]), "src", "toggle");
        expect(open.expanded).toEqual(["src"]);
    });
});

describe("clickRow: range (Shift)", () => {
    // collapsed rows: build, docs, src, README.md
    it("selects the visible rows from the anchor down to the clicked row, inclusive", () => {
        const a = clickRow(EMPTY_RAIL_TREE, rowsOf(), "build", "none");
        const s = clickRow(a, rowsOf(), "src", "range");
        expect(s.selected).toEqual(["build", "docs", "src"]);
    });

    it("selects upward too, and lists the selection in row order", () => {
        const a = clickRow(EMPTY_RAIL_TREE, rowsOf(), "README.md", "none");
        const s = clickRow(a, rowsOf(), "docs", "range");
        expect(s.selected).toEqual(["docs", "src", "README.md"]);
    });

    it("keeps the anchor and moves the cursor to the clicked row", () => {
        const a = clickRow(EMPTY_RAIL_TREE, rowsOf(), "docs", "none");
        const s = clickRow(a, rowsOf(), "README.md", "range");
        expect(s.anchor).toBe("docs");
        expect(s.cursor).toBe("README.md");
    });

    it("replaces whatever was selected before", () => {
        const a = clickRow(EMPTY_RAIL_TREE, rowsOf(), "build", "none");
        const b = clickRow(a, rowsOf(), "README.md", "toggle");
        const c = clickRow(b, rowsOf(), "docs", "range");
        expect(c.selected).toEqual(["docs", "src", "README.md"]);
        expect(c.selected).not.toContain("build");
    });

    it("does not open or close a directory", () => {
        const a = clickRow(EMPTY_RAIL_TREE, rowsOf(), "docs", "none");
        const s = clickRow({ ...a, expanded: [] }, rowsOf(), "src", "range");
        expect(s.expanded).toEqual([]);
    });

    it("does not select the hidden children of a collapsed directory it spans", () => {
        // src is collapsed: src/app and src/util.ts are not rows
        const a = clickRow(EMPTY_RAIL_TREE, rowsOf(), "docs", "none");
        const s = clickRow({ ...a, expanded: [] }, rowsOf(), "README.md", "range");
        expect(s.selected).toEqual(["docs", "src", "README.md"]);
        expect(s.selected).not.toContain("src/app");
        expect(s.selected).not.toContain("src/util.ts");
    });

    it("selects the children of a directory that is open", () => {
        const open = ["src", "src/app"];
        const a = clickRow(EMPTY_RAIL_TREE, rowsOf(open), "src", "none");
        // the plain click collapsed src; put it back open as the pane would have it
        const s = clickRow({ ...a, expanded: open }, rowsOf(open), "src/util.ts", "range");
        expect(s.selected).toEqual(["src", "src/app", "src/app/main.ts", "src/util.ts"]);
    });

    it("with no anchor behaves as a plain click, without opening a directory", () => {
        const s = clickRow(EMPTY_RAIL_TREE, rowsOf(), "src", "range");
        expect(s).toEqual({ expanded: [], selected: ["src"], anchor: "src", cursor: "src" });
    });

    it("with an anchor that is no longer a visible row behaves as a plain click", () => {
        const hidden = state({ expanded: [], selected: ["src/util.ts"], anchor: "src/util.ts", cursor: "src/util.ts" });
        const s = clickRow(hidden, rowsOf(), "docs", "range");
        expect(s).toEqual({ expanded: [], selected: ["docs"], anchor: "docs", cursor: "docs" });
    });
});

describe("toggleExpanded", () => {
    it("opens a closed directory and closes an open one", () => {
        const open = toggleExpanded(EMPTY_RAIL_TREE, "src");
        expect(open.expanded).toEqual(["src"]);
        expect(toggleExpanded(open, "src").expanded).toEqual([]);
    });

    it("leaves the selection, anchor and cursor as they were", () => {
        const s = state({ selected: ["README.md"], anchor: "README.md", cursor: "README.md" });
        const t = toggleExpanded(s, "docs");
        expect(t.selected).toEqual(["README.md"]);
        expect(t.anchor).toBe("README.md");
        expect(t.cursor).toBe("README.md");
    });
});

describe("moveCursorTo", () => {
    it("selects that row alone and makes it the anchor and the cursor", () => {
        const s = state({ selected: ["README.md", "docs"], anchor: "docs", cursor: "docs", expanded: ["src"] });
        expect(moveCursorTo(s, "src/util.ts")).toEqual({
            expanded: ["src"],
            selected: ["src/util.ts"],
            anchor: "src/util.ts",
            cursor: "src/util.ts",
        });
    });
});

describe("dragPaths", () => {
    const open = ["docs", "src", "src/app"];

    it("drags the whole selection, in row order, when the dragged row is selected", () => {
        // clicked bottom to top: the selection list is in click order, the drag is in row order
        let s = clickRow(EMPTY_RAIL_TREE, rowsOf(open), "README.md", "none");
        s = clickRow(s, rowsOf(open), "src/util.ts", "toggle");
        s = clickRow(s, rowsOf(open), "docs/guide.md", "toggle");
        expect(s.selected).toEqual(["README.md", "src/util.ts", "docs/guide.md"]);
        const rows = rowsOf(open);
        expect(dragPaths(s, rows, "src/util.ts")).toEqual(["docs/guide.md", "src/util.ts", "README.md"]);
        expect(dragPaths(s, rows, "README.md")).toEqual(["docs/guide.md", "src/util.ts", "README.md"]);
    });

    it("drags only an unselected row, and leaves the selection as it was", () => {
        const s = clickRow(EMPTY_RAIL_TREE, rowsOf(open), "README.md", "none");
        const before = structuredClone(s);
        expect(dragPaths(s, rowsOf(open), "src/util.ts")).toEqual(["src/util.ts"]);
        expect(s).toEqual(before);
    });

    it("drags a lone row when nothing is selected", () => {
        expect(dragPaths(EMPTY_RAIL_TREE, rowsOf(open), "docs/my notes.md")).toEqual(["docs/my notes.md"]);
    });

    it("ends a directory's path in a slash, selected or not", () => {
        const rows = rowsOf(open);
        expect(dragPaths(EMPTY_RAIL_TREE, rows, "src")).toEqual(["src/"]);
        let s = clickRow(EMPTY_RAIL_TREE, rowsOf(), "docs", "none"); // plain click opens docs; keep it selected only
        s = { ...s, expanded: open };
        s = clickRow(s, rows, "src/util.ts", "toggle");
        expect(dragPaths(s, rows, "docs")).toEqual(["docs/", "src/util.ts"]);
    });

    it("ends a not-yet-listed ignored directory's path in a slash", () => {
        expect(dragPaths(EMPTY_RAIL_TREE, rowsOf(), "build")).toEqual(["build/"]);
    });

    it("leaves out selected rows hidden inside a collapsed directory", () => {
        const rows = rowsOf(["src"]);
        let s = clickRow(EMPTY_RAIL_TREE, rows, "src/util.ts", "none");
        s = clickRow(s, rows, "README.md", "toggle");
        const collapsed = rowsOf();
        expect(dragPaths(s, collapsed, "README.md")).toEqual(["README.md"]);
    });
});

describe("pruneExpanded", () => {
    const full = state({
        expanded: ["docs", "gone", "src/app", "src"],
        selected: ["README.md", "removed.md"],
        anchor: "removed.md",
        cursor: "README.md",
    });

    it("drops expanded and selected paths the listing no longer has", () => {
        const s = pruneExpanded(full, TREE);
        expect(s.expanded).toEqual(["docs", "src/app", "src"]);
        expect(s.selected).toEqual(["README.md"]);
    });

    it("clears an anchor or cursor naming a vanished path and keeps one that survives", () => {
        const s = pruneExpanded(full, TREE);
        expect(s.anchor).toBeNull();
        expect(s.cursor).toBe("README.md");
    });

    it("keeps an expanded directory that sits inside a collapsed one", () => {
        // src is not expanded here, so src/app is no visible row, but it is still in the listing
        const s = pruneExpanded(state({ expanded: ["src/app"] }), TREE);
        expect(s.expanded).toEqual(["src/app"]);
    });

    it("takes the visible rows as the listing too", () => {
        const rows = rowsOf(["docs"]);
        const s = pruneExpanded(
            state({ expanded: ["docs", "gone"], selected: ["docs/guide.md", "src/util.ts"] }),
            rows
        );
        expect(s.expanded).toEqual(["docs"]);
        expect(s.selected).toEqual(["docs/guide.md"]);
    });

    it("hands back the same state object when nothing was dropped", () => {
        const s = state({ expanded: ["src"], selected: ["src/util.ts"], anchor: "src/util.ts", cursor: "src" });
        expect(pruneExpanded(s, TREE)).toBe(s);
    });

    it("empties everything for an empty listing", () => {
        expect(pruneExpanded(full, [])).toEqual(EMPTY_RAIL_TREE);
    });

    it("does not change the state it was given", () => {
        const copy = structuredClone(full);
        pruneExpanded(full, TREE);
        expect(full).toEqual(copy);
    });
});

describe("shouldReloadTree", () => {
    it("reloads when the tab becomes shown", () => {
        expect(shouldReloadTree({ state: "idle", tabShown: false }, { state: "idle", tabShown: true })).toBe(true);
    });

    it("reloads when the tab becomes shown in the same render as a state change", () => {
        expect(shouldReloadTree({ state: "working", tabShown: false }, { state: "idle", tabShown: true })).toBe(true);
    });

    it("reloads on a state change while the tab shows", () => {
        expect(shouldReloadTree({ state: "working", tabShown: true }, { state: "idle", tabShown: true })).toBe(true);
    });

    it("does not reload while the tab shows and the state is the same", () => {
        expect(shouldReloadTree({ state: "idle", tabShown: true }, { state: "idle", tabShown: true })).toBe(false);
    });

    it("does not reload on a state change while the tab is hidden", () => {
        expect(shouldReloadTree({ state: "working", tabShown: false }, { state: "idle", tabShown: false })).toBe(false);
    });

    it("does not reload when the tab is hidden", () => {
        expect(shouldReloadTree({ state: "idle", tabShown: true }, { state: "working", tabShown: false })).toBe(false);
        expect(shouldReloadTree({ state: "idle", tabShown: false }, { state: "idle", tabShown: false })).toBe(false);
    });

    it("reloads the first time it sees a shown tab, when there is no previous observation", () => {
        expect(shouldReloadTree(null, { state: "idle", tabShown: true })).toBe(true);
        expect(shouldReloadTree(null, { state: "idle", tabShown: false })).toBe(false);
    });

    it("treats a state that appears or disappears as a change", () => {
        expect(shouldReloadTree({ state: undefined, tabShown: true }, { state: "idle", tabShown: true })).toBe(true);
    });
});
