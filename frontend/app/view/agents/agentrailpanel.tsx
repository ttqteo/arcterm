// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's tab strip (icons, plus an editor-style tab while a file is open) and the grip that sizes the wide
// tabs. The panel itself is AgentDetailsRail, through CollapsibleRail's tabs/body/width props.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { FileText, LayoutList, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { closeRailFile, railWideDragAtom, railWideWidthAtom, selectRailTab } from "./agentrailstore";
import {
    clampWideWidth,
    fileLabel,
    nextTab,
    RAIL_WIDE_MIN_PX,
    visibleTabs,
    wideWidthMax,
    type PanelState,
    type RailTab,
} from "./agentrailtabs";
import { navRailCollapsed } from "./navrailwidth";

const TAB =
    "flex min-w-[40px] cursor-pointer items-center justify-center gap-[5px] border-0 border-b-2 bg-transparent px-[9px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const TAB_ON = "border-primary text-primary";
const TAB_OFF = "border-transparent text-muted hover:text-secondary";

export function RailTabStrip({ agentId, panel }: { agentId: string; panel: PanelState }) {
    const tabs = visibleTabs(panel);
    const ref = useRef<HTMLDivElement>(null);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const next = nextTab(tabs, panel.tab, e.key);
        selectRailTab(agentId, next);
        requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-rail-tab="${next}"]`)?.focus());
    };
    const tabProps = (tab: RailTab) => ({
        role: "tab" as const,
        "aria-selected": panel.tab === tab,
        tabIndex: panel.tab === tab ? 0 : -1,
        "data-rail-tab": tab,
        onClick: () => selectRailTab(agentId, tab),
    });
    const file = panel.file.current;
    return (
        <div
            ref={ref}
            role="tablist"
            aria-label="Agent panel"
            data-owns-keys
            onKeyDown={onKeyDown}
            className="flex items-stretch"
        >
            <button
                type="button"
                {...tabProps("overview")}
                aria-label="Overview"
                title="Overview"
                className={cn(TAB, panel.tab === "overview" ? TAB_ON : TAB_OFF)}
            >
                <LayoutList size={16} strokeWidth={1.8} aria-hidden />
            </button>
            {file != null ? (
                <div
                    className={cn(
                        "ml-0.5 flex min-w-0 max-w-[190px] items-center border-b-2",
                        panel.tab === "file" ? TAB_ON : TAB_OFF
                    )}
                >
                    <button
                        type="button"
                        {...tabProps("file")}
                        aria-label={`File ${fileLabel(file).name}`}
                        title={file.abs}
                        className="flex min-w-0 cursor-pointer items-center gap-[7px] border-0 bg-transparent py-0 pl-2.5 pr-1 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                        <FileText size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
                        <span className="min-w-0 truncate text-[11.5px]">{fileLabel(file).name}</span>
                    </button>
                    <button
                        type="button"
                        aria-label="Close file"
                        onClick={() => closeRailFile(agentId)}
                        className="mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary"
                    >
                        <X size={12} strokeWidth={2} aria-hidden />
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function useWindowWidth(): number {
    const [w, setW] = useState(() => window.innerWidth);
    useEffect(() => {
        const on = () => setW(window.innerWidth);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    return w;
}

// the wide tabs' width now: the drag in progress, else the stored width, clamped to what the window leaves
export function useWideWidth(): { width: number; max: number } {
    const stored = useAtomValue(railWideWidthAtom);
    const drag = useAtomValue(railWideDragAtom);
    const win = useWindowWidth();
    const max = wideWidthMax(win, navRailCollapsed(win) ? 56 : 78);
    return { width: clampWideWidth(drag ?? stored, max), max };
}

// a separator on the panel's left edge: dragging left widens it; arrows step 16px (64 with Shift)
export function RailResizeGrip({ width, max }: { width: number; max: number }) {
    const drag = useRef<{ id: number; startX: number; start: number } | null>(null);
    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        drag.current = { id: e.pointerId, startX: e.clientX, start: width };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (d == null || d.id !== e.pointerId) {
            return;
        }
        globalStore.set(railWideDragAtom, clampWideWidth(d.start + (d.startX - e.clientX), max));
    };
    const end = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
        const d = drag.current;
        if (d == null || d.id !== e.pointerId) {
            return;
        }
        drag.current = null;
        const live = globalStore.get(railWideDragAtom);
        globalStore.set(railWideDragAtom, null);
        if (commit && live != null) {
            globalStore.set(railWideWidthAtom, live);
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? 64 : 16;
        const next =
            e.key === "ArrowLeft"
                ? width + step
                : e.key === "ArrowRight"
                  ? width - step
                  : e.key === "Home"
                    ? RAIL_WIDE_MIN_PX
                    : e.key === "End"
                      ? max
                      : null;
        if (next == null) {
            return;
        }
        e.preventDefault();
        globalStore.set(railWideWidthAtom, clampWideWidth(next, max));
    };
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            data-owns-keys
            aria-valuemin={RAIL_WIDE_MIN_PX}
            aria-valuemax={max}
            aria-valuenow={Math.round(width)}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => end(e, true)}
            onPointerCancel={(e) => end(e, false)}
            onLostPointerCapture={(e) => end(e, false)}
            onKeyDown={onKeyDown}
            className="group absolute inset-y-0 left-0 z-10 flex w-2 cursor-col-resize justify-start outline-none"
        >
            <span className="h-full w-px bg-transparent group-hover:bg-accent group-focus-visible:bg-accent" />
        </div>
    );
}
