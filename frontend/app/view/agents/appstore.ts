// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A pinned app's state, per terminal tab: the service's status (servicesstore.ts, wavesrv's) with the person's own picks
// laid over it, whether the page or the log shows and how often Home reloaded the page, and where its page shows.
// Module-level, as every surface but Agent unmounts on a switch. Opening one is openApp's (toolsstore.ts); the pure parts
// are appmodel.ts. Nothing probes here: wavesrv owns the states, and a pinned app's tab is its service's.

import { globalStore } from "@/app/store/jotaiStore";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { atom, type PrimitiveAtom } from "jotai";
import { appFrameName, focusedAppTab, serviceAppState, type AppState, type AppView } from "./appmodel";
import { serviceByTabAtom } from "./servicesstore";

// terminal tab id -> the view the person picked (page when none) and how often Home reloaded its page
const appViewsAtom = atom<Record<string, AppView>>({}) as PrimitiveAtom<Record<string, AppView>>;
const appReloadsAtom = atom<Record<string, number>>({}) as PrimitiveAtom<Record<string, number>>;

// terminal tab id -> its app: a service's tab. serviceByTabAtom is read only inside this getter, never at load, as
// servicesstore.ts and toolsstore.ts import each other's modules.
export const appStatesAtom = atom((get) => {
    const views = get(appViewsAtom);
    const reloads = get(appReloadsAtom);
    const out: Record<string, AppState> = {};
    for (const [tabId, s] of Object.entries(get(serviceByTabAtom))) {
        out[tabId] = serviceAppState(s, views[tabId] ?? "page", reloads[tabId] ?? 0);
    }
    return out;
});

export interface AppRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

// Where the page of the app in the terminal's place goes on screen (AppPane's slot), the page itself drawn by AppFrames
// in the shell, which no surface switch hides with display:none: a frame under display:none loses its scroll. The rect
// is null while the slot is out of sight (another surface, History), the page then hidden where it was.
export interface AppSlot {
    tabId: string;
    rect: AppRect | null;
}

export const appSlotAtom = atom<AppSlot | null>(null) as PrimitiveAtom<AppSlot | null>;
// terminal tab id -> when its page was last on screen, for keptAppFrames' idle limit
export const appSeenAtom = atom<Record<string, number>>({}) as PrimitiveAtom<Record<string, number>>;

export function shownAppTab(slot: AppSlot | null): string | null {
    return slot?.rect != null ? slot.tabId : null;
}

// tab -> where its page last showed: a page out of sight stays there, at that size, which keeps its scroll
const lastRects = new Map<string, AppRect>();

export function lastAppRect(tabId: string): AppRect | null {
    return lastRects.get(tabId) ?? null;
}

export function setAppSlot(slot: AppSlot | null): void {
    if (slot?.rect != null) {
        lastRects.set(slot.tabId, slot.rect);
    }
    const was = shownAppTab(globalStore.get(appSlotAtom));
    if (was != null && was !== shownAppTab(slot)) {
        globalStore.set(appSeenAtom, { ...globalStore.get(appSeenAtom), [was]: Date.now() });
    }
    globalStore.set(appSlotAtom, slot);
}

// Page | Log in the header
export function setAppView(tabId: string, view: AppView): void {
    const views = globalStore.get(appViewsAtom);
    if ((views[tabId] ?? "page") !== view) {
        globalStore.set(appViewsAtom, { ...views, [tabId]: view });
    }
}

// Home: the app's own url, loaded afresh, on its page
export function homeApp(tabId: string): void {
    const reloads = globalStore.get(appReloadsAtom);
    globalStore.set(appReloadsAtom, { ...reloads, [tabId]: (reloads[tabId] ?? 0) + 1 });
    setAppView(tabId, "page");
}

// Runs reload, back or forward inside the app's frame, which the cockpit cannot reach into (a cross-origin frame): the
// host does it (pagekeys.rs). False where it cannot (a Mac, the browser app) or no frame shows.
function frameAction(tabId: string, action: "reload" | "back" | "forward"): Promise<boolean> {
    return invoke<boolean>("app_frame_action", { name: appFrameName(tabId), action }).catch((e) => {
        console.error(`the app's page: ${action} failed`, e);
        return false;
    });
}

// Reload: the page where it is, as a browser's reload; where the host cannot, Home's start page stands in.
export async function reloadAppPage(tabId: string): Promise<void> {
    if (!(await frameAction(tabId, "reload"))) {
        homeApp(tabId);
    }
}

// emitted by the host on Ctrl+R, Ctrl+Shift+R or F5 (pagekeys.rs), which no longer reload the whole cockpit
export const PAGE_RELOAD_KEY_EVENT = "page-reload-key";

// A pinned app's page is a cross-origin frame, so the keys pressed in it never reach the cockpit's keybindings: the
// host hears them for it. With the app's frame holding the focus they reload its page; elsewhere the cockpit's own
// binding answers them (agent:redraw), or the terminal does.
export function setupPageReloadKey(): () => void {
    const unlisten = listen(PAGE_RELOAD_KEY_EVENT, () => {
        const tabId = focusedAppTab(document.activeElement);
        if (tabId != null) {
            void reloadAppPage(tabId);
        }
    });
    return () => void unlisten.then((off) => off());
}

// Back and Forward walk the app frame's own pages, a single-page app's included, and do nothing with none to walk. The
// window's history would step whichever frame moved last (another app's, a PDF's), so it is only the fallback where
// the host cannot reach the frame (a Mac, the browser app).
export async function appHistory(tabId: string, step: -1 | 1): Promise<void> {
    if (await frameAction(tabId, step < 0 ? "back" : "forward")) {
        return;
    }
    if (step < 0) {
        window.history.back();
    } else {
        window.history.forward();
    }
}
