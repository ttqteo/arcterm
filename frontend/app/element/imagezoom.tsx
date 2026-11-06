// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A full-window view of one image: fitted on open, wheel or +/- zooms around the pointer (the centre for keys and
// buttons), drag pans while zoomed, 0 fits again. ModalShell owns Escape, the backdrop click, the modal stack and
// handing focus back on close; the math is imagezoommodel.ts.

import { ModalShell } from "@/app/modals/modalshell";
import { cn } from "@/util/util";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    ZOOM_STEP,
    canPan,
    clampView,
    fitView,
    panBy,
    stageCenter,
    wheelFactor,
    zoomAt,
    zoomKeyAction,
    zoomPercent,
    type Point,
    type Size,
    type ZoomView,
} from "./imagezoommodel";

export type ZoomImage = { src: string; alt?: string };

// a pointer that moves less than this between down and up is a click, not a drag
const DRAG_SLOP_PX = 3;
// past 2x a smoothed upscale blurs the very detail the zoom is for
const PIXELATED_FROM_SCALE = 2;

const HEADER_BUTTON =
    "flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-md border border-edge-mid px-2 text-xs text-secondary hover:text-foreground";

export function ImageZoom({ image, onClose }: { image: ZoomImage | null; onClose: () => void }) {
    // portaled: a transformed ancestor would become the containing block of the fixed backdrop, and the wheel
    // would chain into whatever scrolls behind it. ModalShell registers it as an open dialog, which is what stands
    // the surface keys down beneath it (the dispatcher's anyDialogOpen): Code's Escape-goes-back must not run.
    return createPortal(
        <ModalShell open={image != null} onClose={onClose} align="center" className="flex size-full flex-col">
            {image != null && <ZoomStage key={image.src} image={image} onClose={onClose} />}
        </ModalShell>,
        document.body
    );
}

function ZoomStage({ image, onClose }: { image: ZoomImage; onClose: () => void }) {
    const stageRef = useRef<HTMLDivElement>(null);
    const [stage, setStage] = useState<Size | null>(null);
    const [img, setImg] = useState<Size | null>(null);
    const [failed, setFailed] = useState(false);
    // null until the first zoom or pan: the shown view is fit then, and follows the stage as it resizes
    const [view, setView] = useState<ZoomView | null>(null);
    const [dragging, setDragging] = useState(false);
    const drag = useRef<{ from: Point; last: Point; moved: boolean; onBackdrop: boolean } | null>(null);

    const ready = stage != null && img != null;
    const shown = ready ? (view == null ? fitView(img, stage) : clampView(view, img, stage)) : null;
    const pannable = shown != null && canPan(shown, img, stage);

    // read by the native listeners below, which are attached once
    const live = useRef({ shown, img, stage });
    live.current = { shown, img, stage };

    const zoom = (factor: number, at?: Point) => {
        const { shown, img, stage } = live.current;
        if (shown != null) {
            setView(zoomAt(shown, factor, at ?? stageCenter(stage), img, stage));
        }
    };
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;

    useEffect(() => {
        const el = stageRef.current;
        if (el == null) {
            return;
        }
        const ro = new ResizeObserver(([entry]) =>
            setStage({ width: entry.contentRect.width, height: entry.contentRect.height })
        );
        ro.observe(el);
        // native and non-passive, so the wheel zooms instead of scrolling the page
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const r = el.getBoundingClientRect();
            zoomRef.current(wheelFactor(e.deltaY), { x: e.clientX - r.left, y: e.clientY - r.top });
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey) {
                return;
            }
            const action = zoomKeyAction(e.key);
            if (action == null) {
                return;
            }
            e.preventDefault();
            if (action === "fit") {
                setView(null);
            } else {
                zoomRef.current(action === "in" ? ZOOM_STEP : 1 / ZOOM_STEP);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            ro.disconnect();
            el.removeEventListener("wheel", onWheel);
            window.removeEventListener("keydown", onKey);
        };
    }, []);

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) {
            return;
        }
        const at = { x: e.clientX, y: e.clientY };
        // read now: once the stage captures the pointer, every later event targets the stage itself
        drag.current = { from: at, last: at, moved: false, onBackdrop: e.target === e.currentTarget };
        if (pannable) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
        }
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const d = drag.current;
        if (d == null) {
            return;
        }
        if (Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) > DRAG_SLOP_PX) {
            d.moved = true;
        }
        if (pannable && shown != null) {
            setView(panBy(shown, e.clientX - d.last.x, e.clientY - d.last.y, img, stage));
        }
        d.last = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = () => {
        const d = drag.current;
        drag.current = null;
        setDragging(false);
        // the stage around the image is the backdrop as far as the user can see, so a click there closes
        if (d != null && !d.moved && d.onBackdrop) {
            onClose();
        }
    };

    const name = image.alt || image.src.slice(image.src.lastIndexOf("/") + 1);
    return (
        <div className="flex size-full flex-col" data-image-zoom="">
            <div className="flex h-11 flex-none items-center gap-2 border-b border-edge-mid pl-4 pr-2.5">
                <span className="min-w-0 truncate text-[13px] text-foreground">{name}</span>
                {img != null && (
                    <span className="flex-none text-xs text-ink-mid">
                        {img.width} × {img.height}
                    </span>
                )}
                <span className="ml-auto flex-none text-[11.5px] text-ink-mid">
                    scroll or + − zoom · drag pan · 0 fit · esc close
                </span>
                <button
                    type="button"
                    aria-label="Zoom out"
                    onClick={() => zoom(1 / ZOOM_STEP)}
                    className={HEADER_BUTTON}
                >
                    −
                </button>
                <span
                    className="w-11 flex-none text-center font-mono text-xs text-foreground"
                    data-image-zoom-readout=""
                >
                    {shown != null ? `${zoomPercent(shown)}%` : ""}
                </span>
                <button type="button" aria-label="Zoom in" onClick={() => zoom(ZOOM_STEP)} className={HEADER_BUTTON}>
                    +
                </button>
                <button type="button" onClick={() => setView(null)} className={HEADER_BUTTON}>
                    Fit
                </button>
                <button type="button" aria-label="Close" onClick={onClose} className={HEADER_BUTTON}>
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
            </div>
            <div
                ref={stageRef}
                data-image-zoom-stage=""
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                    drag.current = null;
                    setDragging(false);
                }}
                className={cn(
                    "relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-background",
                    pannable && (dragging ? "cursor-grabbing" : "cursor-grab")
                )}
            >
                {failed ? (
                    <div className="flex size-full items-center justify-center text-xs text-ink-mid">
                        Cannot load the image
                    </div>
                ) : (
                    <img
                        src={image.src}
                        alt={image.alt ?? ""}
                        draggable={false}
                        data-image-zoom-img=""
                        onLoad={(e) =>
                            setImg({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
                        }
                        onError={() => setFailed(true)}
                        className={cn("absolute left-0 top-0 max-w-none origin-top-left", shown == null && "invisible")}
                        style={
                            shown == null
                                ? undefined
                                : {
                                      width: img.width,
                                      height: img.height,
                                      transform: `translate(${shown.x}px, ${shown.y}px) scale(${shown.scale})`,
                                      imageRendering: shown.scale >= PIXELATED_FROM_SCALE ? "pixelated" : "auto",
                                  }
                        }
                    />
                )}
            </div>
        </div>
    );
}
