// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `@` file picker of the New launcher's Task box and the chat box (filemention.tsx): where an `@` being typed sits,
// which of the project's files it lists, and the text once one is picked, `@<path>` relative to the project as Claude
// Code reads it. A path that starts at a root (`../`, `~/`, `D:/`, `/`) walks folders instead: browseQuery splits it into
// the folder and the name typed in it, and the rest here places the folder, orders its entries and writes a pick. Pure;
// the file list is codestore.ts's (the one Code and the palette's Files scope read), its ranking codefinder.ts's.

import { rankPaths } from "@/app/view/code/codefinder";
import { resolvePath } from "./pathlinks";

export const MENTION_FILE_LIMIT = 8;

// an @ at the start or after a space or an opening bracket or quote (an email's @ sits inside a word), and the path
// typed after it up to the caret: a path ends at whitespace
const FILE_MENTION = /(^|[\s([{"'`])@([^\s@]{0,200})$/u;

export interface FileMention {
    // where the `@` sits
    start: number;
    // what follows it, up to the caret
    query: string;
}

/** Pure: the `@` the caret is typing a path after, or null when the caret is not in one. A picked path is followed by
 *  a space, which ends it, so the picker closes after a pick. */
export function fileMentionAt(text: string, caret: number): FileMention | null {
    const found = FILE_MENTION.exec(text.slice(0, caret));
    if (found == null) {
        return null;
    }
    return { start: caret - found[2].length - 1, query: found[2] };
}

/** Pure: the files the picker lists for `query`, best first, ranked as the Code finder ranks them. */
export function fileMentionMatches(query: string, paths: readonly string[], limit = MENTION_FILE_LIMIT): string[] {
    return rankPaths(query, paths, limit).map((m) => m.path);
}

/** Pure: `text` with the `@…` word around the caret (from `start` to the next whitespace) replaced by `@<path>` and a
 *  space (the one that already follows, if there is one), and where the caret goes: after that space. */
export function insertFileMention(
    text: string,
    start: number,
    caret: number,
    path: string
): { text: string; caret: number } {
    const mention = `@${path}`;
    // the rest of the word the caret sits in goes too: picking from "@src/fo|o.ts" must not leave "o.ts" behind
    const rest = text.slice(caret).replace(/^\S*/, "");
    return {
        text: text.slice(0, start) + (rest.startsWith(" ") ? mention : `${mention} `) + rest,
        caret: start + mention.length + 1,
    };
}

export const BROWSE_LIMIT = 50;

// a path that starts at a root the project's file list does not cover: ../ ./ ~/ a drive (D:/ D:\) or a separator
const BROWSE_ROOT = /^(?:\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|[\\/])/;

export interface BrowseQuery {
    /** the folder as typed, up to and including its last separator: `../src/` */
    dir: string;
    /** the name typed in it so far */
    leaf: string;
}

/** An entry of a folder listing: the part of a `FileInfo` the picker reads. */
export interface BrowseEntry {
    name?: string;
    isdir?: boolean;
}

/** Pure: when the typed `@` path starts at a root (`../`, `./`, `~/`, `D:/x/`, `/etc/`), the folder to list and the name
 *  typed in it; null for a project-relative query (`src/ap`, `foo`), which the project's own file ranking answers. */
export function browseQuery(query: string): BrowseQuery | null {
    if (!BROWSE_ROOT.test(query)) {
        return null;
    }
    const cut = Math.max(query.lastIndexOf("/"), query.lastIndexOf("\\")) + 1;
    return { dir: query.slice(0, cut), leaf: query.slice(cut) };
}

/** Pure: the absolute folder (forward slashes, `.` and `..` folded) a typed `dir` names: relative to `base`, `~` as
 *  `home`, an absolute one on its own. Null when it cannot be placed (a relative `dir` with no `base`, `~` with no `home`). */
export function resolveBrowseDir(base: string, dir: string, home: string): string | null {
    return resolvePath(base === "" ? null : base, dir, home === "" ? null : home);
}

/** Pure: the entries of a folder the picker lists for `leaf`: folders before files, and in each the names that start
 *  with `leaf` before those that only contain it, each alphabetical regardless of case. Names that start with a dot
 *  stay hidden until `leaf` does too. At most BROWSE_LIMIT. */
export function browseMatches<T extends BrowseEntry>(entries: readonly T[], leaf: string, limit = BROWSE_LIMIT): T[] {
    const needle = leaf.toLowerCase();
    const showDot = leaf.startsWith(".");
    const ranked: { entry: T; lower: string; rank: number }[] = [];
    for (const entry of entries) {
        const name = entry.name ?? "";
        const lower = name.toLowerCase();
        if (name === "" || (name.startsWith(".") && !showDot)) {
            continue;
        }
        const at = lower.indexOf(needle);
        if (at < 0) {
            continue;
        }
        ranked.push({ entry, lower, rank: (entry.isdir ? 0 : 2) + (at === 0 ? 0 : 1) });
    }
    ranked.sort((a, b) => a.rank - b.rank || (a.lower < b.lower ? -1 : a.lower > b.lower ? 1 : 0));
    return ranked.slice(0, limit).map((r) => r.entry);
}

/** Pure: `text` with the `@…` word around the caret replaced by the picked entry of the folder `dir` (as typed). A file
 *  is `@<dir><name>` and a space, as insertFileMention writes it. A folder is `@<dir><name>/` with no space, the caret
 *  right after it, so the picker (still open on that word) lists the folder's own entries next. */
export function insertBrowsePick(
    text: string,
    start: number,
    caret: number,
    dir: string,
    entry: { name: string; isdir?: boolean }
): { text: string; caret: number } {
    if (!entry.isdir) {
        return insertFileMention(text, start, caret, `${dir}${entry.name}`);
    }
    const mention = `@${dir}${entry.name}/`;
    const rest = text.slice(caret).replace(/^\S*/, "");
    return { text: text.slice(0, start) + mention + rest, caret: start + mention.length };
}

/** Pure: the folder whose files a chat box's `@` lists: the agent's own folder (its block's `cmd:cwd`, a run worker's
 *  worktree included), but only for an agent of a registered project, so one started in Home (too big to walk) or in a
 *  stray folder gets no picker (""). With no cwd, the project's own folder. */
export function chatFilesRoot(
    cwd: string | undefined,
    project: string | undefined,
    registry: Record<string, { path?: string }>
): string {
    const projectPath = (project && registry[project]?.path) || "";
    if (projectPath === "") {
        return "";
    }
    return cwd || projectPath;
}
