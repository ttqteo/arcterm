// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the New agent dialog's resume step: the Task box on top, the sessions on the left and the picked Claude
// session's last 5 messages on the right (docs/superpowers/specs/2026-11-06-launcher-session-peek-design.md, "The
// resume step"). When the step shows, the debounced and cached read (the fetch is injected), the read's states and its
// meta line. No React, no RPC imports.

import { formatAgo, formatTokens } from "./agentsviewmodel";
import type { Runtime } from "./launch";
import { modelLabel } from "./session-models/sessionviewmodel";

// One message of the panel, as wavesrv's getsessionpeek answers it. role is "user" or "assistant"; the Go type is a
// plain string, so anything but "user" draws as Claude.
export interface PeekMessage {
    role: string;
    text: string;
    ts: number;
}

export interface PeekResult {
    messages: PeekMessage[];
    // the backward read stopped at its 8 MB cap before the file's start
    capped: boolean;
    // where the page before this one starts (a byte offset; 0 once the read reached the file's start) and whether it
    // starts inside a turn whose answer is already shown: sent back as is for that page
    before: number;
    answered: boolean;
}

// the first read: the last 5 messages
export const PEEK_COUNT = 5;
// each scroll to the top reads this many older ones
export const PEEK_OLDER_COUNT = 10;
// how near the top a scroll reads the older page
export const PEEK_OLDER_EDGE_PX = 48;
export const PEEK_READING_OLDER = "Reading older messages…";
export const PEEK_START = "Start of the session";
// how long the pick must be still before the panel reads it (D7)
export const PEEK_DEBOUNCE_MS = 150;
// how long the message area stays empty before it says "Reading…", so a fast read never flashes (D8)
export const PEEK_READING_DELAY_MS = 150;
export const PEEK_CACHE_LIMIT = 20;

export const PEEK_EMPTY = "This session has no messages yet.";

// The resume step is Claude Code's alone (only its transcripts are read: D1), and shows once a past session is picked:
// New session, a project with no sessions yet, Home, a terminal or a tool keep the three columns. `wanted` is false
// once you go back to the columns (← or the title's agent or project), to change your mind; each opening starts with it
// true.
export function resumeStepShows(
    wanted: boolean,
    runtime: Runtime | string,
    third: "resume" | "tools" | null,
    sessionPicked: boolean
): boolean {
    return wanted && sessionPicked && runtime === "claude" && third === "resume";
}

// A session that has moved on since its last read reads again (D7).
export function peekCacheKey(s: Pick<SessionInfo, "transcriptpath" | "lastactivets">): string {
    return `${s.transcriptpath}\n${s.lastactivets}`;
}

export type PeekOutcome = { ok: true; result: PeekResult } | { ok: false; error: string };

export interface PeekLoaderOpts {
    fetch: (session: SessionInfo) => Promise<PeekResult>;
    debounceMs?: number;
    cacheLimit?: number;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
}

export interface PeekLoader {
    // read this session once the pick has been still for debounceMs; a cached one answers at once. A newer request
    // overtakes this one: its callback never runs.
    request(session: SessionInfo, onResult: (outcome: PeekOutcome) => void): void;
    // the panel closed: drop the pending read, keep the cache for this opening of the dialog
    cancel(): void;
    // the dialog closed: drop the cache and every pending callback
    dispose(): void;
}

function errorText(e: unknown): string {
    if (e instanceof Error) {
        return e.message;
    }
    return typeof e === "string" ? e : String(e);
}

// One loader per opening of the dialog (held in a ref), so nothing outlives it.
export function createPeekLoader(opts: PeekLoaderOpts): PeekLoader {
    const debounceMs = opts.debounceMs ?? PEEK_DEBOUNCE_MS;
    const cacheLimit = opts.cacheLimit ?? PEEK_CACHE_LIMIT;
    const setT = opts.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
    const clearT =
        opts.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
    // a Map keeps insertion order: the first key is the oldest
    let cache = new Map<string, PeekResult>();
    let generation = 0;
    let timer: unknown = null;
    let disposed = false;

    const stopTimer = () => {
        if (timer != null) {
            clearT(timer);
            timer = null;
        }
    };
    const remember = (key: string, result: PeekResult) => {
        cache.delete(key);
        cache.set(key, result);
        while (cache.size > cacheLimit) {
            cache.delete(cache.keys().next().value);
        }
    };

    return {
        request(session, onResult) {
            if (disposed) {
                return;
            }
            const gen = ++generation;
            stopTimer();
            const key = peekCacheKey(session);
            const hit = cache.get(key);
            if (hit != null) {
                onResult({ ok: true, result: hit });
                return;
            }
            timer = setT(() => {
                timer = null;
                let pending: Promise<PeekResult>;
                try {
                    pending = opts.fetch(session);
                } catch (e) {
                    pending = Promise.reject(e);
                }
                pending.then(
                    (result) => {
                        if (disposed) {
                            return;
                        }
                        // an overtaken read still fills the cache: going back to it costs nothing
                        remember(key, result);
                        if (gen === generation) {
                            onResult({ ok: true, result });
                        }
                    },
                    (e) => {
                        if (!disposed && gen === generation) {
                            onResult({ ok: false, error: errorText(e) });
                        }
                    }
                );
            }, debounceMs);
        },
        cancel() {
            generation++;
            stopTimer();
        },
        dispose() {
            disposed = true;
            generation++;
            stopTimer();
            cache = new Map();
        },
    };
}

export type PeekState =
    | { status: "loading"; since: number }
    | { status: "done"; result: PeekResult }
    | { status: "error"; error: string };

// The older pages a scroll to the top has read, above the first read's messages. One per session pick: a new pick, or
// a new first read of the same session, starts it again.
export interface PeekCursor {
    before: number;
    answered: boolean;
}

export interface PeekOlder {
    // oldest first, all older than the first read's
    messages: PeekMessage[];
    // the next older page; null once the file's start is reached
    cursor: PeekCursor | null;
    loading: boolean;
    error: string | null;
}

export function peekCursor(r: Pick<PeekResult, "before" | "answered">): PeekCursor | null {
    return r.before > 0 ? { before: r.before, answered: r.answered } : null;
}

export function peekOlderStart(first: PeekResult | null): PeekOlder {
    return { messages: [], cursor: first == null ? null : peekCursor(first), loading: false, error: null };
}

export function peekOlderBegin(o: PeekOlder): PeekOlder {
    return { ...o, loading: true, error: null };
}

export function peekOlderLoaded(o: PeekOlder, page: PeekResult): PeekOlder {
    return { messages: [...page.messages, ...o.messages], cursor: peekCursor(page), loading: false, error: null };
}

export function peekOlderFailed(o: PeekOlder, error: string): PeekOlder {
    return { ...o, loading: false, error };
}

// Whether the pane reads the next older page now: there is one, none is on its way, the last did not fail, and the
// scroll is near the top or the messages do not fill the pane (no scroll to make, so it reads on by itself; a page
// that found nothing in its 8 MB reads on the same way).
export function peekOlderWanted(o: PeekOlder, scroll: { top: number; client: number; height: number }): boolean {
    if (o.cursor == null || o.loading || o.error != null) {
        return false;
    }
    return scroll.top <= PEEK_OLDER_EDGE_PX || scroll.height <= scroll.client + 1;
}

export interface PeekView {
    state: "loading" | "ready" | "empty" | "capped" | "error";
    // loading only: the delay has passed, so "Reading…" shows
    showReading: boolean;
    // oldest first: the older pages read so far, then the first read's
    messages: PeekMessage[];
    // the muted line above the oldest message: an older page on its way, its error, or the session's start once a
    // scroll has reached it
    top: string | null;
    // the line drawn in place of messages: a session with none
    line: string | null;
    error: string | null;
}

// D8's states. "capped" is a first read that found nothing in its 8 MB but has older text to read on into.
export function peekView(state: PeekState, now: number, older: PeekOlder | null = null): PeekView {
    const view: PeekView = { state: "ready", showReading: false, messages: [], top: null, line: null, error: null };
    if (state.status === "loading") {
        return { ...view, state: "loading", showReading: now - state.since >= PEEK_READING_DELAY_MS };
    }
    if (state.status === "error") {
        return { ...view, state: "error", error: state.error };
    }
    const messages = [...(older?.messages ?? []), ...state.result.messages];
    const more = older != null ? older.cursor != null : state.result.before > 0;
    let top: string | null = null;
    if (older?.loading) {
        top = PEEK_READING_OLDER;
    } else if (older?.error != null) {
        top = `Can't read older messages: ${older.error}`;
    } else if (!more && (older?.messages.length ?? 0) > 0) {
        top = PEEK_START;
    }
    if (messages.length === 0) {
        if (more) {
            return { ...view, state: "capped", top: top ?? PEEK_READING_OLDER };
        }
        return { ...view, state: "empty", line: PEEK_EMPTY, top };
    }
    return { ...view, messages, top };
}

// The header's meta line: "<age> · <model> · <branch> · <tokens>", the parts a session lacks left out. formatAgo
// already says "ago", and "just now" for a fresh one.
export function peekMeta(
    s: Pick<SessionInfo, "lastactivets" | "model" | "branch" | "tokenstotal">,
    now: number
): string {
    const parts = [
        formatAgo(Math.max(0, now - s.lastactivets)),
        modelLabel(s.model),
        s.branch,
        s.tokenstotal > 0 ? `${formatTokens(s.tokenstotal)} tokens` : "",
    ];
    return parts.filter((p) => p !== "").join(" · ");
}
