// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An HTML file on disk rendered as the page it is, in an iframe served from its own folder by wavesrv
// (HtmlPreviewServeCommand), so its relative images, styles and scripts load. One frame for the Code surface and
// the Agent panel's File tab.
//
// Where the page was scrolled is kept per file (codescroll.ts), so leaving it for another file or surface, or an
// agent rewriting it, reopens it where the reader was. The page is at wavesrv's origin, out of the app's reach, so
// the script htmlserve adds to it reports its scroll here and takes the kept one back once it has loaded.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    PAGE_RESTORE,
    PAGE_TOP,
    keepScroll,
    keptScroll,
    pageScrollReport,
    scrollKey,
} from "@/app/view/code/codescroll";
import { getWebServerEndpoint } from "@/util/endpoints";
import { useEffect, useRef, useState } from "react";

// the served path never changes for a file while wavesrv runs, so each is asked for once
const served = new Map<string, Promise<string>>();

function servedPath(path: string): Promise<string> {
    let p = served.get(path);
    if (p == null) {
        p = RpcApi.HtmlPreviewServeCommand(TabRpcClient, path);
        // a refusal (the file was deleted, then comes back) is asked again next time
        p.catch(() => served.delete(path));
        served.set(path, p);
    }
    return p;
}

// back to the top of a frame's page, which only the page itself can scroll
export function frameToTop(frame: HTMLIFrameElement): void {
    if (frame.src !== "") {
        frame.contentWindow?.postMessage({ type: PAGE_TOP }, new URL(frame.src).origin);
    }
}

// `version` reloads the page when the file is rewritten at the same path; data-* attributes pass through so each
// caller keeps its own test hook
export function HtmlFrame({
    path,
    version,
    title,
    ...data
}: {
    path: string;
    version?: number | string;
    title: string;
    [dataAttr: `data-${string}`]: string | boolean | undefined;
}) {
    const [src, setSrc] = useState<{ path: string; url: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    // a page's reports count only once its kept offset is back: one it scrolls to while loading (an #anchor) would
    // otherwise overwrite where the reader was. Only its first load takes the offset back, not a page in its folder
    // the reader follows a link to
    const restoredRef = useRef(false);
    const key = scrollKey("html", path);
    const url =
        src == null || src.path !== path
            ? null
            : version == null
              ? src.url
              : `${src.url}?v=${encodeURIComponent(String(version))}`;
    useEffect(() => {
        restoredRef.current = false;
    }, [url]);
    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            const frame = frameRef.current;
            if (frame == null || e.source !== frame.contentWindow || !restoredRef.current) {
                return;
            }
            const y = pageScrollReport(e.data);
            if (y != null) {
                keepScroll(key, y);
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [key]);
    useEffect(() => {
        let live = true;
        setError(null);
        servedPath(path).then(
            (p) => live && setSrc({ path, url: getWebServerEndpoint() + p }),
            (e) => live && setError(String(e?.message ?? e))
        );
        return () => {
            live = false;
        };
    }, [path]);
    if (error != null) {
        return (
            <div className="flex flex-1 items-center justify-center px-10 text-center text-[12px] text-muted">
                Could not preview this page: {error}
            </div>
        );
    }
    if (url == null) {
        return null;
    }
    return (
        <iframe
            {...data}
            ref={frameRef}
            key={url}
            title={title}
            src={url}
            onLoad={() => {
                if (restoredRef.current) {
                    return;
                }
                restoredRef.current = true;
                const y = keptScroll(key);
                if (y != null && y > 0) {
                    frameRef.current?.contentWindow?.postMessage({ type: PAGE_RESTORE, y }, new URL(url).origin);
                }
            }}
            // the page runs its own scripts (a slide deck's navigation) at wavesrv's origin, never the app's, and
            // reaches nothing but its own folder: the token in its path is not the auth key
            sandbox="allow-scripts allow-same-origin"
            className="min-h-0 w-full flex-1 border-0 bg-page-canvas"
        />
    );
}
