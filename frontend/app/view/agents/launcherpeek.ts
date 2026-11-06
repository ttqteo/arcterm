// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the New agent dialog's Quick look panel: a Claude session's last 5 messages, under the columns
// (docs/superpowers/specs/2026-11-06-launcher-session-peek-design.md). When it is offered, the debounced and cached
// read (the fetch is injected), the panel's states, its meta line, and how a message's text splits into plain text
// and code fences. No React, no RPC imports.

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
}

export const PEEK_COUNT = 5;
// how long the pick must be still before the panel reads it (D7)
export const PEEK_DEBOUNCE_MS = 150;
// how long the message area stays empty before it says "Reading…", so a fast read never flashes (D8)
export const PEEK_READING_DELAY_MS = 150;
export const PEEK_CACHE_LIMIT = 20;

export const PEEK_EMPTY = "This session has no messages yet.";
export const PEEK_CAPPED_NONE = "No messages in the last 8 MB. Open asleep to read the whole session.";
export const PEEK_CAPPED_NOTE = "Only the last 8 MB was read. Open asleep to read the whole session.";

// Quick look is Claude Code's alone, and only for a session (not New session): D1.
export function peekOffered(runtime: Runtime | string, resume: SessionInfo | null): boolean {
    return runtime === "claude" && resume != null;
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

export interface PeekView {
    state: "loading" | "ready" | "empty" | "capped" | "error";
    // loading only: the delay has passed, so "Reading…" shows
    showReading: boolean;
    // oldest first
    messages: PeekMessage[];
    // the capped note, a muted line above the oldest message when 1–4 were found
    note: string | null;
    // the line drawn in place of messages: empty, or capped with none found
    line: string | null;
    error: string | null;
}

// D8's states.
export function peekView(state: PeekState, now: number): PeekView {
    const view: PeekView = { state: "ready", showReading: false, messages: [], note: null, line: null, error: null };
    if (state.status === "loading") {
        return { ...view, state: "loading", showReading: now - state.since >= PEEK_READING_DELAY_MS };
    }
    if (state.status === "error") {
        return { ...view, state: "error", error: state.error };
    }
    const { messages, capped } = state.result;
    if (capped && messages.length === 0) {
        return { ...view, state: "capped", line: PEEK_CAPPED_NONE };
    }
    if (capped && messages.length < PEEK_COUNT) {
        return { ...view, state: "capped", messages, note: PEEK_CAPPED_NOTE };
    }
    if (messages.length === 0) {
        return { ...view, state: "empty", line: PEEK_EMPTY };
    }
    return { ...view, messages };
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

export interface TextSegment {
    code: boolean;
    text: string;
}

const FENCE = /^\s*(```|~~~)/;

// A message's text as plain text (line breaks kept) and code fences, which draw monospace. Markdown is not rendered
// (D8). A fence left open, as in a message clipped at 1,500 characters, runs to the end as code.
export function splitFences(text: string): TextSegment[] {
    const out: TextSegment[] = [];
    let code = false;
    let marker = "";
    let lines: string[] = [];
    const flush = () => {
        const body = lines.join("\n");
        const kept = code ? body : body.replace(/^\n+|\n+$/g, "");
        if (kept !== "") {
            out.push({ code, text: kept });
        }
        lines = [];
    };
    for (const line of text.split("\n")) {
        const m = FENCE.exec(line);
        if (m != null && (!code || m[1] === marker)) {
            flush();
            code = !code;
            marker = code ? m[1] : "";
            continue;
        }
        lines.push(line);
    }
    flush();
    return out;
}

export interface PeekPick {
    runtime: Runtime | string;
    project: string;
    // the picked session's id; null is New session
    sessionId: string | null;
}

// Picking another agent, another project or New session closes the panel; moving between sessions keeps it open and
// it follows the pick (D6).
export function peekClosesOn(prev: PeekPick, next: PeekPick): boolean {
    return prev.runtime !== next.runtime || prev.project !== next.project || next.sessionId == null;
}
