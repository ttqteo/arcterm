// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        NoteListCommand: vi.fn(),
        NoteAddCommand: vi.fn(),
        NoteUpdateCommand: vi.fn(),
        NoteDeleteCommand: vi.fn(),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { draftOf, newDraft } from "./palette-notes";
import { deletePaletteNote, loadPaletteNotes, paletteNotesAtom, saveNoteDraft } from "./palette-notesstore";

const n = (id: string, title = id): UserNote => ({ id, title, day: "2026-10-08" });

beforeEach(() => {
    vi.resetAllMocks();
    globalStore.set(paletteNotesAtom, null);
});

describe("loadPaletteNotes", () => {
    it("sets the atom from the list call", async () => {
        vi.mocked(RpcApi.NoteListCommand).mockResolvedValue([n("a")]);
        await loadPaletteNotes();
        expect(globalStore.get(paletteNotesAtom)).toEqual([n("a")]);
    });
    it("rejects with the list's error and leaves the atom as it was", async () => {
        globalStore.set(paletteNotesAtom, [n("old")]);
        const err = new Error("list down");
        vi.mocked(RpcApi.NoteListCommand).mockRejectedValue(err);
        await expect(loadPaletteNotes()).rejects.toBe(err);
        expect(globalStore.get(paletteNotesAtom)).toEqual([n("old")]);
    });
});

describe("saveNoteDraft", () => {
    it("adds a draft with no id, reloads, and resolves the new id", async () => {
        vi.mocked(RpcApi.NoteAddCommand).mockResolvedValue(n("new"));
        vi.mocked(RpcApi.NoteListCommand).mockResolvedValue([n("new")]);
        await expect(saveNoteDraft({ ...newDraft("T"), body: "b" })).resolves.toBe("new");
        expect(RpcApi.NoteAddCommand).toHaveBeenCalledWith({}, { title: "T", body: "b" });
        expect(globalStore.get(paletteNotesAtom)).toEqual([n("new")]);
    });
    it("updates a draft with an id and resolves that id", async () => {
        vi.mocked(RpcApi.NoteUpdateCommand).mockResolvedValue(undefined);
        vi.mocked(RpcApi.NoteListCommand).mockResolvedValue([n("a", "T2")]);
        await expect(saveNoteDraft({ ...draftOf(n("a")), title: "T2" })).resolves.toBe("a");
        expect(RpcApi.NoteUpdateCommand).toHaveBeenCalledWith({}, { id: "a", title: "T2", body: "" });
    });
    it("reloads after a failed update and rejects with the update's error", async () => {
        const err = new Error("not found");
        vi.mocked(RpcApi.NoteUpdateCommand).mockRejectedValue(err);
        vi.mocked(RpcApi.NoteListCommand).mockResolvedValue([n("other")]);
        await expect(saveNoteDraft(draftOf(n("a")))).rejects.toBe(err);
        expect(RpcApi.NoteListCommand).toHaveBeenCalledTimes(1);
        expect(globalStore.get(paletteNotesAtom)).toEqual([n("other")]);
    });
    it("a reload that also fails does not hide the update's error", async () => {
        const err = new Error("not found");
        vi.mocked(RpcApi.NoteUpdateCommand).mockRejectedValue(err);
        vi.mocked(RpcApi.NoteListCommand).mockRejectedValue(new Error("list down"));
        await expect(saveNoteDraft(draftOf(n("a")))).rejects.toBe(err);
    });
    it("a save that landed resolves though the reload fails, so a retry cannot add it twice", async () => {
        vi.mocked(RpcApi.NoteAddCommand).mockResolvedValue(n("new"));
        vi.mocked(RpcApi.NoteListCommand).mockRejectedValue(new Error("list down"));
        await expect(saveNoteDraft(newDraft("T"))).resolves.toBe("new");
    });
});

describe("deletePaletteNote", () => {
    it("a delete that landed resolves though the reload fails", async () => {
        vi.mocked(RpcApi.NoteDeleteCommand).mockResolvedValue(undefined);
        vi.mocked(RpcApi.NoteListCommand).mockRejectedValue(new Error("list down"));
        await expect(deletePaletteNote("a")).resolves.toBeUndefined();
    });
    it("deletes and reloads", async () => {
        vi.mocked(RpcApi.NoteDeleteCommand).mockResolvedValue(undefined);
        vi.mocked(RpcApi.NoteListCommand).mockResolvedValue([]);
        await deletePaletteNote("a");
        expect(RpcApi.NoteDeleteCommand).toHaveBeenCalledWith({}, { id: "a" });
        expect(globalStore.get(paletteNotesAtom)).toEqual([]);
    });
    it("reloads after a failed delete and rejects with the delete's error", async () => {
        const err = new Error("not found");
        vi.mocked(RpcApi.NoteDeleteCommand).mockRejectedValue(err);
        vi.mocked(RpcApi.NoteListCommand).mockResolvedValue([n("b")]);
        await expect(deletePaletteNote("a")).rejects.toBe(err);
        expect(globalStore.get(paletteNotesAtom)).toEqual([n("b")]);
    });
});
