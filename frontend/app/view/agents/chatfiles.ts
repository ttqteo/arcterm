// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The files a sent chat message carries, for your bubble to draw as cards (docs/superpowers/plans/
// 2026-11-10-chat-files-slash-pills.md, Part B). The composer sends attachments as trailing blocks of the message
// text (composerattachments.ts messageWithAttachments: the "read these files" block, then the "Attached images:"
// block); this reads them back without changing what was sent. Pure.

import { FILES_HEADER } from "./composerattachments";
import { ABSOLUTE_PATH, splitAttachedImages } from "./launcherimages";

/** Pure: a sent message's text without its trailing attachment blocks, and the paths they name. The images block is
 *  always last (splitAttachedImages reads it); the files block, when one ends what is left, is read the same way. A
 *  block whose lines are not all absolute paths stays in the text. */
export function splitAttachments(text: string): { text: string; files: string[]; images: string[] } {
    const { text: rest, paths: images } = splitAttachedImages(text);
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

export const CARD_LIMIT = 5;

/** Pure: the cards a bubble shows, and how many the "+N more" chip folds away. Open shows them all. */
export function foldCards<T>(items: T[], open: boolean): { shown: T[]; more: number } {
    if (open || items.length <= CARD_LIMIT) {
        return { shown: items, more: 0 };
    }
    return { shown: items.slice(0, CARD_LIMIT), more: items.length - CARD_LIMIT };
}
