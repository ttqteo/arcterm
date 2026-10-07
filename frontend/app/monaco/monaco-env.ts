// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as monaco from "monaco-editor";
import "monaco-editor/esm/vs/language/css/monaco.contribution";
import "monaco-editor/esm/vs/language/html/monaco.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";

import { MonacoSchemas } from "@/app/monaco/schemaendpoints";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { registerLatexLanguages } from "./latexlang";
import { monacoThemeFromTokens, readChromeRoles, readSyntaxTokens } from "./monacotheme";

let monacoConfigured = false;

window.MonacoEnvironment = {
    getWorker(_, label) {
        if (label === "json") {
            return new jsonWorker();
        }
        if (label === "css" || label === "scss" || label === "less") {
            return new cssWorker();
        }
        if (label === "html" || label === "handlebars" || label === "razor") {
            return new htmlWorker();
        }
        if (label === "typescript" || label === "javascript") {
            return new tsWorker();
        }
        return new editorWorker();
    },
};

export function loadMonaco() {
    if (monacoConfigured) {
        return;
    }
    monacoConfigured = true;
    // before any model exists: a model takes its language when it is created
    registerLatexLanguages(monaco);
    // theme definitions now come from the cockpit's own tokens (see monacotheme.ts); computed-style
    // reads are safe here because loadMonaco runs at first editor mount, long after cockpit-root's
    // pre-paint theme application, so the values are settled
    const tokens = readSyntaxTokens(document.documentElement);
    const chrome = readChromeRoles(document.documentElement);
    monaco.editor.defineTheme("wave-theme-dark", monacoThemeFromTokens(tokens, chrome, true));
    monaco.editor.defineTheme("wave-theme-light", monacoThemeFromTokens(tokens, chrome, false));
    // no monaco-yaml here on purpose: it was configured with zero schemas (so it only duplicated the
    // yaml grammar monaco already bundles), and its marker provider reset a yaml schema on EVERY
    // disposed model regardless of language, throwing an unhandled rejection per file switch.
    // see docs/open-issues.md issue 7 before re-adding it.

    monaco.editor.setTheme("wave-theme-dark");
    // Disable default validation errors for typescript and javascript
    monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
    });
    monaco.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        enableSchemaRequest: true,
        schemas: MonacoSchemas,
    });
}

// The hook's entry point across the lazy chunk boundary: redefine under the same name (defineTheme
// overwrites) and activate. Keeps monaco usage inside this module so monacotheme.ts stays type-only.
export function applyMonacoTheme(name: string, theme: monaco.editor.IStandaloneThemeData): void {
    monaco.editor.defineTheme(name, theme);
    monaco.editor.setTheme(name);
}
