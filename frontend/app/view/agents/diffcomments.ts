// frontend/app/view/agents/diffcomments.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pending review comments on the Diff surface: lines the reader marked while reviewing, held until they
// are sent to the agent that made the changes as one prompt. One batch per source (agent, run or
// project), keyed like originKey, so every range and commit commented on adds to the same batch.
// Module-level and persisted like reviewmarks.ts, because the surface unmounts on a nav switch and a
// batch is held until sent. Each comment carries its own anchor (file, side, the refs of the pair it was
// made on, the range and the quoted text); the quote is what re-finds the line when the file moves.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentVM } from "./agentsviewmodel";
import type { DiffPairRefs, DiffSide } from "./diffcontent";
import { originKey, type DiffScope } from "./diffscope";

export type CommentSide = "modified" | "original";

// The source as it was at the last comment. An ended agent is gone from the roster, so the batch keeps
// what the send needs to find its folder, its project and the run that started it.
export interface BatchSource {
    key: string; // originKey(scope.repo.origin)
    kind: "agent" | "run" | "project";
    label: string;
    // filesStateAtom.cwd when published; "" when the source no longer resolves one
    cwd: string;
    agentId?: string;
    // a run origin's id, or the source agent's AgentVM.runId
    runId?: string;
    // a project origin's name, or the source agent's AgentVM.project
    project?: string;
    projectPath?: string;
}

export interface PendingComment {
    id: string;
    path: string;
    side: CommentSide;
    // 1-based, inclusive, in that side's text
    start: number;
    end: number;
    // the range's lines when made, at most MAX_QUOTE_LINES
    quote: string[];
    refs: DiffPairRefs;
    note: string;
    at: number;
    // the quoted block is no longer in the file: not drawn, still counted and sent with its original lines
    lost?: boolean;
}

export interface CommentBatch {
    source: BatchSource;
    // last touched, epoch ms; the least recent batches are pruned first
    at: number;
    comments: PendingComment[];
}

export type CommentStore = Record<string, CommentBatch>;

export interface CommentDraft {
    path: string;
    side: CommentSide;
    start: number;
    end: number;
    quote: string[];
    refs: DiffPairRefs;
    editingId?: string;
    note: string;
}

export const COMMENT_STORAGE_KEY = "diff.comments.pending";
export const MAX_COMMENT_BATCHES = 50;
export const MAX_QUOTE_LINES = 40;

const SOURCE_KINDS: BatchSource["kind"][] = ["agent", "run", "project"];

function isObject(v: unknown): v is Record<string, unknown> {
    return v != null && typeof v === "object" && !Array.isArray(v);
}

function optString(v: unknown): string | undefined {
    return typeof v === "string" ? v : undefined;
}

function parseSide(v: unknown): DiffSide | null {
    if (!isObject(v)) {
        return null;
    }
    if (v.kind === "worktree") {
        return { kind: "worktree" };
    }
    return v.kind === "ref" && typeof v.ref === "string" ? { kind: "ref", ref: v.ref } : null;
}

// rebuilt in pairRefsFor's key order, so pairKey agrees with a pair loaded from git
function parseRefs(v: unknown): DiffPairRefs | null {
    if (!isObject(v)) {
        return null;
    }
    const original = parseSide(v.original);
    const modified = parseSide(v.modified);
    return original != null && modified != null ? { original, modified } : null;
}

function isLine(v: unknown): v is number {
    return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

function parseComment(v: unknown): PendingComment | null {
    if (!isObject(v)) {
        return null;
    }
    const refs = parseRefs(v.refs);
    if (
        typeof v.id !== "string" ||
        typeof v.path !== "string" ||
        (v.side !== "modified" && v.side !== "original") ||
        !isLine(v.start) ||
        !isLine(v.end) ||
        v.start > v.end ||
        !Array.isArray(v.quote) ||
        !v.quote.every((l) => typeof l === "string") ||
        refs == null ||
        typeof v.note !== "string" ||
        typeof v.at !== "number"
    ) {
        return null;
    }
    const c: PendingComment = {
        id: v.id,
        path: v.path,
        side: v.side,
        start: v.start,
        end: v.end,
        quote: v.quote,
        refs,
        note: v.note,
        at: v.at,
    };
    if (v.lost === true) {
        c.lost = true;
    }
    return c;
}

function parseSource(v: unknown): BatchSource | null {
    if (
        !isObject(v) ||
        typeof v.key !== "string" ||
        typeof v.label !== "string" ||
        typeof v.cwd !== "string" ||
        !SOURCE_KINDS.includes(v.kind as BatchSource["kind"])
    ) {
        return null;
    }
    const source: BatchSource = { key: v.key, kind: v.kind as BatchSource["kind"], label: v.label, cwd: v.cwd };
    for (const f of ["agentId", "runId", "project", "projectPath"] as const) {
        const s = optString(v[f]);
        if (s != null) {
            source[f] = s;
        }
    }
    return source;
}

function parseBatch(v: unknown): CommentBatch | null {
    if (!isObject(v) || typeof v.at !== "number" || !Array.isArray(v.comments)) {
        return null;
    }
    const source = parseSource(v.source);
    const comments = v.comments.map(parseComment).filter((c): c is PendingComment => c != null);
    return source != null && comments.length > 0 ? { source, at: v.at, comments } : null;
}

// malformed entries are dropped one by one, so one bad batch or comment cannot cost the reader the rest
export function parseStoredComments(raw: string | null): CommentStore {
    if (raw == null) {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.warn("[diff] stored comments are not JSON; starting empty", e);
        return {};
    }
    if (!isObject(parsed)) {
        console.warn("[diff] stored comments are not an object; starting empty");
        return {};
    }
    const out: CommentStore = {};
    for (const [key, v] of Object.entries(parsed)) {
        const batch = parseBatch(v);
        if (batch != null) {
            out[key] = batch;
        }
    }
    return out;
}

export function pruneBatches(store: CommentStore, max: number): CommentStore {
    const entries = Object.entries(store);
    if (entries.length <= max) {
        return store;
    }
    entries.sort((a, b) => b[1].at - a[1].at);
    return Object.fromEntries(entries.slice(0, max));
}

function readStoredComments(): CommentStore {
    try {
        return parseStoredComments(globalThis.localStorage?.getItem(COMMENT_STORAGE_KEY) ?? null);
    } catch (e) {
        console.warn("[diff] comments could not be read; starting empty", e);
        return {};
    }
}

function writeStoredComments(store: CommentStore): void {
    try {
        globalThis.localStorage?.setItem(COMMENT_STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
        console.warn("[diff] comments were not persisted; they last until the app closes", e);
    }
}

export const commentStoreAtom = atom<CommentStore>(readStoredComments()) as PrimitiveAtom<CommentStore>;

// The source the open Diff surface is commenting on, published by the surface so the pane and the send
// bar reach it without the surface. null when the surface is not mounted or has no scope.
export const activeCommentSourceAtom = atom<BatchSource | null>(null) as PrimitiveAtom<BatchSource | null>;

// The open draft card. Module-level: a surface switch keeps it until reload.
export const commentDraftAtom = atom<CommentDraft | null>(null) as PrimitiveAtom<CommentDraft | null>;

// What the last live send left behind, until the next comment on that source. Not persisted.
export const sentNoteAtom = atom<Record<string, { count: number; to: string; at: number }>>({}) as PrimitiveAtom<
    Record<string, { count: number; to: string; at: number }>
>;

export function pairKey(refs: DiffPairRefs): string {
    return JSON.stringify(refs);
}

function splitLines(text: string): string[] {
    return text.split(/\r?\n/);
}

export function quoteLines(text: string, start: number, end: number): string[] {
    return splitLines(text).slice(start - 1, Math.min(end, start - 1 + MAX_QUOTE_LINES));
}

function blockAt(lines: string[], quote: string[], at: number): boolean {
    if (at < 0 || at + quote.length > lines.length) {
        return false;
    }
    return quote.every((q, i) => lines[at + i] === q);
}

// the 0-based offset of the exact match of the quoted block nearest to `from`, or -1
function nearestBlock(lines: string[], quote: string[], from: number): number {
    const maxDist = Math.max(from, lines.length - quote.length - from);
    for (let d = 0; d <= maxDist; d++) {
        if (blockAt(lines, quote, from - d)) {
            return from - d;
        }
        if (d > 0 && blockAt(lines, quote, from + d)) {
            return from + d;
        }
    }
    return -1;
}

// The same object when nothing moved, so a caller can tell a real change from the poll's re-read.
export function relocate(c: PendingComment, text: string): PendingComment {
    const lines = splitLines(text);
    const found = text === "" || c.quote.length === 0 ? -1 : nearestBlock(lines, c.quote, c.start - 1);
    if (found < 0) {
        return c.lost ? c : { ...c, lost: true };
    }
    const start = found + 1;
    if (start === c.start && !c.lost) {
        return c;
    }
    const moved = { ...c, start, end: Math.min(start + (c.end - c.start), lines.length) };
    delete moved.lost;
    return moved;
}

function commit(next: CommentStore): void {
    globalStore.set(commentStoreAtom, next);
    writeStoredComments(next);
}

function withBatch(store: CommentStore, key: string, batch: CommentBatch): CommentStore {
    if (batch.comments.length === 0) {
        const next = { ...store };
        delete next[key];
        return next;
    }
    return pruneBatches({ ...store, [key]: batch }, MAX_COMMENT_BATCHES);
}

function clearSentNote(key: string): void {
    const notes = globalStore.get(sentNoteAtom);
    if (notes[key] == null) {
        return;
    }
    const next = { ...notes };
    delete next[key];
    globalStore.set(sentNoteAtom, next);
}

// An ended agent no longer resolves its folder, project or run, so a source that lost them keeps what
// the batch already stored.
function mergeSource(stored: BatchSource | undefined, source: BatchSource): BatchSource {
    if (stored == null) {
        return source;
    }
    return {
        ...source,
        cwd: source.cwd || stored.cwd,
        runId: source.runId ?? stored.runId,
        project: source.project ?? stored.project,
        projectPath: source.projectPath ?? stored.projectPath,
    };
}

// With draft.editingId this replaces that comment's note and keeps its id and anchor.
export function addComment(source: BatchSource, draft: CommentDraft): void {
    const store = globalStore.get(commentStoreAtom);
    const stored = store[source.key];
    const now = Date.now();
    let comments = stored?.comments ?? [];
    if (draft.editingId != null && comments.some((c) => c.id === draft.editingId)) {
        comments = comments.map((c) => (c.id === draft.editingId ? { ...c, note: draft.note } : c));
    } else {
        comments = [
            ...comments,
            {
                id: crypto.randomUUID(),
                path: draft.path,
                side: draft.side,
                start: draft.start,
                end: draft.end,
                quote: draft.quote.slice(0, MAX_QUOTE_LINES),
                refs: draft.refs,
                note: draft.note,
                at: now,
            },
        ];
    }
    commit(withBatch(store, source.key, { source: mergeSource(stored?.source, source), at: now, comments }));
    clearSentNote(source.key);
}

export function deleteComment(key: string, id: string): void {
    const store = globalStore.get(commentStoreAtom);
    const batch = store[key];
    if (batch == null || !batch.comments.some((c) => c.id === id)) {
        return;
    }
    commit(withBatch(store, key, { ...batch, at: Date.now(), comments: batch.comments.filter((c) => c.id !== id) }));
}

// After a send: drops what went into the prompt and keeps a comment added while the send was in flight.
export function removeComments(key: string, ids: string[]): void {
    const store = globalStore.get(commentStoreAtom);
    const batch = store[key];
    const drop = new Set(ids);
    if (batch == null || !batch.comments.some((c) => drop.has(c.id))) {
        return;
    }
    const comments = batch.comments.filter((c) => !drop.has(c.id));
    commit(withBatch(store, key, { ...batch, at: Date.now(), comments }));
}

export function discardBatch(key: string): void {
    const store = globalStore.get(commentStoreAtom);
    if (store[key] == null) {
        return;
    }
    const next = { ...store };
    delete next[key];
    commit(next);
}

// Runs on every load of the open pair, including the working-tree poll's refresh every few seconds, so
// anything but a real move must leave the atom and storage alone. A re-find is not a touch: `at` stays.
export function relocateComments(
    key: string,
    path: string,
    refs: DiffPairRefs,
    texts: { original: string; modified: string }
): void {
    const store = globalStore.get(commentStoreAtom);
    const batch = store[key];
    if (batch == null) {
        return;
    }
    const pair = pairKey(refs);
    let changed = false;
    const comments = batch.comments.map((c) => {
        if (c.path !== path || pairKey(c.refs) !== pair) {
            return c;
        }
        const next = relocate(c, texts[c.side]);
        changed ||= next !== c;
        return next;
    });
    if (changed) {
        commit({ ...store, [key]: { ...batch, comments } });
    }
}

export function commentsOnPair(batch: CommentBatch | undefined, path: string, refs: DiffPairRefs): PendingComment[] {
    const pair = pairKey(refs);
    return (batch?.comments ?? []).filter((c) => c.path === path && !c.lost && pairKey(c.refs) === pair);
}

// every pair, lost comments included: the file list's badge counts what will be sent
export function countsByPath(batch: CommentBatch | undefined): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const c of batch?.comments ?? []) {
        counts[c.path] = (counts[c.path] ?? 0) + 1;
    }
    return counts;
}

export function batchSummary(batch: CommentBatch | undefined): { comments: number; files: number } {
    return { comments: batch?.comments.length ?? 0, files: Object.keys(countsByPath(batch)).length };
}

export function batchSourceFor(
    scope: DiffScope | null,
    cwd: string | null | undefined,
    agent: AgentVM | undefined
): BatchSource | null {
    if (scope == null) {
        return null;
    }
    const o = scope.repo.origin;
    const base = { key: originKey(o), label: scope.repo.label, cwd: cwd ?? "" };
    switch (o.kind) {
        case "agent":
            return { ...base, kind: "agent", agentId: o.id, runId: agent?.runId, project: agent?.project };
        case "run":
            return { ...base, kind: "run", runId: o.runId };
        case "project":
            return { ...base, kind: "project", project: o.name, projectPath: o.path };
    }
}
