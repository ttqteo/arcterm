// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The list in the Agent rail's Uploads section: what was pasted, dropped or attached into this agent's terminal, newest
// first, each with its thumbnail (or a generic icon), name and age. A paste or drop older than a day reads "expired"
// (its temp copy has been swept), not as an error. An image whose file is still there opens full size in a lightbox.
// What each row shows is uploadsstore.ts's rowState; the section around it (heading, Attach) is railuploads.tsx.

import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { useLocalImage } from "@/app/view/jarvis/localimage";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { FileText, Image as ImageIcon, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatAge, formatAgo } from "./agentsviewmodel";
import { uploadsLightboxOpenAtom } from "./uploadslightboxatom";
import { rowState, uploadThumbsAtom, type UploadRecord } from "./uploadsstore";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function UploadRow({
    record,
    thumb,
    now,
    onEnlarge,
}: {
    record: UploadRecord;
    thumb: string | undefined;
    now: number;
    onEnlarge: () => void;
}) {
    const state = rowState(record, now, thumb != null);
    const body = (
        <>
            <span className="flex size-[32px] flex-none items-center justify-center overflow-hidden rounded-[6px] bg-surface text-muted">
                {state.icon === "thumb" ? (
                    <img
                        src={thumb}
                        alt=""
                        data-upload-thumb=""
                        className={cn("block size-full object-cover", state.expired && "opacity-40")}
                    />
                ) : state.icon === "image" ? (
                    <ImageIcon size={16} aria-hidden />
                ) : (
                    <FileText size={16} aria-hidden />
                )}
            </span>
            <span
                className={cn(
                    "min-w-0 flex-1 truncate text-[11.5px]",
                    // a pasted image's name is a label ("Pasted image"); a dropped or attached file's is a file name
                    record.source !== "paste" && "font-mono",
                    state.expired ? "text-muted" : "text-secondary"
                )}
            >
                {record.name}
            </span>
            {state.expired ? (
                <span className="flex-none rounded-sm border border-edge-mid px-[6px] py-[1px] text-[10.5px] font-medium text-muted">
                    expired
                </span>
            ) : null}
            <span className="flex-none text-[10.5px] tabular-nums text-muted">{formatAge(now - record.ts)}</span>
        </>
    );
    const rowProps = {
        "data-upload-row": "",
        "data-upload-source": record.source,
        "data-upload-expired": state.expired ? "true" : "false",
        title: record.path,
    };
    const cls = "flex w-full items-center gap-[10px] rounded-[8px] bg-surface-raised px-[11px] py-[8px] text-left";
    return state.enlargeable ? (
        <button
            type="button"
            {...rowProps}
            aria-label={`Enlarge ${record.name}, ${formatAgo(now - record.ts)}`}
            onClick={onEnlarge}
            className={cn(cls, "cursor-zoom-in hover:bg-surface-hover", FOCUS_RING)}
        >
            {body}
        </button>
    ) : (
        <div {...rowProps} className={cls}>
            {body}
        </div>
    );
}

// the file is read back through wavesrv; one that is gone says so
function LightboxBody({ record, onClose }: { record: UploadRecord; onClose: () => void }) {
    const img = useLocalImage(record.path);
    return (
        <>
            <div className="flex flex-none items-center gap-[10px] border-b border-edge-mid px-[16px] py-[12px]">
                <span
                    className={cn(
                        "min-w-0 flex-1 truncate text-[12px] text-primary",
                        record.source !== "paste" && "font-mono"
                    )}
                    title={record.path}
                >
                    {record.name}
                </span>
                {img.width != null ? (
                    <span className="flex-none text-[11.5px] tabular-nums text-muted">
                        {img.width} × {img.height}
                    </span>
                ) : null}
                <button
                    type="button"
                    aria-label="Close"
                    onClick={onClose}
                    className={cn(
                        "flex size-[28px] flex-none cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-secondary",
                        FOCUS_RING
                    )}
                >
                    <X size={15} aria-hidden />
                </button>
            </div>
            <div className="flex min-h-[160px] flex-1 items-center justify-center overflow-auto bg-surface-code p-[12px]">
                {img.url != null ? (
                    <img
                        src={img.url}
                        alt={record.name}
                        data-upload-lightbox-img=""
                        className="block max-h-[74vh] max-w-full object-contain"
                    />
                ) : (
                    // one live region for all three states, so a change of state is announced, not just the first
                    <div role="status" className="flex max-w-full flex-col items-center gap-[6px] text-center">
                        <span className="text-[12px] text-muted">
                            {img.status === "loading"
                                ? "Loading…"
                                : img.status === "missing"
                                  ? "No longer on disk"
                                  : "Can't load this image"}
                        </span>
                        {img.status === "missing" ? (
                            // where it was, so the file can be found or restored
                            <span
                                title={record.path}
                                className="max-w-full break-all font-mono text-[10.5px] text-muted"
                            >
                                {record.path}
                            </span>
                        ) : null}
                    </div>
                )}
            </div>
        </>
    );
}

export function UploadsList({ records, now }: { records: readonly UploadRecord[]; now: number }) {
    const thumbs = useAtomValue(uploadThumbsAtom);
    const [open, setOpen] = useState(false);
    // the shell animates out after `open` clears, so `shown` keeps the record it was showing until the next one opens
    const [shown, setShown] = useState<UploadRecord | null>(null);
    const close = useCallback(() => setOpen(false), []);
    // the key dispatcher counts the lightbox as a modal while this is set (uploadslightboxatom.ts); the cleanup runs on
    // close and when the list unmounts with the lightbox open, so the flag cannot stay set
    useEffect(() => {
        if (!open) {
            return;
        }
        globalStore.set(uploadsLightboxOpenAtom, true);
        return () => globalStore.set(uploadsLightboxOpenAtom, false);
    }, [open]);
    return (
        <div data-uploads-list="" className="flex flex-col gap-[7px]">
            {records.map((r) => (
                <UploadRow
                    key={r.id}
                    record={r}
                    thumb={thumbs[r.path]}
                    now={now}
                    onEnlarge={() => {
                        setShown(r);
                        setOpen(true);
                    }}
                />
            ))}
            {/* portaled as a guard: no ancestor in the rail has a transform today, but one added later would become the
                containing block of ModalShell's fixed backdrop and clip the lightbox to the rail */}
            {createPortal(
                <ModalShell
                    open={open}
                    onClose={close}
                    align="center"
                    className="flex max-h-full w-[min(92vw,1000px)] flex-col"
                >
                    {/* keyed: a record opened during the exit animation must not show its name over the old image */}
                    {shown != null ? <LightboxBody key={shown.id} record={shown} onClose={close} /> : null}
                </ModalShell>,
                document.body
            )}
        </div>
    );
}
