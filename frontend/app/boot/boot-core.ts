// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Shell-agnostic boot: connect wshrpc on the real tab route, init global model/atoms, pin the
// client/window/tab/workspace objects, load config.
import { loadBadges } from "@/app/store/badge";
import { GlobalModel } from "@/app/store/global-model";
import { registerControlShiftStateUpdateHandler } from "@/app/store/keymodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeTabRouteId } from "@/app/store/wshrouter";
import { initWshrpc, TabRpcClient } from "@/app/store/wshrpcutil";
import { setupAgentAskSubscription } from "@/app/view/agents/agentaskstore";
import { setupControllerStatusSubscription } from "@/app/view/agents/agentcontrollerstore";
import { setupChildAskSubscription } from "@/app/view/agents/childaskstore";
import { startClaudeQuotaPolling } from "@/app/view/agents/claudequota";
import { setupAgentStatusSubscription } from "@/app/view/agents/session-models/agentstatusstore";
import {
    atoms,
    getApi,
    globalStore,
    initGlobal,
    initGlobalWaveEventSubs,
} from "@/store/global";
import { activeTabIdAtom } from "@/store/tab-model";
import * as WOS from "@/store/wos";

export async function bootWaveCore(initOpts: WaveInitOpts): Promise<void> {
    const platform = getApi().getPlatform();
    getApi().sendLog("Boot Wave Core " + JSON.stringify(initOpts));
    const globalInitOpts: GlobalInitOptions = {
        tabId: initOpts.tabId,
        clientId: initOpts.clientId,
        windowId: initOpts.windowId,
        platform,
    };
    globalStore.set(activeTabIdAtom, initOpts.tabId);
    await GlobalModel.getInstance().initialize(globalInitOpts);
    initGlobal(globalInitOpts);
    (window as any).globalAtoms = atoms;

    const authKey = getApi().getAuthKey();
    const globalWS = initWshrpc(makeTabRouteId(initOpts.tabId), authKey || undefined);
    (window as any).globalWS = globalWS;
    (window as any).TabRpcClient = TabRpcClient;

    try {
        await loadBadges();
        initGlobalWaveEventSubs();
        // agent cockpit event ingestion: subscribe to agent:status (state/usage/subagents) and
        // agent:ask. the only caller used to be sessionsidebar.tsx, removed in the phase 5b cockpit
        // teardown — without these the cockpit never receives agent status, so the roster shows only
        // pending-launch placeholders and the narration card body stays empty.
        setupAgentStatusSubscription();
        setupAgentAskSubscription();
        setupControllerStatusSubscription();
        setupChildAskSubscription();
        // the Claude account's 5-hour and weekly windows, known before any claude session runs
        startClaudeQuotaPolling();
        const [_client, waveWindow, initialTab] = await Promise.all([
            WOS.loadAndPinWaveObject<Client>(WOS.makeORef("client", initOpts.clientId)),
            WOS.loadAndPinWaveObject<WaveWindow>(WOS.makeORef("window", initOpts.windowId)),
            WOS.loadAndPinWaveObject<Tab>(WOS.makeORef("tab", initOpts.tabId)),
        ]);
        const ws = await WOS.loadAndPinWaveObject<Workspace>(WOS.makeORef("workspace", waveWindow.workspaceid));
        ws?.tabids?.forEach((tabid) => WOS.getObjectValue<Tab>(WOS.makeORef("tab", tabid)));
        WOS.wpsSubscribeToObject(WOS.makeORef("workspace", waveWindow.workspaceid));
        document.title = `arcterm - ${initialTab.name}`;
    } catch (e) {
        console.error("Failed initialization error", e);
        getApi().sendLog("Error in bootWaveCore (loading required objects) " + e.message + "\n" + e.stack);
    }
    registerControlShiftStateUpdateHandler();
    const fullConfig = await RpcApi.GetFullConfigCommand(TabRpcClient);
    globalStore.set(atoms.fullConfigAtom, fullConfig);
}
