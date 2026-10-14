// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// State of Agent → Canvases (agentcenter.ts' `canvases` mode): where the gallery is (the grid, one open canvas, or the
// clean-up selection), and the list of canvases it shows. Module-level atoms, like railstore.ts, so the place survives a
// surface switch (the mode's components unmount, like History's) and the key bindings can read and move it.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { atom, type PrimitiveAtom } from "jotai";
import { moveGalleryCursor, type CursorKey } from "./canvascursor";
import {
    cleanupGroups,
    cleanupOrder,
    groupByDay,
    initialSelection,
    searchCanvases,
    selectionAfterClean,
    stepIndex,
    toggled,
    trashMessage,
    type GalleryCanvas,
    type GalleryGroup,
} from "./canvasgallery";

export type GalleryView = "grid" | "viewer" | "cleanup";

// `dir` is the open canvas' topic folder (the list's clean id), `board` an index into its boards, `cursor` an index into
// the flat order of the cards the grid shows (groups in order)
export type CanvasGalleryState = {
    view: GalleryView;
    dir: string | null;
    board: number;
    query: string;
    cursor: number;
};

export const canvasGalleryAtom = atom<CanvasGalleryState>({
    view: "grid",
    dir: null,
    board: 0,
    query: "",
    cursor: 0,
}) as PrimitiveAtom<CanvasGalleryState>;

// null until the first read
export const canvasListAtom = atom<GalleryCanvas[] | null>(null) as PrimitiveAtom<GalleryCanvas[] | null>;
export const canvasListErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

let loadSeq = 0;

// one call per gallery open, and after a clean: there is no watcher
export async function loadCanvases(): Promise<void> {
    const seq = ++loadSeq;
    try {
        const list = await RpcApi.ListCanvasesCommand(TabRpcClient);
        if (seq === loadSeq) {
            globalStore.set(canvasListAtom, list);
            globalStore.set(canvasListErrorAtom, null);
        }
    } catch (e) {
        console.warn("list canvases failed", e);
        if (seq === loadSeq) {
            globalStore.set(canvasListErrorAtom, e instanceof Error ? e.message : String(e));
        }
    }
}

// where wavesrv serves a project's design folder (CanvasServeCommand), asked once per folder; a refusal is forgotten so
// the next ask retries
const bases = new Map<string, Promise<string | null>>();

export function canvasBase(designdir: string): Promise<string | null> {
    let base = bases.get(designdir);
    if (base == null) {
        base = RpcApi.CanvasServeCommand(TabRpcClient, designdir).then(
            (path) => getWebServerEndpoint() + path,
            (e) => {
                console.warn("canvas serve refused", designdir, e);
                return null;
            }
        );
        bases.set(designdir, base);
        void base.then((b) => {
            if (b == null) {
                bases.delete(designdir);
            }
        });
    }
    return base;
}

export function galleryGroups(list: GalleryCanvas[] | null, query: string, now: number): GalleryGroup[] {
    return groupByDay(searchCanvases(list ?? [], query), now);
}

export function galleryFlat(list: GalleryCanvas[] | null, query: string, now: number): GalleryCanvas[] {
    return galleryGroups(list, query, now).flatMap((g) => g.items);
}

function setGallery(patch: Partial<CanvasGalleryState>): void {
    globalStore.set(canvasGalleryAtom, (g) => ({ ...g, ...patch }));
}

export function setGalleryQuery(query: string): void {
    // the cards under the cursor change with the filter, so it starts over
    setGallery({ query, cursor: 0 });
}

export function setGalleryCursor(cursor: number): void {
    setGallery({ cursor });
}

export function openCanvas(dir: string, cursor: number): void {
    setGallery({ view: "viewer", dir, board: 0, cursor });
}

export function setViewerBoard(board: number): void {
    setGallery({ board });
}

export function closeCanvas(): void {
    setGallery({ view: "grid", dir: null, board: 0 });
}

// Clean up. `now` is read once when the mode opens and kept, so a card does not hop between the two groups while the
// person ticks; `selected` is the topic dirs (the clean ids), `skipped` the reasons the last move gave, by dir
export type CleanupState = { selected: Set<string>; now: number; skipped: Record<string, string>; moving: boolean };

const NO_CLEANUP: CleanupState = { selected: new Set(), now: 0, skipped: {}, moving: false };
export const cleanupAtom = atom<CleanupState>(NO_CLEANUP) as PrimitiveAtom<CleanupState>;

// a move that outlives its clean-up (cancelled, or another one opened) toasts and touches nothing else
let cleanupRun = 0;

function setCleanup(patch: Partial<CleanupState>): void {
    globalStore.set(cleanupAtom, (c) => ({ ...c, ...patch }));
}

export function startCleanup(now: number): void {
    cleanupRun++;
    const list = globalStore.get(canvasListAtom) ?? [];
    globalStore.set(cleanupAtom, { selected: initialSelection(list, now), now, skipped: {}, moving: false });
    setGallery({ view: "cleanup", cursor: 0 });
}

export function cancelCleanup(): void {
    cleanupRun++;
    globalStore.set(cleanupAtom, NO_CLEANUP);
    // the grid's cursor counts its own cards, not the clean-up order
    setGallery({ view: "grid", cursor: 0 });
}

export function toggleCleanupCard(dir: string): void {
    if (!globalStore.get(cleanupAtom).moving) {
        globalStore.set(cleanupAtom, (c) => ({ ...c, selected: toggled(c.selected, dir) }));
    }
}

export function untickAll(): void {
    if (!globalStore.get(cleanupAtom).moving) {
        setCleanup({ selected: new Set() });
    }
}

// Space: the card under the cursor. False when there is none, so the key passes
export function toggleCleanupCursor(): boolean {
    const list = globalStore.get(canvasListAtom);
    const cards = cleanupOrder(list ?? [], globalStore.get(cleanupAtom).now);
    if (cards.length === 0) {
        return false;
    }
    const at = Math.min(Math.max(0, globalStore.get(canvasGalleryAtom).cursor), cards.length - 1);
    toggleCleanupCard(cards[at].dir);
    return true;
}

export function moveCleanupCards(key: CursorKey): boolean {
    const list = globalStore.get(canvasListAtom);
    if (list == null) {
        return false;
    }
    const groups = cleanupGroups(list, globalStore.get(cleanupAtom).now);
    const sizes = [groups.suggested.length, groups.newer.length];
    setGallery({ cursor: moveGalleryCursor(sizes, gridColumns(), globalStore.get(canvasGalleryAtom).cursor, key) });
    return true;
}

// moving a folder is a rename, but into ~/.arc/trash, which can be another drive: a copy
const TRASH_TIMEOUT_MS = 2 * 60_000;

export async function moveSelectionToTrash(): Promise<void> {
    const before = globalStore.get(cleanupAtom);
    // what the bar counts: the ticked canvases that are still listed
    const ids = (globalStore.get(canvasListAtom) ?? []).filter((c) => before.selected.has(c.dir)).map((c) => c.dir);
    if (before.moving || ids.length === 0) {
        return;
    }
    const run = cleanupRun;
    setCleanup({ moving: true, skipped: {} });
    try {
        const result = await RpcApi.CleanStorageCommand(
            TabRpcClient,
            { category: "canvases", itemids: ids, allowguarded: true },
            { timeout: TRASH_TIMEOUT_MS }
        );
        const cleaned = result.cleaned ?? [];
        const skipped = result.skipped ?? [];
        await loadCanvases();
        pushToast({
            title: "Canvases",
            message: trashMessage(cleaned.length, skipped.length),
            level: skipped.length > 0 ? "warn" : "info",
        });
        if (run !== cleanupRun) {
            return;
        }
        const list = globalStore.get(canvasListAtom) ?? [];
        const here = new Set(list.map((c) => c.dir));
        // a skip whose folder is gone anyway ("already gone") has nothing left to show
        const stuck = skipped.filter((s) => here.has(s.id));
        if (stuck.length === 0) {
            cancelCleanup();
            return;
        }
        setCleanup({
            selected: selectionAfterClean(before.selected, list, cleaned),
            skipped: Object.fromEntries(stuck.map((s) => [s.id, s.reason])),
        });
        const left = cleanupOrder(list, before.now).length;
        setGallery({ cursor: Math.min(globalStore.get(canvasGalleryAtom).cursor, Math.max(0, left - 1)) });
    } catch (e) {
        pushToast({ title: "Canvases", message: `Couldn't move to the trash: ${String(e)}`, level: "error" });
    } finally {
        if (run === cleanupRun) {
            setCleanup({ moving: false });
        }
    }
}

export function openCursorCanvas(now: number): boolean {
    const g = globalStore.get(canvasGalleryAtom);
    const flat = galleryFlat(globalStore.get(canvasListAtom), g.query, now);
    if (flat.length === 0) {
        return false;
    }
    const at = Math.min(Math.max(0, g.cursor), flat.length - 1);
    openCanvas(flat[at].dir, at);
    return true;
}

// the open canvas' boards, in the viewer, stepped as the pane's [ and ] step theirs: round the ends
export function stepViewerBoard(delta: number): boolean {
    const g = globalStore.get(canvasGalleryAtom);
    const open = globalStore.get(canvasListAtom)?.find((c) => c.dir === g.dir);
    if (open == null || open.boards.length === 0) {
        return false;
    }
    setGallery({ board: stepIndex(open.boards.length, g.board, delta) });
    return true;
}

// how many cards a row of the grid holds: the browser's own answer for repeat(auto-fill, ...), read off the grid
function gridColumns(): number {
    const grid = typeof document === "undefined" ? null : document.querySelector("[data-canvas-grid]");
    if (grid == null) {
        return 1;
    }
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
}

export function moveGalleryCards(key: CursorKey, now: number): boolean {
    const g = globalStore.get(canvasGalleryAtom);
    const list = globalStore.get(canvasListAtom);
    if (list == null) {
        return false;
    }
    const sizes = galleryGroups(list, g.query, now).map((grp) => grp.items.length);
    setGallery({ cursor: moveGalleryCursor(sizes, gridColumns(), g.cursor, key) });
    return true;
}
