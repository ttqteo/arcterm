// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ws", () => ({ addWSReconnectHandler: vi.fn(), initGlobalWS: vi.fn(), globalWS: undefined }));
vi.mock("@/app/store/wps", () => ({ setWpsRpcClient: vi.fn(), wpsReconnectHandler: vi.fn() }));
vi.mock("@/util/endpoints", () => ({ getWSServerEndpoint: () => "" }));

import { sendRpcCommand, setDefaultRouter } from "./wshrpcutil-base";

class FakeRouter {
    sent: RpcMessage[] = [];
    recvRpcMessage(msg: RpcMessage): void {
        this.sent.push(msg);
    }
}

let router: FakeRouter;

beforeEach(() => {
    router = new FakeRouter();
    setDefaultRouter(router as any);
});

describe("sendRpcCommand", () => {
    it("forwards the message to the default router", () => {
        const openRpcs = new Map<string, ClientRpcEntry>();
        sendRpcCommand(openRpcs, { command: "x", reqid: "r1" });
        expect(router.sent).toEqual([{ command: "x", reqid: "r1" }]);
    });

    it("returns null when the message has no reqid (fire-and-forget)", () => {
        const openRpcs = new Map<string, ClientRpcEntry>();
        const gen = sendRpcCommand(openRpcs, { command: "x" });
        expect(gen).toBeNull();
    });
});

describe("rpcResponseGenerator (via sendRpcCommand)", () => {
    it("registers an open rpc, yields response data, then terminates on a non-cont message", async () => {
        const openRpcs = new Map<string, ClientRpcEntry>();
        const gen = sendRpcCommand(openRpcs, { command: "x", reqid: "r1" });
        expect(openRpcs.has("r1")).toBe(true);
        openRpcs.get("r1")!.msgFn({ resid: "r1", data: "hello" });
        const first = await gen.next(false);
        expect(first.value).toBe("hello");
        const done = await gen.next(false);
        expect(done.done).toBe(true);
        expect(openRpcs.has("r1")).toBe(false);
    });

    it("throws when a response carries an error", async () => {
        const openRpcs = new Map<string, ClientRpcEntry>();
        const gen = sendRpcCommand(openRpcs, { command: "x", reqid: "r2" });
        openRpcs.get("r2")!.msgFn({ resid: "r2", error: "boom" });
        await expect(gen.next(false)).rejects.toThrow("boom");
        expect(openRpcs.has("r2")).toBe(false);
    });

    it("cancels and stops when the consumer signals termination", async () => {
        const openRpcs = new Map<string, ClientRpcEntry>();
        const gen = sendRpcCommand(openRpcs, { command: "x", reqid: "r3" });
        router.sent = [];
        openRpcs.get("r3")!.msgFn({ resid: "r3", data: "d1", cont: true });
        await gen.next(false);
        openRpcs.get("r3")!.msgFn({ resid: "r3", data: "d2", cont: true });
        const res = await gen.next(true);
        expect(res.done).toBe(true);
        expect(router.sent.some((m) => m.reqid === "r3" && m.cancel === true)).toBe(true);
        expect(openRpcs.has("r3")).toBe(false);
    });

    it("sends a wire cancel on gen.return() even while parked awaiting the next chunk (quiet stream)", async () => {
        const openRpcs = new Map<string, ClientRpcEntry>();
        const gen = sendRpcCommand(openRpcs, { command: "x", reqid: "r5" });
        openRpcs.get("r5")!.msgFn({ resid: "r5", data: "d1", cont: true });
        await gen.next(false); // consume the first chunk -> generator yields "d1"
        router.sent = [];
        // drive one more next() that finds the queue empty -> the generator parks at `await
        // signalPromise`, which never resolves for a quiet stream. return()'s own finally can't fire
        // from here, so a finally-based cancel would be missed; assert the cancel goes out anyway.
        void gen.next(false);
        void gen.return(undefined); // card unmount
        expect(router.sent.some((m) => m.reqid === "r5" && m.cancel === true)).toBe(true);
    });

    it("does not send a cancel when the stream completes naturally (no return() on normal end)", async () => {
        const openRpcs = new Map<string, ClientRpcEntry>();
        const gen = sendRpcCommand(openRpcs, { command: "x", reqid: "r6" });
        router.sent = [];
        openRpcs.get("r6")!.msgFn({ resid: "r6", data: "d1", cont: false }); // final chunk
        await gen.next(false); // yields d1
        const done = await gen.next(false); // sees !cont -> returns (natural completion)
        expect(done.done).toBe(true);
        expect(router.sent.some((m) => m.cancel === true)).toBe(false);
    });

    describe("timeout path", () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it("injects a timeout error when no response arrives", async () => {
            const openRpcs = new Map<string, ClientRpcEntry>();
            const gen = sendRpcCommand(openRpcs, { command: "x", reqid: "r4", timeout: 1000 });
            vi.advanceTimersByTime(1000);
            await expect(gen.next(false)).rejects.toThrow(/EC-TIME/);
        });
    });
});

describe("WshClient.wshRpcCall without a timeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // a lost response (a dropped link, a stale queued command) must not leave the call pending forever:
    // pollers gate on an in-flight flag and would never poll again
    it("rejects once the client-side safety bound passes, without putting a timeout on the wire", async () => {
        const { WshClient } = await import("./wshclient");
        const client = new WshClient("tab:me");
        const call = client.wshRpcCall("x", {}, undefined);
        const settled = expect(call).rejects.toThrow(/EC-TIME/);
        await vi.advanceTimersByTimeAsync(60000);
        await settled;
        expect(router.sent[0].timeout).toBeUndefined();
        expect(client.openRpcs.size).toBe(0);
    });
});
