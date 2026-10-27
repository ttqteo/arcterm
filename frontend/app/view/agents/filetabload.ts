// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reads one file for the Agent panel's File tab, classified the way the Code surface classifies (codeclassify.ts).

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { classifyFile, hasNulByte } from "@/app/view/code/codeclassify";
import { base64ToString, stringToBase64 } from "@/util/util";
import { toggleTaskLine } from "./mdtasks";

export type PanelFile =
    | { kind: "loading" }
    | { kind: "text"; text: string; stamp: string } // stamp: size and modtime, what tells a re-read nothing changed
    | { kind: "pdf"; size: number; modtime: number } // streamed into a viewer, never read here
    | { kind: "image"; size: number; modtime: number } // streamed into an <img>, never read here
    | { kind: "binary"; size: number }
    | { kind: "toolarge"; size: number }
    | { kind: "missing" }
    | { kind: "error"; message: string };

// With the stamp of the text last read, it answers null when the file has not changed since, without reading it.
export async function readPanelFile(abs: string, since?: string): Promise<PanelFile | null> {
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
        if (info == null || info.notfound || info.isdir) {
            return { kind: "missing" };
        }
        const size = info.size ?? 0;
        const stamp = `${size}:${info.modtime ?? 0}`;
        if (since != null && stamp === since) {
            return null;
        }
        const klass = classifyFile(size, info.mimetype ?? "");
        if (klass === "pdf" || klass === "image") {
            return { kind: klass, size, modtime: info.modtime ?? 0 };
        }
        if (klass !== "text") {
            return { kind: klass, size };
        }
        const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: abs } });
        const text = base64ToString(data?.data64 ?? "");
        return hasNulByte(text) ? { kind: "binary", size } : { kind: "text", text, stamp };
    } catch (e) {
        return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
}

// Flips the task box on `line` (mdtasks.ts), read fresh so an edit made since the Preview's read is kept; false when
// that line no longer reads `shown`, as the Preview rendered it.
export async function toggleTaskInFile(abs: string, line: number, shown: string): Promise<boolean> {
    const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: abs } });
    const next = toggleTaskLine(base64ToString(data?.data64 ?? ""), line, shown);
    if (next == null) {
        return false;
    }
    await RpcApi.FileWriteCommand(TabRpcClient, { info: { path: abs }, data64: stringToBase64(next) });
    return true;
}

// the kinds Open hands to the OS's default app, as src-tauri's open_path allows them (OPENABLE_EXTS): a document or
// media file, never one that runs
const OS_OPENABLE = new Set(
    "pdf ppt pptx pps ppsx key odp doc docx rtf odt pages xls xlsx csv ods numbers png jpg jpeg gif webp bmp tif tiff heic mp4 mov webm mkv mp3 wav m4a flac ogg epub".split(
        " "
    )
);

/** Pure: whether Open can hand the file to the OS's default app (a .pptx to PowerPoint). */
export function canOpenInOsApp(path: string): boolean {
    const m = /\.([A-Za-z0-9]+)$/.exec(path);
    return m != null && OS_OPENABLE.has(m[1].toLowerCase());
}

export function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}
