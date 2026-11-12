// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Presentational pieces for the composer's attachments: the chip tray (image thumbnails / file icons with
// per-chip remove + retry; an image's thumbnail and name open it full size) and the `+` that opens the native file
// dialog. State + behavior live in useComposerAttachments (composerattachments.ts); these are props-in views.

import { ImageZoom, type ZoomImage } from "@/app/element/imagezoom";
import { File as FileIcon, Loader2, Plus, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { isOversize, type Attachment } from "./composerattachments";

export function fmtSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Chip({
    att,
    onRemove,
    onRetry,
    onOpen,
}: {
    att: Attachment;
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
    onOpen: (image: ZoomImage) => void;
}) {
    const isError = att.status === "error";
    const isUploading = att.status === "uploading";
    // an oversize file was never kept, so there is nothing to retry
    const canRetry = isError && !isOversize(att.size ?? 0);
    const shell =
        "flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[11px] " +
        (isError ? "border-error/40 bg-error/10 text-error" : "border-edge-mid bg-background text-secondary") +
        (isUploading ? " opacity-70" : "");
    return (
        <span
            data-attachment-chip={att.status}
            data-attachment-path={att.path}
            title={att.error ?? att.path ?? att.name}
            className={shell}
        >
            {att.kind === "image" && att.previewUrl ? (
                <button
                    type="button"
                    data-attachment-open=""
                    title="Open full size"
                    onClick={() => onOpen({ src: att.previewUrl, alt: att.name })}
                    className="flex min-w-0 cursor-zoom-in items-center gap-1.5 rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <img src={att.previewUrl} alt="" className="h-7 w-7 rounded object-cover" />
                    <span className="max-w-[120px] truncate">{att.name}</span>
                </button>
            ) : (
                <>
                    <FileIcon size={13} className="shrink-0 text-muted" />
                    <span className="max-w-[120px] truncate">{att.name}</span>
                </>
            )}
            {att.kind !== "image" && att.size != null ? <span className="text-muted">{fmtSize(att.size)}</span> : null}
            {isUploading ? (
                <Loader2 size={12} className="shrink-0 animate-spin motion-reduce:animate-none text-muted" />
            ) : null}
            {canRetry ? (
                <button
                    type="button"
                    title="Retry"
                    onClick={() => onRetry(att.id)}
                    className="shrink-0 cursor-pointer text-error hover:opacity-80"
                >
                    <RotateCw size={12} />
                </button>
            ) : null}
            <button
                type="button"
                title="Remove"
                onClick={() => onRemove(att.id)}
                className="shrink-0 cursor-pointer text-muted hover:text-error"
            >
                <X size={12} />
            </button>
        </span>
    );
}

export function AttachmentTray({
    items,
    onRemove,
    onRetry,
}: {
    items: Attachment[];
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
}) {
    const [zoomed, setZoomed] = useState<ZoomImage | null>(null);
    if (items.length === 0) {
        return null;
    }
    return (
        <div className="flex min-w-0 flex-wrap gap-1.5">
            {items.map((a) => (
                <Chip key={a.id} att={a} onRemove={onRemove} onRetry={onRetry} onOpen={setZoomed} />
            ))}
            <ImageZoom image={zoomed} onClose={() => setZoomed(null)} />
        </div>
    );
}

// A `+`, as the chat box's board draws it: the same 28px height as the chips beside it, no border of its own
export function AttachButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            title="Attach files"
            aria-label="Attach files"
            data-attach-files
            data-chat-attach
            onClick={onClick}
            className="flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center rounded-[8px] text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <Plus size={16} strokeWidth={1.8} aria-hidden />
        </button>
    );
}
