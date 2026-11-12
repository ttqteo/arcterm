// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat's inline visual: a one-line ```arc-visual block in an agent's reply names an HTML page it wrote under
// ~/.arc/visuals/, and the conversation draws that page as a frame of its own height, in the app's colours. A button in
// the page calls `arc.sendPrompt(text)` (the script htmlserve appends) and the text goes through the chat box as if the
// person typed it. The rules (what may be drawn, when a prompt sends, when the frame mounts) are decided by the pure
// model, chatvisual.ts; this file is the frame, its message listener and the host that tells a block which chat it is in
// (docs/superpowers/specs/2026-11-10-chat-inline-visuals-design.md). Outside a host (a council's messages) a block stays code.

import { getWebServerEndpoint } from "@/util/endpoints";
import { Maximize2, Minimize2, Shapes } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appendToChatBox, chatBoxText, submitIntoChatBox } from "./chatinsert";
import {
    FRAME_MAX,
    VISUAL_LANG,
    frameHeight,
    promptAction,
    themeVars,
    themeVarsChanged,
    visualPathOf,
    visualsDirOf,
} from "./chatvisual";
import { CodeBlock } from "./codeblock";
import { servedPath } from "./htmlframe";
import { PathLink } from "./pathlinkcontext";
import { homeDir } from "./pathlinkroute";

interface VisualHost {
    agentId: string;
    // the folder a visual may sit in; null until the home folder is known
    visualsDir: string | null;
}

const VisualHostContext = createContext<VisualHost | null>(null);

// the chat a visual is drawn in: its agent (whose box takes the prompts) and the one folder it may name a page in
export function ChatVisualHost({ agentId, children }: { agentId: string; children: ReactNode }) {
    const [visualsDir, setVisualsDir] = useState<string | null>(null);
    useEffect(() => {
        // DEV only: the scenarios draw a page from a folder of their own, as the person's real ~/.arc is not theirs to touch
        const dev = import.meta.env.DEV && typeof window !== "undefined" ? window.__chatVisualsDir : undefined;
        if (typeof dev === "string") {
            setVisualsDir(dev);
            return;
        }
        let live = true;
        homeDir().then((home) => {
            if (live && home !== "") {
                setVisualsDir(visualsDirOf(home));
            }
        });
        return () => {
            live = false;
        };
    }, []);
    const host = useMemo(() => ({ agentId, visualsDir }), [agentId, visualsDir]);
    return <VisualHostContext.Provider value={host}>{children}</VisualHostContext.Provider>;
}

// the last height each page reported, so a frame that unmounts with its message (and mounts again) keeps its place
const reportedHeights = new Map<string, number>();

// the nearest ancestor that scrolls, to measure "near the view" against; null (the window) when there is none
function scrollParentOf(el: HTMLElement): HTMLElement | null {
    for (let p = el.parentElement; p != null; p = p.parentElement) {
        const overflowY = getComputedStyle(p).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
            return p;
        }
    }
    return null;
}

function fileNameOf(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

// the app's colours as the page is handed them: read from the root element, where the theme writes its --color-* overrides
function appThemeVars(): Record<string, string> {
    return themeVars((v) => getComputedStyle(document.documentElement).getPropertyValue(v));
}

function LoadingBox({ height }: { height: number }) {
    return (
        <div
            data-chat-visual-loading
            style={{ height }}
            className="flex items-center justify-center bg-surface-raised text-[12px] text-muted"
        >
            Loading visual…
        </div>
    );
}

// a ```arc-visual block: the page it names when there is a host and the path may be drawn, else the block as code
export function VisualBlock({ raw }: { raw: string }) {
    const host = useContext(VisualHostContext);
    if (host == null) {
        return <CodeBlock code={raw} lang={VISUAL_LANG} />;
    }
    if (host.visualsDir == null) {
        return (
            <div className="my-2 overflow-hidden rounded-[10px]">
                <LoadingBox height={frameHeight(undefined, false)} />
            </div>
        );
    }
    const found = visualPathOf(raw, host.visualsDir);
    if ("refused" in found) {
        return (
            <>
                <CodeBlock code={raw} lang={VISUAL_LANG} />
                <div data-chat-visual-refused className="mt-1 text-[11.5px] text-muted">
                    Shown as code: {found.refused}
                </div>
            </>
        );
    }
    // keyed by the path: a reply rewritten to name another page is a new frame, not the old one with a stale height
    return <ChatVisual key={found.path} path={found.path} agentId={host.agentId} />;
}

function ChatVisual({ path, agentId }: { path: string; agentId: string }) {
    const fileName = fileNameOf(path);
    const figureRef = useRef<HTMLElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [src, setSrc] = useState<string | null>(null);
    const [missing, setMissing] = useState(false);
    // true once the figure has been within 600px of the scroller's view; the frame is then kept, not unmounted again
    const [near, setNear] = useState(false);
    const [reported, setReported] = useState<number | undefined>(() => reportedHeights.get(path));
    const [expanded, setExpanded] = useState(false);
    // when this frame's last prompt was taken (a send or a fill), for promptAction's gap
    const lastPromptAt = useRef<number | null>(null);
    // the colours last posted to this frame; null until the page has said arc-html-ready, so the theme observer waits for it
    const postedTheme = useRef<Record<string, string> | null>(null);

    useEffect(() => {
        let live = true;
        setSrc(null);
        setMissing(false);
        servedPath(path).then(
            (p) => live && setSrc(getWebServerEndpoint() + p),
            () => live && setMissing(true)
        );
        return () => {
            live = false;
        };
    }, [path]);

    useEffect(() => {
        const figure = figureRef.current;
        if (near || figure == null) {
            return;
        }
        if (typeof IntersectionObserver === "undefined") {
            setNear(true);
            return;
        }
        const observer = new IntersectionObserver(
            (seen) => {
                if (seen.some((s) => s.isIntersecting)) {
                    setNear(true);
                    observer.disconnect();
                }
            },
            { root: scrollParentOf(figure), rootMargin: "600px 0px" }
        );
        observer.observe(figure);
        return () => observer.disconnect();
    }, [near]);

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            const frame = frameRef.current;
            const win = frame?.contentWindow;
            // a page speaks only for its own frame: another visual's frame, the File tab's page or the app itself is ignored
            if (frame == null || win == null || e.source !== win) {
                return;
            }
            const data = e.data;
            if (data == null || typeof data !== "object") {
                return;
            }
            if (data.type === "arc-html-height") {
                if (typeof data.h === "number" && Number.isFinite(data.h)) {
                    reportedHeights.set(path, data.h);
                    setReported(data.h);
                }
            } else if (data.type === "arc-html-ready") {
                // the page is at wavesrv's origin, not the app's: it cannot read the app's colours, so they are handed over
                // (every time it says ready, also when the page loads again: a new document has none)
                const vars = appThemeVars();
                postedTheme.current = vars;
                win.postMessage({ type: "arc-visual-theme", vars }, "*");
            } else if (data.type === "arc-visual-prompt") {
                const action = promptAction({
                    fromFrame: true,
                    frameFocused: document.activeElement === frame,
                    text: data.text,
                    draft: chatBoxText(agentId),
                    sinceLastMs: lastPromptAt.current == null ? Infinity : Date.now() - lastPromptAt.current,
                });
                if (action === "drop") {
                    return;
                }
                const text = data.text as string;
                const taken = action === "send" ? submitIntoChatBox(agentId, text) : appendToChatBox(agentId, text);
                if (taken) {
                    lastPromptAt.current = Date.now();
                }
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [agentId, path]);

    // A theme switch (a preset, an override, light or dark) rewrites the style or class of the root element, which is the
    // one place every way of changing the colours ends up; the atoms change before that write, so reading the colours
    // on them would read the old theme. Once the page is ready, it is handed the colours again when they differ from
    // those it last got.
    useEffect(() => {
        const observer = new MutationObserver(() => {
            const win = frameRef.current?.contentWindow;
            if (win == null || postedTheme.current == null) {
                return;
            }
            const vars = appThemeVars();
            if (!themeVarsChanged(postedTheme.current, vars)) {
                return;
            }
            postedTheme.current = vars;
            win.postMessage({ type: "arc-visual-theme", vars }, "*");
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
        return () => observer.disconnect();
    }, []);

    const height = frameHeight(reported, expanded);
    const tall = reported !== undefined && reported > FRAME_MAX;
    return (
        <figure
            ref={figureRef}
            data-chat-visual={path}
            className="my-2 overflow-hidden rounded-[10px] border border-edge-mid bg-surface"
        >
            <div className="flex h-8 items-center gap-2 border-b border-edge-faint px-3 text-[11.5px] text-muted">
                <Shapes size={12} strokeWidth={1.8} aria-hidden />
                <span>Visual</span>
                <PathLink path={path} className="font-mono text-ink-mid truncate">
                    {fileName}
                </PathLink>
                <span className="flex-1" />
                {tall ? (
                    <button
                        type="button"
                        data-chat-visual-expand
                        aria-label={expanded ? "Show less" : "Show all of the visual"}
                        title={expanded ? "Show less" : "Show all of the visual"}
                        onClick={() => setExpanded(!expanded)}
                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        {expanded ? (
                            <Minimize2 size={12} strokeWidth={1.8} aria-hidden />
                        ) : (
                            <Maximize2 size={12} strokeWidth={1.8} aria-hidden />
                        )}
                    </button>
                ) : null}
            </div>
            {missing ? (
                <div data-chat-visual-missing className="px-3 py-2.5 text-[12.5px] text-muted">
                    Visual not found: <code>{path}</code>
                </div>
            ) : src == null ? (
                <LoadingBox height={frameHeight(undefined, false)} />
            ) : near ? (
                <iframe
                    ref={frameRef}
                    title={"Visual " + fileName}
                    src={src}
                    // the page runs its own scripts at wavesrv's origin, never the app's, and reaches nothing but its own
                    // folder (htmlserve's CSP), the same frame the File tab draws
                    sandbox="allow-scripts allow-same-origin"
                    style={{ height }}
                    className="block w-full border-0"
                />
            ) : (
                <div style={{ height }} className="bg-surface-raised" />
            )}
        </figure>
    );
}

declare global {
    interface Window {
        // DEV only, for the agent-chat scenario: the folder a visual may sit in, in place of ~/.arc/visuals (forward slashes)
        __chatVisualsDir?: string;
    }
}
