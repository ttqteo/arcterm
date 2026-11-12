// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Code peek card's state and the decisions it renders from: which modes it offers, its diff stat, the words
// for a file it cannot show, and where the card sits against the terminal line. A peek is handed an absolute path the
// terminal's path links already resolved and found (termpathlinks.ts), so nothing here resolves a path against a cwd or
// a home folder.

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import type { ChangeNote } from "@/app/view/agents/gitstatus";
import { isImagePath, isMarkdownPath, MAX_IMAGE_BYTES, MAX_VIEW_BYTES, NOT_TRACKED } from "./codeclassify";

export type PeekMode = "preview" | "source" | "diff";
export type PeekHead = { kind: "text"; text: string } | { kind: "absent" } | { kind: "error"; message: string };
// `note` is gitstatus.ts's reason a change has no line counts to show (a binary file, a nested repository, a submodule)
export type PeekChange = { adds: number; dels: number; note?: ChangeNote };
// change: the file's entry in git's changes; null when git lists none (no changes), "unknown" when the read failed or
// timed out, which must not read as no changes
export type PeekGit = { kind: "norepo" } | { kind: "repo"; head: PeekHead; change: PeekChange | null | "unknown" };
export type PeekFile =
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "binary"; size: number }
    | { kind: "toolarge"; size: number }
    | { kind: "error"; message: string }
    | { kind: "text"; text: string; git: PeekGit };

export const PEEK_PREFERRED_PX = 400;
// the floor the design asks for; min(preferred, room) already meets it wherever the room allows
export const PEEK_MIN_PX = 160;

const PREVIEW_MARKDOWN_ONLY = "Preview is for markdown files";

export function initialPeekMode(path: string): PeekMode {
    return isMarkdownPath(path) ? "preview" : "source";
}

export function binaryPeekMessage(path: string): string {
    return isImagePath(path) ? "Image — open it in Code" : "Binary file";
}

// a text file past the 2 MB text cap, or an image past the cap the webview decodes whole
export function toolargePeekMessage(path: string): string {
    return isImagePath(path)
        ? `Larger than the ${MAX_IMAGE_BYTES / 1024 / 1024} MB image limit`
        : `Larger than the ${MAX_VIEW_BYTES / 1024 / 1024} MB view limit`;
}

// Open in Code is for a file that is there: one the card can show, and one it only names
export function canOpenPeek(file: PeekFile): boolean {
    return file.kind === "text" || file.kind === "binary" || file.kind === "toolarge";
}

export function peekModes(path: string, file: PeekFile): Record<PeekMode, { enabled: boolean; reason?: string }> {
    if (file.kind !== "text") {
        return { preview: { enabled: false }, source: { enabled: false }, diff: { enabled: false } };
    }
    return {
        preview: isMarkdownPath(path) ? { enabled: true } : { enabled: false, reason: PREVIEW_MARKDOWN_ONLY },
        source: { enabled: true },
        diff: file.git.kind === "repo" ? { enabled: true } : { enabled: false, reason: NOT_TRACKED },
    };
}

// counted as numstat counts: a final line without a newline still counts
function lineCount(text: string): number {
    if (text === "") {
        return 0;
    }
    return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

// numstat is the source, matching the details rail; an untracked file has no numstat entry, so a file new since HEAD
// falls back to its own line count. A change git counts no lines of reads as uncounted, never as +0 −0, and a failed
// changes read as unknown, never as no changes
export function peekStat(file: PeekFile): { label: string; adds?: number; dels?: number } | null {
    if (file.kind !== "text" || file.git.kind !== "repo") {
        return null;
    }
    const { head } = file.git;
    if (head.kind !== "absent" && file.git.change === "unknown") {
        return { label: "changes unknown" };
    }
    const change = file.git.change === "unknown" ? null : file.git.change;
    if (head.kind === "absent") {
        return { label: "new file", adds: change?.adds ? change.adds : lineCount(file.text) };
    }
    if (change?.note != null) {
        return { label: "line counts unknown" };
    }
    if (change) {
        return { label: "", adds: change.adds, dels: change.dels };
    }
    return { label: "no changes" };
}

export function peekRow(markerLine: number, viewportY: number, rows: number): number | null {
    const row = markerLine - viewportY;
    return row >= 0 && row < rows ? row : null;
}

// decided on open and on resize only, so streaming output never flips the card
export function peekPlacement(p: { lineTop: number; lineHeight: number; viewportHeight: number }): {
    side: "below" | "above";
    height: number;
} {
    const above = p.lineTop;
    const below = p.viewportHeight - p.lineTop - p.lineHeight;
    const side = below >= PEEK_PREFERRED_PX || below > above ? "below" : "above";
    const room = side === "below" ? below : above;
    return { side, height: Math.max(0, Math.min(PEEK_PREFERRED_PX, room)) };
}

// the path the card's header names: relative to the terminal's folder when the file is under it, else the full path
export function peekHeaderPath(abs: string, root: string | null): string {
    return root != null && isUnderRoot(root, abs) ? toRel(root, abs) : abs;
}
