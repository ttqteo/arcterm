// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's File tab: one file, read-only, at a line (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md).
// A markdown file renders as a document that takes comments (docs/superpowers/specs/2026-10-06-md-comments-design.md);
// Source is the Monaco view. Editing is the Code surface's job, one click away.

import { SkeletonLine } from "@/app/element/skeleton";
import { isMarkdownPath, languageForPath } from "@/app/view/code/codeclassify";
import { toggleWrap, useWrap } from "@/app/view/code/codewrap";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ArrowUpRight, ChevronLeft, ChevronRight, WrapText } from "lucide-react";
import type * as MonacoTypes from "monaco-editor";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { closeRailFile, openRefInCode, railFileBack, railFileForward, railMdModeAtom } from "./agentrailstore";
import { fileLabel, type FileHistory } from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { formatSize, readPanelFile, type PanelFile } from "./filetabload";
import { cancelBox, mdCommentAtom } from "./mdcommentstore";
import { MdCommentTray } from "./mdcommenttray";
import { MdDoc } from "./mddoc";
import { PdfFrame } from "./pdfframe";

const MonacoCodeEditor = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoCodeEditor })));

const OPTIONS: MonacoTypes.editor.IEditorOptions = {
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    folding: false,
    lineNumbersMinChars: 3,
    renderLineHighlight: "none",
    scrollbar: { useShadows: false, verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
};
const LIVE_POLL_MS = 1000;
// the line a link named: a grey fill (selection is grey, DESIGN.md) and an accent mark in the gutter
const HIT_LINE = "bg-surface-hover";
const HIT_MARK = "border-l-2 border-accent";
const ICON_BTN =
    "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary disabled:cursor-default disabled:text-edge-strong disabled:hover:bg-transparent";
const BTN =
    "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border border-edge-mid bg-transparent px-2 text-[11.5px] font-medium text-secondary hover:border-edge-strong";

export function FileTab({ model, agent, file }: { model: AgentsViewModel; agent: AgentVM; file: FileHistory }) {
    const agentId = agent.id;
    const ref = file.current;
    const [state, setState] = useState<PanelFile>({ kind: "loading" });
    const [mdMode, setMdMode] = useAtom(railMdModeAtom);
    const drafts = useAtomValue(mdCommentAtom(agentId));
    const [following, setFollowing] = useState(ref?.live === "on");
    const followingRef = useRef(following);
    followingRef.current = following;
    const stampRef = useRef<string | undefined>(undefined);
    stampRef.current = state.kind === "text" ? state.stamp : undefined;
    const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
    const stickRef = useRef(true); // the view sits at the end, so new output keeps it there
    const wrap = useWrap(ref?.abs ?? "");
    const options = useMemo(() => ({ ...OPTIONS, wordWrap: wrap ? ("on" as const) : ("off" as const) }), [wrap]);
    useEffect(() => {
        if (ref == null) {
            return;
        }
        let live = true;
        setState({ kind: "loading" });
        setFollowing(ref.live === "on");
        stickRef.current = true;
        fireAndForget(async () => {
            const next = await readPanelFile(ref.abs);
            if (live && next != null) {
                setState(next);
            }
        });
        return () => {
            live = false;
        };
    }, [ref?.abs, ref?.reread]);
    // Live: read the file again each second, in place, while it changes
    useEffect(() => {
        if (ref == null || !following) {
            return;
        }
        let live = true;
        let busy = false;
        const timer = setInterval(() => {
            if (busy) {
                return;
            }
            busy = true;
            fireAndForget(async () => {
                try {
                    const next = await readPanelFile(ref.abs, stampRef.current);
                    if (live && next != null) {
                        setState(next);
                    }
                } finally {
                    busy = false;
                }
            });
        }, LIVE_POLL_MS);
        return () => {
            live = false;
            clearInterval(timer);
        };
    }, [ref?.abs, following]);
    if (ref == null) {
        return null;
    }
    const markdown = isMarkdownPath(ref.abs);
    const preview = markdown && mdMode === "preview";
    const { dir, name } = fileLabel(ref);
    const openCode = () => fireAndForget(() => openRefInCode(model, ref));
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            if (preview && drafts.box?.file === ref.abs) {
                cancelBox(agentId);
                // focus may have been on the box's own buttons, which are gone now
                e.currentTarget.querySelector<HTMLElement>("[data-md-doc]")?.focus({ preventScroll: true });
                return;
            }
            closeRailFile(agentId);
            return;
        }
        // Ctrl+Enter sends from anywhere in the tab but a comment box, which takes it to add the comment
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !(e.target instanceof HTMLTextAreaElement)) {
            const send = e.currentTarget.querySelector<HTMLButtonElement>("[data-md-send]");
            if (send != null && !send.disabled) {
                e.preventDefault();
                e.stopPropagation();
                send.click();
            }
        }
    };

    let body: ReactNode;
    if (state.kind === "loading") {
        body = (
            <div aria-hidden="true" className="flex flex-col gap-2.5 px-3.5 py-3">
                {["w-[46%]", "w-[80%]", "w-[64%]", "w-[72%]", "w-[58%]"].map((w, i) => (
                    <SkeletonLine key={i} className={cn("h-[10px]", w)} />
                ))}
            </div>
        );
    } else if (state.kind === "pdf") {
        body = <PdfFrame data-file-pdf={ref.abs} path={ref.abs} version={state.modtime} title={name} />;
    } else if (state.kind === "text" && preview) {
        body = <MdDoc model={model} agent={agent} fileRef={ref} text={state.text} />;
    } else if (state.kind === "text") {
        const line = ref.line;
        body = (
            <Suspense fallback={null}>
                <MonacoCodeEditor
                    key={`${ref.abs}:${line ?? ""}`}
                    // "file/" keeps these models apart from the Code and Diff surfaces'; the extension stays last so
                    // Monaco still picks the language
                    path={`file/${ref.abs}`}
                    text={state.text}
                    language={languageForPath(ref.abs)}
                    readonly
                    options={options}
                    onMount={(editor, monacoApi) => {
                        editorRef.current = editor;
                        const toEnd = () => editor.revealLine(editor.getModel()?.getLineCount() ?? 1);
                        // scrolled by the reader (not by the text growing): stuck when it ends at the bottom
                        const scrolled = editor.onDidScrollChange((e) => {
                            if (e.scrollTopChanged) {
                                stickRef.current = e.scrollTop + editor.getLayoutInfo().height >= e.scrollHeight - 24;
                            }
                        });
                        const grew = editor.onDidChangeModelContent(() => {
                            if (followingRef.current && stickRef.current) {
                                toEnd();
                            }
                        });
                        const unmount = () => {
                            scrolled.dispose();
                            grew.dispose();
                            editorRef.current = null;
                        };
                        if (line == null) {
                            if (followingRef.current) {
                                toEnd();
                            }
                            return unmount;
                        }
                        editor.revealLineInCenter(line);
                        editor.setPosition({ lineNumber: line, column: 1 });
                        const hit = editor.createDecorationsCollection([
                            {
                                range: new monacoApi.Range(line, 1, line, 1),
                                options: {
                                    isWholeLine: true,
                                    className: HIT_LINE,
                                    linesDecorationsClassName: HIT_MARK,
                                },
                            },
                        ]);
                        return () => {
                            hit.clear();
                            unmount();
                        };
                    }}
                />
            </Suspense>
        );
    } else {
        const msg =
            state.kind === "missing"
                ? { title: "This file no longer exists", body: `${dir}${name} was deleted or moved.`, close: true }
                : state.kind === "error"
                  ? { title: "Cannot read this file", body: state.message, close: false }
                  : {
                        title: `${state.kind === "binary" ? "Binary file" : "Large file"}, ${formatSize(state.size)}`,
                        body: "The panel shows text files up to 2 MB.",
                        close: false,
                    };
        body = (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center">
                <div className="text-[13px] font-semibold text-ink-hi">{msg.title}</div>
                <div className="text-[12px] leading-[1.5] text-ink-mid">{msg.body}</div>
                <button
                    type="button"
                    onClick={msg.close ? () => closeRailFile(agentId) : openCode}
                    className={cn(BTN, "mt-1.5")}
                >
                    {msg.close ? "Close" : "Open in Code"}
                </button>
            </div>
        );
    }

    return (
        // data-owns-keys: the panel's own keys (Esc here) reach it before the surface's (dispatcher.ts ownsKeys)
        <div data-rail-file={ref.abs} data-owns-keys onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
                <button
                    type="button"
                    aria-label="Back"
                    disabled={file.back.length === 0}
                    onClick={() => railFileBack(agentId)}
                    className={ICON_BTN}
                >
                    <ChevronLeft size={14} aria-hidden />
                </button>
                <button
                    type="button"
                    aria-label="Forward"
                    disabled={file.forward.length === 0}
                    onClick={() => railFileForward(agentId)}
                    className={ICON_BTN}
                >
                    <ChevronRight size={14} aria-hidden />
                </button>
                <span title={ref.abs} className="min-w-0 flex-1 truncate text-[11.5px]">
                    <span className="text-muted">{dir}</span>
                    <span className="text-ink-hi">{name}</span>
                    {ref.line != null ? <span className="text-muted">:{ref.line}</span> : null}
                </span>
                {markdown ? (
                    <div
                        role="group"
                        aria-label="View"
                        className="flex flex-none items-center gap-0.5 rounded-[6px] border border-border p-[2px]"
                    >
                        {(["preview", "source"] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                data-md-mode={m}
                                aria-pressed={mdMode === m}
                                onClick={() => setMdMode(m)}
                                className={cn(
                                    "cursor-pointer rounded-[4px] border-0 px-2 py-[2px] text-[11px] capitalize",
                                    mdMode === m
                                        ? "bg-accent/10 text-accent-soft"
                                        : "bg-transparent text-muted hover:text-primary"
                                )}
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                ) : null}
                {state.kind === "text" && !preview ? (
                    <button
                        type="button"
                        data-file-wrap
                        aria-pressed={wrap}
                        title={wrap ? "Stop wrapping long lines" : "Wrap long lines"}
                        onClick={() => toggleWrap(ref.abs)}
                        className={cn(BTN, wrap && "border-accent/40 text-accent-soft hover:border-accent/60")}
                    >
                        <WrapText size={11} aria-hidden />
                        Wrap
                    </button>
                ) : null}
                {ref.live != null ? (
                    <button
                        type="button"
                        data-file-live
                        aria-pressed={following}
                        title={following ? "Stop following the output" : "Follow the output as it grows"}
                        onClick={() => {
                            if (!following) {
                                stickRef.current = true;
                                const editor = editorRef.current;
                                editor?.revealLine(editor.getModel()?.getLineCount() ?? 1);
                            }
                            setFollowing(!following);
                        }}
                        className={cn(BTN, following && "border-accent/40 text-accent-soft hover:border-accent/60")}
                    >
                        <span
                            aria-hidden
                            className={cn("h-1.5 w-1.5 rounded-full", following ? "pulse-dot bg-working" : "bg-muted")}
                        />
                        Live
                    </button>
                ) : null}
                <button type="button" onClick={openCode} className={BTN}>
                    Open in Code
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            </div>
            <div className={cn("flex min-h-0 flex-1 flex-col", preview ? "bg-background" : "bg-surface-code")}>
                {body}
            </div>
            {markdown || drafts.comments.length > 0 || drafts.lastSend != null || drafts.box != null ? (
                <MdCommentTray model={model} agent={agent} shownAbs={ref.abs} />
            ) : null}
        </div>
    );
}
