// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where an image in Chat's markdown points (`![alt](src)` in an agent's reply): the web, a file on this machine, or
// neither. A local file can't be an <img> src as written (the webview reads `/Users/…` against its own origin and
// draws a broken image), so Chat reads it from disk (chatlocalimage.tsx); a relative path has no folder to read it
// against and is named instead.

export type ImageSrcKind = "web" | "local" | "other";

// a drive path written in either slash, C:\x or C:/x
const DRIVE = /^[A-Za-z]:[\\/]/;

export function imageSrcKind(src: string | undefined | null): ImageSrcKind {
    const s = (src ?? "").trim();
    if (/^(https?:|data:image\/|blob:)/i.test(s)) {
        return "web";
    }
    if (s.startsWith("/") || s.startsWith("~/") || DRIVE.test(s) || s.startsWith("file://")) {
        return "local";
    }
    return "other";
}

// the path to read for a local src: `file://` taken off and its escapes undone (a `%20` in a file URL)
export function localImagePath(src: string): string {
    const s = src.trim();
    if (!s.startsWith("file://")) {
        return s;
    }
    const rest = s.slice("file://".length);
    try {
        return decodeURIComponent(rest);
    } catch {
        return rest;
    }
}

// a drive path as markdown hands it over: its backslashes percent-encoded (C:%5CUsers%5C…)
const DRIVE_ENCODED = /^[A-Za-z]:%5C/i;

// react-markdown's urlTransform drops a src whose scheme it does not know, and reads `C:` as one: keep a drive path
// and a file URL, and leave every other URL to its default. Markdown percent-encodes a destination before the
// transform sees it (a `\` as %5C, a space in a <…> one as %20), so a drive path is decoded back to the path it names;
// one with a `%` that is no escape stays as written.
export function keepLocalImageUrl(url: string, fallback: (url: string) => string): string {
    if (DRIVE.test(url) || DRIVE_ENCODED.test(url)) {
        try {
            return decodeURIComponent(url);
        } catch {
            return url;
        }
    }
    return url.startsWith("file://") ? url : fallback(url);
}

// the picture formats the webview draws from a blob, by extension
const PICTURE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** Pure: the file to draw under a path an agent wrote as code (`/tmp/shot.png`), or null when it names no picture on this
 *  machine: a full path (not a relative one, which has no folder to read against) ending in a picture's extension. */
export function codePicturePath(path: string): string | null {
    const s = path.trim();
    return imageSrcKind(s) === "local" && !s.startsWith("file://") && PICTURE_EXT.test(s) ? s : null;
}
