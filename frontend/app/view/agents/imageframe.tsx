// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An image on disk, streamed from /wave/stream-file as PdfFrame streams a PDF and drawn from a blob: URL (useBlobSrc,
// since the packaged app's CSP keeps an <img> off wavesrv): fitted to the pane, a click shows it at its own size. One
// view for the Code surface, its side column and the Agent panel's File tab.

import { useBlobSrc } from "@/app/view/jarvis/localimage";
import { cn } from "@/util/util";
import { useState } from "react";
import { formatSize } from "./filetabload";
import { streamFileUrl } from "./pdfframe";

// `version` busts the route's cache when the file is rewritten at the same path; data-* attributes pass through
// so each caller keeps its own test hook
export function ImageFrame({
    path,
    version,
    size,
    title,
    ...data
}: {
    path: string;
    version?: number;
    size: number;
    title: string;
    [dataAttr: `data-${string}`]: string | boolean | undefined;
}) {
    const [actual, setActual] = useState(false);
    // kept with the URL they came from, so a rewritten or different file starts over
    const [dims, setDims] = useState<{ src: string; w: number; h: number } | null>(null);
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const src = streamFileUrl(path, version);
    const blob = useBlobSrc(src);
    const shown = dims?.src === src ? dims : null;
    if (blob.failed || failedSrc === src) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-10 text-center">
                <div className="text-[13px] font-semibold text-ink-hi">Cannot show this image</div>
                <div className="text-[12px] leading-[1.5] text-ink-mid">{formatSize(size)}</div>
            </div>
        );
    }
    return (
        <div {...data} className="flex min-h-0 flex-1 flex-col">
            <div
                className={cn(
                    "flex min-h-0 flex-1 overflow-auto p-4",
                    actual ? "items-start justify-start" : "items-center justify-center"
                )}
            >
                {blob.src != null && (
                    <img
                        key={blob.src}
                        src={blob.src}
                        alt={title}
                        draggable={false}
                        title={actual ? "Fit to the pane" : "Show at its own size"}
                        onClick={() => setActual(!actual)}
                        onLoad={(e) =>
                            setDims({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                        }
                        onError={() => setFailedSrc(src)}
                        className={
                            actual
                                ? "max-w-none cursor-zoom-out"
                                : "max-h-full max-w-full cursor-zoom-in object-contain"
                        }
                    />
                )}
            </div>
            <div className="flex-none truncate border-t border-border px-3 py-1 text-[11px] text-muted">
                {shown != null ? `${shown.w} × ${shown.h} · ` : ""}
                {formatSize(size)}
                {actual ? " · actual size" : ""}
            </div>
        </div>
    );
}
