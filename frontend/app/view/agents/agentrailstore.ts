// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's state: per agent and in memory (the selected tab, the open files with their history), plus the three
// persisted preferences (the tab an unseen agent opens on, the File tab's width, how a markdown file shows).

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { openFileInCode } from "@/app/cockpit/openfilestore";
import { globalStore } from "@/app/store/jotaiStore";
import { openInCode } from "@/app/view/code/codestore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
    backFromInitiative,
    closeFile,
    closeSummary,
    followFile,
    goBack,
    goForward,
    openFile,
    openSummary,
    panelFor,
    RAIL_HAS_NONE,
    RAIL_WIDE_DEFAULT_PX,
    selectKey,
    selectTab,
    type FileRef,
    type PanelState,
    type RailHas,
    type RailTab,
    type ResizableTab,
} from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import { jumpToAgent } from "./channelsprimitives";
import { railVisibleAtom } from "./railstore";

// the tab an agent not seen yet opens on: the last one chosen. Files, File and Transcript are never stored (a new agent
// has no file open, and may have no worktree or transcript)
export const railTabDefaultAtom = atomWithStorage<RailTab>("agent.rail.tab", "overview", undefined, {
    getOnInit: true,
}) as PrimitiveAtom<RailTab>;

export const railWideWidthAtom = atomWithStorage<number>("agent.rail.wideWidth", RAIL_WIDE_DEFAULT_PX, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<number>;

// how the File tab shows a markdown file: rendered (Preview, where comments are made) or Monaco (Source); one choice
// for every agent
export const railMdModeAtom = atomWithStorage<"preview" | "source">("agent.rail.mdMode", "preview", undefined, {
    getOnInit: true,
}) as PrimitiveAtom<"preview" | "source">;

// whether a file opened from Files changed shows its Diff (the other views: railMdModeAtom). Every such open turns it
// back on, since showing the change is why that file was clicked; session-scoped like the panels
export const railDiffOnAtom = atom(true);

// File and Transcript are both wide and read and write the one remembered width
export const railWidthAtoms: Record<ResizableTab, PrimitiveAtom<number>> = {
    file: railWideWidthAtom,
    transcript: railWideWidthAtom,
};

// bumped each time the Transcript tab is asked for by key (openRailTranscript): the tab's body moves focus to its
// scroller on every bump, so the arrows and PageUp / PageDown scroll it at once
export const railTranscriptFocusAtom = atom(0) as PrimitiveAtom<number>;

// the width while a grip is dragged: committed to that tab's width atom on release (one grip shows at a time)
export const railWideDragAtom = atom<number | null>(null) as PrimitiveAtom<number | null>;

export const railPanelsAtom = atom<Record<string, PanelState>>({}) as PrimitiveAtom<Record<string, PanelState>>;

function update(agentId: string, fn: (p: PanelState) => PanelState): void {
    const panels = globalStore.get(railPanelsAtom);
    const next = fn(panelFor(panels, agentId, globalStore.get(railTabDefaultAtom)));
    globalStore.set(railPanelsAtom, { ...panels, [agentId]: next });
}

export function selectRailTab(agentId: string, tab: RailTab, has: RailHas): void {
    update(agentId, (p) => selectTab(p, tab, has));
    if (tab === "overview") {
        globalStore.set(railTabDefaultAtom, tab);
    }
}

// a strip key (agentrailtabs.ts stripKeys): Overview, Files, Changes, Transcript, Council, Brainstorm, Initiative, or
// one open file's tab
export function selectRailKey(agentId: string, key: string, has: RailHas): void {
    update(agentId, (p) => selectKey(p, key, has));
    if (key === "overview") {
        globalStore.set(railTabDefaultAtom, key);
    }
}

// Opens the rail on the agent's Transcript tab and asks its body for focus. The caller has checked that the agent has a
// transcript; Transcript's place in the strip does not depend on a worktree, so `tree` is false here.
export function openRailTranscript(agentId: string): void {
    update(agentId, (p) => selectTab(p, "transcript", { ...RAIL_HAS_NONE, transcript: true }));
    globalStore.set(railVisibleAtom, true);
    globalStore.set(railTranscriptFocusAtom, (n) => n + 1);
}

// Opens the rail on the agent's Council tab (the `c` key, agent:council-chat). The caller has checked that the agent
// started a council; Council's place in the strip depends on nothing else, so everything else is false.
export function openRailCouncil(agentId: string): void {
    update(agentId, (p) => selectTab(p, "council", { ...RAIL_HAS_NONE, council: true }));
    globalStore.set(railVisibleAtom, true);
}

// Opens the rail on the agent's Brainstorm tab. The caller has checked that a brainstorm is attached.
export function openRailBrainstorm(agentId: string): void {
    update(agentId, (p) => selectTab(p, "brainstorm", { ...RAIL_HAS_NONE, brainstorm: true }));
    globalStore.set(railVisibleAtom, true);
}

// the Initiative tab section a caller asked to show, per agent; the pane clears it once it has unfolded it
export const railInitiativeSectionAtom = atom<Record<string, "plan">>({}) as PrimitiveAtom<Record<string, "plan">>;

// the agent whose Initiative pane should take focus when it next shows; the pane clears it
export const railInitiativeFocusAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// Opens the rail on the agent's Initiative tab (the ◇ chip, `i`, the header's "N to review" chip, "Review on the rail").
// The caller has checked that the agent is linked to an initiative. `section` unfolds that section and scrolls it into
// view (railInitiativeSectionAtom). The pane takes focus when it shows from here (railInitiativeFocusAtom), so its keys
// work at once.
export function openRailInitiative(agentId: string, section?: "plan"): void {
    update(agentId, (p) => selectTab(p, "initiative", { ...RAIL_HAS_NONE, initiative: true }));
    globalStore.set(railVisibleAtom, true);
    globalStore.set(railInitiativeFocusAtom, agentId);
    if (section != null) {
        globalStore.set(railInitiativeSectionAtom, {
            ...globalStore.get(railInitiativeSectionAtom),
            [agentId]: section,
        });
    }
}

// `i`: the Initiative tab when it is not on show (or the rail is hidden), else back to the tab before it. Reads the
// panel's stored tab, not shownTab: the caller has checked that the agent is linked, so a stored Initiative tab is the
// shown one.
export function toggleRailInitiative(agentId: string): void {
    const panel = panelFor(globalStore.get(railPanelsAtom), agentId, globalStore.get(railTabDefaultAtom));
    if (panel.tab === "initiative" && globalStore.get(railVisibleAtom)) {
        update(agentId, backFromInitiative);
        return;
    }
    openRailInitiative(agentId);
}

// Opens the Summary tab, the summary the agent's last compaction kept (Overview's Compacted line), and its x closes it
export function openRailSummary(agentId: string): void {
    update(agentId, openSummary);
    globalStore.set(railVisibleAtom, true);
}

export const closeRailSummary = (agentId: string) => update(agentId, closeSummary);

// Shows the agent on the Agent surface with its panel open on the file, in a tab of its own. `follow`: a link followed
// from the file on show, which moves that tab to it, with Back to return.
export function openFileInPanel(model: AgentsViewModel, agentId: string, ref: FileRef, follow = false): void {
    update(agentId, (p) => (follow ? followFile(p, ref) : openFile(p, ref)));
    if (ref.diff != null) {
        globalStore.set(railDiffOnAtom, true);
    }
    globalStore.set(railVisibleAtom, true);
    jumpToAgent(model, agentId);
}

// closes a file's tab, the one on show when no id is given
export const closeRailFile = (agentId: string, id?: number) => update(agentId, (p) => closeFile(p, id));
export const railFileBack = (agentId: string) => update(agentId, goBack);
export const railFileForward = (agentId: string) => update(agentId, goForward);

// "Open in Code", and where a link goes when there is no panel: a file under its root opens in that project
export async function openRefInCode(model: AgentsViewModel, ref: FileRef): Promise<void> {
    if (ref.root != null && isUnderRoot(ref.root, ref.abs)) {
        await openInCode(model, { projectPath: ref.root, rel: toRel(ref.root, ref.abs), line: ref.line });
        return;
    }
    await openFileInCode(model, ref.abs, false, ref.line);
}
