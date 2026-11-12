// frontend/app/view/code/codemutate.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: everything a mutation needs to decide before any IO happens. No React, no RPC.
//
// Validation reads the index snapshot rather than the disk, so it can be wrong — which is exactly
// why the write still surfaces the backend's error instead of trusting this.

import type { CodeStatus } from "./codestatus";
import type { TreeRow } from "./codetree";

export type NameError = "empty" | "separator" | "dots" | "illegal-char" | "reserved" | "exists";

// the characters Windows refuses in a filename, plus the control range
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHAR = /[<>:"|?*\u0000-\u001f]/;
// CON, PRN, AUX, NUL, COM1-9, LPT1-9 are devices with or without an extension: "nul.txt" is still
// the null device, and creating one fails at the filesystem rather than at git
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

// an empty folder made this session is a row but not in the index, and mkdir fails on its name
export function existingTreePaths(indexPaths: readonly string[], sessionDirs: readonly string[]): string[] {
    return [...indexPaths, ...sessionDirs];
}

export function validateName(name: string, dir: string, existing: readonly string[]): NameError | null {
    const n = name.trim();
    if (n === "") {
        return "empty";
    }
    if (n.includes("/") || n.includes("\\")) {
        return "separator";
    }
    if (n === "." || n === "..") {
        return "dots";
    }
    if (ILLEGAL_CHAR.test(n)) {
        return "illegal-char";
    }
    if (RESERVED.test(n)) {
        return "reserved";
    }
    const rel = dir === "" ? n : `${dir}/${n}`;
    if (existing.some((p) => p === rel || p.startsWith(`${rel}/`))) {
        return "exists";
    }
    return null;
}

export function nameErrorMessage(e: NameError): string {
    switch (e) {
        case "empty":
            return "Enter a name.";
        case "separator":
            return "A name cannot contain a path separator.";
        case "dots":
            return '"." and ".." are not names.';
        case "illegal-char":
            return 'A name cannot contain < > : " | ? * or control characters.';
        case "reserved":
            return "That is a reserved device name on Windows.";
        case "exists":
            return "Something with that name is already here.";
    }
}

// Where a new entry lands. Pure and tested because the rule is obvious right up until the cursor is
// on a collapsed directory, on a file at the root, or nowhere at all.
export function targetDir(cursor: string | null, rows: readonly TreeRow[]): string {
    if (cursor == null) {
        return "";
    }
    const row = rows.find((r) => r.path === cursor);
    if (row == null) {
        return "";
    }
    if (row.kind === "dir") {
        return row.path;
    }
    const cut = row.path.lastIndexOf("/");
    return cut === -1 ? "" : row.path.slice(0, cut);
}

// Where the provisional "type a name here" row is spliced into the rendered rows: as the target
// directory's first child, or at the top for the repo root.
export function provisionalIndex(rows: readonly TreeRow[], dir: string): number {
    if (dir === "") {
        return 0;
    }
    const i = rows.findIndex((r) => r.path === dir);
    return i === -1 ? 0 : i + 1;
}

// Rewrite one path across a rename. A directory rename carries its descendants; a shared prefix
// that is not a directory boundary ("src/utilities.ts" under a rename of "src/util") does not.
export function renamedPath(path: string, from: string, to: string): string {
    if (path === from) {
        return to;
    }
    if (path.startsWith(`${from}/`)) {
        return to + path.slice(from.length);
    }
    return path;
}

// The honest recoverability line the confirm shows. git answers this per file, so the confirm can
// say what is true instead of a blanket "this cannot be undone" that is usually false — and for a
// directory the weakest sentence wins, because one untracked file inside makes the whole delete
// final and saying otherwise would be the one kind of wrong this sentence must never be.
export function deleteWarning(rel: string, statuses: readonly (CodeStatus | undefined)[], isDir: boolean): string {
    const untracked = statuses.some((s) => s?.status === "?");
    const stagedOnly = !untracked && statuses.some((s) => s?.status === "A");
    if (isDir) {
        const n = statuses.length;
        const head = `Delete "${rel}" and everything inside it — ${n} file${n === 1 ? "" : "s"} git knows about, plus anything git ignores.`;
        if (untracked) {
            return `${head} Some of it is not in git, so deleting it cannot be undone.`;
        }
        if (stagedOnly) {
            return `${head} What is staged but never committed is still in the index — git checkout restores it.`;
        }
        return `${head} The committed copies stay in git history.`;
    }
    if (untracked) {
        return `Delete "${rel}"? This file is not in git. Deleting it cannot be undone.`;
    }
    if (stagedOnly) {
        return `Delete "${rel}"? Staged in git — git checkout restores it.`;
    }
    return `Delete "${rel}"? The committed copy stays in git history.`;
}
