// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// State of Agent → Canvases (agentcenter.ts' `canvases` mode): where the gallery is (the grid, one open canvas, or the
// clean-up selection), and the list of canvases it shows. Module-level atoms, like railstore.ts, so the place survives a
// surface switch (the mode's components unmount, like History's) and the key bindings can read and move it.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { atom, type PrimitiveAtom } from "jotai";
import { moveGalleryCursor, type CursorKey } from "./canvascursor";
import { groupByDay, searchCanvases, stepIndex, type GalleryCanvas, type GalleryGroup } from "./canvasgallery";

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

export function startCleanup(): void {
    setGallery({ view: "cleanup", cursor: 0 });
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
