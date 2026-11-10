// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Attachments on the New run goal and the chat box: a pasted file is persisted to a wavesrv temp file via
// WriteTempFileCommand, a file picked in the native dialog is referenced where it is, and either reaches the run or the
// agent as a path in its text. Pure helpers below are unit-tested (composerattachments.test.ts); the
// useComposerAttachments hook (impure: RPC + object URLs) is verified over CDP by the new-run-attachments scenario.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { extractClipboardData, MIME_TO_EXT } from "@/app/view/term/termutil";
import { fireAndForget } from "@/util/util";
import base64 from "base64-js";
import { atom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { composeTaskWithImages } from "./launcherimages";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB; base64 inflates ~33%, bounding the RPC payload
export const FILES_HEADER = "Attachments (read these files):"; // chatfiles.ts reads the block back under it

export type AttachmentKind = "image" | "file";
export type AttachmentStatus = "uploading" | "ready" | "error";

export interface Attachment {
    id: string;
    name: string;
    kind: AttachmentKind;
    status: AttachmentStatus;
    size?: number; // unknown for a picked file, which is never read
    path?: string; // absolute path: the temp copy once uploaded, or the picked file itself
    previewUrl?: string; // object URL for image thumbnails
    error?: string; // why it failed, shown on the chip
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "heif"]);

// image when the mime says so, else fall back to the extension (dragged/pasted files often have empty type).
export function classifyKind(file: { name: string; type: string }): AttachmentKind {
    if (file.type.startsWith("image/")) {
        return "image";
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_EXTS.has(ext) ? "image" : "file";
}

// at the cap is allowed; strictly over is rejected before any RPC.
export function isOversize(size: number): boolean {
    return size > MAX_ATTACHMENT_BYTES;
}

// Appends a trailing "read these files" block listing every ready attachment's absolute path. Returns
// `text` unchanged when nothing is ready; when the base text is blank, returns just the block.
export function appendAttachments(text: string, atts: Attachment[]): string {
    const ready = atts.filter((a) => a.status === "ready" && a.path);
    if (ready.length === 0) {
        return text;
    }
    const block = `${FILES_HEADER}\n` + ready.map((a) => `- ${a.path}`).join("\n");
    return text.trim() ? `${text}\n\n${block}` : block;
}

// A message to an agent with its attachments: other files as the "read these files" block (appendAttachments), and
// images last as the "Attached images:" block a launch's task carries (composeTaskWithImages), which chat draws as
// pictures in your bubble (splitAttachedImages reads it back only as the message's last lines). Ready ones only.
export function messageWithAttachments(text: string, atts: Attachment[]): string {
    const ready = atts.filter((a) => a.status === "ready" && a.path);
    const images = ready.filter((a) => a.kind === "image").map((a) => a.path);
    const withFiles = appendAttachments(
        text,
        ready.filter((a) => a.kind !== "image")
    );
    return composeTaskWithImages("claude", withFiles, images, false).task;
}

// Picked files are referenced in place, so they are ready at once and carry no size cap. A path already
// attached is skipped, and so is a repeat within the same pick.
export function attachmentsFromPaths(paths: string[], existing: Attachment[]): Attachment[] {
    const seen = new Set(existing.map((a) => a.path).filter((p) => p != null));
    const out: Attachment[] = [];
    for (const path of paths) {
        if (!path || seen.has(path)) {
            continue;
        }
        seen.add(path);
        const name =
            path
                .replace(/[\\/]+$/, "")
                .split(/[\\/]/)
                .pop() || path;
        out.push({ id: crypto.randomUUID(), name, kind: classifyKind({ name, type: "" }), status: "ready", path });
    }
    return out;
}

// Why a launch must wait on its attachments, or null. appendAttachments lists only ready ones, so starting past
// an upload in flight or a failed one would drop that file from the goal without a word.
export function attachmentBlocker(atts: Attachment[]): string | null {
    if (atts.some((a) => a.status === "uploading")) {
        return "Attaching…";
    }
    if (atts.some((a) => a.status === "error")) {
        return "Retry or remove the failed attachment";
    }
    return null;
}

export interface UseComposerAttachments {
    attachments: Attachment[];
    addFiles: (files: FileList | File[]) => void; // dropped files, saved as temp copies like a paste
    addPaths: (paths: string[]) => void;
    remove: (id: string) => void;
    retry: (id: string) => void;
    onPaste: (e: ClipboardEvent) => void;
}

// A box given a `draftKey` (the chat box, keyed by its agent) keeps its chips here instead of in its own state, so
// switching to another agent or surface (which unmounts the box) and back finds them as they were; an upload that
// finishes meanwhile still lands on its chip. The Files kept for retry live beside them, by attachment id.
export const attachmentDraftsAtom = atom<ReadonlyMap<string, Attachment[]>>(new Map());
const draftFiles = new Map<string, File>();

type ListUpdate = Attachment[] | ((cur: Attachment[]) => Attachment[]);

function useAttachmentList(draftKey: string | undefined): [Attachment[], (u: ListUpdate) => void] {
    const [local, setLocal] = useState<Attachment[]>([]);
    const drafts = useAtomValue(attachmentDraftsAtom);
    const setDraft = useCallback(
        (u: ListUpdate) => {
            if (draftKey == null) {
                setLocal(u);
                return;
            }
            const all = globalStore.get(attachmentDraftsAtom);
            const next = typeof u === "function" ? u(all.get(draftKey) ?? []) : u;
            const m = new Map(all);
            if (next.length > 0) {
                m.set(draftKey, next);
            } else {
                m.delete(draftKey);
            }
            globalStore.set(attachmentDraftsAtom, m);
        },
        [draftKey]
    );
    return [draftKey == null ? local : (drafts.get(draftKey) ?? NO_ATTACHMENTS), setDraft];
}

const NO_ATTACHMENTS: Attachment[] = [];

// Owns attachment state and its two sources: paste (a temp copy) and picked paths (referenced in place). `keep` writes
// the copies under ~/.arc/attachments, which no temp sweep removes: a chat message names the file, and its bubble shows
// the picture from there long after a sweep would have taken it. `draftKey` keeps the chips across an unmount
// (attachmentDraftsAtom); their image previews are then revoked only on remove, not on unmount.
export function useComposerAttachments({
    keep,
    draftKey,
}: { keep?: boolean; draftKey?: string } = {}): UseComposerAttachments {
    const [attachments, setAttachments] = useAttachmentList(draftKey);
    const localFiles = useRef<Map<string, File>>(new Map()); // retained for retry(); not part of the serializable chip
    const filesRef = draftKey == null ? localFiles : { current: draftFiles };
    const previewsRef = useRef<Set<string>>(new Set()); // outstanding object URLs to revoke
    const keepPreviews = draftKey != null;

    const update = useCallback(
        (id: string, patch: Partial<Attachment>) => {
            setAttachments((cur) => cur.map((a) => (a.id === id ? { ...a, ...patch } : a)));
        },
        [setAttachments]
    );

    const persist = useCallback(
        async (id: string, file: File) => {
            try {
                const buf = await file.arrayBuffer();
                const data64 = base64.fromByteArray(new Uint8Array(buf));
                const path = await RpcApi.WriteTempFileCommand(TabRpcClient, {
                    filename: file.name,
                    data64,
                    keep: keep || undefined,
                });
                update(id, { status: "ready", path });
            } catch (e) {
                update(id, { status: "error", error: `Could not save ${file.name}: ${String(e)}` });
            }
        },
        [update, keep]
    );

    const add = useCallback(
        (files: FileList | File[]) => {
            for (const file of Array.from(files)) {
                const id = crypto.randomUUID();
                const kind = classifyKind(file);
                if (isOversize(file.size)) {
                    const error = `${file.name} is over ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`;
                    setAttachments((cur) => [
                        ...cur,
                        { id, name: file.name, kind, status: "error", size: file.size, error },
                    ]);
                    continue; // rejected before any RPC
                }
                const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;
                if (previewUrl) {
                    previewsRef.current.add(previewUrl);
                }
                filesRef.current.set(id, file);
                setAttachments((cur) => [
                    ...cur,
                    { id, name: file.name, kind, status: "uploading", size: file.size, previewUrl },
                ]);
                fireAndForget(() => persist(id, file));
            }
        },
        [persist, setAttachments, filesRef]
    );

    const addPaths = useCallback(
        (paths: string[]) => {
            setAttachments((cur) => [...cur, ...attachmentsFromPaths(paths, cur)]);
        },
        [setAttachments]
    );

    const remove = useCallback(
        (id: string) => {
            setAttachments((cur) => {
                const target = cur.find((a) => a.id === id);
                if (target?.previewUrl) {
                    URL.revokeObjectURL(target.previewUrl);
                    previewsRef.current.delete(target.previewUrl);
                }
                return cur.filter((a) => a.id !== id);
            });
            filesRef.current.delete(id);
        },
        [setAttachments, filesRef]
    );

    const retry = useCallback(
        (id: string) => {
            const file = filesRef.current.get(id);
            if (!file) {
                return;
            }
            update(id, { status: "uploading", error: undefined });
            fireAndForget(() => persist(id, file));
        },
        [persist, update, filesRef]
    );

    // revoke any outstanding object URLs on unmount, unless the chips outlive the box (a draftKey)
    useEffect(
        () => () => {
            if (keepPreviews) {
                return;
            }
            for (const url of previewsRef.current) {
                URL.revokeObjectURL(url);
            }
            previewsRef.current.clear();
        },
        [keepPreviews]
    );

    // only intercept when the clipboard carries files; plain text paste is left untouched. WebView2 can hand over a
    // pasted image with no bytes (termutil's extractDataTransferItems): such a paste reads its images again from the
    // Clipboard API, as the terminal's paste does
    const onPaste = useCallback(
        (e: ClipboardEvent) => {
            const files = filesFromClipboard(e);
            if (files.length === 0) {
                return;
            }
            e.preventDefault();
            const full = files.filter((f) => f.size > 0);
            if (full.length > 0) {
                add(full);
                return;
            }
            fireAndForget(async () => {
                const images = await clipboardImages();
                if (images.length > 0) {
                    add(images);
                }
            });
        },
        [add]
    );

    return { attachments, addFiles: add, addPaths, remove, retry, onPaste };
}

function filesFromClipboard(e: ClipboardEvent): File[] {
    const cd = e.clipboardData;
    if (!cd) {
        return [];
    }
    if (cd.files && cd.files.length > 0) {
        return Array.from(cd.files);
    }
    // fallback: some sources expose files only via items
    return Array.from(cd.items ?? [])
        .filter((i) => i.kind === "file")
        .map((i) => i.getAsFile())
        .filter((f): f is File => f != null);
}

// the clipboard's images read through the Clipboard API, named as a paste of the browser's own would be
async function clipboardImages(): Promise<File[]> {
    try {
        const out: File[] = [];
        for (const item of await navigator.clipboard.read()) {
            const data = await extractClipboardData(item);
            if (data?.image != null && data.image.size > 0) {
                const ext = MIME_TO_EXT[data.image.type] ?? "png";
                out.push(new File([data.image], `image.${ext}`, { type: data.image.type }));
            }
        }
        return out;
    } catch (err) {
        console.error("composer: clipboard read failed", err);
        return [];
    }
}
