// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    currentReportIdAtom,
    initRadarScope,
    initRadarScopeFromNewest,
    loadReports,
    radarLoadErrorAtom,
    radarReportsAtom,
    radarScopeAtom,
} from "./radarstore";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { ListRadarReportsCommand: vi.fn() } }));
vi.mock("@/app/store/wos", () => ({
    loadAndPinWaveObject: vi.fn(async () => undefined),
    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
}));

describe("radar report loading", () => {
    beforeEach(() => {
        vi.mocked(RpcApi.ListRadarReportsCommand).mockReset();
        globalStore.set(radarScopeAtom, { name: "p", path: "/p" });
        globalStore.set(radarReportsAtom, null);
        globalStore.set(radarLoadErrorAtom, null);
        globalStore.set(currentReportIdAtom, undefined);
        vi.mocked(WOS.loadAndPinWaveObject).mockClear();
    });

    it("a failed list read is an error, and the list stays not-fetched rather than empty", async () => {
        vi.mocked(RpcApi.ListRadarReportsCommand).mockRejectedValueOnce(new Error("boom"));
        await loadReports("/p");
        expect(globalStore.get(radarReportsAtom)).toBeNull();
        expect(globalStore.get(radarLoadErrorAtom)).toContain("boom");
    });

    it("a successful read clears an earlier error", async () => {
        globalStore.set(radarLoadErrorAtom, "old");
        vi.mocked(RpcApi.ListRadarReportsCommand).mockResolvedValueOnce({ reports: [] } as any);
        await loadReports("/p");
        expect(globalStore.get(radarReportsAtom)).toEqual([]);
        expect(globalStore.get(radarLoadErrorAtom)).toBeNull();
    });

    it("no scope at all is a loaded empty list, so never-scanned is honest", async () => {
        await initRadarScope(null);
        expect(globalStore.get(radarReportsAtom)).toEqual([]);
    });

    it("a failed newest-scanned lookup is an error, not a never-scanned landing", async () => {
        globalStore.set(radarScopeAtom, null);
        vi.mocked(RpcApi.ListRadarReportsCommand).mockRejectedValueOnce(new Error("down"));
        await initRadarScopeFromNewest();
        expect(globalStore.get(radarReportsAtom)).toBeNull();
        expect(globalStore.get(radarLoadErrorAtom)).toContain("down");
    });

    it("drops a repeat load for a path already in flight, and frees the path once it settles", async () => {
        let release!: (v: any) => void;
        vi.mocked(RpcApi.ListRadarReportsCommand).mockReturnValueOnce(new Promise((res) => (release = res)) as any);
        const first = loadReports("/p");
        await loadReports("/p");
        expect(RpcApi.ListRadarReportsCommand).toHaveBeenCalledTimes(1);
        release({ reports: [] });
        await first;
        vi.mocked(RpcApi.ListRadarReportsCommand).mockResolvedValueOnce({ reports: [] } as any);
        await loadReports("/p");
        expect(RpcApi.ListRadarReportsCommand).toHaveBeenCalledTimes(2);
    });

    it("lists reports newest-first without reordering the rpc result, and selects the newest", async () => {
        const reports = [
            { oid: "mid", startedts: 20 },
            { oid: "old", startedts: 10 },
            { oid: "new", startedts: 30 },
        ];
        vi.mocked(RpcApi.ListRadarReportsCommand).mockResolvedValueOnce({ reports } as any);
        await loadReports("/p");
        expect(globalStore.get(radarReportsAtom)!.map((r) => r.oid)).toEqual(["new", "mid", "old"]);
        expect(reports.map((r) => r.oid)).toEqual(["mid", "old", "new"]);
        expect(WOS.loadAndPinWaveObject).toHaveBeenCalledWith("radarreport:new");
        expect(globalStore.get(currentReportIdAtom)).toBe("new");
    });

    it("an empty list clears the current report", async () => {
        globalStore.set(currentReportIdAtom, "stale");
        vi.mocked(RpcApi.ListRadarReportsCommand).mockResolvedValueOnce({ reports: [] } as any);
        await loadReports("/p");
        expect(globalStore.get(currentReportIdAtom)).toBeUndefined();
        expect(WOS.loadAndPinWaveObject).not.toHaveBeenCalled();
    });

    it("a failure after the scope moved on does not put an error on the new scope", async () => {
        globalStore.set(radarScopeAtom, { name: "q", path: "/q" });
        vi.mocked(RpcApi.ListRadarReportsCommand).mockRejectedValueOnce(new Error("boom"));
        await loadReports("/p");
        expect(globalStore.get(radarLoadErrorAtom)).toBeNull();
    });
});
