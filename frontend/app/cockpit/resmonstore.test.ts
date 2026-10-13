// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// the DEV fixture installs itself on window at import; vitest runs in node, so give it one first
vi.hoisted(() => {
    (globalThis as any).window = {};
});
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ResMonSnapshotCommand: vi.fn(),
        ResMonKillCommand: vi.fn(),
        ResMonKillChildrenCommand: vi.fn(),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { RESMON_UI_INITIAL } from "./resmon";
import {
    confirmResMon,
    dispatchResMon,
    RESMON_POLL_MS,
    resmonOpenAtom,
    resmonSnapshotAtom,
    resmonUiAtom,
    startResMonPolling,
} from "./resmonstore";

const proc = (pid: number, depth: number, name: string, tag?: string): ProcessInfo => ({
    pid,
    depth,
    name,
    tag,
    mem: 1,
    mempct: 0,
    cpu: 0,
    numthreads: 1,
});

const waveterm: ResMonGroup = {
    key: "job:14820:1",
    ownerkind: "agenttab",
    ownerid: "block-1",
    label: "waveterm",
    killable: true,
    cpu: 30,
    mem: 1,
    rows: [proc(14820, 0, "claude.exe", "agent"), proc(18244, 1, "go.exe"), proc(18311, 2, "orchestrate.test.exe")],
};

const snap = (cpu: number): ResMonSnapshotData => ({
    supported: true,
    ready: true,
    ts: cpu,
    cpu,
    mem: 1,
    totalmem: 2,
    busycpu: false,
    busymem: false,
    groups: [waveterm],
});

const fixture = () => window.__resmonFixture!;

let stop: (() => void) | null = null;

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { hidden: false });
    fixture().clear();
    // after clear, which polls once itself
    vi.resetAllMocks();
    globalStore.set(resmonSnapshotAtom, null);
});

afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("polling", () => {
    it("polls now and every RESMON_POLL_MS into the snapshot atom", async () => {
        vi.mocked(RpcApi.ResMonSnapshotCommand).mockResolvedValueOnce(snap(1)).mockResolvedValueOnce(snap(2));
        stop = startResMonPolling();
        await vi.advanceTimersByTimeAsync(0);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(1);
        await vi.advanceTimersByTimeAsync(RESMON_POLL_MS);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(2);
        expect(RpcApi.ResMonSnapshotCommand).toHaveBeenCalledWith({}, {});
    });
    it("skips a poll while the document is hidden", async () => {
        vi.stubGlobal("document", { hidden: true });
        stop = startResMonPolling();
        await vi.advanceTimersByTimeAsync(RESMON_POLL_MS * 2);
        expect(RpcApi.ResMonSnapshotCommand).not.toHaveBeenCalled();
    });
    it("keeps the last snapshot on an error and logs once per streak", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.mocked(RpcApi.ResMonSnapshotCommand)
            .mockResolvedValueOnce(snap(1))
            .mockRejectedValueOnce(new Error("down"))
            .mockRejectedValueOnce(new Error("down"))
            .mockResolvedValueOnce(snap(3))
            .mockRejectedValueOnce(new Error("down again"));
        stop = startResMonPolling();
        await vi.advanceTimersByTimeAsync(RESMON_POLL_MS * 2);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(1);
        expect(warn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(RESMON_POLL_MS * 2);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(3);
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});

describe("fixture", () => {
    it("pins the snapshot against a poll, including a pinned null", async () => {
        vi.mocked(RpcApi.ResMonSnapshotCommand).mockResolvedValue(snap(9));
        fixture().set(snap(1));
        stop = startResMonPolling();
        await vi.advanceTimersByTimeAsync(RESMON_POLL_MS * 2);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(1);
        fixture().set(null);
        await vi.advanceTimersByTimeAsync(RESMON_POLL_MS);
        expect(globalStore.get(resmonSnapshotAtom)).toBeNull();
    });
    it("opens the popover, and clear unpins, closes and resets the UI state", async () => {
        fixture().set(snap(1));
        fixture().open();
        dispatchResMon({ type: "askKill", groups: [waveterm], at: `${waveterm.key}/18311` });
        expect(globalStore.get(resmonOpenAtom)).toBe(true);
        vi.mocked(RpcApi.ResMonSnapshotCommand).mockResolvedValue(snap(9));
        fixture().clear();
        expect(globalStore.get(resmonOpenAtom)).toBe(false);
        expect(globalStore.get(resmonUiAtom)).toEqual(RESMON_UI_INITIAL);
        await vi.advanceTimersByTimeAsync(0);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(9);
    });
});

describe("confirmResMon", () => {
    it("resolves an armed outcome without the RPC, notes it and clears the confirm", async () => {
        fixture().set(snap(1));
        fixture().killOutcome({ outcome: "killed", killed: 2 });
        dispatchResMon({ type: "askKill", groups: [waveterm], at: `${waveterm.key}/18244` });
        await confirmResMon();
        expect(RpcApi.ResMonKillCommand).not.toHaveBeenCalled();
        const ui = globalStore.get(resmonUiAtom);
        expect(ui.confirm).toBeNull();
        expect(ui.notes[waveterm.key]).toEqual({ text: "Killed go.exe (18244) and 1 child process.", tone: "note" });
    });
    it("kills a row with its tree through the RPC, then reloads", async () => {
        globalStore.set(resmonSnapshotAtom, snap(1));
        vi.mocked(RpcApi.ResMonKillCommand).mockResolvedValue({ outcome: "gone", killed: 0 });
        vi.mocked(RpcApi.ResMonSnapshotCommand).mockResolvedValue(snap(2));
        dispatchResMon({ type: "askKill", groups: [waveterm], at: `${waveterm.key}/18311` });
        await confirmResMon();
        expect(RpcApi.ResMonKillCommand).toHaveBeenCalledWith({}, { ownerid: "block-1", pid: 18311, tree: true });
        expect(globalStore.get(resmonUiAtom).notes[waveterm.key].text).toBe(
            "orchestrate.test.exe (18311) had already exited."
        );
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(2);
    });
    it("kills a group's children through the RPC", async () => {
        globalStore.set(resmonSnapshotAtom, snap(1));
        vi.mocked(RpcApi.ResMonKillChildrenCommand).mockResolvedValue({ outcome: "killed", killed: 2 });
        dispatchResMon({ type: "askChildren", groups: [waveterm], at: waveterm.key });
        await confirmResMon();
        expect(RpcApi.ResMonKillChildrenCommand).toHaveBeenCalledWith({}, { ownerid: "block-1" });
        expect(globalStore.get(resmonUiAtom).notes[waveterm.key].text).toBe("Killed 2 processes.");
    });
    it("turns a rejected RPC into a failed alert", async () => {
        globalStore.set(resmonSnapshotAtom, snap(1));
        vi.mocked(RpcApi.ResMonKillCommand).mockRejectedValue(new Error("EC-TIME: timeout"));
        dispatchResMon({ type: "askKill", groups: [waveterm], at: `${waveterm.key}/18311` });
        await confirmResMon();
        expect(globalStore.get(resmonUiAtom).notes[waveterm.key]).toEqual({
            text: "Could not kill orchestrate.test.exe (18311): EC-TIME: timeout. It is still running.",
            tone: "alert",
        });
    });
    it("does nothing with no confirm pending", async () => {
        await confirmResMon();
        expect(RpcApi.ResMonKillCommand).not.toHaveBeenCalled();
        expect(RpcApi.ResMonKillChildrenCommand).not.toHaveBeenCalled();
    });
});
