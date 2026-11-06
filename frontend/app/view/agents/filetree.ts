// frontend/app/view/agents/filetree.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: a flat changed-file list -> the rows a grouped list draws. Single-child directory chains
// fold into one row, which is the difference between a tree and a staircase of one-item folders.

import { atom, type PrimitiveAtom } from "jotai";
import type { GitChange } from "./gitstatus";

export interface FileTreeRow {
    kind: "dir" | "file";
    // full path for a file, joined directory path for a directory; unique, used as the react key
    // and as the collapse identity
    id: string;
    label: string;
    depth: number;
    // files only
    change?: GitChange;
    // directories only
    files?: number;
    adds?: number;
    dels?: number;
}

export const treeModeAtom = atom<boolean>(true) as PrimitiveAtom<boolean>;
export const collapsedDirsAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;

interface Node {
    dirs: Map<string, Node>;
    files: GitChange[];
}

function emptyNode(): Node {
    return { dirs: new Map(), files: [] };
}

function insert(root: Node, change: GitChange): void {
    const parts = change.path.split("/");
    let node = root;
    for (const dir of parts.slice(0, -1)) {
        let next = node.dirs.get(dir);
        if (next == null) {
            next = emptyNode();
            node.dirs.set(dir, next);
        }
        node = next;
    }
    node.files.push(change);
}

function totals(node: Node): { files: number; adds: number; dels: number } {
    let files = node.files.length;
    let adds = node.files.reduce((n, f) => n + f.adds, 0);
    let dels = node.files.reduce((n, f) => n + f.dels, 0);
    for (const child of node.dirs.values()) {
        const t = totals(child);
        files += t.files;
        adds += t.adds;
        dels += t.dels;
    }
    return { files, adds, dels };
}

function walk(node: Node, prefix: string, depth: number, collapsed: Set<string>, out: FileTreeRow[]): void {
    for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        // fold a chain of single-child directories into one label
        let label = name;
        let cur = child;
        while (cur.files.length === 0 && cur.dirs.size === 1) {
            const [onlyName, onlyChild] = [...cur.dirs.entries()][0];
            label = `${label}/${onlyName}`;
            cur = onlyChild;
        }
        const id = prefix ? `${prefix}/${label}` : label;
        const t = totals(cur);
        out.push({ kind: "dir", id, label, depth, files: t.files, adds: t.adds, dels: t.dels });
        if (!collapsed.has(id)) {
            walk(cur, id, depth + 1, collapsed, out);
        }
    }
    for (const change of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
        out.push({
            kind: "file",
            id: change.path,
            label: change.path.split("/").pop() ?? change.path,
            depth,
            change,
        });
    }
}

export function buildFileTree(files: GitChange[], collapsed: Set<string>): FileTreeRow[] {
    const root = emptyNode();
    for (const f of files) {
        insert(root, f);
    }
    const out: FileTreeRow[] = [];
    walk(root, "", 0, collapsed, out);
    return out;
}

// the order the list shows its files: tree order, or the input order when flat
export function listOrder(files: GitChange[], tree: boolean): string[] {
    if (!tree) {
        return files.map((c) => c.path);
    }
    // no collapsed set: a collapsed directory's files are still next in line
    return buildFileTree(files, new Set())
        .filter((r) => r.kind === "file")
        .map((r) => r.id);
}

// null past either end (no wrap); a `from` that is null or not listed starts at the first file
export function stepInList(order: string[], from: string | null, dir: 1 | -1): string | null {
    const at = from == null ? -1 : order.indexOf(from);
    if (at < 0) {
        return dir === 1 || from != null ? (order[0] ?? null) : null;
    }
    return order[at + dir] ?? null;
}
