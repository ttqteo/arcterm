// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ EffortGetCommand: vi.fn() }));
const store = vi.hoisted(() => ({ createIdea: vi.fn(), mutateEffortOps: vi.fn() }));

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/view/jarvis/briefingstore", () => ({ stateRpcTimeoutMs: 1000 }));
vi.mock("@/app/view/jarvis/effortstore", () => store);

import { MAX_CHUNK_LABEL } from "./chatinitiative";
import { laterBatch, moveLaterChunk, moveOps, saveLaterTo } from "./savelater";

const FROM = { agentId: "tab1", name: "Fixer", project: "arcterm", conversation: "conv-1" };
const note = (text: string) => `From agent "Fixer" (agent:tab1), 2026-11-27\n\n> ${text}`;

describe("laterBatch", () => {
    it("is one later addChunk per item, in order, each carrying the agent's session and conversation", () => {
        const ops = laterBatch(
            [],
            [
                { label: "push DEV", note: note("push DEV") },
                { label: "drop it", note: "n2" },
            ],
            FROM
        );
        expect(ops).toEqual([
            {
                op: "addChunk",
                label: "push DEV",
                later: true,
                note: note("push DEV"),
                session: "agent:tab1",
                conversation: "conv-1",
            },
            {
                op: "addChunk",
                label: "drop it",
                later: true,
                note: "n2",
                session: "agent:tab1",
                conversation: "conv-1",
            },
        ]);
    });

    it("leaves the conversation off the op when the agent has none", () => {
        const [op] = laterBatch([], [{ label: "a", note: "n" }], { agentId: "tab1", name: "Fixer" });
        expect(op).toEqual({ op: "addChunk", label: "a", later: true, note: "n", session: "agent:tab1" });
        expect("conversation" in op).toBe(false);
    });

    it("numbers a label the target already holds", () => {
        const ops = laterBatch(
            ["a", "b", "b (2)"],
            [
                { label: "a", note: "n" },
                { label: "b", note: "n" },
            ],
            FROM
        );
        expect(ops.map((o) => o.label)).toEqual(["a (2)", "b (3)"]);
    });

    it("numbers a label an earlier item of the same batch took (the server checks a batch against the state before it)", () => {
        const ops = laterBatch(
            [],
            [
                { label: "x", note: "1" },
                { label: "x", note: "2" },
                { label: "x", note: "3" },
            ],
            FROM
        );
        expect(ops.map((o) => o.label)).toEqual(["x", "x (2)", "x (3)"]);
    });

    it("folds whitespace in a label and trims it", () => {
        const [op] = laterBatch([], [{ label: "  decide   which\nparser  ", note: "n" }], FROM);
        expect(op.label).toBe("decide which parser");
    });

    it("clips a label to the server's limit, with the ellipsis a cut label ends in", () => {
        const [op] = laterBatch([], [{ label: "w".repeat(MAX_CHUNK_LABEL + 50), note: "n" }], FROM);
        expect(op.label).toHaveLength(MAX_CHUNK_LABEL);
        expect(op.label!.endsWith("…")).toBe(true);
    });

    it("keeps a numbered label within the limit when the clash is on a label of full length", () => {
        const full = "w".repeat(MAX_CHUNK_LABEL);
        const ops = laterBatch(
            [full],
            [
                { label: full, note: "n" },
                { label: full, note: "n" },
            ],
            FROM
        );
        expect(ops[0].label!.length).toBeLessThanOrEqual(MAX_CHUNK_LABEL);
        expect(ops[1].label!.length).toBeLessThanOrEqual(MAX_CHUNK_LABEL);
        expect(ops[0].label).toMatch(/ \(2\)$/);
        expect(ops[1].label).toMatch(/ \(3\)$/);
        expect(new Set([full, ...ops.map((o) => o.label)]).size).toBe(3);
    });

    it("never sets a due or a position", () => {
        const [op] = laterBatch([], [{ label: "a", note: "n" }], FROM);
        expect("due" in op).toBe(false);
        expect("at" in op).toBe(false);
    });
});

describe("moveOps", () => {
    const saved = {
        label: "decide which parser takes the logs",
        status: "pending",
        later: true,
        due: "2026-12-01",
        updatedts: 9,
        notes: [
            { ts: 30, text: "marked for later", author: "you" },
            {
                ts: 10,
                text: note("decide which parser takes the logs"),
                author: "you",
                session: "agent:tab1",
                conversation: "conv-1",
            },
        ],
    };

    it("adds the chunk as later with its due and its first note's text, session and conversation", () => {
        const { add } = moveOps(saved, []);
        expect(add).toEqual([
            {
                op: "addChunk",
                label: "decide which parser takes the logs",
                later: true,
                note: note("decide which parser takes the logs"),
                session: "agent:tab1",
                conversation: "conv-1",
                due: "2026-12-01",
            },
        ]);
    });

    it("takes the first note by time, not by position", () => {
        const { add } = moveOps({ ...saved, notes: [...saved.notes].reverse() }, []);
        expect(add[0].note).toBe(note("decide which parser takes the logs"));
    });

    it("removes the chunk by its label from the first initiative", () => {
        const { remove } = moveOps(saved, ["other"]);
        expect(remove).toEqual([{ op: "removeChunk", chunk: "decide which parser takes the logs" }]);
    });

    it("numbers the label the picked initiative already holds, and still removes the original label", () => {
        const { add, remove } = moveOps(saved, [saved.label, saved.label + " (2)"]);
        expect(add[0].label).toBe(saved.label + " (3)");
        expect(remove[0].chunk).toBe(saved.label);
    });

    it("names an all-digit label with the form that is never read as a position", () => {
        const { remove } = moveOps({ ...saved, label: "42" }, []);
        expect(remove).toEqual([{ op: "removeChunk", chunk: "=42" }]);
    });

    it("moves a chunk that has no note and no due without inventing either", () => {
        const { add } = moveOps({ label: "bare", status: "pending", later: true, updatedts: 1 }, []);
        expect(add).toHaveLength(1);
        expect(add[0]).toMatchObject({ op: "addChunk", label: "bare", later: true });
        // an empty note writes no first note on the server
        expect(add[0].note ?? "").toBe("");
        for (const key of ["due", "session", "conversation"]) {
            expect(key in add[0]).toBe(false);
        }
    });

    it("moves the only chunk of an initiative: the remove names it and no guard stops the pair", () => {
        const onlyChunk = {
            label: "check where the branch stands",
            status: "pending",
            later: true,
            updatedts: 1,
            notes: [{ ts: 1, text: "n", session: "agent:tab1" }],
        };
        const effort = { chunks: [onlyChunk] };
        const { add, remove } = moveOps(effort.chunks[0], ["something else"]);
        expect(effort.chunks).toHaveLength(1);
        expect(remove).toEqual([{ op: "removeChunk", chunk: "check where the branch stands" }]);
        expect(add).toEqual([
            { op: "addChunk", label: "check where the branch stands", later: true, note: "n", session: "agent:tab1" },
        ]);
    });
});

const effortOf = (oid: string, title: string, chunks: Partial<EffortChunk>[]): Effort =>
    ({
        otype: "effort",
        oid,
        version: 1,
        title,
        status: "active",
        chunks: chunks.map((c) => ({ status: "pending", updatedts: 1, ...c })),
        createdts: 1,
        updatedts: 1,
    }) as unknown as Effort;

function serve(efforts: Effort[]) {
    rpc.EffortGetCommand.mockImplementation(async (_c: unknown, data: { effortoid: string }) => {
        const effort = efforts.find((e) => e.oid === data.effortoid);
        if (effort == null) {
            throw new Error("EC-NOT-FOUND: no such effort");
        }
        return { effort };
    });
}

beforeEach(() => {
    rpc.EffortGetCommand.mockReset();
    store.createIdea.mockReset();
    store.mutateEffortOps.mockReset();
    store.mutateEffortOps.mockResolvedValue(undefined);
});

describe("saveLaterTo an initiative", () => {
    it("writes one batch of later chunks, numbered against the labels the initiative holds now", async () => {
        serve([effortOf("e1", "Parser work", [{ label: "push DEV" }, { label: "other", later: true }])]);
        const out = await saveLaterTo(
            "effort:e1",
            [
                { label: "push DEV", note: "n1" },
                { label: "delete the backup branch", note: "n2" },
            ],
            FROM
        );
        expect(rpc.EffortGetCommand).toHaveBeenCalledWith({}, { effortoid: "e1" }, { timeout: 1000 });
        expect(store.mutateEffortOps).toHaveBeenCalledTimes(1);
        const [oref, ops] = store.mutateEffortOps.mock.calls[0];
        expect(oref).toBe("effort:e1");
        expect(ops.map((o: EffortOp) => o.label)).toEqual(["push DEV (2)", "delete the backup branch"]);
        expect(ops.every((o: EffortOp) => o.op === "addChunk" && o.later === true)).toBe(true);
        expect(out).toEqual({
            oref: "effort:e1",
            title: "Parser work",
            labels: ["push DEV (2)", "delete the backup branch"],
        });
        expect(store.createIdea).not.toHaveBeenCalled();
    });

    it("lets a failed read or write reach the caller", async () => {
        serve([]);
        await expect(saveLaterTo("effort:gone", [{ label: "a", note: "n" }], FROM)).rejects.toThrow(/no such effort/);
        expect(store.mutateEffortOps).not.toHaveBeenCalled();
        serve([effortOf("e1", "Parser work", [{ label: "x" }])]);
        store.mutateEffortOps.mockRejectedValueOnce(new Error("EC-DUPLICATE-LABEL: chunk exists"));
        await expect(saveLaterTo("effort:e1", [{ label: "a", note: "n" }], FROM)).rejects.toThrow(/DUPLICATE/);
    });

    it("refuses to save nothing, before it reads or creates anything", async () => {
        await expect(saveLaterTo("new", [], FROM)).rejects.toThrow();
        await expect(saveLaterTo("effort:e1", [], FROM)).rejects.toThrow();
        expect(rpc.EffortGetCommand).not.toHaveBeenCalled();
        expect(store.createIdea).not.toHaveBeenCalled();
    });
});

describe("saveLaterTo a new initiative", () => {
    beforeEach(() => {
        store.createIdea.mockResolvedValue("effort:fresh");
    });

    it("makes the initiative as Save as idea does, then adds the chunk to it", async () => {
        const out = await saveLaterTo(
            "new",
            [{ label: "decide which parser", note: note("decide which parser") }],
            FROM
        );
        expect(store.createIdea).toHaveBeenCalledWith("decide which parser", {
            project: "arcterm",
            note: note("decide which parser"),
            agentId: "tab1",
        });
        expect(rpc.EffortGetCommand).not.toHaveBeenCalled();
        const [oref, ops] = store.mutateEffortOps.mock.calls[0];
        expect(oref).toBe("effort:fresh");
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({
            op: "addChunk",
            label: "decide which parser",
            later: true,
            session: "agent:tab1",
        });
        expect(out).toEqual({ oref: "effort:fresh", title: "decide which parser", labels: ["decide which parser"] });
    });

    it("names the initiative by from.title when the caller has one (a card's heading)", async () => {
        const out = await saveLaterTo("new", [{ label: "a", note: "n" }], { ...FROM, title: "Left for later" });
        expect(store.createIdea.mock.calls[0][0]).toBe("Left for later");
        expect(out.title).toBe("Left for later");
    });

    it("fits the title to what a create counts, in bytes", async () => {
        await saveLaterTo("new", [{ label: "a", note: "n" }], { ...FROM, title: "ữ".repeat(120) });
        const title = store.createIdea.mock.calls[0][0] as string;
        expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(200);
        expect(title.endsWith("…")).toBe(true);
    });

    it("gives the idea one note that lists the items when there are several", async () => {
        await saveLaterTo(
            "new",
            [
                { label: "push DEV", note: note("push DEV") },
                { label: "delete the backup branch", note: note("delete the backup branch") },
            ],
            { ...FROM, title: "Left for later" }
        );
        const ideaNote = store.createIdea.mock.calls[0][1].note as string;
        expect(ideaNote).toContain('From agent "Fixer" (agent:tab1)');
        expect(ideaNote).toContain("> - push DEV");
        expect(ideaNote).toContain("> - delete the backup branch");
        const [, ops] = store.mutateEffortOps.mock.calls[0];
        expect(ops.map((o: EffortOp) => o.label)).toEqual(["push DEV", "delete the backup branch"]);
    });

    it("lets a failed add reach the caller, the idea already made", async () => {
        store.mutateEffortOps.mockRejectedValueOnce(new Error("boom"));
        await expect(saveLaterTo("new", [{ label: "a", note: "n" }], FROM)).rejects.toThrow("boom");
        expect(store.createIdea).toHaveBeenCalledTimes(1);
    });
});

describe("moveLaterChunk", () => {
    const first = () =>
        effortOf("e1", "Parser work", [
            {
                label: "decide which parser",
                later: true,
                due: "2026-12-01",
                notes: [{ ts: 5, text: "n1", session: "agent:tab1", conversation: "conv-1" }],
            },
        ]);
    const second = () => effortOf("e2", "Logging", [{ label: "decide which parser" }, { label: "ship" }]);

    it("adds the chunk to the picked initiative, then removes it from the first, and returns the picked title", async () => {
        serve([first(), second()]);
        const out = await moveLaterChunk("effort:e1", "decide which parser", "effort:e2");
        expect(out).toEqual({ title: "Logging" });
        expect(store.mutateEffortOps).toHaveBeenCalledTimes(2);
        const [addOref, addOps] = store.mutateEffortOps.mock.calls[0];
        expect(addOref).toBe("effort:e2");
        expect(addOps).toEqual([
            {
                op: "addChunk",
                label: "decide which parser (2)",
                later: true,
                note: "n1",
                session: "agent:tab1",
                conversation: "conv-1",
                due: "2026-12-01",
            },
        ]);
        const [removeOref, removeOps] = store.mutateEffortOps.mock.calls[1];
        expect(removeOref).toBe("effort:e1");
        expect(removeOps).toEqual([{ op: "removeChunk", chunk: "decide which parser" }]);
    });

    it("writes nothing when the add fails", async () => {
        serve([first(), second()]);
        store.mutateEffortOps.mockRejectedValueOnce(new Error("EC-NOT-FOUND"));
        await expect(moveLaterChunk("effort:e1", "decide which parser", "effort:e2")).rejects.toThrow("EC-NOT-FOUND");
        expect(store.mutateEffortOps).toHaveBeenCalledTimes(1);
    });

    it("names both initiatives when the remove fails after the add landed", async () => {
        serve([first(), second()]);
        store.mutateEffortOps.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("EC-LOCKED"));
        const err = await moveLaterChunk("effort:e1", "decide which parser", "effort:e2").then(
            () => null,
            (e: Error) => e
        );
        expect(err).toBeInstanceOf(Error);
        expect(err!.message).toContain("Logging");
        expect(err!.message).toContain("Parser work");
        expect(err!.message).toContain("EC-LOCKED");
    });

    it("refuses a chunk the first initiative no longer holds, and a move to where it already is", async () => {
        serve([first(), second()]);
        await expect(moveLaterChunk("effort:e1", "gone", "effort:e2")).rejects.toThrow(/gone/);
        await expect(moveLaterChunk("effort:e1", "decide which parser", "effort:e1")).rejects.toThrow();
        expect(store.mutateEffortOps).not.toHaveBeenCalled();
    });
});
