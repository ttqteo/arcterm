// frontend/app/view/agents/diffempty.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: why the diff pane has nothing to draw, in words. Null means there is something to draw, or
// the pair is still loading and the pane's skeleton is the honest answer.

import type { ChangesStatus } from "./changesstatus";

export type EmptyDiffKind = "nothing" | "nofile" | "nofiles" | "listfailed" | "toolarge" | "binary" | "unchanged";

export interface EmptyDiff {
    kind: EmptyDiffKind;
    title: string;
    body: string;
}

export interface EmptyDiffInput {
    path: string | null;
    pair: { path: string; binary: boolean; tooLarge: boolean; original: string; modified: string } | null;
    // set when compare's aggregate is selected and lists no files
    nothingToCompare: { base: string; head: string } | null;
    // whether the file list beside the pane has loaded; with no path, a list that is still loading must not
    // read as "pick a file"
    listStatus: ChangesStatus;
    // files in the list the pane picks from; null = there is no list at all (nothing selected yet)
    fileCount: number | null;
}

export function emptyDiffState(i: EmptyDiffInput): EmptyDiff | null {
    if (i.nothingToCompare != null) {
        const { base, head } = i.nothingToCompare;
        return { kind: "nothing", title: "Nothing to compare", body: `${base} and ${head} have no file differences.` };
    }
    if (!i.path) {
        if (i.listStatus === "loading") {
            return null;
        }
        if (i.listStatus === "failed") {
            return {
                kind: "listfailed",
                title: "Couldn't read the file list",
                body: "Git did not answer. Try again from the list.",
            };
        }
        if (i.fileCount === 0) {
            return {
                kind: "nofiles",
                title: "This commit changes no files",
                body: "It may be a merge or an empty commit.",
            };
        }
        return {
            kind: "nofile",
            title: "Pick a file to see its changes",
            body: "Choose one from the list, or move through it with the arrow keys.",
        };
    }
    if (i.pair == null || i.pair.path !== i.path) {
        return null;
    }
    if (i.pair.tooLarge) {
        // gitinfo.maxDiffBytes
        return {
            kind: "toolarge",
            title: "Too large to show here",
            body: "Diffs stop at 2 MB. Open it in Code to read the file.",
        };
    }
    if (i.pair.binary) {
        return {
            kind: "binary",
            title: "Binary file",
            body: "Git records a change here, but there is no text to compare.",
        };
    }
    if (i.pair.original === i.pair.modified) {
        return { kind: "unchanged", title: "Contents unchanged", body: "Only the name or the file mode changed." };
    }
    return null;
}
