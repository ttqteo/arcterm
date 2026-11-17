// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure model for searching past sessions, shared by the New agent dialog's Session column and Conversation History:
// which sessions a query keeps by title, how a SearchSessions answer splits from them, a snippet's marked parts, the
// header hint, and when the store asks again. No React, no Wave runtime.

import { foldedText } from "./sessionsfind";
import { sessionKey } from "./sessionsruns";

// the wait after the last keystroke before a query is searched
export const SEARCH_DEBOUNCE_MS = 250;
// an incomplete answer (the backend is still indexing) is asked again this often while its query is unchanged
export const SEARCH_REASK_MS = 3000;

// Where a query stands for the store: fresh (nothing answered yet), incomplete (answered, the backend still indexing)
// or settled (answered completely, or failed: an error is not retried on a timer).
export type AskState = "fresh" | "incomplete" | "settled";

// The delay before the store asks next, or null when it asks nothing: a query with no terms is not searched, and a
// settled one is done until the query changes.
export function nextAskDelay(terms: string[], state: AskState): number | null {
    if (terms.length === 0) {
        return null;
    }
    switch (state) {
        case "fresh":
            return SEARCH_DEBOUNCE_MS;
        case "incomplete":
            return SEARCH_REASK_MS;
        default:
            return null;
    }
}

// Every term is in the title, folded as findRanges folds, so a title match and a highlighted range agree. terms are
// the search's own (findTerms, or the answer's terms), already lower-cased.
export function titleMatches(title: string, terms: string[]): boolean {
    const folded = foldedText(title);
    return terms.every((t) => folded.includes(t.toLowerCase()));
}

export function sessionInfoOf(a: SessionActivity): SessionInfo {
    const info: SessionInfo = {
        id: a.id,
        runtime: a.runtime,
        projectpath: a.projectpath,
        projectname: a.projectname,
        branch: a.branch,
        task: a.task,
        model: a.model,
        tokenstotal: a.tokenstotal,
        lastactivets: a.lastactivets,
        resumecommand: a.resumecommand,
        transcriptpath: a.transcriptpath,
    };
    if (a.resumeargs != null) {
        info.resumeargs = a.resumeargs;
    }
    return info;
}

export interface SplitSessions {
    title: SessionInfo[];
    content: { session: SessionInfo; result: SessionSearchResult }[];
}

// The Session column's two groups for a query. The title group is the loaded sessions whose title matches, in the order
// loaded, then the answer's sessions whose title matches that are not loaded (an older page); every other session the
// answer holds matched by what was said, and forms the content group, newest first as the answer is. A session is in
// one place only. results is null until the search has answered, and then only the title group shows.
export function splitSessionResults(
    loaded: SessionInfo[],
    results: SessionSearchResult[] | null,
    terms: string[]
): SplitSessions {
    const title = loaded.filter((s) => titleMatches(s.task, terms));
    const seen = new Set(title.map(sessionKey));
    const content: SplitSessions["content"] = [];
    for (const result of results ?? []) {
        const key = sessionKey(result.session);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const session = sessionInfoOf(result.session);
        if (titleMatches(session.task, terms)) {
            title.push(session);
        } else {
            content.push({ session, result });
        }
    }
    return { title, content };
}

// marks are sorted [start, end) UTF-16 offsets into text, as the RPC returns them, so plain string slicing cuts them.
// A mark that is empty, out of range or already covered by the one before it is skipped.
export function snippetParts(text: string, marks: number[][]): { text: string; mark: boolean }[] {
    const out: { text: string; mark: boolean }[] = [];
    let at = 0;
    for (const [start, end] of marks ?? []) {
        const from = Math.max(start, at);
        const to = Math.min(end, text.length);
        if (to <= from) {
            continue;
        }
        if (from > at) {
            out.push({ text: text.slice(at, from), mark: false });
        }
        out.push({ text: text.slice(from, to), mark: true });
        at = to;
    }
    if (at < text.length) {
        out.push({ text: text.slice(at), mark: false });
    }
    return out;
}

// the Session column's header while a query is open: "1 title · 2 content", with "· indexing…" while the answer is
// incomplete
export function searchHint(titleCount: number, contentCount: number, incomplete: boolean): string {
    const hint = `${titleCount} ${titleCount === 1 ? "title" : "titles"} · ${contentCount} content`;
    return incomplete ? `${hint} · indexing…` : hint;
}
