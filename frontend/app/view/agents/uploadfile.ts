// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure rules for turning an OS file into an upload: what is too big, what is a folder, what name its temp
// copy gets, how an OS file drag is told from an agent drag, what the toast says when a file is refused, and how
// big a thumbnail is. No DOM and no RPC, so uploadfile.test.ts covers it. The callers that touch the world are
// termutil.ts (createTempFileFromFile), uploadthumb.ts and uploadsingest.ts.

import { isAgentDrag } from "./griddrop";

const MB = 1024 * 1024;

// The cap on a file copied to a temp file, and on a pasted image (createTempFileFromBlob). The bytes travel base64
// (4/3 as big) inside one websocket message, which ws.ts drops without a trace above 5 MiB (MaxWebSocketSendSize).
// 3.5 MiB is 4,893,356 bytes of base64, 349,524 under that, which leaves room for the JSON envelope and the name.
export const MAX_UPLOAD_BYTES = 3.5 * MB;
// the cap as the user reads it, in every message that names it
export const MAX_UPLOAD_LABEL = `${MAX_UPLOAD_BYTES / MB} MB`;
export const THUMB_MAX_PX = 96;
// a bigger source is not decoded just for a 96px picture; its row falls back to the generic icon
export const THUMB_SOURCE_LIMIT_BYTES = 10 * MB;

export type UploadRejection = "too-large" | "directory" | "error";

export interface Rejection {
    name: string;
    code: UploadRejection;
}

function rejectionReason(code: UploadRejection, name: string): string {
    switch (code) {
        case "too-large":
            return `${name} is over ${MAX_UPLOAD_LABEL}`;
        case "directory":
            return `${name} is a folder`;
        case "error":
            return `could not copy ${name} to a temporary file`;
    }
}

export class UploadError extends Error {
    readonly code: UploadRejection;
    readonly fileName: string;

    constructor(code: UploadRejection, fileName: string) {
        super(rejectionReason(code, fileName));
        this.name = "UploadError";
        this.code = code;
        this.fileName = fileName;
    }
}

export function checkUploadFile(f: { size: number }): UploadRejection | null {
    return f.size > MAX_UPLOAD_BYTES ? "too-large" : null;
}

// A temp copy keeps the file's own name (WriteTempFileCommand gives every file its own directory, so names cannot
// collide), cleaned for the OS: Windows refuses < > : " | ? * and control characters and the device names, and
// drops trailing dots and spaces. DEL is replaced too: Windows allows it, but the path is pasted into a terminal,
// which quotePath (uploadsstore.ts) strips of control characters, so a DEL would paste as a different file.
const MAX_NAME_CHARS = 120;
// eslint-disable-next-line no-control-regex
const WINDOWS_ILLEGAL = /[<>:"|?*\x00-\x1f\x7f]/g;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const TRAILING_DOTS_AND_SPACES = /[\s.]+$/;

export function sanitizeFileName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? "";
    let clean = base.replace(WINDOWS_ILLEGAL, "_").replace(TRAILING_DOTS_AND_SPACES, "").trim();
    if (clean === "") {
        return "file";
    }
    if (RESERVED_NAME.test(clean)) {
        clean = `_${clean}`;
    }
    // counted and cut by code point, so a long name never ends in half of a surrogate pair
    const chars = Array.from(clean);
    if (chars.length <= MAX_NAME_CHARS) {
        return clean;
    }
    const dot = chars.lastIndexOf(".");
    const ext = dot > 0 && chars.length - dot <= 10 ? chars.slice(dot).join("") : "";
    // the cut can land after a dot or a space, which Windows refuses at the end of a name part
    const stem = chars
        .slice(0, MAX_NAME_CHARS - Array.from(ext).length)
        .join("")
        .replace(TRAILING_DOTS_AND_SPACES, "");
    return (stem === "" ? "file" : stem) + ext;
}

// a file drag from the OS: it carries "Files", and never the grid's agent MIME (griddrop.ts)
export function isFileDrag(types: readonly string[]): boolean {
    return types.includes("Files") && !isAgentDrag(types);
}

// the part of a DataTransferItem collectDroppedFiles reads; the real one satisfies it
export interface DropItemLike {
    kind: string;
    getAsFile(): File | null;
    webkitGetAsEntry?(): { isDirectory: boolean; name: string } | null;
}

export interface DroppedFiles {
    files: File[];
    rejected: Rejection[];
}

function classifyFile(file: File, trustedNotFolder: boolean, out: DroppedFiles): void {
    // a dropped folder arrives as an empty File; without the entry API to say so, an empty typeless one is taken
    // as a folder
    if (!trustedNotFolder && file.size === 0 && file.type === "") {
        out.rejected.push({ name: file.name, code: "directory" });
        return;
    }
    const code = checkUploadFile(file);
    if (code != null) {
        out.rejected.push({ name: file.name, code });
    } else {
        out.files.push(file);
    }
}

// Reads a drop synchronously (a DataTransferItem is only valid while the drop event runs): the items, which know
// a folder from a file, else the plain file list.
export function collectDroppedFiles(
    items: ArrayLike<DropItemLike> | null | undefined,
    files: ArrayLike<File> | null | undefined
): DroppedFiles {
    const out: DroppedFiles = { files: [], rejected: [] };
    const fileItems = Array.from(items ?? []).filter((i) => i.kind === "file");
    if (fileItems.length === 0) {
        for (const file of Array.from(files ?? [])) {
            classifyFile(file, false, out);
        }
        return out;
    }
    for (const item of fileItems) {
        const entry = item.webkitGetAsEntry?.() ?? null;
        const file = item.getAsFile();
        if (entry?.isDirectory) {
            out.rejected.push({ name: file?.name || entry.name || "folder", code: "directory" });
        } else if (file != null) {
            classifyFile(file, entry != null, out);
        }
    }
    return out;
}

const ONE_REJECTION: Record<UploadRejection, string> = {
    "too-large": `It's over ${MAX_UPLOAD_LABEL}. Use + Attach in the Uploads panel to insert its path instead.`,
    directory: "Folders can't be dropped. Drop the files inside it, or use + Attach.",
    error: "Copying it to a temporary file failed.",
};

// what to tell the user about everything a drop could not take, as one toast; null when nothing was refused
export function rejectionToast(rejected: readonly Rejection[]): { title: string; message: string } | null {
    if (rejected.length === 0) {
        return null;
    }
    if (rejected.length === 1) {
        return { title: `Couldn't add “${rejected[0].name}”`, message: ONE_REJECTION[rejected[0].code] };
    }
    const count = (code: UploadRejection) => rejected.filter((r) => r.code === code).length;
    // what went wrong, and only the advice that fits what went wrong
    const parts: string[] = [];
    const advice: string[] = [];
    if (count("too-large") > 0) {
        parts.push(`${count("too-large")} over ${MAX_UPLOAD_LABEL}`);
        advice.push("Use + Attach to insert large files by path.");
    }
    if (count("directory") > 0) {
        parts.push(`${count("directory")} ${count("directory") === 1 ? "folder" : "folders"}`);
        advice.push("Folders can't be dropped.");
    }
    if (count("error") > 0) {
        parts.push(`${count("error")} failed to copy`);
    }
    return {
        title: `${rejected.length} items weren't added`,
        message: [`${parts.join(", ")}.`, ...advice].join(" "),
    };
}

// the longer side scales to max and the picture is never enlarged
export function thumbSize(width: number, height: number, max = THUMB_MAX_PX): { width: number; height: number } {
    if (!(width > 0) || !(height > 0)) {
        return { width: 1, height: 1 };
    }
    const scale = Math.min(1, max / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
