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
import { fitView, panBy, STEP, wheelFactor, zoomAt, type Size, type ZoomView } from "./mermaidzoom";

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
    const stageRef = useRef<HTMLDivElement>(null);
    const { html: sized, size: natural } = useMemo(() => sizedSvg(html), [html]);
    const [view, setView] = useState<ZoomView>({ scale: 1, x: 0, y: 0 });
    const drag = useRef<{ x: number; y: number } | null>(null);

    const svgEl = useCallback(() => stageRef.current?.querySelector("svg") ?? null, []);
    const boxSize = useCallback((): Size => {
        // client size, not the bounding box: the panel opens on a scale animation, which the bounding box would include
        const el = boxRef.current;
        return el == null ? { w: 0, h: 0 } : { w: el.clientWidth, h: el.clientHeight };
    }, []);
    const fit = useCallback(() => setView(fitView(natural, boxSize())), [natural, boxSize]);
    const zoomCentre = useCallback(
        (factor: number) => {
            const b = boxSize();
            setView((v) => zoomAt(v, factor, b.w / 2, b.h / 2));
        },
        [boxSize]
    );

    // fit once the box has its size; the stage's transform scales the svg, drawn at its natural size, so it stays sharp
    useLayoutEffect(() => {
        setView(fitView(natural, boxSize()));
    }, [natural, boxSize]);

    // the wheel has to be a non-passive listener to keep the chat behind from scrolling
    useEffect(() => {
        const box = boxRef.current;
        if (box == null) {
            return;
        }
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const r = box.getBoundingClientRect();
            setView((v) => zoomAt(v, wheelFactor(e.deltaY), e.clientX - r.left, e.clientY - r.top));
        };
        box.addEventListener("wheel", onWheel, { passive: false });
        return () => box.removeEventListener("wheel", onWheel);
    }, []);

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
                <span className="w-[44px] flex-none text-right text-[11.5px] tabular-nums text-muted">
                    {Math.round(view.scale * 100)}%
                </span>
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
                    setView((v) => panBy(v, e.clientX - d.x, e.clientY - d.y));
                }}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
            >
                <div
                    ref={stageRef}
                    className="absolute left-0 top-0 origin-top-left select-none"
                    style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
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
