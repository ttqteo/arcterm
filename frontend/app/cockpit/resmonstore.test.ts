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
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import type { AgentCommand } from "./resmon";
import {
    clearResMonNote,
    killAgentCommand,
    pollResMon,
    RESMON_POLL_MS,
    RESMON_RPC_TIMEOUT_MS,
    resmonNotesAtom,
    resmonSnapshotAtom,
    resmonSupportedAtom,
    startResMonPolling,
} from "./resmonstore";

const snap = (cpu: number): ResMonSnapshotData => ({
    supported: true,
    ready: true,
    ts: cpu,
    cpu,
    mem: 1,
    totalmem: 2,
    busycpu: false,
    busymem: false,
    groups: [],
});

const gitLog: AgentCommand = { label: "git log --all -p", pid: 182128, ownerid: "block-1", cpu: 2.1, mem: 1 };

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
    it("polls now and every RESMON_POLL_MS into the snapshot atom, with a timeout on each call", async () => {
        vi.mocked(RpcApi.ResMonSnapshotCommand).mockResolvedValueOnce(snap(1)).mockResolvedValueOnce(snap(2));
        stop = startResMonPolling();
        await vi.advanceTimersByTimeAsync(0);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(1);
        await vi.advanceTimersByTimeAsync(RESMON_POLL_MS);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(2);
        expect(RpcApi.ResMonSnapshotCommand).toHaveBeenCalledWith({}, {}, { timeout: RESMON_RPC_TIMEOUT_MS });
    });
    it("skips a poll while the document is hidden, but a forced read goes through", async () => {
        vi.stubGlobal("document", { hidden: true });
        vi.mocked(RpcApi.ResMonSnapshotCommand).mockResolvedValue(snap(4));
        stop = startResMonPolling();
        await vi.advanceTimersByTimeAsync(RESMON_POLL_MS * 2);
        expect(RpcApi.ResMonSnapshotCommand).not.toHaveBeenCalled();
        await pollResMon(true);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(4);
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
    it("reads as supported only once a snapshot says so", () => {
        expect(globalStore.get(resmonSupportedAtom)).toBe(false);
        globalStore.set(resmonSnapshotAtom, { ...snap(1), supported: false });
        expect(globalStore.get(resmonSupportedAtom)).toBe(false);
        globalStore.set(resmonSnapshotAtom, snap(1));
        expect(globalStore.get(resmonSupportedAtom)).toBe(true);
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
    it("clear unpins, drops the notes and reads again", async () => {
        fixture().set(snap(1));
        globalStore.set(resmonNotesAtom, { tab: { text: "x", tone: "note" } });
        vi.mocked(RpcApi.ResMonSnapshotCommand).mockResolvedValue(snap(9));
        fixture().clear();
        expect(globalStore.get(resmonNotesAtom)).toEqual({});
        await vi.advanceTimersByTimeAsync(0);
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(9);
    });
});

describe("killAgentCommand", () => {
    it("answers an armed outcome without the RPC and notes it under the agent", async () => {
        fixture().set(snap(1));
        fixture().killOutcome({ outcome: "killed", killed: 4 });
        await killAgentCommand("tab-1", gitLog);
        expect(RpcApi.ResMonKillCommand).not.toHaveBeenCalled();
        expect(globalStore.get(resmonNotesAtom)["tab-1"]).toEqual({ text: "Killed git log --all -p.", tone: "note" });
    });
    it("kills the command with its tree through the RPC, then reads again", async () => {
        vi.mocked(RpcApi.ResMonKillCommand).mockResolvedValue({ outcome: "gone", killed: 0 });
        vi.mocked(RpcApi.ResMonSnapshotCommand).mockResolvedValue(snap(2));
        await killAgentCommand("tab-1", gitLog);
        expect(RpcApi.ResMonKillCommand).toHaveBeenCalledWith({}, { ownerid: "block-1", pid: 182128, tree: true });
        expect(globalStore.get(resmonNotesAtom)["tab-1"].text).toBe("git log --all -p had already exited.");
        expect(globalStore.get(resmonSnapshotAtom)?.cpu).toBe(2);
    });
    it("turns a rejected RPC into a failed alert, and clearing drops it", async () => {
        vi.mocked(RpcApi.ResMonKillCommand).mockRejectedValue(new Error("EC-TIME: timeout"));
        await killAgentCommand("tab-1", gitLog);
        expect(globalStore.get(resmonNotesAtom)["tab-1"]).toEqual({
            text: "Could not kill git log --all -p: EC-TIME: timeout. It is still running.",
            tone: "alert",
        });
        clearResMonNote("tab-1");
        expect(globalStore.get(resmonNotesAtom)).toEqual({});
    });
});
