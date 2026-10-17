// Browser stand-in for @tauri-apps/api/window (vite.browser.config.ts aliases it): the page is one plain, unmaximized
// window of its own size on one monitor, and every move, resize or flag is a no-op, since no native window exists.
import { LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { Monitor, Window } from "@tauri-apps/api/window";

export { LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize };

// @tauri-apps/api/window's enum, by value: a page has no taskbar button to flash
export enum UserAttentionType {
    Critical = 1,
    Informational = 2,
}

const ok = async () => {};
const scale = () => window.devicePixelRatio || 1;
const origin = () => new PhysicalPosition(0, 0);
const pageSize = () =>
    new PhysicalSize(Math.round(window.innerWidth * scale()), Math.round(window.innerHeight * scale()));

function monitor(): Monitor {
    const s = scale();
    const size = new PhysicalSize(Math.round(window.screen.width * s), Math.round(window.screen.height * s));
    return {
        name: "browser",
        size,
        position: origin(),
        scaleFactor: s,
        workArea: { position: origin(), size },
    } as Monitor;
}

function onPage(event: string, payload: () => unknown) {
    return async (cb: (e: { event: string; id: number; payload: unknown }) => void) => {
        const h = () => cb({ event, id: 0, payload: payload() });
        window.addEventListener(event, h);
        return () => window.removeEventListener(event, h);
    };
}

const current = {
    label: "main",
    isMaximized: async () => false,
    isMinimized: async () => false,
    isFullscreen: async () => false,
    isVisible: async () => true,
    isFocused: async () => document.hasFocus(),
    scaleFactor: async () => scale(),
    innerSize: async () => pageSize(),
    outerSize: async () => pageSize(),
    innerPosition: async () => origin(),
    outerPosition: async () => origin(),
    onResized: onPage("resize", pageSize),
    onFocusChanged: async (cb: (e: { event: string; id: number; payload: boolean }) => void) => {
        const focus = () => cb({ event: "focus", id: 0, payload: true });
        const blur = () => cb({ event: "blur", id: 0, payload: false });
        window.addEventListener("focus", focus);
        window.addEventListener("blur", blur);
        return () => {
            window.removeEventListener("focus", focus);
            window.removeEventListener("blur", blur);
        };
    },
    onMoved: async () => () => {},
    close: ok,
    hide: ok,
    minimize: ok,
    unminimize: ok,
    maximize: ok,
    unmaximize: ok,
    toggleMaximize: ok,
    startDragging: ok,
    requestUserAttention: ok,
    setAlwaysOnTop: ok,
    setBadgeCount: ok,
    setFullscreen: ok,
    setIgnoreCursorEvents: ok,
    setMinSize: ok,
    setPosition: ok,
    setShadow: ok,
    setSize: ok,
};

export function getCurrentWindow(): Window {
    return current as unknown as Window;
}

export async function cursorPosition(): Promise<PhysicalPosition> {
    return origin();
}

export async function primaryMonitor(): Promise<Monitor | null> {
    return monitor();
}

export async function currentMonitor(): Promise<Monitor | null> {
    return monitor();
}

export async function availableMonitors(): Promise<Monitor[]> {
    return [monitor()];
}
