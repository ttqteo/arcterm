// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A drawn diagram opened full size: the wheel zooms toward the cursor, a drag pans, a double click or 0 fits it back,
// + and - step the zoom, and Copy image puts the whole diagram on the clipboard. The diagram's own toolbar (Expand,
// Copy image) sits over it in the chat and shows on hover.

import { ModalShell } from "@/app/modals/modalshell";
import { cn } from "@/util/util";
import { Check, Copy, Maximize2, Minus, Plus, Scan, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { COPY_HOLD_MS } from "./copyfeedback";
import { copyDiagramImage } from "./mermaidimage";
import { easeToward, fitView, panBy, STEP, wheelZoomFactor, zoomAt, type Size, type ZoomView } from "./mermaidzoom";

const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-accent";
// how long the stage keeps its GPU layer after the last zoom or pan
const SETTLE_MS = 180;

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
    const stageRef = useRef<HTMLDivElement>(null);
    const { html: sized, size: natural } = useMemo(() => sizedSvg(html), [html]);
    // `view` is what is drawn; it eases toward `target`, which every zoom, pan and fit writes (setView). A drag sets
    // both at once, so the diagram stays under the pointer.
    const [view, setShown] = useState<ZoomView>({ scale: 1, x: 0, y: 0 });
    const shown = useRef(view);
    const target = useRef(view);
    const frame = useRef<number | null>(null);
    const lastT = useRef(0);
    // the stage sits on its own GPU layer while it moves, so a zoom scales the layer instead of repainting the svg at
    // every step; dropped once it rests, so the diagram is repainted sharp at its new scale
    const [moving, setMoving] = useState(false);
    const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
    const drag = useRef<{ x: number; y: number } | null>(null);

    const show = useCallback((v: ZoomView) => {
        shown.current = v;
        setShown(v);
    }, []);
    const markMoving = useCallback(() => {
        setMoving(true);
        if (settle.current != null) {
            clearTimeout(settle.current);
        }
        settle.current = setTimeout(() => setMoving(false), SETTLE_MS);
    }, []);
    const tick = useCallback(
        (t: number) => {
            const dt = lastT.current === 0 ? 16 : t - lastT.current;
            lastT.current = t;
            const next = easeToward(shown.current, target.current, dt);
            show(next);
            if (next === target.current) {
                frame.current = null;
                lastT.current = 0;
                return;
            }
            frame.current = requestAnimationFrame(tick);
        },
        [show]
    );
    const setView = useCallback(
        (next: ZoomView | ((v: ZoomView) => ZoomView), instant = false) => {
            target.current = typeof next === "function" ? next(target.current) : next;
            markMoving();
            if (instant) {
                if (frame.current != null) {
                    cancelAnimationFrame(frame.current);
                    frame.current = null;
                    lastT.current = 0;
                }
                show(target.current);
                return;
            }
            if (frame.current == null) {
                frame.current = requestAnimationFrame(tick);
            }
        },
        [markMoving, show, tick]
    );
    useEffect(
        () => () => {
            if (frame.current != null) {
                cancelAnimationFrame(frame.current);
            }
            if (settle.current != null) {
                clearTimeout(settle.current);
            }
        },
        []
    );

    const svgEl = useCallback(() => stageRef.current?.querySelector("svg") ?? null, []);
    const boxSize = useCallback((): Size => {
        // client size, not the bounding box: the panel opens on a scale animation, which the bounding box would include
        const el = boxRef.current;
        return el == null ? { w: 0, h: 0 } : { w: el.clientWidth, h: el.clientHeight };
    }, []);
    const fit = useCallback(() => setView(fitView(natural, boxSize())), [natural, boxSize, setView]);
    const zoomCentre = useCallback(
        (factor: number) => {
            const b = boxSize();
            setView((v) => zoomAt(v, factor, b.w / 2, b.h / 2));
        },
        [boxSize, setView]
    );

    // fit once the box has its size; the stage's transform scales the svg, drawn at its natural size, so it stays sharp
    useLayoutEffect(() => {
        setView(fitView(natural, boxSize()), true);
    }, [natural, boxSize, setView]);

    // the wheel has to be a non-passive listener to keep the chat behind from scrolling. A trackpad pinch reaches
    // Chromium as a ctrl wheel, and WebKit (the Mac app) as gesture events, whose scale counts from the pinch's start.
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
            e.preventDefault();
            const p = at(e);
            setView((v) => zoomAt(v, wheelZoomFactor(e), p.x, p.y));
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
            setView((v) => zoomAt(v, factor, p.x, p.y), true);
        };
        box.addEventListener("wheel", onWheel, { passive: false });
        box.addEventListener("gesturestart", onGestureStart);
        box.addEventListener("gesturechange", onGestureChange);
        return () => {
            box.removeEventListener("wheel", onWheel);
            box.removeEventListener("gesturestart", onGestureStart);
            box.removeEventListener("gesturechange", onGestureChange);
        };
    }, [setView]);

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

    const zoomPct = Math.round(target.current.scale * 100);

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
                className="relative h-[78vh] cursor-grab touch-none overflow-hidden bg-surface-code active:cursor-grabbing"
                onDoubleClick={fit}
                onPointerDown={(e) => {
                    if (e.button !== 0) {
                        return;
                    }
                    drag.current = { x: e.clientX, y: e.clientY };
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                    const d = drag.current;
                    if (d == null) {
                        return;
                    }
                    drag.current = { x: e.clientX, y: e.clientY };
                    setView((v) => panBy(v, e.clientX - d.x, e.clientY - d.y), true);
                }}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
            >
                <div
                    ref={stageRef}
                    className="absolute left-0 top-0 origin-top-left select-none"
                    style={{
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                        willChange: moving ? "transform" : undefined,
                    }}
                    dangerouslySetInnerHTML={{ __html: sized }}
                />
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
