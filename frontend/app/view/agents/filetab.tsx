// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's File tab: one file, read-only, at a line (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md).
// Editing is the Code surface's job, one click away.

import { SkeletonLine } from "@/app/element/skeleton";
import { cn, fireAndForget } from "@/util/util";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import type * as MonacoTypes from "monaco-editor";
import { lazy, Suspense, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { closeRailFile, openRefInCode, railFileBack, railFileForward } from "./agentrailstore";
import { fileLabel, type FileHistory } from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import { formatSize, readPanelFile, type PanelFile } from "./filetabload";

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
// the line a link named: a grey fill (selection is grey, DESIGN.md) and an accent mark in the gutter
const HIT_LINE = "bg-surface-hover";
const HIT_MARK = "border-l-2 border-accent";
const ICON_BTN =
    "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary disabled:cursor-default disabled:text-edge-strong disabled:hover:bg-transparent";
const BTN =
    "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border border-edge-mid bg-transparent px-2 text-[11.5px] font-medium text-secondary hover:border-edge-strong";

export function FileTab({ model, agentId, file }: { model: AgentsViewModel; agentId: string; file: FileHistory }) {
    const ref = file.current;
    const [state, setState] = useState<PanelFile>({ kind: "loading" });
    useEffect(() => {
        if (ref == null) {
            return;
        }
        let live = true;
        setState({ kind: "loading" });
        fireAndForget(async () => {
            const next = await readPanelFile(ref.abs);
            if (live) {
                setState(next);
            }
        });
        return () => {
            live = false;
        };
    }, [ref?.abs]);
    if (ref == null) {
        return null;
    }
    const { dir, name } = fileLabel(ref);
    const openCode = () => fireAndForget(() => openRefInCode(model, ref));
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            closeRailFile(agentId);
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
                    readonly
                    options={OPTIONS}
                    onMount={(editor, monacoApi) => {
                        if (line == null) {
                            return () => {};
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
                        return () => hit.clear();
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
                <button type="button" onClick={openCode} className={BTN}>
                    Open in Code
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            </div>
            <div className="min-h-0 flex-1 bg-surface-code">{body}</div>
        </div>
    );
}
