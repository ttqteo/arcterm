// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The terminal Code peek's card: header, mode row, the body for the peek's file state, and the footer. Read-only
// throughout; it renders CodeEditor, Markdown and the Monaco diff viewer directly, never through the Code surface's
// atoms. Enter opens the file in Code and Escape closes the card, handled here: the root is data-owns-keys, so while
// focus is inside it the Agent surface's own Escape (agent:back) and Enter bindings stand down (dispatcher.ts
// ownsKeys), the way backgroundtaskpeek.tsx's do. With focus in the terminal the card does not touch Escape.

import { Markdown } from "@/app/element/markdown";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { cn, fireAndForget } from "@/util/util";
import { X } from "lucide-react";
import type * as MonacoTypes from "monaco-editor";
import { lazy, Suspense, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { languageForPath } from "./codeclassify";
import {
    binaryPeekMessage,
    canOpenPeek,
    peekHeaderPath,
    peekModes,
    peekStat,
    toolargePeekMessage,
    type PeekFile,
    type PeekMode,
} from "./codepeekmodel";
import { closePeek, codePeekFocusedAtom, openPeekInCode, setPeekMode, type CodePeek } from "./codepeekstore";

const MonacoDiffViewer = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoDiffViewer })));
const MonacoInsertedText = lazy(() =>
    import("@/app/monaco/monaco-inserted").then((m) => ({ default: m.MonacoInsertedText }))
);

const MODES: { mode: PeekMode; label: string }[] = [
    { mode: "preview", label: "Preview" },
    { mode: "source", label: "Source" },
    { mode: "diff", label: "Diff" },
];

// keeps the peek's editor models out of the Code surface's kept-model namespace
const MODEL_PREFIX = "peek/";
// its own model uri, apart from the Source view's editor model for the same file
const INSERTED_PREFIX = "peek-new/";

const DIFF_OPTIONS: MonacoTypes.editor.IDiffEditorOptions = {
    readOnly: true,
    originalEditable: false,
    renderSideBySide: false,
    scrollBeyondLastLine: false,
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    minimap: { enabled: false },
    scrollbar: { useShadows: false, verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
};

// the file's name in the terminal's folder when it is under it, else the full path
function headerPath(peek: CodePeek): string {
    return peekHeaderPath(peek.abs, peek.root);
}

function stateMessage(peek: CodePeek): string | null {
    const file = peek.file;
    switch (file.kind) {
        case "loading":
            return `Reading ${peek.abs}…`;
        case "missing":
            return `No such file: ${peek.abs}`;
        case "binary":
            return binaryPeekMessage(peek.abs);
        case "toolarge":
            return toolargePeekMessage(peek.abs);
        case "error":
            return file.message;
        case "text":
            return null;
    }
}

function Kbd({ children }: { children: string }) {
    return (
        <kbd className="rounded-[4px] border border-edge-strong px-[5px] font-mono text-[10.5px] text-ink-mid">
            {children}
        </kbd>
    );
}

function PeekStat({ file }: { file: PeekFile }) {
    const stat = peekStat(file);
    if (stat == null) {
        return null;
    }
    return (
        <span data-peek-stat className="flex items-center gap-[8px] font-mono text-[11px]">
            {stat.label ? <span className="text-muted">{stat.label}</span> : null}
            {stat.adds ? <span className="text-success">+{stat.adds}</span> : null}
            {stat.dels ? <span className="text-error">−{stat.dels}</span> : null}
        </span>
    );
}

function SourceView({ peek, blockId, text }: { peek: CodePeek; blockId: string; text: string }) {
    const line = peek.line;
    return (
        <CodeEditor
            blockId={blockId}
            text={text}
            fileName={MODEL_PREFIX + peek.abs}
            language={languageForPath(peek.abs)}
            readonly
            onMount={(ed) => {
                if (line != null) {
                    ed.revealLineInCenter(line);
                    ed.setPosition({ lineNumber: line, column: 1 });
                }
                return () => {};
            }}
        />
    );
}

function DiffView({ peek, text }: { peek: CodePeek; text: string }) {
    const git = peek.file.kind === "text" ? peek.file.git : null;
    if (git?.kind !== "repo") {
        return null;
    }
    if (git.head.kind === "error") {
        return <PeekMessage text={git.head.message} />;
    }
    const absent = git.head.kind === "absent";
    return (
        <div className="flex h-full flex-col bg-surface-code">
            {absent ? (
                <div className="flex-none px-[14px] pt-[10px] pb-[8px] text-[11px] text-muted">
                    New file, not in HEAD
                </div>
            ) : null}
            <div className="min-h-0 flex-1">
                <Suspense fallback={null}>
                    {absent ? (
                        <MonacoInsertedText path={INSERTED_PREFIX + peek.abs} text={text} options={DIFF_OPTIONS} />
                    ) : (
                        <MonacoDiffViewer
                            path={MODEL_PREFIX + peek.abs}
                            language={languageForPath(peek.abs)}
                            original={git.head.kind === "text" ? git.head.text : ""}
                            modified={text}
                            options={DIFF_OPTIONS}
                        />
                    )}
                </Suspense>
            </div>
        </div>
    );
}

function PeekMessage({ text }: { text: string }) {
    return (
        <div data-peek-message className="px-[14px] py-[12px] font-mono text-[12px] break-all text-muted">
            {text}
        </div>
    );
}

function PeekBody({ peek, blockId }: { peek: CodePeek; blockId: string }) {
    const file = peek.file;
    if (file.kind !== "text") {
        return <PeekMessage text={stateMessage(peek) ?? ""} />;
    }
    // keyed by the file, so a moved card never shows the previous file's models
    const key = `${peek.abs}|${peek.mode}`;
    if (peek.mode === "preview") {
        return (
            <Markdown key={key} text={file.text} scrollable className="h-full" contentClassName="px-[26px] py-[20px]" />
        );
    }
    if (peek.mode === "diff") {
        return <DiffView key={key} peek={peek} text={file.text} />;
    }
    return <SourceView key={`${key}|${peek.line}`} peek={peek} blockId={blockId} text={file.text} />;
}

// a focused control's own Enter is its press
function isPressable(el: EventTarget | null): boolean {
    return el instanceof Element && el.closest("button, a, [role='button']") != null;
}

export function CodePeekCard({
    peek,
    model,
    blockId,
    side,
}: {
    peek: CodePeek;
    model: AgentsViewModel;
    blockId: string;
    side: "below" | "above";
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const modes = useMemo(() => peekModes(peek.abs, peek.file), [peek.abs, peek.file]);
    const path = headerPath(peek);
    const canOpen = canOpenPeek(peek.file);

    // a new anchor is a new card: it takes focus so Enter and Esc reach it
    useEffect(() => {
        rootRef.current?.focus({ preventScroll: true });
    }, [peek.blockId, peek.bufferLine, peek.start]);

    // capture, ahead of Monaco's own handling of a key inside the card; an Enter on a button is still that button's
    const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.nativeEvent.isComposing) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closePeek();
        } else if (e.key === "Enter" && canOpen && !isPressable(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            fireAndForget(() => openPeekInCode(model));
        }
    };

    return (
        <div
            ref={rootRef}
            tabIndex={-1}
            role="dialog"
            aria-label={`Peek at ${path}`}
            data-owns-keys
            data-code-peek
            data-peek-state={peek.file.kind}
            data-peek-side={side}
            onKeyDownCapture={onKeyDownCapture}
            onFocus={() => globalStore.set(codePeekFocusedAtom, true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    globalStore.set(codePeekFocusedAtom, false);
                }
            }}
            className="flex h-full w-full flex-col overflow-hidden rounded-[8px] border border-edge-strong bg-background text-primary shadow-popover-md outline-none"
        >
            <div className="flex min-h-[44px] flex-none items-center gap-[10px] border-b border-border pr-[8px] pl-[14px]">
                <span className="font-mono text-[10.5px] font-bold tracking-[0.1em] text-accent-soft uppercase">
                    File
                </span>
                <span
                    data-peek-path
                    title={peek.abs}
                    className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-secondary"
                >
                    {path}
                </span>
                <button
                    type="button"
                    aria-label="Close the peek"
                    onClick={closePeek}
                    className="flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-surface-raised hover:text-secondary"
                >
                    <X size={14} aria-hidden />
                </button>
            </div>
            <div className="flex flex-none items-center gap-[8px] border-b border-border px-[12px] py-[6px]">
                <div className="flex items-center gap-[2px] rounded-[6px] border border-border p-[2px]">
                    {MODES.map(({ mode, label }) => {
                        const state = modes[mode];
                        const pressed = peek.mode === mode && state.enabled;
                        return (
                            <button
                                key={mode}
                                type="button"
                                data-peek-mode={mode}
                                aria-pressed={pressed}
                                disabled={!state.enabled}
                                title={state.reason}
                                onClick={() => setPeekMode(mode)}
                                className={cn(
                                    "rounded-[4px] px-[8px] py-[2px] text-[11px]",
                                    pressed ? "bg-accentbg text-accent-soft" : "text-muted",
                                    state.enabled ? "cursor-pointer hover:text-secondary" : "cursor-default opacity-50"
                                )}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
                <PeekStat file={peek.file} />
                <span className="flex-1" />
                <span className="text-[11px] text-muted">Read-only</span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                <PeekBody peek={peek} blockId={blockId} />
            </div>
            <div className="flex flex-none items-center gap-[12px] border-t border-border px-[14px] py-[10px]">
                <button
                    type="button"
                    data-peek-open
                    disabled={!canOpen}
                    onClick={() => fireAndForget(() => openPeekInCode(model))}
                    className="cursor-pointer rounded-[7px] bg-accent px-[13px] py-[7px] text-[12px] font-semibold text-background disabled:cursor-default disabled:opacity-50"
                >
                    Open in Code
                </button>
                <span className="flex-1" />
                <span className="flex items-center gap-[6px] text-[11px] text-muted">
                    <Kbd>Enter</Kbd>open in Code
                </span>
                <span className="flex items-center gap-[6px] text-[11px] text-muted">
                    <Kbd>Esc</Kbd>close
                </span>
            </div>
        </div>
    );
}
