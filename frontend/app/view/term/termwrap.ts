// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { setBadge } from "@/app/store/badge";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { FileRef } from "@/app/view/agents/agentrailtabs";
import { openPathFromTerminal } from "@/app/view/agents/pathlinkroute";
import { shouldRelaunchWorker } from "@/app/view/agents/session-models/agentresumestore";
import { recordPastedImage } from "@/app/view/agents/uploadsingest";
import { pasteTextFor } from "@/app/view/agents/uploadsstore";
import {
    fetchWaveFile,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    isDev,
    openLink,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, fireAndForget } from "@/util/util";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import * as TermTypes from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import debug from "debug";
import * as jotai from "jotai";
import { debounce } from "throttle-debounce";
import { setCommandRunning, setLastCommand } from "./lastcommand";
import {
    handleOsc16162Command,
    handleOsc52Command,
    handleOsc7Command,
    type ShellIntegrationStatus,
} from "./osc-handlers";
import { registerTermHandle } from "./termpaste";
import { hintFor, makePathLinkProvider, trackForDev } from "./termpathlinks";
import { multiCharTextKey } from "./termtextkey";
import {
    bufferLinesToText,
    createTempFileFromBlob,
    extractAllClipboardData,
    normalizeCursorStyle,
    trimTerminalSelection,
} from "./termutil";

const dlog = debug("wave:termwrap");

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
export const SupportsImageInput = true;
const MaxRepaintTransactionMs = 2000;
// how long a pane stays hidden before it gives its WebGL context back (see handleResize): long enough that flipping
// between agents does not rebuild a context each time
const WebGLParkDelayMs = 30_000;
// how long redraw holds the PTY one column narrower: long enough that the TUI sees two size changes, not one it
// can skip as a no-op
const RedrawNudgeMs = 120;

// the mounted terminal of each block, so a control outside the pane (the agent header's Redraw) can reach it
const liveTermWraps = new Map<string, TermWrap>();

// Redraw the block's terminal: see TermWrap.redraw. False when the block has no mounted terminal.
export function redrawTerminal(blockId: string): boolean {
    const wrap = liveTermWraps.get(blockId);
    if (wrap == null) {
        return false;
    }
    wrap.redraw();
    return true;
}

// detect webgl support
function detectWebGLSupport(): boolean {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("webgl2");
        return !!ctx;
    } catch (e) {
        return false;
    }
}

export const WebGLSupported = detectWebGLSupport();
let loggedWebGL = false;

type TermWrapOptions = {
    keydownHandler?: (e: KeyboardEvent) => boolean;
    useWebGl?: boolean;
    sendDataHandler?: (data: string) => void;
    nodeModel?: BlockNodeModel;
};

export class TermWrap {
    tabId: string;
    blockId: string;
    ptyOffset: number;
    dataBytesProcessed: number;
    terminal: Terminal;
    connectElem: HTMLDivElement;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
    serializeAddon: SerializeAddon;
    mainFileSubject: SubjectWithRef<WSFileEventData>;
    loaded: boolean;
    // where the shell is by the last prompt (A) or command (C) mark in the output replayed while loading
    replayPosition: "prompt" | "command" | null = null;
    heldData: Uint8Array[];
    handleResize_debounced: () => void;
    hasResized: boolean;
    // set while the pane is hidden, so showing it again rebuilds the WebGL glyph atlas (see handleResize)
    hiddenSinceShown = false;
    sendDataHandler: (data: string) => void;
    onSearchResultsDidChange?: (result: { resultIndex: number; resultCount: number }) => void;
    toDispose: TermTypes.IDisposable[] = [];
    webglAddon: WebglAddon | null = null;
    webglContextLossDisposable: TermTypes.IDisposable | null = null;
    webglEnabledAtom: jotai.PrimitiveAtom<boolean>;
    // the renderer asked for (settings, the toggle, a lost context); a hidden pane may park WebGL without changing it
    wantWebGl = false;
    // a hidden pane's WebGL context was given back and comes back when the pane shows
    webglParked = false;
    webglParkTimer: ReturnType<typeof setTimeout> | null = null;
    pasteActive: boolean = false;
    lastUpdated: number;
    promptMarkers: TermTypes.IMarker[] = [];
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
    nodeModel: BlockNodeModel; // this can be null
    hoveredLinkUri: string | null = null;
    onLinkHover?: (uri: string | null, mouseX: number, mouseY: number, hint?: string) => void;

    // Paste deduplication
    // xterm.js paste() method triggers onData event, which can cause duplicate sends
    lastPasteData: string = "";
    lastPasteTime: number = 0;

    // dev only (for debugging)
    recentWrites: { idx: number; data: string; ts: number }[] = [];
    recentWritesCounter: number = 0;

    // for repaint transaction scrolling behavior
    lastClearScrollbackTs: number = 0;
    lastMode2026SetTs: number = 0;
    lastMode2026ResetTs: number = 0;
    inSyncTransaction: boolean = false;
    inRepaintTransaction: boolean = false;

    constructor(
        tabId: string,
        blockId: string,
        connectElem: HTMLDivElement,
        options: TermTypes.ITerminalOptions & TermTypes.ITerminalInitOnlyOptions,
        waveOptions: TermWrapOptions
    ) {
        this.loaded = false;
        this.tabId = tabId;
        this.blockId = blockId;
        liveTermWraps.set(blockId, this);
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.nodeModel = waveOptions.nodeModel;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.shellIntegrationStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
        this.webglEnabledAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        this.terminal = new Terminal(options);
        this.fitAddon = new FitAddon();
        this.serializeAddon = new SerializeAddon();
        this.searchAddon = new SearchAddon();
        this.terminal.loadAddon(this.searchAddon);
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.serializeAddon);
        // Unicode 11 widths, as the TUIs measuring their own layout assume: the default v6 table counts many emoji
        // as one cell and misplaces everything after them on the line
        this.terminal.loadAddon(new Unicode11Addon());
        this.terminal.unicode.activeVersion = "11";
        // Sixel and iTerm inline images (imgcat, chafa). Each terminal keeps its decoded images in its own FIFO
        // store and the cockpit runs many terminals at once, so a quarter of the addon's 128 MB default
        this.terminal.loadAddon(new ImageAddon({ storageLimit: 32 }));
        this.terminal.loadAddon(
            new WebLinksAddon(
                (e, uri) => {
                    e.preventDefault();
                    switch (PLATFORM) {
                        case PlatformMacOS:
                            if (e.metaKey) {
                                fireAndForget(() => openLink(uri));
                            }
                            break;
                        default:
                            if (e.ctrlKey) {
                                fireAndForget(() => openLink(uri));
                            }
                            break;
                    }
                },
                {
                    hover: (e, uri) => {
                        this.hoveredLinkUri = uri;
                        this.onLinkHover?.(uri, e.clientX, e.clientY);
                    },
                    leave: () => {
                        this.hoveredLinkUri = null;
                        this.onLinkHover?.(null, 0, 0);
                    },
                }
            )
        );
        // file paths in the output: Ctrl+click opens one beside its agent (termpathlinks.ts). hoveredLinkUri stays a
        // URL's alone: the context menu offers "Open URL" for it, and a Windows path parses as a URL
        const pathHooks = {
            cwd: () => {
                const cwd = WOS.getObjectValue<Block>(WOS.makeORef("block", this.blockId))?.meta?.["cmd:cwd"];
                return typeof cwd === "string" && cwd !== "" ? cwd : null;
            },
            activate: (ref: FileRef) => openPathFromTerminal(this.blockId, ref),
            hover: (e: MouseEvent, ref: FileRef) => this.onLinkHover?.(ref.abs, e.clientX, e.clientY, hintFor(ref)),
            leave: () => this.onLinkHover?.(null, 0, 0),
        };
        this.toDispose.push(this.terminal.registerLinkProvider(makePathLinkProvider(this.terminal, pathHooks)));
        this.toDispose.push(trackForDev(this.blockId, this.terminal, pathHooks));
        this.setTermRenderer(WebGLSupported && waveOptions.useWebGl ? "webgl" : "dom");
        // Register OSC handlers
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            try {
                return handleOsc7Command(data, this.blockId, this.loaded);
            } catch (e) {
                console.error("[termwrap] osc 7 handler error", this.blockId, e);
                return false;
            }
        });
        this.terminal.parser.registerOscHandler(52, (data: string) => {
            try {
                return handleOsc52Command(data, this.blockId, this.loaded, this);
            } catch (e) {
                console.error("[termwrap] osc 52 handler error", this.blockId, e);
                return false;
            }
        });
        this.terminal.parser.registerOscHandler(16162, (data: string) => {
            try {
                return handleOsc16162Command(data, this.blockId, this.loaded, this);
            } catch (e) {
                console.error("[termwrap] osc 16162 handler error", this.blockId, e);
                return false;
            }
        });
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ final: "J" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 3) {
                    this.lastClearScrollbackTs = Date.now();
                    if (this.inSyncTransaction) {
                        console.log("[termwrap] repaint transaction starting");
                        this.inRepaintTransaction = true;
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 2026) {
                    this.lastMode2026SetTs = Date.now();
                    this.inSyncTransaction = true;
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 2026) {
                    this.lastMode2026ResetTs = Date.now();
                    this.inSyncTransaction = false;
                    const wasRepaint = this.inRepaintTransaction;
                    this.inRepaintTransaction = false;
                    if (wasRepaint && Date.now() - this.lastClearScrollbackTs <= MaxRepaintTransactionMs) {
                        setTimeout(() => {
                            console.log("[termwrap] repaint transaction complete, scrolling to bottom");
                            this.terminal.scrollToBottom();
                        }, 20);
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.onBell(() => {
                if (!this.loaded) {
                    return true;
                }
                console.log("BEL received in terminal", this.blockId);
                const bellIndicatorEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellindicator")) ?? false;
                if (bellIndicatorEnabled) {
                    setBadge(this.blockId, { icon: "bell", color: "#fbbf24", priority: 1 });
                }
                return true;
            })
        );
        this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
            const text = multiCharTextKey(e);
            if (text != null) {
                e.preventDefault();
                this.terminal.input(text, true);
                return false;
            }
            if (!waveOptions.keydownHandler) {
                return true;
            }
            return waveOptions.keydownHandler(e);
        });
        this.connectElem = connectElem;
        this.mainFileSubject = null;
        this.heldData = [];
        this.handleResize_debounced = debounce(50, this.handleResize.bind(this));
        this.terminal.open(this.connectElem);

        // native drag-drop is off so HTML5 drag works, and a dropped file carries no path in the webview. The
        // drop bubbles up to CockpitFocusPane, which copies the file and pastes its path (uploadsingest.ts);
        // here it is only kept from navigating the webview to the file.
        const dropGuard = (e: DragEvent) => e.preventDefault();
        this.connectElem.addEventListener("dragover", dropGuard);
        this.connectElem.addEventListener("drop", dropGuard);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("dragover", dropGuard);
                this.connectElem.removeEventListener("drop", dropGuard);
            },
        });
        this.handleResize();
        const pasteHandler = this.pasteHandler.bind(this);
        this.connectElem.addEventListener("paste", pasteHandler, true);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
        // lets the cockpit paste into this terminal by block id (the path of a dropped or attached file).
        // handleTermData drops everything until the first load finishes, so a paste before then is refused.
        this.toDispose.push({
            dispose: registerTermHandle(this.blockId, {
                paste: (text) => {
                    if (!this.loaded) {
                        return false;
                    }
                    this.terminal.paste(text);
                    return true;
                },
                focus: () => this.terminal.focus(),
            }),
        });
        // the WebGL renderer keeps its glyphs in a GPU texture that can be lost with no context-loss event (Chromium
        // after sleep, or a GPU stall while the machine is short of RAM): backgrounds still draw and most text goes
        // missing. Rebuilding the atlas when the window comes back or the terminal takes focus redraws the text.
        const refreshGlyphs = () => {
            if (document.visibilityState === "visible") {
                this.webglAddon?.clearTextureAtlas();
            }
        };
        window.addEventListener("focus", refreshGlyphs);
        document.addEventListener("visibilitychange", refreshGlyphs);
        this.terminal.textarea?.addEventListener("focus", refreshGlyphs);
        this.toDispose.push({
            dispose: () => {
                window.removeEventListener("focus", refreshGlyphs);
                document.removeEventListener("visibilitychange", refreshGlyphs);
                this.terminal.textarea?.removeEventListener("focus", refreshGlyphs);
            },
        });
    }

    getZoneId(): string {
        return this.blockId;
    }

    setCursorStyle(cursorStyle: string) {
        this.terminal.options.cursorStyle = normalizeCursorStyle(cursorStyle);
    }

    setCursorBlink(cursorBlink: boolean) {
        this.terminal.options.cursorBlink = cursorBlink ?? false;
    }

    setTermRenderer(renderer: "webgl" | "dom") {
        this.wantWebGl = renderer === "webgl" && WebGLSupported;
        this.webglParked = false;
        this.applyTermRenderer(renderer);
    }

    // Each WebGL terminal holds its own context in the GPU process, and every pane stays mounted while hidden, so a
    // pane hidden past WebGLParkDelayMs draws with the DOM renderer (xterm draws nothing while hidden anyway) and loads
    // WebGL again when it shows.
    private parkWebGlWhenHidden() {
        if (this.webglAddon == null || this.webglParkTimer != null) {
            return;
        }
        this.webglParkTimer = setTimeout(() => {
            this.webglParkTimer = null;
            if (this.webglAddon != null && this.isHidden()) {
                this.applyTermRenderer("dom");
                this.webglParked = true;
            }
        }, WebGLParkDelayMs);
    }

    // true when it loaded WebGL again, which starts from the current glyph atlas
    private unparkWebGl(): boolean {
        if (this.webglParkTimer != null) {
            clearTimeout(this.webglParkTimer);
            this.webglParkTimer = null;
        }
        if (!this.webglParked) {
            return false;
        }
        this.webglParked = false;
        if (!this.wantWebGl) {
            return false;
        }
        this.applyTermRenderer("webgl");
        return true;
    }

    private applyTermRenderer(renderer: "webgl" | "dom") {
        if (renderer === "webgl") {
            if (this.webglAddon != null) {
                return;
            }
            if (!WebGLSupported) {
                renderer = "dom";
            }
        } else {
            if (this.webglAddon == null) {
                return;
            }
        }
        if (this.webglAddon != null) {
            this.webglContextLossDisposable?.dispose();
            this.webglContextLossDisposable = null;
            this.webglAddon.dispose();
            this.webglAddon = null;
            globalStore.set(this.webglEnabledAtom, false);
        }
        if (renderer === "webgl") {
            const addon = new WebglAddon();
            this.webglContextLossDisposable = addon.onContextLoss(() => {
                this.setTermRenderer("dom");
            });
            this.terminal.loadAddon(addon);
            this.webglAddon = addon;
            globalStore.set(this.webglEnabledAtom, true);
            if (!loggedWebGL) {
                console.log("loaded webgl!");
                loggedWebGL = true;
            }
        }
    }

    getTermRenderer(): "webgl" | "dom" {
        return this.webglAddon != null ? "webgl" : "dom";
    }

    isWebGlEnabled(): boolean {
        return this.webglAddon != null;
    }

    async initTerminal() {
        const copyOnSelectAtom = getSettingsKeyAtom("term:copyonselect");
        const trimTrailingWhitespaceAtom = getSettingsKeyAtom("term:trimtrailingwhitespace");
        this.toDispose.push(this.terminal.onData(this.handleTermData.bind(this)));
        this.toDispose.push(
            this.terminal.onSelectionChange(
                debounce(50, () => {
                    if (!globalStore.get(copyOnSelectAtom)) {
                        return;
                    }
                    // Don't copy-on-select when the search bar has focus — navigating
                    // search results changes the terminal selection programmatically.
                    const active = document.activeElement;
                    if (active != null && active.closest(".search-container") != null) {
                        return;
                    }
                    let selectedText = this.terminal.getSelection();
                    if (selectedText.length > 0) {
                        if (globalStore.get(trimTrailingWhitespaceAtom) !== false) {
                            selectedText = trimTerminalSelection(selectedText);
                        }
                        navigator.clipboard.writeText(selectedText);
                    }
                })
            )
        );
        if (this.onSearchResultsDidChange != null) {
            this.toDispose.push(this.searchAddon.onDidChangeResults(this.onSearchResultsDidChange.bind(this)));
        }

        this.mainFileSubject = getFileSubject(this.getZoneId(), TermFileName);
        this.mainFileSubject.subscribe(this.handleNewFileSubjectData.bind(this));

        try {
            const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
            });
            let shellState: ShellIntegrationStatus = null;
            setLastCommand(this.blockId, rtInfo?.["shell:lastcmd"]);
            setCommandRunning(this.blockId, rtInfo?.["shell:state"] === "running-command");

            if (rtInfo && rtInfo["shell:integration"]) {
                shellState = rtInfo["shell:state"] as ShellIntegrationStatus;
                globalStore.set(this.shellIntegrationStatusAtom, shellState || null);
            } else {
                globalStore.set(this.shellIntegrationStatusAtom, null);
            }
        } catch (e) {
            console.log("Error loading runtime info:", e);
        }

        try {
            await this.loadInitialTerminalData();
        } finally {
            this.loaded = true;
        }
        // a prompt replayed after the runtime info was read (a command that ended, or a shell started, while this
        // loaded) clears the running mark; a replayed command never sets it, since its shell may be gone
        if (this.replayPosition === "prompt") {
            setCommandRunning(this.blockId, false);
        }
        this.runProcessIdleTimeout();
    }

    dispose() {
        if (liveTermWraps.get(this.blockId) === this) {
            liveTermWraps.delete(this.blockId);
        }
        this.promptMarkers.forEach((marker) => {
            try {
                marker.dispose();
            } catch (_) {
                /* nothing */
            }
        });
        this.promptMarkers = [];
        if (this.webglParkTimer != null) {
            clearTimeout(this.webglParkTimer);
            this.webglParkTimer = null;
        }
        this.webglContextLossDisposable?.dispose();
        this.webglContextLossDisposable = null;
        this.terminal.dispose();
        this.toDispose.forEach((d) => {
            try {
                d.dispose();
            } catch (_) {
                /* nothing */
            }
        });
        this.mainFileSubject.release();
    }

    handleTermData(data: string) {
        if (!this.loaded) {
            return;
        }

        this.sendDataHandler?.(data);
    }

    addFocusListener(focusFn: () => void) {
        this.terminal.textarea.addEventListener("focus", focusFn);
    }

    handleNewFileSubjectData(msg: WSFileEventData) {
        if (msg.fileop == "truncate") {
            this.terminal.clear();
            this.heldData = [];
        } else if (msg.fileop == "append") {
            const decodedData = base64ToArray(msg.data64);
            if (this.loaded) {
                this.doTerminalWrite(decodedData, null);
            } else {
                this.heldData.push(decodedData);
            }
        } else {
            console.log("bad fileop for terminal", msg);
            return;
        }
    }

    doTerminalWrite(data: string | Uint8Array, setPtyOffset?: number): Promise<void> {
        if (isDev() && this.loaded) {
            const dataStr = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
            this.recentWrites.push({ idx: this.recentWritesCounter++, ts: Date.now(), data: dataStr });
            if (this.recentWrites.length > 50) {
                this.recentWrites.shift();
            }
        }
        let resolve: () => void = null;
        const prtn = new Promise<void>((presolve, _) => {
            resolve = presolve;
        });
        this.terminal.write(data, () => {
            if (setPtyOffset != null) {
                this.ptyOffset = setPtyOffset;
            } else {
                this.ptyOffset += data.length;
                this.dataBytesProcessed += data.length;
            }
            this.lastUpdated = Date.now();
            resolve();
        });
        return prtn;
    }

    async loadInitialTerminalData(): Promise<void> {
        const startTs = Date.now();
        const zoneId = this.getZoneId();
        const { data: cacheData, fileInfo: cacheFile } = await fetchWaveFile(zoneId, TermCacheFileName);
        let ptyOffset = 0;
        if (cacheFile != null) {
            ptyOffset = cacheFile.meta["ptyoffset"] ?? 0;
            if (cacheData.byteLength > 0) {
                const curTermSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
                const fileTermSize: TermSize = cacheFile.meta["termsize"];
                let didResize = false;
                if (
                    fileTermSize != null &&
                    (fileTermSize.rows != curTermSize.rows || fileTermSize.cols != curTermSize.cols)
                ) {
                    console.log("terminal restore size mismatch, temp resize", fileTermSize, curTermSize);
                    this.terminal.resize(fileTermSize.cols, fileTermSize.rows);
                    didResize = true;
                }
                this.doTerminalWrite(cacheData, ptyOffset);
                if (didResize) {
                    this.terminal.resize(curTermSize.cols, curTermSize.rows);
                }
            }
        }
        const { data: mainData, fileInfo: mainFile } = await fetchWaveFile(zoneId, TermFileName, ptyOffset);
        console.log(
            `terminal loaded cachefile:${cacheData?.byteLength ?? 0} main:${mainData?.byteLength ?? 0} bytes, ${Date.now() - startTs}ms`
        );
        if (mainFile != null) {
            await this.doTerminalWrite(mainData, null);
        }
    }

    // the status of the run an engine worker belongs to when a remount must not relaunch it (the run is over,
    // or blocked on a stopped worker), so its last frame stays up; null when the block may relaunch
    async unrelaunchableRunStatus(): Promise<string | null> {
        const meta = WOS.getObjectValue<Block>(WOS.makeORef("block", this.blockId))?.meta;
        const runId = meta?.["agent:runid"];
        if (typeof runId !== "string" || !runId) {
            return null;
        }
        const run = await WOS.loadAndPinWaveObject<Run>(WOS.makeORef("run", runId)).catch(() => null);
        return shouldRelaunchWorker(meta, run?.status) ? null : run.status;
    }

    async resyncController(reason: string) {
        dlog("resync controller", this.blockId, reason);
        const runStatus = await this.unrelaunchableRunStatus();
        if (runStatus != null) {
            const notice =
                runStatus === "blocked"
                    ? "this worker stopped; resume it from its run"
                    : "this worker's run is over; it was not relaunched";
            this.terminal.write(`\r\n\x1b[2m[arc] ${notice}\x1b[0m\r\n`);
            return;
        }
        const rtOpts: RuntimeOpts = { termsize: { rows: this.terminal.rows, cols: this.terminal.cols } };
        try {
            await RpcApi.ControllerResyncCommand(TabRpcClient, {
                tabid: this.tabId,
                blockid: this.blockId,
                rtopts: rtOpts,
            });
        } catch (e) {
            console.log(`error controller resync (${reason})`, this.blockId, e);
        }
    }

    // display:none on the pane or an ancestor: offsetParent null, 0 size
    private isHidden(): boolean {
        return (
            this.connectElem.offsetParent == null ||
            this.connectElem.clientWidth === 0 ||
            this.connectElem.clientHeight === 0
        );
    }

    handleResize() {
        // skip while hidden/detached (display:none -> offsetParent null, 0 size) so we don't fit to a
        // 0-size box and shrink the PTY; the ResizeObserver fires again with real dims on re-show.
        if (this.isHidden()) {
            this.hiddenSinceShown = true;
            this.parkWebGlWhenHidden();
            return;
        }
        const reloadedWebGl = this.unparkWebGl();
        // every WebGL terminal shares one glyph atlas, which the visible ones grow and repack while this one is
        // hidden; shown again, it drew from stale glyph positions and its text came out garbled until a window
        // focus rebuilt the atlas. Showing a pane (choosing its agent) rebuilds it here.
        if (this.hiddenSinceShown) {
            this.hiddenSinceShown = false;
            if (!reloadedWebGl) {
                this.webglAddon?.clearTextureAtlas();
            }
        }
        const oldRows = this.terminal.rows;
        const oldCols = this.terminal.cols;
        this.fitAddon.fit();
        if (oldRows !== this.terminal.rows || oldCols !== this.terminal.cols) {
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            console.log(
                "[termwrap] resize",
                `${oldRows}x${oldCols}`,
                "->",
                `${this.terminal.rows}x${this.terminal.cols}`
            );
            RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize });
        }
        dlog("resize", `${this.terminal.rows}x${this.terminal.cols}`, `${oldRows}x${oldCols}`, this.hasResized);
        if (!this.hasResized) {
            this.hasResized = true;
            this.resyncController("initial resize");
        }
    }

    // The pane's text can come out garbled: a lost glyph texture, or a TUI that drew for a size other than the pane's
    // and repaints only the lines it changes, so the stale ones stay. Fit to the pane, rebuild the glyphs and repaint
    // xterm, then narrow the PTY one column and give it back: a TUI repaints whole on a resize, at the right size.
    redraw() {
        if (this.isHidden()) {
            return;
        }
        this.fitAddon.fit();
        this.webglAddon?.clearTextureAtlas();
        this.terminal.refresh(0, this.terminal.rows - 1);
        const rows = this.terminal.rows;
        const cols = this.terminal.cols;
        fireAndForget(() =>
            RpcApi.ControllerInputCommand(TabRpcClient, {
                blockid: this.blockId,
                termsize: { rows, cols: Math.max(cols - 1, 1) },
            })
        );
        setTimeout(() => {
            fireAndForget(() =>
                RpcApi.ControllerInputCommand(TabRpcClient, {
                    blockid: this.blockId,
                    termsize: { rows: this.terminal.rows, cols: this.terminal.cols },
                })
            );
        }, RedrawNudgeMs);
    }

    processAndCacheData() {
        if (this.dataBytesProcessed < MinDataProcessedForCache) {
            return;
        }
        const serializedOutput = this.serializeAddon.serialize();
        const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        console.log("idle timeout term", this.dataBytesProcessed, serializedOutput.length, termSize);
        fireAndForget(() =>
            services.BlockService.SaveTerminalState(this.blockId, serializedOutput, "full", this.ptyOffset, termSize)
        );
        this.dataBytesProcessed = 0;
    }

    runProcessIdleTimeout() {
        setTimeout(() => {
            window.requestIdleCallback(() => {
                this.processAndCacheData();
                this.runProcessIdleTimeout();
            });
        }, 5000);
    }

    async pasteHandler(e?: ClipboardEvent): Promise<void> {
        this.pasteActive = true;
        e?.preventDefault();
        e?.stopPropagation();

        try {
            const clipboardData = await extractAllClipboardData(e);
            let firstImage = true;
            for (const data of clipboardData) {
                if (data.image && SupportsImageInput) {
                    if (!firstImage) {
                        await new Promise((r) => setTimeout(r, 150));
                    }
                    const tempPath = await createTempFileFromBlob(data.image);
                    const screenBefore = this.recentLines();
                    this.terminal.paste(pasteTextFor(tempPath));
                    recordPastedImage(this.blockId, tempPath, data.image, screenBefore, () => this.recentLines());
                    firstImage = false;
                }
                if (data.text) {
                    this.terminal.paste(data.text);
                }
            }
        } catch (err) {
            console.error("Paste error:", err);
        } finally {
            setTimeout(() => {
                this.pasteActive = false;
            }, 30);
        }
    }

    // the bottom of the buffer, where a TUI draws its prompt
    recentLines(count = 200): string[] {
        const buffer = this.terminal?.buffer.active;
        if (!buffer) {
            return [];
        }
        return bufferLinesToText(buffer, Math.max(0, buffer.length - count), buffer.length);
    }

    getScrollbackContent(): string {
        if (!this.terminal) {
            return "";
        }
        const buffer = this.terminal.buffer.active;
        const lines = bufferLinesToText(buffer, 0, buffer.length);
        return lines.join("\n");
    }
}
