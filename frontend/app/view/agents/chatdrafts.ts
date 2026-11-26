// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What is being written to an agent (the text of its box and the files on it) outlives arcterm: kept in localStorage
// (`chat.drafts`) by agent id, and put back in the drafts stores when it starts again (chatdraftsstore.ts). The rules,
// pure: what a snapshot keeps, and what a read takes back.

import type { Attachment, AttachmentKind } from "./composerattachments";

/** A draft untouched this long is dropped on read: its agent is most likely closed for good. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface SavedFile {
    name: string;
    kind: AttachmentKind;
    path: string;
}

export interface SavedDraft {
    text?: string;
    files?: SavedFile[];
    /** when its text or files last changed (ms) */
    at: number;
}

export type SavedDrafts = Record<string, SavedDraft>;

function sameFiles(a: SavedFile[] | undefined, b: SavedFile[] | undefined): boolean {
    const x = a ?? [];
    const y = b ?? [];
    return x.length === y.length && x.every((f, i) => f.path === y[i].path && f.name === y[i].name);
}

/**
 * The drafts to keep: each key's text and its ready files (an upload in flight or a failed one has nothing on disk to
 * name). `skip` keys are left out (the New dialog's box, which is not an agent's). A draft whose text and files did
 * not change keeps its `at`; an empty one goes.
 */
export function snapshotDrafts(
    texts: ReadonlyMap<string, string>,
    atts: ReadonlyMap<string, readonly Attachment[]>,
    prev: SavedDrafts,
    now: number,
    skip: ReadonlySet<string> = new Set()
): SavedDrafts {
    const out: SavedDrafts = {};
    const ids = new Set([...texts.keys(), ...atts.keys()]);
    for (const id of ids) {
        if (skip.has(id)) {
            continue;
        }
        const text = texts.get(id) ?? "";
        const files = (atts.get(id) ?? [])
            .filter((a) => a.status === "ready" && !!a.path)
            .map((a) => ({ name: a.name, kind: a.kind, path: a.path! }));
        if (text === "" && files.length === 0) {
            continue;
        }
        const was = prev[id];
        const unchanged = was != null && (was.text ?? "") === text && sameFiles(was.files, files);
        const d: SavedDraft = { at: unchanged ? was.at : now };
        if (text !== "") {
            d.text = text;
        }
        if (files.length > 0) {
            d.files = files;
        }
        out[id] = d;
    }
    return out;
}

function isFile(f: unknown): f is SavedFile {
    const r = f as SavedFile;
    return (
        r != null &&
        typeof r.name === "string" &&
        typeof r.path === "string" &&
        r.path !== "" &&
        (r.kind === "image" || r.kind === "file")
    );
}

/** The drafts in what was stored: malformed entries and ones older than `maxAge` are dropped. */
export function parseDrafts(raw: unknown, now: number, maxAge = DRAFT_MAX_AGE_MS): SavedDrafts {
    const out: SavedDrafts = {};
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return out;
    }
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        const d = v as SavedDraft;
        if (d == null || typeof d !== "object" || typeof d.at !== "number" || now - d.at > maxAge) {
            continue;
        }
        const text = typeof d.text === "string" ? d.text : "";
        const files = Array.isArray(d.files) ? d.files.filter(isFile) : [];
        if (text === "" && files.length === 0) {
            continue;
        }
        const keep: SavedDraft = { at: d.at };
        if (text !== "") {
            keep.text = text;
        }
        if (files.length > 0) {
            keep.files = files.map((f) => ({ name: f.name, kind: f.kind, path: f.path }));
        }
        out[id] = keep;
    }
    return out;
}

/** The drafts stores' content for these drafts: the files come back as ready chips (no preview: the box shows the name). */
export function restoreDrafts(
    saved: SavedDrafts,
    newId: () => string = () => crypto.randomUUID()
): { texts: Map<string, string>; atts: Map<string, Attachment[]> } {
    const texts = new Map<string, string>();
    const atts = new Map<string, Attachment[]>();
    for (const [id, d] of Object.entries(saved)) {
        if (d.text) {
            texts.set(id, d.text);
        }
        if (d.files?.length) {
            atts.set(
                id,
                d.files.map((f) => ({ id: newId(), name: f.name, kind: f.kind, status: "ready", path: f.path }))
            );
        }
    }
    return { texts, atts };
}
