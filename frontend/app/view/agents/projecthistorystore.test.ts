// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GetChannelRunsCommand: vi.fn(),
        GetSessionsActivityCommand: vi.fn(),
        GetChannelsCommand: vi.fn(),
        GetChannelMessagesCommand: vi.fn(),
        GetChannelRunChangesCommand: vi.fn(),
        SetChannelReadCommand: vi.fn(),
        CouncilListCommand: vi.fn(),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: { client: true } }));
vi.mock("@/app/store/wps", () => ({ waveEventSubscribeSingle: vi.fn(() => () => {}) }));
vi.mock("@/app/store/wos", async () => {
    const { atom } = await import("jotai");
    return {
        getWaveObjectAtom: () => atom(null),
        makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
        loadAndPinWaveObject: vi.fn(),
    };
});

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { channelsAtom } from "./channelsstore";
import { loadProjectRuns, loadSessionsWindow, MAX_PAGES, projectRunsAtom } from "./projecthistorystore";
import { HISTORY_WINDOW_MS } from "./projectoverviewmodel";
import {
    loadSessionsArchive,
    sessionsArchiveAtom,
    sessionsCursorAtom,
    sessionsErrorAtom,
} from "./sessionsarchivestore";

const runsCmd = vi.mocked(RpcApi.GetChannelRunsCommand);
const sessionsCmd = vi.mocked(RpcApi.GetSessionsActivityCommand);

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const channel = (oid: string, projectpath: string) => ({ oid, projectpath }) as Channel;
const run = (id: string) => ({ id }) as Run;
const session = (id: string, ago: number) => ({ id, runtime: "claude", lastactivets: NOW - ago }) as SessionActivity;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// serves a page per cursor ("" is the first); a page is copied, as the wire gives a fresh array on every read
const servePages = (pages: Record<string, { sessions: SessionActivity[]; nextcursor?: string }>) =>
    sessionsCmd.mockImplementation(async (_client, data) => {
        const page = pages[data.cursor ?? ""] ?? { sessions: [], nextcursor: "" };
        return { ...page, sessions: [...page.sessions] };
    });

// the cursors the walk asked for, in order, with "" for the first page
const asked = () => sessionsCmd.mock.calls.map(([, data]) => data.cursor ?? "");

beforeEach(() => {
    runsCmd.mockReset();
    sessionsCmd.mockReset();
    globalStore.set(channelsAtom, null);
    globalStore.set(sessionsArchiveAtom, null);
    globalStore.set(sessionsCursorAtom, "");
    globalStore.set(sessionsErrorAtom, false);
});

describe("loadProjectRuns", () => {
    it("reads the runs of the channels bound to the path, in any spelling of it, and no other", async () => {
        globalStore.set(channelsAtom, [
            channel("c1", "D:\\p\\"),
            channel("c2", "d:/P"),
            channel("c3", "D:/q"),
            { oid: "c4" } as Channel,
        ]);
        runsCmd.mockImplementation(async (_client, data) => ({
            runs: data.channelid === "c1" ? [run("r1")] : [run("r2"), run("r3")],
        }));

        await loadProjectRuns("D:/p");

        expect(runsCmd.mock.calls.map(([client, data]) => [client, data.channelid])).toEqual([
            [TabRpcClient, "c1"],
            [TabRpcClient, "c2"],
        ]);
        expect(globalStore.get(projectRunsAtom("D:/p"))).toEqual({
            runs: [run("r1"), run("r2"), run("r3")],
            error: null,
        });
    });

    it("holds an empty list, not null, for a project with no channel", async () => {
        globalStore.set(channelsAtom, [channel("c1", "D:/other")]);
        await loadProjectRuns("D:/none");
        expect(runsCmd).not.toHaveBeenCalled();
        expect(globalStore.get(projectRunsAtom("D:/none"))).toEqual({ runs: [], error: null });
    });

    it("keeps the runs read before when a later read fails, and says why", async () => {
        globalStore.set(channelsAtom, [channel("c1", "D:/keep")]);
        runsCmd.mockResolvedValueOnce({ runs: [run("r1")] });
        await loadProjectRuns("D:/keep");
        runsCmd.mockRejectedValueOnce(new Error("wavesrv gone"));
        await loadProjectRuns("D:/keep");
        expect(globalStore.get(projectRunsAtom("D:/keep"))).toEqual({ runs: [run("r1")], error: "wavesrv gone" });

        runsCmd.mockResolvedValueOnce({ runs: [run("r1"), run("r2")] });
        await loadProjectRuns("D:/keep");
        expect(globalStore.get(projectRunsAtom("D:/keep"))).toEqual({ runs: [run("r1"), run("r2")], error: null });
    });

    it("reads a first load that fails as no runs and the error", async () => {
        globalStore.set(channelsAtom, [channel("c1", "D:/first")]);
        runsCmd.mockRejectedValueOnce("plain string");
        await loadProjectRuns("D:/first");
        expect(globalStore.get(projectRunsAtom("D:/first"))).toEqual({ runs: null, error: "plain string" });
    });
});

describe("loadSessionsWindow", () => {
    it("asks the next page while the oldest session is inside the window and a cursor is left", async () => {
        servePages({
            "": { sessions: [session("a", DAY), session("b", 2 * DAY)], nextcursor: "c1" },
            c1: { sessions: [session("c", 3 * DAY), session("d", 4 * DAY)], nextcursor: "c2" },
            c2: { sessions: [session("e", 5 * DAY)], nextcursor: "" },
        });

        await loadSessionsWindow(NOW);

        expect(asked()).toEqual(["", "c1", "c2"]);
        expect(globalStore.get(sessionsArchiveAtom)?.map((s) => s.id)).toEqual(["a", "b", "c", "d", "e"]);
        expect(globalStore.get(sessionsCursorAtom)).toBe("");
    });

    it("stops when a page's oldest session is older than the window", async () => {
        servePages({
            "": { sessions: [session("a", DAY)], nextcursor: "c1" },
            c1: { sessions: [session("b", 2 * DAY), session("c", HISTORY_WINDOW_MS + 1)], nextcursor: "c2" },
            c2: { sessions: [session("d", 9 * DAY)], nextcursor: "c3" },
        });

        await loadSessionsWindow(NOW);

        expect(asked()).toEqual(["", "c1"]);
        expect(globalStore.get(sessionsCursorAtom)).toBe("c2");
    });

    it("asks no more when the first page already reaches past the window", async () => {
        servePages({ "": { sessions: [session("a", DAY), session("b", 10 * DAY)], nextcursor: "c1" } });
        await loadSessionsWindow(NOW);
        expect(asked()).toEqual([""]);
    });

    it("stops when the cursor comes back empty", async () => {
        servePages({ "": { sessions: [session("a", DAY)], nextcursor: "" } });
        await loadSessionsWindow(NOW);
        expect(asked()).toEqual([""]);
    });

    it("stops on an empty archive", async () => {
        servePages({ "": { sessions: [], nextcursor: "c1" } });
        await loadSessionsWindow(NOW);
        expect(asked()).toEqual([""]);
        expect(globalStore.get(sessionsArchiveAtom)).toEqual([]);
    });

    it("reads at most MAX_PAGES older pages, whatever the cursor says", async () => {
        const pages: Record<string, { sessions: SessionActivity[]; nextcursor: string }> = {
            "": { sessions: [session("s0", DAY)], nextcursor: "c1" },
        };
        for (let i = 1; i <= MAX_PAGES + 5; i++) {
            pages[`c${i}`] = { sessions: [session(`s${i}`, DAY + i)], nextcursor: `c${i + 1}` };
        }
        servePages(pages);

        await loadSessionsWindow(NOW);

        expect(MAX_PAGES).toBe(10);
        expect(sessionsCmd).toHaveBeenCalledTimes(1 + MAX_PAGES);
        expect(globalStore.get(sessionsArchiveAtom)).toHaveLength(1 + MAX_PAGES);
    });

    it("stops when an older page fails, rather than asking for it again", async () => {
        sessionsCmd.mockImplementation(async (_client, data) => {
            if (data.cursor) {
                throw new Error("scan failed");
            }
            return { sessions: [session("a", DAY)], nextcursor: "c1" };
        });

        await loadSessionsWindow(NOW);

        expect(asked()).toEqual(["", "c1"]);
        expect(globalStore.get(sessionsCursorAtom)).toBe("c1");
    });

    describe("a scan already under way", () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        // a scan another reader started: it holds the first read open until the test lets it land
        const scanInFlight = (load: () => Promise<void>) => {
            let land: () => void = () => {};
            const gate = new Promise<void>((resolve) => (land = resolve));
            const first = sessionsCmd.getMockImplementation()!;
            sessionsCmd.mockImplementationOnce(async (client, data, opts) => {
                await gate;
                return first(client, data, opts);
            });
            return { scan: load(), land };
        };

        it("waits for it to land, then pages from what it read", async () => {
            servePages({
                "": { sessions: [session("a", DAY)], nextcursor: "c1" },
                c1: { sessions: [session("b", 2 * DAY), session("c", 9 * DAY)], nextcursor: "c2" },
            });
            const { scan, land } = scanInFlight(loadSessionsArchive);

            let done = false;
            const walk = loadSessionsWindow(NOW).then(() => (done = true));
            await settle();
            // its own read was dropped: nothing is loaded, so it has nothing to page over yet
            expect(done).toBe(false);
            expect(globalStore.get(sessionsArchiveAtom)).toBeNull();
            expect(sessionsCmd).toHaveBeenCalledTimes(1);

            land();
            await Promise.all([scan, walk]);
            await settle();

            expect(asked()).toContain("c1");
            expect(globalStore.get(sessionsArchiveAtom)?.map((s) => s.id)).toEqual(["a", "b", "c"]);
        });

        it("waits for it over an archive that is already loaded, which the scan will replace", async () => {
            // newer than anything the scan will list, so the merge drops it
            servePages({ "": { sessions: [session("old", 0)], nextcursor: "" } });
            await loadSessionsArchive();
            sessionsCmd.mockClear();

            servePages({
                "": { sessions: [session("new", DAY)], nextcursor: "c1" },
                c1: { sessions: [session("older", 9 * DAY)], nextcursor: "" },
            });
            const { scan, land } = scanInFlight(loadSessionsArchive);

            const walk = loadSessionsWindow(NOW);
            await settle();
            expect(asked()).toEqual([""]);

            land();
            await Promise.all([scan, walk]);
            await settle();

            expect(asked()).toContain("c1");
            expect(globalStore.get(sessionsArchiveAtom)?.map((s) => s.id)).toEqual(["new", "older"]);
        });

        it("gives up waiting after a bound, and pages nothing over an archive that never loaded", async () => {
            servePages({ "": { sessions: [session("a", DAY)], nextcursor: "c1" } });
            vi.useFakeTimers();
            const { scan, land } = scanInFlight(loadSessionsArchive);

            let done = false;
            const walk = loadSessionsWindow(NOW).then(() => (done = true));
            await vi.advanceTimersByTimeAsync(5_000);
            expect(done).toBe(false);
            await vi.advanceTimersByTimeAsync(60_000);
            await walk;
            expect(done).toBe(true);
            expect(sessionsCmd).toHaveBeenCalledTimes(1);
            expect(globalStore.get(sessionsArchiveAtom)).toBeNull();

            // let the held scan land so a later test finds the store idle
            vi.useRealTimers();
            land();
            await scan;
            await settle();
        });
    });
});
