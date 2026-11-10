// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure model of Chat's inline visual: a one-line ```arc-visual block naming an HTML page an agent wrote under
// ~/.arc/visuals/, drawn in the chat as a frame. This module decides which block lines may be drawn, whether a prompt
// the page posts is sent, put into the chat box or dropped, how tall the frame is, and which app colours the page
// gets. No React and no store: the frame, the message listener and the focus check that feed these are in the view.

export const VISUAL_LANG = "arc-visual";
// the longest prompt a page may send, in UTF-16 units
export const PROMPT_MAX = 4000;
// two prompts from one frame closer than this: the second goes into the box instead of being sent
export const PROMPT_GAP_MS = 1500;
export const FRAME_MIN = 120;
export const FRAME_MAX = 640;
export const FRAME_EXPANDED_MAX = 4000;
// the frame's height before the page has reported one
const FRAME_DEFAULT = 160;

const ONE_PATH = "a visual must be one absolute path";
const NOT_HTML = "a visual must be an .html file";
const NOT_IN_DIR = "a visual must sit in ~/.arc/visuals";

// `${home}/.arc/visuals`, slashes forward, no trailing slash
export function visualsDirOf(home: string): string {
    const base = home.replace(/\\/g, "/").replace(/\/+$/, "");
    return `${base}/.arc/visuals`;
}

// the drive letter of a `C:/…` path in lower case, so `c:/x` and `C:/x` compare equal; the rest is left as written
// (a case-different folder is a different folder on a POSIX disk, so it is not treated as inside)
function foldDrive(path: string): string {
    return /^[A-Za-z]:\//.test(path) ? path[0].toLowerCase() + path.slice(1) : path;
}

// a segment that climbs out of a folder: `..`, and what Windows reads as `..` (more dots, trailing dots or spaces)
function climbs(segment: string): boolean {
    return /^\.{2,}[. ]*$/.test(segment);
}

// the block's one line as an absolute .html/.htm path inside dir, slashes forward; else why it is shown as code
export function visualPathOf(raw: string, dir: string): { path: string } | { refused: string } {
    const line = raw.trim();
    if (line === "" || /[\r\n]/.test(line)) {
        return { refused: ONE_PATH };
    }
    const path = line.replace(/\\/g, "/");
    if (!/^([A-Za-z]:)?\//.test(path)) {
        return { refused: ONE_PATH };
    }
    if (!/\.html?$/i.test(path)) {
        return { refused: NOT_HTML };
    }
    if (path.split("/").some(climbs)) {
        return { refused: NOT_IN_DIR };
    }
    const root = foldDrive(dir.replace(/\\/g, "/").replace(/\/+$/, "")) + "/";
    if (!foldDrive(path).startsWith(root)) {
        return { refused: NOT_IN_DIR };
    }
    return { path };
}

export type PromptAction = "send" | "fill" | "drop";

// what to do with a prompt a page posted: send it as the person's message, put it at the end of the chat box, or drop it
export function promptAction(i: {
    fromFrame: boolean; // e.source is this visual's iframe window
    frameFocused: boolean; // document.activeElement is this iframe
    text: unknown;
    draft: string; // the chat box's current text
    sinceLastMs: number; // since this frame's last accepted prompt (Infinity when none)
}): PromptAction {
    if (!i.fromFrame || !i.frameFocused) {
        return "drop";
    }
    if (typeof i.text !== "string" || i.text.trim() === "" || i.text.length > PROMPT_MAX) {
        return "drop";
    }
    if (i.draft.trim() !== "" || i.sinceLastMs < PROMPT_GAP_MS) {
        return "fill";
    }
    return "send";
}

// the frame's height in px: what the page reported, kept between FRAME_MIN and the cap (higher once expanded)
export function frameHeight(reported: number | undefined, expanded: boolean): number {
    if (reported === undefined || !Number.isFinite(reported)) {
        return FRAME_DEFAULT;
    }
    return Math.min(Math.max(reported, FRAME_MIN), expanded ? FRAME_EXPANDED_MAX : FRAME_MAX);
}

// the app colours a visual gets, as the bridge's --arc-<key>: key → the app's CSS custom property
export const THEME_VARS: Record<string, string> = {
    background: "--color-background",
    surface: "--color-surface",
    "surface-raised": "--color-surface-raised",
    edge: "--color-edge-mid",
    ink: "--color-ink-hi",
    "ink-mid": "--color-ink-mid",
    muted: "--color-muted",
    accent: "--color-accent",
    success: "--color-success",
    warning: "--color-warning",
    error: "--color-error",
    "font-sans": "--font-sans",
    "font-mono": "--font-mono",
};

// key → the custom property's value as read, trimmed; a property that reads empty is left out
export function themeVars(read: (cssVar: string) => string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, cssVar] of Object.entries(THEME_VARS)) {
        const value = read(cssVar).trim();
        if (value !== "") {
            out[key] = value;
        }
    }
    return out;
}
