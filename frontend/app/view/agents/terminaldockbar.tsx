// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The bar over the terminal docked under the agent stack (terminaldock.ts): the terminal's name and project, a button
// that gives it a cell in the split ("Open in split"), one that folds the panel to a strip, one that maximizes it over
// the agents and back (a double-click on the bar does the same), and an x that closes the dock (the shell keeps
// running). Its top edge is the separator that resizes the dock: drag it, or use the arrows (16px, 64 with Shift); a
// double-click on the edge puts the default height back. The height is bounded by clampDockHeight, so the agent above
// always keeps the larger part. Maximized, there is no edge to drag.
// Folded, the dock is TerminalDockStrip: 32 px with the terminal's name, a dot while a command runs, the latest line it
// printed, the chord that opens it and an expand button; a click anywhere on it opens the panel.

import { globalStore } from "@/app/store/jotaiStore";
import { latestTerminalLine } from "@/app/view/term/termwrap";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { ChevronDown, ChevronUp, Columns2, Maximize2, Minimize2, SquareTerminal, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import { terminalDockDragAtom, terminalDockHeightAtom } from "./railstore";
import { clampDockHeight, DOCK_DEFAULT_PX, DOCK_MIN_PX } from "./terminaldock";

// the strip's size: the folded panel's whole height
export const DOCK_STRIP_PX = 32;

const BUTTON =
    "flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function DockResizeGrip({ height, available }: { height: number; available: number }) {
    const drag = useRef<{ id: number; startY: number; start: number } | null>(null);
    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        drag.current = { id: e.pointerId, startY: e.clientY, start: height };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (d == null || d.id !== e.pointerId) {
            return;
        }
        // dragging up grows the dock
        globalStore.set(terminalDockDragAtom, clampDockHeight(d.start + (d.startY - e.clientY), available));
    };
    const end = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
        const d = drag.current;
        if (d == null || d.id !== e.pointerId) {
            return;
        }
        drag.current = null;
        const live = globalStore.get(terminalDockDragAtom);
        globalStore.set(terminalDockDragAtom, null);
        if (commit && live != null) {
            globalStore.set(terminalDockHeightAtom, live);
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? 64 : 16;
        const next =
            e.key === "ArrowUp"
                ? height + step
                : e.key === "ArrowDown"
                  ? height - step
                  : e.key === "Home"
                    ? DOCK_MIN_PX
                    : e.key === "End"
                      ? Infinity
                      : null;
        if (next == null) {
            return;
        }
        e.preventDefault();
        globalStore.set(terminalDockHeightAtom, clampDockHeight(next === Infinity ? available : next, available));
    };
    return (
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize terminal"
            data-owns-keys
            data-terminal-dock-grip
            aria-valuemin={DOCK_MIN_PX}
            aria-valuenow={height}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => end(e, true)}
            onPointerCancel={(e) => end(e, false)}
            onLostPointerCapture={(e) => end(e, false)}
            onDoubleClick={() => globalStore.set(terminalDockHeightAtom, DOCK_DEFAULT_PX)}
            onKeyDown={onKeyDown}
            className="group absolute inset-x-0 top-0 z-10 flex h-[6px] cursor-row-resize items-start outline-none"
        >
            <span className="h-px w-full bg-transparent group-hover:bg-accent group-focus-visible:bg-accent" />
        </div>
    );
}

export function TerminalDockBar({
    terminal,
    height,
    available,
    maximized,
    onToggleMax,
    onClose,
    onFold,
    onOpenSplit,
}: {
    terminal: AgentVM;
    height: number;
    available: number;
    maximized: boolean;
    onToggleMax: () => void;
    onClose: () => void;
    onFold: () => void;
    onOpenSplit: () => void;
}) {
    const project = projectOf(terminal);
    // the bar's own double-click, not one on its buttons or on the edge (which resets the height)
    const onDoubleClick = (e: React.MouseEvent) => {
        if (e.target instanceof Element && e.target.closest("button, [data-terminal-dock-grip]") != null) {
            return;
        }
        onToggleMax();
    };
    return (
        <div
            data-terminal-dock-bar={terminal.id}
            data-terminal-dock-max={maximized ? "true" : undefined}
            onDoubleClick={onDoubleClick}
            className="relative flex h-[26px] shrink-0 select-none items-center gap-[7px] border-b border-border bg-surface px-[8px] text-muted"
        >
            {maximized ? null : <DockResizeGrip height={height} available={available} />}
            <SquareTerminal size={12} aria-hidden className="shrink-0" />
            <span title={terminal.name} className="min-w-0 truncate text-[12px] font-medium text-primary">
                {terminal.name}
            </span>
            {project ? <span className="min-w-0 shrink truncate text-[11px] text-muted">{project}</span> : null}
            <button
                type="button"
                data-dock-open-split
                aria-label={`Open ${terminal.name} in the split`}
                title="Open in split: the terminal gets a cell beside the agent"
                onClick={onOpenSplit}
                className={cn(BUTTON, "ml-auto")}
            >
                <Columns2 size={12} aria-hidden />
            </button>
            <button
                type="button"
                data-dock-fold
                aria-label="Fold the terminal panel"
                title={`Fold the panel to a strip (${formatChordString("Mod:`")})`}
                onClick={onFold}
                className={BUTTON}
            >
                <ChevronDown size={12} aria-hidden />
            </button>
            <button
                type="button"
                data-terminal-dock-max-toggle
                aria-label={maximized ? "Restore the terminal panel" : "Maximize the terminal panel"}
                aria-pressed={maximized}
                title={
                    maximized ? "Restore: show the agent above again" : "Maximize: the terminal takes the whole area"
                }
                onClick={onToggleMax}
                className={BUTTON}
            >
                {maximized ? <Minimize2 size={12} aria-hidden /> : <Maximize2 size={12} aria-hidden />}
            </button>
            <button
                type="button"
                data-terminal-dock-close
                aria-label={`Close the ${terminal.name} panel`}
                title="Hide the terminal panel (the shell keeps running)"
                onClick={onClose}
                className={BUTTON}
            >
                <X size={12} aria-hidden />
            </button>
        </div>
    );
}

// The latest line the block's terminal printed, read from its mounted xterm a couple of times a second while the strip
// shows (the pane stays mounted, hidden, under it).
function useLatestOutputLine(blockId: string | undefined): string | undefined {
    const [line, setLine] = useState<string | undefined>(undefined);
    useEffect(() => {
        if (blockId == null) {
            setLine(undefined);
            return;
        }
        const read = () => setLine(latestTerminalLine(blockId));
        read();
        const timer = setInterval(read, 500);
        return () => clearInterval(timer);
    }, [blockId]);
    return line;
}

export function TerminalDockStrip({ terminal, onOpen }: { terminal: AgentVM; onOpen: () => void }) {
    const line = useLatestOutputLine(terminal.blockId);
    const chord = formatChordString("Mod:`");
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onOpen();
        }
    };
    return (
        <div
            role="button"
            tabIndex={0}
            data-dock-strip={terminal.id}
            aria-label={`Terminal panel, folded: ${terminal.name}. Open the panel`}
            title={`Open the panel (${chord})`}
            onClick={onOpen}
            onKeyDown={onKeyDown}
            style={{ height: DOCK_STRIP_PX }}
            className="flex shrink-0 cursor-pointer select-none items-center gap-[8px] rounded-[8px] border border-edge-mid bg-surface pl-[12px] pr-[8px] outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        >
            <SquareTerminal size={13} aria-hidden className="shrink-0 text-muted" />
            <span className="shrink-0 text-[12.5px] font-semibold text-secondary">{terminal.name}</span>
            {terminal.running ? (
                <span
                    aria-label="Running a command"
                    data-dock-strip-running
                    className="h-[6px] w-[6px] shrink-0 rounded-full bg-success"
                />
            ) : null}
            <span data-dock-strip-line className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">
                {line ?? ""}
            </span>
            <span className="shrink-0 rounded-[5px] border border-edge-mid px-[6px] py-px font-mono text-[10.5px] text-muted">
                {chord}
            </span>
            <button
                type="button"
                data-dock-expand
                aria-label="Open the terminal panel"
                title="Open the panel"
                onClick={(e) => {
                    e.stopPropagation();
                    onOpen();
                }}
                className={BUTTON}
            >
                <ChevronUp size={14} aria-hidden />
            </button>
        </div>
    );
}
