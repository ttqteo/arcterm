// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { NullErrorBoundary } from "@/app/element/errorboundary";
import { Search, useSearch } from "@/app/element/search";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { useTabModel } from "@/app/store/tab-model";
import { DEFAULT_TERM_FONT, MONO_FONTS, stackOf } from "@/app/view/agents/fonts";
import { IdeaCaptureChip } from "@/app/view/agents/ideacapturechip";
import { sessionIdFromTranscript } from "@/app/view/agents/ideasmodel";
import { activePalette, deriveTermTheme } from "@/app/view/agents/themes";
import { themeOverridesAtom, themePresetAtom } from "@/app/view/agents/themestore";
import type { TermViewModel } from "@/app/view/term/term-model";
import { atoms, getOverrideConfigAtom, getSettingsPrefixAtom, WOS } from "@/store/global";
import { isMacOS } from "@/util/platformutil";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { ISearchOptions } from "@xterm/addon-search";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";
import { TermLinkTooltip } from "./term-tooltip";
import { makeRightClickGate, singleRightClickAction } from "./termrightclick";
import { pendingTermSearchAtom } from "./termsearch";
import { TermThemeUpdater } from "./termtheme";
import { normalizeCursorStyle } from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

const dlog = debug("wave:term");

const TerminalView = ({ blockId, model }: ViewComponentProps<TermViewModel>) => {
    const viewRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const [termWrapInst, setTermWrapInst] = React.useState<TermWrap | null>(null);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const termSettingsAtom = getSettingsPrefixAtom("term");
    const termSettings = jotai.useAtomValue(termSettingsAtom);

    const tabModel = useTabModel();
    const termFontSize = jotai.useAtomValue(model.fontSizeAtom);
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const connFontFamily = fullConfig.connections?.[blockData?.meta?.connection]?.["term:fontfamily"];

    // search
    const searchProps = useSearch({
        anchorRef: viewRef,
        viewModel: model,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
    });
    const searchIsOpen = jotai.useAtomValue<boolean>(searchProps.isOpen);
    const caseSensitive = useAtomValueSafe<boolean>(searchProps.caseSensitive);
    const wholeWord = useAtomValueSafe<boolean>(searchProps.wholeWord);
    const regex = useAtomValueSafe<boolean>(searchProps.regex);
    const searchVal = jotai.useAtomValue<string>(searchProps.searchValue);
    const searchDecorations = React.useMemo(
        () => ({
            matchOverviewRuler: "#000000",
            activeMatchColorOverviewRuler: "#000000",
            activeMatchBorder: "#FF9632",
            matchBorder: "#FFFF00",
        }),
        []
    );
    const searchOpts = React.useMemo<ISearchOptions>(
        () => ({
            regex,
            wholeWord,
            caseSensitive,
            decorations: searchDecorations,
        }),
        [regex, wholeWord, caseSensitive]
    );
    const handleSearchError = React.useCallback((e: Error) => {
        console.warn("search error:", e);
    }, []);
    const executeSearch = React.useCallback(
        (searchText: string, direction: "next" | "previous") => {
            if (searchText === "") {
                model.termRef.current?.searchAddon.clearDecorations();
                return;
            }
            try {
                model.termRef.current?.searchAddon[direction === "next" ? "findNext" : "findPrevious"](
                    searchText,
                    searchOpts
                );
            } catch (e) {
                handleSearchError(e);
            }
        },
        [searchOpts, handleSearchError]
    );
    searchProps.onSearch = React.useCallback(
        (searchText: string) => executeSearch(searchText, "previous"),
        [executeSearch]
    );
    searchProps.onPrev = React.useCallback(() => executeSearch(searchVal, "previous"), [executeSearch, searchVal]);
    searchProps.onNext = React.useCallback(() => executeSearch(searchVal, "next"), [executeSearch, searchVal]);
    // Return input focus to the terminal when the search is closed
    React.useEffect(() => {
        if (!searchIsOpen) {
            model.giveFocus();
        }
    }, [searchIsOpen]);
    // rerun search when the searchOpts change
    React.useEffect(() => {
        model.termRef.current?.searchAddon.clearDecorations();
        searchProps.onSearch(searchVal);
    }, [searchOpts]);
    // a server's Log asks for this terminal's search box (termsearch.ts)
    const pendingSearch = jotai.useAtomValue(pendingTermSearchAtom);
    React.useEffect(() => {
        if (pendingSearch !== blockId) {
            return;
        }
        globalStore.set(pendingTermSearchAtom, null);
        globalStore.set(searchProps.isOpen, true);
        globalStore.set(searchProps.focusInput, (n: number) => n + 1);
    }, [pendingSearch, blockId]);
    // end search

    React.useEffect(() => {
        const termMacOptionIsMetaAtom = getOverrideConfigAtom(blockId, "term:macoptionismeta");
        const termTheme = deriveTermTheme(
            activePalette(globalStore.get(themePresetAtom)),
            globalStore.get(themeOverridesAtom)
        );
        let termScrollback = 2000;
        if (termSettings?.["term:scrollback"]) {
            termScrollback = Math.floor(termSettings["term:scrollback"]);
        }
        if (blockData?.meta?.["term:scrollback"]) {
            termScrollback = Math.floor(blockData.meta["term:scrollback"]);
        }
        if (termScrollback < 0) {
            termScrollback = 0;
        }
        if (termScrollback > 50000) {
            termScrollback = 50000;
        }
        const termAllowBPM = globalStore.get(model.termBPMAtom) ?? true;
        const termMacOptionIsMeta = globalStore.get(termMacOptionIsMetaAtom) ?? false;
        const termCursorStyle = normalizeCursorStyle(globalStore.get(getOverrideConfigAtom(blockId, "term:cursor")));
        const termCursorBlink = globalStore.get(getOverrideConfigAtom(blockId, "term:cursorblink")) ?? false;
        // a right-click that copies or pastes must not first select the word under the pointer (xterm does on a Mac)
        const termRightClickSelectsWord = termSettings?.["term:rightclickpaste"] === false && isMacOS();
        const wasFocused = model.termRef.current != null && globalStore.get(model.nodeModel.isFocused);
        const termWrap = new TermWrap(
            tabModel.tabId,
            blockId,
            connectElemRef.current,
            {
                theme: termTheme,
                fontSize: termFontSize,
                fontFamily:
                    termSettings?.["term:fontfamily"] ?? connFontFamily ?? stackOf(MONO_FONTS, DEFAULT_TERM_FONT),
                drawBoldTextInBrightColors: false,
                // TUIs paint their own backgrounds (Claude Code's prompt row is #373737) and can land a palette
                // grey on them at ~1.6:1; xterm lifts any cell below this ratio. 4.5 is WCAG AA, VS Code's default.
                minimumContrastRatio: 4.5,
                fontWeight: "normal",
                fontWeightBold: "bold",
                allowTransparency: true,
                scrollback: termScrollback,
                allowProposedApi: true, // Required by @xterm/addon-search to enable search functionality and decorations
                ignoreBracketedPasteMode: !termAllowBPM,
                macOptionIsMeta: termMacOptionIsMeta,
                cursorStyle: termCursorStyle,
                cursorBlink: termCursorBlink,
                overviewRuler: { width: 6 },
                rightClickSelectsWord: termRightClickSelectsWord,
            },
            {
                keydownHandler: model.handleTerminalKeydown.bind(model),
                useWebGl: !termSettings?.["term:disablewebgl"],
                sendDataHandler: model.sendDataToController.bind(model),
                nodeModel: model.nodeModel,
            }
        );
        model.termRef.current = termWrap;
        setTermWrapInst(termWrap);
        const rszObs = new ResizeObserver(() => {
            termWrap.handleResize_debounced();
        });
        rszObs.observe(connectElemRef.current);
        termWrap.onSearchResultsDidChange = (results) => {
            globalStore.set(searchProps.resultsIndex, results.resultIndex);
            globalStore.set(searchProps.resultsCount, results.resultCount);
        };
        fireAndForget(termWrap.initTerminal.bind(termWrap));
        if (wasFocused) {
            setTimeout(() => {
                model.giveFocus();
            }, 10);
        }
        return () => {
            termWrap.dispose();
            rszObs.disconnect();
            setTermWrapInst(null);
        };
    }, [blockId, termSettings, termFontSize, connFontFamily]);

    const showTermMenu = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            ContextMenuModel.getInstance().showContextMenu(model.getContextMenuItems(), e);
        },
        [model]
    );
    // term:rightclickpaste: right-click copies the selection or pastes, right-click twice opens the menu
    const rightClickPaste = termSettings?.["term:rightclickpaste"] !== false;
    const rightClickGate = React.useMemo(
        () =>
            makeRightClickGate<React.MouseEvent<HTMLDivElement>>({
                onSingle: () => {
                    const terminal = model.termRef.current?.terminal;
                    if (singleRightClickAction(terminal?.hasSelection() ?? false) === "copy") {
                        model.copySelection();
                        terminal.clearSelection();
                    } else {
                        model.termRef.current?.pasteHandler();
                    }
                },
                onDouble: showTermMenu,
            }),
        [model, showTermMenu]
    );
    React.useEffect(() => () => rightClickGate.dispose(), [rightClickGate]);
    const handleContextMenu = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            if (rightClickPaste) {
                rightClickGate.click(e);
            } else {
                showTermMenu(e);
            }
        },
        [rightClickPaste, rightClickGate, showTermMenu]
    );

    return (
        <div
            className="view-term relative flex h-full w-full flex-col overflow-hidden"
            data-term-view
            ref={viewRef}
            onContextMenu={handleContextMenu}
        >
            <TermThemeUpdater termRef={model.termRef} />
            <div
                key="connect-elem"
                className="term-connectelem my-[5px] mr-px ml-1 flex min-h-0 grow overflow-hidden leading-none [&_.terminal]:w-full [&_.xterm-decoration-overview-ruler]:!hidden [&_.xterm-viewport]:!bg-transparent"
                ref={connectElemRef}
            />
            <NullErrorBoundary debugName="TermLinkTooltip">
                <TermLinkTooltip termWrap={termWrapInst} />
            </NullErrorBoundary>
            <Search {...searchProps} />
            <IdeaCaptureChip
                blockId={blockId}
                sessionId={sessionIdFromTranscript(blockData?.meta?.["agent:transcriptpath"])}
            />
        </div>
    );
};

export { TerminalView };
