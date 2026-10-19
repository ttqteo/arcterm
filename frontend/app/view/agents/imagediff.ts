// frontend/app/view/agents/imagediff.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The two versions of a changed image, for Review mode's image diff (imagediffview.tsx): the same before and after refs
// File mode reads (pairRefsFor), each side read as bytes and turned into a data URL, since the CSP allows
// `img-src 'self' data:` and nothing pointing at wavesrv.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { joinRepoPath } from "@/util/paths";
import { pairRefsFor, type DiffSelection, type DiffSide } from "./diffcontent";
import { IMAGE_MAX_BYTES, imageMime } from "./imagemime";

export type ImageSide =
    | { kind: "image"; url: string; bytes: number }
    | { kind: "missing" } // added on the other side, or deleted
    | { kind: "toolarge"; bytes: number }
    | { kind: "error" };

export interface ImageSides {
    before: ImageSide;
    after: ImageSide;
}

// Review's source: the working tree against its base, or one commit against its first parent
export function reviewSelection(source: string, base: string): DiffSelection {
    return source === "worktree" ? { kind: "worktree", anchorRef: base } : { kind: "commit", hash: source };
}

async function readSide(cwd: string, path: string, mime: string, side: DiffSide): Promise<ImageSide> {
    try {
        if (side.kind === "worktree") {
            const full = joinRepoPath(cwd, path);
            const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: full } });
            if (info == null || info.notfound) {
                return { kind: "missing" };
            }
            const bytes = info.size ?? 0;
            if (bytes > IMAGE_MAX_BYTES) {
                return { kind: "toolarge", bytes };
            }
            const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: full } });
            return data?.data64
                ? { kind: "image", url: `data:${mime};base64,${data.data64}`, bytes }
                : { kind: "error" };
        }
        const r = await RpcApi.GitFileAtRefCommand(TabRpcClient, {
            cwd,
            ref: side.ref,
            path,
            maxbytes: IMAGE_MAX_BYTES,
            raw: true,
        });
        if (r.missing) {
            return { kind: "missing" };
        }
        if (r.toolarge) {
            return { kind: "toolarge", bytes: r.size ?? 0 };
        }
        return r.data64
            ? { kind: "image", url: `data:${mime};base64,${r.data64}`, bytes: r.size ?? 0 }
            : { kind: "error" };
    } catch {
        return { kind: "error" };
    }
}

// null for a path that is not an image a data URL can carry; the before side reads oldPath on a rename
export async function loadImageSides(
    cwd: string,
    path: string,
    oldPath: string | undefined,
    sel: DiffSelection
): Promise<ImageSides | null> {
    const mime = imageMime(path);
    if (mime == null) {
        return null;
    }
    const refs = pairRefsFor(sel);
    const [before, after] = await Promise.all([
        readSide(cwd, oldPath || path, imageMime(oldPath || path) ?? mime, refs.original),
        readSide(cwd, path, mime, refs.modified),
    ]);
    return { before, after };
}
