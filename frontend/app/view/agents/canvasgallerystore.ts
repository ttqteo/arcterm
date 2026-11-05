// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// State of Agent → Canvas gallery (agentcenter.ts' `canvases` mode): where the gallery is (the grid, one open canvas, the
// clean-up selection, or the version scan's review), the list of canvases it shows, and the link picker of an open
// canvas. Module-level atoms, like railstore.ts, so the place survives a surface switch (the mode's components unmount,
// like History's) and the key bindings can read and move it.

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
    scanWrites,
    searchCanvases,
    selectionAfterClean,
    stepIndex,
    suggestVersions,
    toggled,
    trashMessage,
    type CanvasLinkWrite,
    type GalleryCanvas,
    type GalleryGroup,
    type VersionSuggestion,
} from "./canvasgallery";

export type GalleryView = "grid" | "viewer" | "cleanup" | "scan";

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
    resetLinkPicker();
    setGallery({ view: "viewer", dir, board: 0, cursor });
}

export function setViewerBoard(board: number): void {
    setGallery({ board });
}

export function closeCanvas(): void {
    resetLinkPicker();
    setGallery({ view: "grid", dir: null, board: 0 });
}

// Versions (spec 2026-11-05-canvas-related-design.md). Every write is one SetCanvasLinkCommand that sets both fields of
// a canvas.json whole: canvasgallery.ts' write helpers work out the values, wavesrv only guards and writes.

// the topic folder's name, for a toast: dir is the list's clean id, with either slash
function topicOfDir(dir: string): string {
    return dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// One write. A refusal (a target that is gone, a topic another canvas already replaces) is the server's own words in
// an error toast, never swallowed; false then.
async function sendCanvasLink(w: CanvasLinkWrite): Promise<boolean> {
    try {
        await RpcApi.SetCanvasLinkCommand(TabRpcClient, w);
        return true;
    } catch (e) {
        pushToast({
            title: "Canvas gallery",
            message: `Couldn't link ${topicOfDir(w.dir)}: ${errorMessage(e)}`,
            level: "error",
        });
        return false;
    }
}

// the list is read again whether or not the write went through, so the cards show what is on disk
export async function setCanvasLink(w: CanvasLinkWrite): Promise<void> {
    await sendCanvasLink(w);
    await loadCanvases();
}

// Whether the scan has been done is kept in localStorage, read through try/catch: a window without it, or one that
// throws, counts as not scanned, so on another machine or after the dev data is cleared the button shows once more.
const SCANNED_KEY = "canvasgallery.versionsScanned";

export function versionsScanned(): boolean {
    try {
        return localStorage.getItem(SCANNED_KEY) === "1";
    } catch {
        return false;
    }
}

export function markVersionsScanned(): void {
    try {
        localStorage.setItem(SCANNED_KEY, "1");
    } catch {
        // not kept: the button shows again next time
    }
}

// The scan's review list. `pairs` are the suggestions as the review opened, kept so a row does not vanish when the list
// is read again while linking, and so Link writes exactly what was shown; `ticked` holds the newer canvases' dirs (the
// pairs to link); `linking` blocks a second Link and the ticks while writing.
export type ScanState = { pairs: VersionSuggestion[]; ticked: Set<string>; linking: boolean };

const NO_SCAN: ScanState = { pairs: [], ticked: new Set(), linking: false };
export const scanAtom = atom<ScanState>(NO_SCAN) as PrimitiveAtom<ScanState>;

export function startScan(): void {
    const list = globalStore.get(canvasListAtom);
    const pairs = list == null ? [] : suggestVersions(list);
    if (pairs.length === 0) {
        return;
    }
    globalStore.set(scanAtom, { pairs, ticked: new Set(pairs.map((p) => p.newer.dir)), linking: false });
    setGallery({ view: "scan", cursor: 0 });
}

export function toggleScanRow(dir: string): void {
    if (!globalStore.get(scanAtom).linking) {
        globalStore.set(scanAtom, (s) => ({ ...s, ticked: toggled(s.ticked, dir) }));
    }
}

function leaveScan(): void {
    markVersionsScanned();
    globalStore.set(scanAtom, NO_SCAN);
    // the grid's cursor counts its own cards, not the review's rows
    setGallery({ view: "grid", cursor: 0 });
}

// Cancel writes nothing; it still counts as the scan done, so the button is gone for good
export function cancelScan(): void {
    leaveScan();
}

// Link N pairs: a link for each ticked row and a "not a version" for each unticked one, one by one. A write that fails
// is reported and the rest are still written; the list is read once at the end.
export async function linkScan(): Promise<void> {
    const s = globalStore.get(scanAtom);
    if (s.linking) {
        return;
    }
    const writes = scanWrites(s.pairs, s.ticked);
    globalStore.set(scanAtom, { ...s, linking: true });
    for (const w of writes) {
        await sendCanvasLink(w);
    }
    await loadCanvases();
    leaveScan();
}

// The link picker under the viewer header's `Link an older version…`: open, and what is typed in its search box. It
// belongs to the open canvas, so opening or closing a canvas puts it away.
export type LinkPickerState = { open: boolean; query: string };

const NO_PICKER: LinkPickerState = { open: false, query: "" };
export const linkPickerAtom = atom<LinkPickerState>(NO_PICKER) as PrimitiveAtom<LinkPickerState>;

export function openLinkPicker(): void {
    globalStore.set(linkPickerAtom, { open: true, query: "" });
}

export function setLinkPickerQuery(query: string): void {
    globalStore.set(linkPickerAtom, (p) => ({ ...p, query }));
}

function resetLinkPicker(): void {
    if (globalStore.get(linkPickerAtom).open || globalStore.get(linkPickerAtom).query !== "") {
        globalStore.set(linkPickerAtom, NO_PICKER);
    }
}

// false when no picker was open, so Escape knows whether it closed one or has to leave the viewer
export function closeLinkPicker(): boolean {
    const was = globalStore.get(linkPickerAtom).open;
    resetLinkPicker();
    return was;
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
            title: "Canvas gallery",
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
        pushToast({ title: "Canvas gallery", message: `Couldn't move to the trash: ${String(e)}`, level: "error" });
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
