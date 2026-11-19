// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The bug box's state and its moves (docs/superpowers/specs/2026-11-19-bug-report-design.md, "The box"): open it
// (capture the window first, so the box is never in the picture), frame a region of the picture (the box steps aside
// while the person drags over it), send it (one wshrpc save, the region drawn on the picture), close it (keep nothing).
// The pure parts, when Send is allowed and what the save carries, are in bugreportboxmodel.ts.

import { anyDialogOpen } from "@/app/modals/modalstack";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { arrayToBase64 } from "@/util/util";
import { invoke } from "@tauri-apps/api/core";
import { atom, type PrimitiveAtom } from "jotai";
import {
    agentInFocus,
    buildSavePayload,
    canSend,
    frameWidth,
    sentTitle,
    type BugReportBoxState,
    type BugReportOpen,
    type Region,
    type Size,
} from "./bugreportboxmodel";
import { pushToast } from "./notificationstore";
import { versionInfoAtom } from "./versioninfo";

declare global {
    interface Window {
        // DEV: a CDP scenario stands in for `capture_webview` (a rejection gives the no-picture box)
        __bugReportCaptureFake?: () => Promise<Blob>;
        // DEV: and for the save (a rejection gives the box's error line)
        __bugReportSaveFake?: (data: CommandBugReportSaveData) => Promise<BugReportStatus>;
    }
}

export const bugReportAtom = atom<BugReportBoxState>({ kind: "closed" }) as PrimitiveAtom<BugReportBoxState>;

// a dialog's exit animation is MOTION.durExit (0.28 s), plus a frame or two for React to unmount it
const DIALOG_EXIT_MS = 340;

// where focus was at the press: the box hands it back on close (bugreportbox.tsx). Not atom state: nothing draws it.
let focusBefore: HTMLElement | null = null;

export function focusBeforeBugReport(): HTMLElement | null {
    return focusBefore;
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// The window as it is now: the Tauri host's capture (Windows and macOS), or null where there is none or it fails, and
// the report is then kept without a picture.
async function captureWindow(): Promise<Blob | null> {
    try {
        const fake = import.meta.env.DEV && typeof window !== "undefined" ? window.__bugReportCaptureFake : undefined;
        if (fake != null) {
            return await fake();
        }
        return new Blob([await invoke<ArrayBuffer>("capture_webview")], { type: "image/png" });
    } catch {
        return null;
    }
}

// the picture's own size, for the region's scale and the thumb's crop; null when it does not decode
async function imageSize(blob: Blob | null): Promise<Size | null> {
    if (blob == null) {
        return null;
    }
    try {
        const bitmap = await createImageBitmap(blob);
        const size = { w: bitmap.width, h: bitmap.height };
        bitmap.close();
        return size.w > 0 && size.h > 0 ? size : null;
    } catch {
        return null;
    }
}

// the reports waiting for Jarvis; a server that cannot say reads as none, since the box's count is a courtesy
async function waitingCount(): Promise<number> {
    try {
        return (await RpcApi.BugReportStatusCommand(TabRpcClient)).waiting ?? 0;
    } catch {
        return 0;
    }
}

/** Opens the box. A no-op unless it is closed: a second press while it is open or capturing takes no second picture. */
export async function openBugReport(model: AgentsViewModel): Promise<void> {
    if (globalStore.get(bugReportAtom).kind !== "closed") {
        return;
    }
    // the press: the box is not drawn yet (`capturing`), so it is not in the picture; the surface, the agent in focus and
    // the time are what the press found
    globalStore.set(bugReportAtom, { kind: "capturing" });
    focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ts = Date.now();
    const surface = globalStore.get(model.surfaceAtom);
    const items = [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
    const agent = agentInFocus(items, globalStore.get(model.focusIdAtom));
    // The palette's "Báo lỗi arcterm" row runs before the palette closes, and the palette then leaves over its exit
    // animation: capture once it is gone, or the picture holds a half-faded palette. (The chord never runs under a
    // dialog: its binding yields to one.)
    if (anyDialogOpen()) {
        await new Promise<void>((resolve) => setTimeout(resolve, DIALOG_EXIT_MS));
    }
    const [capture, waiting] = await Promise.all([captureWindow(), waitingCount()]);
    const captureSize = await imageSize(capture);
    if (globalStore.get(bugReportAtom).kind !== "capturing") {
        return;
    }
    globalStore.set(bugReportAtom, {
        kind: "open",
        capture,
        captureSize,
        region: null,
        selecting: false,
        surface,
        agent,
        ts,
        waiting,
        text: "",
        sending: false,
    });
}

export function setBugReportText(text: string): void {
    const s = globalStore.get(bugReportAtom);
    if (s.kind === "open") {
        globalStore.set(bugReportAtom, { ...s, text });
    }
}

function setOpen(change: (box: BugReportOpen) => BugReportOpen): void {
    const s = globalStore.get(bugReportAtom);
    if (s.kind === "open") {
        globalStore.set(bugReportAtom, change(s));
    }
}

/** Khoanh vùng and Khoanh lại: the box steps aside for the picture, over the whole window, to drag a region on. Only
 *  with a picture that decoded. */
export function startBugRegion(): void {
    setOpen((box) => (box.captureSize != null && !box.sending ? { ...box, selecting: true } : box));
}

/** The drag is over: Enter keeps `region` (the picture's pixels), Esc passes null and keeps what was framed before. */
export function finishBugRegion(region: Region | null): void {
    setOpen((box) => ({ ...box, selecting: false, region: region ?? box.region }));
}

/** Bỏ vùng: the report goes with the picture as it was taken. */
export function clearBugRegion(): void {
    setOpen((box) => ({ ...box, region: null }));
}

// the picture with the region drawn on in the accent, as the saved screen.png; the plain picture when drawing fails
async function framedPicture(box: BugReportOpen): Promise<Blob | null> {
    if (box.capture == null || box.region == null || box.captureSize == null) {
        return box.capture;
    }
    try {
        const bitmap = await createImageBitmap(box.capture);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        if (ctx == null) {
            bitmap.close();
            return box.capture;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const width = frameWidth(box.captureSize, { w: window.innerWidth, h: window.innerHeight });
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
        if (accent === "") {
            // no theme to read the colour from: the region still goes in report.json
            return box.capture;
        }
        ctx.strokeStyle = accent;
        ctx.lineWidth = width;
        const { x, y, w, h } = box.region;
        // the line sits outside the region, so the framed pixels stay as they were
        ctx.strokeRect(x - width / 2, y - width / 2, w + width, h + width);
        return await canvas.convertToBlob({ type: "image/png" });
    } catch {
        return box.capture;
    }
}

/** Esc and Huỷ: the box goes and keeps nothing. */
export function closeBugReport(): void {
    if (globalStore.get(bugReportAtom).kind !== "closed") {
        globalStore.set(bugReportAtom, { kind: "closed" });
    }
}

async function save(box: BugReportOpen): Promise<BugReportStatus> {
    const picture = await framedPicture(box);
    const screen64 = picture == null ? undefined : arrayToBase64(new Uint8Array(await picture.arrayBuffer()));
    const info = globalStore.get(versionInfoAtom);
    const payload = buildSavePayload(box, screen64, info.app, info.commit);
    const fake = import.meta.env.DEV && typeof window !== "undefined" ? window.__bugReportSaveFake : undefined;
    return fake != null ? await fake(payload) : await RpcApi.BugReportSaveCommand(TabRpcClient, payload);
}

/** Gửi: saves the report, then the box closes and a toast says how many wait for Jarvis. A failed save keeps the box
 *  open with the error, text and picture as they were. */
export async function sendBugReport(): Promise<void> {
    const box = globalStore.get(bugReportAtom);
    if (box.kind !== "open" || !canSend(box.text, box.sending)) {
        return;
    }
    globalStore.set(bugReportAtom, { ...box, sending: true, error: undefined });
    // the same box still on screen, or null: Esc while the save ran closed it, and a later press may have opened another
    const here = (): BugReportOpen | null => {
        const now = globalStore.get(bugReportAtom);
        return now.kind === "open" && now.ts === box.ts ? now : null;
    };
    try {
        const status = await save(box);
        if (here() != null) {
            closeBugReport();
        }
        pushToast({ title: sentTitle(status.waiting ?? 0), message: "", level: "info", check: true });
    } catch (e) {
        const now = here();
        if (now != null) {
            globalStore.set(bugReportAtom, { ...now, sending: false, error: errText(e) });
        } else {
            // the box is gone, so the line under its text box would never be read
            pushToast({ title: "Không gửi được báo lỗi", message: errText(e), level: "error" });
        }
    }
}
