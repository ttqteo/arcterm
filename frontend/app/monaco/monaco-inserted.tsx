// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A diff against nothing: a file not yet committed. Monaco special-cases an empty original as "replace line 1 with
// everything", which draws an empty removed line above the inserts, so this draws the text in a plain read-only editor
// with every line in the diff editor's own inserted style (its line-insert and gutter-insert classes) instead. Built on
// MonacoCodeEditor, so monaco-react.tsx is untouched.

import type * as MonacoTypes from "monaco-editor";
import { MonacoCodeEditor } from "./monaco-react";

export function MonacoInsertedText({
    text,
    path,
    options,
}: {
    text: string;
    path: string;
    options: MonacoTypes.editor.IEditorOptions;
}) {
    return (
        <MonacoCodeEditor
            text={text}
            readonly
            path={path}
            options={options}
            onMount={(editor, monaco) => {
                const lines = editor.createDecorationsCollection();
                const mark = () => {
                    const model = editor.getModel();
                    if (model == null) {
                        return;
                    }
                    lines.set([
                        {
                            range: new monaco.Range(1, 1, model.getLineCount(), 1),
                            options: { isWholeLine: true, className: "line-insert", marginClassName: "gutter-insert" },
                        },
                    ]);
                };
                mark();
                const sub = editor.onDidChangeModelContent(mark);
                return () => {
                    sub.dispose();
                    lines.clear();
                };
            }}
        />
    );
}
