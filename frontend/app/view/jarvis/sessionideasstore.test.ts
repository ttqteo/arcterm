// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => [] as Array<() => void>);
const get = vi.hoisted(() => vi.fn());
const resolve = vi.hoisted(() => vi.fn());
const mark = vi.hoisted(() => vi.fn());
const scan = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());
const openAddress = vi.hoisted(() => vi.fn());

vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: (s: { handler: () => void }) => {
        handlers.push(s.handler);
        return () => {};
    },
}));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        SessionIdeasGetCommand: (...a: unknown[]) => get(...a),
        SessionIdeasResolveCommand: (...a: unknown[]) => resolve(...a),
        SessionIdeasMarkCommand: (...a: unknown[]) => mark(...a),
        SessionIdeasScanCommand: (...a: unknown[]) => scan(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/cockpit/notificationstore", () => ({
    pushToast: (...a: unknown[]) => pushToast(...a),
    TOAST_TTL_MS: 6000,
}));
vi.mock("./openref", () => ({ openAddress: (...a: unknown[]) => openAddress(...a) }));

type Store = typeof import("./sessionideasstore");
type GlobalStore = typeof import("@/app/store/jotaiStore");

const model = { surfaceAtom: {} } as any;

function data(over: Partial<SessionIdeasData> = {}): SessionIdeasData {
    return {
        ideas: [],
        marks: [],
        sessions: [],
        scanned: 0,
        notyet: 0,
        leavingsoon: 0,
        lastscants: 0,
        nextscants: 0,
        seents: 0,
        snoozeduntil: 0,
        firstscandone: true,
        ...over,
    };
}

function scanOf(over: Partial<SessionIdeasScan> = {}): SessionIdeasScan {
    return {
        done: 0,
        total: 0,
        startedts: 1,
        endedts: 0,
        forced: false,
        error: "",
        stoppedat: 0,
        newideas: 0,
        tokens: 0,
        ...over,
    };
}

function deferred<T>() {
    let resolveIt!: (v: T) => void;
    let rejectIt!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolveIt = res;
        rejectIt = rej;
    });
    return { promise, resolve: resolveIt, reject: rejectIt };
}

// the store keeps its feed in module state, so each test gets a fresh one
let store: Store;
let jotai: GlobalStore;

beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    handlers.length = 0;
    store = await import("./sessionideasstore");
    jotai = await import("@/app/store/jotaiStore");
});

afterEach(() => {
    vi.restoreAllMocks();
});

const atomNow = () => jotai.globalStore.get(store.sessionIdeasAtom);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the feed", () => {
    it("subscribes to the event before it reads, and the first read fills the atom", async () => {
        const first = data({ scanned: 4 });
        get.mockResolvedValue(first);
        expect(atomNow()).toBeNull();
        store.ensureSessionIdeasFeed(model);
        expect(handlers).toHaveLength(1);
        await flush();
        expect(get).toHaveBeenCalledTimes(1);
        expect(atomNow()).toEqual(first);
    });

    it("is idempotent: a second mount subscribes and reads nothing more", async () => {
        get.mockResolvedValue(data());
        store.ensureSessionIdeasFeed(model);
        store.ensureSessionIdeasFeed(model);
        await flush();
        expect(handlers).toHaveLength(1);
        expect(get).toHaveBeenCalledTimes(1);
    });

    it("reads again on an event that comes after the read settled", async () => {
        get.mockResolvedValueOnce(data({ scanned: 1 })).mockResolvedValueOnce(data({ scanned: 2 }));
        store.ensureSessionIdeasFeed(model);
        await flush();
        handlers[0]();
        await flush();
        expect(get).toHaveBeenCalledTimes(2);
        expect(atomNow()?.scanned).toBe(2);
    });

    it("keeps one read in flight and queues one more behind it, however many events arrive meanwhile", async () => {
        const a = deferred<SessionIdeasData>();
        const b = deferred<SessionIdeasData>();
        get.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
        store.ensureSessionIdeasFeed(model);
        handlers[0]();
        handlers[0]();
        handlers[0]();
        expect(get).toHaveBeenCalledTimes(1);
        a.resolve(data({ scanned: 1 }));
        await flush();
        expect(get).toHaveBeenCalledTimes(2);
        b.resolve(data({ scanned: 2 }));
        await flush();
        expect(get).toHaveBeenCalledTimes(2);
        expect(atomNow()?.scanned).toBe(2);
    });

    it("never lets the reply of a read with a newer one queued behind it overwrite the atom", async () => {
        const a = deferred<SessionIdeasData>();
        const b = deferred<SessionIdeasData>();
        get.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
        store.ensureSessionIdeasFeed(model);
        handlers[0]();
        // the older read lands first, with a list from before the person's Keep: it is not shown
        a.resolve(data({ scanned: 1 }));
        await flush();
        expect(atomNow()).toBeNull();
        b.resolve(data({ scanned: 2 }));
        await flush();
        expect(atomNow()?.scanned).toBe(2);
    });

    it("logs a failed read and keeps what the list had", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        get.mockResolvedValueOnce(data({ scanned: 1 })).mockRejectedValueOnce(new Error("rpc down"));
        store.ensureSessionIdeasFeed(model);
        await flush();
        handlers[0]();
        await flush();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(atomNow()?.scanned).toBe(1);
        // and a later event reads again
        get.mockResolvedValueOnce(data({ scanned: 3 }));
        handlers[0]();
        await flush();
        expect(atomNow()?.scanned).toBe(3);
    });
});

describe("the scan-end toast", () => {
    it("tells once when a scan ends with ideas, and Review opens the Brief on its region", async () => {
        get.mockResolvedValueOnce(data({ scan: scanOf({ done: 2, total: 5 }) })).mockResolvedValueOnce(
            data({ scan: scanOf({ done: 5, total: 5, endedts: 9, newideas: 2 }) })
        );
        store.ensureSessionIdeasFeed(model);
        await flush();
        expect(pushToast).not.toHaveBeenCalled();
        handlers[0]();
        await flush();
        expect(pushToast).toHaveBeenCalledTimes(1);
        const toast = pushToast.mock.calls[0][0];
        expect(toast.title).toBe("Session scan: 2 ideas to review, from 5 sessions");
        expect(toast.action.label).toBe("Review");
        toast.action.run();
        expect(openAddress).toHaveBeenCalledWith(model, "sessionideas");
        // a later write leaves the ended scan as it was: no second toast
        get.mockResolvedValueOnce(data({ seents: 7, scan: scanOf({ done: 5, total: 5, endedts: 9, newideas: 2 }) }));
        handlers[0]();
        await flush();
        expect(pushToast).toHaveBeenCalledTimes(1);
    });

    it("says nothing for a scan that ended before the app looked", async () => {
        get.mockResolvedValueOnce(data({ scan: scanOf({ done: 5, total: 5, endedts: 9, newideas: 2 }) }));
        store.ensureSessionIdeasFeed(model);
        await flush();
        expect(pushToast).not.toHaveBeenCalled();
    });
});

describe("the actions", () => {
    beforeEach(() => {
        resolve.mockResolvedValue(undefined);
        mark.mockResolvedValue(undefined);
        scan.mockResolvedValue(undefined);
    });

    it("keeps with or without a label, and drops", async () => {
        expect(await store.keepIdea("i-1")).toBe(true);
        expect(await store.keepIdea("i-2", "Read the queue aloud")).toBe(true);
        expect(await store.dropIdea("i-3")).toBe(true);
        expect(resolve.mock.calls.map((c) => c[1])).toEqual([
            { id: "i-1", op: "keep" },
            { id: "i-2", op: "keep", label: "Read the queue aloud" },
            { id: "i-3", op: "drop" },
        ]);
    });

    it("marks seen and snoozes", async () => {
        expect(await store.markSeen()).toBe(true);
        expect(await store.snooze()).toBe(true);
        expect(mark.mock.calls.map((c) => c[1])).toEqual([{ op: "seen" }, { op: "snooze" }]);
    });

    it("scans the quiet sessions not yet scanned with no paths, or the paths it is given, and stops", async () => {
        await store.scanNow();
        await store.scanNow([]);
        await store.scanNow(["a.jsonl", "b.jsonl"]);
        await store.stopScan();
        expect(scan.mock.calls.map((c) => c[1])).toEqual([{}, {}, { paths: ["a.jsonl", "b.jsonl"] }, { stop: true }]);
    });

    it("says on a toast why a Keep or a scan did not go through, and reports false", async () => {
        resolve.mockRejectedValue(new Error("idea i-1 is already kept"));
        expect(await store.keepIdea("i-1")).toBe(false);
        expect(pushToast).toHaveBeenLastCalledWith(
            expect.objectContaining({ level: "error", message: "idea i-1 is already kept" })
        );
        scan.mockRejectedValue(new Error("a scan is running"));
        expect(await store.scanNow()).toBe(false);
        expect(pushToast).toHaveBeenLastCalledWith(
            expect.objectContaining({ level: "error", message: "a scan is running" })
        );
    });

    it("only logs a failed mark-seen: the person did not ask for it", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mark.mockRejectedValue(new Error("rpc down"));
        expect(await store.markSeen()).toBe(false);
        expect(pushToast).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe("the focus request", () => {
    it("is the atom openref.ts writes, under the name the region imports", async () => {
        const jarvis = await import("./jarvisstore");
        expect(store.sessionIdeasFocusAtom).toBe(jarvis.sessionIdeasFocusAtom);
    });
});
