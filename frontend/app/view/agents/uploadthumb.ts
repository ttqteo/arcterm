// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The thumbnail of an uploaded image: decoded and downscaled to THUMB_MAX_PX on a canvas, returned as a data URL
// for uploadsstore's in-memory map. Best effort: a source that is too big, or that the webview cannot decode
// (HEIC, a broken file), gives null and the row shows a generic icon. The size rule is uploadfile.ts's thumbSize.

import { THUMB_SOURCE_LIMIT_BYTES, thumbSize } from "./uploadfile";

export async function makeThumbnail(image: Blob): Promise<string | null> {
    if (image.size > THUMB_SOURCE_LIMIT_BYTES) {
        return null;
    }
    try {
        const bitmap = await createImageBitmap(image);
        try {
            const { width, height } = thumbSize(bitmap.width, bitmap.height);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (ctx == null) {
                return null;
            }
            ctx.drawImage(bitmap, 0, 0, width, height);
            return canvas.toDataURL("image/png");
        } finally {
            bitmap.close();
        }
    } catch {
        return null;
    }
}
