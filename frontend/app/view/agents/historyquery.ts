// frontend/app/view/agents/historyquery.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the history pane asks for, and how the answer is labelled. Filter shape, the mapping
// onto the RPC's own parameters, the count labels, the page-size rule, and the gate on the
// "Restored" banner. Dependency-free on purpose — the store is glue around this, not the other way
// round. Rows are historyrows.ts; lanes are gitgraph.ts.

export interface HistoryFilters {
    // matched against the commit author (git log --author)
    author: string;
    // a pathspec (git log -- <path>)
    path: string;
    // free text matched against commit subjects (git log --grep)
    text: string;
}

export const NO_FILTERS: HistoryFilters = { author: "", path: "", text: "" };

// One page of history. 50 is the mockup's own page ("loading commits 51–100"); gitinfo's own
// default of 200 is a different bound — an unpaginated read's ceiling, not a page.
export const HISTORY_PAGE_SIZE = 50;
// A settled keystroke, not every keystroke: each filter change is a git invocation.
export const FILTER_DEBOUNCE_MS = 250;
// Long enough to have lost your place. Below it, returning restores silently.
export const RESTORE_THRESHOLD_MS = 120_000;
export const RESTORE_DISMISS_MS = 6_000;
export const SCROLL_THROTTLE_MS = 150;
// How close to the bottom counts as "asking for the next page".
export const NEAR_BOTTOM_PX = 200;
// A first read slower than this gets a notice with a Retry, so a hung git log is not an endless skeleton.
export const SLOW_HISTORY_MS = 10_000;
// Above gitinfo's 10 s gitTimeout, so git's own budget ends a hung read and the failure names the git command,
// rather than the RPC's 5 s default ending it with a bare timeout.
export const HISTORY_RPC_TIMEOUT_MS = 15_000;

const filled = (s: string): string => s.trim();

export function activeFilterCount(f: HistoryFilters): number {
    return [f.author, f.path, f.text].filter((v) => filled(v) !== "").length;
}

export function anyFilterActive(f: HistoryFilters): boolean {
    return activeFilterCount(f) > 0;
}

// The RPC's own parameter names. Blank fields are omitted rather than sent as "": HistoryLog treats
// "" as "no filter", but sending it anyway would make every payload look filtered to a reader.
export function toHistoryQuery(f: HistoryFilters): { author?: string; grep?: string; path?: string } {
    const q: { author?: string; grep?: string; path?: string } = {};
    if (filled(f.author) !== "") {
        q.author = filled(f.author);
    }
    if (filled(f.text) !== "") {
        q.grep = filled(f.text);
    }
    if (filled(f.path) !== "") {
        q.path = filled(f.path);
    }
    return q;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// Deliberately relative, never absolute: a paginated read knows what it loaded and nothing about the
// repository's total, and quoting a total would mean a second git call to decorate a label.
export function countLabel(f: HistoryFilters, shown: number, loading: boolean): string {
    if (loading) {
        return "";
    }
    if (anyFilterActive(f)) {
        return plural(shown, "matching commit", "matching commits");
    }
    return `${plural(shown, "commit", "commits")} loaded`;
}

// A full page means there may be another; a short page is the end. Cheaper and more honest than a
// count query, and wrong only in the harmless case where the last page is exactly full.
// limit is what the read asked for, which is not always a page: a background refresh re-reads every
// commit already loaded in one call. Comparing a 73-commit answer against the page constant instead
// of against the 100 that were requested would claim another page exists and leave a footer that
// loads nothing forever.
export function hasMorePages(pageLength: number, limit: number = HISTORY_PAGE_SIZE): boolean {
    return pageLength >= limit;
}

export interface RestoreState {
    awayMs: number;
    // the selected row's hash; "" is the synthetic uncommitted row, null is nothing selected
    commit: string | null;
    scroll: number;
    filters: HistoryFilters;
    // the hash of row zero, i.e. what would have been selected by default
    topRowHash: string | null;
}

// The banner's sentence, or null for silence. Two gates, both required: something non-default came
// back, AND you were away long enough to have lost the thread. The surface unmounts on every nav
// switch, so an unconditional announcement would fire constantly and teach the user to ignore it.
export function restoreNotice(s: RestoreState): string | null {
    if (s.awayMs < RESTORE_THRESHOLD_MS) {
        return null;
    }
    const parts: string[] = [];
    // "" is the uncommitted row, which is the default selection on a dirty tree — not a restored place
    if (s.commit != null && s.commit !== "" && s.commit !== s.topRowHash) {
        parts.push(`commit ${s.commit.slice(0, 7)}`);
    }
    if (s.scroll > 0) {
        parts.push("your scroll position");
    }
    const n = activeFilterCount(s.filters);
    if (n > 0) {
        parts.push(plural(n, "filter", "filters"));
    }
    if (parts.length === 0) {
        return null;
    }
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return `Back where you left off: ${list}.`;
}

export function slowSeconds(startedAt: number | null, now: number): number | null {
    if (startedAt == null || now - startedAt < SLOW_HISTORY_MS) {
        return null;
    }
    return Math.floor((now - startedAt) / 1000);
}

// The empty list's second line: the filters read back as a sentence, so a typo in one is visible.
export function noMatchSentence(f: HistoryFilters): string {
    const author = filled(f.author);
    const text = filled(f.text);
    const path = filled(f.path);
    const verbs = [text ? `mentions “${text}”` : "", path ? `touches ${path}` : ""].filter(Boolean);
    return `No commit${author ? ` by ${author}` : ""}${verbs.length ? ` ${verbs.join(" and ")}` : ""}.`;
}
