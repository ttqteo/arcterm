// frontend/app/view/agents/imagediffview.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Review mode's image diff: a changed image's two versions side by side, Before | After, where a binary file
// otherwise reads "Binary file — no text to show". The sides are imagediff.ts; this only draws them. It loads once
// it scrolls into view, so a review full of images reads none it never shows, and its data URLs go when it unmounts.

import { cn, fireAndForget } from "@/util/util";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { loadImageSides, reviewSelection, type ImageSide, type ImageSides } from "./imagediff";
import { fmtBytes } from "./runcompletion";

// a checkerboard behind the image, so a transparent PNG shows its edges; theme tokens, never raw colors
const CHECKER: CSSProperties = {
    backgroundImage:
        "conic-gradient(var(--color-surface-hover) 25%, transparent 0 50%, var(--color-surface-hover) 0 75%, transparent 0)",
    backgroundSize: "16px 16px",
};

type Dims = { w: number; h: number };

export function ImageDiff({
    cwd,
    path,
    oldPath,
    source,
    base,
    refreshKey,
}: {
    cwd: string;
    path: string;
    oldPath?: string;
    source: string;
    base: string;
    refreshKey: string;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [seen, setSeen] = useState(false);
    const [sides, setSides] = useState<ImageSides | null>(null);
    const [dims, setDims] = useState<{ before?: Dims; after?: Dims }>({});

    useEffect(() => {
        const el = hostRef.current;
        if (el == null || seen) {
            return;
        }
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) {
                setSeen(true);
            }
        });
        io.observe(el);
        return () => io.disconnect();
    }, [seen]);

    // a refresh keeps the images on screen until the new ones land
    useEffect(() => {
        if (!seen) {
            return;
        }
        let alive = true;
        fireAndForget(async () => {
            const next = await loadImageSides(cwd, path, oldPath, reviewSelection(source, base));
            if (alive) {
                setSides(next);
            }
        });
        return () => {
            alive = false;
        };
    }, [seen, cwd, path, oldPath, source, base, refreshKey]);

    const resized =
        dims.before != null && dims.after != null && (dims.before.w !== dims.after.w || dims.before.h !== dims.after.h);
    return (
        <div ref={hostRef} data-image-diff={path} className="flex flex-wrap gap-[12px] px-[18px] py-[12px]">
            <SideView
                label="Before"
                side={sides?.before}
                missing="Added"
                dims={dims.before}
                onDims={(d) => setDims((p) => ({ ...p, before: d }))}
            />
            <SideView
                label="After"
                side={sides?.after}
                missing="Deleted"
                dims={dims.after}
                accentDims={resized}
                onDims={(d) => setDims((p) => ({ ...p, after: d }))}
            />
        </div>
    );
}

function SideView({
    label,
    side,
    missing,
    dims,
    accentDims = false,
    onDims,
}: {
    label: string;
    side: ImageSide | undefined;
    missing: string; // what an absent side means here
    dims?: Dims;
    accentDims?: boolean;
    onDims: (d: Dims) => void;
}) {
    const empty = (text: string) => (
        <div className="flex h-[120px] items-center justify-center rounded-[8px] border border-dashed border-edge-mid text-[12px] text-muted">
            {text}
        </div>
    );
    let body;
    if (side == null) {
        body = empty("Loading…");
    } else if (side.kind === "missing") {
        body = empty(missing);
    } else if (side.kind === "toolarge") {
        body = empty(`Too large (${fmtBytes(side.bytes)})`);
    } else if (side.kind === "error") {
        body = empty("Couldn’t read");
    } else {
        body = (
            <div
                className="flex justify-center overflow-hidden rounded-[8px] border border-edge-faint bg-surface"
                style={CHECKER}
            >
                <img
                    src={side.url}
                    alt={label}
                    onLoad={(e) => onDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    className="block max-h-[360px] max-w-full object-contain"
                />
            </div>
        );
    }
    return (
        <div data-image-side={label.toLowerCase()} className="flex min-w-[240px] flex-1 basis-0 flex-col gap-[6px]">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{label}</span>
            {body}
            {side?.kind === "image" ? (
                <span className="text-[11px] tabular-nums text-ink-faint">
                    {dims ? <span className={cn(accentDims && "text-accent")}>{`${dims.w}×${dims.h} · `}</span> : null}
                    {fmtBytes(side.bytes)}
                </span>
            ) : null}
        </div>
    );
}
