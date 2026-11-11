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

import { ImageZoom, type ZoomImage } from "@/app/element/imagezoom";
import { Markdown } from "@/app/element/markdown";
import { openLink } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { HtmlFrame } from "@/app/view/agents/htmlframe";
import { ImageFrame } from "@/app/view/agents/imageframe";
import { PdfFrame } from "@/app/view/agents/pdfframe";
import { SurfaceEmptyState } from "@/app/view/agents/surfacescaffold";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { formatChordString } from "@/util/keysym";
import { joinRepoPath } from "@/util/paths";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OUTLINE_SELECTOR, WithOutline } from "../agents/docoutlineview";
import { CodeBlameColumn, type EditorLineLayout } from "./codeblamecolumn";
import { codeBlameOnAtom } from "./codeblamestore";
import { isHtmlPath, isMarkdownPath, isTexPath, languageForPath, resolveViewMode } from "./codeclassify";
import { CodeDiffView } from "./codediffview";
import { remember } from "./codeeditorcache";
import { splitFrontmatter, type FrontmatterSplit } from "./codefrontmatter";
import { langOf, type Lang } from "./codelang";
import { resolveDocLink } from "./codelink";
import { isPreviewable } from "./codepreviewable";
import { fileComments, reanchor } from "./codereview";
import {
    cancelComment,
    codeCommentDraftAtom,
    codeReviewsAtom,
    consumePendingComment,
    saveComment,
    setCommentSelectionReader,
    startComment,
} from "./codereviewstore";
import { applyScroll, keepScroll, keptScroll, scrollKey } from "./codescroll";
import {
    codeDraftsAtom,
    codeFileAtom,
    codePendingLineAtom,
    codePlainAtom,
    codeProjectAtom,
    codeTexPdfAtom,
    codeViewModeAtom,
    draftKey,
    editDraft,
    findReferences,
    goToDefinition,
    openInCode,
    refreshIndex,
    setCaretLineReader,
    setCaretWordReader,
    texPdfFor,
    type CodeProject,
} from "./codestore";
import { wordAt } from "./codesymbolquery";
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
// the same instance as an atom, for the one consumer that must re-render when it changes: the line layout
const editorAtom = atom<MonacoTypes.editor.IStandaloneCodeEditor | null>(
    null
) as PrimitiveAtom<MonacoTypes.editor.IStandaloneCodeEditor | null>;

function setEditor(ed: MonacoTypes.editor.IStandaloneCodeEditor | null): void {
    editor = ed;
    globalStore.set(editorAtom, ed);
}

setCaretLineReader(() => editor?.getPosition()?.lineNumber ?? null);
setCaretWordReader(codeEditorWordAtCursor);

// A comment is on the editor's selection, or on the caret's line when nothing is selected (codereviewstore.ts lends the
// store this reader, so it never touches Monaco). endColumn lets the store drop a line the selection only touches at its start.
setCommentSelectionReader(() => {
    const sel = editor?.getSelection();
    if (sel == null) {
        return null;
    }
    if (!sel.isEmpty()) {
        return { startLine: sel.startLineNumber, endLine: sel.endLineNumber, endColumn: sel.endColumn };
    }
    const pos = editor?.getPosition();
    return pos == null ? null : { startLine: pos.lineNumber, endLine: pos.lineNumber, endColumn: pos.column };
});

// The identifier at the caret and the open file's language. The word is cut by wordAt rather than
// Monaco's getWordAtPosition, whose per-language word rules (CSS's leading ".") would hand the
// definition query a name it was not built for; the language comes from codelang for the same reason.
export function codeEditorWordAtCursor(): { word: string; lang: Lang } | null {
    const pos = editor?.getPosition();
    const textModel = editor?.getModel();
    const file = globalStore.get(codeFileAtom);
    if (pos == null || textModel == null || file.kind !== "text") {
        return null;
    }
    const lang = langOf(file.path);
    const word = wordAt(textModel.getLineContent(pos.lineNumber), pos.column, lang);
    return word == null ? null : { word, lang };
}

// A listed answer (several definitions, or the references) fills the Search column; a collapsed sidebar
// would hide it, so its opener is pressed. A DOM read in a run, as the keybindings do (bindings.ts).
function openCodeSidebarIfCollapsed(): void {
    const opener = document.querySelector<HTMLButtonElement>('button[aria-label^="Expand Code sidebar"]');
    if (opener != null && !opener.classList.contains("hidden")) {
        opener.click();
    }
}

// Go to definition and find references in the editor's context menu. Monaco's own entries of those names
// need a language service, which only TypeScript and JavaScript have here, so these two are the project
// search the symbol query (codesymbolquery.ts) shapes. No chord is set: F12 and Shift+F12 are bound by the
// surface's keybindings, ahead of Monaco's.
function addSymbolActions(ed: MonacoTypes.editor.IStandaloneCodeEditor, model: AgentsViewModel): () => void {
    const actions = [
        ed.addAction({
            id: "arc.code.goToDefinition",
            label: "Go to Definition in Project",
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.4,
            run: () => {
                const at = codeEditorWordAtCursor();
                if (at != null) {
                    fireAndForget(async () => {
                        if (await goToDefinition(model, at.word, at.lang)) {
                            openCodeSidebarIfCollapsed();
                        }
                    });
                }
            },
        }),
        ed.addAction({
            id: "arc.code.findReferences",
            label: "Find References in Project",
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.5,
            run: () => {
                const at = codeEditorWordAtCursor();
                if (at != null) {
                    openCodeSidebarIfCollapsed();
                    fireAndForget(() => findReferences(at.word));
                }
            },
        }),
    ];
    return () => actions.forEach((a) => a.dispose());
}

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

// the element a preview scrolls: the markdown document's OverlayScrollbars viewport (its first; the TOC's comes after),
// or the TeX preview's root
const PREVIEW_SCROLLER = "[data-overlayscrollbars-viewport], [data-tex-preview]";
const RESTORE_FRAMES = 30; // about half a second for the document to reach its height

// KeptScroll records where a preview is scrolled and puts it back on the next mount (codescroll.ts)
function KeptScroll({ id, children }: { id: string; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const target = keptScroll(id);
        if (target == null || target <= 0) {
            return;
        }
        let frames = 0;
        let raf = 0;
        const step = () => {
            const el = ref.current?.querySelector<HTMLElement>(PREVIEW_SCROLLER);
            if (el != null && applyScroll(el, target)) {
                return;
            }
            if (++frames < RESTORE_FRAMES) {
                raf = requestAnimationFrame(step);
            } else if (el != null) {
                el.scrollTop = target; // as far as the document now goes
            }
        };
        raf = requestAnimationFrame(step);
        // the reader scrolling first wins over a restore still waiting for the document to grow
        const stop = () => cancelAnimationFrame(raf);
        const host = ref.current;
        host?.addEventListener("wheel", stop, { once: true, passive: true });
        host?.addEventListener("pointerdown", stop, { once: true });
        host?.addEventListener("keydown", stop, { once: true });
        return () => {
            stop();
            host?.removeEventListener("wheel", stop);
            host?.removeEventListener("pointerdown", stop);
            host?.removeEventListener("keydown", stop);
        };
    }, [id]);
    return (
        <div
            ref={ref}
            className="h-full min-h-0"
            // scroll does not bubble; the capture phase sees the inner scroller's
            onScrollCapture={(e) => {
                const el = e.target as HTMLElement;
                if (el.matches?.(PREVIEW_SCROLLER)) {
                    keepScroll(id, el.scrollTop);
                }
            }}
        >
            {children}
        </div>
    );
}

// A markdown file read as a document. Its own component because the zoom view holds state: a click on a resolved image
// opens it full-window (element/imagezoom.tsx), and closing hands focus back to the wrapper below.
function MarkdownPreview({
    model,
    project,
    path,
    doc,
}: {
    model: AgentsViewModel;
    project: CodeProject | null;
    path: string;
    doc: FrontmatterSplit;
}) {
    const [zoomed, setZoomed] = useState<ZoomImage | null>(null);
    const homeRef = useRef<HTMLDivElement>(null);
    // stable: a new function per render would re-render the memoized Markdown, which remounts every image in it
    const onClickImage = useCallback((src: string, alt: string) => {
        // an image takes no focus, so park it on the preview: the zoom view hands focus back to what had it
        homeRef.current?.focus({ preventScroll: true });
        setZoomed({ src, alt });
    }, []);
    const closeZoom = useCallback(() => setZoomed(null), []);
    // a doc's image paths are relative to the doc, not the repo root
    const resolveOpts = useMemo(
        () => ({
            connName: "local",
            baseDir: (project != null ? joinRepoPath(project.path, path) : path).replace(/[\\/][^\\/]*$/, ""),
        }),
        [project, path]
    );
    const onClickLink = useCallback(
        (href: string) => {
            const target = project != null ? resolveDocLink(path, href) : null;
            if (target == null) {
                return false;
            }
            fireAndForget(() =>
                openInCode(model, { projectPath: project.path, rel: target.rel, line: target.line ?? undefined })
            );
            return true;
        },
        [model, project, path]
    );
    return (
        <div ref={homeRef} tabIndex={-1} className="h-full outline-none" data-code-preview="">
            <Markdown
                text={doc.body}
                header={doc.fields.length > 0 ? <FrontmatterCard fields={doc.fields} /> : null}
                scrollable
                className="markdown-doc h-full"
                contentClassName="px-8 pb-12 pt-7"
                fontSizeOverride={DOC_FONT_SIZE}
                resolveOpts={resolveOpts}
                onClickLink={onClickLink}
                onClickImage={onClickImage}
            />
            <ImageZoom image={zoomed} onClose={closeZoom} />
        </div>
    );
}

// Where the open editor draws a line, in pixels from its top edge, so a column beside it can line up with
// the code. `version` changes on every scroll, layout and content change, which is when those answers move.
export function useEditorLineLayout(): EditorLineLayout | null {
    const ed = useAtomValue(editorAtom);
    const [version, setVersion] = useState(0);
    useEffect(() => {
        if (ed == null) {
            return;
        }
        const bump = () => setVersion((v) => v + 1);
        const subs = [
            ed.onDidScrollChange(bump),
            ed.onDidLayoutChange(bump),
            ed.onDidChangeModelContent(bump),
            ed.onDidChangeHiddenAreas(bump),
            ed.onDidChangeModel(bump),
        ];
        return () => subs.forEach((d) => d.dispose());
    }, [ed]);
    return useMemo(() => {
        if (ed == null) {
            return null;
        }
        const top = (line: number) => ed.getTopForLineNumber(line) - ed.getScrollTop();
        return {
            top,
            // bottom of the last line rather than top of the next, which Monaco clamps at the file's end
            height: (start: number, lines: number) =>
                ed.getBottomForLineNumber(start + lines - 1) - ed.getTopForLineNumber(start),
            version,
        };
    }, [ed, version]);
}

// Its own component so a scroll re-renders the column, not the editor beside it.
function BlameGutter(props: { model: AgentsViewModel; path: string; modtime: number; text: string }) {
    const layout = useEditorLineLayout();
    return <CodeBlameColumn {...props} layout={layout} />;
}

// Bars in the line-decorations gutter for the open file's comments, where their anchors sit now; the
// note shows on hover. Recomputed from the buffer, so an edit above a comment carries it along.
function CommentMarkers({ path, text }: { path: string; text: string }) {
    const ed = useAtomValue(editorAtom);
    const reviews = useAtomValue(codeReviewsAtom);
    const project = useAtomValue(codeProjectAtom);
    useEffect(() => {
        if (ed == null || project == null) {
            return;
        }
        const lines = text.split(/\r?\n/);
        const markers = ed.createDecorationsCollection(
            fileComments(reviews, project.path, path).map((c) => {
                const at = reanchor(c, lines);
                return {
                    range: { startLineNumber: at.startLine, startColumn: 1, endLineNumber: at.endLine, endColumn: 1 },
                    options: {
                        isWholeLine: true,
                        linesDecorationsClassName: "code-comment-marker",
                        hoverMessage: { value: c.note },
                    },
                };
            })
        );
        return () => markers.clear();
    }, [ed, reviews, project, path, text]);
    return null;
}

// The note being written, drawn under the draft's last line. Enter and Escape are the input's own and
// stop here; the window's Escape (back to Cockpit) already stands down while a field holds focus.
function CommentInput({ path }: { path: string }) {
    const draft = useAtomValue(codeCommentDraftAtom);
    const layout = useEditorLineLayout();
    const [note, setNote] = useState("");
    if (draft == null || draft.path !== path || layout == null) {
        return null;
    }
    const close = (save: boolean) => {
        if (save) {
            saveComment(note);
        } else {
            cancelComment();
        }
        setNote("");
        editor?.focus();
    };
    const range = draft.endLine === draft.startLine ? `${draft.startLine}` : `${draft.startLine}-${draft.endLine}`;
    return (
        <div
            style={{ top: layout.top(draft.endLine) + layout.height(draft.endLine, 1) }}
            className="absolute inset-x-3 z-10 rounded-[8px] border border-border bg-surface p-1.5 shadow-popover-md"
        >
            <input
                autoFocus
                value={note}
                data-code-comment-input
                aria-label={`Comment on line ${range}`}
                placeholder={`Comment on line ${range} (Enter saves, Esc cancels)`}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        close(e.key === "Enter");
                    }
                }}
                className="w-full rounded-[6px] border border-border bg-surface px-2 py-1 text-[12px] text-primary outline-none placeholder:text-muted"
            />
        </div>
    );
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
    const previewable = file.kind === "text" ? isPreviewable(file.path, drafts.get(shownAbs)?.text ?? file.text) : true;
    const mode =
        file.kind === "none" ? chosenMode : resolveViewMode(file.path, chosenMode, texPdf != null, previewable);
    const blameOn = useAtomValue(codeBlameOnAtom);
    const plain = useAtomValue(codePlainAtom);

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
                    body={`Pick a file from the tree, or press ${formatChordString("Mod:p")} to search by name.`}
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
        case "image":
            return (
                <div className="flex h-full min-h-0 flex-col">
                    <ImageFrame
                        key={file.path}
                        data-code-image={file.path}
                        path={project != null ? joinRepoPath(project.path, file.path) : file.path}
                        version={file.modtime}
                        size={file.size}
                        title={file.path}
                    />
                </div>
            );
        case "toolarge":
            // a page too big for the editor (an exported deck with its images inlined) still previews: the frame
            // streams it
            if (isHtmlPath(file.path)) {
                return (
                    <div className="flex h-full min-h-0 flex-col">
                        <HtmlFrame
                            data-code-html={file.path}
                            path={project != null ? joinRepoPath(project.path, file.path) : file.path}
                            version={file.size}
                            title={file.path}
                        />
                    </div>
                );
            }
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
                    <KeptScroll key={abs} id={scrollKey("tex", abs)}>
                        <WithOutline selector={OUTLINE_SELECTOR.tex} textKey={draft?.text ?? file.text}>
                            <TexPreview
                                text={draft?.text ?? file.text}
                                onSource={(line) => {
                                    // mode first: a pending line that lands while the preview still shows is consumed
                                    globalStore.set(codeViewModeAtom, "source");
                                    globalStore.set(codePendingLineAtom, line);
                                }}
                                onLink={(href) => fireAndForget(() => openLink(href))}
                            />
                        </WithOutline>
                    </KeptScroll>
                );
            }
            // a web page renders as itself, from the file on disk: unsaved edits show once saved
            if (isHtmlPath(file.path) && mode === "preview") {
                return (
                    <div className="flex h-full min-h-0 flex-col">
                        <HtmlFrame data-code-html={file.path} path={abs} version={file.modtime} title={file.path} />
                    </div>
                );
            }
            // READMEs and other prose render as documents; Source (the CodeEditor below) stays one
            // toggle away, and the draft feeds the preview so unsaved edits show what you would save
            if (isMarkdownPath(file.path) && mode === "preview") {
                const doc = splitFrontmatter(draft?.text ?? file.text);
                return (
                    <KeptScroll key={abs} id={scrollKey("preview", abs)}>
                        <WithOutline selector={OUTLINE_SELECTOR.markdown} textKey={doc.body}>
                            <MarkdownPreview model={model} project={project} path={file.path} doc={doc} />
                        </WithOutline>
                    </KeptScroll>
                );
            }
            const source = (
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
                        setEditor(ed);
                        restoreKept(ed, abs);
                        applyPendingLine(ed);
                        const removeSymbolActions = addSymbolActions(ed, model);
                        // the same action Alt+M runs (bindings.ts code:comment): a comment on the selection, or the caret's line
                        const commentAction = ed.addAction({
                            id: "arc.code.comment",
                            label: "Add review comment",
                            contextMenuGroupId: "navigation",
                            contextMenuOrder: 1.6,
                            run: () => startComment(),
                        });
                        // a comment asked for from Preview or Diff waited for this editor's caret
                        consumePendingComment();
                        return () => {
                            commentAction.dispose();
                            removeSymbolActions();
                            if (editor === ed) {
                                setEditor(null);
                            }
                            keepEditor(ed, abs);
                        };
                    }}
                />
            );
            // one tree shape whether blame is on or off, so toggling it never remounts the editor
            return (
                <div className="flex h-full">
                    {blameOn && !plain ? (
                        <BlameGutter model={model} path={file.path} modtime={file.modtime} text={file.text} />
                    ) : null}
                    <div className="relative h-full min-w-0 flex-1 overflow-hidden">
                        {source}
                        <CommentMarkers path={file.path} text={draft?.text ?? file.text} />
                        <CommentInput path={file.path} />
                    </div>
                </div>
            );
        }
    }
}
