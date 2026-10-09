// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's tab strip (icons, plus an editor-style tab while a file is open), the counts beside it, and the
// grip that sizes the wide tabs. The panel itself is AgentDetailsRail, through CollapsibleRail's tabs/body/width props.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    FileDiff,
    FileText,
    FolderTree,
    GitBranch,
    LayoutList,
    LayoutTemplate,
    Paperclip,
    Server,
    SquareTerminal,
    X,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { railStatAction, type AgentRailStat, type AgentRailStatId } from "./agentrailsections";
import { closeRailFile, railWideDragAtom, railWidthAtoms, selectRailTab } from "./agentrailstore";
import {
    clampWideWidth,
    fileTabLabel,
    nextTab,
    RAIL_WIDTHS,
    shownTab,
    visibleTabs,
    wideWidthMax,
    type PanelState,
    type RailTab,
    type ResizableTab,
} from "./agentrailtabs";
import { navRailCollapsed } from "./navrailwidth";

const TAB =
    "flex min-w-[40px] cursor-pointer items-center justify-center gap-[5px] border-0 border-b-2 bg-transparent px-[9px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const TAB_ON = "border-primary text-primary";
const TAB_OFF = "border-transparent text-muted hover:text-secondary";

export function RailTabStrip({ agentId, panel, hasTree }: { agentId: string; panel: PanelState; hasTree: boolean }) {
    const tabs = visibleTabs(panel, hasTree);
    const shown = shownTab(panel, hasTree);
    const ref = useRef<HTMLDivElement>(null);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const next = nextTab(tabs, shown, e.key);
        selectRailTab(agentId, next, hasTree);
        requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-rail-tab="${next}"]`)?.focus());
    };
    const tabProps = (tab: RailTab) => ({
        role: "tab" as const,
        "aria-selected": shown === tab,
        tabIndex: shown === tab ? 0 : -1,
        "data-rail-tab": tab,
        onClick: () => selectRailTab(agentId, tab, hasTree),
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
                className={cn(TAB, shown === "overview" ? TAB_ON : TAB_OFF)}
            >
                <LayoutList size={16} strokeWidth={1.8} aria-hidden />
            </button>
            {hasTree ? (
                <button
                    type="button"
                    {...tabProps("tree")}
                    aria-label="Files"
                    title="Files"
                    className={cn(TAB, shown === "tree" ? TAB_ON : TAB_OFF)}
                >
                    <FolderTree size={16} strokeWidth={1.8} aria-hidden />
                </button>
            ) : null}
            {file != null ? (
                <div
                    className={cn(
                        "ml-0.5 flex min-w-0 max-w-[190px] items-center border-b-2",
                        shown === "file" ? TAB_ON : TAB_OFF
                    )}
                >
                    <button
                        type="button"
                        {...tabProps("file")}
                        aria-label={`File ${fileTabLabel(file)}`}
                        title={file.abs}
                        className="flex min-w-0 cursor-pointer items-center gap-[7px] border-0 bg-transparent py-0 pl-2.5 pr-1 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                        <FileText size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
                        {/* on Overview's 300px the tab is its icon, so the counts beside it keep their room */}
                        <span className={cn("min-w-0 truncate text-[11.5px]", shown !== "file" && "hidden")}>
                            {fileTabLabel(file)}
                        </span>
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

const STAT_ICON: Record<AgentRailStatId, LucideIcon> = {
    subagents: GitBranch,
    files: FileDiff,
    artifacts: LayoutTemplate,
    uploads: Paperclip,
    servers: Server,
    bgtasks: SquareTerminal,
};

const STAT_LABEL: Record<AgentRailStatId, string> = {
    subagents: "Subagents",
    files: "Files changed",
    artifacts: "Artifacts",
    uploads: "Uploads",
    servers: "Servers",
    bgtasks: "Background tasks",
};

function statTitle(s: AgentRailStat, canAttach: boolean): string {
    const label = STAT_LABEL[s.id];
    switch (railStatAction(s)) {
        case "attach":
            return canAttach ? "Attach files: insert their paths at this agent's prompt" : "No uploads";
        case "open":
            return s.count == null ? label : `${label}: ${s.count}`;
        default:
            return `No ${label.toLowerCase()}`;
    }
}

// RailStats counts the agent's lists after the tabs, one icon each in a fixed order, only those a click acts on: a count
// opens its section; an empty Uploads attaches (inert, with aria-disabled, where there is no terminal to attach to; not
// disabled: a disabled button shows no tooltip). An empty list has no icon.
export function RailStats({
    stats,
    canAttach,
    onOpen,
    onAttach,
}: {
    stats: AgentRailStat[];
    canAttach: boolean;
    onOpen: (id: AgentRailStatId) => void;
    onAttach: () => void;
}) {
    if (stats.length === 0) {
        return null;
    }
    return (
        <div
            role="group"
            aria-label="Agent counts"
            data-owns-keys
            className="ml-1 flex min-w-0 items-center overflow-hidden"
        >
            {stats.map((s) => {
                const action = railStatAction(s);
                const live = action === "open" || (action === "attach" && canAttach);
                const Icon = STAT_ICON[s.id];
                const title = statTitle(s, canAttach);
                return (
                    <button
                        key={s.id}
                        type="button"
                        data-rail-stat={s.id}
                        data-count={s.count ?? ""}
                        aria-disabled={!live}
                        aria-label={title}
                        title={title}
                        onClick={() => {
                            if (action === "open") {
                                onOpen(s.id);
                            } else if (action === "attach" && canAttach) {
                                onAttach();
                            }
                        }}
                        className={cn(
                            "flex h-[26px] shrink-0 items-center gap-[3px] rounded-[6px] px-[5px] text-[11px] font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                            action === "open"
                                ? "cursor-pointer text-secondary hover:bg-surface-hover hover:text-primary"
                                : live
                                  ? "cursor-pointer text-ink-faint hover:bg-surface-hover hover:text-secondary"
                                  : "cursor-default text-ink-faint"
                        )}
                    >
                        <Icon size={13} strokeWidth={1.8} aria-hidden />
                        {s.count ? <span>{s.count}</span> : null}
                    </button>
                );
            })}
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

// a resizable tab's width now: the drag in progress, else its stored width, clamped to what the window leaves
export function useWideWidth(tab: ResizableTab): { width: number; max: number } {
    const stored = useAtomValue(railWidthAtoms[tab]);
    const drag = useAtomValue(railWideDragAtom);
    const win = useWindowWidth();
    const max = wideWidthMax(win, navRailCollapsed(win) ? 56 : 78);
    return { width: clampWideWidth(drag ?? stored, max, tab), max };
}

// a separator on the panel's left edge: dragging left widens it; arrows step 16px (64 with Shift)
export function RailResizeGrip({ tab, width, max }: { tab: ResizableTab; width: number; max: number }) {
    const min = RAIL_WIDTHS[tab].min;
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
        globalStore.set(railWideDragAtom, clampWideWidth(d.start + (d.startX - e.clientX), max, tab));
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
            globalStore.set(railWidthAtoms[tab], live);
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
                    ? min
                    : e.key === "End"
                      ? max
                      : null;
        if (next == null) {
            return;
        }
        e.preventDefault();
        globalStore.set(railWidthAtoms[tab], clampWideWidth(next, max, tab));
    };
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            data-owns-keys
            aria-valuemin={min}
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
