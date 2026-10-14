// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ListCanvasesCommand: vi.fn(),
        CleanStorageCommand: vi.fn(),
        CanvasServeCommand: vi.fn(),
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
    canvasGalleryAtom,
    canvasListAtom,
    cleanupAtom,
    moveSelectionToTrash,
    startCleanup,
    toggleCleanupCard,
    untickAll,
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
    };
}

// two long unchanged, one new
const OLD_A = canvas("old-a", NOW - 40 * DAY);
const OLD_B = canvas("old-b", NOW - 50 * DAY);
const NEW = canvas("new", NOW - DAY);

const list = vi.mocked(RpcApi.ListCanvasesCommand);
const clean = vi.mocked(RpcApi.CleanStorageCommand);
const toast = vi.mocked(pushToast);

const gallery = () => globalStore.get(canvasGalleryAtom);
const cleanup = () => globalStore.get(cleanupAtom);

beforeEach(() => {
    globalStore.set(canvasGalleryAtom, { view: "grid", dir: null, board: 0, query: "", cursor: 0 });
    globalStore.set(canvasListAtom, [OLD_A, OLD_B, NEW]);
    cancelCleanup();
    list.mockReset();
    clean.mockReset();
    toast.mockReset();
});

afterEach(() => {
    cancelCleanup();
    globalStore.set(canvasListAtom, null);
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
            title: "Canvases",
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
            title: "Canvases",
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
