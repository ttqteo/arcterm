// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Files and folders dropped from the OS (Finder, Explorer) on the Agent panel's Files tree are copied into a folder of
// it; the originals stay where they are. The webview hands over the bytes, never the source path, so a copy is the
// only thing a drop can do. This is the pure part: which folder a drop lands in, what a dropped folder holds, how a
// file goes in chunks, what the tree selects after, and the words. The writes are railfiledropstore.ts; a name that is
// taken gets " (1)", " (2)"… from wavesrv (FileDropWriteCommand), which never replaces a file.

import type { RailTreeState } from "./railtree";
import { MAX_UPLOAD_BYTES } from "./uploadfile";

// A chunk is as big as one upload: its base64 fits under the websocket's 5 MiB message cap (uploadfile.ts).
export const DROP_CHUNK_BYTES = MAX_UPLOAD_BYTES;

// The folder, repo-relative ("" is the tree's root), that a drop over a row lands in: a folder row's own, a file row's
// parent, and the root over no row.
export function dropDirFor(row: { path: string; kind: "dir" | "file" } | null): string {
    if (row == null) {
        return "";
    }
    if (row.kind === "dir") {
        return row.path;
    }
    const cut = row.path.lastIndexOf("/");
    return cut === -1 ? "" : row.path.slice(0, cut);
}

// A name the OS gave a dropped entry, checked before it becomes part of a path: no separators, no "." or "..".
export function isSafeEntryName(name: string): boolean {
    return name !== "" && name !== "." && name !== ".." && !/[\\/]/.test(name);
}

// The byte ranges a file goes in; an empty file is one empty chunk, which creates it.
export function chunkRanges(size: number, chunk = DROP_CHUNK_BYTES): { start: number; end: number }[] {
    if (size <= 0) {
        return [{ start: 0, end: 0 }];
    }
    const out: { start: number; end: number }[] = [];
    for (let start = 0; start < size; start += chunk) {
        out.push({ start, end: Math.min(size, start + chunk) });
    }
    return out;
}

// The part of the File and Directory Entries API (DataTransferItem.webkitGetAsEntry) a walk reads; the real entries
// satisfy it, and the tests pass fakes.
export interface DropEntryLike {
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    file?(ok: (f: File) => void, fail?: (e: unknown) => void): void;
    createReader?(): { readEntries(ok: (entries: DropEntryLike[]) => void, fail?: (e: unknown) => void): void };
}

// One dropped item, read: a file, or a folder with every file under it and its folders that hold nothing, by path
// under the item.
export type DropItem =
    | { kind: "file"; name: string; file: File }
    | { kind: "dir"; name: string; files: { rel: string; file: File }[]; emptyDirs: string[] };

export interface DropRead {
    items: DropItem[];
    // the names of what could not be read, with why
    failed: { name: string; reason: string }[];
}

function readFile(entry: DropEntryLike): Promise<File> {
    return new Promise((resolve, reject) => {
        if (entry.file == null) {
            reject(new Error("not a file"));
            return;
        }
        entry.file(resolve, reject);
    });
}

// readEntries answers in batches (100 at a time in Chromium) and an empty batch ends the folder
async function readAllEntries(entry: DropEntryLike): Promise<DropEntryLike[]> {
    const reader = entry.createReader?.();
    if (reader == null) {
        throw new Error("not a folder");
    }
    const all: DropEntryLike[] = [];
    for (;;) {
        const batch = await new Promise<DropEntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) {
            return all;
        }
        all.push(...batch);
    }
}

function reasonOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// a failure is named from the dropped folder down ("site/css/a.css"), as the user dropped it
async function walkDir(entry: DropEntryLike, prefix: string, out: Extract<DropItem, { kind: "dir" }>, read: DropRead) {
    const children = await readAllEntries(entry);
    const shown = (rel: string) => `${out.name}/${rel}`;
    if (children.length === 0 && prefix !== "") {
        out.emptyDirs.push(prefix);
    }
    for (const child of children) {
        const rel = prefix === "" ? child.name : `${prefix}/${child.name}`;
        if (!isSafeEntryName(child.name)) {
            read.failed.push({ name: shown(rel), reason: "its name cannot be a file name here" });
        } else if (child.isDirectory) {
            try {
                await walkDir(child, rel, out, read);
            } catch (e) {
                read.failed.push({ name: shown(rel), reason: reasonOf(e) });
            }
        } else if (child.isFile) {
            try {
                out.files.push({ rel, file: await readFile(child) });
            } catch (e) {
                read.failed.push({ name: shown(rel), reason: reasonOf(e) });
            }
        }
    }
}

// Reads what was dropped: each entry (taken from the drop's items while the drop event ran) walked to its files.
// `files` is the drop's plain file list, used only when the webview gave no entries; then an empty file with no type
// is taken as a folder it cannot open, as uploadfile.ts takes it.
export async function readDrop(entries: readonly (DropEntryLike | null)[], files: readonly File[]): Promise<DropRead> {
    const read: DropRead = { items: [], failed: [] };
    const known = entries.filter((e): e is DropEntryLike => e != null);
    if (known.length === 0) {
        for (const file of files) {
            if (file.size === 0 && file.type === "") {
                read.failed.push({ name: file.name, reason: "folders cannot be read from this drop" });
            } else if (!isSafeEntryName(file.name)) {
                read.failed.push({ name: file.name, reason: "its name cannot be a file name here" });
            } else {
                read.items.push({ kind: "file", name: file.name, file });
            }
        }
        return read;
    }
    for (const entry of known) {
        if (!isSafeEntryName(entry.name)) {
            read.failed.push({ name: entry.name, reason: "its name cannot be a file name here" });
            continue;
        }
        try {
            if (entry.isDirectory) {
                const item: Extract<DropItem, { kind: "dir" }> = {
                    kind: "dir",
                    name: entry.name,
                    files: [],
                    emptyDirs: [],
                };
                await walkDir(entry, "", item, read);
                read.items.push(item);
            } else if (entry.isFile) {
                read.items.push({ kind: "file", name: entry.name, file: await readFile(entry) });
            }
        } catch (e) {
            read.failed.push({ name: entry.name, reason: reasonOf(e) });
        }
    }
    return read;
}

export function dropBytes(items: readonly DropItem[]): number {
    let total = 0;
    for (const item of items) {
        if (item.kind === "file") {
            total += item.file.size;
        } else {
            for (const f of item.files) {
                total += f.file.size;
            }
        }
    }
    return total;
}

// After the copy: the folder it went into opens (with the folders above it), and what was copied is selected, the
// first under the cursor.
export function afterDropState(s: RailTreeState, dir: string, copied: readonly string[]): RailTreeState {
    if (copied.length === 0) {
        return s;
    }
    const expanded = [...s.expanded];
    if (dir !== "") {
        const parts = dir.split("/");
        for (let i = 1; i <= parts.length; i++) {
            const p = parts.slice(0, i).join("/");
            if (!expanded.includes(p)) {
                expanded.push(p);
            }
        }
    }
    return { expanded, selected: [...copied], anchor: copied[0], cursor: copied[0] };
}

export function whereLabel(dir: string): string {
    return dir === "" ? "the project root" : `${dir}/`;
}

// The strip shown while OS files are over the tree, naming the folder they would land in
export function dropHintLabel(dir: string): string {
    return `Drop to copy into ${whereLabel(dir)}`;
}

// The strip shown while a copy runs: "Copying 3 items into src/ · 45%"
export function copyingLabel(count: number, dir: string, done: number, total: number): string {
    const what = count === 1 ? "1 item" : `${count} items`;
    const where = whereLabel(dir);
    const pct = total > 0 ? ` · ${Math.min(100, Math.floor((done / total) * 100))}%` : "";
    return `Copying ${what} into ${where}${pct}`;
}

// What to tell the user about everything a drop could not copy, as one toast; null when it all went in.
export function dropFailedToast(failed: readonly { name: string; reason: string }[]): {
    title: string;
    message: string;
} | null {
    if (failed.length === 0) {
        return null;
    }
    if (failed.length === 1) {
        return { title: `Couldn't copy “${failed[0].name}”`, message: failed[0].reason };
    }
    const shown = failed.slice(0, 3).map((f) => `“${f.name}”: ${f.reason}`);
    const more = failed.length > 3 ? [`and ${failed.length - 3} more`] : [];
    return { title: `${failed.length} items weren't copied`, message: [...shown, ...more].join("; ") };
}
