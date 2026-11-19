// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The bug box's pure part (docs/superpowers/specs/2026-11-19-bug-report-design.md, "The box"): when Send is allowed,
// the count's wording, the save payload built from the open box, which agent was in focus, and where the box sits.
// bugreportstore.ts holds the state and the calls; bugreportbox.tsx draws it.

export type BugReportAgentRef = { id: string; name: string };

/** A rectangle: the region the person framed, in the window's CSS px while dragging and in the picture's px once set. */
export type Region = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

/** The box while it is drawn: what was seen at the press, what the person has typed, and what the last save said. */
export type BugReportOpen = {
    kind: "open";
    /** the window at the press; null when the capture failed (the report is then kept without a picture) */
    capture: Blob | null;
    /** the picture's size in its own pixels; null with no picture or one that did not decode */
    captureSize: Size | null;
    /** the part of the picture the person framed as where it went wrong, in the picture's pixels */
    region: Region | null;
    /** the box is set aside while the person drags a region over the picture */
    selecting: boolean;
    surface: string;
    agent: BugReportAgentRef | null;
    /** the press time, unix ms: the report's `ts`, not the time Send was pressed */
    ts: number;
    /** reports waiting for Jarvis when the box opened */
    waiting: number;
    text: string;
    /** the last save's failure, drawn under the text box */
    error?: string;
    sending: boolean;
};

/** `capturing` is the beat between the press and the box: the window is being captured, nothing is drawn (so the box is
 *  never in the picture). */
export type BugReportBoxState = { kind: "closed" } | { kind: "capturing" } | BugReportOpen;

export const BOX_WIDTH = 380;
const EDGE_MARGIN = 8;
/** with no bug button on screen (the Float ledge has none), the box hangs this far from the window's right edge */
const FALLBACK_RIGHT = 88;

/** Send needs a non-space character, and is off while a save is in flight (so a second Ctrl+Enter sends nothing). */
export function canSend(text: string, sending: boolean): boolean {
    return !sending && text.trim() !== "";
}

/** "3 đang chờ Jarvis" at the box's right; nothing at 0. */
export function waitingLabel(waiting: number): string {
    return Number.isInteger(waiting) && waiting > 0 ? `${waiting} đang chờ Jarvis` : "";
}

/** The toast after a save. `waiting` is the count the save reported, which includes the report just kept. */
export function sentTitle(waiting: number): string {
    const label = waitingLabel(waiting);
    return label === "" ? "Đã gửi báo lỗi" : `Đã gửi báo lỗi · ${label}`;
}

type SavePayload = {
    text: string;
    ts: number;
    version: string;
    commit?: string;
    surface?: string;
    agent?: BugReportAgentRef;
    screen64?: string;
    region?: Region;
};

/** What `BugReportSaveCommand` takes. A field with nothing to say is left out, not sent empty. */
export function buildSavePayload(
    box: BugReportOpen,
    screen64: string | undefined,
    version: string,
    commit: string
): SavePayload {
    const payload: SavePayload = { text: box.text.trim(), ts: box.ts, version };
    if (commit !== "") {
        payload.commit = commit;
    }
    if (box.surface !== "") {
        payload.surface = box.surface;
    }
    if (box.agent != null) {
        payload.agent = { id: box.agent.id, name: box.agent.name };
    }
    if (screen64 != null && screen64 !== "") {
        payload.screen64 = screen64;
        // a region is a place on the picture: without one it says nothing
        if (box.region != null) {
            payload.region = { ...box.region };
        }
    }
    return payload;
}

/** The agent (or terminal: `focusIdAtom` holds both) the press found in focus, null with none or one that has gone. */
export function agentInFocus(
    items: readonly { id: string; name: string }[],
    focusId: string | undefined
): BugReportAgentRef | null {
    if (focusId == null) {
        return null;
    }
    const hit = items.find((a) => a.id === focusId);
    return hit == null ? null : { id: hit.id, name: hit.name };
}

/** The box's distance from the window's right edge: its right edge lines up with the button's, and the box stays whole
 *  on a narrow window. `buttonRight` is the button's right edge in window px, null when no button is on screen. */
export function anchorRight(buttonRight: number | null, innerWidth: number): number {
    if (buttonRight == null) {
        return FALLBACK_RIGHT;
    }
    const widest = Math.max(EDGE_MARGIN, innerWidth - BOX_WIDTH - EDGE_MARGIN);
    return Math.min(widest, Math.max(EDGE_MARGIN, innerWidth - buttonRight));
}

/** A drag shorter than this either way, in CSS px, is a click and frames nothing. */
export const MIN_REGION_PX = 8;

/** The rectangle a drag from `a` to `b` spans, whichever way it went, cut to `bounds`; null when it is under
 *  MIN_REGION_PX either way once cut. */
export function dragRect(a: { x: number; y: number }, b: { x: number; y: number }, bounds: Size): Region | null {
    const clampX = (v: number) => Math.min(bounds.w, Math.max(0, v));
    const clampY = (v: number) => Math.min(bounds.h, Math.max(0, v));
    const x1 = clampX(Math.min(a.x, b.x));
    const x2 = clampX(Math.max(a.x, b.x));
    const y1 = clampY(Math.min(a.y, b.y));
    const y2 = clampY(Math.max(a.y, b.y));
    if (x2 - x1 < MIN_REGION_PX || y2 - y1 < MIN_REGION_PX) {
        return null;
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** A region drawn over the picture shown at the window's size (`view`) in the picture's own pixels (`image`): the
 *  capture is the webview at its device pixel ratio, so it scales by image / view, rounded and kept inside the picture. */
export function toImageRegion(r: Region, view: Size, image: Size): Region {
    const sx = image.w / view.w;
    const sy = image.h / view.h;
    const x = Math.min(image.w - 1, Math.max(0, Math.round(r.x * sx)));
    const y = Math.min(image.h - 1, Math.max(0, Math.round(r.y * sy)));
    return {
        x,
        y,
        w: Math.max(1, Math.min(image.w - x, Math.round(r.w * sx))),
        h: Math.max(1, Math.min(image.h - y, Math.round(r.h * sy))),
    };
}

/** The frame drawn on the saved picture, in its pixels: 3 CSS px at the picture's scale, never under 2. */
export function frameWidth(image: Size, view: Size): number {
    return Math.max(2, Math.round((3 * image.w) / view.w));
}

/** How the thumb shows a region: the picture scaled so the region fills the thumb, centred on it. Pixel values for the
 *  picture's width, height and offset inside the thumb. */
export function thumbCrop(
    region: Region,
    image: Size,
    thumb: Size
): { width: number; height: number; left: number; top: number } {
    const s = Math.max(thumb.w / region.w, thumb.h / region.h);
    return {
        width: image.w * s,
        height: image.h * s,
        left: (thumb.w - region.w * s) / 2 - region.x * s,
        top: (thumb.h - region.h * s) / 2 - region.y * s,
    };
}
