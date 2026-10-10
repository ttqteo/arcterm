// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The window's sizes and their Tauri window calls: the arithmetic is floatwindow.ts, the rules windowsize.ts. Entering
// Float keeps the window's frame to give back, turns the terminal fullscreen, lifts the minimum size and shrinks the
// window to the last float's place; leaving gives the frame back. The window is never left pinned on top outside Float
// and the fold. Folding (foldToSprout), from Full or Float, scales the content into the walking Sprout and shrinks the
// same window, see-through, around the spot it stood on; a restore gives back the size and frame it was folded from.

import { MOTION } from "@/app/element/motiontokens";
import { getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { closePeek } from "@/app/view/jarvis/peekstore";
import { petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { isMacOS } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
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
import { animate } from "motion/react";
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
import { MINIMIZE_EVENT, redirectMinimize, setTrafficLightsHidden } from "./macwindow";
import { startClickThrough, stopClickThrough } from "./miniclickthrough";
import { terminalFullscreenAtom } from "./railstore";
import { serialQueue } from "./serialqueue";
import {
    FOLD_MS,
    FOLD_SCALE,
    foldCenter,
    foldSpot,
    minimizeAction,
    minimizeChoice,
    move,
    onSurfaceChange,
    sizeState,
    unfoldCenter,
    windowSize,
    type FoldOrigin,
    type Pt,
    type SizeState,
} from "./windowsize";

export const floatModeAtom = atom(false) as PrimitiveAtom<boolean>;
// always on top; on at every entry: a float is for watching an agent while you work in another app, so it starts above
// them, and its pin turns that off
export const floatPinnedAtom = atom(false) as PrimitiveAtom<boolean>;

// where the last float was, for the next one
const RECT_KEY = "arc.float.rect";
// The frame to give back. Session storage, so a reload mid-float (which loses the atoms) can still give it back,
// while a relaunch, which opens the window from tauri.conf.json anyway, starts clean.
const RESTORE_KEY = "arc.float.restore";

// The window folded into Sprout (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md): the same window, shrunk to
// a see-through box around Sprout, on top of every app. The shell stays mounted under display:none, so the terminal
// never refits; the window gets its frame back before the shell shows again.
export const floatMiniAtom = atom(false) as PrimitiveAtom<boolean>;
// the size the fold was made from, which a restore returns to; null while not folded
export const foldOriginAtom = atom<FoldOrigin | null>(null) as PrimitiveAtom<FoldOrigin | null>;
// which way from Sprout the list, the bubble and the chat open (floatwindow.ts miniSides)
export const miniSidesAtom = atom<MiniSides>({ h: "left", v: "up" }) as PrimitiveAtom<MiniSides>;
// true while the window changes size around Sprout, so a half-applied size never shows
export const miniResizingAtom = atom(false) as PrimitiveAtom<boolean>;

// the origin, frame and pin to give back; session, so a reload mid-fold can still give them back
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

function currentSize(): SizeState {
    return sizeState(globalStore.get(floatModeAtom), globalStore.get(floatMiniAtom), globalStore.get(foldOriginAtom));
}

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
    // a reload mid-fold left the window see-through, frameless and deaf to the cursor
    await win.setIgnoreCursorEvents(false).catch(() => {});
    await win.setShadow(true).catch(() => {});
    await setTrafficLightsHidden(false).catch(() => {});
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

// The window part of entering Float, from the Full frame, which it keeps to give back. Inside busy.
async function floatTheWindow(model: AgentsViewModel): Promise<void> {
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
        await win.setAlwaysOnTop(true);
        globalStore.set(model.surfaceAtom, "agent");
        globalStore.set(terminalFullscreenAtom, true);
        globalStore.set(floatPinnedAtom, true);
        globalStore.set(floatModeAtom, true);
    } catch (e) {
        console.error("entering float mode failed", e);
        // a half-shrunk window with the full layout is worse than no float
        await giveFrameBack(getCurrentWindow(), parseRestore(readJson(session, RESTORE_KEY))).catch(() => {});
        writeJson(session, RESTORE_KEY, null);
    }
}

export async function enterFloat(model: AgentsViewModel): Promise<void> {
    // already floating, or folded: folded, the shell is hidden and a float would shrink a window with nothing in it
    if (busy || move(currentSize(), "toggle-float").size !== "float") {
        return;
    }
    busy = true;
    try {
        await floatTheWindow(model);
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

// Sprout's box while folded, in the fold's space (floatwindow.ts toSpace: points on macOS, physical pixels on Windows)
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

// the window content's top-left, in the fold's space
async function spaceInner(win: Window): Promise<Pt> {
    const [pos, scale] = await Promise.all([win.innerPosition(), win.scaleFactor()]);
    const r = toSpace({ x: pos.x, y: pos.y, width: 0, height: 0 }, scale, MAC);
    return { x: r.x, y: r.y };
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

// The content a fold scales (cockpit-root.tsx): everything the window draws but the folded Sprout.
function content(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-window-content]");
}

function reducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The walking Sprout's top-left in CSS px (petview.tsx marks it data-pet-sprite), or null when none is drawn.
function walkingSprite(): Pt | null {
    const r = document.querySelector("[data-pet-sprite]")?.getBoundingClientRect();
    return r == null || r.width === 0 ? null : { x: r.left, y: r.top };
}

// Scale the content into Sprout's spot and fade it (a fold), or grow it out of the spot (a restore): opacity and scale
// on the motion tokens' easing. Reduced motion skips it.
async function scaleContent(at: Pt, to: "sprout" | "window"): Promise<void> {
    const el = content();
    if (el == null || reducedMotion()) {
        return;
    }
    el.style.transformOrigin = `${at.x}px ${at.y}px`;
    const keyframes =
        to === "sprout" ? { scale: [1, FOLD_SCALE], opacity: [1, 0] } : { scale: [FOLD_SCALE, 1], opacity: [0, 1] };
    await animate(el, keyframes, { duration: FOLD_MS / 1000, ease: MOTION.easeFluid }).finished;
}

// Before the shell shows again: drawn as small and clear as the fold left it, so its first frame is not full size.
function holdContentFolded(at: Pt): void {
    const el = content();
    if (el == null || reducedMotion()) {
        return;
    }
    el.style.transformOrigin = `${at.x}px ${at.y}px`;
    el.style.transform = `scale(${FOLD_SCALE})`;
    el.style.opacity = "0";
}

// No transform left behind: a transformed content is the containing block of every fixed element under it.
function clearContentMotion(): void {
    const el = content();
    if (el == null) {
        return;
    }
    el.style.removeProperty("transform");
    el.style.removeProperty("opacity");
    el.style.removeProperty("transform-origin");
}

/** Fold the window into Sprout, from Full or Float: the content scales into the walking Sprout, then the window shrinks,
 *  see-through, around the spot it stood on. */
export function foldToSprout(): Promise<void> {
    return miniOps(async () => {
        const now = currentSize();
        if (busy || now.size === "sprout") {
            return;
        }
        const origin = now.size;
        const win = getCurrentWindow();
        try {
            const fullscreen = await win.isFullscreen();
            await leaveNativeFullscreen(win);
            await nextFrame();
            const sprite = walkingSprite();
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const [frame, maximized, inner, scale] = await Promise.all([
                spaceFrame(win),
                win.isMaximized(),
                spaceInner(win),
                win.scaleFactor(),
            ]);
            const restore: MiniRestore = {
                origin,
                rect: frame,
                maximized,
                fullscreen,
                pinned: globalStore.get(floatPinnedAtom),
            };
            writeJson(session, MINI_RESTORE_KEY, restore);
            closePeek();
            globalStore.set(foldOriginAtom, origin);
            // the page goes see-through as the content leaves it; the content paints its own background
            document.documentElement.dataset.floatMini = "";
            await setTrafficLightsHidden(true);
            await win.setShadow(false);
            await scaleContent(foldCenter(sprite, viewport), "sprout");
            // hide the shell before the window shrinks: a terminal that saw the small window would refit its PTY to it
            globalStore.set(floatMiniAtom, true);
            await nextFrame();
            await nextFrame();
            clearContentMotion();
            if (maximized) {
                await win.unmaximize();
            }
            const spot = foldSpot(inner, spaceScale(scale, MAC), sprite, viewport);
            const screen = await screenOfRect(spot);
            sprout = miniSproutRect(spot, screen.area, screen.scale);
            globalStore.set(miniSidesAtom, miniSides(sprout, screen.area));
            await win.setMinSize(null);
            await placeMini(win, false);
            await win.setAlwaysOnTop(true);
            startClickThrough();
        } catch (e) {
            console.error("folding the window into Sprout failed", e);
            const back = await leaveMini(win).catch(() => ({ at: null, fullscreen: false }));
            await showContent(win, back).catch(() => {});
        }
    });
}

interface Unfold {
    // where the content grows out of, in the restored window's CSS px; null for no growth
    at: Pt | null;
    // the window was in macOS native fullscreen when it folded
    fullscreen: boolean;
}

// Give back the frame, size limits and pin of the size the fold was made from, the shell still hidden so the terminal
// fits to the size it had. Inside the queue.
async function leaveMini(win: Window): Promise<Unfold> {
    const was = sprout;
    sprout = null;
    stopClickThrough();
    // Sprout must not show in a corner of the grown window
    globalStore.set(miniResizingAtom, true);
    const restore = parseMiniRestore(readJson(session, MINI_RESTORE_KEY));
    const origin = restore?.origin ?? globalStore.get(foldOriginAtom) ?? "float";
    await win.setIgnoreCursorEvents(false);
    if (restore != null) {
        await setSpaceFrame(win, restore.rect);
    }
    const min = origin === "full" ? MAIN_MIN_SIZE : FLOAT_MIN_SIZE;
    await win.setMinSize(new LogicalSize(min.width, min.height));
    await win.setAlwaysOnTop(origin === "float" && (restore?.pinned ?? false));
    if (origin === "full" && restore?.maximized) {
        await win.maximize();
    }
    writeJson(session, MINI_RESTORE_KEY, null);
    await nextFrame();
    if (was == null || restore == null) {
        return { at: null, fullscreen: false };
    }
    // the restored frame is the content's box (a borderless window, or macOS's overlaid title bar), and it is read from
    // the restore rather than the window, whose own size may not have reached the page yet
    const scale = spaceScale(await win.scaleFactor(), MAC);
    const frame = restore.rect;
    const viewport = { width: frame.width / scale, height: frame.height / scale };
    return {
        at: unfoldCenter(was, { x: frame.x, y: frame.y }, scale, viewport),
        fullscreen: origin === "full" && restore.fullscreen,
    };
}

// Show the shell again, grown out of Sprout's spot when there is one, then give the window its own chrome back.
async function showContent(win: Window, unfold: Unfold): Promise<void> {
    if (unfold.at != null) {
        holdContentFolded(unfold.at);
    }
    globalStore.set(floatMiniAtom, false);
    globalStore.set(foldOriginAtom, null);
    globalStore.set(miniResizingAtom, false);
    await nextFrame();
    if (unfold.at != null) {
        await scaleContent(unfold.at, "window");
    }
    clearContentMotion();
    delete document.documentElement.dataset.floatMini;
    await win.setShadow(true);
    await setTrafficLightsHidden(false);
    if (unfold.fullscreen) {
        await win.setFullscreen(true);
    }
}

/** Restore from Sprout: back to the size it was folded from, at its frame, the content growing out of Sprout. With an
 *  agent (a click in the folded list), to Float on that agent, whichever size it was folded from. */
export function restoreFromSprout(model: AgentsViewModel, agentId?: string): Promise<void> {
    return miniOps(async () => {
        const now = currentSize();
        if (now.size !== "sprout") {
            return;
        }
        const win = getCurrentWindow();
        try {
            // the chat's closing asks for a resize, which queues behind this and finds the fold gone
            closePeek();
            if (agentId != null) {
                model.openTerminal(agentId);
            }
            const to = move(now, agentId != null ? "open-agent" : "restore").size;
            const unfold = await leaveMini(win);
            if (to === "float" && now.origin === "full") {
                // Full's frame is back with the shell still hidden: float from it, so the terminal only sees the float
                busy = true;
                try {
                    await floatTheWindow(model);
                } finally {
                    busy = false;
                }
                await showContent(win, { at: null, fullscreen: false });
                return;
            }
            await showContent(win, unfold);
        } catch (e) {
            console.error("restoring the window from Sprout failed", e);
        }
    });
}

/** Minimize, from the window's own button, the yellow button or ⌘M: fold into Sprout, or to the Dock or taskbar when
 *  window:minimize says so; folded, nothing. */
export function minimizeRequested(): void {
    const size = windowSize(globalStore.get(floatModeAtom), globalStore.get(floatMiniAtom));
    const action = minimizeAction(minimizeChoice(globalStore.get(getSettingsKeyAtom("window:minimize"))), size);
    if (action === "dock") {
        fireAndForget(() => getCurrentWindow().minimize());
    } else if (action === "fold") {
        void foldToSprout();
    }
}

// Out of the fold with no growth, for a leave that goes on to another size (exitFloat).
function exitMini(): Promise<void> {
    return miniOps(async () => {
        if (!globalStore.get(floatMiniAtom)) {
            return;
        }
        const win = getCurrentWindow();
        try {
            closePeek();
            const unfold = await leaveMini(win);
            await showContent(win, { at: null, fullscreen: unfold.fullscreen });
        } catch (e) {
            console.error("giving the window back failed", e);
        }
    });
}

// A drag moves the window: pull Sprout back on screen when it was dropped past an edge, and turn the window around
// when Sprout crossed the middle.
function settleMove(): Promise<void> {
    return miniOps(async () => {
        if (!globalStore.get(floatMiniAtom) || sprout == null) {
            return;
        }
        const win = getCurrentWindow();
        const moved = await sproutNow(win);
        const screen = await screenOfRect(moved);
        sprout = miniSproutRect(moved, screen.area, screen.scale);
        const sides = globalStore.get(miniSidesAtom);
        const next = miniSides(sprout, screen.area);
        const pulled = sprout.x !== moved.x || sprout.y !== moved.y;
        if (pulled || next.h !== sides.h || next.v !== sides.v) {
            globalStore.set(miniSidesAtom, next);
            await placeMini(win, globalStore.get(petPeekOpenAtom));
        }
    });
}

// What a reload mid-fold left: a see-through window, deaf to the cursor, with no shadow or traffic lights, pinned on
// top. It gets the frame of the size it was folded from (a float's then goes on to Full, see setupFloatMode).
async function recoverFold(win: Window, restore: MiniRestore): Promise<void> {
    writeJson(session, MINI_RESTORE_KEY, null);
    await win.setIgnoreCursorEvents(false);
    await win.setShadow(true);
    await setTrafficLightsHidden(false);
    await win.setAlwaysOnTop(false);
    await setSpaceFrame(win, restore.rect);
    const min = restore.origin === "full" ? MAIN_MIN_SIZE : FLOAT_MIN_SIZE;
    await win.setMinSize(new LogicalSize(min.width, min.height));
    if (restore.origin === "full" && restore.maximized) {
        await win.maximize();
    }
}

// Mounted once by the shell. A reload mid-fold or mid-float lost the atoms but not the shrunk, maybe see-through and
// pinned window: give the frames back, the fold's first, then the float's. The small float window has room for the
// focused terminal alone, so leaving the Agent surface or the terminal's fullscreen (f, Esc, the header button) ends the
// float; folded from Full, a surface switch brings the window back (windowsize.ts onSurfaceChange).
export function setupFloatMode(model: AgentsViewModel): () => void {
    const win = getCurrentWindow();
    if (!globalStore.get(floatModeAtom) && !globalStore.get(floatMiniAtom)) {
        const strandedFold = parseMiniRestore(readJson(session, MINI_RESTORE_KEY));
        const stranded = parseRestore(readJson(session, RESTORE_KEY));
        writeJson(session, RESTORE_KEY, null);
        void (async () => {
            if (strandedFold != null) {
                await recoverFold(win, strandedFold);
            }
            if (stranded != null) {
                await giveFrameBack(win, stranded);
            }
        })().catch((e) => console.error("restoring the window failed", e));
    }
    const unsubSurface = globalStore.sub(model.surfaceAtom, () => {
        const act = onSurfaceChange(currentSize(), globalStore.get(model.surfaceAtom));
        if (act === "exit-float") {
            void exitFloat(true);
        } else if (act === "restore") {
            void restoreFromSprout(model);
        }
    });
    const unsubFullscreen = globalStore.sub(terminalFullscreenAtom, () => {
        if (globalStore.get(floatModeAtom) && !globalStore.get(terminalFullscreenAtom)) {
            void exitFloat(false);
        }
    });
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    const unlistenMoved = win.onMoved(() => {
        if (!globalStore.get(floatMiniAtom)) {
            return;
        }
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => void settleMove().catch((e) => console.error("placing Sprout failed", e)), 300);
    });
    // the yellow button and ⌘M fold while window:minimize says Sprout, in every size (macOS: macwindow.rs redirects them)
    const minimizeSetting = getSettingsKeyAtom("window:minimize");
    const syncRedirect = () =>
        void redirectMinimize(minimizeChoice(globalStore.get(minimizeSetting)) === "sprout").catch((e) =>
            console.error("redirecting minimize failed", e)
        );
    syncRedirect();
    const unsubMinimize = globalStore.sub(minimizeSetting, syncRedirect);
    const unlistenMinimize = listen(MINIMIZE_EVENT, minimizeRequested);
    return () => {
        unsubSurface();
        unsubFullscreen();
        unsubMinimize();
        clearTimeout(moveTimer);
        void unlistenMoved.then((f) => f());
        void unlistenMinimize.then((f) => f());
    };
}
