// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Capturing a terminal selection as an idea: what the selection becomes (one trimmed line), when the "Add as idea" chip
// shows beside it, what the shortcut does, and where the chip sits. Pure; ideasstore.ts holds the state and the actions,
// termwrap.ts feeds it the terminal's selection, and ideacapturechip.tsx draws the chip.

// an idea is a line, not a paste: a longer selection is cut here
export const IDEA_MAX_CHARS = 500;

// cleanSelection is the idea a selection makes: its whitespace runs (line breaks too, since a TUI wraps its lines) become
// one space, the ends are trimmed, and it is cut to IDEA_MAX_CHARS without splitting a surrogate pair. Null when nothing
// but whitespace was selected.
export function cleanSelection(text: string | null | undefined): string | null {
    let out = (text ?? "").replace(/\s+/g, " ").trim();
    if (out === "") {
        return null;
    }
    if (out.length > IDEA_MAX_CHARS) {
        out = out.slice(0, IDEA_MAX_CHARS);
        const last = out.charCodeAt(out.length - 1);
        if (last >= 0xd800 && last <= 0xdbff) {
            out = out.slice(0, -1); // the first half of a pair whose second half was cut
        }
        out = out.trimEnd();
    }
    return out;
}

// chipVisible: the chip shows while a selection is held in a terminal that has an agent session to add it to, until a key
// is typed or the terminal scrolls (`typedSinceSelect`, set by either; a new selection clears it)
export function chipVisible(s: { hasSelection: boolean; hasSession: boolean; typedSinceSelect: boolean }): boolean {
    return s.hasSelection && s.hasSession && !s.typedSinceSelect;
}

// captureAction is what the shortcut (and the chip) does: add the selection, open the Ideas input when nothing is
// selected, or nothing where the terminal has no agent session. `selection` is cleanSelection's answer.
export function captureAction(s: {
    selection: string | null;
    sessionId: string | null;
}): "add" | "open-input" | "none" {
    if (s.sessionId == null) {
        return "none";
    }
    return s.selection != null ? "add" : "open-input";
}

// a request to open the Ideas input (the shortcut with nothing selected) is for the moment it is made: an Add an idea box
// that mounts later, because the section was closed or the rail was folded, takes it for this long, and no longer, so a
// request nobody answered never pulls focus into the box minutes afterwards
export const INPUT_REQUEST_TTL_MS = 3000;

export function inputRequestLive(
    request: { sessionId: string; at: number } | null | undefined,
    sessionId: string | null,
    now: number
): boolean {
    return (
        request != null &&
        sessionId != null &&
        request.sessionId === sessionId &&
        now - request.at <= INPUT_REQUEST_TTL_MS
    );
}

export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

// selectionAnchor puts the selection's end (xterm's getSelectionPosition().end: a column and a row of the whole buffer,
// scrollback included) on the screen: `viewportY` is the buffer row at the top of it. Null when that row is not on screen.
export function selectionAnchor(
    end: { x: number; y: number },
    viewportY: number,
    rows: number
): { col: number; row: number } | null {
    const row = end.y - viewportY;
    return row >= 0 && row < rows ? { col: end.x, row } : null;
}

const GAP = 4; // between the line and the chip, and the least left between the chip and the pane's edge

// chipPlacement is where the chip goes inside its pane (`host`, in viewport pixels like `screen`, xterm's cell grid): just
// under the line the selection ends on, at the column it ends, kept inside the pane; above that line when there is no room
// under it. Cells are the screen's size over the terminal's cols and rows, which the renderers all agree on.
export function chipPlacement(s: {
    anchor: { col: number; row: number };
    cols: number;
    rows: number;
    screen: Box;
    host: Box;
    chip: { width: number; height: number };
}): { left: number; top: number } {
    const cellW = s.screen.width / s.cols;
    const cellH = s.screen.height / s.rows;
    const originX = s.screen.left - s.host.left;
    const originY = s.screen.top - s.host.top;
    const wantLeft = originX + s.anchor.col * cellW;
    const left = Math.max(GAP, Math.min(wantLeft, s.host.width - s.chip.width - GAP));
    const below = originY + (s.anchor.row + 1) * cellH + GAP;
    const fitsBelow = below + s.chip.height <= s.host.height - GAP;
    const top = fitsBelow ? below : originY + s.anchor.row * cellH - GAP - s.chip.height;
    return { left, top: Math.max(GAP, top) };
}
