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

// react-markdown's urlTransform drops a src whose scheme it does not know, and reads `C:` as one: keep a drive path
// and a file URL as written, and leave every other URL to its default
export function keepLocalImageUrl(url: string, fallback: (url: string) => string): string {
    return DRIVE.test(url) || url.startsWith("file://") ? url : fallback(url);
}

// the picture formats the webview draws from a blob, by extension
const PICTURE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** Pure: the file to draw under a path an agent wrote as code (`/tmp/shot.png`), or null when it names no picture on this
 *  machine: a full path (not a relative one, which has no folder to read against) ending in a picture's extension. */
export function codePicturePath(path: string): string | null {
    const s = path.trim();
    return imageSrcKind(s) === "local" && !s.startsWith("file://") && PICTURE_EXT.test(s) ? s : null;
}
