// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendRpcCommand, sendRpcResponse } from "@/app/store/wshrpcutil-base";
import { RpcResponseHelper, WshClient } from "./wshclient";

vi.mock("@/app/store/wshrpcutil-base", () => ({
    sendRpcResponse: vi.fn(),
    sendRpcCommand: vi.fn(),
}));

describe("RpcResponseHelper", () => {
    beforeEach(() => vi.clearAllMocks());

    it("is done immediately when the command carries no reqid (no response expected)", () => {
        const client = new WshClient("tab:me");
        const helper = new RpcResponseHelper(client, { command: "x" });
        helper.sendResponse({ data: 1 });
        expect(sendRpcResponse).not.toHaveBeenCalled();
    });

    it("stamps resid + source, forwards the response, and finalizes when not continuing", () => {
        const client = new WshClient("tab:me");
        client.openRpcs.set("r1", { reqId: "r1", startTs: 0, command: "x", msgFn: vi.fn() });
        const helper = new RpcResponseHelper(client, { command: "x", reqid: "r1", source: "tab:src" });
        helper.sendResponse({ data: "ok" });
        expect(sendRpcResponse).toHaveBeenCalledWith({ data: "ok", resid: "r1", source: "tab:me" });
        expect(client.openRpcs.has("r1")).toBe(false);
        (sendRpcResponse as any).mockClear();
        helper.sendResponse({ data: "again" });
        expect(sendRpcResponse).not.toHaveBeenCalled();
    });

    it("keeps the rpc open for a continuing response", () => {
        const client = new WshClient("tab:me");
        client.openRpcs.set("r1", { reqId: "r1", startTs: 0, command: "x", msgFn: vi.fn() });
        const helper = new RpcResponseHelper(client, { command: "x", reqid: "r1", source: "tab:src" });
        helper.sendResponse({ data: "chunk", cont: true });
        expect(client.openRpcs.has("r1")).toBe(true);
    });

    it("exposes the command source", () => {
        const client = new WshClient("tab:me");
        const helper = new RpcResponseHelper(client, { command: "x", source: "tab:src" });
        expect(helper.getSource()).toBe("tab:src");
    });
});

describe("WshClient.wshRpcCall message building", () => {
    beforeEach(() => vi.clearAllMocks());

    it("builds a call message with a generated reqid and routes it through sendRpcCommand", async () => {
        const gen = { next: vi.fn().mockResolvedValue({ value: "result", done: false }) };
        (sendRpcCommand as any).mockReturnValue(gen);
        const client = new WshClient("tab:me");
        const rtn = await client.wshRpcCall("mycmd", { a: 1 }, { timeout: 5000, route: "tab:dest" } as RpcOpts);
        expect(rtn).toBe("result");
        const sentMsg = (sendRpcCommand as any).mock.calls[0][1] as RpcMessage;
        expect(sentMsg.command).toBe("mycmd");
        expect(sentMsg.source).toBe("tab:me");
        expect(sentMsg.timeout).toBe(5000);
        expect(sentMsg.route).toBe("tab:dest");
        expect(sentMsg.reqid).toBeTruthy();
        expect(gen.next).toHaveBeenCalledWith(true);
    });

    it("omits reqid and returns null on a noresponse call", async () => {
        (sendRpcCommand as any).mockReturnValue(null);
        const client = new WshClient("tab:me");
        const rtn = await client.wshRpcCall("fire", {}, { noresponse: true } as RpcOpts);
        expect(rtn).toBeNull();
        const sentMsg = (sendRpcCommand as any).mock.calls[0][1] as RpcMessage;
        expect(sentMsg.reqid).toBeUndefined();
    });

    it("wshRpcStream rejects noresponse", () => {
        const client = new WshClient("tab:me");
        expect(() => client.wshRpcStream("s", {}, { noresponse: true } as RpcOpts)).toThrow(/noresponse not supported/);
    });
});

describe("WshClient.handleIncomingCommand dispatch", () => {
    beforeEach(() => vi.clearAllMocks());

    it("dispatches to a matching handle_<command> and returns its result", async () => {
        class MyClient extends WshClient {
            async handle_ping(_helper: RpcResponseHelper, data: any) {
                return { pong: data };
            }
        }
        const client = new MyClient("tab:me");
        await client.handleIncomingCommand({ command: "ping", reqid: "r1", data: "hi" });
        expect(sendRpcResponse).toHaveBeenCalledWith(
            expect.objectContaining({ data: { pong: "hi" }, resid: "r1", source: "tab:me" })
        );
    });

    it("routes an unknown command to handle_default and reports the thrown error", async () => {
        const client = new WshClient("tab:me");
        await client.handleIncomingCommand({ command: "nope", reqid: "r1" });
        expect(sendRpcResponse).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.stringContaining("not supported"), resid: "r1" })
        );
    });
});

describe("WshClient.handleIncomingCommand settling", () => {
    class SlowClient extends WshClient {
        async handle_ping() {
            return "pong";
        }
        handle_hang() {
            return new Promise(() => {});
        }
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });
    afterEach(() => vi.useRealTimers());

    it("answers a handler that never settles with a timeout error", async () => {
        const client = new SlowClient("tab:me");
        void client.handleIncomingCommand({ command: "hang", reqid: "r1" });
        await vi.advanceTimersByTimeAsync(30000);
        expect(sendRpcResponse).toHaveBeenCalledExactlyOnceWith({
            error: 'rpc handler for command "hang" timed out',
            resid: "r1",
            source: "tab:me",
        });
    });

    it("leaves no timeout timer behind once the handler answers", async () => {
        const client = new SlowClient("tab:me");
        await client.handleIncomingCommand({ command: "ping", reqid: "r1" });
        expect(sendRpcResponse).toHaveBeenCalledExactlyOnceWith({ data: "pong", resid: "r1", source: "tab:me" });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("still closes the rpc with an empty response when both earlier sends fail", async () => {
        const linkDown = () => {
            throw new Error("link down");
        };
        (sendRpcResponse as any).mockImplementationOnce(linkDown).mockImplementationOnce(linkDown);
        const client = new SlowClient("tab:me");
        await expect(client.handleIncomingCommand({ command: "ping", reqid: "r1" })).rejects.toThrow("link down");
        expect(sendRpcResponse).toHaveBeenCalledTimes(3);
        expect(sendRpcResponse).toHaveBeenLastCalledWith({ resid: "r1", source: "tab:me" });
    });
});

describe("WshClient.recvRpcMessage", () => {
    beforeEach(() => vi.clearAllMocks());

    it("treats a message with a command as an incoming request", () => {
        const client = new WshClient("tab:me");
        const spy = vi.spyOn(client, "handleIncomingCommand").mockResolvedValue(undefined);
        client.recvRpcMessage({ command: "x", reqid: "r1" });
        expect(spy).toHaveBeenCalled();
    });

    it.each([
        ["a command alone", { command: "x" }],
        ["a reqid alone", { reqid: "r1" }],
    ])("treats a message carrying %s as an incoming request", (_what, msg: RpcMessage) => {
        const client = new WshClient("tab:me");
        const spy = vi.spyOn(client, "handleIncomingCommand").mockResolvedValue(undefined);
        client.recvRpcMessage(msg);
        expect(spy).toHaveBeenCalledExactlyOnceWith(msg);
    });

    it("delivers a response to the matching open rpc entry", () => {
        const client = new WshClient("tab:me");
        const msgFn = vi.fn();
        client.openRpcs.set("r1", { reqId: "r1", startTs: 0, command: "x", msgFn });
        const resp: RpcMessage = { resid: "r1", data: "v" };
        client.recvRpcMessage(resp);
        expect(msgFn).toHaveBeenCalledWith(resp);
    });

    it("does not misroute a response with no resid or an unknown resid", () => {
        const client = new WshClient("tab:me");
        const msgFn = vi.fn();
        client.openRpcs.set("r1", { reqId: "r1", startTs: 0, command: "x", msgFn });
        client.recvRpcMessage({ data: "orphan" }); // no resid -> discarded
        client.recvRpcMessage({ resid: "ghost", data: "v" }); // unknown resid -> discarded
        expect(msgFn).not.toHaveBeenCalled(); // the real open rpc was never touched
    });
});
