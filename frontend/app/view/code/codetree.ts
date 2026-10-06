// frontend/app/view/code/codetree.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: turn the flat, forward-slashed path list from `git ls-files` into the tree the Code surface
// renders, and flatten that tree to rows given a set of expanded directories. No React, no IO.
//
// Ignored entries (what .gitignore excludes) come as a second list and are flagged so the tree can dim
// them. An entry ending in "/" is a directory whose contents are not known yet: git reports a directory
// ignored as a whole as that one entry, and the tree lists it when it is opened (lazyDirs).

export interface TreeNode {
    name: string;
    path: string; // repo-relative, forward slashes
    isDir: boolean;
    ignored: boolean;
    children: TreeNode[];
}

export interface TreeRow {
    kind: "dir" | "file";
    path: string;
    name: string;
    depth: number;
    expanded: boolean; // always false on a file row
    ignored?: true; // excluded by .gitignore; absent otherwise
}

export function buildTree(paths: readonly string[], ignored: readonly string[] = []): TreeNode[] {
    const root: TreeNode = { name: "", path: "", isDir: true, ignored: false, children: [] };
    // path -> node, so a directory with thousands of siblings costs a lookup, not a scan
    const index = new Map<string, TreeNode>();
    // tracked paths first: a directory they create is not ignored, even when ignored files sit in it
    const add = (p: string, isIgnored: boolean) => {
        const trailingDir = p.endsWith("/");
        const segs = p.split("/").filter((s) => s !== "");
        let parent = root;
        segs.forEach((seg, i) => {
            const path = parent.path === "" ? seg : `${parent.path}/${seg}`;
            let node = index.get(path);
            if (node == null) {
                const isDir = i < segs.length - 1 || trailingDir;
                // under an ignored directory everything is ignored
                node = { name: seg, path, isDir, ignored: isIgnored || parent.ignored, children: [] };
                parent.children.push(node);
                index.set(path, node);
            }
            parent = node;
        });
    };
    for (const p of paths) {
        add(p, false);
    }
    for (const p of ignored) {
        add(p, true);
    }
    sortNodes(root);
    return root.children;
}

// the ignored directories whose contents have to be listed before they can show any: every entry
// ending in "/", without the slash
export function lazyDirs(ignored: readonly string[]): Set<string> {
    return new Set(ignored.filter((p) => p.endsWith("/")).map((p) => p.slice(0, -1)));
}

// the expanded directories still waiting for that listing
export function dirsToList(
    expanded: ReadonlySet<string>,
    lazy: ReadonlySet<string>,
    listed: ReadonlySet<string>
): string[] {
    return [...expanded].filter((d) => lazy.has(d) && !listed.has(d));
}

function sortNodes(node: TreeNode): void {
    node.children.sort((a, b) => {
        if (a.isDir !== b.isDir) {
            return a.isDir ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
        sortNodes(child);
    }
}

export function visibleRows(tree: readonly TreeNode[], expanded: ReadonlySet<string>): TreeRow[] {
    const rows: TreeRow[] = [];
    const walk = (nodes: readonly TreeNode[], depth: number) => {
        for (const n of nodes) {
            const isOpen = n.isDir && expanded.has(n.path);
            rows.push({
                kind: n.isDir ? "dir" : "file",
                path: n.path,
                name: n.name,
                depth,
                expanded: isOpen,
                ...(n.ignored ? { ignored: true as const } : {}),
            });
            if (isOpen) {
                walk(n.children, depth + 1);
            }
        }
    };
    walk(tree, 0);
    return rows;
}

// the directories that must be expanded for `path` to be visible — the finder opens files in
// collapsed subtrees, and the tree should show where you landed.
export function ancestorsOf(path: string): string[] {
    const segs = path.split("/").filter((s) => s !== "");
    const out: string[] = [];
    for (let i = 1; i < segs.length; i++) {
        out.push(segs.slice(0, i).join("/"));
    }
    return out;
}
