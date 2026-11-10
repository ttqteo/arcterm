// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `@` file picker of the New launcher's Task box and the chat box (filemention.tsx): where an `@` being typed sits,
// which of the project's files it lists, and the text once one is picked, `@<path>` relative to the project as Claude
// Code reads it. A path that starts at a root (`../`, `~/`, `D:/`, `/`) walks folders instead: browseQuery splits it into
// the folder and the name typed in it, and the rest here places the folder, orders its entries and writes a pick. Pure;
// the file list is codestore.ts's (the one Code and the palette's Files scope read), its ranking codefinder.ts's.

import { rankPaths } from "@/app/view/code/codefinder";
import { normalizeRepoPath } from "@/util/paths";
import type { AgentEntry } from "./agentsviewmodel";
import { mentionText } from "./chateditormodel";
import { resolvePath } from "./pathlinks";

export const MENTION_FILE_LIMIT = 8;

// an @ at the start or after a space or an opening bracket or quote (an email's @ sits inside a word), and the path
// typed after it up to the caret: a path ends at whitespace
const FILE_MENTION = /(^|[\s([{"'`])@([^\s@]{0,200})$/u;

// the quoted form, `@"my dir/a b.ts"`, which a path with whitespace is written in (mentionText): the path runs up to the
// caret, whitespace included, and a closing quote or a newline ends it. Its `@` follows whitespace or an opening bracket,
// as filementiontokens.ts reads a mention, so `a@"b` is text
const QUOTED_MENTION = /(^|[\s([{])@"([^"\r\n]{0,200})$/u;

export interface FileMention {
    // where the `@` sits
    start: number;
    // what follows it, up to the caret (a quoted mention's path, without its opening quote)
    query: string;
}

/** Pure: the `@` the caret is typing a path after, or null when the caret is not in one. A picked path is followed by
 *  a space, which ends it, so the picker closes after a pick. A path being typed in quotes (`@"my dir/fo`) is read
 *  whole, whitespace included, and its query leaves the quote out; a quote that closed before the caret ends the
 *  mention. When an `@` follows an open quote (`@"a b @c`), the later one is the mention being typed. */
export function fileMentionAt(text: string, caret: number): FileMention | null {
    const head = text.slice(0, caret);
    const quoted = QUOTED_MENTION.exec(head);
    const plain = FILE_MENTION.exec(head);
    const quotedAt = quoted == null ? null : { start: caret - quoted[2].length - 2, query: quoted[2] };
    const plainAt = plain == null ? null : { start: caret - plain[2].length - 1, query: plain[2] };
    // the later `@` is the one being typed; on the same `@` (`@"abc`) the quoted reading drops the quote from the query
    return quotedAt != null && (plainAt == null || quotedAt.start >= plainAt.start) ? quotedAt : plainAt;
}

/** Pure: the files the picker lists for `query`, best first, ranked as the Code finder ranks them. `recent` (newest
 *  first, repo-relative) goes ahead: for an empty query the recent files the index still has, for a query the recent
 *  files it reaches, each in recency order, then the rest by rank. A file the agent just wrote is the likeliest one to
 *  name, and a better-scored stranger is not. */
export function fileMentionMatches(
    query: string,
    paths: readonly string[],
    limit = MENTION_FILE_LIMIT,
    recent: readonly string[] = []
): string[] {
    if (query.trim() === "" || recent.length === 0) {
        return rankPaths(query, paths, limit, recent).map((m) => m.path);
    }
    const ranked = rankPaths(query, paths, Number.POSITIVE_INFINITY).map((m) => m.path);
    const reached = new Set(ranked);
    const head = recent.filter((p) => reached.has(p));
    const headSet = new Set(head);
    return [...head, ...ranked.filter((p) => !headSet.has(p))].slice(0, limit);
}

/** Pure: the files the agent's tools touched (read, edited, written) under `root`, newest first, each once, relative to
 *  `root` with forward slashes as the file index lists them. A file outside `root` is left out: `@` names a project
 *  file. */
export function recentMentionPaths(entries: readonly AgentEntry[] | undefined, root: string): string[] {
    if (entries == null || root === "") {
        return [];
    }
    const prefix = normalizeRepoPath(root) + "/";
    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind !== "action" || !e.path) {
            continue;
        }
        const full = e.path.replace(/[\\/]+/g, "/");
        if (!normalizeRepoPath(full).startsWith(prefix)) {
            continue;
        }
        // the index's own spelling of the folders: the case of the path past the root is the file's
        const rel = full.slice(prefix.length);
        const key = rel.toLowerCase();
        if (rel !== "" && !seen.has(key)) {
            seen.add(key);
            out.push(rel);
        }
    }
    return out;
}

/** Pure: which characters of `path` the `query` matched, for the picker to mark them: per term (whitespace splits
 *  terms, as the ranking does), a run in the file name, else a run in the folders, else the term's letters in order,
 *  in the file name if they fit there, else across the path. Case is ignored. */
export function mentionMatchMask(query: string, path: string): boolean[] {
    const mask = new Array<boolean>(path.length).fill(false);
    const lower = path.toLowerCase();
    const baseStart = path.lastIndexOf("/") + 1;
    const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t !== "");
    for (const term of terms) {
        const inBase = lower.indexOf(term, baseStart);
        const at = inBase !== -1 ? inBase : lower.indexOf(term);
        if (at !== -1) {
            mask.fill(true, at, at + term.length);
            continue;
        }
        const letters = subsequence(lower, term, baseStart) ?? subsequence(lower, term, 0);
        for (const i of letters ?? []) {
            mask[i] = true;
        }
    }
    return mask;
}

// the first place each letter of term appears in text from `from` on, in order; null when one does not
function subsequence(text: string, term: string, from: number): number[] | null {
    const out: number[] = [];
    let i = from;
    for (const ch of term) {
        const at = text.indexOf(ch, i);
        if (at === -1) {
            return null;
        }
        out.push(at);
        i = at + 1;
    }
    return out;
}

/** Pure: `path` from `start` to `end` cut into runs of marked and plain characters by `mask`, for drawing. */
export function mentionRuns(
    path: string,
    mask: readonly boolean[],
    start: number,
    end: number
): { text: string; hit: boolean }[] {
    const runs: { text: string; hit: boolean }[] = [];
    for (let i = start; i < end; i++) {
        const hit = mask[i] === true;
        const last = runs[runs.length - 1];
        if (last != null && last.hit === hit) {
            last.text += path[i];
        } else {
            runs.push({ text: path[i], hit });
        }
    }
    return runs;
}

// What follows the caret in the mention a pick replaces, which goes too: picking from "@src/fo|o.ts" must not leave
// "o.ts" behind. A plain mention runs to the next whitespace; a quoted one (`@"…`) through its closing quote when one
// follows on the line, else (an open quote nothing closes) to the next whitespace, so a stray `@"` never takes the line.
function restOfMention(text: string, start: number, caret: number): string {
    const rest = text.slice(caret);
    if (text[start + 1] === '"') {
        const closed = /^[^"\r\n]*"/.exec(rest);
        if (closed != null) {
            return rest.slice(closed[0].length);
        }
    }
    return rest.replace(/^\S*/, "");
}

/** Pure: `text` with the `@…` word around the caret (from `start` to the next whitespace, or through the closing quote
 *  of an `@"…` one) replaced by the mention of `path` and a space (the one that already follows, if there is one), and
 *  where the caret goes: after that space. The mention is `@<path>`, or `@"<path>"` when the path holds whitespace
 *  (`mentionText`, as the chat box writes a pill), so it reads back as one mention. */
export function insertFileMention(
    text: string,
    start: number,
    caret: number,
    path: string
): { text: string; caret: number } {
    const mention = mentionText(path);
    const rest = restOfMention(text, start, caret);
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

/** Pure: `text` with the `@…` word around the caret replaced by the picked entry of the folder `dir` (as typed, without
 *  the opening quote of an `@"…` mention). A file is `@<dir><name>` and a space, as insertFileMention writes it. A
 *  folder is `@<dir><name>/` with no space, the caret right after it, so the picker (still open on that word) lists the
 *  folder's own entries next. A path with whitespace is quoted both ways (`@"<dir><name>"`), but a folder leaves its
 *  quote open, `@"<dir><name>/`: the walk is not over, and the picker reads the quoted path up to the caret. */
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
    const closed = mentionText(`${dir}${entry.name}/`);
    const mention = closed.endsWith('"') ? closed.slice(0, -1) : closed;
    const rest = restOfMention(text, start, caret);
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
