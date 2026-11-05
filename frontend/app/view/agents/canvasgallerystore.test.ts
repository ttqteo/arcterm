// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ListCanvasesCommand: vi.fn(),
        CleanStorageCommand: vi.fn(),
        CanvasServeCommand: vi.fn(),
        SetCanvasLinkCommand: vi.fn(),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/util/endpoints", () => ({ getWebServerEndpoint: () => "http://127.0.0.1:1" }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: vi.fn() }));

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import type { GalleryCanvas } from "./canvasgallery";
import {
    cancelCleanup,
    cancelScan,
    canvasGalleryAtom,
    canvasListAtom,
    cleanupAtom,
    closeCanvas,
    closeLinkPicker,
    linkPickerAtom,
    linkScan,
    markVersionsScanned,
    moveSelectionToTrash,
    openCanvas,
    openLinkPicker,
    scanAtom,
    setCanvasLink,
    setLinkPickerQuery,
    startCleanup,
    startScan,
    toggleCleanupCard,
    toggleScanRow,
    untickAll,
    versionsScanned,
} from "./canvasgallerystore";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const dirOf = (topic: string) => `/p/.superpowers/design/${topic}`;

function canvas(topic: string, modts: number): GalleryCanvas {
    return {
        topic,
        project: "/p",
        projectname: "p",
        designdir: "/p/.superpowers/design",
        dir: dirOf(topic),
        boards: ["Main"],
        modts,
        thumbts: 0,
        bytes: 1024,
        createdts: modts,
    };
}

// two long unchanged, one new
const OLD_A = canvas("old-a", NOW - 40 * DAY);
const OLD_B = canvas("old-b", NOW - 50 * DAY);
const NEW = canvas("new", NOW - DAY);

const list = vi.mocked(RpcApi.ListCanvasesCommand);
const clean = vi.mocked(RpcApi.CleanStorageCommand);
const link = vi.mocked(RpcApi.SetCanvasLinkCommand);
const toast = vi.mocked(pushToast);

const gallery = () => globalStore.get(canvasGalleryAtom);
const cleanup = () => globalStore.get(cleanupAtom);
const scan = () => globalStore.get(scanAtom);
const picker = () => globalStore.get(linkPickerAtom);

const SCANNED_KEY = "canvasgallery.versionsScanned";

// a localStorage that remembers, so a test reads back what the store wrote
function stubStorage(): Map<string, string> {
    const kept = new Map<string, string>();
    vi.stubGlobal("localStorage", {
        getItem: (k: string) => kept.get(k) ?? null,
        setItem: (k: string, v: string) => void kept.set(k, v),
        removeItem: (k: string) => void kept.delete(k),
    });
    return kept;
}

beforeEach(() => {
    globalStore.set(canvasGalleryAtom, { view: "grid", dir: null, board: 0, query: "", cursor: 0 });
    globalStore.set(canvasListAtom, [OLD_A, OLD_B, NEW]);
    globalStore.set(scanAtom, { pairs: [], ticked: new Set<string>(), linking: false });
    globalStore.set(linkPickerAtom, { open: false, query: "" });
    cancelCleanup();
    list.mockReset();
    clean.mockReset();
    link.mockReset();
    toast.mockReset();
    stubStorage();
});

afterEach(() => {
    cancelCleanup();
    globalStore.set(canvasListAtom, null);
    vi.unstubAllGlobals();
});

describe("startCleanup", () => {
    it("opens clean up with the canvases unchanged for 30 days ticked, at the first card", () => {
        globalStore.set(canvasGalleryAtom, { ...gallery(), cursor: 2 });
        startCleanup(NOW);
        expect(gallery()).toMatchObject({ view: "cleanup", cursor: 0 });
        expect(cleanup()).toMatchObject({ now: NOW, skipped: {}, moving: false });
        expect(cleanup().selected).toEqual(new Set([dirOf("old-a"), dirOf("old-b")]));
    });

    it("keeps the clock it opened with, so a card stays in its group while the person ticks", () => {
        startCleanup(NOW);
        expect(cleanup().now).toBe(NOW);
    });
});

describe("ticking", () => {
    it("toggles one card, and unticks all", () => {
        startCleanup(NOW);
        toggleCleanupCard(dirOf("new"));
        expect(cleanup().selected.has(dirOf("new"))).toBe(true);
        toggleCleanupCard(dirOf("old-a"));
        expect(cleanup().selected.has(dirOf("old-a"))).toBe(false);
        untickAll();
        expect(cleanup().selected).toEqual(new Set());
    });
});

describe("moveSelectionToTrash", () => {
    it("asks for nothing when nothing is ticked", async () => {
        startCleanup(NOW);
        untickAll();
        await moveSelectionToTrash();
        expect(clean).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
        expect(gallery().view).toBe("cleanup");
    });

    it("moves the ticked canvases, says so, and goes back to the grid when nothing failed", async () => {
        startCleanup(NOW);
        toggleCleanupCard(dirOf("new"));
        clean.mockResolvedValue({
            reclaimed: 0,
            trashed: 3072,
            cleaned: [dirOf("old-a"), dirOf("old-b"), dirOf("new")],
            skipped: [],
        });
        list.mockResolvedValue([]);
        await moveSelectionToTrash();
        expect(clean).toHaveBeenCalledTimes(1);
        const [, data] = clean.mock.calls[0];
        expect(data.category).toBe("canvases");
        expect(data.allowguarded).toBe(true);
        expect([...data.itemids!].sort()).toEqual([dirOf("new"), dirOf("old-a"), dirOf("old-b")]);
        expect(toast).toHaveBeenCalledWith({
            title: "Canvas gallery",
            message: "Moved 3 canvases to the trash",
            level: "info",
        });
        expect(gallery()).toMatchObject({ view: "grid", cursor: 0 });
        expect(cleanup().selected).toEqual(new Set());
        expect(cleanup().moving).toBe(false);
        expect(globalStore.get(canvasListAtom)).toEqual([]);
    });

    it("keeps a skipped canvas ticked with its reason, and stays in clean up", async () => {
        startCleanup(NOW);
        clean.mockResolvedValue({
            reclaimed: 0,
            trashed: 1024,
            cleaned: [dirOf("old-a")],
            skipped: [{ id: dirOf("old-b"), reason: "not a folder (a link is never moved)" }],
        });
        list.mockResolvedValue([OLD_B, NEW]);
        await moveSelectionToTrash();
        expect(toast).toHaveBeenCalledWith({
            title: "Canvas gallery",
            message: "Moved 1 canvas to the trash, 1 skipped",
            level: "warn",
        });
        expect(gallery().view).toBe("cleanup");
        expect(cleanup().selected).toEqual(new Set([dirOf("old-b")]));
        expect(cleanup().skipped).toEqual({ [dirOf("old-b")]: "not a folder (a link is never moved)" });
        expect(cleanup().moving).toBe(false);
    });

    it("has nothing left to show for a skip whose folder is gone, and goes back to the grid", async () => {
        startCleanup(NOW);
        clean.mockResolvedValue({
            reclaimed: 0,
            trashed: 1024,
            cleaned: [dirOf("old-a")],
            skipped: [{ id: dirOf("old-b"), reason: "already gone" }],
        });
        list.mockResolvedValue([NEW]);
        await moveSelectionToTrash();
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ level: "warn" }));
        expect(gallery().view).toBe("grid");
    });

    it("keeps the cursor on a card when the list shrinks under it", async () => {
        startCleanup(NOW);
        globalStore.set(canvasGalleryAtom, { ...gallery(), cursor: 2 });
        clean.mockResolvedValue({
            reclaimed: 0,
            trashed: 1024,
            cleaned: [dirOf("old-a")],
            skipped: [{ id: dirOf("old-b"), reason: "not a design canvas of a project" }],
        });
        list.mockResolvedValue([OLD_B]);
        await moveSelectionToTrash();
        expect(gallery()).toMatchObject({ view: "cleanup", cursor: 0 });
    });

    it("reports a failed call and keeps the selection", async () => {
        startCleanup(NOW);
        clean.mockRejectedValue(new Error("timeout"));
        await moveSelectionToTrash();
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ level: "error" }));
        expect(gallery().view).toBe("cleanup");
        expect(cleanup().selected).toEqual(new Set([dirOf("old-a"), dirOf("old-b")]));
        expect(cleanup().moving).toBe(false);
    });

    it("blocks a second move, and ticking, while one is under way", async () => {
        startCleanup(NOW);
        let finish: (v: StorageCleanResult) => void = () => {};
        clean.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        list.mockResolvedValue([NEW]);
        const first = moveSelectionToTrash();
        expect(cleanup().moving).toBe(true);
        await moveSelectionToTrash();
        toggleCleanupCard(dirOf("new"));
        untickAll();
        expect(clean).toHaveBeenCalledTimes(1);
        expect(cleanup().selected).toEqual(new Set([dirOf("old-a"), dirOf("old-b")]));
        finish({ reclaimed: 0, trashed: 2048, cleaned: [dirOf("old-a"), dirOf("old-b")], skipped: [] });
        await first;
        expect(gallery().view).toBe("grid");
    });

    it("toasts but leaves the gallery alone when clean up was cancelled meanwhile", async () => {
        startCleanup(NOW);
        let finish: (v: StorageCleanResult) => void = () => {};
        clean.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        list.mockResolvedValue([NEW]);
        const move = moveSelectionToTrash();
        cancelCleanup();
        // another clean up opens before the first move answers
        startCleanup(NOW);
        finish({
            reclaimed: 0,
            trashed: 2048,
            cleaned: [dirOf("old-a"), dirOf("old-b")],
            skipped: [{ id: dirOf("new"), reason: "x" }],
        });
        await move;
        expect(toast).toHaveBeenCalledTimes(1);
        expect(gallery().view).toBe("cleanup");
        expect(cleanup().skipped).toEqual({});
        expect(cleanup().moving).toBe(false);
    });
});

// two pairs the scan suggests (a topic that continues the older one at a dash), the newer of each created later
const HOME = canvas("home", NOW - 9 * DAY);
const HOME_FRESH = canvas("home-fresh", NOW - 8 * DAY);
const NOTES = canvas("notes", NOW - 5 * DAY);
const NOTES_V2 = canvas("notes-v2", NOW - 4 * DAY);
const PAIRS = [HOME, HOME_FRESH, NOTES, NOTES_V2];

describe("the scanned flag", () => {
    it("is false until the scan has been done, then true, under one localStorage key", () => {
        const kept = stubStorage();
        expect(versionsScanned()).toBe(false);
        markVersionsScanned();
        expect(kept.get(SCANNED_KEY)).toBe("1");
        expect(versionsScanned()).toBe(true);
        kept.delete(SCANNED_KEY);
        expect(versionsScanned()).toBe(false);
    });

    it("counts a localStorage that throws as not scanned, and never throws itself", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
        });
        expect(versionsScanned()).toBe(false);
        expect(() => markVersionsScanned()).not.toThrow();
        expect(versionsScanned()).toBe(false);
    });

    it("counts a window with no localStorage as not scanned", () => {
        vi.stubGlobal("localStorage", undefined);
        expect(versionsScanned()).toBe(false);
        expect(() => markVersionsScanned()).not.toThrow();
    });
});

describe("setCanvasLink", () => {
    const write = { dir: dirOf("home-fresh"), replaces: "home", notreplaces: [] as string[] };

    it("sends both fields whole, then reads the list again", async () => {
        link.mockResolvedValue(undefined);
        list.mockResolvedValue([HOME]);
        await setCanvasLink(write);
        expect(link).toHaveBeenCalledTimes(1);
        expect(link.mock.calls[0][1]).toEqual(write);
        expect(list).toHaveBeenCalledTimes(1);
        expect(globalStore.get(canvasListAtom)).toEqual([HOME]);
        expect(toast).not.toHaveBeenCalled();
    });

    it("shows the server's message in an error toast, and reads the list again to show what is on disk", async () => {
        link.mockRejectedValue(new Error("home does not exist in this design folder"));
        list.mockResolvedValue([HOME_FRESH]);
        await setCanvasLink(write);
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast.mock.calls[0][0]).toMatchObject({ title: "Canvas gallery", level: "error" });
        expect(toast.mock.calls[0][0].message).toContain("home does not exist in this design folder");
        expect(list).toHaveBeenCalledTimes(1);
        expect(globalStore.get(canvasListAtom)).toEqual([HOME_FRESH]);
    });
});

describe("the scan review", () => {
    beforeEach(() => {
        globalStore.set(canvasListAtom, PAIRS);
    });

    it("opens with every suggested pair ticked, at the first row", () => {
        globalStore.set(canvasGalleryAtom, { ...gallery(), cursor: 3 });
        startScan();
        expect(gallery()).toMatchObject({ view: "scan", cursor: 0 });
        // newest first, as the review draws them
        expect(scan().pairs.map((p) => [p.newer.topic, p.older.topic])).toEqual([
            ["notes-v2", "notes"],
            ["home-fresh", "home"],
        ]);
        expect(scan().ticked).toEqual(new Set([dirOf("home-fresh"), dirOf("notes-v2")]));
        expect(scan().linking).toBe(false);
    });

    it("keeps the pairs it opened with when the list changes under it", () => {
        startScan();
        globalStore.set(canvasListAtom, [OLD_A]);
        expect(scan().pairs).toHaveLength(2);
    });

    it("does not open when there is nothing to suggest", () => {
        globalStore.set(canvasListAtom, [OLD_A, NEW]);
        startScan();
        expect(gallery().view).toBe("grid");
        globalStore.set(canvasListAtom, null);
        startScan();
        expect(gallery().view).toBe("grid");
    });

    it("ticks and unticks one row", () => {
        startScan();
        toggleScanRow(dirOf("notes-v2"));
        expect(scan().ticked).toEqual(new Set([dirOf("home-fresh")]));
        toggleScanRow(dirOf("notes-v2"));
        expect(scan().ticked).toEqual(new Set([dirOf("home-fresh"), dirOf("notes-v2")]));
    });

    it("writes nothing on cancel, marks the scan done and goes back to the grid", () => {
        const kept = stubStorage();
        startScan();
        cancelScan();
        expect(link).not.toHaveBeenCalled();
        expect(kept.get(SCANNED_KEY)).toBe("1");
        expect(gallery()).toMatchObject({ view: "grid", cursor: 0 });
        expect(scan().ticked).toEqual(new Set());
    });

    it("links the ticked pairs and remembers the unticked ones, in the suggestions' order", async () => {
        const kept = stubStorage();
        link.mockResolvedValue(undefined);
        list.mockResolvedValue(PAIRS);
        startScan();
        toggleScanRow(dirOf("home-fresh"));
        await linkScan();
        expect(link.mock.calls.map((c) => c[1])).toEqual([
            { dir: dirOf("notes-v2"), replaces: "notes", notreplaces: [] },
            { dir: dirOf("home-fresh"), replaces: "", notreplaces: ["home"] },
        ]);
        expect(kept.get(SCANNED_KEY)).toBe("1");
        expect(list).toHaveBeenCalledTimes(1);
        expect(gallery()).toMatchObject({ view: "grid", cursor: 0 });
        expect(scan()).toEqual({ pairs: [], ticked: new Set(), linking: false });
        expect(toast).not.toHaveBeenCalled();
    });

    it("reports a failed write and still writes the rest", async () => {
        const kept = stubStorage();
        link.mockRejectedValueOnce(new Error("notes is not a canvas here")).mockResolvedValue(undefined);
        list.mockResolvedValue(PAIRS);
        startScan();
        await linkScan();
        expect(link).toHaveBeenCalledTimes(2);
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast.mock.calls[0][0]).toMatchObject({ level: "error" });
        expect(toast.mock.calls[0][0].message).toContain("notes is not a canvas here");
        expect(kept.get(SCANNED_KEY)).toBe("1");
        expect(gallery().view).toBe("grid");
    });

    it("takes no second Link and no tick while the writes are under way", async () => {
        let release: () => void = () => {};
        link.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
        list.mockResolvedValue(PAIRS);
        startScan();
        const first = linkScan();
        expect(scan().linking).toBe(true);
        toggleScanRow(dirOf("notes-v2"));
        await linkScan();
        expect(scan().ticked).toEqual(new Set([dirOf("home-fresh"), dirOf("notes-v2")]));
        expect(link).toHaveBeenCalledTimes(1);
        link.mockResolvedValue(undefined);
        release();
        await first;
        expect(link).toHaveBeenCalledTimes(2);
        expect(gallery().view).toBe("grid");
    });
});

describe("the link picker", () => {
    it("opens empty, keeps what is typed, and closes", () => {
        openLinkPicker();
        expect(picker()).toEqual({ open: true, query: "" });
        setLinkPickerQuery("board");
        expect(picker()).toEqual({ open: true, query: "board" });
        expect(closeLinkPicker()).toBe(true);
        expect(picker()).toEqual({ open: false, query: "" });
    });

    it("says whether there was a picker to close, so Escape knows what it closed", () => {
        expect(closeLinkPicker()).toBe(false);
    });

    it("is gone when a canvas opens or closes, so the next one starts without it", () => {
        openLinkPicker();
        openCanvas(dirOf("new"), 0);
        expect(picker().open).toBe(false);
        openLinkPicker();
        setLinkPickerQuery("x");
        closeCanvas();
        expect(picker()).toEqual({ open: false, query: "" });
    });
});
