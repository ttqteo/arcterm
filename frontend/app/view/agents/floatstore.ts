// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Float mode's state and its Tauri window calls (the arithmetic is floatwindow.ts). Entering it keeps the window's
// frame to give back, turns the terminal fullscreen, lifts the minimum size and shrinks the window to the last
// float's place; leaving gives the frame back. The window is never left pinned on top outside float mode.

import { globalStore } from "@/app/store/jotaiStore";
import {
    availableMonitors,
    currentMonitor,
    getCurrentWindow,
    LogicalSize,
    PhysicalPosition,
    PhysicalSize,
    type Monitor,
    type Window,
} from "@tauri-apps/api/window";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";
import {
    FLOAT_MIN_SIZE,
    floatRect,
    MAIN_MIN_SIZE,
    parseRect,
    parseRestore,
    screenFor,
    type FloatRestore,
    type Screen,
    type WinRect,
} from "./floatwindow";
import { terminalFullscreenAtom } from "./railstore";

export const floatModeAtom = atom(false) as PrimitiveAtom<boolean>;
// always on top; off on every entry, by choice: a float you did not pin does not cover your other apps
export const floatPinnedAtom = atom(false) as PrimitiveAtom<boolean>;

// where the last float was, for the next one
const RECT_KEY = "arc.float.rect";
// The frame to give back. Session storage, so a reload mid-float (which loses the atoms) can still give it back,
// while a relaunch, which opens the window from tauri.conf.json anyway, starts clean.
const RESTORE_KEY = "arc.float.restore";

function readJson(storage: () => Storage, key: string): unknown {
    try {
        const raw = storage().getItem(key);
        return raw == null ? null : JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeJson(storage: () => Storage, key: string, value: unknown): void {
    try {
        if (value == null) {
            storage().removeItem(key);
        } else {
            storage().setItem(key, JSON.stringify(value));
        }
    } catch {
        // a float that forgets its place still floats
    }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

async function frameOf(win: Window): Promise<WinRect> {
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
    return { x: pos.x, y: pos.y, width: size.width, height: size.height };
}

function screenOf(m: Monitor): Screen {
    const { position, size } = m.workArea;
    return { area: { x: position.x, y: position.y, width: size.width, height: size.height }, scale: m.scaleFactor };
}

// macOS animates out of native fullscreen, and a resize sent during the animation is dropped
async function leaveNativeFullscreen(win: Window): Promise<void> {
    if (!(await win.isFullscreen())) {
        return;
    }
    await win.setFullscreen(false);
    for (let i = 0; i < 30 && (await win.isFullscreen()); i++) {
        await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
}

async function giveFrameBack(win: Window, restore: FloatRestore | null): Promise<void> {
    await win.setAlwaysOnTop(false);
    if (restore != null) {
        await win.setSize(new PhysicalSize(restore.rect.width, restore.rect.height));
        await win.setPosition(new PhysicalPosition(restore.rect.x, restore.rect.y));
    }
    // after the resize, so the window never grows to the minimum at the float's corner first
    await win.setMinSize(new LogicalSize(MAIN_MIN_SIZE.width, MAIN_MIN_SIZE.height));
    // the window opens maximized (tauri.conf.json), so that is the frame when there is none to give back
    if (restore == null || restore.maximized) {
        await win.maximize();
    }
}

let busy = false;

export async function enterFloat(model: AgentsViewModel): Promise<void> {
    if (busy || globalStore.get(floatModeAtom)) {
        return;
    }
    busy = true;
    try {
        const win = getCurrentWindow();
        await leaveNativeFullscreen(win);
        const maximized = await win.isMaximized();
        const restore: FloatRestore = {
            rect: await frameOf(win),
            maximized,
            terminalFullscreen: globalStore.get(terminalFullscreenAtom),
        };
        writeJson(session, RESTORE_KEY, restore);
        const last = parseRect(readJson(local, RECT_KEY));
        const [current, monitors] = await Promise.all([currentMonitor(), availableMonitors()]);
        if (current == null) {
            throw new Error("no monitor for the window");
        }
        const screen = screenFor(last, monitors.map(screenOf), screenOf(current));
        const rect = floatRect(last, screen.area, screen.scale);
        if (maximized) {
            await win.unmaximize();
        }
        await win.setMinSize(new LogicalSize(FLOAT_MIN_SIZE.width, FLOAT_MIN_SIZE.height));
        await win.setSize(new PhysicalSize(rect.width, rect.height));
        await win.setPosition(new PhysicalPosition(rect.x, rect.y));
        await win.setAlwaysOnTop(false);
        globalStore.set(model.surfaceAtom, "agent");
        globalStore.set(terminalFullscreenAtom, true);
        globalStore.set(floatPinnedAtom, false);
        globalStore.set(floatModeAtom, true);
    } catch (e) {
        console.error("entering float mode failed", e);
        // a half-shrunk window with the full layout is worse than no float
        await giveFrameBack(getCurrentWindow(), parseRestore(readJson(session, RESTORE_KEY))).catch(() => {});
        writeJson(session, RESTORE_KEY, null);
    } finally {
        busy = false;
    }
}

// restoreFullscreen: give the terminal back the fullscreen it had before; false when leaving fullscreen is what
// ended the float, which is a choice to keep
export async function exitFloat(restoreFullscreen: boolean): Promise<void> {
    if (busy || !globalStore.get(floatModeAtom)) {
        return;
    }
    busy = true;
    try {
        const win = getCurrentWindow();
        const restore = parseRestore(readJson(session, RESTORE_KEY));
        writeJson(local, RECT_KEY, await frameOf(win).catch(() => null));
        globalStore.set(floatPinnedAtom, false);
        globalStore.set(floatModeAtom, false);
        if (restoreFullscreen && restore != null) {
            globalStore.set(terminalFullscreenAtom, restore.terminalFullscreen);
        }
        await giveFrameBack(win, restore);
        writeJson(session, RESTORE_KEY, null);
    } catch (e) {
        console.error("leaving float mode failed", e);
    } finally {
        busy = false;
    }
}

export function toggleFloat(model: AgentsViewModel): Promise<void> {
    return globalStore.get(floatModeAtom) ? exitFloat(true) : enterFloat(model);
}

export async function setFloatPinned(pinned: boolean): Promise<void> {
    if (!globalStore.get(floatModeAtom)) {
        return;
    }
    try {
        await getCurrentWindow().setAlwaysOnTop(pinned);
        globalStore.set(floatPinnedAtom, pinned);
    } catch (e) {
        console.error("always on top failed", e);
    }
}

// Mounted once by the shell. A reload mid-float lost the atoms but not the shrunk, maybe pinned window: give the frame
// back. And the small window has room for the focused terminal alone, so leaving the Agent surface or the terminal's
// fullscreen (f, Esc, the header button) ends the float.
export function setupFloatMode(model: AgentsViewModel): () => void {
    const stranded = parseRestore(readJson(session, RESTORE_KEY));
    if (stranded != null && !globalStore.get(floatModeAtom)) {
        writeJson(session, RESTORE_KEY, null);
        void giveFrameBack(getCurrentWindow(), stranded).catch((e) => console.error("restoring the window failed", e));
    }
    const unsubSurface = globalStore.sub(model.surfaceAtom, () => {
        if (globalStore.get(floatModeAtom) && globalStore.get(model.surfaceAtom) !== "agent") {
            void exitFloat(true);
        }
    });
    const unsubFullscreen = globalStore.sub(terminalFullscreenAtom, () => {
        if (globalStore.get(floatModeAtom) && !globalStore.get(terminalFullscreenAtom)) {
            void exitFloat(false);
        }
    });
    return () => {
        unsubSurface();
        unsubFullscreen();
    };
}
