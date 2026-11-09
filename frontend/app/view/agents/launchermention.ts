// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `@` file picker of the New launcher's Task box and the chat box (filemention.tsx): where an `@` being typed sits,
// which of the project's files it lists, and the text once one is picked, `@<path>` relative to the project as Claude
// Code reads it. Pure; the file list is codestore.ts's (the one Code and the palette's Files scope read), its ranking
// codefinder.ts's.

import { rankPaths } from "@/app/view/code/codefinder";

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
