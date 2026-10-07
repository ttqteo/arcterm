// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// LaTeX and BibTeX for Monaco, which ships neither. Monarch tokenizers, not parsers: they colour what a reader of
// the source scans for (commands, comments, math, environment names, the keys of \cite and \ref) and nothing more.
// Token names stay on the ones monacotheme.ts maps to cockpit roles (keyword, string, comment, constant.numeric,
// delimiter), plus `type` and `variable`, which the base theme colours.

import type * as MonacoTypes from "monaco-editor";

type Monaco = typeof MonacoTypes;

// the macros whose braced argument is a key or a path rather than prose
const KEY_MACROS =
    "cite[a-zA-Z]*|nocite|ref|eqref|autoref|[cC]ref|pageref|label|input|include|includegraphics|usepackage|documentclass|bibliography|bibliographystyle|addbibresource";

export const latexLanguage: MonacoTypes.languages.IMonarchLanguage = {
    defaultToken: "",
    tokenPostfix: ".latex",
    brackets: [
        { open: "{", close: "}", token: "delimiter.curly" },
        { open: "[", close: "]", token: "delimiter.square" },
    ],
    tokenizer: {
        root: [
            [/%.*$/, "comment"],
            [/(\\(?:begin|end))(\s*)(\{)([^}]*)(\})/, ["keyword", "", "delimiter.curly", "type", "delimiter.curly"]],
            [
                new RegExp(`(\\\\(?:${KEY_MACROS})\\*?)((?:\\[[^\\]]*\\])*)(\\{)([^}]*)(\\})`),
                ["keyword", "", "delimiter.curly", "variable", "delimiter.curly"],
            ],
            [/\$\$/, { token: "string.math", next: "@displayDollar" }],
            [/\$/, { token: "string.math", next: "@inlineDollar" }],
            [/\\\[/, { token: "string.math", next: "@displayBracket" }],
            [/\\\(/, { token: "string.math", next: "@inlineParen" }],
            [/\\[a-zA-Z@]+\*?/, "keyword"],
            // \\, \, \% \$ \& and the other one-character control symbols
            [/\\./, "keyword"],
            [/[{}]/, "delimiter.curly"],
            [/[[\]]/, "delimiter.square"],
            [/[&~^_#]/, "delimiter"],
        ],
        inlineDollar: [[/\$/, { token: "string.math", next: "@pop" }], { include: "@mathBody" }],
        displayDollar: [[/\$\$/, { token: "string.math", next: "@pop" }], { include: "@mathBody" }],
        displayBracket: [[/\\\]/, { token: "string.math", next: "@pop" }], { include: "@mathBody" }],
        inlineParen: [[/\\\)/, { token: "string.math", next: "@pop" }], { include: "@mathBody" }],
        mathBody: [
            [/%.*$/, "comment"],
            [/\\[a-zA-Z]+/, "string.math"],
            [/\\./, "string.math"],
            [/[^\\$%]+/, "string.math"],
            [/\$/, "string.math"],
        ],
    },
};

export const latexConfiguration: MonacoTypes.languages.LanguageConfiguration = {
    comments: { lineComment: "%" },
    brackets: [
        ["{", "}"],
        ["[", "]"],
    ],
    autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "$", close: "$" },
    ],
    surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "$", close: "$" },
    ],
};

export const bibtexLanguage: MonacoTypes.languages.IMonarchLanguage = {
    defaultToken: "",
    tokenPostfix: ".bibtex",
    ignoreCase: true,
    tokenizer: {
        root: [
            [/%.*$/, "comment"],
            [/(@[a-zA-Z]+)(\s*)(\{)([^,\s]*)(,?)/, ["keyword", "", "delimiter.curly", "variable", "delimiter"]],
            [/([a-zA-Z][\w-]*)(\s*)(=)/, ["type", "", "delimiter"]],
            [/\{/, { token: "string", next: "@braced" }],
            [/"/, { token: "string", next: "@quoted" }],
            [/\d+/, "constant.numeric"],
            [/[},#]/, "delimiter"],
        ],
        braced: [
            [/\{/, { token: "string", next: "@push" }],
            [/\}/, { token: "string", next: "@pop" }],
            [/[^{}]+/, "string"],
        ],
        quoted: [
            [/"/, { token: "string", next: "@pop" }],
            [/[^"]+/, "string"],
        ],
    },
};

export const bibtexConfiguration: MonacoTypes.languages.LanguageConfiguration = {
    comments: { lineComment: "%" },
    brackets: [["{", "}"]],
    autoClosingPairs: [
        { open: "{", close: "}" },
        { open: '"', close: '"' },
    ],
};

let registered = false;

// .cls is left out of the extensions on purpose: Monaco's Apex claims it, so codeclassify.ts's languageForPath
// names latex for it explicitly.
export function registerLatexLanguages(monaco: Monaco): void {
    if (registered) {
        return;
    }
    registered = true;
    monaco.languages.register({ id: "latex", extensions: [".tex", ".sty", ".ltx", ".latex"], aliases: ["LaTeX"] });
    monaco.languages.setMonarchTokensProvider("latex", latexLanguage);
    monaco.languages.setLanguageConfiguration("latex", latexConfiguration);
    monaco.languages.register({ id: "bibtex", extensions: [".bib"], aliases: ["BibTeX"] });
    monaco.languages.setMonarchTokensProvider("bibtex", bibtexLanguage);
    monaco.languages.setLanguageConfiguration("bibtex", bibtexConfiguration);
}
