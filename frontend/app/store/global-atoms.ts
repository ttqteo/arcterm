// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, Atom, PrimitiveAtom } from "jotai";
import { globalStore } from "./jotaiStore";
import { setWaveWindowType } from "./windowtype";
import * as WOS from "./wos";

let atoms!: GlobalAtomsType;
const orefAtomCache = new Map<string, Map<string, Atom<any>>>();

function initGlobalAtoms(initOpts: GlobalInitOptions) {
    const windowIdAtom = atom(initOpts.windowId) as PrimitiveAtom<string>;
    setWaveWindowType(initOpts.isPreview ? "preview" : "tab");
    const uiContextAtom = atom((get) => {
        const uiContext: UIContext = {
            windowid: initOpts.windowId,
            activetabid: initOpts.tabId,
        };
        return uiContext;
    }) as Atom<UIContext>;

    const isFullScreenAtom = atom(false) as PrimitiveAtom<boolean>;
    try {
        getApi().onFullScreenChange((isFullScreen) => {
            globalStore.set(isFullScreenAtom, isFullScreen);
        });
    } catch (e) {
        console.log("failed to initialize isFullScreenAtom", e);
    }

    const zoomFactorAtom = atom(1.0) as PrimitiveAtom<number>;
    try {
        globalStore.set(zoomFactorAtom, getApi().getZoomFactor());
        getApi().onZoomFactorChange((zoomFactor) => {
            globalStore.set(zoomFactorAtom, zoomFactor);
        });
    } catch (e) {
        console.log("failed to initialize zoomFactorAtom", e);
    }

    const workspaceIdAtom: Atom<string> = atom((get) => {
        const windowData = WOS.getObjectValue<WaveWindow>(WOS.makeORef("window", get(windowIdAtom)), get);
        return windowData?.workspaceid ?? null;
    });
    const workspaceAtom: Atom<Workspace> = atom((get) => {
        const workspaceId = get(workspaceIdAtom);
        if (workspaceId == null) {
            return null;
        }
        return WOS.getObjectValue(WOS.makeORef("workspace", workspaceId), get);
    });
    const fullConfigAtom = atom(null) as PrimitiveAtom<FullConfigType>;
    const settingsAtom = atom((get) => {
        return get(fullConfigAtom)?.settings ?? {};
    }) as Atom<SettingsType>;
    const hasConfigErrors = atom((get) => {
        const fullConfig = get(fullConfigAtom);
        return fullConfig?.configerrors != null && fullConfig.configerrors.length > 0;
    }) as Atom<boolean>;
    // this is *the* tab that this tabview represents.  it should never change.
    const staticTabIdAtom: Atom<string> = atom(initOpts.tabId);
    const controlShiftDelayAtom = atom(false);

    const documentHasFocusAtom = atom(true) as PrimitiveAtom<boolean>;
    if (globalThis.window != null) {
        globalStore.set(documentHasFocusAtom, document.hasFocus());
        window.addEventListener("focus", () => {
            globalStore.set(documentHasFocusAtom, true);
        });
        window.addEventListener("blur", () => {
            globalStore.set(documentHasFocusAtom, false);
        });
    }

    const modalOpen = atom(false);
    const reinitVersion = atom(0);
    atoms = {
        // initialized in wave.ts (will not be null inside of application)
        uiContext: uiContextAtom,
        workspaceId: workspaceIdAtom,
        workspace: workspaceAtom,
        fullConfigAtom,
        settingsAtom,
        hasConfigErrors,
        staticTabId: staticTabIdAtom,
        isFullScreen: isFullScreenAtom,
        zoomFactorAtom,
        controlShiftDelayAtom,
        documentHasFocus: documentHasFocusAtom,
        modalOpen,
        reinitVersion,
    } as GlobalAtomsType;
}

function getAtoms(): GlobalAtomsType {
    if (atoms == null) {
        throw new Error("Global atoms accessed before initialization");
    }
    return atoms;
}

function getApi(): HostApi {
    return (window as any).api;
}

export { atoms, getAtoms, initGlobalAtoms, orefAtomCache };
