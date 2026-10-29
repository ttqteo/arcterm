// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's right panel: which tab an agent's panel shows, the files open in it (each its own tab with
// Back/Forward), and the panel's widths (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md). Pure: no React, no Wave
// runtime.

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { normalizeRepoPath } from "@/util/paths";

// "tree" is the Files tab, the agent's worktree (docs/superpowers/specs/2026-10-08-rail-worktree-files-design.md); it is
// "tree" because "files" already names the Files changed count. "changes" is the Changes tab: the Files changed list on
// a tab of its own, every file of it rather than Overview's first few. "transcript" is the agent's conversation, drawn
// beside its terminal (docs/superpowers/specs/2026-10-29-rail-transcript-tab-design.md)
export type RailTab = "overview" | "tree" | "changes" | "transcript" | "file";

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

// an open file's tab: its history, and an id the strip and its close button know it by while tabs come and go
export interface FileTab extends FileHistory {
    id: number;
}

export interface PanelState {
    tab: RailTab;
    prevTab: RailTab; // where closing the last file returns to
    // the open files in the order they opened, `active` the one File shows. Opening one more than FILE_TABS_MAX closes
    // the oldest
    files: FileTab[];
    active: number;
}

export const FILE_TABS_MAX = 5;

export const RAIL_OVERVIEW_PX = 300;
export const RAIL_WIDE_DEFAULT_PX = 520;
export const RAIL_WIDE_MIN_PX = 360;
const CENTRE_MIN_PX = 640; // DESIGN.md's stage-min
const AGENT_TREE_PX = 248; // agenttree.tsx's column

export function panelFor(panels: Record<string, PanelState>, agentId: string, defaultTab: RailTab): PanelState {
    // File, Files and Transcript are never defaults: an unseen agent has no file open, Files needs a cwd it may not have,
    // and Transcript needs a transcript it may not have
    return (
        panels[agentId] ?? {
            tab:
                defaultTab === "file" || defaultTab === "tree" || defaultTab === "transcript" ? "overview" : defaultTab,
            prevTab: "overview",
            files: [],
            active: 0,
        }
    );
}

// the file tab File shows, or null while no file is open
export function activeFile(p: PanelState): FileTab | null {
    return p.files[p.active] ?? null;
}

// hasTree: the agent has a cwd to list and is not showing a subagent's interior. hasTranscript: the agent itself has a
// transcript file (its own, so it stays true while a subagent's interior is open)
export function visibleTabs(p: PanelState, hasTree: boolean, hasTranscript: boolean): RailTab[] {
    const tabs: RailTab[] = ["overview"];
    if (hasTree) {
        tabs.push("tree");
    }
    tabs.push("changes");
    if (hasTranscript) {
        tabs.push("transcript");
    }
    if (p.files.length > 0) {
        tabs.push("file");
    }
    return tabs;
}

// the tab a panel draws: Files with no worktree to list (the cwd is not resolved yet, or a subagent's interior is open)
// falls back to Overview, while the stored tab stays Files for when the worktree is back; Transcript does the same
// with no transcript
export function shownTab(p: PanelState, hasTree: boolean, hasTranscript: boolean): RailTab {
    return (p.tab === "tree" && !hasTree) || (p.tab === "transcript" && !hasTranscript) ? "overview" : p.tab;
}

export function selectTab(p: PanelState, tab: RailTab, hasTree: boolean, hasTranscript: boolean): PanelState {
    if (p.tab === tab || !visibleTabs(p, hasTree, hasTranscript).includes(tab)) {
        return p;
    }
    return { ...p, tab, prevTab: p.tab };
}

function samePath(x: string, y: string): boolean {
    return normalizeRepoPath(x) === normalizeRepoPath(y);
}

function showFile(p: PanelState, files: FileTab[], active: number): PanelState {
    return { tab: "file", prevTab: p.tab === "file" ? p.prevTab : p.tab, files, active };
}

function withActive(p: PanelState, tab: FileTab): FileTab[] {
    return p.files.map((f, i) => (i === p.active ? tab : f));
}

function tabShowing(p: PanelState, abs: string): number {
    return p.files.findIndex((f) => f.current != null && samePath(f.current.abs, abs));
}

// Opens a file in a tab of its own, or brings back the tab already showing it (at the new line). One past
// FILE_TABS_MAX closes the oldest tab.
export function openFile(p: PanelState, ref: FileRef): PanelState {
    const i = tabShowing(p, ref.abs);
    if (i >= 0) {
        return showFile(
            p,
            p.files.map((f, j) => (j === i ? { ...f, current: ref } : f)),
            i
        );
    }
    const id = p.files.reduce((m, f) => Math.max(m, f.id), 0) + 1;
    const files = [...p.files, { id, back: [], current: ref, forward: [] }].slice(-FILE_TABS_MAX);
    return showFile(p, files, files.length - 1);
}

// Follows a link from the file on show: the same tab moves to it, with Back to return. A file another tab already shows
// brings that tab forward instead, so no file has two tabs; with no file open it opens one.
export function followFile(p: PanelState, ref: FileRef): PanelState {
    const f = activeFile(p);
    const shown = tabShowing(p, ref.abs);
    if (f?.current == null || (shown >= 0 && shown !== p.active)) {
        return openFile(p, ref);
    }
    const next = samePath(f.current.abs, ref.abs)
        ? { ...f, current: ref }
        : { id: f.id, back: [...f.back, f.current], current: ref, forward: [] };
    return showFile(p, withActive(p, next), p.active);
}

export function goBack(p: PanelState): PanelState {
    const f = activeFile(p);
    if (f == null || f.back.length === 0 || f.current == null) {
        return p;
    }
    const { back, current, forward } = f;
    return {
        ...p,
        files: withActive(p, {
            id: f.id,
            back: back.slice(0, -1),
            current: back[back.length - 1],
            forward: [current, ...forward],
        }),
    };
}

export function goForward(p: PanelState): PanelState {
    const f = activeFile(p);
    if (f == null || f.forward.length === 0 || f.current == null) {
        return p;
    }
    const { back, current, forward } = f;
    return {
        ...p,
        files: withActive(p, { id: f.id, back: [...back, current], current: forward[0], forward: forward.slice(1) }),
    };
}

export function selectFile(p: PanelState, id: number): PanelState {
    const i = p.files.findIndex((f) => f.id === id);
    if (i < 0 || (p.tab === "file" && p.active === i)) {
        return p;
    }
    return showFile(p, p.files, i);
}

// Closes a file's tab, the one on show by default. Its right neighbour takes its place, else its left; the last file
// closed returns to the tab File was opened from.
export function closeFile(p: PanelState, id: number | undefined = activeFile(p)?.id): PanelState {
    const i = p.files.findIndex((f) => f.id === id);
    if (i < 0) {
        return p;
    }
    const files = p.files.filter((_, j) => j !== i);
    if (files.length === 0) {
        return { tab: p.tab === "file" ? p.prevTab : p.tab, prevTab: "overview", files, active: 0 };
    }
    const active = i < p.active ? p.active - 1 : i === p.active ? Math.min(i, files.length - 1) : p.active;
    return { ...p, files, active };
}

// The strip's tabs in order, as keys, for the arrow keys: on File each open file is a tab of its own; elsewhere the
// files fold into one tab, the file on show, so Overview's 300px keeps room for the counts.
export function stripKeys(p: PanelState, hasTree: boolean, hasTranscript: boolean): string[] {
    const keys: string[] = visibleTabs(p, hasTree, hasTranscript).filter((t) => t !== "file");
    const f = activeFile(p);
    if (f == null) {
        return keys;
    }
    return shownTab(p, hasTree, hasTranscript) === "file"
        ? [...keys, ...p.files.map((x) => fileKey(x.id))]
        : [...keys, fileKey(f.id)];
}

export function fileKey(id: number): string {
    return `file:${id}`;
}

export function shownKey(p: PanelState, hasTree: boolean, hasTranscript: boolean): string {
    const tab = shownTab(p, hasTree, hasTranscript);
    const f = activeFile(p);
    return tab === "file" && f != null ? fileKey(f.id) : tab;
}

export function selectKey(p: PanelState, key: string, hasTree: boolean, hasTranscript: boolean): PanelState {
    return key.startsWith("file:")
        ? selectFile(p, Number(key.slice(5)))
        : selectTab(p, key as RailTab, hasTree, hasTranscript);
}

// the widest a wide tab may be: what leaves the centre its minimum beside the nav rail and the tree
export function wideWidthMax(windowWidth: number, navWidth: number): number {
    return Math.max(RAIL_WIDE_MIN_PX, windowWidth - navWidth - AGENT_TREE_PX - CENTRE_MIN_PX);
}

// the panel tabs that take a dragged width: File (a page of text) and Transcript (the conversation), which share one
// remembered width. Overview, Files and Changes are fixed at Overview's
export type ResizableTab = "file" | "transcript";

export const RAIL_WIDTHS: Record<ResizableTab, { min: number; def: number }> = {
    file: { min: RAIL_WIDE_MIN_PX, def: RAIL_WIDE_DEFAULT_PX },
    transcript: { min: RAIL_WIDE_MIN_PX, def: RAIL_WIDE_DEFAULT_PX },
};

export function clampWideWidth(value: number, max: number, tab: ResizableTab = "file"): number {
    const { min, def } = RAIL_WIDTHS[tab];
    const hi = Math.max(min, max);
    if (!Number.isFinite(value)) {
        return Math.min(def, hi);
    }
    return Math.min(hi, Math.max(min, value));
}

export function nextTab<T>(tabs: T[], current: T, key: "ArrowLeft" | "ArrowRight" | "Home" | "End"): T {
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

// the path the header shows: relative to the folder the file was opened against, null for a file outside it
export function fileRel(ref: FileRef): string | null {
    return ref.root != null && isUnderRoot(ref.root, ref.abs) ? toRel(ref.root, ref.abs) : null;
}

// how the header names a file: its directory and name, relative to the root when it is under it
export function fileLabel(ref: FileRef): { dir: string; name: string } {
    const shown = fileRel(ref) ?? ref.abs.replace(/\\/g, "/");
    const i = shown.lastIndexOf("/");
    return i < 0 ? { dir: "", name: shown } : { dir: shown.slice(0, i + 1), name: shown.slice(i + 1) };
}

// Where the File tab's Pin pins its file. Pins are Code's, kept per folder (codepins.ts): the agent's folder first, so the
// pin lists in the Files tab beside it, then the folder the file was opened against. A file under neither, or a
// background task's output (a temp file), has no Pin.
export function filePinTarget(ref: FileRef, cwd: string | null): { folder: string; rel: string } | null {
    if (ref.live) {
        return null;
    }
    for (const root of [cwd, ref.root]) {
        if (root != null && isUnderRoot(root, ref.abs)) {
            return { folder: root, rel: toRel(root, ref.abs) };
        }
    }
    return null;
}

// how the File tab names what it holds: the title it was opened with, else the file's name
export function fileTabLabel(ref: FileRef): string {
    return ref.title || fileLabel(ref).name;
}
