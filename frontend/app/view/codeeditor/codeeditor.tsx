// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useOverrideConfigAtom } from "@/app/store/global";
import { boundNumber } from "@/util/util";
import type * as MonacoModule from "monaco-editor";
import type * as MonacoTypes from "monaco-editor";
import React, { useMemo, useRef } from "react";

const MonacoCodeEditor = React.lazy(() =>
    import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoCodeEditor }))
);

function defaultEditorOptions(): MonacoTypes.editor.IEditorOptions {
    const opts: MonacoTypes.editor.IEditorOptions = {
        scrollBeyondLastLine: false,
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        smoothScrolling: true,
        scrollbar: {
            useShadows: false,
            verticalScrollbarSize: 5,
            horizontalScrollbarSize: 5,
        },
        minimap: {
            enabled: true,
        },
        stickyScroll: {
            enabled: false,
        },
    };
    return opts;
}

interface CodeEditorProps {
    blockId: string;
    text: string;
    readonly: boolean;
    language?: string;
    // set: overrides editor:wordwrap (the Code surface decides per file, codewrap.ts)
    wordWrap?: boolean;
    fileName?: string;
    onChange?: (text: string) => void;
    onMount?: (monacoPtr: MonacoTypes.editor.IStandaloneCodeEditor, monaco: typeof MonacoModule) => () => void;
    keepModel?: boolean;
}

export function CodeEditor({
    blockId,
    text,
    language,
    wordWrap,
    fileName,
    readonly,
    onChange,
    onMount,
    keepModel,
}: CodeEditorProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const unmountRef = useRef<() => void>(null);
    const minimapEnabled = useOverrideConfigAtom(blockId, "editor:minimapenabled") ?? false;
    const stickyScrollEnabled = useOverrideConfigAtom(blockId, "editor:stickyscrollenabled") ?? false;
    const settingWrap = useOverrideConfigAtom(blockId, "editor:wordwrap") ?? false;
    const wrap = wordWrap ?? settingWrap;
    const fontSize = boundNumber(useOverrideConfigAtom(blockId, "editor:fontsize"), 6, 64);
    const uuidRef = useRef(crypto.randomUUID()).current;
    let editorPath: string;
    if (fileName) {
        const separator = fileName.startsWith("/") ? "" : "/";
        editorPath = blockId + separator + fileName;
    } else {
        editorPath = uuidRef;
    }

    React.useEffect(() => {
        return () => {
            // unmount function
            if (unmountRef.current) {
                unmountRef.current();
            }
        };
    }, []);

    function handleEditorChange(text: string) {
        if (onChange) {
            onChange(text);
        }
    }

    function handleEditorOnMount(
        editor: MonacoTypes.editor.IStandaloneCodeEditor,
        monaco: typeof MonacoModule
    ): () => void {
        if (onMount) {
            const cleanup = onMount(editor, monaco);
            unmountRef.current = cleanup;
            return cleanup;
        }
        return undefined;
    }

    const editorOpts = useMemo(() => {
        const opts = defaultEditorOptions();
        opts.minimap.enabled = minimapEnabled;
        opts.stickyScroll.enabled = stickyScrollEnabled;
        opts.wordWrap = wrap ? "on" : "off";
        opts.fontSize = fontSize;
        opts.copyWithSyntaxHighlighting = false;
        return opts;
    }, [minimapEnabled, stickyScrollEnabled, wrap, fontSize, readonly]);

    return (
        <div className="flex flex-col w-full h-full items-center justify-center">
            <div className="flex flex-col h-full w-full" ref={divRef}>
                <React.Suspense fallback={null}>
                    <MonacoCodeEditor
                        readonly={readonly}
                        text={text}
                        options={editorOpts}
                        onChange={handleEditorChange}
                        onMount={handleEditorOnMount}
                        path={editorPath}
                        language={language}
                        keepModel={keepModel}
                    />
                </React.Suspense>
            </div>
        </div>
    );
}
