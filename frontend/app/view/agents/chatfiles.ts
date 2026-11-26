// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The files a sent chat message carries, for your bubble to draw as cards (docs/superpowers/plans/
// 2026-11-10-chat-files-slash-pills.md, Part B). The composer sends attachments as trailing blocks of the message
// text (composerattachments.ts messageWithAttachments: the "read these files" block, then the "Attached images:"
// block); this reads them back without changing what was sent. Pure.

import { unwrapWholePaste } from "./chattagblocks";
import { FILES_HEADER } from "./composerattachments";
import { ABSOLUTE_PATH, splitAttachedImages } from "./launcherimages";

/** Pure: a sent message's text without its trailing attachment blocks, and the paths they name. The images block is
 *  always last (splitAttachedImages reads it); the files block, when one ends what is left, is read the same way. A
 *  block whose lines are not all absolute paths stays in the text. A message the harness wrapped whole as one paste is
 *  read as what it wraps (unwrapWholePaste), so its blocks are found inside it. */
export function splitAttachments(text: string): { text: string; files: string[]; images: string[] } {
    const { text: rest, paths: images } = splitAttachedImages(unwrapWholePaste(text));
    const lines = rest.trimEnd().split(/\r?\n/);
    let i = lines.length - 1;
    while (i >= 0 && lines[i].startsWith("- ")) {
        i--;
    }
    const files = lines.slice(i + 1).map((l) => l.slice(2).trim());
    if (files.length === 0 || i < 0 || lines[i].trim() !== FILES_HEADER || !files.every((p) => ABSOLUTE_PATH.test(p))) {
        return { text: rest, files: [], images };
    }
    return { text: lines.slice(0, i).join("\n").trimEnd(), files, images };
}

export type FileTone = "pdf" | "code" | "doc" | "data" | "other";

const TONES = new Map<string, FileTone>([
    ["pdf", "pdf"],
    ...["ts", "tsx", "js", "jsx", "go", "rs", "py", "tex", "sh", "json", "yaml", "toml", "css", "html"].map(
        (ext): [string, FileTone] => [ext, "code"]
    ),
    ...["md", "txt", "docx"].map((ext): [string, FileTone] => [ext, "doc"]),
    ...["csv", "tsv", "xlsx", "parquet"].map((ext): [string, FileTone] => [ext, "data"]),
]);

/** Pure: the label on a file card's icon (the extension upper-cased and cut to 4, "FILE" with none; a leading dot is
 *  not an extension) and the tone that colours it. */
export function fileTag(name: string): { tag: string; tone: FileTone } {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    if (ext === "") {
        return { tag: "FILE", tone: "other" };
    }
    return { tag: ext.slice(0, 4).toUpperCase(), tone: TONES.get(ext) ?? "other" };
}

/** What FileInfoCommand said of a sent file: still asking, its size (none for a folder), or that it is not there (not
 *  found, or the ask failed). */
export type FileSeen = { status: "loading" } | { status: "found"; size?: number } | { status: "missing" };

// the folder a path sits in, as a path with forward slashes ("" for a file at the root)
function parentPath(path: string): string {
    const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const cut = p.lastIndexOf("/");
    return cut > 0 ? p.slice(0, cut) : "";
}

/** Pure: the name of the folder a path sits in ("" for a file at the root). */
export function parentName(path: string): string {
    const parent = parentPath(path);
    return parent.slice(parent.lastIndexOf("/") + 1);
}

/** Pure: the name of the folder every path sits in, or null when they sit in different folders. Whole parent paths are
 *  compared, so two folders that share a name are still two. */
export function commonFolder(paths: string[]): string | null {
    if (paths.length === 0) {
        return null;
    }
    const first = parentPath(paths[0]);
    return paths.every((p) => parentPath(p) === first) ? parentName(paths[0]) : null;
}

/** Pure: the bytes of all the files once every one has answered (a missing file or a folder adds nothing), null while
 *  any is still loading. */
export function totalBytes(seen: FileSeen[]): number | null {
    let sum = 0;
    for (const s of seen) {
        if (s.status === "loading") {
            return null;
        }
        if (s.status === "found") {
            sum += s.size ?? 0;
        }
    }
    return sum;
}

/** Pure: the line under a pile's front card: the folder they share, how many files, and their total once known. */
export function pileLine(count: number, folder: string | null, total: string | null): string {
    return [folder ?? "", `${count} files`, total ?? ""].filter((s) => s !== "").join(" · ");
}

/** Pure: a message's files draw as one card when it carries one, and as a pile that opens into a list from two on. */
export function filesShape(count: number): "none" | "card" | "pile" {
    return count === 0 ? "none" : count === 1 ? "card" : "pile";
}

/** Pure: the files drawn behind a pile's front card: the second and the third, at most. */
export function pileBacks<T>(items: T[]): T[] {
    return items.slice(1, 3);
}
