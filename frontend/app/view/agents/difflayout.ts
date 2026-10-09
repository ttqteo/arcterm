// frontend/app/view/agents/difflayout.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Diff surface's layout rules. The surface is one left panel (Commit | Log tabs) beside a wide diff. The
// surface ships in a 1000x700 window (src-tauri/tauri.conf.json), where a 340px panel leaves the diff about 580px,
// so below PANEL_FOLD_PX the panel starts folded and the diff header takes over its entry points. One threshold is the
// whole of it; the rest of the folding cascade stays declined (docs/deferred.md).

import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { DiffOrigin, DiffRange, DiffScope } from "./diffscope";

export type PanelTab = "commit" | "log";

// Measured on the whole surface, panel included, so folding the panel never moves the width it is judged by. At the
// shipped window the surface is about 920px wide.
export const PANEL_FOLD_PX = 1000;

// The person's own fold: null = follow the surface's width, true/false = they said so and a resize must not undo it.
// Persisted across launches; the width's fold never is. The cast is railstore.ts's (jotai otherwise types it as a
// promise).
export const panelFoldedAtom = atomWithStorage<boolean | null>("cockpit.files.panel.folded", null, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<boolean | null>;

// An explicit choice wins, else the width decides.
export function resolvePanelFolded(explicit: boolean | null, surfaceWidth: number): boolean {
    if (explicit != null) {
        return explicit;
    }
    if (surfaceWidth <= 0) {
        return false; // not measured yet; opening first avoids a panel that flashes and vanishes
    }
    return surfaceWidth < PANEL_FOLD_PX;
}

// Which tab the panel shows. Not stored: the surface picks one per subject (panelTabToApply) and the person's later
// choice stands until the subject changes.
export const panelTabAtom = atom<PanelTab>("log") as PrimitiveAtom<PanelTab>;

// The subject key panelTabToApply last picked a tab for. Module scope, so a return from another surface does not
// re-pick over the tab the person chose; whoever sends them here with a purpose of its own (openDiff) clears it.
export const panelAppliedKeyAtom = atom("") as PrimitiveAtom<string>;

export const PANEL_WIDTH_DEFAULT = 340;
export const PANEL_WIDTH_MIN = 280;
export const PANEL_WIDTH_MAX = 560;

export const panelWidthAtom = atomWithStorage("cockpit.files.panel.width", PANEL_WIDTH_DEFAULT, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<number>;

export function clampPanelWidth(w: number): number {
    if (!Number.isFinite(w)) {
        return PANEL_WIDTH_DEFAULT;
    }
    return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, w));
}

export const LOG_SPLIT_DEFAULT = 0.55;
export const LOG_SPLIT_MIN = 0.25;
export const LOG_SPLIT_MAX = 0.8;

// The share of the Log tab's height the history gets; the selected commit has the rest.
export const logSplitAtom = atomWithStorage("cockpit.files.log.split", LOG_SPLIT_DEFAULT, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<number>;

export function clampLogSplit(f: number): number {
    if (!Number.isFinite(f)) {
        return LOG_SPLIT_DEFAULT;
    }
    return Math.min(LOG_SPLIT_MAX, Math.max(LOG_SPLIT_MIN, f));
}

// The tab a fresh subject opens on: Log where the story is committed work (an agent, a session, a run, a compare),
// Commit where a working tree has changes to write down, Log otherwise.
export function defaultPanelTab(
    originKind: DiffOrigin["kind"],
    rangeKind: DiffRange["kind"],
    dirtyCount: number
): PanelTab {
    if (originKind === "agent" || rangeKind === "session" || rangeKind === "run" || rangeKind === "compare") {
        return "log";
    }
    return dirtyCount > 0 ? "commit" : "log";
}

// The tab to set now, or null to leave the person's choice alone. Nothing is decided while the list for `key` is
// still loading, so a fresh pick of a dirty tree opens Commit instead of Log off a list that has not arrived; once a
// key is applied a reload of it (the change poll) never overrides the tab again, whatever its dirty count does.
export function panelTabToApply(
    appliedKey: string,
    key: string,
    loaded: boolean,
    originKind: DiffOrigin["kind"],
    rangeKind: DiffRange["kind"],
    dirtyCount: number
): PanelTab | null {
    if (!loaded || appliedKey === key) {
        return null;
    }
    return defaultPanelTab(originKind, rangeKind, dirtyCount);
}

// The two words the source button shows (the panel's dropdown trigger and the folded header's). A linked worktree shows
// its project, since its own folder name is already the branch; a detached HEAD reads "detached".
export function sourceTitle(scope: DiffScope | null, branch: string): { name: string; branch: string } {
    if (scope == null) {
        return { name: "Pick a source", branch: "" };
    }
    const origin = scope.repo.origin;
    const name = origin.kind === "worktree" ? origin.project : scope.repo.label;
    return { name, branch: branch === "HEAD" ? "detached" : branch };
}

// The Commit tab's badge: how many files the working tree has changed. Only a live read (ref "") lists the working
// tree alone; a read anchored at a session start or a run base lists committed work too, so it has no count to show.
export function commitTabCount(state: { ref: string; changes: { files: unknown[] } | null } | null): number | null {
    if (state == null || state.ref !== "" || state.changes == null) {
        return null;
    }
    return state.changes.files.length;
}
