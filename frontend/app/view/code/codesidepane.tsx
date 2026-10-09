// frontend/app/view/code/codesidepane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The side column: one file, read-only, in Preview, Source or PDF. It reads the file the way the Agent panel's File
// tab does (filetabload.ts), re-reading once a second while it changes, and shows the main column's draft instead
// when both show the same file, so a preview follows the typing. Editing is the main column's: "Open in main".

import { Markdown } from "@/app/element/markdown";
import { openLink } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatSize, readPanelFile, type PanelFile } from "@/app/view/agents/filetabload";
import { PdfFrame } from "@/app/view/agents/pdfframe";
import { SurfaceEmptyState } from "@/app/view/agents/surfacescaffold";
import { formatChordString } from "@/util/keysym";
import { joinRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowLeftToLine, X } from "lucide-react";
import type * as MonacoTypes from "monaco-editor";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OUTLINE_SELECTOR, WithOutline } from "../agents/docoutlineview";
import { isMarkdownPath, isTexPath, languageForPath } from "./codeclassify";
import { splitFrontmatter } from "./codefrontmatter";
import { isPreviewable } from "./codepreviewable";
import { closeSide, effectiveSideMode, setSideMode, sideModesFor, type CodeSide } from "./codeside";
import { codeDraftsAtom, openPath, type CodeProject } from "./codestore";
import { useWrap } from "./codewrap";
import { FrontmatterCard } from "./frontmattercard";
import { texPdfMeta } from "./texpdf";
import { TexPreview } from "./texpreview";

const MonacoCodeEditor = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoCodeEditor })));

const POLL_MS = 1000;
const DOC_FONT_SIZE = 14;
const OPTIONS: MonacoTypes.editor.IEditorOptions = {
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbersMinChars: 3,
    renderLineHighlight: "none",
    scrollbar: { useShadows: false, verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
};

function stampOf(f: PanelFile): string | undefined {
    if (f.kind === "text") {
        return f.stamp;
    }
    return f.kind === "pdf" ? `${f.size}:${f.modtime}` : undefined;
}

// the file on disk, re-read each second; readPanelFile answers null while its size and modtime hold
function useSideFile(abs: string): PanelFile {
    const [state, setState] = useState<PanelFile>({ kind: "loading" });
    const stampRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        let live = true;
        let busy = false;
        stampRef.current = undefined;
        setState({ kind: "loading" });
        const read = () => {
            if (busy) {
                return;
            }
            busy = true;
            fireAndForget(async () => {
                try {
                    const next = await readPanelFile(abs, stampRef.current);
                    if (live && next != null) {
                        stampRef.current = stampOf(next);
                        setState(next);
                    }
                } finally {
                    busy = false;
                }
            });
        };
        read();
        const timer = setInterval(read, POLL_MS);
        return () => {
            live = false;
            clearInterval(timer);
        };
    }, [abs]);
    return state;
}

// a .tex file's built PDF, looked up again whenever the source changes on disk (a build usually follows a save)
function useSidePdf(abs: string, tex: boolean, stamp: string | undefined): CommandDocPdfFindRtnData | null {
    const [found, setFound] = useState<CommandDocPdfFindRtnData | null>(null);
    useEffect(() => {
        if (!tex) {
            setFound(null);
            return;
        }
        let live = true;
        fireAndForget(async () => {
            let next: CommandDocPdfFindRtnData | null = null;
            try {
                next = await RpcApi.DocPdfFindCommand(TabRpcClient, { path: abs });
            } catch {
                next = null;
            }
            if (live) {
                setFound(next?.pdfpath ? next : null);
            }
        });
        return () => {
            live = false;
        };
    }, [abs, tex, stamp]);
    return found;
}

export function CodeSidePane({ project, side }: { project: CodeProject; side: CodeSide }) {
    const abs = joinRepoPath(project.path, side.rel);
    const file = useSideFile(abs);
    const drafts = useAtomValue(codeDraftsAtom);
    const tex = isTexPath(side.rel);
    const pdf = useSidePdf(abs, tex, stampOf(file));
    const text = file.kind === "text" ? (drafts.get(abs)?.text ?? file.text) : "";
    // a file still loading counts as previewable, so the column does not settle on Source before the text arrives
    const previewable = file.kind === "text" ? isPreviewable(side.rel, text) : true;
    const mode = effectiveSideMode(side.rel, side.mode, pdf != null, previewable);
    const modes = file.kind === "pdf" ? [] : sideModesFor(side.rel, pdf != null, previewable);
    const wrap = useWrap(abs);
    const options = useMemo(() => ({ ...OPTIONS, wordWrap: wrap ? ("on" as const) : ("off" as const) }), [wrap]);
    const name = side.rel.split("/").pop() ?? side.rel;

    let body: ReactNode;
    switch (file.kind) {
        case "loading":
            body = <SurfaceEmptyState title="Opening…" body={side.rel} />;
            break;
        case "missing":
            body = <SurfaceEmptyState title="File no longer exists" body={side.rel} />;
            break;
        case "error":
            body = <SurfaceEmptyState title="Could not read the file" body={`${side.rel} — ${file.message}`} />;
            break;
        case "binary":
        case "toolarge":
            body = (
                <SurfaceEmptyState
                    title={file.kind === "binary" ? "Binary file" : "File too large to display"}
                    body={`${side.rel} — ${formatSize(file.size)}`}
                />
            );
            break;
        case "pdf":
            body = <PdfFrame data-code-side-pdf={side.rel} path={abs} version={file.modtime} title={name} />;
            break;
        case "text":
            if (mode === "pdf" && pdf?.pdfpath) {
                body = (
                    <>
                        <PdfFrame
                            data-code-side-pdf={pdf.pdfpath}
                            path={pdf.pdfpath}
                            version={pdf.modtime}
                            title={texPdfMeta(pdf, Date.now())}
                        />
                        <div className="flex-none truncate border-t border-border px-3 py-1 text-[11px] text-muted">
                            {texPdfMeta(pdf, Date.now())}
                        </div>
                    </>
                );
            } else if (mode === "preview" && tex) {
                body = (
                    <WithOutline selector={OUTLINE_SELECTOR.tex} textKey={text}>
                        <TexPreview
                            text={text}
                            onSource={() => setSideMode("source")}
                            onLink={(href) => fireAndForget(() => openLink(href))}
                        />
                    </WithOutline>
                );
            } else if (mode === "preview" && isMarkdownPath(side.rel)) {
                const doc = splitFrontmatter(text);
                body = (
                    <WithOutline selector={OUTLINE_SELECTOR.markdown} textKey={doc.body}>
                        <Markdown
                            text={doc.body}
                            header={doc.fields.length > 0 ? <FrontmatterCard fields={doc.fields} /> : null}
                            scrollable
                            className="markdown-doc h-full"
                            contentClassName="px-8 pb-12 pt-7"
                            fontSizeOverride={DOC_FONT_SIZE}
                            resolveOpts={{ connName: "local", baseDir: abs.replace(/[\\/][^\\/]*$/, "") }}
                        />
                    </WithOutline>
                );
            } else {
                body = (
                    <Suspense fallback={null}>
                        <MonacoCodeEditor
                            key={abs}
                            // "side/" keeps this model apart from the main editor's and the diff's, so the same file
                            // in both columns never shares or collides on one
                            path={`side/${abs}`}
                            text={text}
                            language={languageForPath(side.rel)}
                            readonly
                            options={options}
                        />
                    </Suspense>
                );
            }
            break;
    }

    return (
        <div data-code-side={side.rel} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-1.5">
                <span title={abs} className="min-w-0 truncate text-[11.5px] text-secondary">
                    {side.rel}
                </span>
                {modes.length > 1 ? (
                    <div className="flex flex-none items-center gap-0.5 rounded-[6px] border border-border p-[2px]">
                        {modes.map((m) => (
                            <button
                                key={m}
                                type="button"
                                data-code-side-mode={m}
                                aria-pressed={m === mode}
                                onClick={() => setSideMode(m)}
                                className={cn(
                                    "cursor-pointer rounded-[4px] px-2 py-[2px] text-[11px] capitalize",
                                    m === mode ? "bg-accent/10 text-accent-soft" : "text-muted hover:text-primary"
                                )}
                            >
                                {m === "pdf" ? "PDF" : m}
                            </button>
                        ))}
                    </div>
                ) : null}
                <div className="flex-1" />
                <button
                    type="button"
                    data-code-side-main
                    title="Open in the main column to edit"
                    onClick={() => {
                        closeSide();
                        fireAndForget(() => openPath(side.rel));
                    }}
                    className="flex flex-none cursor-pointer items-center gap-1 rounded-[6px] border border-border px-2 py-[3px] text-[11px] text-muted hover:text-primary"
                >
                    <ArrowLeftToLine size={11} strokeWidth={1.8} />
                    <span>Open in main</span>
                </button>
                <button
                    type="button"
                    data-code-side-close
                    aria-label="Close the side column"
                    title={`Close the side column (${formatChordString("Mod:\\")})`}
                    onClick={closeSide}
                    className="flex size-6 flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-primary"
                >
                    <X size={13} strokeWidth={1.8} />
                </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{body}</div>
        </div>
    );
}
