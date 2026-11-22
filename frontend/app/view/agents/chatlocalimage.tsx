// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An image file on this machine in Chat: the one a launch attached to your prompt (PromptImages), and one an agent's
// reply names in markdown (`![alt](/path/shot.png)`, markdownmessage.tsx). The webview's CSP (img-src 'self' data:
// blob:) blocks an <img> pointed at wavesrv, so the file is fetched and shown as a blob URL (useLocalImage); a click
// shows it at its full width, another click shrinks it back, and a file that is gone is named in its place.

import { useLocalImage } from "@/app/view/jarvis/localimage";
import { cn } from "@/util/util";
import { ImageOff } from "lucide-react";
import { useState } from "react";

export function PromptThumb({
    src,
    alt,
    open,
    onToggle,
}: {
    src: string;
    alt: string;
    open: boolean;
    onToggle: () => void;
}) {
    return (
        <img
            src={src}
            alt={alt}
            onClick={(e) => {
                e.stopPropagation();
                onToggle();
            }}
            className={cn(
                "max-w-full rounded-[6px] border border-edge-mid object-contain",
                open ? "cursor-zoom-out" : "max-h-[160px] cursor-zoom-in"
            )}
        />
    );
}

export function AttachedImage({
    path,
    open,
    onToggle,
    alt,
}: {
    path: string;
    open: boolean;
    onToggle: () => void;
    alt?: string;
}) {
    const img = useLocalImage(path);
    const name = path.split(/[\\/]/).pop() ?? path;
    if (img.url != null) {
        return <PromptThumb src={img.url} alt={alt || name} open={open} onToggle={onToggle} />;
    }
    if (img.status === "loading") {
        return (
            <span
                data-prompt-image-loading
                title={path}
                className="inline-block h-[60px] w-[80px] rounded-[6px] border border-edge-mid bg-surface align-middle"
            />
        );
    }
    return <ImageNamed path={path} why={img.status === "missing" ? "no longer on disk" : "can't load"} />;
}

// an image Chat can't draw, named where it would be: its file name, the whole path in the tooltip
export function ImageNamed({ path, why }: { path: string; why: string }) {
    const name = path.split(/[\\/]/).pop() || path;
    return (
        <span
            data-prompt-image-gone
            title={path}
            className="inline-flex max-w-full items-center gap-1.5 rounded-[6px] border border-edge-mid px-2 py-1 align-middle text-[11.5px] text-muted"
        >
            <ImageOff size={13} aria-hidden className="flex-none" />
            <span className="min-w-0 truncate">
                {name} · {why}
            </span>
        </span>
    );
}

// one local image in a reply, with its own zoom state
export function ReplyImage({ path, alt }: { path: string; alt?: string }) {
    const [open, setOpen] = useState(false);
    return (
        <span data-reply-image className="my-1 block">
            <AttachedImage path={path} alt={alt} open={open} onToggle={() => setOpen((o) => !o)} />
        </span>
    );
}
