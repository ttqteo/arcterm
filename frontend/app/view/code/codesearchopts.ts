// frontend/app/view/code/codesearchopts.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the search pane's filter row and its translation to the grep command. Path filters stay as
// typed in state, so a half-typed field is never rewritten under the caret.

export interface SearchOpts {
    regex: boolean;
    wholeWord: boolean;
    caseSensitive: boolean;
    include: string; // comma-separated pathspecs, as typed
    exclude: string;
}

export const DEFAULT_SEARCH_OPTS: SearchOpts = {
    regex: false,
    wholeWord: false,
    caseSensitive: false,
    include: "",
    exclude: "",
};

export function toPathspecs(raw: string): string[] {
    return raw
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p !== "");
}

export function grepData(cwd: string, query: string, opts: SearchOpts): CommandGitGrepData {
    return {
        cwd,
        allowplain: true, // a directory that is not a repository is searched by a Go scan instead
        query,
        regex: opts.regex,
        wholeword: opts.wholeWord,
        casesensitive: opts.caseSensitive,
        include: toPathspecs(opts.include),
        exclude: toPathspecs(opts.exclude),
    };
}
