// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { markSpans } from "@/app/monaco/markdownmarks";
import { loadMonaco } from "@/app/monaco/monaco-env";
import type * as MonacoTypes from "monaco-editor";
import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { debounce } from "throttle-debounce";

// A kept model outlives its editor, so the next mount under the same path picks up its undo history.
// If the text moved on while it sat unmounted (a reload from disk), setValue drops that history
// rather than letting Ctrl+Z resurrect bytes that are no longer there.
function acquireModel(value: string, path: string, language: string | undefined, keep: boolean) {
    const uri = monaco.Uri.parse(`wave://editor/${encodeURIComponent(path)}`);
    const existing = keep ? monaco.editor.getModel(uri) : null;
    if (existing == null) {
        return monaco.editor.createModel(value, language, uri);
    }
    if (existing.getValue() !== value) {
        existing.setValue(value);
    }
    return existing;
}

// a markdown model's ==text== marks: the text tinted, the marks faint (tailwindsetup.css)
function markDecorations(model: MonacoTypes.editor.ITextModel): MonacoTypes.editor.IModelDeltaDecoration[] {
    if (model.getLanguageId() !== "markdown") {
        return [];
    }
    return markSpans(model.getValue()).flatMap(({ line, open, close }) => [
        { range: new monaco.Range(line, open, line, open + 2), options: { inlineClassName: "md-mark-delim" } },
        { range: new monaco.Range(line, open + 2, line, close), options: { inlineClassName: "md-mark" } },
        { range: new monaco.Range(line, close, line, close + 2), options: { inlineClassName: "md-mark-delim" } },
    ]);
}

type CodeEditorProps = {
    text: string;
    readonly: boolean;
    language?: string;
    onChange?: (text: string) => void;
    onMount?: (editor: MonacoTypes.editor.IStandaloneCodeEditor, monacoApi: typeof monaco) => () => void;
    path: string;
    options: MonacoTypes.editor.IEditorOptions;
    // leave the model alive on unmount; the caller owns disposing it
    keepModel?: boolean;
};

export function MonacoCodeEditor({
    text,
    readonly,
    language,
    onChange,
    onMount,
    path,
    options,
    keepModel = false,
}: CodeEditorProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
    const onUnmountRef = useRef<(() => void) | null>(null);
    const applyingFromProps = useRef(false);

    useEffect(() => {
        loadMonaco();

        const el = divRef.current;
        if (!el) return;

        const model = acquireModel(text, path, language, keepModel);
        console.log("[monaco] CREATE MODEL", path, model);

        const editor = monaco.editor.create(el, {
            ...options,
            readOnly: readonly,
            model,
        });
        editorRef.current = editor;

        const sub = model.onDidChangeContent(() => {
            if (applyingFromProps.current) return;
            onChange?.(model.getValue());
        });

        const marks = editor.createDecorationsCollection(markDecorations(model));
        const repaintMarks = debounce(150, () => marks.set(markDecorations(model)));
        const marksSubs = [model.onDidChangeContent(repaintMarks), model.onDidChangeLanguage(repaintMarks)];

        if (onMount) {
            onUnmountRef.current = onMount(editor, monaco);
        }

        return () => {
            sub.dispose();
            marksSubs.forEach((s) => s.dispose());
            repaintMarks.cancel();
            if (onUnmountRef.current) onUnmountRef.current();
            editor.setModel(null);
            editor.dispose();
            if (!keepModel) {
                model.dispose();
                console.log("[monaco] dispose model");
            }
            editorRef.current = null;
        };
        // mount/unmount only
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        const el = divRef.current;
        if (!editor || !el) return;

        const debouncedLayout = debounce(100, () => {
            editor.layout();
        });
        const resizeObserver = new ResizeObserver(debouncedLayout);
        resizeObserver.observe(el);

        return () => {
            resizeObserver.disconnect();
            debouncedLayout.cancel();
        };
    }, []);

    // Keep model value in sync with props
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const model = editor.getModel();
        if (!model) return;

        const current = model.getValue();
        if (current === text) return;

        applyingFromProps.current = true;
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
        applyingFromProps.current = false;
    }, [text]);

    // Keep options in sync
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.updateOptions({ ...options, readOnly: readonly });
    }, [options, readonly]);

    // Keep language in sync
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const model = editor.getModel();
        if (!model || !language) return;
        monaco.editor.setModelLanguage(model, language);
    }, [language]);

    return <div className="flex flex-col h-full w-full" ref={divRef} />;
}

type DiffViewerProps = {
    original: string;
    modified: string;
    language?: string;
    path: string;
    options: MonacoTypes.editor.IDiffEditorOptions;
    // same shape as MonacoCodeEditor's: returns its own teardown, run just before the editor disposes
    onMount?: (diff: MonacoTypes.editor.IStandaloneDiffEditor) => () => void;
};

export function MonacoDiffViewer({ original, modified, language, path, options, onMount }: DiffViewerProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const diffRef = useRef<MonacoTypes.editor.IStandaloneDiffEditor | null>(null);
    const onUnmountRef = useRef<(() => void) | null>(null);

    // Create once
    useEffect(() => {
        loadMonaco();

        const el = divRef.current;
        if (!el) return;

        const origUri = monaco.Uri.parse(`wave://diff-orig/${encodeURIComponent(path)}`);
        const modUri = monaco.Uri.parse(`wave://diff-mod/${encodeURIComponent(path)}`);

        const originalModel = monaco.editor.createModel(original, language, origUri);
        const modifiedModel = monaco.editor.createModel(modified, language, modUri);

        const diff = monaco.editor.createDiffEditor(el, options);
        diffRef.current = diff;

        diff.setModel({ original: originalModel, modified: modifiedModel });

        if (onMount) {
            onUnmountRef.current = onMount(diff);
        }

        return () => {
            if (onUnmountRef.current) onUnmountRef.current();
            diff.setModel(null);
            diff.dispose();
            originalModel.dispose();
            modifiedModel.dispose();
            diffRef.current = null;
        };
    }, []);

    useEffect(() => {
        const diff = diffRef.current;
        const el = divRef.current;
        if (!diff || !el) return;

        const debouncedLayout = debounce(100, () => {
            diff.layout();
        });
        const resizeObserver = new ResizeObserver(debouncedLayout);
        resizeObserver.observe(el);

        return () => {
            resizeObserver.disconnect();
            debouncedLayout.cancel();
        };
    }, []);

    // Update models on prop change
    useEffect(() => {
        const diff = diffRef.current;
        if (!diff) return;
        const model = diff.getModel();
        if (!model) return;

        if (model.original.getValue() !== original) model.original.setValue(original);
        if (model.modified.getValue() !== modified) model.modified.setValue(modified);

        if (language) {
            monaco.editor.setModelLanguage(model.original, language);
            monaco.editor.setModelLanguage(model.modified, language);
        }
    }, [original, modified, language]);

    useEffect(() => {
        const diff = diffRef.current;
        if (!diff) return;
        diff.updateOptions(options);
    }, [options]);

    return <div className="flex flex-col h-full w-full" ref={divRef} />;
}
