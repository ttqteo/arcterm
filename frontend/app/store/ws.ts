// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildWsConnUrl, type WebSocket, newWebSocket } from "@/util/wsutil";
import debug from "debug";
import { sprintf } from "sprintf-js";

const dlog = debug("wave:ws");

const WarnWebSocketSendSize = 1024 * 1024; // 1MB
const MaxWebSocketSendSize = 5 * 1024 * 1024; // 5MB
const reconnectHandlers: (() => void)[] = [];
const StableConnTime = 2000;
// bound the disconnected backlog so a long outage can't flood stale RPCs back at 10/s after reconnect
const MsgQueueMaxSize = 200;
// commands queued longer than this are stale by the time we reconnect — drop them on drain instead of
// head-of-line blocking fresh traffic (poller RPCs are idempotent; reconnect handlers re-issue state)
const MsgQueueMaxAgeMs = 5000;
const PingIntervalMs = 5000;
// An open link that has brought nothing this long is dead: wavesrv pings every 10 s and answers each of ours. On
// 2026-11-23 its write loop ended with the socket left open, and the cockpit sat on that link three minutes, every
// request timing out, until arcterm restarted. Well past wavesrv's 30 s write wait (pkg/web/ws.go).
const SilentLinkMs = 45_000;
// A ping tick this late means the main thread (or the hidden page's timers) stalled: messages may be waiting unread,
// so the silence is not the link's.
const LateTickMs = 3 * PingIntervalMs;

/** Pure: whether an open link that brought its last message at `lastRecv` is dead at tick `now`, the previous tick
 *  having run at `lastTick`. A late tick never judges it. */
export function linkSilent(now: number, lastTick: number, lastRecv: number): boolean {
    if (lastTick > 0 && now - lastTick > LateTickMs) {
        return false;
    }
    return now - lastRecv > SilentLinkMs;
}

// the WebView2 console is not in waveapp.log; the host's sendLog is (absent in tests)
function feLog(msg: string) {
    try {
        (globalThis as any).api?.sendLog?.("[ws] " + msg);
    } catch {
        // logging never breaks the link
    }
}

type QueuedMessage = {
    data: WSCommandType;
    ts: number;
};

function addWSReconnectHandler(handler: () => void) {
    reconnectHandlers.push(handler);
}

function removeWSReconnectHandler(handler: () => void) {
    const index = reconnectHandlers.indexOf(handler);
    if (index > -1) {
        reconnectHandlers.splice(index, 1);
    }
}

type WSEventCallback = (arg0: WSEventType) => void;

class WSControl {
    wsConn: WebSocket;
    open: boolean;
    opening: boolean = false;
    reconnectTimes: number = 0;
    msgQueue: QueuedMessage[] = [];
    stableId: string;
    messageCallback: WSEventCallback;
    baseHostPort: string;
    lastReconnectTime: number = 0;
    authKey: string;
    noReconnect: boolean = false;
    onOpenTimeoutId: NodeJS.Timeout = null;
    pingIntervalId: NodeJS.Timeout = null;
    // when the open link last brought a message, and when the ping tick last ran (linkSilent)
    lastRecvTs: number = 0;
    lastTickTs: number = 0;
    // a link was open before, so the next open is a reconnect worth a log line
    everOpened: boolean = false;

    constructor(baseHostPort: string, stableId: string, messageCallback: WSEventCallback, authKey?: string) {
        this.baseHostPort = baseHostPort;
        this.messageCallback = messageCallback;
        this.stableId = stableId;
        this.open = false;
        this.authKey = authKey;
        this.pingIntervalId = setInterval(this.sendPing.bind(this), PingIntervalMs);
    }

    shutdown() {
        this.noReconnect = true;
        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
            this.pingIntervalId = null;
        }
        this.wsConn.close();
    }

    connectNow(desc: string) {
        if (this.open || this.noReconnect) {
            return;
        }
        this.lastReconnectTime = Date.now();
        dlog("try reconnect:", desc);
        this.opening = true;
        this.wsConn = newWebSocket(buildWsConnUrl(this.baseHostPort, this.stableId, this.authKey ?? null), null);
        this.wsConn.onopen = (e: Event) => {
            this.onopen(e);
        };
        this.wsConn.onmessage = (e: MessageEvent) => {
            this.onmessage(e);
        };
        this.wsConn.onclose = (e: CloseEvent) => {
            this.onclose(e);
        };
        // turns out onerror is not necessary (onclose always follows onerror)
        // this.wsConn.onerror = this.onerror;
    }

    reconnect(forceClose?: boolean) {
        if (this.noReconnect) {
            return;
        }
        if (this.open) {
            if (forceClose) {
                this.wsConn.close(); // this will force a reconnect
            }
            return;
        }
        this.reconnectTimes++;
        if (this.reconnectTimes > 20) {
            dlog("cannot connect, giving up");
            feLog("cannot connect to wavesrv after 20 tries, giving up");
            return;
        }
        const timeoutArr = [0, 0, 2, 5, 10, 10, 30, 60];
        let timeout = 60;
        if (this.reconnectTimes < timeoutArr.length) {
            timeout = timeoutArr[this.reconnectTimes];
        }
        if (Date.now() - this.lastReconnectTime < 500) {
            timeout = 1;
        }
        if (timeout > 0) {
            dlog(sprintf("sleeping %ds", timeout));
        }
        setTimeout(() => {
            this.connectNow(String(this.reconnectTimes));
        }, timeout * 1000);
    }

    onclose(event: CloseEvent) {
        // console.log("close", event);
        if (this.onOpenTimeoutId) {
            clearTimeout(this.onOpenTimeoutId);
        }
        if (event.wasClean) {
            dlog("connection closed");
        } else {
            dlog("connection error/disconnected");
        }
        if (this.open) {
            feLog(`link closed (code ${event.code}${event.wasClean ? "" : ", unclean"}), reconnecting`);
        }
        if (this.open || this.opening) {
            this.open = false;
            this.opening = false;
            this.reconnect();
        }
    }

    onopen(e: Event) {
        dlog("connection open");
        if (this.everOpened) {
            feLog(`link reopened (try ${this.reconnectTimes})`);
        }
        this.everOpened = true;
        this.open = true;
        this.opening = false;
        this.lastRecvTs = Date.now();
        this.onOpenTimeoutId = setTimeout(() => {
            this.reconnectTimes = 0;
            dlog("clear reconnect times");
        }, StableConnTime);
        for (let handler of reconnectHandlers) {
            handler();
        }
        this.runMsgQueue();
    }

    runMsgQueue() {
        if (!this.open) {
            return;
        }
        if (this.msgQueue.length == 0) {
            return;
        }
        const entry = this.msgQueue.shift();
        if (Date.now() - entry.ts > MsgQueueMaxAgeMs) {
            // stale command: drop it so fresh traffic isn't head-of-line blocked behind an old backlog
            setTimeout(() => {
                this.runMsgQueue();
            }, 100);
            return;
        }
        this.sendMessage(entry.data);
        setTimeout(() => {
            this.runMsgQueue();
        }, 100);
    }

    onmessage(event: MessageEvent) {
        this.lastRecvTs = Date.now();
        let eventData = null;
        if (event.data != null) {
            try {
                eventData = JSON.parse(event.data);
            } catch (e) {
                dlog("bad ws frame", e);
                return;
            }
        }
        if (eventData == null) {
            return;
        }
        if (eventData.type == "ping") {
            this.wsConn.send(JSON.stringify({ type: "pong", stime: Date.now() }));
            return;
        }
        if (eventData.type == "pong") {
            // nothing
            return;
        }
        if (this.messageCallback) {
            try {
                this.messageCallback(eventData);
            } catch (e) {
                console.log("[error] messageCallback", e);
            }
        }
    }

    sendPing() {
        const now = Date.now();
        const lastTick = this.lastTickTs;
        this.lastTickTs = now;
        if (!this.open) {
            return;
        }
        if (lastTick > 0 && now - lastTick > LateTickMs) {
            // stalled: what arrived meanwhile may still be unread, so the silence starts over
            this.lastRecvTs = now;
        } else if (linkSilent(now, lastTick, this.lastRecvTs)) {
            this.dropSilentLink(now - this.lastRecvTs);
            return;
        }
        this.wsConn.send(JSON.stringify({ type: "ping", stime: now }));
    }

    // Leaves a link that went silent and opens a new one. Its close handshake would wait on a wavesrv that answers
    // nothing, so its handlers are cut first and the reconnect does not wait for its onclose.
    dropSilentLink(silentMs: number) {
        feLog(`link silent ${Math.round(silentMs / 1000)}s while open, dropping it and reconnecting`);
        const dead = this.wsConn;
        if (dead) {
            dead.onopen = null;
            dead.onmessage = null;
            dead.onclose = null;
            try {
                dead.close();
            } catch {
                // already closing
            }
        }
        if (this.onOpenTimeoutId) {
            clearTimeout(this.onOpenTimeoutId);
        }
        this.open = false;
        this.opening = false;
        this.reconnect();
    }

    sendMessage(data: WSCommandType) {
        if (!this.open) {
            return;
        }
        const msg = JSON.stringify(data);
        const byteSize = new Blob([msg]).size;
        if (byteSize > MaxWebSocketSendSize) {
            console.log("ws message too large", byteSize, data.wscommand, msg.substring(0, 100));
            return;
        }
        if (byteSize > WarnWebSocketSendSize) {
            console.log("ws message large", byteSize, data.wscommand, msg.substring(0, 100));
        }
        this.wsConn.send(msg);
    }

    pushMessage(data: WSCommandType) {
        if (!this.open) {
            if (data.wscommand === "rpc" && data.message) {
                const cmd = data.message.command;
                if (cmd === "routeannounce" || cmd === "routeunannounce") {
                    return;
                }
            }
            this.msgQueue.push({ data, ts: Date.now() });
            if (this.msgQueue.length > MsgQueueMaxSize) {
                this.msgQueue.shift(); // bound the backlog under a long outage
            }
            return;
        }
        this.sendMessage(data);
    }
}

let globalWS: WSControl;
function initGlobalWS(baseHostPort: string, stableId: string, messageCallback: WSEventCallback, authKey?: string) {
    globalWS = new WSControl(baseHostPort, stableId, messageCallback, authKey);
}

function sendRawRpcMessage(msg: RpcMessage) {
    const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
    sendWSCommand(wsMsg);
}

function sendWSCommand(cmd: WSCommandType) {
    globalWS?.pushMessage(cmd);
}

export {
    WSControl,
    addWSReconnectHandler,
    globalWS,
    initGlobalWS,
    removeWSReconnectHandler,
    sendRawRpcMessage,
    sendWSCommand,
};
