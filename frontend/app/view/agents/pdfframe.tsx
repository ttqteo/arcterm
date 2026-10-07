// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A PDF on disk in WebView2's own viewer (scroll, zoom, find), streamed from /wave/stream-file. One frame for the
// Doc review's PDF tab, the Code surface and the Agent panel's File tab.

import { getApi } from "@/app/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";
import { urlFor } from "./docpdf";

// the iframe can't send the auth header, so the URL carries the key
export function streamFileUrl(path: string, version?: number): string {
    return urlFor(path, getWebServerEndpoint(), getApi().getAuthKey(), version);
}

// `version` busts the route's cache when the file is rewritten at the same path; data-* attributes pass through
// so each caller keeps its own test hook
export function PdfFrame({
    path,
    version,
    title,
    ...data
}: {
    path: string;
    version?: number;
    title: string;
    [dataAttr: `data-${string}`]: string | boolean | undefined;
}) {
    return (
        <iframe {...data} title={title} src={streamFileUrl(path, version)} className="min-h-0 w-full flex-1 border-0" />
    );
}
