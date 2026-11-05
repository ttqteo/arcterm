// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The viewer header's `Link an older version…` (board A-viewer-header, spec 2026-11-05-canvas-related-design.md): a
// button that opens a popover under it listing the canvases this one can replace: same project, older than it, and not
// replaced by another canvas yet (linkCandidates, canvasgallery.ts). The current target is in the list, marked linked.
// Picking one writes the link and closes. The picker's open state and query are canvasgallerystore.ts'; Escape is
// bindings.ts' (the first closes the picker, the second leaves the viewer), except inside the search box, whose own
// Escape closes it.

import { useBlobSrc } from "@/app/view/jarvis/localimage";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { boardCountLabel, linkCandidates, linkWrite, type GalleryCanvas } from "./canvasgallery";
import {
    canvasBase,
    closeLinkPicker,
    linkPickerAtom,
    openLinkPicker,
    setCanvasLink,
    setLinkPickerQuery,
} from "./canvasgallerystore";
import { SWAP_BTN } from "./swapbar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "6 boards · 4 Nov": the picker is ordered by creation time, so that is the date it shows
function candidateMeta(c: GalleryCanvas, linked: boolean): string {
    const at = new Date(c.createdts);
    const parts = [boardCountLabel(c.boards.length), `${at.getDate()} ${MONTHS[at.getMonth()]}`];
    return (linked ? [...parts, "linked"] : parts).join(" · ");
}

// the cached preview, small; a canvas with none (or one that fails to load) is a blank tile
function PickerThumb({ canvas: c }: { canvas: GalleryCanvas }) {
    const [base, setBase] = useState<string | null>(null);
    useEffect(() => {
        if (c.thumbts <= 0) {
            return;
        }
        let live = true;
        void canvasBase(c.designdir).then((b) => live && setBase(b));
        return () => {
            live = false;
        };
    }, [c.designdir, c.thumbts]);
    const url =
        c.thumbts > 0 && base != null ? `${base}/${encodeURIComponent(c.topic)}/thumb.png?v=${c.thumbts}` : null;
    const thumb = useBlobSrc(url);
    return (
        <div className="h-[35px] w-[56px] flex-none overflow-hidden rounded-[4px] border border-edge-mid bg-surface-code">
            {thumb.src != null && !thumb.failed ? (
                <img alt="" draggable={false} src={thumb.src} className="h-full w-full object-cover object-top" />
            ) : null}
        </div>
    );
}

export function LinkOlderVersion({ canvas, list }: { canvas: GalleryCanvas; list: GalleryCanvas[] }) {
    const picker = useAtomValue(linkPickerAtom);
    const wrapRef = useRef<HTMLDivElement>(null);
    // a press outside the button and the popover closes it, as any popover does
    useEffect(() => {
        if (!picker.open) {
            return;
        }
        const onDown = (e: PointerEvent) => {
            if (wrapRef.current != null && !wrapRef.current.contains(e.target as Node)) {
                closeLinkPicker();
            }
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [picker.open]);

    return (
        <div ref={wrapRef} className="relative flex-none">
            <button
                type="button"
                data-canvas-link-open
                aria-haspopup="dialog"
                aria-expanded={picker.open}
                onClick={() => (picker.open ? closeLinkPicker() : openLinkPicker())}
                className={SWAP_BTN}
            >
                Link an older version…
            </button>
            {picker.open ? <LinkPicker canvas={canvas} list={list} query={picker.query} /> : null}
        </div>
    );
}

function LinkPicker({ canvas, list, query }: { canvas: GalleryCanvas; list: GalleryCanvas[]; query: string }) {
    const rows = linkCandidates(list, canvas, query);
    // nothing to offer at all, or the search left nothing: only the first is "no older canvas"
    const none = rows.length === 0 && linkCandidates(list, canvas, "").length === 0;
    const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") {
            // the box's own Escape: the binding stands down while a field has focus
            e.preventDefault();
            e.stopPropagation();
            closeLinkPicker();
        }
    };
    const pick = (older: GalleryCanvas) => {
        closeLinkPicker();
        void setCanvasLink(linkWrite(canvas, older.topic));
    };
    return (
        <div
            data-canvas-link-picker
            role="dialog"
            aria-label="Link an older version"
            className="absolute left-0 top-[34px] z-20 flex max-h-[420px] w-[340px] flex-col gap-1 overflow-hidden rounded-lg border border-edge-strong bg-surface p-2 shadow-popover-md"
        >
            <input
                data-canvas-link-search
                aria-label={`Search ${canvas.projectname}'s canvases`}
                placeholder={`Search ${canvas.projectname}'s canvases`}
                autoFocus
                value={query}
                onChange={(e) => setLinkPickerQuery(e.target.value)}
                onKeyDown={onSearchKey}
                className="flex-none rounded-[6px] border border-edge-mid bg-background px-[9px] py-[6px] text-[12px] text-primary outline-none placeholder:text-muted focus:border-edge-strong"
            />
            <div className="flex min-h-0 flex-col gap-[2px] overflow-y-auto">
                {rows.map(({ canvas: older, current }) => (
                    <button
                        key={older.dir}
                        type="button"
                        data-canvas-link-row={older.topic}
                        data-current={current ? "" : undefined}
                        title={older.topic}
                        onClick={() => pick(older)}
                        className={cn(
                            "flex w-full min-w-0 cursor-pointer items-center gap-[10px] rounded-[6px] p-[6px] text-left hover:bg-surface-hover",
                            current && "bg-surface-selected hover:bg-surface-selected"
                        )}
                    >
                        <PickerThumb canvas={older} />
                        <span className="flex min-w-0 flex-col gap-[2px]">
                            <span className="truncate text-[12.5px] font-semibold text-primary">{older.topic}</span>
                            <span className="truncate text-[11px] tabular-nums text-muted">
                                {candidateMeta(older, current)}
                            </span>
                        </span>
                    </button>
                ))}
                {rows.length === 0 ? (
                    <div data-canvas-link-empty className="px-[6px] py-[10px] text-[12px] text-muted">
                        {none ? `No older canvas in ${canvas.projectname}` : `No canvas matches “${query.trim()}”`}
                    </div>
                ) : null}
            </div>
            <div className="flex-none px-[6px] pb-[2px] pt-1 text-[11px] text-muted">
                Only canvases in {canvas.projectname}, older than this one
            </div>
        </div>
    );
}
