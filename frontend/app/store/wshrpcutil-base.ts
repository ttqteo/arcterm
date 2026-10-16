// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WshRouter } from "@/app/store/wshrouter";
import { globalWS } from "./ws";

let DefaultRouter: WshRouter;

function setDefaultRouter(router: WshRouter) {
    DefaultRouter = router;
}

async function* rpcResponseGenerator(
    openRpcs: Map<string, ClientRpcEntry>,
    command: string,
    reqid: string,
    timeout: number
): AsyncGenerator<any, void, boolean> {
    const msgQueue: RpcMessage[] = [];
    let signalFn: () => void;
    let signalPromise = new Promise<void>((resolve) => (signalFn = resolve));
    let timeoutId: NodeJS.Timeout = null;
    if (timeout > 0) {
        timeoutId = setTimeout(() => {
            msgQueue.push({ resid: reqid, error: "EC-TIME: timeout waiting for response" });
            signalFn();
        }, timeout);
    }
    const msgFn = (msg: RpcMessage) => {
        msgQueue.push(msg);
        signalFn();
        // reset signal promise
        signalPromise = new Promise<void>((resolve) => (signalFn = resolve));
    };
    openRpcs.set(reqid, {
        reqId: reqid,
        startTs: Date.now(),
        command: command,
        msgFn: msgFn,
    });
    yield null;
    try {
        while (true) {
            while (msgQueue.length > 0) {
                const msg = msgQueue.shift()!;
                if (msg.error != null) {
                    throw new Error(msg.error);
                }
                if (!msg.cont && msg.data == null) {
                    return;
                }
                const shouldTerminate = yield msg.data;
                if (shouldTerminate) {
                    sendRpcCancel(reqid);
                    return;
                }
                if (!msg.cont) {
                    return;
                }
            }
            await signalPromise;
        }
    } finally {
        openRpcs.delete(reqid);
        if (timeoutId != null) {
            clearTimeout(timeoutId);
        }
    }
}

function sendRpcCancel(reqid: string) {
    const rpcMsg: RpcMessage = { reqid: reqid, cancel: true };
    DefaultRouter.recvRpcMessage(rpcMsg);
}

function sendRpcResponse(msg: RpcMessage) {
    DefaultRouter.recvRpcMessage(msg);
}

// localTimeoutMs bounds the wait on this side only when msg carries no timeout; it is not sent on the wire
function sendRpcCommand(
    openRpcs: Map<string, ClientRpcEntry>,
    msg: RpcMessage,
    localTimeoutMs?: number
): AsyncGenerator<RpcMessage, void, boolean> {
    DefaultRouter.recvRpcMessage(msg);
    if (msg.reqid == null) {
        return null;
    }
    const reqid = msg.reqid;
    const rtnGen = rpcResponseGenerator(openRpcs, msg.command, reqid, msg.timeout || localTimeoutMs);
    rtnGen.next();
    // Early teardown of a stream (a consumer calling gen.return() on card unmount) must reach the
    // server so its streaming goroutine + any fsnotify watcher unwind while the link is still up.
    // The generator's finally can't be relied on for this: when it is parked at `await signalPromise`
    // (a quiet stream between chunks), return() queues behind that never-settling await and finally
    // never runs. So send the wire cancel synchronously here, before delegating to the real return().
    // Idempotent server-side (a done/unknown reqId is a no-op), so a natural-completion return() that
    // also passes through is harmless. for-await only calls return() on early exit, not normal end.
    const origReturn = rtnGen.return.bind(rtnGen);
    let cancelSent = false;
    rtnGen.return = ((value?: any) => {
        if (!cancelSent) {
            cancelSent = true;
            sendRpcCancel(reqid);
        }
        return origReturn(value);
    }) as typeof rtnGen.return;
    return rtnGen;
}

async function consumeGenerator(gen: AsyncGenerator<any, any, any>) {
    let idx = 0;
    try {
        for await (const msg of gen) {
            console.log("gen", idx, msg);
            idx++;
        }
        const result = await gen.return(undefined);
        console.log("gen done", result.value);
    } catch (e) {
        console.log("gen error", e);
    }
}

if (globalThis.window != null) {
    globalThis["consumeGenerator"] = consumeGenerator;
}

function shutdownWshrpc() {
    globalWS?.shutdown();
}

export { DefaultRouter, sendRpcCommand, sendRpcResponse, setDefaultRouter, shutdownWshrpc };
