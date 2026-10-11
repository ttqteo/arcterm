// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// When CollapsibleRail animates its width: opening, collapsing, and a switch to a tab of another width (Overview to a
// wide tab) slide; a width that changes under the same key, a drag of the edge or the window clamping it, follows at
// once. A slide still costs the centre's terminal one PTY resize: termwrap.ts debounces its refit until the width stops.

export interface RailMode {
    open: boolean;
    forceCollapsed: boolean;
    widthKey?: string; // what the open width belongs to (the shown tab); absent, the width never slides
}

export function railSlides(prev: RailMode, next: RailMode): boolean {
    if (prev.open !== next.open || prev.forceCollapsed !== next.forceCollapsed) {
        return true;
    }
    return next.open && prev.widthKey !== next.widthKey;
}
