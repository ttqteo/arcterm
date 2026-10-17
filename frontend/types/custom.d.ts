// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveEnv } from "@/app/waveenv/waveenv";
import { type Placement } from "@floating-ui/react";
import type * as jotai from "jotai";
import type * as rxjs from "rxjs";

declare global {
    type GlobalAtomsType = {
        uiContext: jotai.Atom<UIContext>; // driven from windowId, tabId
        workspaceId: jotai.Atom<string>; // derived from window WOS object
        workspace: jotai.Atom<Workspace>; // driven from workspaceId via WOS
        fullConfigAtom: jotai.PrimitiveAtom<FullConfigType>; // driven from WOS, settings -- updated via WebSocket
        settingsAtom: jotai.Atom<SettingsType>; // derrived from fullConfig
        hasConfigErrors: jotai.Atom<boolean>; // derived from fullConfig
        staticTabId: jotai.Atom<string>;
        isFullScreen: jotai.PrimitiveAtom<boolean>;
        zoomFactorAtom: jotai.PrimitiveAtom<number>;
        controlShiftDelayAtom: jotai.PrimitiveAtom<boolean>;
        documentHasFocus: jotai.PrimitiveAtom<boolean>;
        modalOpen: jotai.PrimitiveAtom<boolean>;
        reinitVersion: jotai.PrimitiveAtom<number>;
    };

    type ThrottledValueAtom<T> = jotai.WritableAtom<T, [update: jotai.SetStateAction<T>], void>;

    type AtomWithThrottle<T> = {
        currentValueAtom: jotai.Atom<T>;
        throttledValueAtom: ThrottledValueAtom<T>;
    };

    type DebouncedValueAtom<T> = jotai.WritableAtom<T, [update: jotai.SetStateAction<T>], void>;

    type AtomWithDebounce<T> = {
        currentValueAtom: jotai.Atom<T>;
        debouncedValueAtom: DebouncedValueAtom<T>;
    };

    type WaveKeyboardEvent = {
        type: "keydown" | "keyup" | "keypress" | "unknown";
        key: string;
        code: string;
        repeat?: boolean;
        location?: number;
        shift?: boolean;
        control?: boolean;
        alt?: boolean;
        meta?: boolean;
        cmd?: boolean;
        option?: boolean;
    };

    type GlobalInitOptions = {
        tabId?: string;
        platform: NodeJS.Platform;
        windowId: string;
        clientId: string;
        isPreview?: boolean;
    };

    type WaveInitOpts = {
        tabId: string;
        clientId: string;
        windowId: string;
        activate: boolean;
    };

    // the native host surface installed on window.api (frontend/tauri/api.ts)
    type HostApi = {
        getAuthKey(): string;
        getIsDev(): boolean;
        getPlatform: () => NodeJS.Platform;
        getEnv: (varName: string) => string;
        getUserName: () => string;
        getHostName: () => string;
        getZoomFactor: () => number;
        openExternal: (url: string) => void;
        onFullScreenChange: (callback: (isFullScreen: boolean) => void) => void;
        onZoomFactorChange: (callback: (zoomFactor: number) => void) => void;
        onControlShiftStateUpdate: (callback: (state: boolean) => void) => void;
        setWindowInitStatus: (status: "ready" | "wave-ready") => void;
        onWaveInit: (callback: (initOpts: WaveInitOpts) => void) => void;
        sendLog: (log: string) => void;
    };

    type ContextMenuItem = {
        label?: string;
        type?: "separator" | "normal" | "submenu" | "checkbox" | "radio" | "header";
        click?: () => void;
        submenu?: ContextMenuItem[];
        checked?: boolean;
        visible?: boolean;
        enabled?: boolean;
        sublabel?: string;
        danger?: boolean; // destructive action — renderer styles it red
        icon?: React.ReactNode; // leading icon (renderer shows it in the leading column)
        accel?: string; // shortcut in binding notation ("Cmd:t"); rendered as a right-aligned KeyCap
    };

    type KeyPressDecl = {
        mods: {
            Cmd?: boolean;
            Option?: boolean;
            Shift?: boolean;
            Ctrl?: boolean;
            Alt?: boolean;
            Meta?: boolean;
        };
        key: string;
        keyType: string;
    };

    type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };

    type HeaderElem =
        | IconButtonDecl
        | ToggleIconButtonDecl
        | HeaderText
        | HeaderInput
        | HeaderDiv
        | HeaderTextButton
        | ConnectionButton
        | MenuButton;

    type IconButtonCommon = {
        icon: string | React.ReactNode;
        iconColor?: string;
        iconSpin?: boolean;
        className?: string;
        title?: string;
        disabled?: boolean;
        noAction?: boolean;
    };

    type IconButtonDecl = IconButtonCommon & {
        elemtype: "iconbutton";
        click?: (e: React.MouseEvent<any>) => void;
        longClick?: (e: React.MouseEvent<any>) => void;
    };

    type ToggleIconButtonDecl = IconButtonCommon & {
        elemtype: "toggleiconbutton";
        active: jotai.WritableAtom<boolean, [boolean], void>;
    };

    type HeaderTextButton = {
        elemtype: "textbutton";
        text: string;
        className?: string;
        title?: string;
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type HeaderText = {
        elemtype: "text";
        text: string;
        ref?: React.RefObject<HTMLDivElement>;
        className?: string;
        noGrow?: boolean;
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type HeaderInput = {
        elemtype: "input";
        value: string;
        className?: string;
        isDisabled?: boolean;
        ref?: React.RefObject<HTMLInputElement>;
        onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
        onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
        onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
        onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
    };

    type HeaderDiv = {
        elemtype: "div";
        className?: string;
        children: HeaderElem[];
        onMouseOver?: (e: React.MouseEvent<any>) => void;
        onMouseOut?: (e: React.MouseEvent<any>) => void;
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type ConnectionButton = {
        elemtype: "connectionbutton";
        icon: string;
        text: string;
        iconColor: string;
        onClick?: (e: React.MouseEvent<any>) => void;
        connected: boolean;
    };

    type MenuItem = {
        label: string;
        icon?: string | React.ReactNode;
        subItems?: MenuItem[];
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type MenuButtonProps = {
        items: MenuItem[];
        className?: string;
        text: string;
        title?: string;
        menuPlacement?: Placement;
    };

    type MenuButton = {
        elemtype: "menubutton";
    } & MenuButtonProps;

    type SearchAtoms = {
        searchValue: PrimitiveAtom<string>;
        resultsIndex: PrimitiveAtom<number>;
        resultsCount: PrimitiveAtom<number>;
        isOpen: PrimitiveAtom<boolean>;
        focusInput: PrimitiveAtom<number>;
        regex?: PrimitiveAtom<boolean>;
        caseSensitive?: PrimitiveAtom<boolean>;
        wholeWord?: PrimitiveAtom<boolean>;
    };

    declare type ViewComponentProps<T extends ViewModel> = {
        blockId: string;
        blockRef: React.RefObject<HTMLDivElement>;
        contentRef: React.RefObject<HTMLDivElement>;
        model: T;
    };

    declare type ViewComponent = React.FC<ViewComponentProps>;

    type ViewModelInitType = {
        blockId: string;
        nodeModel: BlockNodeModel;
        tabModel: TabModel;
        waveEnv: WaveEnv;
    };

    type ViewModelClass = new (initOpts: ViewModelInitType) => ViewModel;

    interface ViewModel {
        // The type of view, used for identifying and rendering the appropriate component.
        viewType: string;

        useTermHeader?: jotai.Atom<boolean>;

        hideViewName?: jotai.Atom<boolean>;

        // Icon representing the view, can be a string or an IconButton declaration.
        viewIcon?: jotai.Atom<string | IconButtonDecl>;

        // Display name for the view, used in UI headers.
        viewName?: jotai.Atom<string>;

        // Optional header text or elements for the view.
        viewText?: jotai.Atom<string | HeaderElem[]>;


        // Icon button displayed before the title in the header.
        preIconButton?: jotai.Atom<IconButtonDecl>;

        // Icon buttons displayed at the end of the block header.
        endIconButtons?: jotai.Atom<IconButtonDecl[]>;

        noHeader?: jotai.Atom<boolean>;

        // Whether the block manages its own connection (e.g., for remote access).
        manageConnection?: jotai.Atom<boolean>;

        // If true, filters out 'nowsh' connections (when managing connections)
        filterOutNowsh?: jotai.Atom<boolean>;

        // If true, removes padding inside the block content area.
        noPadding?: jotai.Atom<boolean>;

        // Atoms used for managing search functionality within the block.
        searchAtoms?: SearchAtoms;

        // The main view component associated with this ViewModel.
        viewComponent: ViewComponent<ViewModel>;

        // Function to determine if this is a basic terminal block.

        // Returns menu items for the settings dropdown.
        getSettingsMenuItems?: () => ContextMenuItem[];

        // Attempts to give focus to the block, returning true if successful.
        giveFocus?: () => boolean;

        // Handles keydown events within the block.
        keyDownHandler?: (e: WaveKeyboardEvent) => boolean;

        // Cleans up resources when the block is disposed.
        dispose?: () => void;
    }

    // jotai doesn't export this type :/
    type Loadable<T> = { state: "loading" } | { state: "hasData"; data: T } | { state: "hasError"; error: unknown };

    type MarkdownResolveOpts = {
        connName: string;
        baseDir: string;
    };

    interface AbstractWshClient {
        recvRpcMessage(msg: RpcMessage): void;
    }

    type ClientRpcEntry = {
        reqId: string;
        startTs: number;
        command: string;
        msgFn: (msg: RpcMessage) => void;
    };

}

export {};
