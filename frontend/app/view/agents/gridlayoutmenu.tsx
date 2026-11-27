// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The agent header's layout button and its snap menu, as Windows shows one on the maximize button: resting the pointer
// on the button opens a panel of thumbnails (gridlayouts.ts), each zone a target. A click on a zone puts the focused
// cell there and the other cells fill the rest; the zones are labelled with where each cell would land. Layouts that do
// not fit the split's cell count are dimmed. The button's own press is the caller's (Focus board on a board split);
// with none it opens the menu.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placementStyle, type GridState } from "./agentgrid";
import { gridLayoutMenuOpenAtom } from "./gridlayoutmenuatom";
import { GRID_LAYOUTS, isLayout, layoutFits, zoneCells, type GridLayout, type GridLayoutId } from "./gridlayouts";
import { applyGridLayout } from "./gridlayoutstore";
import type { GridSizes } from "./gridsplit";
import type { GridModel } from "./gridstore";

// the pointer rests this long on the button before the menu opens, and may leave both for this long before it closes
const OPEN_DELAY_MS = 280;
const CLOSE_DELAY_MS = 180;

interface Props {
    model: GridModel;
    grid: GridState; // the split on screen, pruned to its live cells
    sizes: GridSizes;
    nameOf: (id: string) => string;
    onPress?: () => void; // the button's click; the menu opens on a click when left out
    pressed?: boolean;
    boardFocus?: "on" | "off"; // data-board-focus, which the CDP scenarios read, on a board split
    title: string;
    ariaLabel: string;
    className: string;
    children: ReactNode; // the icon
}

export function GridLayoutButton({
    model,
    grid,
    sizes,
    nameOf,
    onPress,
    pressed,
    boardFocus,
    title,
    ariaLabel,
    className,
    children,
}: Props) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
    const btn = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clear = () => {
        if (timer.current != null) {
            clearTimeout(timer.current);
            timer.current = null;
        }
    };
    // `keyboard`: opened from the keyboard, so the focus goes to the first zone it can pick (a hover leaves it where it is)
    const show = (keyboard = false) => {
        clear();
        const r = btn.current?.getBoundingClientRect();
        if (r == null) {
            return;
        }
        setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
        setOpen(true);
        if (keyboard) {
            requestAnimationFrame(() =>
                menu.current?.querySelector<HTMLElement>("button[data-grid-layout-zone]")?.focus()
            );
        }
    };
    const later = (fn: () => void, ms: number) => {
        clear();
        timer.current = setTimeout(fn, ms);
    };
    const hide = () => {
        clear();
        setOpen(false);
    };
    useEffect(() => clear, []);
    // the dispatcher reads the menu as a modal while it is open (gridLayoutMenuOpenAtom)
    useEffect(() => {
        globalStore.set(gridLayoutMenuOpenAtom, open);
        return () => {
            if (open) {
                globalStore.set(gridLayoutMenuOpenAtom, false);
            }
        };
    }, [open]);

    // Escape closes the menu and nothing else (the surface's own Escape would leave the Agent surface); a resize would
    // leave the panel off its button
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopImmediatePropagation();
                // the focus goes back to the button only from inside the menu: a hover opened it with the focus in a
                // terminal or the chat box, which keeps it
                const inside = menu.current?.contains(document.activeElement) ?? false;
                hide();
                if (inside) {
                    btn.current?.focus();
                }
            }
        };
        const onResize = () => hide();
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("resize", onResize);
        };
    }, [open]);

    const pick = (id: GridLayoutId, zone: number) => {
        applyGridLayout(model, id, zone);
        hide();
    };

    return (
        <>
            <button
                ref={btn}
                type="button"
                data-grid-layout-button
                data-board-focus={boardFocus}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-pressed={pressed}
                aria-label={ariaLabel}
                title={title}
                onPointerEnter={() => (open ? clear() : later(show, OPEN_DELAY_MS))}
                onPointerLeave={() => later(hide, open ? CLOSE_DELAY_MS : 0)}
                onClick={(e) => {
                    if (onPress != null) {
                        hide();
                        onPress();
                    } else if (open) {
                        hide();
                    } else {
                        // a click from Enter or Space has no pointer (detail 0): the keyboard's open
                        show(e.detail === 0);
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === "ArrowDown" && !open) {
                        e.preventDefault();
                        show(true);
                    }
                }}
                className={className}
            >
                {children}
            </button>
            {createPortal(
                <PopoverReveal
                    open={open && pos != null}
                    origin="top right"
                    style={pos ?? undefined}
                    className="fixed z-[1000] rounded-[12px] border border-edge-mid frost p-2 shadow-popover"
                >
                    <div
                        role="menu"
                        aria-label="Layouts"
                        data-grid-layout-menu
                        ref={menu}
                        // Tab out of the menu closes it, as a pointer leaving does
                        onBlur={(e) => {
                            const to = e.relatedTarget as Node | null;
                            if (to == null || !e.currentTarget.contains(to)) {
                                hide();
                            }
                        }}
                        onPointerEnter={clear}
                        onPointerLeave={() => later(hide, CLOSE_DELAY_MS)}
                        className="grid grid-cols-3 gap-2"
                    >
                        {GRID_LAYOUTS.map((layout) => (
                            <LayoutThumb
                                key={layout.id}
                                layout={layout}
                                grid={grid}
                                sizes={sizes}
                                nameOf={nameOf}
                                onPick={pick}
                            />
                        ))}
                    </div>
                </PopoverReveal>,
                document.body
            )}
        </>
    );
}

function LayoutThumb({
    layout,
    grid,
    sizes,
    nameOf,
    onPick,
}: {
    layout: GridLayout;
    grid: GridState;
    sizes: GridSizes;
    nameOf: (id: string) => string;
    onPick: (id: GridLayoutId, zone: number) => void;
}) {
    const [hot, setHot] = useState<number | null>(null);
    const fits = layoutFits(layout, grid.ids.length);
    const current = fits && isLayout(grid, sizes, layout);
    // the zones' labels: who lands where for the zone under the pointer, else for the focused cell's own place
    const rest = Math.max(0, grid.focused != null ? grid.ids.indexOf(grid.focused) : 0);
    const names = fits ? zoneCells(grid, layout, Math.min(hot ?? rest, layout.places.length - 1)) : [];
    const col = layout.sizes.col ?? 0.5;
    const row = layout.sizes.row ?? 0.5;
    return (
        <div
            data-grid-layout={layout.id}
            data-current={current ? "" : undefined}
            title={
                fits
                    ? layout.label.replace("Layout: ", "")
                    : `${layout.label.replace("Layout: ", "")} (for ${layout.places.length} cells)`
            }
            onPointerLeave={() => setHot(null)}
            className={cn(
                "grid h-[64px] w-[108px] gap-[3px] rounded-[8px] border p-[4px]",
                current ? "border-accent/60" : "border-edge-mid",
                !fits && "opacity-40"
            )}
            style={{
                gridTemplateColumns: `${col * 10}fr ${(1 - col) * 10}fr`,
                gridTemplateRows: `${row * 10}fr ${(1 - row) * 10}fr`,
            }}
        >
            {layout.places.map((p, i) => {
                const style = placementStyle(p);
                const zoneClass = cn(
                    "flex min-w-0 items-center justify-center overflow-hidden rounded-[4px] border px-[3px] text-[10px] leading-tight transition-colors duration-100",
                    hot === i
                        ? "border-accent bg-accent/30 text-primary"
                        : "border-edge-mid bg-surface-hover text-muted"
                );
                const label = names[i] != null ? nameOf(names[i]) : "";
                if (!fits) {
                    return <div key={i} style={style} className={zoneClass} aria-hidden />;
                }
                return (
                    <button
                        key={i}
                        type="button"
                        role="menuitem"
                        data-grid-layout-zone={i}
                        aria-label={`${layout.label}, ${nameOf(grid.focused ?? "")} in zone ${i + 1}`}
                        onPointerEnter={() => setHot(i)}
                        onFocus={() => setHot(i)}
                        onBlur={() => setHot(null)}
                        onClick={() => onPick(layout.id, i)}
                        title={label || undefined}
                        style={style}
                        className={cn(zoneClass, "cursor-pointer")}
                    >
                        <span className="min-w-0 truncate">{label}</span>
                    </button>
                );
            })}
        </div>
    );
}
