// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What went into each agent's terminal as a file: an image pasted, files dropped on the terminal, files picked
// with Attach. Keyed by the agent's terminal block id (AgentVM.blockId): the paste hook in termwrap.ts knows its
// block but not the agent (the tab it was handed is the cockpit's own), and a live agent owns exactly one block.
//
// Records persist to localStorage WITHOUT thumbnails: the downscaled picture of an image lives in memory only,
// keyed by path, and after a reload a record shows a generic icon. A pasted or dropped file is a temp copy the
// server sweeps after 24h (tempAttachRetention in pkg/wshrpc/wshserver/wshserver_files.go), so its record then
// reads "expired"; an attached file is the user's own and never expires.
//
// Imports only jotai and the global store, so termwrap.ts can import it without an import cycle.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";

export type UploadKind = "image" | "file";
export type UploadSource = "paste" | "drop" | "attach";

export interface UploadRecord {
    id: string;
    name: string;
    path: string;
    kind: UploadKind;
    source: UploadSource;
    ts: number; // epoch ms the record was made
}

// owner (terminal block id) -> its records, newest first
export type UploadsByOwner = Record<string, UploadRecord[]>;

export const UPLOADS_STORAGE_KEY = "agent.uploads";
// tempAttachRetention on the server; a record older than this is a temp copy that has been, or is about to be, swept
// (the server sweep runs at startup and every 4h)
export const TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_RECORDS_PER_OWNER = 50;
export const MAX_OWNERS = 40;

const IMAGE_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "svg",
    "avif",
    "ico",
    "tif",
    "tiff",
    "heic",
    "heif",
]);
const KINDS: readonly string[] = ["image", "file"];
const SOURCES: readonly string[] = ["paste", "drop", "attach"];

export function baseName(path: string): string {
    const trimmed = path.replace(/[\\/]+$/, "");
    return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

export function kindForName(name: string): UploadKind {
    const dot = name.lastIndexOf(".");
    return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase()) ? "image" : "file";
}

// a paste or drop is a temp copy the server deletes after a day; an attach points at the user's own file
export function isExpired(record: UploadRecord, now: number): boolean {
    return record.source !== "attach" && now - record.ts > TEMP_RETENTION_MS;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

// A path goes into the prompt as typed text. Double-quoted when it has any whitespace (the test is \s, not just a
// space), the way a terminal quotes a dropped file and the form Claude Code unwraps. Control characters are dropped,
// since terminal.paste turns a newline into Enter; the regex covers the C0 controls and DEL only, not C1 or U+2028.
// So the pasted text can differ from the recorded `path` when a name held one: the record keeps the real path.
export function quotePath(path: string): string {
    const clean = path.replace(CONTROL_CHARS, "");
    return /\s/.test(clean) ? `"${clean}"` : clean;
}

// false when quotePath would change the path, i.e. it holds a control character, so the terminal would be given a
// different file than the one on disk (CONTROL_CHARS is global, which .replace is safe with)
export function pastesAsIs(path: string): boolean {
    return path.replace(CONTROL_CHARS, "") === path;
}

// the trailing space is for the next word; Claude Code trims a pasted path before it looks for an image
export function pasteTextFor(path: string): string {
    return `${quotePath(path)} `;
}

export function makeRecord(input: {
    path: string;
    source: UploadSource;
    now: number;
    nonce: string; // random, from the caller, so this stays pure
    name?: string;
    kind?: UploadKind;
}): UploadRecord {
    const name = input.name?.trim() || baseName(input.path) || input.path;
    return {
        id: `${input.now.toString(36)}-${input.nonce}`,
        name,
        path: input.path,
        kind: input.kind ?? kindForName(name),
        source: input.source,
        ts: input.now,
    };
}

// Newest first. The same path again replaces its earlier record, so a re-attach refreshes it instead of listing twice.
export function addRecord(
    list: readonly UploadRecord[],
    record: UploadRecord,
    cap = MAX_RECORDS_PER_OWNER
): UploadRecord[] {
    return [record, ...list.filter((r) => r.path !== record.path)].slice(0, cap);
}

// keeps the owners whose newest record is newest; a closed agent's block id would otherwise stay in storage forever
export function pruneOwners(map: UploadsByOwner, max = MAX_OWNERS): UploadsByOwner {
    const owners = Object.keys(map);
    if (owners.length <= max) {
        return map;
    }
    const newest = (owner: string) => map[owner][0]?.ts ?? 0;
    const keep = owners.sort((a, b) => newest(b) - newest(a)).slice(0, max);
    return Object.fromEntries(keep.map((owner) => [owner, map[owner]]));
}

// a thumbnail is kept only while some record still points at its path
export function pruneThumbs(thumbs: Record<string, string>, map: UploadsByOwner): Record<string, string> {
    const live = new Set<string>();
    for (const list of Object.values(map)) {
        for (const r of list) {
            live.add(r.path);
        }
    }
    const keys = Object.keys(thumbs);
    if (keys.every((k) => live.has(k))) {
        return thumbs;
    }
    return Object.fromEntries(keys.filter((k) => live.has(k)).map((k) => [k, thumbs[k]]));
}

function isStoredRecord(v: unknown): v is UploadRecord {
    if (v == null || typeof v !== "object") {
        return false;
    }
    const r = v as Record<string, unknown>;
    return (
        typeof r.id === "string" &&
        r.id !== "" &&
        typeof r.name === "string" &&
        r.name !== "" &&
        typeof r.path === "string" &&
        r.path !== "" &&
        typeof r.kind === "string" &&
        KINDS.includes(r.kind) &&
        typeof r.source === "string" &&
        SOURCES.includes(r.source) &&
        typeof r.ts === "number" &&
        Number.isFinite(r.ts)
    );
}

// what a hand-edited or older value could hold is dropped; only the six record fields are kept, so nothing else
// (a thumbnail, say) can ride in from storage
export function parseStored(raw: string | null | undefined): UploadsByOwner {
    if (!raw) {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }
    const out: UploadsByOwner = {};
    for (const [owner, list] of Object.entries(parsed as Record<string, unknown>)) {
        // assigning out["__proto__"] would swap the map's prototype instead of adding an owner
        if (owner === "__proto__" || !Array.isArray(list)) {
            continue;
        }
        const records = list
            .filter(isStoredRecord)
            .slice(0, MAX_RECORDS_PER_OWNER)
            .map((r) => ({ id: r.id, name: r.name, path: r.path, kind: r.kind, source: r.source, ts: r.ts }));
        if (records.length > 0) {
            out[owner] = records;
        }
    }
    return pruneOwners(out);
}

export function serialize(map: UploadsByOwner): string {
    return JSON.stringify(map);
}

export interface UploadRowState {
    expired: boolean;
    icon: "thumb" | "image" | "file";
    // an image not past the temp retention; an attached one is never checked, the lightbox reports it gone
    enlargeable: boolean;
}

export function rowState(record: UploadRecord, now: number, hasThumb: boolean): UploadRowState {
    const expired = isExpired(record, now);
    return {
        expired,
        icon: hasThumb ? "thumb" : record.kind === "image" ? "image" : "file",
        enlargeable: record.kind === "image" && !expired,
    };
}

export interface PlannedInsert {
    record: UploadRecord;
    text: string; // what goes into the terminal as a paste
}

// Real paths (Attach): one record and one paste per path, in order, a repeated or empty path skipped.
export function planInserts(
    paths: readonly string[],
    source: UploadSource,
    now: number,
    nonce: () => string
): PlannedInsert[] {
    const seen = new Set<string>();
    const out: PlannedInsert[] = [];
    for (const path of paths) {
        if (!path || seen.has(path)) {
            continue;
        }
        seen.add(path);
        out.push({ record: makeRecord({ path, source, now, nonce: nonce() }), text: pasteTextFor(path) });
    }
    return out;
}

function readStored(): UploadsByOwner {
    try {
        return parseStored(globalThis.localStorage?.getItem(UPLOADS_STORAGE_KEY));
    } catch {
        return {};
    }
}

function writeStored(map: UploadsByOwner): void {
    try {
        globalThis.localStorage?.setItem(UPLOADS_STORAGE_KEY, serialize(map));
    } catch {
        // quota or a restricted webview: the atom still serves this session
    }
}

// seeded from localStorage at module load, so a reload still lists what was uploaded
export const uploadsMapAtom = atom<UploadsByOwner>(readStored()) as PrimitiveAtom<UploadsByOwner>;

// path -> a data URL of the downscaled image; memory only, never persisted
export const uploadThumbsAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

const EMPTY: UploadRecord[] = [];

// own keys only: an owner named "constructor" or "toString" must not read an Object.prototype member
function ownerList(map: UploadsByOwner, owner: string): UploadRecord[] | undefined {
    return Object.prototype.hasOwnProperty.call(map, owner) ? map[owner] : undefined;
}

// one agent's uploads, by its terminal block id
export const uploadsAtom = atomFamily((owner: string) => atom((get) => ownerList(get(uploadsMapAtom), owner) ?? EMPTY));

export function recordUpload(owner: string, record: UploadRecord, thumb?: string | null): void {
    const prev = globalStore.get(uploadsMapAtom);
    const next = pruneOwners({ ...prev, [owner]: addRecord(ownerList(prev, owner) ?? [], record) });
    globalStore.set(uploadsMapAtom, next);
    writeStored(next);
    // a path recorded again without a thumbnail keeps the one it already has: it is the same file
    globalStore.set(uploadThumbsAtom, (thumbs) =>
        pruneThumbs(thumb ? { ...thumbs, [record.path]: thumb } : thumbs, next)
    );
}
