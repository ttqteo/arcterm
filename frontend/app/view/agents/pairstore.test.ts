// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => ({ handlers: [] as ((event: { data?: unknown }) => void)[] }));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: (sub: { handler: (event: { data?: unknown }) => void }) => {
        events.handlers.push(sub.handler);
        return () => {};
    },
}));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { PairListCommand: vi.fn(), PairGetCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import {
    devMockPairsAtom,
    loadPair,
    loadPairs,
    markPairSeen,
    pairListAtom,
    pairSeenAtom,
    pairViewAtom,
} from "./pairstore";

const list = RpcApi.PairListCommand as ReturnType<typeof vi.fn>;
const get = RpcApi.PairGetCommand as ReturnType<typeof vi.fn>;

const info = (id: string, messagecount = 0) => ({ id, messagecount }) as unknown as PairInfo;
const view = (id: string, count = 0) =>
    ({
        id,
        messagecount: count,
        messages: Array.from({ length: count }, (_, i) => ({ id: `m${i}` })),
    }) as unknown as PairView;

beforeEach(() => {
    list.mockReset();
    get.mockReset();
    globalStore.set(devMockPairsAtom, null);
});

describe("reading pairs", () => {
    it("puts the server's list in the list atom, empty until then", async () => {
        expect(globalStore.get(pairListAtom)).toEqual([]);
        list.mockResolvedValueOnce({ pairs: [info("a")] });
        await loadPairs();
        expect(globalStore.get(pairListAtom)).toEqual([info("a")]);
    });

    it("puts one pair in full in its atom", async () => {
        get.mockResolvedValueOnce(view("v1", 2));
        await loadPair("v1");
        expect(get).toHaveBeenCalledWith({}, { pairid: "v1" });
        expect(globalStore.get(pairViewAtom("v1"))?.messages).toHaveLength(2);
    });

    it("leaves what it had when a read fails, and logs", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        get.mockResolvedValueOnce(view("v2", 1));
        await loadPair("v2");
        get.mockRejectedValueOnce(new Error("gone"));
        await loadPair("v2");
        expect(globalStore.get(pairViewAtom("v2"))?.messages).toHaveLength(1);
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });

    it("drops the late answer of a read an event overtook", async () => {
        let late!: (v: PairView) => void;
        get.mockReturnValueOnce(new Promise<PairView>((resolve) => (late = resolve)));
        get.mockResolvedValueOnce(view("v3", 3));
        const slow = loadPair("v3");
        await loadPair("v3");
        late(view("v3", 1));
        await slow;
        expect(globalStore.get(pairViewAtom("v3"))?.messages).toHaveLength(3);
    });
});

describe("the dev mock", () => {
    it("replaces the server's pairs whole while it is set, and nothing is read from the server", async () => {
        list.mockResolvedValue({ pairs: [info("server")] });
        await loadPairs();
        get.mockResolvedValue(view("server", 4));
        await loadPair("server");
        list.mockClear();
        get.mockClear();

        globalStore.set(devMockPairsAtom, [view("mock", 2)]);
        expect(globalStore.get(pairListAtom).map((p) => p.id)).toEqual(["mock"]);
        expect(globalStore.get(pairViewAtom("mock"))?.messages).toHaveLength(2);
        expect(globalStore.get(pairViewAtom("server"))).toBeNull();
        await loadPairs();
        await loadPair("server");
        expect(list).not.toHaveBeenCalled();
        expect(get).not.toHaveBeenCalled();

        globalStore.set(devMockPairsAtom, null);
        expect(globalStore.get(pairListAtom).map((p) => p.id)).toEqual(["server"]);
        expect(globalStore.get(pairViewAtom("server"))?.messages).toHaveLength(4);
    });

    it("holds [] as a mock: no pairs at all", () => {
        globalStore.set(devMockPairsAtom, []);
        expect(globalStore.get(pairListAtom)).toEqual([]);
    });
});

describe("pair:update", () => {
    const fire = async (data?: PairUpdateData) => {
        for (const handler of events.handlers) {
            handler({ data });
        }
        await vi.waitFor(() => expect(list).toHaveBeenCalled());
    };

    it("reads the list again, and the pair it names when that has been read", async () => {
        list.mockResolvedValue({ pairs: [info("e1", 1)] });
        get.mockResolvedValue(view("e1", 1));
        await loadPair("e1");
        get.mockClear();
        get.mockResolvedValue(view("e1", 2));
        await fire({ pairid: "e1", workertab: "w" });
        await vi.waitFor(() => expect(globalStore.get(pairViewAtom("e1"))?.messages).toHaveLength(2));
        expect(globalStore.get(pairListAtom).map((p) => p.id)).toEqual(["e1"]);
    });

    it("leaves a pair nobody has read alone", async () => {
        list.mockResolvedValue({ pairs: [] });
        await fire({ pairid: "never-read", workertab: "w" });
        expect(get).not.toHaveBeenCalled();
    });
});

describe("what the person has seen", () => {
    it("starts at 0 and is written and read back by the atom", () => {
        expect(globalStore.get(pairSeenAtom("s1"))).toBe(0);
        globalStore.set(pairSeenAtom("s1"), 4);
        expect(globalStore.get(pairSeenAtom("s1"))).toBe(4);
        expect(globalStore.get(pairSeenAtom("s2"))).toBe(0);
    });

    it("markPairSeen counts the messages of the view, else the list's count, else leaves it", () => {
        globalStore.set(devMockPairsAtom, [view("s3", 5)]);
        markPairSeen("s3");
        expect(globalStore.get(pairSeenAtom("s3"))).toBe(5);

        globalStore.set(devMockPairsAtom, [info("s4", 7) as unknown as PairView]);
        markPairSeen("s4");
        expect(globalStore.get(pairSeenAtom("s4"))).toBe(7);

        markPairSeen("nobody");
        expect(globalStore.get(pairSeenAtom("nobody"))).toBe(0);
    });
});
