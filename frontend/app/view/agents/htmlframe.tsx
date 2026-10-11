// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An HTML file on disk rendered as the page it is, in an iframe served from its own folder by wavesrv
// (HtmlPreviewServeCommand), so its relative images, styles and scripts load. One frame for the Code surface and
// the Agent panel's File tab.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { useEffect, useState } from "react";

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
    if (src == null || src.path !== path) {
        return null;
    }
    const url = version == null ? src.url : `${src.url}?v=${encodeURIComponent(String(version))}`;
    return (
        <iframe
            {...data}
            key={url}
            title={title}
            src={url}
            // the page runs its own scripts (a slide deck's navigation) at wavesrv's origin, never the app's, and
            // reaches nothing but its own folder: the token in its path is not the auth key
            sandbox="allow-scripts allow-same-origin"
            className="min-h-0 w-full flex-1 border-0 bg-page-canvas"
        />
    );
}
