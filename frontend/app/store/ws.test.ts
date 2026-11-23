// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkSilent, WSControl } from "./ws";

describe("linkSilent", () => {
    it("calls a link dead after 45 s of silence on on-time ticks", () => {
        expect(linkSilent(100_000, 95_000, 60_000)).toBe(false);
        expect(linkSilent(100_000, 95_000, 54_000)).toBe(true);
    });

    it("never judges on a late tick: the main thread stalled, messages may be unread", () => {
        expect(linkSilent(100_000, 70_000, 0)).toBe(false);
    });
});

function makeWS(): WSControl {
    const ws = new WSControl("", "stable", vi.fn());
    ws.wsConn = { send: vi.fn(), close: vi.fn() } as any;
    return ws;
}

function pushCmd(ws: WSControl, reqid: string) {
    ws.pushMessage({ wscommand: "rpc", message: { reqid } } as any);
}

describe("WSControl message queue", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("caps the disconnected backlog by dropping the oldest", () => {
        const ws = makeWS();
        for (let i = 0; i < 205; i++) {
            pushCmd(ws, "r" + i);
        }
        expect(ws.msgQueue.length).toBe(200);
        expect((ws.msgQueue[0].data as any).message.reqid).toBe("r5");
        expect((ws.msgQueue[ws.msgQueue.length - 1].data as any).message.reqid).toBe("r204");
    });

    it("sends fresh queued messages after reconnect", () => {
        const ws = makeWS();
        const send = ws.wsConn.send as any;
        pushCmd(ws, "fresh");
        ws.open = true;
        ws.runMsgQueue();
        expect(send).toHaveBeenCalledWith(JSON.stringify({ wscommand: "rpc", message: { reqid: "fresh" } }));
        expect(ws.msgQueue.length).toBe(0);
    });

    it("drops stale queued commands on drain instead of head-of-line blocking fresh traffic", () => {
        const ws = makeWS();
        const send = ws.wsConn.send as any;
        pushCmd(ws, "old");
        vi.setSystemTime(Date.now() + 6000);
        ws.open = true;
        ws.runMsgQueue();
        expect(ws.msgQueue.length).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });

    it("parses frames defensively and answers pings", () => {
        const ws = makeWS();
        const send = ws.wsConn.send as any;
        expect(() => ws.onmessage({ data: "{not json" } as any)).not.toThrow();
        ws.onmessage({ data: JSON.stringify({ type: "ping" }) } as any);
        expect(JSON.parse(send.mock.calls[0][0])).toEqual({ type: "pong", stime: expect.any(Number) });
    });

    it("drops an open link that has been silent past the limit and reconnects", () => {
        const ws = makeWS();
        const dead = ws.wsConn as any;
        const connectNow = vi.spyOn(ws, "connectNow").mockImplementation(() => {});
        ws.open = true;
        ws.lastRecvTs = Date.now();
        // ticks on time, nothing arriving
        for (let i = 0; i < 10; i++) {
            vi.advanceTimersByTime(5000);
        }
        expect(dead.close).toHaveBeenCalled();
        expect(dead.onclose).toBeNull();
        expect(ws.open).toBe(false);
        vi.advanceTimersByTime(2000);
        expect(connectNow).toHaveBeenCalled();
    });

    it("keeps a link that keeps bringing messages", () => {
        const ws = makeWS();
        ws.open = true;
        ws.lastRecvTs = Date.now();
        for (let i = 0; i < 20; i++) {
            vi.advanceTimersByTime(5000);
            ws.onmessage({ data: JSON.stringify({ type: "pong" }) } as any);
        }
        expect(ws.open).toBe(true);
        expect(ws.wsConn.close).not.toHaveBeenCalled();
    });

    it("clears the ping interval on shutdown", () => {
        const ws = makeWS();
        expect(ws.pingIntervalId).toBeTruthy();
        ws.shutdown();
        expect(ws.noReconnect).toBe(true);
        expect(ws.pingIntervalId).toBeNull();
    });
});
