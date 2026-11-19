// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The order of the surfaces, in a module with no imports of its own (the key type is erased) so the nav rail can read it
// without loading agents.tsx. agents.tsx re-exports both lists, which is where everything else imports them from: a value
// import of agents.tsx from navrail.tsx closes a loop (navrail → agents → … → settingsui → navrail) in which settingsui
// reads the rail's ITEMS before they exist.

import type { SurfaceKey } from "./agents";

// The rail's visual order (navrail.tsx: CORE_ITEMS, then TOOL_ITEMS): the surfaces used all day, then the tools. `[` and
// `]` and the start-surface options follow it, the order the person sees. Library sits fifth, after Usage, but its chord
// is the last one (SURFACE_ORDER), so Code and Diff keep Ctrl+5 and Ctrl+6.
export const RAIL_ORDER: SurfaceKey[] = ["cockpit", "jarvis", "agent", "usage", "library", "code", "files"];

// The chord order: Ctrl+1..7 are these surfaces in turn, and every one is chorded. It is the rail's order with Library
// moved to the end, so the digits of the surfaces that were already chorded did not change when Library arrived. The rail's
// Ctrl-held digit hint reads it too (navrail.tsx), so it shows the chord that works (7 on Library). Past conversations
// are not a surface of their own: they are Library's Conversations tab. "app" (a service pinned to the rail) is a surface
// with no chord, not remembered as the start surface and not a `wsh ui go:` target, so it stays out of both lists.
export const SURFACE_ORDER: SurfaceKey[] = ["cockpit", "jarvis", "agent", "usage", "code", "files", "library"];

/** Pure: the digit of the chord (Ctrl+1..7) that jumps to `key`, which the rail shows on its item while Ctrl is held; undefined
 *  for a surface with no chord (Setup, Settings, a pinned app). It is the surface's place in SURFACE_ORDER, not on the rail. */
export function surfaceChordDigit(key: SurfaceKey): number | undefined {
    const at = SURFACE_ORDER.indexOf(key);
    return at >= 0 ? at + 1 : undefined;
}
