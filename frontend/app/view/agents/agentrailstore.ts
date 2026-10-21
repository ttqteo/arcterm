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
    closeFile,
    followFile,
    goBack,
    goForward,
    openFile,
    panelFor,
    RAIL_WIDE_DEFAULT_PX,
    selectKey,
    selectTab,
    type FileRef,
    type PanelState,
    type RailTab,
    type ResizableTab,
} from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import { jumpToAgent } from "./channelsprimitives";
import { railVisibleAtom } from "./railstore";

// the tab an agent not seen yet opens on: the last one chosen. Files and File are never stored (a new agent has no
// file open, and may have no worktree)
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

export const railWidthAtoms: Record<ResizableTab, PrimitiveAtom<number>> = {
    file: railWideWidthAtom,
};

// the width while a grip is dragged: committed to that tab's width atom on release (one grip shows at a time)
export const railWideDragAtom = atom<number | null>(null) as PrimitiveAtom<number | null>;

export const railPanelsAtom = atom<Record<string, PanelState>>({}) as PrimitiveAtom<Record<string, PanelState>>;

function update(agentId: string, fn: (p: PanelState) => PanelState): void {
    const panels = globalStore.get(railPanelsAtom);
    const next = fn(panelFor(panels, agentId, globalStore.get(railTabDefaultAtom)));
    globalStore.set(railPanelsAtom, { ...panels, [agentId]: next });
}

export function selectRailTab(agentId: string, tab: RailTab, hasTree: boolean): void {
    update(agentId, (p) => selectTab(p, tab, hasTree));
    if (tab === "overview") {
        globalStore.set(railTabDefaultAtom, tab);
    }
}

// a strip key (agentrailtabs.ts stripKeys): Overview, Files, or one open file's tab
export function selectRailKey(agentId: string, key: string, hasTree: boolean): void {
    update(agentId, (p) => selectKey(p, key, hasTree));
    if (key === "overview") {
        globalStore.set(railTabDefaultAtom, key);
    }
}

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
