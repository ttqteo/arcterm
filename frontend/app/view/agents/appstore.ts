// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A pinned app's state, per terminal tab: waiting for its page, open, or failed, and whether the page or the log is
// picked. Module-level, as every surface but Agent unmounts on a switch. Opening one is openTool's (toolsstore.ts); the
// pure parts are appmodel.ts. Nothing runs while no app is open: the probe loop lives only from a start to its answer.

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { atom, type PrimitiveAtom } from "jotai";
import {
    afterProbe,
    APP_PROBE_INTERVAL_MS,
    APP_START_TIMEOUT_MS,
    startingApp,
    type AppState,
    type AppView,
} from "./appmodel";

// one probe's own limit: a server that accepted the connection but never answers counts as not up yet
const PROBE_TIMEOUT_MS = 1500;

// terminal tab id -> its app
export const appStatesAtom = atom<Record<string, AppState>>({}) as PrimitiveAtom<Record<string, AppState>>;

function update(tabId: string, fn: (s: AppState) => AppState): void {
    const all = globalStore.get(appStatesAtom);
    const s = all[tabId];
    if (s == null) {
        return;
    }
    const next = fn(s);
    if (next !== s) {
        globalStore.set(appStatesAtom, { ...all, [tabId]: next });
    }
}

function drop(tabId: string): void {
    const all = globalStore.get(appStatesAtom);
    if (all[tabId] == null) {
        return;
    }
    const next = { ...all };
    delete next[tabId];
    globalStore.set(appStatesAtom, next);
}

// Whether anything answers at url. An opaque no-cors response is enough: a refused connection rejects, and any answer,
// a 404 included, means the server is up. The CSP's connect-src allows http://127.0.0.1:*.
export async function probeApp(url: string): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
        await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

const watched = new Set<string>();
const probing = new Set<string>();

// Probes until the page answers or the start times out; one loop per app at a time.
function probeLoop(tabId: string): void {
    if (probing.has(tabId)) {
        return;
    }
    probing.add(tabId);
    const tick = async () => {
        const s = globalStore.get(appStatesAtom)[tabId];
        if (s == null || s.phase !== "starting") {
            probing.delete(tabId);
            return;
        }
        const answered = await probeApp(s.url);
        update(tabId, (cur) => afterProbe(cur, answered, Date.now()));
        setTimeout(() => void tick(), APP_PROBE_INTERVAL_MS);
    };
    void tick();
}

// Probes the new app, and forgets it when its terminal closes.
function watchApp(tabId: string, blockId: string): void {
    probeLoop(tabId);
    if (watched.has(tabId)) {
        return;
    }
    watched.add(tabId);
    const unsubClose = waveEventSubscribeSingle({
        eventType: "blockclose",
        scope: WOS.makeORef("block", blockId),
        handler: () => {
            unsubClose();
            watched.delete(tabId);
            drop(tabId);
        },
    });
}

// A terminal just opened for an app: `owned` when arcterm ran its command there, false when the page already answered
// and the terminal is a shell in its folder.
export function trackApp(tabId: string, blockId: string, tool: ToolStatus, owned: boolean): void {
    const s = startingApp(tool.id, tool.url!, owned, Date.now());
    globalStore.set(appStatesAtom, {
        ...globalStore.get(appStatesAtom),
        [tabId]: owned ? s : afterProbe(s, true, Date.now()),
    });
    watchApp(tabId, blockId);
}

// the tools being opened: their new terminal shows (and its header asks to adopt it) before openTool has tracked it
const launching = new Set<string>();

export async function whileLaunching<T>(toolId: string, fn: () => Promise<T>): Promise<T> {
    launching.add(toolId);
    try {
        return await fn();
    } finally {
        launching.delete(toolId);
    }
}

// An app terminal with no state: one that outlived a reload of the page. It ran the command when its block says so
// (tool:appowned; cmd:firstcommand is cleared once typed); one probe decides, as nothing was started now to wait for.
export function adoptApp(tabId: string, blockId: string, tool: ToolStatus): void {
    if (globalStore.get(appStatesAtom)[tabId] != null || !tool.url || launching.has(tool.id)) {
        return;
    }
    const owned = WOS.getObjectValue<Block>(WOS.makeORef("block", blockId))?.meta?.["tool:appowned"] === true;
    globalStore.set(appStatesAtom, {
        ...globalStore.get(appStatesAtom),
        [tabId]: startingApp(tool.id, tool.url, owned, Date.now() - APP_START_TIMEOUT_MS),
    });
    watchApp(tabId, blockId);
}

// Picking the page of an app that failed asks once more: a server started by hand since then shows
export function setAppView(tabId: string, view: AppView): void {
    update(tabId, (s) => {
        if (view === "page" && s.phase === "failed") {
            return { ...s, view, phase: "starting", startedMs: Date.now() - APP_START_TIMEOUT_MS };
        }
        return s.view === view ? s : { ...s, view };
    });
    if (globalStore.get(appStatesAtom)[tabId]?.phase === "starting") {
        probeLoop(tabId);
    }
}

// Home: the app's own url, loaded afresh, on its page
export function homeApp(tabId: string): void {
    update(tabId, (s) => ({ ...s, reloads: s.reloads + 1, view: "page" }));
}

// Back and Forward walk the window's history, which a frame's navigations join. arcterm itself never pushes an entry,
// so what they walk is the app's own pages, a single-page app's included; with nothing to walk they do nothing.
export function appHistory(step: -1 | 1): void {
    if (step < 0) {
        window.history.back();
    } else {
        window.history.forward();
    }
}
