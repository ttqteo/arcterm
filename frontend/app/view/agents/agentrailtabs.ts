// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's right panel: which tab an agent's panel shows, the file open in its File tab with Back/Forward,
// and the panel's widths (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md). Pure: no React, no Wave
// runtime.

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { normalizeRepoPath } from "@/util/paths";

// "tree" is the Files tab, the agent's worktree (docs/superpowers/specs/2026-10-08-rail-worktree-files-design.md); it is
// "tree" because "files" already names the Files changed count
export type RailTab = "overview" | "tree" | "file";

// a file opened into the panel: its absolute path, the directory it was resolved against, and the line to show
export interface FileRef {
    abs: string;
    root: string | null;
    line?: number;
    reread?: number; // set on each open of a file that changes under it (a background task's output), to read it again
    // a background task's output: it opens following live (the Live toggle) and wrapped, with no Open in Code (a
    // temp file, nothing to edit); absent, an ordinary file
    live?: boolean;
    // what the tab calls it in place of the file name: a background task's output file is a meaningless id, so a log
    // opened from Servers says its ports and command, one from Background tasks the task's label
    title?: string;
    // opened from Files changed: the repository path git knows it by, and the commit that list is measured from ("" is
    // HEAD). Set, the tab offers Diff, against the same base as the list's +N -N
    diff?: { rel: string; base: string };
}

export type FileView = "preview" | "source" | "diff";

// The views the File tab offers: a markdown file renders (Preview) or not (Source), and a file opened from Files changed
// adds Diff. Anything else has nothing to choose between, so it gets no control.
export function fileViews(markdown: boolean, diffable: boolean): FileView[] {
    if (!diffable) {
        return markdown ? ["preview", "source"] : [];
    }
    return markdown ? ["preview", "source", "diff"] : ["source", "diff"];
}

// diffOn is the reader's last choice between Diff and the rest; a markdown file's other two follow its own mode
export function currentFileView(
    markdown: boolean,
    diffable: boolean,
    mdMode: "preview" | "source",
    diffOn: boolean
): FileView {
    if (diffable && diffOn) {
        return "diff";
    }
    return markdown ? mdMode : "source";
}

export interface FileHistory {
    back: FileRef[];
    current: FileRef | null;
    forward: FileRef[];
}

export interface PanelState {
    tab: RailTab;
    prevTab: RailTab; // where closing the file returns to
    file: FileHistory;
}

export const RAIL_OVERVIEW_PX = 300;
export const RAIL_WIDE_DEFAULT_PX = 520;
export const RAIL_WIDE_MIN_PX = 360;
// the Files tab is a tree, not a page: it opens as wide as Overview and keeps its own dragged width apart from File's
export const RAIL_TREE_MIN_PX = 240;
const CENTRE_MIN_PX = 640; // DESIGN.md's stage-min
const AGENT_TREE_PX = 248; // agenttree.tsx's column

export const EMPTY_HISTORY: FileHistory = { back: [], current: null, forward: [] };

export function panelFor(panels: Record<string, PanelState>, agentId: string, defaultTab: RailTab): PanelState {
    // File and Files are never defaults: an unseen agent has no file open, and Files needs a cwd it may not have
    return (
        panels[agentId] ?? {
            tab: defaultTab === "file" || defaultTab === "tree" ? "overview" : defaultTab,
            prevTab: "overview",
            file: EMPTY_HISTORY,
        }
    );
}

// hasTree: the agent has a cwd to list and is not showing a subagent's interior
export function visibleTabs(p: PanelState, hasTree: boolean): RailTab[] {
    const tabs: RailTab[] = ["overview"];
    if (hasTree) {
        tabs.push("tree");
    }
    if (p.file.current != null) {
        tabs.push("file");
    }
    return tabs;
}

// the tab a panel draws: Files with no worktree to list (the cwd is not resolved yet, or a subagent's interior is open)
// falls back to Overview, while the stored tab stays Files for when the worktree is back
export function shownTab(p: PanelState, hasTree: boolean): RailTab {
    return p.tab === "tree" && !hasTree ? "overview" : p.tab;
}

export function selectTab(p: PanelState, tab: RailTab, hasTree: boolean): PanelState {
    if (p.tab === tab || !visibleTabs(p, hasTree).includes(tab)) {
        return p;
    }
    return { ...p, tab, prevTab: p.tab };
}

function samePath(x: string, y: string): boolean {
    return normalizeRepoPath(x) === normalizeRepoPath(y);
}

export function openFile(p: PanelState, ref: FileRef): PanelState {
    const cur = p.file.current;
    const file =
        cur != null && samePath(cur.abs, ref.abs)
            ? { ...p.file, current: ref }
            : { back: cur != null ? [...p.file.back, cur] : p.file.back, current: ref, forward: [] };
    return { tab: "file", prevTab: p.tab === "file" ? p.prevTab : p.tab, file };
}

export function goBack(p: PanelState): PanelState {
    const { back, current, forward } = p.file;
    if (back.length === 0 || current == null) {
        return p;
    }
    return { ...p, file: { back: back.slice(0, -1), current: back[back.length - 1], forward: [current, ...forward] } };
}

export function goForward(p: PanelState): PanelState {
    const { back, current, forward } = p.file;
    if (forward.length === 0 || current == null) {
        return p;
    }
    return { ...p, file: { back: [...back, current], current: forward[0], forward: forward.slice(1) } };
}

export function closeFile(p: PanelState): PanelState {
    return { tab: p.tab === "file" ? p.prevTab : p.tab, prevTab: "overview", file: EMPTY_HISTORY };
}

// the widest a wide tab may be: what leaves the centre its minimum beside the nav rail and the tree
export function wideWidthMax(windowWidth: number, navWidth: number): number {
    return Math.max(RAIL_WIDE_MIN_PX, windowWidth - navWidth - AGENT_TREE_PX - CENTRE_MIN_PX);
}

// the panel tabs that take a dragged width, each with its own: File (a page of text) and Files (the worktree tree)
export type ResizableTab = "file" | "tree";

export const RAIL_WIDTHS: Record<ResizableTab, { min: number; def: number }> = {
    file: { min: RAIL_WIDE_MIN_PX, def: RAIL_WIDE_DEFAULT_PX },
    tree: { min: RAIL_TREE_MIN_PX, def: RAIL_OVERVIEW_PX },
};

export function clampWideWidth(value: number, max: number, tab: ResizableTab = "file"): number {
    const { min, def } = RAIL_WIDTHS[tab];
    const hi = Math.max(min, max);
    if (!Number.isFinite(value)) {
        return Math.min(def, hi);
    }
    return Math.min(hi, Math.max(min, value));
}

export function nextTab(tabs: RailTab[], current: RailTab, key: "ArrowLeft" | "ArrowRight" | "Home" | "End"): RailTab {
    if (key === "Home") {
        return tabs[0];
    }
    if (key === "End") {
        return tabs[tabs.length - 1];
    }
    const i = Math.max(0, tabs.indexOf(current));
    const step = key === "ArrowRight" ? 1 : -1;
    return tabs[(i + step + tabs.length) % tabs.length];
}

// how the header names a file: its directory and name, relative to the root when it is under it
export function fileLabel(ref: FileRef): { dir: string; name: string } {
    const shown =
        ref.root != null && isUnderRoot(ref.root, ref.abs) ? toRel(ref.root, ref.abs) : ref.abs.replace(/\\/g, "/");
    const i = shown.lastIndexOf("/");
    return i < 0 ? { dir: "", name: shown } : { dir: shown.slice(0, i + 1), name: shown.slice(i + 1) };
}

// how the File tab names what it holds: the title it was opened with, else the file's name
export function fileTabLabel(ref: FileRef): string {
    return ref.title || fileLabel(ref).name;
}
