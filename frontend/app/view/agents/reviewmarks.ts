// frontend/app/view/agents/reviewmarks.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Review marks for the Diff surface's changed-file list: which files of a subject (one commit, or a
// scope's aggregate range) the reader has ticked off. Module-level and persisted like every other store
// on this surface, because the surface unmounts on a nav switch and the marks must survive a restart.
// A mark remembers the file's fingerprint and, when it was the open file, a hash of its diff pair, so a
// file that changed after it was reviewed reads as stale rather than as still reviewed.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { diffPairAtom } from "./diffcontentstore";
import { rangeKey, type DiffRange } from "./diffscope";
import { buildFileTree, treeModeAtom } from "./filetree";
import type { GitChange } from "./gitstatus";

// `${cwd}|${key}`, where key is `commit:<sha>` or the range's rangeKey
export type ReviewSubject = string;
export type ReviewState = "none" | "ok" | "stale";

export interface StoredMark {
    fp: string;
    // hash of the diff pair, present only when the file was open when marked
    h?: string;
    stale?: boolean;
}

export interface SubjectMarks {
    // last touched, epoch ms; the least recent subjects are pruned first
    at: number;
    files: Record<string, StoredMark>;
}

export type ReviewStore = Record<ReviewSubject, SubjectMarks>;

export const REVIEW_STORAGE_KEY = "diff.review.marks";
export const MAX_REVIEW_SUBJECTS = 200;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function reviewSubjectFor(
    cwd: string | null | undefined,
    range: DiffRange | null | undefined,
    commit: string | null
): ReviewSubject | null {
    if (!cwd || range == null) {
        return null;
    }
    // a commit is the same commit wherever it is listed, so compare and history share its marks
    return `${cwd}|${commit != null ? `commit:${commit}` : rangeKey(range)}`;
}

export function fingerprint(c: GitChange): string {
    return `${c.status}:${c.adds}:${c.dels}`;
}

function fnvFold(h: number, s: string): number {
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), FNV_PRIME);
    }
    return h;
}

// FNV-1a over original + NUL + modified, folded piecewise so a 2 MB pair is not concatenated
export function pairHash(original: string, modified: string): string {
    const h = fnvFold(fnvFold(fnvFold(FNV_OFFSET, original), "\0"), modified);
    return (h >>> 0).toString(16).padStart(8, "0");
}

export function markState(marks: SubjectMarks | undefined, c: GitChange): ReviewState {
    const mark = marks?.files[c.path];
    if (mark == null) {
        return "none";
    }
    return mark.stale || mark.fp !== fingerprint(c) ? "stale" : "ok";
}

// only listed files count: a mark left behind by a renamed or reverted path is not progress
export function reviewProgress(marks: SubjectMarks | undefined, files: GitChange[]): { done: number; total: number } {
    return { done: files.filter((c) => markState(marks, c) === "ok").length, total: files.length };
}

export function reviewOrder(files: GitChange[], tree: boolean): string[] {
    if (!tree) {
        return files.map((c) => c.path);
    }
    // no collapsed set: a collapsed directory's files are still next in line
    return buildFileTree(files, new Set())
        .filter((r) => r.kind === "file")
        .map((r) => r.id);
}

export function nextUnreviewed(order: string[], from: string, reviewed: (path: string) => boolean): string | null {
    const start = order.indexOf(from);
    for (let i = 1; i <= order.length; i++) {
        const p = order[(start + i) % order.length];
        if (p !== from && !reviewed(p)) {
            return p;
        }
    }
    return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
    return v != null && typeof v === "object" && !Array.isArray(v);
}

function parseMark(v: unknown): StoredMark | null {
    if (!isObject(v) || typeof v.fp !== "string") {
        return null;
    }
    const mark: StoredMark = { fp: v.fp };
    if (typeof v.h === "string") {
        mark.h = v.h;
    }
    if (v.stale === true) {
        mark.stale = true;
    }
    return mark;
}

function parseSubject(v: unknown): SubjectMarks | null {
    if (!isObject(v) || typeof v.at !== "number" || !isObject(v.files)) {
        return null;
    }
    const files: Record<string, StoredMark> = {};
    for (const [path, raw] of Object.entries(v.files)) {
        const mark = parseMark(raw);
        if (mark != null) {
            files[path] = mark;
        }
    }
    return Object.keys(files).length > 0 ? { at: v.at, files } : null;
}

// malformed entries are dropped one by one, so one bad subject cannot cost the reader every other
export function parseStoredReviews(raw: string | null): ReviewStore {
    if (raw == null) {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.warn("[diff] stored review marks are not JSON; starting empty", e);
        return {};
    }
    if (!isObject(parsed)) {
        console.warn("[diff] stored review marks are not an object; starting empty");
        return {};
    }
    const out: ReviewStore = {};
    for (const [subject, v] of Object.entries(parsed)) {
        const marks = parseSubject(v);
        if (marks != null) {
            out[subject] = marks;
        }
    }
    return out;
}

export function pruneSubjects(store: ReviewStore, max: number): ReviewStore {
    const entries = Object.entries(store);
    if (entries.length <= max) {
        return store;
    }
    entries.sort((a, b) => b[1].at - a[1].at);
    return Object.fromEntries(entries.slice(0, max));
}

function readStoredReviews(): ReviewStore {
    try {
        return parseStoredReviews(globalThis.localStorage?.getItem(REVIEW_STORAGE_KEY) ?? null);
    } catch (e) {
        console.warn("[diff] review marks could not be read; starting empty", e);
        return {};
    }
}

function writeStoredReviews(store: ReviewStore): void {
    try {
        globalThis.localStorage?.setItem(REVIEW_STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
        console.warn("[diff] review marks were not persisted; they last until the app closes", e);
    }
}

export const reviewMarksAtom = atom<ReviewStore>(readStoredReviews()) as PrimitiveAtom<ReviewStore>;

// What the Diff surface is showing, published by the surface so the `v` binding and the diff header can
// act on the open file without reaching into the surface. null when no list is showing.
export interface ActiveReview {
    subject: ReviewSubject;
    files: GitChange[];
    open: string | null;
    select: (path: string) => void;
}

export const activeReviewAtom = atom<ActiveReview | null>(null) as PrimitiveAtom<ActiveReview | null>;

function commit(next: ReviewStore): void {
    globalStore.set(reviewMarksAtom, next);
    writeStoredReviews(next);
}

function withSubject(store: ReviewStore, subject: ReviewSubject, files: Record<string, StoredMark>): ReviewStore {
    const next = { ...store };
    if (Object.keys(files).length === 0) {
        delete next[subject];
        return next;
    }
    next[subject] = { at: Date.now(), files };
    return pruneSubjects(next, MAX_REVIEW_SUBJECTS);
}

export function setReviewed(subject: ReviewSubject, changes: GitChange[], on: boolean): void {
    const store = globalStore.get(reviewMarksAtom);
    const files = { ...store[subject]?.files };
    const pair = globalStore.get(diffPairAtom);
    for (const c of changes) {
        if (!on) {
            delete files[c.path];
            continue;
        }
        // a fresh object, so re-marking a stale file drops its flag and its old hash
        const mark: StoredMark = { fp: fingerprint(c) };
        if (pair != null && pair.path === c.path) {
            mark.h = pairHash(pair.original, pair.modified);
        }
        files[c.path] = mark;
    }
    commit(withSubject(store, subject, files));
}

export function toggleReviewed(subject: ReviewSubject, change: GitChange): void {
    const on = markState(globalStore.get(reviewMarksAtom)[subject], change) !== "ok";
    setReviewed(subject, [change], on);
    const active = globalStore.get(activeReviewAtom);
    // marking the open file moves on to the next one; unmarking, or marking another row, stays put
    if (!on || active == null || active.subject !== subject || active.open !== change.path) {
        return;
    }
    const marks = globalStore.get(reviewMarksAtom)[subject];
    const byPath = new Map(active.files.map((c) => [c.path, c]));
    const next = nextUnreviewed(reviewOrder(active.files, globalStore.get(treeModeAtom)), change.path, (p) => {
        const c = byPath.get(p);
        return c != null && markState(marks, c) === "ok";
    });
    if (next != null) {
        active.select(next);
    }
}

// false tells a keybinding to decline the key: there is nothing open to toggle
export function toggleOpenFile(): boolean {
    const active = globalStore.get(activeReviewAtom);
    if (active == null || active.open == null) {
        return false;
    }
    const change = active.files.find((c) => c.path === active.open);
    if (change == null) {
        return false;
    }
    toggleReviewed(active.subject, change);
    return true;
}

export function clearReviewed(subject: ReviewSubject): void {
    const store = globalStore.get(reviewMarksAtom);
    if (store[subject] == null) {
        return;
    }
    const next = { ...store };
    delete next[subject];
    commit(next);
}

// Runs on every load of the open file's pair, including the working-tree poll's refresh every few
// seconds, so anything but a real change must leave the atom and storage alone.
export function noteOpenPair(subject: ReviewSubject, path: string, hash: string): void {
    const store = globalStore.get(reviewMarksAtom);
    const marks = store[subject];
    const mark = marks?.files[path];
    if (mark == null || mark.h == null || mark.h === hash || mark.stale) {
        return;
    }
    commit({ ...store, [subject]: { ...marks, files: { ...marks.files, [path]: { ...mark, stale: true } } } });
}
