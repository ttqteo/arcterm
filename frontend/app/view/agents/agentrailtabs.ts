// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's right panel: which tab an agent's panel shows, the files open in it (each its own tab with
// Back/Forward), and the panel's widths (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md). Pure: no React, no Wave
// runtime.

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { normalizeRepoPath } from "@/util/paths";
import { AGENT_TREE_WIDE_PX } from "./rowfields";

// "tree" is the Files tab, the agent's worktree (docs/superpowers/specs/2026-10-08-rail-worktree-files-design.md); it is
// "tree" because "files" already names the Files changed count. "changes" is the Changes tab: the Files changed list on
// a tab of its own, every file of it rather than Overview's first few. "transcript" is the agent's conversation, drawn
// beside its terminal (docs/superpowers/specs/2026-10-29-rail-transcript-tab-design.md). "council" is the chat of the
// council the agent started (railcouncil.ts), there only while it has one (canvas rail-council-chat, board B).
// "brainstorm" is the timeline of the brainstorm attached to the agent and "initiative" the agent's linked initiative,
// each there only while the agent has the thing (docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md).
// "decided" is what the agent's pair has settled, there only while the agent is in a pair, as the working agent or as a
// judge (raildecidedpane.tsx; docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md).
// "summary" is the summary the agent's last compaction kept, opened from Overview's Compacted line and there until its x
// closes it (railcompactionline.tsx)
export type RailTab =
    | "overview"
    | "tree"
    | "changes"
    | "decided"
    | "transcript"
    | "council"
    | "brainstorm"
    | "initiative"
    | "file"
    | "summary";

/** What the agent has that a conditional tab needs: a worktree to list (and no subagent interior open), its own
 *  transcript, a council it started, an attached brainstorm, a linked initiative, a pair it is in. */
export type RailHas = {
    tree: boolean;
    transcript: boolean;
    council: boolean;
    brainstorm: boolean;
    initiative: boolean;
    decided: boolean;
};

export const RAIL_HAS_NONE: RailHas = {
    tree: false,
    transcript: false,
    council: false,
    brainstorm: false,
    initiative: false,
    decided: false,
};

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
    // HEAD). Set, the tab offers Diff, against the same base as the list's +N -N. `cwd`: the folder git reads it from,
    // `rel` then relative to it (a Chat turn's file card, whose file may sit in another work tree); absent, `root`.
    // `end`: the commit the list ends at (an agent's own edits, base..end), so the Diff reads that commit's copy instead
    // of the working copy, which may hold another writer's later change; absent, the working copy
    diff?: { rel: string; base: string; cwd?: string; end?: string };
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
    summary?: boolean; // the Summary tab is open
}

export const FILE_TABS_MAX = 5;

export const RAIL_OVERVIEW_PX = 300;
export const RAIL_WIDE_DEFAULT_PX = 520;
export const RAIL_WIDE_MIN_PX = 360;
// Chat's min-width beside a wide panel: narrower than DESIGN.md's stage-min (640), so a file can be read wide (the
// person's ask, 2026-11-22); at 420px Chat still reads
export const CHAT_MIN_PX = 420;
// the folded tree's strip (agenttreeslot.tsx), which stays when the tree folds
export const TREE_STRIP_PX = 20;

export function panelFor(panels: Record<string, PanelState>, agentId: string, defaultTab: RailTab): PanelState {
    // File, Files, Transcript, Council, Brainstorm, Initiative and Decided are never defaults: an unseen agent has no file
    // open, Files needs a cwd it may not have, Transcript a transcript, Council a council, Brainstorm a brainstorm,
    // Initiative an initiative and Decided a pair
    return (
        panels[agentId] ?? {
            tab:
                defaultTab === "file" ||
                defaultTab === "tree" ||
                defaultTab === "transcript" ||
                defaultTab === "council" ||
                defaultTab === "brainstorm" ||
                defaultTab === "initiative" ||
                defaultTab === "decided" ||
                defaultTab === "summary"
                    ? "overview"
                    : defaultTab,
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

// has.tree: the agent has a cwd to list and is not showing a subagent's interior. has.transcript: the agent itself has a
// transcript file (its own, so it stays true while a subagent's interior is open). has.council: the agent started a
// council. has.brainstorm: a brainstorm is attached. has.initiative: the agent is linked to an initiative. has.decided:
// the agent is in a pair
export function visibleTabs(p: PanelState, has: RailHas): RailTab[] {
    const tabs: RailTab[] = ["overview"];
    if (has.tree) {
        tabs.push("tree");
    }
    tabs.push("changes");
    if (has.decided) {
        tabs.push("decided");
    }
    if (has.transcript) {
        tabs.push("transcript");
    }
    if (has.council) {
        tabs.push("council");
    }
    if (has.brainstorm) {
        tabs.push("brainstorm");
    }
    if (has.initiative) {
        tabs.push("initiative");
    }
    if (p.summary) {
        tabs.push("summary");
    }
    if (p.files.length > 0) {
        tabs.push("file");
    }
    return tabs;
}

// the tab a panel draws: Files with no worktree to list (the cwd is not resolved yet, or a subagent's interior is open)
// falls back to Overview, while the stored tab stays Files for when the worktree is back; Transcript does the same
// with no transcript, Council with no council, Brainstorm with no brainstorm, Initiative with no linked initiative and
// Decided with no pair
export function shownTab(p: PanelState, has: RailHas): RailTab {
    return (p.tab === "tree" && !has.tree) ||
        (p.tab === "transcript" && !has.transcript) ||
        (p.tab === "council" && !has.council) ||
        (p.tab === "brainstorm" && !has.brainstorm) ||
        (p.tab === "initiative" && !has.initiative) ||
        (p.tab === "decided" && !has.decided) ||
        (p.tab === "summary" && !p.summary)
        ? "overview"
        : p.tab;
}

// Opens the Summary tab and shows it; again on an open one only shows it
export function openSummary(p: PanelState): PanelState {
    return { ...p, summary: true, tab: "summary", prevTab: p.tab === "summary" ? p.prevTab : p.tab };
}

/** Pure: whether the rail shows the agent's Summary tab now (Chat's Compacted divider reads as pressed). */
export function railSummaryShown(panel: PanelState | undefined, railVisible: boolean): boolean {
    return railVisible && panel?.summary === true && panel.tab === "summary";
}

// Closes the Summary tab; on show, the panel returns to the tab it was opened from
export function closeSummary(p: PanelState): PanelState {
    if (!p.summary) {
        return p;
    }
    const back = p.prevTab === "summary" ? "overview" : p.prevTab;
    return {
        ...p,
        summary: false,
        tab: p.tab === "summary" ? back : p.tab,
        prevTab: p.prevTab === "summary" ? "overview" : p.prevTab,
    };
}

export function selectTab(p: PanelState, tab: RailTab, has: RailHas): PanelState {
    if (p.tab === tab || !visibleTabs(p, has).includes(tab)) {
        return p;
    }
    return { ...p, tab, prevTab: p.tab };
}

/** `i` on a shown Initiative tab: back to the tab before it, set directly (not through selectTab, which would refuse a
 *  conditional tab without knowing what the agent has); shownTab falls back to Overview if that tab is gone. */
export function backFromInitiative(p: PanelState): PanelState {
    const back = p.prevTab === "initiative" ? "overview" : p.prevTab;
    return { ...p, tab: back, prevTab: "initiative" };
}

function samePath(x: string, y: string): boolean {
    return normalizeRepoPath(x) === normalizeRepoPath(y);
}

function showFile(p: PanelState, files: FileTab[], active: number): PanelState {
    return { ...p, tab: "file", prevTab: p.tab === "file" ? p.prevTab : p.tab, files, active };
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
        return { ...p, tab: p.tab === "file" ? p.prevTab : p.tab, prevTab: "overview", files, active: 0 };
    }
    const active = i < p.active ? p.active - 1 : i === p.active ? Math.min(i, files.length - 1) : p.active;
    return { ...p, files, active };
}

// The strip's tabs in order, as keys, for the arrow keys: on File each open file is a tab of its own; elsewhere the
// files fold into one tab, the file on show, so Overview's 300px keeps room for the counts.
export function stripKeys(p: PanelState, has: RailHas): string[] {
    const keys: string[] = visibleTabs(p, has).filter((t) => t !== "file");
    const f = activeFile(p);
    if (f == null) {
        return keys;
    }
    return shownTab(p, has) === "file" ? [...keys, ...p.files.map((x) => fileKey(x.id))] : [...keys, fileKey(f.id)];
}

export function fileKey(id: number): string {
    return `file:${id}`;
}

export function shownKey(p: PanelState, has: RailHas): string {
    const tab = shownTab(p, has);
    const f = activeFile(p);
    return tab === "file" && f != null ? fileKey(f.id) : tab;
}

export function selectKey(p: PanelState, key: string, has: RailHas): PanelState {
    return key.startsWith("file:") ? selectFile(p, Number(key.slice(5))) : selectTab(p, key as RailTab, has);
}

// the widest a wide tab may be: what leaves Chat its min-width beside the nav rail and the tree, whose width follows
// the row fields (agentTreeWidth in rowfields.ts), or only its strip while it is folded
export function wideWidthMax(windowWidth: number, navWidth: number, treeWidth = AGENT_TREE_WIDE_PX): number {
    return Math.max(RAIL_WIDE_MIN_PX, windowWidth - navWidth - treeWidth - CHAT_MIN_PX);
}

// the panel tabs that take a dragged width: File (a page of text) and Transcript (the conversation), which share one
// remembered width, as do Council, Summary and Changes (wideTabOf). Overview and Files are fixed at Overview's
export type ResizableTab = "file" | "transcript";

export const RAIL_WIDTHS: Record<ResizableTab, { min: number; def: number }> = {
    file: { min: RAIL_WIDE_MIN_PX, def: RAIL_WIDE_DEFAULT_PX },
    transcript: { min: RAIL_WIDE_MIN_PX, def: RAIL_WIDE_DEFAULT_PX },
};

// the dragged width a shown tab takes, or null for one fixed at Overview's width (Brainstorm, Initiative and Decided
// included).
// Council (a chat), Summary (a long page) and Changes (every file's diff) read long, so they widen with File's grip and
// width
export function wideTabOf(tab: RailTab): ResizableTab | null {
    switch (tab) {
        case "transcript":
            return "transcript";
        case "file":
        case "council":
        case "summary":
        case "changes":
            return "file";
        default:
            return null;
    }
}

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

// How a quote from the File tab names its file (chatquote.ts quoteLocation): the path the agent can open, resolved the
// way Pin resolves it, relative to the agent's folder first, then to the folder the file was opened against, else the
// absolute path; "/" separators either way.
export function quotePath(ref: FileRef, cwd: string | null): string {
    for (const root of [cwd, ref.root]) {
        if (root != null && isUnderRoot(root, ref.abs)) {
            return toRel(root, ref.abs);
        }
    }
    return ref.abs.replace(/\\/g, "/");
}

// how the File tab names what it holds: the title it was opened with, else the file's name
export function fileTabLabel(ref: FileRef): string {
    return ref.title || fileLabel(ref).name;
}
