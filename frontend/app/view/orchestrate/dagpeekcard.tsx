// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The selected node's peek: a card floating beside the node inside the graph pane, so opening, growing or
// closing it never resizes the pane under the graph. The task and final-stage bodies fill it.

import { autoUpdate, useFloating } from "@floating-ui/react";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";
import type { GlyphKind } from "./dagcanvas";
import type { Rect } from "./daglayout";
import { StateGlyph } from "./dagnodes";
import { PEEK_PLACEMENT, PEEK_W_PX, peekMiddleware } from "./dagpeek";

export type PeekPlace = {
    anchor: HTMLElement;
    boundary: HTMLElement;
    rightInsetPx: number;
    onClose: () => void;
    onPlaced?: (card: Rect) => void;
};

const BTN = "cursor-pointer rounded-[8px] border px-2.5 py-1 text-[11.5px] font-semibold";
export const PEEK_BTN = `${BTN} border-edge-mid bg-transparent text-secondary hover:border-edge-strong hover:text-primary`;
export const PEEK_BTN_PRIMARY = `${BTN} border-accent bg-accent text-background hover:bg-accenthover`;
export const PEEK_BTN_ACCENT = `${BTN} border-edge-mid bg-transparent text-accent-soft hover:border-edge-strong`;
export const PEEK_BTN_ACCENT_OPEN = `${BTN} border-accent/50 bg-accent/12 text-accent-soft`;

// ReactFlow pans and zooms with a CSS transform, which none of autoUpdate's scroll or resize observers see
function followAnchor(reference: HTMLElement, floating: HTMLElement, update: () => void) {
    return autoUpdate(reference, floating, update, { animationFrame: true });
}

// the graph's pane clears the selection on a click, and a node drag starts on a pointer-down
const keepInside = (e: SyntheticEvent) => e.stopPropagation();

export function DagPeekCard({
    place,
    attrs,
    label,
    closeLabel,
    glyph,
    title,
    meta,
    children,
    panel,
    actions,
    hint,
}: {
    place: PeekPlace;
    attrs: Record<string, string>;
    label: string;
    closeLabel: string;
    glyph: GlyphKind;
    title: ReactNode;
    meta: ReactNode;
    children: ReactNode;
    panel?: ReactNode;
    actions?: ReactNode;
    hint: string;
}) {
    const { refs, elements, floatingStyles, isPositioned, middlewareData } = useFloating({
        open: true,
        elements: { reference: place.anchor },
        placement: PEEK_PLACEMENT,
        strategy: "absolute",
        middleware: peekMiddleware(place.boundary, place.rightInsetPx),
        whileElementsMounted: followAnchor,
    });

    const placedFor = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const card = elements.floating;
        if (!isPositioned || card == null || placedFor.current === place.anchor) return;
        placedFor.current = place.anchor;
        const r = card.getBoundingClientRect();
        const pane = place.boundary.getBoundingClientRect();
        place.onPlaced?.({ x: r.left - pane.left, y: r.top - pane.top, w: r.width, h: r.height });
    }, [isPositioned, place.anchor]);

    const hidden = !isPositioned || middlewareData.hide?.referenceHidden;
    return (
        // floating-ui measures the section, so it renders before it is placed: invisible, and without the data
        // attribute that names it, so nothing finds a card still sitting at 0,0
        <section
            ref={refs.setFloating}
            {...(isPositioned ? attrs : {})}
            aria-label={label}
            onClick={keepInside}
            onPointerDown={keepInside}
            style={{ ...floatingStyles, width: PEEK_W_PX, visibility: hidden ? "hidden" : undefined }}
            className="z-[6] flex flex-col overflow-hidden rounded-[9px] border border-edge-strong bg-surface-raised shadow-popover-lg"
        >
            <div className="flex flex-none items-start gap-[9px] border-b border-edge-mid pb-[9px] pl-3 pr-2 pt-2.5">
                <div className="mt-0.5 flex-none">
                    <StateGlyph kind={glyph} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <div className="text-[13.5px] font-semibold leading-[18px] text-ink-hi">{title}</div>
                    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[10.5px] tabular-nums text-ink-mid">
                        {meta}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={place.onClose}
                    aria-label={closeLabel}
                    className="flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:text-secondary"
                >
                    <X size={13} aria-hidden />
                </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto px-3 pb-3 pt-2.5">{children}</div>
            {panel != null ? <div className="flex flex-none flex-col">{panel}</div> : null}
            <div className="flex flex-none items-center gap-1.5 border-t border-edge-mid bg-surface px-3 py-2">
                {actions}
                <span className="flex-1" />
                <span className="text-[10.5px] text-muted">{hint}</span>
            </div>
        </section>
    );
}
