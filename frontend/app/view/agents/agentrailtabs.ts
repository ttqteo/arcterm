// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's right panel: which tab an agent's panel shows, the file open in its File tab with Back/Forward,
// and the panel's widths (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md). Pure: no React, no Wave
// runtime.

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { normalizeRepoPath } from "@/util/paths";

export type RailTab = "overview" | "file";

// a file opened into the panel: its absolute path, the directory it was resolved against, and the line to show
export interface FileRef {
    abs: string;
    root: string | null;
    line?: number;
    reread?: number; // set on each open of a file that changes under it (a background task's output), to read it again
    // a growing file the tab offers to follow live (the Live toggle), and whether it opens following; absent, no toggle
    live?: "on" | "off";
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
const CENTRE_MIN_PX = 640; // DESIGN.md's stage-min
const AGENT_TREE_PX = 248; // agenttree.tsx's column

export const EMPTY_HISTORY: FileHistory = { back: [], current: null, forward: [] };

export function panelFor(panels: Record<string, PanelState>, agentId: string, defaultTab: RailTab): PanelState {
    // File is never a default: an unseen agent has no file open
    return (
        panels[agentId] ?? {
            tab: defaultTab === "file" ? "overview" : defaultTab,
            prevTab: "overview",
            file: EMPTY_HISTORY,
        }
    );
}

export function visibleTabs(p: PanelState): RailTab[] {
    return p.file.current != null ? ["overview", "file"] : ["overview"];
}

export function selectTab(p: PanelState, tab: RailTab): PanelState {
    if (p.tab === tab || !visibleTabs(p).includes(tab)) {
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

export function clampWideWidth(value: number, max: number): number {
    const hi = Math.max(RAIL_WIDE_MIN_PX, max);
    if (!Number.isFinite(value)) {
        return Math.min(RAIL_WIDE_DEFAULT_PX, hi);
    }
    return Math.min(hi, Math.max(RAIL_WIDE_MIN_PX, value));
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
