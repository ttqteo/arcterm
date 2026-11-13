// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ EffortPinCommand: vi.fn(), EffortMutateCommand: vi.fn(), EffortGetCommand: vi.fn() }));
const pushToast = vi.hoisted(() => vi.fn());
const loadBriefing = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("./briefingstore", async () => {
    const { atom } = await import("jotai");
    return {
        loadBriefingAsync: () => loadBriefing(),
        stateRpcTimeoutMs: 1000,
        briefingStateAtom: atom({ snapshot: null, loading: false, error: null }),
    };
});

import { globalStore } from "@/app/store/jotaiStore";
import { briefingStateAtom } from "./briefingstore";
import {
    detailOps,
    dropProposed,
    effortChunkRows,
    effortDetailAtom,
    effortDetailIsFresh,
    moveChunk,
    removeChunks,
    renameChunk,
    togglePin,
} from "./effortstore";

const effort = {
    oid: "abc",
    version: 3,
    title: "Scenario gate clearance",
    chunks: [
        { label: "P1", status: "done", notes: [{ ts: 1, text: "marked done" }] },
        {
            label: "P3",
            status: "active",
            notes: [
                { ts: 3, text: "resolver seeded" },
                { ts: 2, text: "dry-run pending" },
            ],
        },
        { label: "P5", status: "blocked", notes: [{ ts: 1, text: "blocked on substrate" }] },
    ],
} as unknown as Effort;

describe("effortChunkRows", () => {
    it("derives latest note per chunk and full trails", () => {
        const rows = effortChunkRows(effort);
        expect(rows[0].latestNote).toBe("marked done");
        expect(rows[1].latestNote).toBe("resolver seeded");
        expect(rows[1].trail).toHaveLength(2);
        expect(rows[2].tone).toBe("blocked");
    });

    it("carries a chunk's stage and work refs, empty when it has none", () => {
        const rows = effortChunkRows({
            chunks: [
                { label: "A", status: "active", stage: "S1", workrefs: [{ oref: "run:r1" }] },
                { label: "B", status: "pending" },
            ],
        } as unknown as Effort);
        expect(rows.map((r) => [r.stage, r.workrefs])).toStrictEqual([
            ["S1", [{ oref: "run:r1" }]],
            ["", []],
        ]);
    });

    it("has no latest note for a chunk with no notes", () => {
        const [row] = effortChunkRows({ chunks: [{ label: "A", status: "pending" }] } as unknown as Effort);
        expect([row.latestNote, row.trail]).toStrictEqual([undefined, []]);
    });

    // an effort created with no chunks serializes its nil Go slice as null, and expanding it in the Brief
    // threw during render, which took the whole cockpit down
    it("reads an effort whose chunks came over the wire as null as having none", () => {
        expect(effortChunkRows({ ...effort, chunks: null } as unknown as Effort)).toEqual([]);
    });
});

// The cache used to be fetch-once, so an effort ticked by `wsh effort` or by an agent left the rendered
// rows behind the header count that the briefing keeps fresh. The briefing's updatedts is the tie-break.
describe("effortDetailIsFresh", () => {
    const cached = { updatedts: 100 } as Effort;

    it("is stale when the briefing reports the effort newer than the cached copy", () => {
        expect(effortDetailIsFresh(cached, 101)).toBe(false);
    });

    it("is fresh at or ahead of the reported timestamp, so a steady briefing costs no refetch", () => {
        expect(effortDetailIsFresh(cached, 100)).toBe(true);
        expect(effortDetailIsFresh(cached, 99)).toBe(true);
    });

    it("is never fresh with nothing cached, whatever the caller knows", () => {
        expect(effortDetailIsFresh(undefined, 100)).toBe(false);
        expect(effortDetailIsFresh(undefined, undefined)).toBe(false);
    });

    // callers with no summary to hand (the expand path) keep the old fetch-once behaviour rather than
    // refetching on every render
    it("trusts any cached copy when no timestamp is offered", () => {
        expect(effortDetailIsFresh(cached, undefined)).toBe(true);
    });
});

describe("detailOps", () => {
    const cur = { title: "T", project: "p", ticket: "", parent: "" };
    it("sends only what changed", () => {
        expect(detailOps(cur, { ...cur, title: " New " })).toEqual([{ op: "rename", title: "New" }]);
        expect(detailOps(cur, cur)).toEqual([]);
    });
    it("trims what it sends for every text field", () => {
        expect(detailOps(cur, { ...cur, project: " q ", ticket: " K-1 " })).toEqual([
            { op: "setProject", project: "q" },
            { op: "setTicket", ticket: "K-1" },
        ]);
    });
    it("reads a field that differs only by surrounding whitespace as unchanged, on either side", () => {
        const padded = { title: " T ", project: " p ", ticket: " k ", parent: "" };
        const trimmed = { title: "T", project: "p", ticket: "k", parent: "" };
        expect(detailOps(padded, trimmed)).toEqual([]);
        expect(detailOps(trimmed, padded)).toEqual([]);
    });
    it("clears with empty strings and strips the effort: prefix from a parent", () => {
        expect(detailOps(cur, { ...cur, project: "", parent: "effort:abc" })).toEqual([
            { op: "setProject", project: "" },
            { op: "link", parentoid: "abc" },
        ]);
    });
});

describe("togglePin", () => {
    const setSummaries = (efforts: Partial<EffortSummary>[]) =>
        globalStore.set(briefingStateAtom as never, {
            snapshot: { state: { efforts, sources: {} }, queryStartedAt: 0, actualCursor: 0, complete: true },
            loading: false,
            error: null,
        });

    beforeEach(() => {
        rpc.EffortPinCommand.mockReset();
        pushToast.mockReset();
        loadBriefing.mockClear();
        globalStore.set(effortDetailAtom, new Map());
        setSummaries([
            { oref: "effort:new", title: "New plan", pinnedts: 0 },
            { oref: "effort:on", title: "Pinned plan", pinnedts: 500 },
        ]);
    });

    it("pins an unpinned initiative, reloads the briefing, and says nothing", async () => {
        rpc.EffortPinCommand.mockResolvedValue({ pinned: true });
        await togglePin("effort:new");
        expect(rpc.EffortPinCommand).toHaveBeenCalledTimes(1);
        expect(rpc.EffortPinCommand.mock.calls[0][1]).toEqual({ effortoid: "new", pin: true });
        expect(loadBriefing).toHaveBeenCalled();
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("unpins a pinned one", async () => {
        rpc.EffortPinCommand.mockResolvedValue({ pinned: false });
        await togglePin("effort:on");
        expect(rpc.EffortPinCommand.mock.calls[0][1]).toEqual({ effortoid: "on", pin: false });
    });

    it("at the cap pushes one toast whose action re-calls with replaceoldest", async () => {
        rpc.EffortPinCommand.mockResolvedValueOnce({
            pinned: false,
            capreached: true,
            oldest: { oid: "old", title: "Oldest plan" },
        });
        await togglePin("effort:new");
        expect(pushToast).toHaveBeenCalledTimes(1);
        const toast = pushToast.mock.calls[0][0];
        expect(toast.title).toBe("6 initiatives are pinned");
        expect(toast.action.label).toBe("Unpin Oldest plan");
        expect(loadBriefing).not.toHaveBeenCalled();

        rpc.EffortPinCommand.mockResolvedValueOnce({ pinned: true });
        toast.action.run();
        await vi.waitFor(() => expect(rpc.EffortPinCommand).toHaveBeenCalledTimes(2));
        expect(rpc.EffortPinCommand.mock.calls[1][1]).toEqual({ effortoid: "new", pin: true, replaceoldest: true });
        await vi.waitFor(() => expect(loadBriefing).toHaveBeenCalled());
        expect(pushToast).toHaveBeenCalledTimes(1);
    });

    it("an RPC failure pushes an error toast instead of throwing", async () => {
        rpc.EffortPinCommand.mockRejectedValue(new Error("store is down"));
        await expect(togglePin("effort:new")).resolves.toBeUndefined();
        expect(pushToast).toHaveBeenCalledTimes(1);
        expect(pushToast.mock.calls[0][0]).toMatchObject({ level: "error", message: "store is down" });
    });

    it("keeps the cached detail's pin in step, since a pin leaves updatedts alone", async () => {
        globalStore.set(effortDetailAtom, new Map([["effort:on", { oid: "on", pinnedts: 500 } as Effort]]));
        rpc.EffortPinCommand.mockResolvedValue({ pinned: false });
        await togglePin("effort:on");
        expect(globalStore.get(effortDetailAtom).get("effort:on").pinnedts).toBe(0);
    });
});

describe("chunk writes resolve their ref when they run", () => {
    // a mirror of the server's chunk ref: all digits is a 1-based position, anything else a label
    const find = (e: Effort, ref: string) =>
        /^[0-9]+$/.test(ref) ? Number(ref) - 1 : e.chunks.findIndex((c) => c.label === ref);
    let sent: EffortOp[] = [];
    const server = (e: Effort) =>
        rpc.EffortMutateCommand.mockImplementation(async (_c: unknown, data: { ops: EffortOp[] }) => {
            for (const op of data.ops) {
                sent.push(op);
                const i = find(e, op.chunk!);
                if (op.op === "removeChunk") {
                    e.chunks.splice(i, 1);
                } else if (op.op === "moveChunk") {
                    const [c] = e.chunks.splice(i, 1);
                    e.chunks.splice(op.at! - 1, 0, c);
                } else if (op.op === "renameChunk") {
                    e.chunks[i].label = op.label!;
                }
            }
            return { effort: structuredClone(e) };
        });
    const plan = (oid: string, labels: string[]) =>
        ({ oid, chunks: labels.map((label) => ({ label, status: "pending" })) }) as unknown as Effort;
    const rows = (e: Effort) => e.chunks.map((c) => ({ label: c.label, stage: "" }));
    const cached = (oref: string, e: Effort) =>
        globalStore.set(effortDetailAtom, new Map([[oref, structuredClone(e)]]));

    beforeEach(() => {
        rpc.EffortMutateCommand.mockReset();
        rpc.EffortGetCommand.mockReset();
        sent = [];
    });

    it("two queued deletes of all-digit chunks remove those chunks, not what moved into their place", async () => {
        const e = plan("d", ["1", "2", "3"]);
        server(e);
        cached("effort:d", e);
        const captured = rows(e);
        await Promise.all([removeChunks("effort:d", captured, ["1"]), removeChunks("effort:d", captured, ["2"])]);
        expect(e.chunks.map((c) => c.label)).toEqual(["3"]);
    });

    it("two queued drops of proposed chunks do the same", async () => {
        const e = plan("p", ["1", "2", "3"]);
        server(e);
        cached("effort:p", e);
        const captured = rows(e);
        await Promise.all([dropProposed("effort:p", captured, ["1"]), dropProposed("effort:p", captured, ["2"])]);
        expect(e.chunks.map((c) => c.label)).toEqual(["3"]);
    });

    it("a batch removes the highest position first, as the live plan counts it", async () => {
        const e = plan("b", ["x", "1", "2", "y"]);
        server(e);
        cached("effort:b", e);
        await removeChunks("effort:b", rows(e), ["1", "2"]);
        expect(e.chunks.map((c) => c.label)).toEqual(["x", "y"]);
        expect(sent.map((o) => o.chunk)).toEqual(["3", "2"]);
    });

    it("an undo that moves an all-digit chunk back reads the plan as it is now, not as it was drawn", async () => {
        const e = plan("m", ["1", "2", "3"]);
        server(e);
        cached("effort:m", e);
        const drawn = rows(e);
        await removeChunks("effort:m", drawn, ["1"]);
        await moveChunk("effort:m", drawn, "3", 1);
        expect(e.chunks.map((c) => c.label)).toEqual(["3", "2"]);
    });

    it("a rename of an all-digit chunk is sent as its live position", async () => {
        const e = plan("r", ["1", "2", "3"]);
        server(e);
        cached("effort:r", e);
        const drawn = rows(e);
        await removeChunks("effort:r", drawn, ["1"]);
        await renameChunk("effort:r", drawn, "3", "done");
        expect(e.chunks.map((c) => c.label)).toEqual(["2", "done"]);
    });

    it("reads the plan once when this client has none, and sends a plain label without reading", async () => {
        const e = plan("s", ["a", "b", "2"]);
        server(e);
        rpc.EffortGetCommand.mockResolvedValue({ effort: structuredClone(e) });
        globalStore.set(effortDetailAtom, new Map());
        await removeChunks("effort:s", [], ["2"]);
        expect(rpc.EffortGetCommand).toHaveBeenCalledTimes(1);
        expect(e.chunks.map((c) => c.label)).toEqual(["a", "b"]);

        const f = plan("f", ["P1", "P2"]);
        server(f);
        globalStore.set(effortDetailAtom, new Map());
        rpc.EffortGetCommand.mockClear();
        await renameChunk("effort:f", rows(f), "P2", "P2b");
        expect(rpc.EffortGetCommand).not.toHaveBeenCalled();
        expect(f.chunks.map((c) => c.label)).toEqual(["P1", "P2b"]);
    });

    it("falls back to the plan the caller drew when even the read fails", async () => {
        const e = plan("g", ["1", "2", "3"]);
        server(e);
        rpc.EffortGetCommand.mockRejectedValue(new Error("offline"));
        globalStore.set(effortDetailAtom, new Map());
        await removeChunks("effort:g", rows(e), ["3"]);
        expect(e.chunks.map((c) => c.label)).toEqual(["1", "2"]);
    });

    it("a write that fails does not block the next one on that initiative", async () => {
        const e = plan("q", ["1", "2", "3"]);
        server(e);
        cached("effort:q", e);
        rpc.EffortMutateCommand.mockRejectedValueOnce(new Error("store is down"));
        const drawn = rows(e);
        const first = removeChunks("effort:q", drawn, ["1"]);
        const second = removeChunks("effort:q", drawn, ["2"]);
        await expect(first).rejects.toThrow("store is down");
        await second;
        expect(e.chunks.map((c) => c.label)).toEqual(["1", "3"]);
    });

    it("writes on different initiatives do not wait for each other", async () => {
        const a = plan("a", ["1", "2"]);
        const b = plan("b2", ["1", "2"]);
        cached("effort:a", a);
        cached("effort:b2", b);
        let releaseA: () => void = () => {};
        rpc.EffortMutateCommand.mockImplementation(
            async (_c: unknown, data: { effortoid: string; ops: EffortOp[] }) => {
                if (data.effortoid === "a") {
                    await new Promise<void>((r) => (releaseA = r));
                }
                return { effort: data.effortoid === "a" ? a : b };
            }
        );
        const slow = removeChunks("effort:a", rows(a), ["1"]);
        await removeChunks("effort:b2", rows(b), ["1"]);
        releaseA();
        await slow;
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(2);
    });
});
