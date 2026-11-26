// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// what closeTabLogged calls out to: the close itself and the log. The pair store's wavesrv reads are never made (a test
// seeds its mock lists), and the roster is a plain atom standing for devmock.ts's, whose real graph leads back to this file.
const mocks = vi.hoisted(() => ({
    closeTab: vi.fn(),
    sendLog: vi.fn(),
}));

vi.mock("@/app/store/global", () => ({ getApi: () => ({ sendLog: mocks.sendLog }) }));
vi.mock("@/app/store/services", () => ({ WorkspaceService: { CloseTab: mocks.closeTab } }));
vi.mock("@/app/store/wps", () => ({ waveEventSubscribeSingle: () => () => {} }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./devmock", async () => {
    const { atom } = await import("jotai");
    return { devRosterAtom: atom<unknown[]>([]) };
});

import { closeTabLogged } from "./closetab";
import { devRosterAtom } from "./devmock";
import { devMockRestingAtom } from "./pairstore";

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
});

const setRoster = (rows: ReturnType<typeof row>[]) =>
    globalStore.set(devRosterAtom as unknown as PrimitiveAtom<unknown[]>, rows);
const closed = () => mocks.closeTab.mock.calls.map((c) => c[1]);

beforeEach(() => {
    mocks.closeTab.mockReset().mockResolvedValue({});
    mocks.sendLog.mockReset();
    globalStore.set(devMockRestingAtom, []);
    setRoster([]);
});
afterEach(() => {
    globalStore.set(devMockRestingAtom, null);
    vi.restoreAllMocks();
});

describe("closeTabLogged", () => {
    it("closes the tab it is given, in that workspace, and logs the close with its route", async () => {
        await closeTabLogged(WS, WORKER, "agent row ×");
        expect(mocks.closeTab).toHaveBeenCalledTimes(1);
        expect(mocks.closeTab).toHaveBeenCalledWith(WS, WORKER);
        expect(mocks.sendLog).toHaveBeenCalledWith("[close] close tab=61483cd6 why=agent row ×");
    });

    it("returns what closing the worker returned", async () => {
        const rtn = { closedtabid: WORKER } as unknown as CloseTabRtnType;
        mocks.closeTab.mockResolvedValueOnce(rtn);
        await expect(closeTabLogged(WS, WORKER, "x")).resolves.toBe(rtn);
    });

    it("closes the worker's resting judge that is asleep, in the same workspace, with its own why", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep)]);

        await closeTabLogged(WS, WORKER, "agent row ×");

        expect(closed()).toStrictEqual([WORKER, JUDGE]);
        expect(mocks.closeTab).toHaveBeenNthCalledWith(2, WS, JUDGE);
        // each close is logged, the judge's with the worker it went with
        expect(mocks.sendLog.mock.calls.map((c) => c[0])).toStrictEqual([
            "[close] close tab=61483cd6 why=agent row ×",
            "[close] close tab=4c6ba858 why=judge of closed worker 61483cd6",
        ]);
    });

    it("closes every asleep resting judge of the worker", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER), resting(JUDGE2, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep), row(JUDGE2, asleep)]);
        await closeTabLogged(WS, WORKER, "x");
        expect(closed()).toStrictEqual([WORKER, JUDGE, JUDGE2]);
    });

    it("leaves a resting judge that is awake open: something woke it, so it is a plain row the person can see", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER), resting(JUDGE2, WORKER)]);
        setRoster([row(WORKER), row(JUDGE), row(JUDGE2, asleep)]);
        await closeTabLogged(WS, WORKER, "x");
        expect(closed()).toStrictEqual([WORKER, JUDGE2]);
    });

    it("leaves another worker's resting judge open", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, ELSE_WORKER)]);
        setRoster([row(WORKER), row(ELSE_WORKER), row(JUDGE, asleep)]);
        await closeTabLogged(WS, WORKER, "x");
        expect(closed()).toStrictEqual([WORKER]);
    });

    it("leaves a resting judge that is not on the roster alone: there is no tab to close", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        setRoster([row(WORKER)]);
        await closeTabLogged(WS, WORKER, "x");
        expect(closed()).toStrictEqual([WORKER]);
    });

    it("closing a judge takes nothing else along", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep)]);
        await closeTabLogged(WS, JUDGE, "x");
        expect(closed()).toStrictEqual([JUDGE]);
    });

    it("closes no judge when the worker's own close fails, and passes the failure on", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep)]);
        mocks.closeTab.mockRejectedValueOnce(new Error("no such tab"));
        await expect(closeTabLogged(WS, WORKER, "x")).rejects.toThrow("no such tab");
        expect(closed()).toStrictEqual([WORKER]);
    });

    it("still closes the worker when a judge's close fails: logs it, never fails the worker's close", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER), resting(JUDGE2, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep), row(JUDGE2, asleep)]);
        mocks.closeTab.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("busy"));

        await expect(closeTabLogged(WS, WORKER, "x")).resolves.toBeDefined();

        // the second judge is still tried after the first one failed
        expect(closed()).toStrictEqual([WORKER, JUDGE, JUDGE2]);
        expect(err).toHaveBeenCalled();
    });

    it("reads the lists as they are when the close starts: a mock that clears them later changes nothing", async () => {
        globalStore.set(devMockRestingAtom, [resting(JUDGE, WORKER)]);
        setRoster([row(WORKER), row(JUDGE, asleep)]);
        mocks.closeTab.mockImplementationOnce(async () => {
            globalStore.set(devMockRestingAtom, []);
            setRoster([]);
            return {};
        });
        await closeTabLogged(WS, WORKER, "x");
        expect(closed()).toStrictEqual([WORKER, JUDGE]);
    });
});
