// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ EffortPinCommand: vi.fn() }));
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
import { detailOps, effortChunkRows, effortDetailAtom, effortDetailIsFresh, togglePin } from "./effortstore";

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
