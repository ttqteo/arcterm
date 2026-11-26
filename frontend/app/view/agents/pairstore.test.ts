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
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        PairListCommand: vi.fn(),
        PairGetCommand: vi.fn(),
        PairHistoryCommand: vi.fn(),
        PairResumeCommand: vi.fn(),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { atom } from "jotai";
import { centerModeAtom, pairSelAtom, showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { judgeAgainOf } from "./pairopen";
import {
    devMockPairsAtom,
    devMockRestingAtom,
    ensurePair,
    loadPair,
    loadPairHistory,
    loadPairs,
    markPairSeen,
    pairDraftAtom,
    pairHistoryAtom,
    pairListAtom,
    pairSeenAtom,
    pairViewAtom,
    pairViewErrorAtom,
    restingJudgesAtom,
    resumePair,
} from "./pairstore";

const list = RpcApi.PairListCommand as ReturnType<typeof vi.fn>;
const get = RpcApi.PairGetCommand as ReturnType<typeof vi.fn>;
const history = RpcApi.PairHistoryCommand as ReturnType<typeof vi.fn>;
const resume = RpcApi.PairResumeCommand as ReturnType<typeof vi.fn>;

const info = (id: string, messagecount = 0, over: Partial<PairInfo> = {}) =>
    ({ id, messagecount, ...over }) as unknown as PairInfo;
const view = (id: string, count = 0, over: Partial<PairInfo> = {}) =>
    ({
        id,
        messagecount: count,
        messages: Array.from({ length: count }, (_, i) => ({ id: `m${i}` })),
        ...over,
    }) as unknown as PairView;

beforeEach(() => {
    list.mockReset();
    get.mockReset();
    history.mockReset();
    resume.mockReset();
    globalStore.set(devMockPairsAtom, null);
    globalStore.set(devMockRestingAtom, null);
});

const resting = (tab: string, over: Partial<PairResting> = {}): PairResting => ({
    tab,
    name: `Judge: ${tab}`,
    workertab: `worker-of-${tab}`,
    pairid: `pair-of-${tab}`,
    ...over,
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

describe("ensurePair", () => {
    it("reads a pair once however many ask, and leaves it to the events after that", async () => {
        get.mockResolvedValue(view("e1", 1));
        ensurePair("e1");
        ensurePair("e1");
        await vi.waitFor(() => expect(globalStore.get(pairViewAtom("e1"))?.messages).toHaveLength(1));
        ensurePair("e1");
        ensurePair("");
        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith({}, { pairid: "e1" });
    });

    it("does not read again a pair something else already read", async () => {
        get.mockResolvedValue(view("e2", 2));
        await loadPair("e2");
        ensurePair("e2");
        expect(get).toHaveBeenCalledTimes(1);
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

    it("leaves an ended and a synced pair out of the live list, as the server's list does, but still reads them by id", () => {
        const ended = view("ended", 1, { state: "ended" });
        const synced = view("synced", 1, { state: "stopped", synced: true });
        globalStore.set(devMockPairsAtom, [view("live", 1, { state: "relaying" }), ended, synced]);
        expect(globalStore.get(pairListAtom).map((p) => p.id)).toEqual(["live"]);
        expect(globalStore.get(pairViewAtom("ended"))).toBe(ended);
        expect(globalStore.get(pairViewAtom("synced"))).toBe(synced);
    });
});

describe("the resting judges", () => {
    it("is empty before the first read, then the `resting` of the list answer", async () => {
        expect(globalStore.get(restingJudgesAtom)).toEqual([]);
        list.mockResolvedValueOnce({ pairs: [info("a")], resting: [resting("j1"), resting("j2")] });
        await loadPairs();
        expect(globalStore.get(restingJudgesAtom)).toEqual([resting("j1"), resting("j2")]);
    });

    it("reads an answer with no `resting` (the server omits an empty list) as none, and a later list replaces the old", async () => {
        list.mockResolvedValueOnce({ pairs: [], resting: [resting("j3")] });
        await loadPairs();
        expect(globalStore.get(restingJudgesAtom).map((r) => r.tab)).toEqual(["j3"]);
        list.mockResolvedValueOnce({ pairs: [] });
        await loadPairs();
        expect(globalStore.get(restingJudgesAtom)).toEqual([]);
    });

    it("keeps the list it had when a read fails, and logs", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        list.mockResolvedValueOnce({ pairs: [], resting: [resting("j4")] });
        await loadPairs();
        list.mockRejectedValueOnce(new Error("down"));
        await loadPairs();
        expect(globalStore.get(restingJudgesAtom).map((r) => r.tab)).toEqual(["j4"]);
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });

    it("is the mock's list while it is set, [] included, and the server's again when it is cleared", async () => {
        list.mockResolvedValue({ pairs: [], resting: [resting("server")] });
        await loadPairs();

        globalStore.set(devMockRestingAtom, [resting("mock")]);
        expect(globalStore.get(restingJudgesAtom).map((r) => r.tab)).toEqual(["mock"]);
        globalStore.set(devMockRestingAtom, []);
        expect(globalStore.get(restingJudgesAtom)).toEqual([]);

        globalStore.set(devMockRestingAtom, null);
        expect(globalStore.get(restingJudgesAtom).map((r) => r.tab)).toEqual(["server"]);
    });

    it("is not read from the server while the pairs are mocked, and its own mock still shows", async () => {
        // the pairs mock stops loadPairs reading anything, as it does for the pair list
        list.mockResolvedValue({ pairs: [], resting: [resting("server2")] });
        await loadPairs();
        globalStore.set(devMockPairsAtom, [view("p", 1)]);
        list.mockClear();
        await loadPairs();
        expect(list).not.toHaveBeenCalled();
        globalStore.set(devMockRestingAtom, [resting("mock2")]);
        expect(globalStore.get(restingJudgesAtom).map((r) => r.tab)).toEqual(["mock2"]);
    });
});

describe("the history", () => {
    it("is null before the first read, then what PairHistoryCommand answered for the project", async () => {
        expect(globalStore.get(pairHistoryAtom("/repo/one"))).toBeNull();
        history.mockResolvedValueOnce({ pairs: [info("h1"), info("h2")] });
        await loadPairHistory("/repo/one");
        expect(history).toHaveBeenCalledWith({}, { project: "/repo/one" });
        expect(globalStore.get(pairHistoryAtom("/repo/one"))?.map((p) => p.id)).toEqual(["h1", "h2"]);
        expect(globalStore.get(pairHistoryAtom("/repo/two"))).toBeNull();
    });

    it("keeps one list for two spellings of a project path", async () => {
        history.mockResolvedValueOnce({ pairs: [info("h3")] });
        await loadPairHistory("D:\\work\\repo");
        expect(globalStore.get(pairHistoryAtom("d:/work/repo/"))?.map((p) => p.id)).toEqual(["h3"]);
    });

    it("reads an empty answer as no pairs", async () => {
        history.mockResolvedValueOnce({ pairs: null });
        await loadPairHistory("/repo/empty");
        expect(globalStore.get(pairHistoryAtom("/repo/empty"))).toEqual([]);
    });

    it("leaves the list as it was when a read fails, and logs", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        history.mockResolvedValueOnce({ pairs: [info("h4")] });
        await loadPairHistory("/repo/fails");
        history.mockRejectedValueOnce(new Error("disk"));
        await loadPairHistory("/repo/fails");
        expect(globalStore.get(pairHistoryAtom("/repo/fails"))?.map((p) => p.id)).toEqual(["h4"]);
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });

    it("drops the late answer of a read an event overtook", async () => {
        let late!: (v: CommandPairListRtnData) => void;
        history.mockReturnValueOnce(new Promise<CommandPairListRtnData>((resolve) => (late = resolve)));
        history.mockResolvedValueOnce({ pairs: [info("new")] });
        const slow = loadPairHistory("/repo/late");
        await loadPairHistory("/repo/late");
        late({ pairs: [info("old")] });
        await slow;
        expect(globalStore.get(pairHistoryAtom("/repo/late"))?.map((p) => p.id)).toEqual(["new"]);
    });

    it("is the mock's pairs while it is set, of the project asked for, and nothing is read from the server", async () => {
        globalStore.set(devMockPairsAtom, [
            view("a", 1, { project: "/repo/m-one", state: "ended" }),
            view("b", 1, { project: "D:\\repo\\m-two", state: "relaying" }),
            view("c", 1, { project: "/repo/m-one", state: "stopped", synced: true }),
        ]);
        expect(globalStore.get(pairHistoryAtom("/repo/m-one")).map((p) => p.id)).toEqual(["a", "c"]);
        expect(globalStore.get(pairHistoryAtom("d:/repo/m-two/")).map((p) => p.id)).toEqual(["b"]);
        expect(globalStore.get(pairHistoryAtom("/repo/m-none"))).toEqual([]);
        expect(globalStore.get(pairHistoryAtom("")).map((p) => p.id)).toEqual(["a", "b", "c"]);
        await loadPairHistory("/repo/m-one");
        expect(history).not.toHaveBeenCalled();

        globalStore.set(devMockPairsAtom, null);
        expect(globalStore.get(pairHistoryAtom("/repo/m-one"))).toBeNull();
    });
});

describe("a pair that did not read", () => {
    it("keeps why per pair, and a later good read clears it", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(globalStore.get(pairViewErrorAtom("x1"))).toBeNull();
        get.mockRejectedValueOnce(new Error('no pair "x1"'));
        await loadPair("x1");
        expect(globalStore.get(pairViewErrorAtom("x1"))).toBe('no pair "x1"');
        expect(globalStore.get(pairViewAtom("x1"))).toBeNull();
        expect(globalStore.get(pairViewErrorAtom("other"))).toBeNull();
        expect(logged).toHaveBeenCalled();

        get.mockResolvedValueOnce(view("x1", 1));
        await loadPair("x1");
        expect(globalStore.get(pairViewErrorAtom("x1"))).toBeNull();
        expect(globalStore.get(pairViewAtom("x1"))?.messages).toHaveLength(1);
        logged.mockRestore();
    });

    it("keeps the pair it had when a later read fails, and says the read failed", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        get.mockResolvedValueOnce(view("x2", 2));
        await loadPair("x2");
        get.mockRejectedValueOnce("the server went away");
        await loadPair("x2");
        expect(globalStore.get(pairViewAtom("x2"))?.messages).toHaveLength(2);
        expect(globalStore.get(pairViewErrorAtom("x2"))).toBe("the server went away");
        logged.mockRestore();
    });

    it("sets no reason for a failed read an event overtook", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        let fail!: (e: Error) => void;
        get.mockReturnValueOnce(new Promise<PairView>((_, reject) => (fail = reject)));
        get.mockResolvedValueOnce(view("x3", 3));
        const slow = loadPair("x3");
        await loadPair("x3");
        fail(new Error("late failure"));
        await slow;
        expect(globalStore.get(pairViewErrorAtom("x3"))).toBeNull();
        expect(globalStore.get(pairViewAtom("x3"))?.messages).toHaveLength(3);
        logged.mockRestore();
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

    it("reads the history of each project it has read again", async () => {
        history.mockResolvedValue({ pairs: [info("u1")] });
        await loadPairHistory("/repo/events");
        history.mockClear();
        history.mockResolvedValue({ pairs: [info("u1"), info("u2")] });
        list.mockResolvedValue({ pairs: [] });
        await fire({ pairid: "u2", workertab: "w" });
        await vi.waitFor(() =>
            expect(globalStore.get(pairHistoryAtom("/repo/events"))?.map((p) => p.id)).toEqual(["u1", "u2"])
        );
        expect(history).toHaveBeenCalledWith({}, { project: "/repo/events" });
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

describe("resumePair", () => {
    it("calls PairResumeCommand with the pair's id", async () => {
        resume.mockResolvedValueOnce(undefined);
        await resumePair("r1");
        expect(resume).toHaveBeenCalledTimes(1);
        expect(resume).toHaveBeenCalledWith({}, { pairid: "r1" });
    });

    it("logs a failure and rethrows it, so the place that pressed the button can show it", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        const failure = new Error("resume is not possible: the pair is not stopped");
        resume.mockRejectedValueOnce(failure);
        await expect(resumePair("r2")).rejects.toBe(failure);
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });
});

describe("a pair's composer draft", () => {
    it("is null until something writes it, and is held per pair", () => {
        expect(globalStore.get(pairDraftAtom("d1"))).toBeNull();
        globalStore.set(pairDraftAtom("d1"), "@judge ");
        expect(globalStore.get(pairDraftAtom("d1"))).toBe("@judge ");
        expect(globalStore.get(pairDraftAtom("d2"))).toBeNull();
        globalStore.set(pairDraftAtom("d1"), null);
        expect(globalStore.get(pairDraftAtom("d1"))).toBeNull();
    });
});

describe("judgeAgainOf", () => {
    it("puts the pair's conversation on screen and leaves @judge in its draft", () => {
        const model = { focusIdAtom: atom<string | null>(null) } as unknown as Pick<AgentsViewModel, "focusIdAtom">;
        showTerminal();
        globalStore.set(pairDraftAtom("j1"), null);

        judgeAgainOf(model, "worker-tab", "j1");

        expect(globalStore.get(model.focusIdAtom)).toBe("worker-tab");
        expect(globalStore.get(centerModeAtom)).toBe("pair");
        expect(globalStore.get(pairSelAtom)).toBe("j1");
        expect(globalStore.get(pairDraftAtom("j1"))).toBe("@judge ");
        expect(globalStore.get(pairDraftAtom("other"))).toBeNull();
    });
});
