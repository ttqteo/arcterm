import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

// mirror Electron emain-util.ts zoom bounds.
const MinZoom = 0.5;
const MaxZoom = 3;
const ZoomDelta = 0.1;

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
function applyZoom(f: number) {
    zoomFactor = Math.min(MaxZoom, Math.max(MinZoom, Math.round(f * 100) / 100));
    getCurrentWebview().setZoom(zoomFactor).catch(noop);
    for (const cb of zoomSubs) cb(zoomFactor);
}
export function zoomIn() {
    applyZoom(zoomFactor + ZoomDelta);
}
export function zoomOut() {
    applyZoom(zoomFactor - ZoomDelta);
}
export function zoomReset() {
    applyZoom(1);
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
        if (ev.ctrlKey && (ev.key === "=" || ev.key === "+")) {
            ev.preventDefault();
            zoomIn();
            return;
        }
        if (ev.ctrlKey && ev.key === "-") {
            ev.preventDefault();
            zoomOut();
            return;
        }
        if (ev.ctrlKey && ev.key === "0") {
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
