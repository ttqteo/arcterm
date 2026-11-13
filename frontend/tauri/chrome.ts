import { isMacOS } from "@/util/platformutil";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

// mirror Electron emain-util.ts zoom bounds.
const MinZoom = 0.5;
const MaxZoom = 3;
const ZoomDelta = 0.1;
// the app starts one zoom step up (text was a size too small at 1); Mod+0 comes back here.
export const DefaultZoom = 1.1;

let zoomFactor = 1;
const zoomSubs: ((f: number) => void)[] = [];
const fsSubs: ((b: boolean) => void)[] = [];
const csSubs: ((b: boolean) => void)[] = [];
let ctrlShift = false;
let fullscreen = false;

const noop = () => {};

export function getZoomFactor(): number {
    return zoomFactor;
}
export function onZoomFactorChange(cb: (f: number) => void) {
    zoomSubs.push(cb);
}
// the zoom is kept in localStorage like the theme (themestore.ts), so it survives a restart and a reinstall.
const ZoomStorageKey = "cockpit.zoom.v2";
// the key from when the default was 1: its 1 was that default, so it follows the new one; any other value was the
// person's own choice and carries over.
const LegacyZoomStorageKey = "cockpit.zoom";
function saveZoom(f: number) {
    try {
        globalThis.localStorage?.setItem(ZoomStorageKey, String(f));
    } catch {
        // storage blocked: the zoom still applies, it just is not kept
    }
}
function readZoom(key: string): number | null {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw == null) return null;
    const f = Number(raw);
    return Number.isFinite(f) && f >= MinZoom && f <= MaxZoom ? f : null;
}
function loadSavedZoom(): number | null {
    try {
        const saved = readZoom(ZoomStorageKey);
        if (saved != null) return saved;
        const legacy = readZoom(LegacyZoomStorageKey);
        globalThis.localStorage?.removeItem?.(LegacyZoomStorageKey);
        return legacy != null && legacy !== 1 ? legacy : null;
    } catch {
        return null;
    }
}
function applyZoom(f: number) {
    zoomFactor = Math.min(MaxZoom, Math.max(MinZoom, Math.round(f * 100) / 100));
    getCurrentWebview().setZoom(zoomFactor).catch(noop);
    saveZoom(zoomFactor);
    for (const cb of zoomSubs) cb(zoomFactor);
}
// applies the saved zoom at boot; a missing or bad value applies the default.
export function restoreZoom() {
    applyZoom(loadSavedZoom() ?? DefaultZoom);
}
export function zoomIn() {
    applyZoom(zoomFactor + ZoomDelta);
}
export function zoomOut() {
    applyZoom(zoomFactor - ZoomDelta);
}
export function zoomReset() {
    applyZoom(DefaultZoom);
}

export function onFullScreenChange(cb: (b: boolean) => void) {
    fsSubs.push(cb);
}
function setFullscreenState(state: boolean) {
    if (state === fullscreen) return;
    fullscreen = state;
    for (const cb of fsSubs) cb(state);
}
export async function toggleFullscreen() {
    const w = getCurrentWindow();
    const next = !(await w.isFullscreen());
    await w.setFullscreen(next);
    setFullscreenState(next);
}

export function onControlShiftStateUpdate(cb: (b: boolean) => void) {
    csSubs.push(cb);
}
function setCtrlShift(state: boolean) {
    if (state === ctrlShift) return;
    ctrlShift = state;
    for (const cb of csSubs) cb(state);
}
// mirror emain-util.ts handleCtrlShiftState: true only while ctrl+shift held without meta.
export function applyKeyToCtrlShift(e: { type: string; ctrl: boolean; shift: boolean; meta: boolean }) {
    if (e.type === "keyup") {
        if (!e.ctrl || !e.shift) setCtrlShift(false);
        return;
    }
    setCtrlShift(e.ctrl && e.shift && !e.meta);
}

// DOM wiring (verified by observe-gates, not unit tests). Called once at boot from main.tsx.
export function installChromeListeners() {
    restoreZoom();
    // macOS enters fullscreen from the green traffic light and the View menu too, never through F11;
    // every route resizes the window, so the resize is what keeps the state current.
    const win = getCurrentWindow();
    const syncFullscreen = () => win.isFullscreen().then(setFullscreenState).catch(noop);
    syncFullscreen();
    win.onResized(syncFullscreen).catch(noop);
    window.addEventListener("keydown", (ev) => {
        if (ev.key === "F11") {
            ev.preventDefault();
            toggleFullscreen();
            return;
        }
        // zoom on the platform's own modifier: ⌘ on a Mac (Control there is the terminal's, Ctrl+- its undo), Ctrl elsewhere
        const zoomMod = isMacOS() ? ev.metaKey : ev.ctrlKey;
        if (zoomMod && (ev.key === "=" || ev.key === "+")) {
            ev.preventDefault();
            zoomIn();
            return;
        }
        if (zoomMod && ev.key === "-") {
            ev.preventDefault();
            zoomOut();
            return;
        }
        if (zoomMod && ev.key === "0") {
            ev.preventDefault();
            zoomReset();
            return;
        }
        applyKeyToCtrlShift({ type: "keydown", ctrl: ev.ctrlKey, shift: ev.shiftKey, meta: ev.metaKey });
    });
    window.addEventListener("keyup", (ev) => {
        applyKeyToCtrlShift({ type: "keyup", ctrl: ev.ctrlKey, shift: ev.shiftKey, meta: ev.metaKey });
    });
}
