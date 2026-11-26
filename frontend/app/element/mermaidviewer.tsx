// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A drawn diagram opened full size: a trackpad swipe or a mouse wheel scrolls it (natively, so it stays smooth while the
// page is busy), a drag pans, a pinch or cmd + wheel zooms toward the cursor, a double click or 0 fits it back, + and -
// step the zoom, and Copy image puts the whole diagram on the clipboard. The diagram's own toolbar (Expand, Copy image)
// sits over it in the chat and shows on hover.

import { ModalShell } from "@/app/modals/modalshell";
import { cn } from "@/util/util";
import { Check, Copy, Maximize2, Minus, Plus, Scan, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { COPY_HOLD_MS } from "./copyfeedback";
import { copyDiagramImage } from "./mermaidimage";
import {
    easeScale,
    fitScroll,
    layoutAt,
    resizeScroll,
    STEP,
    wheelAction,
    zoomScroll,
    type ScrollView,
    type Size,
} from "./mermaidzoom";

const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-accent";

type CopyState = "idle" | "busy" | "copied" | "failed";

// Copy image's outcome, held a moment like every copy control; a click while one is pending or showing is ignored
export function useDiagramCopy(): { state: CopyState; copy: (svg: SVGSVGElement | null) => void } {
    const [state, setState] = useState<CopyState>("idle");
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const busy = useRef(false);
    useEffect(() => () => (timer.current != null ? clearTimeout(timer.current) : undefined), []);
    const copy = useCallback((svg: SVGSVGElement | null) => {
        if (busy.current || svg == null) {
            return;
        }
        busy.current = true;
        setState("busy");
        copyDiagramImage(svg)
            .then(
                () => setState("copied"),
                (e) => {
                    console.warn("copy diagram image failed", e);
                    setState("failed");
                }
            )
            .finally(() => {
                timer.current = setTimeout(() => {
                    busy.current = false;
                    setState("idle");
                }, COPY_HOLD_MS);
            });
    }, []);
    return { state, copy };
}

function copyLabel(state: CopyState): string {
    return state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy image";
}

function ToolButton({
    label,
    onClick,
    children,
    tone,
}: {
    label: string;
    onClick: () => void;
    children: ReactNode;
    tone?: "ok" | "bad";
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className={cn(
                "flex size-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-secondary",
                tone === "ok" && "text-success hover:text-success",
                tone === "bad" && "text-error hover:text-error",
                FOCUS_RING
            )}
        >
            {children}
        </button>
    );
}

export function CopyImageButton({ getSvg }: { getSvg: () => SVGSVGElement | null }) {
    const { state, copy } = useDiagramCopy();
    return (
        <ToolButton
            label={copyLabel(state)}
            onClick={() => copy(getSvg())}
            tone={state === "copied" ? "ok" : state === "failed" ? "bad" : undefined}
        >
            {state === "copied" ? (
                <Check size={14} aria-hidden />
            ) : state === "failed" ? (
                <X size={14} aria-hidden />
            ) : (
                <Copy size={14} aria-hidden />
            )}
        </ToolButton>
    );
}

// the toolbar over a diagram in the chat; it shows while the pointer is over the diagram or a button has focus
export function DiagramToolbar({ onExpand, getSvg }: { onExpand: () => void; getSvg: () => SVGSVGElement | null }) {
    return (
        <div
            data-mermaid-toolbar=""
            className="absolute right-[6px] top-[6px] flex gap-[2px] rounded-[8px] border border-edge-mid bg-surface-raised p-[2px] opacity-0 shadow-popover transition-opacity group-hover/diagram:opacity-100 focus-within:opacity-100"
        >
            <ToolButton label="Expand" onClick={onExpand}>
                <Maximize2 size={14} aria-hidden />
            </ToolButton>
            <CopyImageButton getSvg={getSvg} />
        </div>
    );
}

// the diagram's markup with its natural size written in: mermaid draws it `width="100%"` under a max-width, which in the
// viewer's shrink-to-fit stage resolves to the 300 px default. Set in the markup, not on the mounted node, since a
// re-render of the stage puts its markup back.
function sizedSvg(html: string): { html: string; size: Size } {
    const t = document.createElement("template");
    t.innerHTML = html;
    const svg = t.content.querySelector("svg");
    if (svg == null) {
        return { html, size: { w: 0, h: 0 } };
    }
    const vb = (svg.getAttribute("viewBox") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    const size = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? { w: vb[2], h: vb[3] } : { w: 0, h: 0 };
    if (size.w > 0) {
        svg.style.maxWidth = "none";
        svg.style.width = `${size.w}px`;
        svg.style.height = `${size.h}px`;
    }
    return { html: svg.outerHTML, size };
}

function ViewerBody({ html, onClose }: { html: string; onClose: () => void }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const { html: sized, size: natural } = useMemo(() => sizedSvg(html), [html]);
    // the zoom is written straight to the DOM (apply), never through a render, so a pinch or a zoom's ease costs no
    // React work per frame; a trackpad swipe is the box's own scroll and runs no script at all. `scale` is what is
    // drawn, `target` where an eased zoom (a wheel notch, + or -) is going, about the box point `anchor`.
    const scale = useRef(1);
    const target = useRef(1);
    const anchor = useRef({ x: 0, y: 0 });
    const frame = useRef<number | null>(null);
    const lastT = useRef(0);
    const lastBox = useRef<Size>({ w: 0, h: 0 });
    const drag = useRef<{ x: number; y: number } | null>(null);
    const [zoomPct, setZoomPct] = useState(100);

    const boxSize = useCallback((): Size => {
        // client size, not the bounding box: the panel opens on a scale animation, which the bounding box would include
        const el = boxRef.current;
        return el == null ? { w: 0, h: 0 } : { w: el.clientWidth, h: el.clientHeight };
    }, []);
    const current = useCallback((): ScrollView => {
        const el = boxRef.current;
        return { scale: scale.current, left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 };
    }, []);
    // the canvas first, so the scroll it is given is not clamped to the old size
    const apply = useCallback(
        (v: ScrollView) => {
            const box = boxRef.current;
            const canvas = canvasRef.current;
            const stage = stageRef.current;
            if (box == null || canvas == null || stage == null) {
                return;
            }
            const b = boxSize();
            const l = layoutAt(natural, b, v.scale);
            canvas.style.width = `${l.w}px`;
            canvas.style.height = `${l.h}px`;
            stage.style.transform = `translate(${l.x}px, ${l.y}px) scale(${v.scale})`;
            box.scrollLeft = v.left;
            box.scrollTop = v.top;
            box.dataset.scale = String(v.scale);
            scale.current = v.scale;
            lastBox.current = b;
        },
        [natural, boxSize]
    );
    const stopEase = useCallback(() => {
        if (frame.current != null) {
            cancelAnimationFrame(frame.current);
            frame.current = null;
        }
        lastT.current = 0;
    }, []);
    const tick = useCallback(
        (t: number) => {
            const dt = lastT.current === 0 ? 16 : t - lastT.current;
            lastT.current = t;
            const next = easeScale(scale.current, target.current, dt);
            apply(zoomScroll(natural, boxSize(), current(), next, anchor.current.x, anchor.current.y));
            if (next === target.current) {
                frame.current = null;
                lastT.current = 0;
                return;
            }
            frame.current = requestAnimationFrame(tick);
        },
        [apply, boxSize, current, natural]
    );
    // zoom to `next` about the box point (px, py): at once for a pinch, eased for a notch or a button
    const zoomTo = useCallback(
        (next: number, px: number, py: number, instant: boolean) => {
            anchor.current = { x: px, y: py };
            if (instant) {
                stopEase();
                const v = zoomScroll(natural, boxSize(), current(), next, px, py);
                target.current = v.scale;
                apply(v);
            } else {
                target.current = zoomScroll(natural, boxSize(), current(), next, px, py).scale;
                if (frame.current == null) {
                    frame.current = requestAnimationFrame(tick);
                }
            }
            setZoomPct(Math.round(target.current * 100));
        },
        [apply, boxSize, current, natural, stopEase, tick]
    );
    useEffect(() => stopEase, [stopEase]);

    const svgEl = useCallback(() => stageRef.current?.querySelector("svg") ?? null, []);
    const fit = useCallback(() => {
        stopEase();
        const v = fitScroll(natural, boxSize());
        target.current = v.scale;
        apply(v);
        setZoomPct(Math.round(v.scale * 100));
    }, [apply, boxSize, natural, stopEase]);
    const zoomCentre = useCallback(
        (factor: number) => {
            const b = boxSize();
            zoomTo(target.current * factor, b.w / 2, b.h / 2, false);
        },
        [boxSize, zoomTo]
    );

    // fit once the box has its size; the stage's transform scales the svg, drawn at its natural size, so it stays sharp
    useLayoutEffect(() => {
        fit();
    }, [fit]);

    // the window resized: the same point stays at the centre
    useEffect(() => {
        const box = boxRef.current;
        if (box == null) {
            return;
        }
        const ro = new ResizeObserver(() => {
            const from = lastBox.current;
            const to = boxSize();
            if (from.w > 0 && (from.w !== to.w || from.h !== to.h)) {
                apply(resizeScroll(natural, from, to, current()));
            }
        });
        ro.observe(box);
        return () => ro.disconnect();
    }, [apply, boxSize, current, natural]);

    // a plain wheel is left alone, so the box scrolls it natively (WebKit asks the page only about a gesture's first
    // event). A zoom wheel needs a non-passive listener to keep the chat behind from scrolling. A trackpad pinch
    // reaches Chromium as a ctrl wheel, and WebKit (the Mac app) as gesture events, whose scale counts from the
    // pinch's start.
    useEffect(() => {
        const box = boxRef.current;
        if (box == null) {
            return;
        }
        const at = (e: { clientX: number; clientY: number }) => {
            const r = box.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        const onWheel = (e: WheelEvent) => {
            const a = wheelAction(e);
            if (a.kind === "scroll") {
                stopEase();
                return;
            }
            e.preventDefault();
            const p = at(e);
            const from = a.instant ? scale.current : target.current;
            zoomTo(from * a.factor, p.x, p.y, a.instant);
        };
        let pinch = 1;
        const onGestureStart = (e: Event) => {
            e.preventDefault();
            pinch = 1;
        };
        const onGestureChange = (e: Event) => {
            e.preventDefault();
            const g = e as Event & { scale: number; clientX: number; clientY: number };
            if (!(g.scale > 0)) {
                return;
            }
            const p = at(g);
            const factor = g.scale / pinch;
            pinch = g.scale;
            zoomTo(scale.current * factor, p.x, p.y, true);
        };
        box.addEventListener("wheel", onWheel, { passive: false });
        box.addEventListener("gesturestart", onGestureStart);
        box.addEventListener("gesturechange", onGestureChange);
        return () => {
            box.removeEventListener("wheel", onWheel);
            box.removeEventListener("gesturestart", onGestureStart);
            box.removeEventListener("gesturechange", onGestureChange);
        };
    }, [stopEase, zoomTo]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey) {
                return;
            }
            if (e.key === "+" || e.key === "=") {
                zoomCentre(STEP);
            } else if (e.key === "-" || e.key === "_") {
                zoomCentre(1 / STEP);
            } else if (e.key === "0") {
                fit();
            } else {
                return;
            }
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [fit, zoomCentre]);

    return (
        <>
            <div className="flex flex-none items-center gap-[6px] border-b border-edge-mid px-[14px] py-[8px]">
                <span className="min-w-0 flex-1 truncate text-[12px] text-primary">Diagram</span>
                <span className="w-[44px] flex-none text-right text-[11.5px] tabular-nums text-muted">{zoomPct}%</span>
                <ToolButton label="Zoom out (-)" onClick={() => zoomCentre(1 / STEP)}>
                    <Minus size={14} aria-hidden />
                </ToolButton>
                <ToolButton label="Zoom in (+)" onClick={() => zoomCentre(STEP)}>
                    <Plus size={14} aria-hidden />
                </ToolButton>
                <ToolButton label="Fit (0)" onClick={fit}>
                    <Scan size={14} aria-hidden />
                </ToolButton>
                <CopyImageButton getSvg={svgEl} />
                <ToolButton label="Close" onClick={onClose}>
                    <X size={15} aria-hidden />
                </ToolButton>
            </div>
            <div
                ref={boxRef}
                data-mermaid-viewer=""
                className="relative h-[78vh] cursor-grab touch-none overflow-auto overscroll-contain bg-surface-code [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
                onDoubleClick={fit}
                onPointerDown={(e) => {
                    if (e.button !== 0) {
                        return;
                    }
                    stopEase();
                    drag.current = { x: e.clientX, y: e.clientY };
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                    const d = drag.current;
                    if (d == null) {
                        return;
                    }
                    drag.current = { x: e.clientX, y: e.clientY };
                    e.currentTarget.scrollLeft -= e.clientX - d.x;
                    e.currentTarget.scrollTop -= e.clientY - d.y;
                }}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
            >
                <div ref={canvasRef} className="relative">
                    <div
                        ref={stageRef}
                        className="absolute left-0 top-0 origin-top-left select-none"
                        dangerouslySetInnerHTML={{ __html: sized }}
                    />
                </div>
            </div>
        </>
    );
}

// an open ModalShell dialog is a modal to the key dispatcher (modalstack.ts), so its keys don't reach the surface
export function MermaidViewer({ html, open, onClose }: { html: string | null; open: boolean; onClose: () => void }) {
    // portaled: an ancestor with a transform (a chat row's motion) would clip ModalShell's fixed backdrop to it
    return createPortal(
        <ModalShell
            open={open}
            onClose={onClose}
            align="center"
            className="flex max-h-full w-[min(94vw,1400px)] flex-col"
        >
            {html != null ? <ViewerBody html={html} onClose={onClose} /> : null}
        </ModalShell>,
        document.body
    );
}
