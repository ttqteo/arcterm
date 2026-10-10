// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Float mode's state and its Tauri window calls (the arithmetic is floatwindow.ts). Entering it keeps the window's
// frame to give back, turns the terminal fullscreen, lifts the minimum size and shrinks the window to the last
// float's place; leaving gives the frame back. The window is never left pinned on top outside float mode. Folding the
// float into Sprout (enterMini) shrinks the same window again, see-through, around Sprout.

import { globalStore } from "@/app/store/jotaiStore";
import { closePeek } from "@/app/view/jarvis/peekstore";
import { petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { isMacOS } from "@/util/platformutil";
import { listen } from "@tauri-apps/api/event";
import {
    availableMonitors,
    currentMonitor,
    getCurrentWindow,
    LogicalPosition,
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
    MINI_CHAT_SIZE,
    MINI_REST_SIZE,
    miniSides,
    miniSproutRect,
    miniWindowRect,
    parseMiniRestore,
    parseRect,
    parseRestore,
    screenFor,
    spaceScale,
    sproutFromWindow,
    toSpace,
    type FloatRestore,
    type MiniRestore,
    type MiniSides,
    type Screen,
    type WinRect,
} from "./floatwindow";
import { FLOAT_MINIMIZE_EVENT, redirectMinimize, setTrafficLightsHidden } from "./macwindow";
import { startClickThrough, stopClickThrough } from "./miniclickthrough";
import { terminalFullscreenAtom } from "./railstore";
import { serialQueue } from "./serialqueue";

export const floatModeAtom = atom(false) as PrimitiveAtom<boolean>;
// always on top; off on every entry, by choice: a float you did not pin does not cover your other apps
export const floatPinnedAtom = atom(false) as PrimitiveAtom<boolean>;

// where the last float was, for the next one
const RECT_KEY = "arc.float.rect";
// The frame to give back. Session storage, so a reload mid-float (which loses the atoms) can still give it back,
// while a relaunch, which opens the window from tauri.conf.json anyway, starts clean.
const RESTORE_KEY = "arc.float.restore";

// Float folded into Sprout (docs/superpowers/specs/2026-10-10-float-mini-sprout-design.md): the same window, shrunk
// to a see-through box around Sprout, on top of every app. The shell stays mounted under display:none, so the terminal
// never refits; the window gets its float frame back before the shell shows again.
export const floatMiniAtom = atom(false) as PrimitiveAtom<boolean>;
// which way from Sprout the chip, the bubble and the chat open (floatwindow.ts miniSides)
export const miniSidesAtom = atom<MiniSides>({ h: "left", v: "up" }) as PrimitiveAtom<MiniSides>;
// true while the window changes size around Sprout, so a half-applied size never shows
export const miniResizingAtom = atom(false) as PrimitiveAtom<boolean>;

// where Sprout was last dropped, for the next fold; local, like the float's own place. v2: kept in points on macOS
// (floatwindow.ts toSpace), so a first build's physical rect is not read as points
const MINI_KEY = "arc.float.mini.v2";
// the float frame and pin to give back; session, so a reload mid-fold can still give them back
const MINI_RESTORE_KEY = "arc.float.miniRestore";

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
    // a reload mid-fold left the window see-through, frameless and deaf to the cursor; a float left the yellow button
    // pointed at Sprout
    await win.setIgnoreCursorEvents(false).catch(() => {});
    await win.setShadow(true).catch(() => {});
    await setTrafficLightsHidden(false).catch(() => {});
    await redirectMinimize(false).catch(() => {});
    writeJson(session, MINI_RESTORE_KEY, null);
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
        // the yellow button folds the float into Sprout rather than sending it to the Dock (macOS only)
        await redirectMinimize(true).catch((e) => console.error("redirecting the minimize button failed", e));
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
    // folded, or folding: give the float window back first (queued behind a fold in flight), then leave float as from
    // the float; a fold that could not be undone stays, rather than giving the full frame to a hidden shell
    await exitMini();
    if (globalStore.get(floatMiniAtom) || busy || !globalStore.get(floatModeAtom)) {
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

// Sprout's box while folded, in the folded float's space (floatwindow.ts toSpace: points on macOS, physical pixels on
// Windows)
let sprout: WinRect | null = null;
// Every window call of the fold goes through this, one at a time: a restore and the chat's resize, or a fold and a leave,
// interleaving left the window at the wrong size and the terminal refit to it.
const miniOps = serialQueue();
const MAC = isMacOS();

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function spaceFrame(win: Window): Promise<WinRect> {
    const [frame, scale] = await Promise.all([frameOf(win), win.scaleFactor()]);
    return toSpace(frame, scale, MAC);
}

function spaceScreen(m: Monitor): Screen {
    const { position, size } = m.workArea;
    const area = { x: position.x, y: position.y, width: size.width, height: size.height };
    return { area: toSpace(area, m.scaleFactor, MAC), scale: spaceScale(m.scaleFactor, MAC) };
}

// macOS takes points back as logical, which every monitor shares; tao would read physical with the window's current
// scale, which is the wrong one once the window is on another monitor. The position first, so the size is read on the
// monitor the window lands on.
async function setSpaceFrame(win: Window, rect: WinRect): Promise<void> {
    if (MAC) {
        await win.setPosition(new LogicalPosition(rect.x, rect.y));
        await win.setSize(new LogicalSize(rect.width, rect.height));
    } else {
        await win.setSize(new PhysicalSize(rect.width, rect.height));
        await win.setPosition(new PhysicalPosition(rect.x, rect.y));
    }
}

// the screen a rect is on, or the window's own when it is on none (an unplugged monitor)
async function screenOfRect(rect: WinRect | null): Promise<Screen> {
    const [current, monitors] = await Promise.all([currentMonitor(), availableMonitors()]);
    if (current == null) {
        throw new Error("no monitor for the window");
    }
    return screenFor(rect, monitors.map(spaceScreen), spaceScreen(current));
}

// Size the folded window around Sprout: the resting box, or room for the chat. Inside the queue.
async function placeMini(win: Window, chat: boolean): Promise<void> {
    if (sprout == null) {
        return;
    }
    globalStore.set(miniResizingAtom, true);
    try {
        const screen = await screenOfRect(sprout);
        const sides = globalStore.get(miniSidesAtom);
        const rect = miniWindowRect(sprout, chat ? MINI_CHAT_SIZE : MINI_REST_SIZE, sides, screen.area, screen.scale);
        await setSpaceFrame(win, rect);
        await nextFrame();
    } finally {
        globalStore.set(miniResizingAtom, false);
    }
}

// Where the window has Sprout now: a drag moves the window, and the last settle may not have run yet.
async function sproutNow(win: Window): Promise<WinRect> {
    const [frame, scale] = await Promise.all([spaceFrame(win), win.scaleFactor()]);
    return sproutFromWindow(frame, globalStore.get(miniSidesAtom), spaceScale(scale, MAC));
}

export function resizeMini(chat: boolean): Promise<void> {
    return miniOps(async () => {
        if (!globalStore.get(floatMiniAtom)) {
            return;
        }
        const win = getCurrentWindow();
        sprout = await sproutNow(win);
        await placeMini(win, chat);
    });
}

export function enterMini(): Promise<void> {
    return miniOps(async () => {
        if (busy || !globalStore.get(floatModeAtom) || globalStore.get(floatMiniAtom)) {
            return;
        }
        const win = getCurrentWindow();
        try {
            const restore: MiniRestore = { rect: await spaceFrame(win), pinned: globalStore.get(floatPinnedAtom) };
            writeJson(session, MINI_RESTORE_KEY, restore);
            closePeek();
            // hide the shell before the window shrinks: a terminal that saw the small window would refit its PTY to it
            globalStore.set(floatMiniAtom, true);
            document.documentElement.dataset.floatMini = "";
            await nextFrame();
            await nextFrame();
            const last = parseRect(readJson(local, MINI_KEY));
            const screen = await screenOfRect(last);
            sprout = miniSproutRect(last, screen.area, screen.scale);
            globalStore.set(miniSidesAtom, miniSides(sprout, screen.area));
            await setTrafficLightsHidden(true);
            await win.setShadow(false);
            await win.setMinSize(null);
            await placeMini(win, false);
            await win.setAlwaysOnTop(true);
            startClickThrough();
        } catch (e) {
            console.error("folding the float into Sprout failed", e);
            await leaveMini(win).catch(() => {});
        }
    });
}

// Give the float window back: its frame and pin first, then the shell, so the terminal fits to the size it had.
async function leaveMini(win: Window): Promise<void> {
    sprout = null;
    stopClickThrough();
    const restore = parseMiniRestore(readJson(session, MINI_RESTORE_KEY));
    await win.setIgnoreCursorEvents(false);
    await win.setShadow(true);
    await setTrafficLightsHidden(false);
    if (restore != null) {
        await setSpaceFrame(win, restore.rect);
    }
    await win.setMinSize(new LogicalSize(FLOAT_MIN_SIZE.width, FLOAT_MIN_SIZE.height));
    await win.setAlwaysOnTop(restore?.pinned ?? false);
    await nextFrame();
    delete document.documentElement.dataset.floatMini;
    globalStore.set(floatMiniAtom, false);
    writeJson(session, MINI_RESTORE_KEY, null);
}

export function exitMini(): Promise<void> {
    return miniOps(async () => {
        if (!globalStore.get(floatMiniAtom)) {
            return;
        }
        try {
            // the chat's closing asks for a resize, which queues behind this and finds the fold gone
            closePeek();
            await leaveMini(getCurrentWindow());
        } catch (e) {
            console.error("giving the float window back failed", e);
        }
    });
}

// A drag moves the window: remember where it put Sprout, and turn the window around when Sprout crossed the middle.
function settleMove(): Promise<void> {
    return miniOps(async () => {
        if (!globalStore.get(floatMiniAtom) || sprout == null) {
            return;
        }
        const win = getCurrentWindow();
        const moved = await sproutNow(win);
        const screen = await screenOfRect(moved);
        sprout = miniSproutRect(moved, screen.area, screen.scale);
        writeJson(local, MINI_KEY, sprout);
        const sides = globalStore.get(miniSidesAtom);
        const next = miniSides(sprout, screen.area);
        if (next.h !== sides.h || next.v !== sides.v) {
            globalStore.set(miniSidesAtom, next);
            await placeMini(win, globalStore.get(petPeekOpenAtom));
        }
    });
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
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    const unlistenMoved = getCurrentWindow().onMoved(() => {
        if (!globalStore.get(floatMiniAtom)) {
            return;
        }
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => void settleMove().catch((e) => console.error("placing Sprout failed", e)), 300);
    });
    // the yellow button, redirected while floating (enterFloat)
    const unlistenMinimize = listen(FLOAT_MINIMIZE_EVENT, () => void enterMini());
    return () => {
        unsubSurface();
        unsubFullscreen();
        clearTimeout(moveTimer);
        void unlistenMoved.then((f) => f());
        void unlistenMinimize.then((f) => f());
    };
}
