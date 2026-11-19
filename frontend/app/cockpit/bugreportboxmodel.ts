// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The bug box's pure part (docs/superpowers/specs/2026-11-19-bug-report-design.md, "The box"): when Send is allowed,
// the count's wording, the save payload built from the open box, which agent was in focus, and where the box sits.
// bugreportstore.ts holds the state and the calls; bugreportbox.tsx draws it.

export type BugReportAgentRef = { id: string; name: string };

/** The box while it is drawn: what was seen at the press, what the person has typed, and what the last save said. */
export type BugReportOpen = {
    kind: "open";
    /** the window at the press; null when the capture failed (the report is then kept without a picture) */
    capture: Blob | null;
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
