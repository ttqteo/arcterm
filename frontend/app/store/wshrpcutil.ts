// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { reloadCachedWaveObjects } from "@/app/store/wos";
import { setWpsRpcClient, wpsReconnectHandler } from "@/app/store/wps";
import { TabClient } from "@/app/store/tabrpcclient";
import { WshRouter } from "@/app/store/wshrouter";
import { getWSServerEndpoint } from "@/util/endpoints";
import { addWSReconnectHandler, globalWS, initGlobalWS, WSControl } from "./ws";
import { DefaultRouter, setDefaultRouter } from "./wshrpcutil-base";

let TabRpcClient: TabClient;

// a browser WebSocket can't set an X-AuthKey header, so the key rides the connect URL.
function initWshrpc(routeId: string, authKey?: string): WSControl {
    const router = new WshRouter(new UpstreamWshRpcProxy());
    setDefaultRouter(router);
    const handleFn = (event: WSEventType) => {
        DefaultRouter.recvRpcMessage(event.data);
    };
    initGlobalWS(getWSServerEndpoint(), routeId, handleFn, authKey);
    globalWS.connectNow("connectWshrpc");
    TabRpcClient = new TabClient(routeId);
    setWpsRpcClient(TabRpcClient);
    DefaultRouter.registerRoute(TabRpcClient.routeId, TabRpcClient);
    addWSReconnectHandler(() => {
        DefaultRouter.reannounceRoutes();
    });
    addWSReconnectHandler(wpsReconnectHandler);
    // after wps's handler, so the event subscriptions go out again before the refetches
    addWSReconnectHandler(reloadCachedWaveObjects);
    return globalWS;
}

class UpstreamWshRpcProxy implements AbstractWshClient {
    recvRpcMessage(msg: RpcMessage): void {
        const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
        globalWS?.pushMessage(wsMsg);
    }
}

export { DefaultRouter, initWshrpc, TabRpcClient };
export { sendRpcCommand, sendRpcResponse, shutdownWshrpc } from "./wshrpcutil-base";
