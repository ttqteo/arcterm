// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// JSON Lines (.jsonl, .ndjson) for Monaco, which has no such language: a file of them opened as "json" is one value
// followed by "End of file expected" on every later line, and opened as nothing it draws plain. A Monarch tokenizer
// colours each line the way Monaco's JSON does (the same token names, `.json` postfix, so the theme draws them alike)
// and runs no validation.

import type * as MonacoTypes from "monaco-editor";

type Monaco = typeof MonacoTypes;

export const jsonlLanguage: MonacoTypes.languages.IMonarchLanguage = {
    defaultToken: "",
    tokenPostfix: ".json",
    tokenizer: {
        root: [
            // a string followed by a colon is a key
            [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "string.key"],
            [/"(?:[^"\\]|\\.)*"?/, "string.value"],
            [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
            [/\b(?:true|false|null)\b/, "keyword"],
            [/[{}[\]]/, "delimiter.bracket"],
            [/[,:]/, "delimiter"],
            [/\s+/, "white"],
        ],
    },
};

const jsonlConfiguration: MonacoTypes.languages.LanguageConfiguration = {
    brackets: [
        ["{", "}"],
        ["[", "]"],
    ],
    autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: '"', close: '"', notIn: ["string"] },
    ],
};

let registered = false;

export function registerJsonlLanguage(monaco: Monaco): void {
    if (registered) {
        return;
    }
    registered = true;
    monaco.languages.register({ id: "jsonl", extensions: [".jsonl", ".ndjson"], aliases: ["JSON Lines"] });
    monaco.languages.setMonarchTokensProvider("jsonl", jsonlLanguage);
    monaco.languages.setLanguageConfiguration("jsonl", jsonlConfiguration);
}
