// frontend/app/view/code/codeviewer.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Renders whichever variant the store resolved the opened file to. The text case hands off to the
// existing Monaco wrapper, which derives the language from the filename — so Go, Rust and TypeScript
// all highlight without a language map here. Only the text case is editable; every other variant
// (binary, too large, missing, unreadable) stays a dead end by construction.
//
// This is also the only module that touches Monaco directly. The store publishes a pending line and
// a handoff asks for the current selection; both are served here so codestore.ts stays IO-and-atoms.

import { Markdown } from "@/app/element/markdown";
import { openLink } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { PdfFrame } from "@/app/view/agents/pdfframe";
import { SurfaceEmptyState } from "@/app/view/agents/surfacescaffold";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { joinRepoPath } from "@/util/paths";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import { useEffect } from "react";
import { isMarkdownPath, isTexPath, languageForPath, resolveViewMode } from "./codeclassify";
import { CodeDiffView } from "./codediffview";
import { remember } from "./codeeditorcache";
import { splitFrontmatter } from "./codefrontmatter";
import { resolveDocLink } from "./codelink";
import {
    codeDraftsAtom,
    codeFileAtom,
    codePendingLineAtom,
    codeProjectAtom,
    codeTexPdfAtom,
    codeViewModeAtom,
    draftKey,
    editDraft,
    openInCode,
    refreshIndex,
    setCaretLineReader,
    texPdfFor,
} from "./codestore";
import { useWrap } from "./codewrap";
import { FrontmatterCard } from "./frontmattercard";
import { texPdfMeta } from "./texpdf";
import { TexPreview } from "./texpreview";

// DESIGN.md's markdown size (14px text, 12px mono). It reads at that size because .markdown-doc holds the
// document to a centred reading column instead of letting lines run the width of a maximized pane.
const DOC_FONT_SIZE = 14;

function sizeLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Module-scoped rather than a ref: the store's caret-line reader needs the same instance, and the
// surface unmounts on every nav switch. Cleared by the cleanup CodeEditor invokes on unmount.
let editor: MonacoTypes.editor.IStandaloneCodeEditor | null = null;

setCaretLineReader(() => editor?.getPosition()?.lineNumber ?? null);

// The editor unmounts on every file, mode and surface switch. Its model is kept alive and its view
// state saved here, keyed like drafts by absolute path, so coming back restores the caret, scroll,
// selection and undo history. Capped because every kept model holds a full copy of its file.
const KEPT_EDITORS = 20;

interface KeptEditor {
    model: MonacoTypes.editor.ITextModel;
    view: MonacoTypes.editor.ICodeEditorViewState | null;
}

const kept = new Map<string, KeptEditor>();

function applyPendingLine(ed: MonacoTypes.editor.IStandaloneCodeEditor): void {
    const line = globalStore.get(codePendingLineAtom);
    if (line == null) {
        return;
    }
    globalStore.set(codePendingLineAtom, null);
    // a history walk has usually just restored a view that already shows the line, and re-centering
    // it — or dropping the caret's column — would jolt what the reader left
    ed.revealLineInCenterIfOutsideViewport(line);
    if (ed.getPosition()?.lineNumber !== line) {
        ed.setPosition({ lineNumber: line, column: 1 });
    }
}

function restoreKept(ed: MonacoTypes.editor.IStandaloneCodeEditor, key: string): void {
    const saved = kept.get(key);
    // the mounted model leaves the cache so an eviction can never dispose it out from under the editor
    kept.delete(key);
    if (saved != null) {
        ed.restoreViewState(saved.view);
    }
}

// Both CodeEditor and the Monaco wrapper run this on unmount; the second call finds no model.
function keepEditor(ed: MonacoTypes.editor.IStandaloneCodeEditor, key: string): void {
    const model = ed.getModel();
    if (model == null) {
        return;
    }
    for (const old of remember(kept, key, { model, view: ed.saveViewState() }, KEPT_EDITORS)) {
        old.model.dispose();
    }
}

export function CodeViewer({ model }: { model: AgentsViewModel }) {
    const file = useAtomValue(codeFileAtom);
    const project = useAtomValue(codeProjectAtom);
    const drafts = useAtomValue(codeDraftsAtom);
    const pendingLine = useAtomValue(codePendingLineAtom);
    const chosenMode = useAtomValue(codeViewModeAtom);
    const shownAbs = project != null && file.kind !== "none" ? draftKey(project, file.path) : "";
    const wrap = useWrap(shownAbs);
    const texPdf = texPdfFor(useAtomValue(codeTexPdfAtom), shownAbs);
    const mode = file.kind === "none" ? chosenMode : resolveViewMode(file.path, chosenMode, texPdf != null);

    // Two paths, both needed. Monaco is keyed by file path, so opening a DIFFERENT file remounts it
    // and onMount is the only hook that runs late enough to reveal a line. Jumping to another line
    // in the file already open does not remount, so the effect covers that — and it cannot cover
    // the first mount, because Monaco lazy-loads and no re-render follows its arrival.
    useEffect(() => {
        if (pendingLine == null) {
            return;
        }
        // a rendered document or a PDF has no line to reveal; consume the request so a later Source
        // toggle does not half-open the file at a stale position
        if (file.kind === "text" && (mode === "preview" || mode === "pdf")) {
            globalStore.set(codePendingLineAtom, null);
            return;
        }
        if (editor != null) {
            applyPendingLine(editor);
        }
    }, [pendingLine, file, mode]);

    switch (file.kind) {
        case "none":
            return (
                <SurfaceEmptyState
                    title="No file open"
                    body="Pick a file from the tree, or press Ctrl+P to search by name."
                />
            );
        case "loading":
            return <SurfaceEmptyState title="Opening…" body={file.path} />;
        case "missing":
            return (
                <SurfaceEmptyState
                    title="File no longer exists"
                    body={`${file.path} — the file list is a snapshot, so it can fall behind.`}
                    action={{ label: "Refresh index", onClick: () => fireAndForget(refreshIndex) }}
                />
            );
        case "binary":
            return <SurfaceEmptyState title="Binary file" body={`${file.path} — ${sizeLabel(file.size)}`} />;
        case "pdf":
            return (
                <div className="flex h-full min-h-0 flex-col">
                    <PdfFrame
                        key={file.path}
                        data-code-pdf={file.path}
                        path={project != null ? joinRepoPath(project.path, file.path) : file.path}
                        version={file.modtime}
                        title={file.path}
                    />
                </div>
            );
        case "toolarge":
            return (
                <SurfaceEmptyState
                    title="File too large to display"
                    body={`${file.path} — ${sizeLabel(file.size)}`}
                    action={{
                        label: "Copy path",
                        onClick: () => {
                            if (project != null) {
                                void navigator.clipboard?.writeText(joinRepoPath(project.path, file.path));
                            }
                        },
                    }}
                />
            );
        case "error":
            return <SurfaceEmptyState title="Could not read the file" body={`${file.path} — ${file.message}`} />;
        case "text": {
            // `text` is the draft when one exists, so the buffer survives a surface unmount. Monaco's
            // prop-sync effect no-ops when the incoming text already equals the model's (monaco-react
            // checks before pushing an edit), so feeding our own keystrokes back does not move the caret.
            const abs = project != null ? draftKey(project, file.path) : file.path;
            const draft = drafts.get(abs);
            // keyed by path: MonacoDiffViewer creates its models once, so a new file needs a new
            // instance or it keeps the previous file's model URI and language
            if (mode === "diff") {
                return <CodeDiffView key={file.path} path={file.path} text={draft?.text ?? file.text} wrap={wrap} />;
            }
            // the PDF last built from this .tex file's root, never compiled for the view, so its line says how old
            if (mode === "pdf" && texPdf != null) {
                return (
                    <div className="flex h-full min-h-0 flex-col">
                        <PdfFrame
                            key={texPdf.pdfpath}
                            data-code-tex-pdf={texPdf.pdfpath}
                            path={texPdf.pdfpath}
                            version={texPdf.modtime}
                            title={texPdfMeta(texPdf, Date.now())}
                        />
                        <div
                            data-code-tex-pdf-meta
                            className="flex-none truncate border-t border-border px-3 py-1 text-[11px] text-muted"
                        >
                            {texPdfMeta(texPdf, Date.now())}
                        </div>
                    </div>
                );
            }
            // a paper reads as a document too; double-clicking a sentence opens Source at its line
            if (isTexPath(file.path) && mode === "preview") {
                return (
                    <TexPreview
                        key={file.path}
                        text={draft?.text ?? file.text}
                        onSource={(line) => {
                            // mode first: a pending line that lands while the preview still shows is consumed
                            globalStore.set(codeViewModeAtom, "source");
                            globalStore.set(codePendingLineAtom, line);
                        }}
                        onLink={(href) => fireAndForget(() => openLink(href))}
                    />
                );
            }
            // READMEs and other prose render as documents; Source (the CodeEditor below) stays one
            // toggle away, and the draft feeds the preview so unsaved edits show what you would save
            if (isMarkdownPath(file.path) && mode === "preview") {
                const doc = splitFrontmatter(draft?.text ?? file.text);
                return (
                    <Markdown
                        key={file.path}
                        text={doc.body}
                        header={doc.fields.length > 0 ? <FrontmatterCard fields={doc.fields} /> : null}
                        scrollable
                        className="markdown-doc h-full"
                        contentClassName="px-8 pb-12 pt-7"
                        fontSizeOverride={DOC_FONT_SIZE}
                        resolveOpts={{
                            connName: "local",
                            baseDir: (project != null ? joinRepoPath(project.path, file.path) : file.path).replace(
                                /[\\/][^\\/]*$/,
                                ""
                            ),
                        }}
                        onClickLink={(href) => {
                            const target = project != null ? resolveDocLink(file.path, href) : null;
                            if (target == null) {
                                return false;
                            }
                            fireAndForget(() =>
                                openInCode(model, {
                                    projectPath: project.path,
                                    rel: target.rel,
                                    line: target.line ?? undefined,
                                })
                            );
                            return true;
                        }}
                    />
                );
            }
            return (
                // keyed and named by absolute path: kept models outlive a project switch, so two
                // projects' same relative path must not share a model URI
                <CodeEditor
                    key={abs}
                    blockId={model.blockId}
                    text={draft?.text ?? file.text}
                    fileName={abs}
                    language={languageForPath(file.path)}
                    wordWrap={wrap}
                    readonly={false}
                    keepModel
                    onChange={editDraft}
                    onMount={(ed) => {
                        editor = ed;
                        restoreKept(ed, abs);
                        applyPendingLine(ed);
                        return () => {
                            if (editor === ed) {
                                editor = null;
                            }
                            keepEditor(ed, abs);
                        };
                    }}
                />
            );
        }
    }
}
