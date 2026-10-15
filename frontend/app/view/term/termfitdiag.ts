// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A run worker starts with no terminal, at the PTY's 24x80 default, and its pane mounts hidden. When the pane shows,
// its xterm should fit the box and send that size to the PTY. On a Mac short of RAM that fit sometimes never comes,
// and the agent draws a 24x80 frame inside a larger pane for the rest of its session; nothing in the cockpit, nor a
// worker relaunched in a browser, reproduces it. termwrap.ts writes each step of a pane's fit to waveapp.log as a
// `[termfit]` line and fits again a visible pane whose xterm is not the size its box fits.

export type TermDims = { cols: number; rows: number };

// whether a visible pane's xterm is not the size its box fits; `proposed` is undefined (or NaN) while the renderer
// cannot size a cell, when no fit could do better either
export function isStaleFit(current: TermDims, proposed: TermDims | undefined): boolean {
    if (proposed == null || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) {
        return false;
    }
    return proposed.cols !== current.cols || proposed.rows !== current.rows;
}

// one waveapp.log line: the event, the block's short id, then each field that has a value
export function formatFitDiag(
    event: string,
    blockId: string,
    fields: Record<string, string | number | boolean | null | undefined>
): string {
    const parts = [`[termfit] ${event} ${blockId.slice(0, 8)}`];
    for (const [key, value] of Object.entries(fields)) {
        if (value != null) {
            parts.push(`${key}=${value}`);
        }
    }
    return parts.join(" ");
}
