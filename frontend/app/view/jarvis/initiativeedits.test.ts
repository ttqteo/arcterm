// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The plan's edits as the sheet makes them (buildTrackerEdits): every write reaches effortstore.ts with the position
// the server counts (proposed chunks included), carries its Undo, and a refusal is shown, never swallowed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
    setChunkStatus: vi.fn(async () => {}),
    setChunkLater: vi.fn(async () => {}),
    moveChunk: vi.fn(async () => {}),
    moveChunkToStage: vi.fn(async () => {}),
    addChunkAt: vi.fn(async () => {}),
    removeChunks: vi.fn(async () => {}),
    setChunkStage: vi.fn(async () => {}),
    setEffortStatus: vi.fn(async () => {}),
    unarchiveEffort: vi.fn(async () => {}),
    acceptProposed: vi.fn(async () => {}),
    deleteEffort: vi.fn(async () => {}),
}));

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./effortstore", async (importOriginal) => ({ ...(await importOriginal<object>()), ...store }));

import { globalStore } from "@/app/store/jotaiStore";
import { briefToastAtom, pendingDeleteKeysAtom } from "./briefundo";
import { buildTrackerEdits, type EditsDeps } from "./initiativeedits";

// a staged plan with a proposed chunk sitting between the real ones, as the server keeps it
const EFFORT = {
    oid: "e1",
    title: "Revamp Jarvis",
    status: "active",
    chunks: [
        { label: "Spec", status: "done", stage: "Design" },
        { label: "Board", status: "active", stage: "Design" },
        { label: "Idea from an agent", status: "proposed", stage: "Design" },
        { label: "Cards", status: "pending", stage: "Build" },
        { label: "Sheet", status: "pending", stage: "Build" },
    ],
} as unknown as Effort;

function deps(over: Partial<EditsDeps> = {}): EditsDeps & { ran: Promise<unknown>[]; failed: string[] } {
    const ran: Promise<unknown>[] = [];
    const failed: string[] = [];
    return {
        oref: "effort:e1",
        effort: EFFORT,
        pendingDeletes: new Set(),
        run: (fn) => void ran.push(fn()),
        fail: (m) => void failed.push(m),
        onRename: vi.fn(),
        onDetails: vi.fn(),
        onActivity: vi.fn(),
        onDeleted: vi.fn(),
        ran,
        failed,
        ...over,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    globalStore.set(briefToastAtom, null);
    globalStore.set(pendingDeleteKeysAtom, new Set());
});

describe("buildTrackerEdits", () => {
    it("names the initiative and lists its stages for Move to stage", () => {
        const edits = buildTrackerEdits(deps());
        expect(edits).toMatchObject({ oid: "e1", title: "Revamp Jarvis", effortStatus: "active", total: 5 });
        expect(edits.stages).toEqual(["Design", "Build"]);
    });

    it("sets a chunk's status and offers to put the old one back", () => {
        const edits = buildTrackerEdits(deps());
        edits.onSetStatus("Cards", "active");
        expect(store.setChunkStatus).toHaveBeenCalledWith("effort:e1", "Cards", "active");
        const toast = globalStore.get(briefToastAtom);
        expect(toast?.text).toBe("Marked “Cards” active");
        toast?.undo?.();
        expect(store.setChunkStatus).toHaveBeenLastCalledWith("effort:e1", "Cards", "pending");
    });

    it("moves a chunk down past the proposed one to the place the server counts", () => {
        const edits = buildTrackerEdits(deps());
        // Board is drawn 2nd and moves to the drawn 3rd place (Cards), which the server holds 4th
        expect(edits.canMove("Board", "up")).toBe(true);
        expect(edits.canMove("Board", "down")).toBe(false); // the last of its stage: a stage move is Move to stage
        edits.onMoveChunk("Spec", "down");
        expect(store.moveChunk).toHaveBeenCalledWith("effort:e1", expect.any(Array), "Spec", 2);
        globalStore.get(briefToastAtom)?.undo?.();
        expect(store.moveChunk).toHaveBeenLastCalledWith("effort:e1", expect.any(Array), "Spec", 1);
    });

    it("adds a chunk at the end of its stage run, after the proposed one", () => {
        const edits = buildTrackerEdits(deps());
        edits.onAddChunk("Polish", "Build", 1);
        expect(store.addChunkAt).toHaveBeenCalledWith("effort:e1", "Polish", "Build", 6);
        edits.onAddChunk("Board v2", "Design", 0);
        // Design's run ends at Board (2nd on the server), so the new chunk goes 3rd
        expect(store.addChunkAt).toHaveBeenLastCalledWith("effort:e1", "Board v2", "Design", 3);
    });

    it("refuses to delete the last chunks left, and says why", () => {
        const pendingDeletes = new Set(
            ["Spec", "Board", "Idea from an agent", "Cards"].map((l) => "chunk:effort:e1:" + l)
        );
        const d = deps({ pendingDeletes });
        const edits = buildTrackerEdits(d);
        // the sheet draws no Design run while its chunks wait out their delete, so Build is its run 0
        edits.onDeleteStage(0);
        expect(d.failed).toEqual(["An initiative keeps at least one chunk."]);
        expect(globalStore.get(pendingDeleteKeysAtom).size).toBe(0);
    });

    it("counts stage runs as the sheet draws them, without the chunks waiting out a delete", () => {
        const pendingDeletes = new Set(["Spec", "Board"].map((l) => "chunk:effort:e1:" + l));
        const edits = buildTrackerEdits(deps({ pendingDeletes }));
        edits.onRenameStage(0, "Ship");
        expect(store.setChunkStage).toHaveBeenCalledWith("effort:e1", ["Cards", "Sheet"], "Ship");
        edits.onDeleteStage(0);
        expect(globalStore.get(pendingDeleteKeysAtom).has("chunk:effort:e1:Cards")).toBe(true);
        expect(globalStore.get(pendingDeleteKeysAtom).has("chunk:effort:e1:Sheet")).toBe(true);
        globalStore.get(briefToastAtom)?.undo?.();
    });

    it("waits out the undo window before deleting a chunk", () => {
        const edits = buildTrackerEdits(deps());
        edits.onDeleteChunk("Sheet");
        expect(globalStore.get(pendingDeleteKeysAtom).has("chunk:effort:e1:Sheet")).toBe(true);
        expect(store.removeChunks).not.toHaveBeenCalled();
        globalStore.get(briefToastAtom)?.undo?.();
        expect(globalStore.get(pendingDeleteKeysAtom).has("chunk:effort:e1:Sheet")).toBe(false);
    });

    it("accepts a proposed chunk by its reference", () => {
        const edits = buildTrackerEdits(deps());
        edits.onAcceptProposed(["Idea from an agent"]);
        expect(store.acceptProposed).toHaveBeenCalledWith("effort:e1", ["Idea from an agent"]);
    });

    it("pauses an active initiative and resumes a paused one", () => {
        buildTrackerEdits(deps()).onTogglePause();
        expect(store.setEffortStatus).toHaveBeenCalledWith("effort:e1", "paused");
        const paused = { ...EFFORT, status: "paused" } as Effort;
        buildTrackerEdits(deps({ effort: paused })).onTogglePause();
        expect(store.setEffortStatus).toHaveBeenLastCalledWith("effort:e1", "active");
    });

    it("closes the view before the initiative's delete waits out its window", () => {
        const d = deps();
        buildTrackerEdits(d).onDelete();
        expect(d.onDeleted).toHaveBeenCalled();
        expect(globalStore.get(pendingDeleteKeysAtom).has("effort:effort:e1")).toBe(true);
        globalStore.get(briefToastAtom)?.undo?.();
    });

    // Chunks saved for later are kept off the plan the sheet draws, so every position, stage run and guard below runs over
    // the plan alone while the server's list (which holds them) still gives the numbers it counts by.
    describe("with chunks saved for later", () => {
        const LATER_EFFORT = {
            oid: "e1",
            title: "Revamp Jarvis",
            status: "active",
            chunks: [
                { label: "Saved first", status: "pending", stage: "", later: true },
                { label: "Spec", status: "done", stage: "Design" },
                { label: "Saved in Design", status: "pending", stage: "Design", later: true },
                { label: "Board", status: "active", stage: "Design" },
                { label: "Cards", status: "pending", stage: "Build" },
                { label: "Saved parked", status: "pending", stage: "Parked", later: true },
            ],
        } as unknown as Effort;
        const withLater = (over: Partial<EditsDeps> = {}) => deps({ effort: LATER_EFFORT, ...over });

        it("moves a chunk to the place the server counts, a later chunk standing ahead of the plan", () => {
            const edits = buildTrackerEdits(withLater());
            // Spec is drawn 1st and moves to the drawn 2nd place (Board), which the server holds 4th
            edits.onMoveChunk("Spec", "down");
            expect(store.moveChunk).toHaveBeenCalledWith("effort:e1", expect.any(Array), "Spec", 4);
            globalStore.get(briefToastAtom)?.undo?.();
            expect(store.moveChunk).toHaveBeenLastCalledWith("effort:e1", expect.any(Array), "Spec", 2);
        });

        it("offers no move for a later chunk, which is not in the plan", () => {
            const edits = buildTrackerEdits(withLater());
            expect(edits.canMove("Saved first", "up")).toBe(false);
            expect(edits.canMove("Saved in Design", "down")).toBe(false);
            edits.onMoveChunk("Saved in Design", "down");
            expect(store.moveChunk).not.toHaveBeenCalled();
        });

        it("keeps a later chunk of the same stage out of that stage's run", () => {
            const edits = buildTrackerEdits(withLater());
            edits.onRenameStage(0, "Specs");
            expect(store.setChunkStage).toHaveBeenCalledWith("effort:e1", ["Spec", "Board"], "Specs");
            // a stage only a later chunk carries is not one to move a plan chunk into
            expect(edits.stages).toEqual(["Design", "Build"]);
        });

        it("adds a chunk at the end of its run, counted past the later chunk inside it", () => {
            const edits = buildTrackerEdits(withLater());
            edits.onAddChunk("Board v2", "Design", 0);
            // Design's run ends at Board, the 4th chunk on the server, so the new chunk goes 5th
            expect(store.addChunkAt).toHaveBeenCalledWith("effort:e1", "Board v2", "Design", 5);
        });

        it("marks a chunk not later and offers to mark it later again", () => {
            const edits = buildTrackerEdits(withLater());
            edits.onSetLater("Saved first", false);
            expect(store.setChunkLater).toHaveBeenCalledWith("effort:e1", "Saved first", false);
            const toast = globalStore.get(briefToastAtom);
            expect(toast?.text).toBe("Moved “Saved first” into the plan");
            toast?.undo?.();
            expect(store.setChunkLater).toHaveBeenLastCalledWith("effort:e1", "Saved first", true);
        });

        it("deletes the only chunk of an initiative when it is later", () => {
            const only = { ...LATER_EFFORT, chunks: [LATER_EFFORT.chunks![0]] } as Effort;
            const d = withLater({ effort: only });
            buildTrackerEdits(d).onDeleteChunk("Saved first");
            expect(d.failed).toEqual([]);
            expect(globalStore.get(pendingDeleteKeysAtom).has("chunk:effort:e1:Saved first")).toBe(true);
            globalStore.get(briefToastAtom)?.undo?.();
        });

        it("still keeps a plan chunk, the later chunks left behind not counting", () => {
            const d = withLater({
                pendingDeletes: new Set(["Spec", "Board"].map((l) => "chunk:effort:e1:" + l)),
            });
            buildTrackerEdits(d).onDeleteChunk("Cards");
            expect(d.failed).toEqual(["An initiative keeps at least one chunk."]);
            expect(globalStore.get(pendingDeleteKeysAtom).has("chunk:effort:e1:Cards")).toBe(false);
        });
    });

    it("hands rename, details and activity to the view", () => {
        const d = deps();
        const edits = buildTrackerEdits(d);
        edits.onRename("Revamp Jarvis");
        edits.onDetails();
        expect(d.onRename).toHaveBeenCalledWith("Revamp Jarvis");
        expect(d.onDetails).toHaveBeenCalled();
    });
});
