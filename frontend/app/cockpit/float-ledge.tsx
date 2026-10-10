// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The floor Sprout walks in Float (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2): 52px under the
// terminal, tall enough to hold the whole 48px sprite, so Sprout never stands on the terminal's prompt
// (petledge.ts LedgeBox.holds). A press on it drags the window, like the float bar.
export function FloatLedge() {
    return (
        <div
            data-pet-ledge
            data-pet-ledge-holds
            data-tauri-drag-region
            className="h-[52px] shrink-0 border-t border-border bg-surface"
        />
    );
}
