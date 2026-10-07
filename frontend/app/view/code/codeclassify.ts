// frontend/app/view/code/codeclassify.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: decide how an opened file should be presented, from its stat and (as a backstop) its
// decoded content. Keeps the size and binary gates out of the store's IO path.

export const MAX_VIEW_BYTES = 2 * 1024 * 1024;

// READMEs and other prose read as documents; the viewer renders them with the app's markdown
// component. Extension-only: the backend maps unknown extensions to an empty mimetype (how Go and
// Rust files pass the text gate), so MIME would misclassify .md reliably.
const MARKDOWN_EXT = /\.(?:md|markdown)$/i;

export function isMarkdownPath(rel: string): boolean {
    return MARKDOWN_EXT.test(rel);
}

// application/* types that are really text. Anything else outside text/* is binary.
const TEXTISH_MIME = new Set([
    "application/json",
    "application/javascript",
    "application/xml",
    "application/x-sh",
    "application/x-yaml",
    "application/yaml",
    "application/toml",
    "application/x-latex",
    "application/x-tex",
]);

// pdf is its own class: the viewer streams it from /wave/stream-file, so it never meets the size gate.
export type FileClass = "text" | "binary" | "toolarge" | "pdf";

// an empty mimetype means the backend did not recognize the extension — Go, Rust and most config
// files land there, so empty must be viewable or the surface would call this repo binary.
export function classifyFile(size: number, mimeType: string): FileClass {
    const m = (mimeType ?? "").split(";")[0].trim().toLowerCase();
    if (m === "application/pdf") {
        return "pdf";
    }
    if (size > MAX_VIEW_BYTES) {
        return "toolarge";
    }
    if (m === "" || m.startsWith("text/") || TEXTISH_MIME.has(m)) {
        return "text";
    }
    return "binary";
}

const NUL_SCAN_CHARS = 8192;

// backstop for a wrong or absent mimetype: real source text contains no NUL.
export function hasNulByte(text: string): boolean {
    return text.slice(0, NUL_SCAN_CHARS).includes("\u0000");
}

// Monaco ships no LaTeX or BibTeX language; latexlang.ts registers both. The name is passed explicitly rather than
// left to extension inference because Monaco's Apex language also claims .cls (and the backend maps .cls to Apex).
const LATEX_EXT = /\.(?:tex|sty|cls|ltx|latex)$/i;
const BIB_EXT = /\.bib$/i;

export function languageForPath(path: string): string | undefined {
    if (LATEX_EXT.test(path)) {
        return "latex";
    }
    if (BIB_EXT.test(path)) {
        return "bibtex";
    }
    return undefined;
}

// the files that read as a document: a Preview and, with a built PDF, a PDF mode
export function isTexPath(path: string): boolean {
    return /\.tex$/i.test(path);
}

// Prose wraps by default whatever editor:wordwrap says: its paragraphs are one line each. Code follows the setting.
const PROSE_EXT = /\.(?:tex|bib|md|markdown|txt)$/i;

export function defaultWrap(path: string, setting: boolean | undefined): boolean {
    return PROSE_EXT.test(path) || (setting ?? false);
}

export type ViewMode = "preview" | "source" | "diff" | "pdf";

export function viewModesFor(path: string, hasPdf: boolean): ViewMode[] {
    if (isMarkdownPath(path)) {
        return ["preview", "source", "diff"];
    }
    if (isTexPath(path)) {
        return hasPdf ? ["preview", "source", "diff", "pdf"] : ["preview", "source", "diff"];
    }
    return ["source", "diff"];
}

// The mode atom is one for every file, so a mode this file does not offer (PDF chosen on a .tex, then a .go opened)
// reads as its Preview, else its Source.
export function resolveViewMode(path: string, mode: ViewMode, hasPdf: boolean): ViewMode {
    const modes = viewModesFor(path, hasPdf);
    if (modes.includes(mode)) {
        return mode;
    }
    return modes.includes("preview") ? "preview" : "source";
}

// the 1-based line a character offset sits on, clamped to the text
export function lineAtOffset(text: string, offset: number): number {
    const end = Math.min(Math.max(offset, 0), text.length);
    let line = 1;
    for (let i = 0; i < end; i++) {
        if (text.charCodeAt(i) === 10) {
            line++;
        }
    }
    return line;
}
