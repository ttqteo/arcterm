// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's tab switcher, the app's own Cmd+Tab: Ctrl+Tab (Option+Tab too on a Mac) opens it over the
// terminal with the tab you were on before this one picked, Tab and Shift+Tab move the pick while the modifier stays
// down, and letting the modifier go opens the pick. Escape, any other key or the window losing focus keeps the tab in
// view. Recent first, so a quick Ctrl+Tab flips between the last two tabs, and the switcher is drawn only once the
// modifier has been held for SWITCHER_DELAY_MS, so that flip never flashes it. Nothing opens, and so nothing is marked
// read, until the modifier goes up. Pure: no React, no Wave runtime imports.

export type SwitcherMod = "ctrl" | "alt";

export interface SwitcherState {
    ids: string[]; // the tabs, recent first
    sel: number; // the pick, an index into ids
    mod: SwitcherMod; // the modifier whose release opens the pick
    shown: boolean; // drawn: once the delay runs out or Tab is pressed again
}

export const SWITCHER_DELAY_MS = 200;

// enough history for any roster; past it the oldest fall back to the ledge's order
export const RECENT_MAX = 32;

/** Newest first, each id once, capped at max. */
export function pushRecent(recent: readonly string[], id: string, max = RECENT_MAX): string[] {
    return [id, ...recent.filter((x) => x !== id)].slice(0, max);
}

/** The switcher's order: the tab in view, then the others by when they were last in view, then the ones never in view
 *  in the ledge's order. An id that is no longer a tab drops out. */
export function recentOrder(tabs: readonly string[], recent: readonly string[], focusId: string | null): string[] {
    const isTab = new Set(tabs);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of [...(focusId != null ? [focusId] : []), ...recent, ...tabs]) {
        if (isTab.has(id) && !seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    }
    return out;
}

function wrap(i: number, n: number): number {
    return ((i % n) + n) % n;
}

/** Ctrl+Tab (delta 1) or Ctrl+Shift+Tab (-1) with the switcher closed: the pick starts beside the tab in view, or at an
 *  end when the one in view is not a tab; null with nothing to switch to. */
export function openSwitcher(
    ids: string[],
    focusId: string | null,
    delta: 1 | -1,
    mod: SwitcherMod
): SwitcherState | null {
    if (ids.length < 2) {
        return null;
    }
    const at = focusId == null ? -1 : ids.indexOf(focusId);
    const sel = at < 0 ? (delta === 1 ? 0 : ids.length - 1) : wrap(at + delta, ids.length);
    return { ids, sel, mod, shown: false };
}

/** Tab or Shift+Tab with the switcher open: the pick moves, wrapping at the ends, and the switcher is drawn. */
export function stepSwitcher(s: SwitcherState, delta: 1 | -1): SwitcherState {
    return { ...s, sel: wrap(s.sel + delta, s.ids.length), shown: true };
}

export function pickOf(s: SwitcherState): string {
    return s.ids[s.sel];
}

/** Whether a key going up is the switcher's modifier, which opens the pick. */
export function releasesSwitcher(s: SwitcherState, key: string): boolean {
    return key === (s.mod === "ctrl" ? "Control" : "Alt");
}

/** Whether a key pressed with the switcher open leaves it open: the modifiers, Tab (its bindings move the pick) and
 *  Escape (its binding closes it, consuming the key so the terminal never gets it). Any other key closes it. */
export function keepsSwitcher(key: string): boolean {
    return key === "Tab" || key === "Escape" || key === "Control" || key === "Alt" || key === "Shift" || key === "Meta";
}
