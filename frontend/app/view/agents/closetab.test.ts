// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// what closeTabLogged calls out to: the close itself, the log, and wavesrv's PairCloseWorker. The pair store's other
// wavesrv reads are never made (a test seeds its mock lists), and the roster is a plain atom standing for devmock.ts's,
// whose real graph leads back to this file.
const mocks = vi.hoisted(() => ({
    closeTab: vi.fn(),
    sendLog: vi.fn(),
    closeWorker: vi.fn(),
}));

vi.mock("@/app/store/global", () => ({ getApi: () => ({ sendLog: mocks.sendLog }) }));
vi.mock("@/app/store/services", () => ({ WorkspaceService: { CloseTab: mocks.closeTab } }));
vi.mock("@/app/store/wps", () => ({ waveEventSubscribeSingle: () => () => {} }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { PairCloseWorkerCommand: mocks.closeWorker } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./devmock", async () => {
    const { atom } = await import("jotai");
    return { devRosterAtom: atom<unknown[]>([]) };
});

import { closeTabLogged } from "./closetab";
import { devRosterAtom } from "./devmock";
import { devMockPairsAtom, devMockRestingAtom } from "./pairstore";

const WS = "ws-1";
const WORKER = "61483cd6-5c1e-4b2a-9d3f-1a2b3c4d5e6f";
const JUDGE = "4c6ba858-0d7e-4f31-8a90-b1c2d3e4f5a6";
const JUDGE2 = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
const ELSE_WORKER = "7a7a7a7a-0000-4000-8000-000000000001";

const asleep = { since: 1, freedBytes: 0 };
const row = (id: string, sleeping?: typeof asleep) => ({ id, name: id.slice(0, 4), sleeping });
const resting = (tab: string, workertab: string): PairResting => ({
    tab,
    name: "Judge: " + workertab.slice(0, 4),
    workertab,
    pairid: "ended-" + tab.slice(0, 4),
    ts: 1,
});
const livePair = (worker: string, judge: string) =>
    ({
        id: "live-" + worker.slice(0, 4),
        state: "relaying",
        worker: { tab: worker, name: "w", harness: "claude" },
        judges: [{ tab: judge, name: "j", harness: "claude" }],
    }) as unknown as PairView;

const setRoster = (rows: ReturnType<typeof row>[]) =>
    globalStore.set(devRosterAtom as unknown as PrimitiveAtom<unknown[]>, rows);
const closed = () => mocks.closeTab.mock.calls.map((c) => c[1]);
const names = (...judges: string[]) => mocks.closeWorker.mockResolvedValueOnce({ judges });

beforeEach(() => {
    mocks.closeTab.mockReset().mockResolvedValue({});
    mocks.sendLog.mockReset();
    mocks.closeWorker.mockReset().mockResolvedValue({ judges: [] });
    globalStore.set(devMockRestingAtom, []);
    globalStore.set(devMockPairsAtom, []);
    setRoster([]);
});
afterEach(() => {
    globalStore.set(devMockRestingAtom, null);
    globalStore.set(devMockPairsAtom, null);
    vi.restoreAllMocks();
});

describe("closeTabLogged", () => {
    it("closes the tab it is given, in that workspace, and logs the close with its route", async () => {
        await closeTabLogged(WS, WORKER, "agent row ×");
        expect(mocks.closeTab).toHaveBeenCalledTimes(1);
        expect(mocks.closeTab).toHaveBeenCalledWith(WS, WORKER);
        expect(mocks.sendLog).toHaveBeenCalledWith("[close] close tab=61483cd6 why=agent row ×");
    });

    it("asks wavesrv nothing for a tab that is no worker of a pair", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, ELSE_WORKER)]);
        await closeTabLogged(WS, WORKER, "x");
        expect(mocks.closeWorker).not.toHaveBeenCalled();
        expect(closed()).toStrictEqual([WORKER]);
    });

    it("returns what closing the worker returned", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        const rtn = { closedtabid: WORKER } as unknown as CloseTabRtnType;
        mocks.closeTab.mockResolvedValueOnce(rtn);
        await expect(closeTabLogged(WS, WORKER, "x")).resolves.toBe(rtn);
    });

    it("closes the judges wavesrv names after the worker, asleep or awake, each with its own why", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep), row(JUDGE2)]);
        names(JUDGE, JUDGE2);

        await closeTabLogged(WS, WORKER, "agent row ×");

        // wavesrv is asked (and ends the live pair) before the worker's tab goes
        expect(mocks.closeWorker).toHaveBeenCalledWith({}, { workertab: WORKER });
        expect(mocks.closeWorker.mock.invocationCallOrder[0]).toBeLessThan(mocks.closeTab.mock.invocationCallOrder[0]);
        expect(closed()).toStrictEqual([WORKER, JUDGE, JUDGE2]);
        expect(mocks.closeTab).toHaveBeenNthCalledWith(2, WS, JUDGE);
        expect(mocks.sendLog.mock.calls.map((c) => c[0])).toStrictEqual([
            "[close] close tab=61483cd6 why=agent row ×",
            "[close] close tab=4c6ba858 why=judge of closed worker 61483cd6",
            "[close] close tab=9e0f1a2b why=judge of closed worker 61483cd6",
        ]);
    });

    it("asks wavesrv for the worker of a live pair, though no judge rests yet", async () => {
        globalStore.set(devMockPairsAtom, [livePair(WORKER, JUDGE)]);
        setRoster([row(WORKER), row(JUDGE)]);
        names(JUDGE);
        await closeTabLogged(WS, WORKER, "x");
        expect(closed()).toStrictEqual([WORKER, JUDGE]);
    });

    it("leaves a named judge that is not on the roster alone: there is no tab to close", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        setRoster([row(WORKER)]);
        names(JUDGE);
        await closeTabLogged(WS, WORKER, "x");
        expect(closed()).toStrictEqual([WORKER]);
    });

    it("falls back on the worker's resting judges when wavesrv cannot answer", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER), resting(JUDGE2, ELSE_WORKER)]);
        setRoster([row(WORKER), row(JUDGE), row(JUDGE2, asleep)]);
        mocks.closeWorker.mockRejectedValueOnce(new Error("wavesrv down"));
        await closeTabLogged(WS, WORKER, "x");
        expect(closed()).toStrictEqual([WORKER, JUDGE]);
        expect(err).toHaveBeenCalled();
    });

    it("closes no judge when the worker's own close fails, and passes the failure on", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep)]);
        names(JUDGE);
        mocks.closeTab.mockRejectedValueOnce(new Error("no such tab"));
        await expect(closeTabLogged(WS, WORKER, "x")).rejects.toThrow("no such tab");
        expect(closed()).toStrictEqual([WORKER]);
    });

    it("still closes the worker when a judge's close fails: logs it, never fails the worker's close", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER), resting(JUDGE2, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep), row(JUDGE2, asleep)]);
        names(JUDGE, JUDGE2);
        mocks.closeTab.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("busy"));

        await expect(closeTabLogged(WS, WORKER, "x")).resolves.toBeDefined();

        // the second judge is still tried after the first one failed
        expect(closed()).toStrictEqual([WORKER, JUDGE, JUDGE2]);
        expect(err).toHaveBeenCalled();
    });

    it("reads the roster as it is when the close starts: a mock that clears it later changes nothing", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep)]);
        names(JUDGE);
        mocks.closeTab.mockImplementationOnce(async () => {
            globalStore.set(devMockRestingAtom, []);
            setRoster([]);
            return {};
        });
        await closeTabLogged(WS, WORKER, "x");
        expect(closed()).toStrictEqual([WORKER, JUDGE]);
    });
});
