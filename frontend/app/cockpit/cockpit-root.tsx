// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { ContextMenuHost } from "@/app/element/contextmenuhost";
import { PulseDriver } from "@/app/element/pulsedriver";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { buildGlobalBindings, buildListNavBindings } from "@/app/store/keybindings/bindings";
import { initKeybindingDispatcher } from "@/app/store/keybindings/dispatcher";
import { useKeybindings } from "@/app/store/keybindings/store";
import { getTabModelByTabId } from "@/app/store/tab-model";
import { AgentsViewModel } from "@/app/view/agents/agents";
import { coerceStartupSurface, startupSurfaceAtom } from "@/app/view/agents/cockpitprefsstore";
import { enterFocusFor, focusRestoredAtom, persistedFocusAtom } from "@/app/view/agents/focusstore";
import { useApplyCockpitTheme } from "@/app/view/agents/themestore";
import { useApplyCockpitFonts } from "@/app/view/agents/fontstore";
import { CockpitShell } from "@/app/view/agents/cockpitshell";
import { NowTicker } from "@/app/view/agents/nowticker";
import { setPathLinkModel } from "@/app/view/agents/pathlinkroute";
import { BackgroundAgentsPoller } from "@/app/view/agents/backgroundagentspoller";
import { AttentionPoller } from "@/app/view/agents/attentionpoller";
import { NewAgentModal } from "@/app/view/agents/newagentmodal";
import { NewInitiativeHost } from "@/app/view/jarvis/newinitiativecontrol";
import { NewRunModalHost } from "@/app/view/jarvis/newruncontrol";
import { NewProjectModal } from "@/app/view/agents/newprojectmodal";
import { PetSources } from "@/app/view/jarvis/petsources";
import { PetView } from "@/app/view/jarvis/petview";
import { WaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { makeWaveEnvImpl } from "@/app/waveenv/waveenvimpl";
import { Provider } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import { CockpitAppBar } from "./app-bar";
import { CommandPalette } from "./command-palette";
import "./cockpit.scss";
import { ctrlHeldAtom, nextCtrlHeld } from "./ctrlheld";
import { ShortcutsCheatSheet } from "./shortcuts-cheatsheet";
import { makeSyntheticNodeModel } from "./synthetic-node-model";
import { HintsFooter } from "./hints-footer";
import { setupOpenFileSubscription } from "./openfilestore";
import { setupUiClient } from "./uiclient";
import { NotificationToasts } from "./notificationtoasts";

const AgentsBlockId = "cockpit-agents";

export function CockpitRoot() {
    const waveEnvRef = useRef(makeWaveEnvImpl());
    return (
        <Provider store={globalStore}>
            <WaveEnvContext.Provider value={waveEnvRef.current}>
                <div className="cockpit-shell">
                    <CockpitBody waveEnv={waveEnvRef.current} />
                </div>
            </WaveEnvContext.Provider>
        </Provider>
    );
}

// Inside the Provider so useAtomValue resolves to globalStore (the boot store), not jotai's default.
function CockpitBody({ waveEnv }: { waveEnv: WaveEnv }) {
    const agentsModelRef = useRef<AgentsViewModel>(null);
    const tabIdRef = useRef<string>(null);
    if (agentsModelRef.current == null) {
        tabIdRef.current = globalStore.get(atoms.staticTabId);
        const model = new AgentsViewModel({
            blockId: AgentsBlockId,
            nodeModel: makeSyntheticNodeModel(AgentsBlockId),
            tabModel: getTabModelByTabId(tabIdRef.current, waveEnv),
            waveEnv,
        });
        // Open the user's chosen startup surface (defaults to "cockpit", matching prior behavior).
        globalStore.set(model.surfaceAtom, coerceStartupSurface(globalStore.get(startupSurfaceAtom)));
        // Restore the focus the cockpit was closed on. enterFocusFor re-resolves the bundle, so a target
        // that died while the app was shut reports through the usual degrade path rather than
        // restoring a scope that matches nothing. It also restores the focus's project: the project
        // filter is not persisted, and a focus under "All projects" counts rows it never meant to.
        const saved = globalStore.get(persistedFocusAtom);
        if (saved != null) {
            enterFocusFor(model, saved);
            globalStore.set(focusRestoredAtom, true);
        }
        agentsModelRef.current = model;
    }
    const model = agentsModelRef.current;
    useApplyCockpitTheme();
    useApplyCockpitFonts();
    useEffect(() => initKeybindingDispatcher(model), [model]);
    useEffect(() => {
        setupOpenFileSubscription(model);
    }, [model]);
    useEffect(() => {
        setPathLinkModel(model);
        return () => setPathLinkModel(null);
    }, [model]);
    useEffect(() => setupUiClient(model), [model]);
    // Kill the native browser context menu app-wide so it never leaks on elements without a themed
    // handler (e.g. navrail items). Themed menus (ContextMenuModel) render via portal and are
    // unaffected — preventDefault only suppresses the native menu. Native stays only inside editable
    // fields, where right-click copy/paste is expected.
    useEffect(() => {
        const onContextMenu = (e: MouseEvent) => {
            const el = e.target as HTMLElement | null;
            if (el?.closest("input, textarea") || el?.isContentEditable) {
                return;
            }
            e.preventDefault();
        };
        window.addEventListener("contextmenu", onContextMenu);
        return () => window.removeEventListener("contextmenu", onContextMenu);
    }, []);
    // capture phase: a focused xterm stops key events from bubbling to the window
    useEffect(() => {
        const track = (e: Event) => {
            const held = nextCtrlHeld(globalStore.get(ctrlHeldAtom), e as KeyboardEvent);
            globalStore.set(ctrlHeldAtom, held);
            if (held) {
                document.documentElement.dataset.ctrlHeld = "";
            } else {
                delete document.documentElement.dataset.ctrlHeld;
            }
        };
        window.addEventListener("keydown", track, true);
        window.addEventListener("keyup", track, true);
        window.addEventListener("blur", track);
        return () => {
            window.removeEventListener("keydown", track, true);
            window.removeEventListener("keyup", track, true);
            window.removeEventListener("blur", track);
        };
    }, []);
    const globalBindings = useMemo(() => buildGlobalBindings(model), [model]);
    useKeybindings(globalBindings);
    const listNavBindings = useMemo(() => buildListNavBindings(model), [model]);
    useKeybindings(listNavBindings);
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <NowTicker model={model} />
            <BackgroundAgentsPoller />
            <AttentionPoller />
            <PulseDriver />
            <PetSources model={model} />
            <CockpitAppBar model={model} />
            <div className="min-h-0 flex-1">
                <CockpitShell model={model} tabId={tabIdRef.current} />
            </div>
            <HintsFooter model={model} />
            <NewProjectModal model={model} />
            <NewAgentModal model={model} />
            <NewRunModalHost model={model} />
            <NewInitiativeHost model={model} />
            <CommandPalette model={model} />
            <ShortcutsCheatSheet model={model} />
            {/* window chrome, not a surface: every surface but Agent unmounts on a nav switch, and the
                creature is the one object in the app that has to survive that */}
            <PetView model={model} />
            <ModalsRenderer />
            <ContextMenuHost />
            <NotificationToasts />
        </div>
    );
}


