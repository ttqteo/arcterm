// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reads one file for the Agent panel's File tab, classified the way the Code surface classifies (codeclassify.ts).

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { classifyFile, hasNulByte } from "@/app/view/code/codeclassify";
import { base64ToString } from "@/util/util";

export type PanelFile =
    | { kind: "loading" }
    | { kind: "text"; text: string; stamp: string } // stamp: size and modtime, what tells a re-read nothing changed
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

export function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}
