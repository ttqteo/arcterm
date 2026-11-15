// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { JarvisStateCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

const lsMock = vi.hoisted(() => {
    const store = new Map<string, string>();
    const mock = {
        store,
        failWrites: false,
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
            if (mock.failWrites) {
                throw new Error("quota");
            }
            store.set(k, v);
        },
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    };
    (globalThis as any).localStorage = mock;
    (globalThis as any).window = { localStorage: mock };
    return mock;
});

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { SEVEN_DAYS_MS } from "./briefingmodel";
import {
    ackBriefingVisit,
    briefingAckAtom,
    briefingCursorAtom,
    briefingStateAtom,
    loadBriefingAsync,
} from "./briefingstore";

const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const completeState = (): WorkState => ({
    projects: [],
    sources: { runs: true, sessions: true, dossiers: true, efforts: true, attention: "volatile" },
});

const mockStateRpc = (state: WorkState) => {
    (RpcApi.JarvisStateCommand as ReturnType<typeof vi.fn>).mockResolvedValue({ state });
};

describe("briefing cursor", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        lsMock.clear();
        lsMock.failWrites = false;
        globalStore.set(briefingCursorAtom, null);
        globalStore.set(briefingAckAtom, "idle");
        vi.spyOn(Date, "now").mockReturnValue(T0);
        (RpcApi.JarvisStateCommand as ReturnType<typeof vi.fn>).mockReset();
    });

    it("first use falls back to seven days ago for the fetch; the cursor moves only on acknowledge", async () => {
        mockStateRpc(completeState());
        await loadBriefingAsync();
        expect(RpcApi.JarvisStateCommand).toHaveBeenCalledWith(
            expect.anything(),
            {
                project: "",
                sincems: T0 - SEVEN_DAYS_MS,
            },
            { timeout: 180_000 }
        );
        // load alone must not mark the delta seen
        expect(globalStore.get(briefingCursorAtom)).toBe(null);
        expect(globalStore.get(briefingAckAtom)).toBe("waiting");
        const st = globalStore.get(briefingStateAtom);
        expect(st.snapshot?.complete).toBe(true);
        ackBriefingVisit();
        expect(globalStore.get(briefingCursorAtom)).toBe(T0);
        expect(globalStore.get(briefingAckAtom)).toBe("saved");
    });

    it.each([
        ["malformed", JSON.stringify("abc")],
        ["nonpositive", JSON.stringify(0)],
        ["negative", JSON.stringify(-5)],
        ["future", JSON.stringify(T0 + 1000)],
    ])("falls back to seven days ago for a %s cursor", async (_name, stored) => {
        lsMock.store.set("jarvis.briefing.lastseen", stored);
        mockStateRpc(completeState());
        await loadBriefingAsync();
        expect(RpcApi.JarvisStateCommand).toHaveBeenCalledWith(
            expect.anything(),
            {
                project: "",
                sincems: T0 - SEVEN_DAYS_MS,
            },
            { timeout: 180_000 }
        );
    });

    it("acknowledgment advances from queryStartedAt, never response time", async () => {
        let resolve!: (v: CommandJarvisStateRtnData) => void;
        (RpcApi.JarvisStateCommand as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((r) => (resolve = r)));
        const pending = loadBriefingAsync();
        vi.spyOn(Date, "now").mockReturnValue(T0 + 60_000); // the response lands a minute later
        resolve({ state: completeState() });
        await pending;
        ackBriefingVisit();
        expect(globalStore.get(briefingCursorAtom)).toBe(T0);
    });

    it("does not advance on RPC failure and keeps the previous snapshot", async () => {
        globalStore.set(briefingCursorAtom, T0 - DAY);
        (RpcApi.JarvisStateCommand as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rpc broke"));
        await loadBriefingAsync();
        expect(globalStore.get(briefingCursorAtom)).toBe(T0 - DAY);
        expect(globalStore.get(briefingStateAtom).error).toBeTruthy();
    });

    it("does not advance on partial source health; acknowledge is a no-op", async () => {
        globalStore.set(briefingCursorAtom, T0 - DAY);
        const partial: WorkState = {
            projects: [],
            sources: { runs: false, sessions: true, dossiers: true, efforts: true, attention: "volatile" },
        };
        mockStateRpc(partial);
        await loadBriefingAsync();
        const st = globalStore.get(briefingStateAtom);
        expect(st.snapshot?.complete).toBe(false);
        expect(st.snapshot?.state.sources.runs).toBe(false);
        ackBriefingVisit();
        expect(globalStore.get(briefingCursorAtom)).toBe(T0 - DAY);
        expect(globalStore.get(briefingAckAtom)).toBe("waiting");
    });

    it("a stale generation's snapshot is discarded and acknowledgment uses the current one", async () => {
        let resolveA!: (v: CommandJarvisStateRtnData) => void;
        (RpcApi.JarvisStateCommand as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise((r) => (resolveA = r)));
        const a = loadBriefingAsync();
        mockStateRpc(completeState()); // generation B resolves immediately
        await loadBriefingAsync();
        resolveA({ state: completeState() }); // generation A lands late
        await a;
        ackBriefingVisit();
        expect(globalStore.get(briefingCursorAtom)).toBe(T0);
        expect(globalStore.get(briefingStateAtom).snapshot?.queryStartedAt).toBe(T0);
    });

    it("flags the unsaved marker when localStorage writes fail during acknowledgment", async () => {
        lsMock.failWrites = true;
        try {
            mockStateRpc(completeState());
            await loadBriefingAsync();
            expect(globalStore.get(briefingStateAtom).snapshot?.complete).toBe(true);
            ackBriefingVisit();
            expect(globalStore.get(briefingAckAtom)).toBe("failed");
            expect(globalStore.get(briefingStateAtom).error).toBeNull();
        } finally {
            lsMock.failWrites = false;
        }
    });

    it("never regresses a cursor another window already advanced", async () => {
        globalStore.set(briefingCursorAtom, T0 + 10_000);
        mockStateRpc(completeState());
        await loadBriefingAsync();
        ackBriefingVisit();
        expect(globalStore.get(briefingCursorAtom)).toBe(T0 + 10_000);
    });
});

describe("loadBriefingIfNone", () => {
    it("loads the briefing once when none is in, and not again while it loads or once it has", async () => {
        vi.resetModules();
        const store = await import("./briefingstore");
        const fresh = (await import("@/app/store/jotaiStore")).globalStore;
        const rpc = (await import("@/app/store/wshclientapi")).RpcApi.JarvisStateCommand as ReturnType<typeof vi.fn>;
        rpc.mockReset();
        let finish: (v: unknown) => void = () => {};
        rpc.mockReturnValue(new Promise((r) => (finish = r)));
        store.loadBriefingIfNone();
        store.loadBriefingIfNone();
        expect(rpc).toHaveBeenCalledTimes(1);
        finish({ state: completeState() });
        await vi.waitFor(() => expect(fresh.get(store.briefingStateAtom).snapshot).not.toBeNull());
        store.loadBriefingIfNone();
        expect(rpc).toHaveBeenCalledTimes(1);
    });
});
