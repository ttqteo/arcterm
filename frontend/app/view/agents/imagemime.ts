// frontend/app/view/agents/imagemime.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The image types a data URL can carry, by extension: the app's CSP allows `img-src 'self' data:`, so an image read
// from disk or git is drawn as a data URL. Doc review's figures and the Diff surface's image diff both read it.

// past this an image is not read; doc review and the image diff draw a sentence instead
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const MIME: Record<string, string> = {
    png: "image/png",
    svg: "image/svg+xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
};

export function imageMime(path: string): string | null {
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
    return (ext && MIME[ext]) || null;
}
