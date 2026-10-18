// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A local image file read through wavesrv. A plain <img src> cannot carry the auth header the Tauri webview needs
// (fetchutil.ts), so the bytes are fetched and shown as a blob URL.

import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { useEffect, useState } from "react";

export type LocalImageStatus = "loading" | "ok" | "missing" | "error";
export type LocalImage = {
    url: string | null;
    status: LocalImageStatus;
    httpStatus?: number;
    width?: number;
    height?: number;
};

export function localFileUrl(endpoint: string, path: string): string {
    return endpoint + "/wave/stream-local-file?path=" + encodeURIComponent(path);
}

export function imageStatus(httpStatus: number): Exclude<LocalImageStatus, "loading"> {
    if (httpStatus === 404) {
        return "missing";
    }
    return httpStatus >= 200 && httpStatus < 300 ? "ok" : "error";
}

// a file wavesrv serves, as a blob: URL for an <img>, null while its bytes come. The packaged app's CSP lets an <img>
// load 'self', data: and blob: only (the dev app applies none), so one pointed at wavesrv draws nothing there
export function useBlobSrc(url: string | null): { src: string | null; failed: boolean } {
    const [blob, setBlob] = useState<{ from: string; src: string | null; failed: boolean } | null>(null);
    useEffect(() => {
        if (url == null) {
            return;
        }
        let live = true;
        let made: string | null = null;
        fetch(url)
            .then((resp) => (resp.ok ? resp.blob() : Promise.reject(new Error(`HTTP ${resp.status}`))))
            .then((b) => {
                made = URL.createObjectURL(b);
                if (live) {
                    setBlob({ from: url, src: made, failed: false });
                } else {
                    URL.revokeObjectURL(made);
                }
            })
            .catch(() => live && setBlob({ from: url, src: null, failed: true }));
        return () => {
            live = false;
            if (made != null) {
                URL.revokeObjectURL(made);
            }
        };
    }, [url]);
    // the previous url's blob is revoked by now: it reads as still loading
    return blob?.from === url ? { src: blob.src, failed: blob.failed } : { src: null, failed: false };
}

export function useLocalImage(path: string): LocalImage {
    const [image, setImage] = useState<LocalImage>({ url: null, status: "loading" });
    useEffect(() => {
        let cancelled = false;
        let url: string | null = null;
        setImage({ url: null, status: "loading" });
        (async () => {
            try {
                const resp = await fetch(localFileUrl(getWebServerEndpoint(), path));
                const status = imageStatus(resp.status);
                if (status !== "ok") {
                    if (!cancelled) {
                        setImage({ url: null, status, httpStatus: resp.status });
                    }
                    return;
                }
                const blob = await resp.blob();
                const bitmap = await createImageBitmap(blob);
                const { width, height } = bitmap;
                bitmap.close();
                if (cancelled) {
                    return;
                }
                url = URL.createObjectURL(blob);
                setImage({ url, status: "ok", width, height });
            } catch (e) {
                console.error("final-shots: cannot load", path, e);
                if (!cancelled) {
                    setImage({ url: null, status: "error" });
                }
            }
        })();
        return () => {
            cancelled = true;
            if (url != null) {
                URL.revokeObjectURL(url);
            }
        };
    }, [path]);
    return image;
}
