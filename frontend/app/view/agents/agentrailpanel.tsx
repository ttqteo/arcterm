// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's tab strip (icons, plus an editor-style tab per open file), the counts beside it, and the
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
    Lightbulb,
    Paperclip,
    Server,
    SquareTerminal,
    X,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { railStatAction, type AgentRailStat, type AgentRailStatId } from "./agentrailsections";
import { closeRailFile, railWideDragAtom, railWidthAtoms, selectRailKey } from "./agentrailstore";
import {
    activeFile,
    clampWideWidth,
    fileKey,
    fileTabLabel,
    nextTab,
    RAIL_WIDTHS,
    shownKey,
    shownTab,
    stripKeys,
    wideWidthMax,
    type FileRef,
    type PanelState,
    type RailTab,
    type ResizableTab,
} from "./agentrailtabs";
import { navRailCollapsed } from "./navrailwidth";

const TAB =
    "flex min-w-[40px] cursor-pointer items-center justify-center gap-[5px] border-0 border-b-2 bg-transparent px-[9px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const TAB_ON = "border-primary text-primary";
const TAB_OFF = "border-transparent text-muted hover:text-secondary";

interface TabProps {
    role: "tab";
    "aria-selected": boolean;
    tabIndex: number;
    "data-rail-tab": RailTab;
    "data-rail-key": string;
    onClick: () => void;
}

export function RailTabStrip({ agentId, panel, hasTree }: { agentId: string; panel: PanelState; hasTree: boolean }) {
    const keys = stripKeys(panel, hasTree);
    const shown = shownTab(panel, hasTree);
    const current = shownKey(panel, hasTree);
    const ref = useRef<HTMLDivElement>(null);
    // The file on show stays in sight when more tabs are open than the strip has room for. Only the strip scrolls:
    // scrollIntoView would also scroll the panel's clipping boxes while it slides open.
    useEffect(() => {
        const strip = ref.current;
        const button = strip?.querySelector<HTMLElement>(`[data-rail-key="${current}"]`);
        if (strip == null || button == null) {
            return;
        }
        const tab = (button.parentElement === strip ? button : button.parentElement)!.getBoundingClientRect();
        const box = strip.getBoundingClientRect();
        if (tab.left < box.left) {
            strip.scrollLeft -= box.left - tab.left;
        } else if (tab.right > box.right) {
            strip.scrollLeft += tab.right - box.right;
        }
    }, [current, panel.files.length]);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const next = nextTab(keys, current, e.key);
        selectRailKey(agentId, next, hasTree);
        requestAnimationFrame(() =>
            ref.current?.querySelector<HTMLElement>(`[data-rail-key="${next}"]`)?.focus({ preventScroll: true })
        );
    };
    const tabProps = (tab: RailTab, key: string = tab): TabProps => ({
        role: "tab",
        "aria-selected": current === key,
        tabIndex: current === key ? 0 : -1,
        "data-rail-tab": tab,
        "data-rail-key": key,
        onClick: () => selectRailKey(agentId, key, hasTree),
    });
    const active = activeFile(panel);
    // on File every open file is a tab; elsewhere they fold into the one on show, with how many are open
    const fileTabs = active == null ? [] : shown === "file" ? panel.files : [active];
    return (
        <div
            ref={ref}
            role="tablist"
            aria-label="Agent panel"
            data-owns-keys
            onKeyDown={onKeyDown}
            // on File the file tabs are as wide as their names, and the strip gives way only when the panel runs out of
            // room (RailStats holds its width there), cutting the names rather than the counts, then scrolling
            className={cn(
                "flex items-stretch",
                shown === "file" && "min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            )}
        >
            <button
                type="button"
                {...tabProps("overview")}
                aria-label="Overview"
                title="Overview"
                className={cn(TAB, current === "overview" ? TAB_ON : TAB_OFF)}
            >
                <LayoutList size={16} strokeWidth={1.8} aria-hidden />
            </button>
            {hasTree ? (
                <button
                    type="button"
                    {...tabProps("tree")}
                    aria-label="Files"
                    title="Files"
                    className={cn(TAB, current === "tree" ? TAB_ON : TAB_OFF)}
                >
                    <FolderTree size={16} strokeWidth={1.8} aria-hidden />
                </button>
            ) : null}
            {fileTabs.map((f) =>
                f.current == null ? null : (
                    <RailFileTab
                        key={f.id}
                        agentId={agentId}
                        id={f.id}
                        file={f.current}
                        on={current === fileKey(f.id)}
                        folded={shown === "file" ? null : panel.files.length}
                        tabProps={tabProps("file", fileKey(f.id))}
                    />
                )
            )}
        </div>
    );
}

// One open file's tab, or with `folded` (how many are open) the one that stands for them all off File: its icon, the
// count when there are more, and a close button only when it is the one file.
function RailFileTab({
    agentId,
    id,
    file,
    on,
    folded,
    tabProps,
}: {
    agentId: string;
    id: number;
    file: FileRef;
    on: boolean;
    folded: number | null;
    tabProps: TabProps;
}) {
    const label = fileTabLabel(file);
    const closable = folded == null || folded === 1;
    return (
        // a middle click closes it, as an editor's tab; the mousedown keeps Windows' autoscroll from starting
        <div
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => {
                if (e.button === 1 && closable) {
                    e.preventDefault();
                    closeRailFile(agentId, id);
                }
            }}
            className={cn(
                "ml-0.5 flex min-w-0 items-center border-b-2",
                folded == null && "max-w-[200px]",
                on ? TAB_ON : TAB_OFF
            )}
        >
            <button
                type="button"
                {...tabProps}
                aria-label={`File ${label}`}
                title={folded != null && folded > 1 ? `${folded} files open` : file.abs}
                className={cn(
                    "flex min-w-0 cursor-pointer items-center gap-[7px] border-0 bg-transparent py-0 pl-2.5 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    closable ? "pr-1" : "pr-2.5"
                )}
            >
                <FileText size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
                {/* on Overview's 300px the tab is its icon (and count), so the counts beside it keep their room */}
                {folded == null ? (
                    <span className="min-w-0 truncate text-[11.5px]">{label}</span>
                ) : folded > 1 ? (
                    <span className="text-[11px] font-medium tabular-nums">{folded}</span>
                ) : null}
            </button>
            {closable ? (
                <button
                    type="button"
                    aria-label={`Close ${label}`}
                    data-rail-file-close={label}
                    onClick={() => closeRailFile(agentId, id)}
                    className="mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary"
                >
                    <X size={12} strokeWidth={2} aria-hidden />
                </button>
            ) : null}
        </div>
    );
}

const STAT_ICON: Record<AgentRailStatId, LucideIcon> = {
    ideas: Lightbulb,
    subagents: GitBranch,
    files: FileDiff,
    artifacts: LayoutTemplate,
    uploads: Paperclip,
    servers: Server,
    bgtasks: SquareTerminal,
};

const STAT_LABEL: Record<AgentRailStatId, string> = {
    ideas: "Ideas",
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
        case "open": {
            const counted = s.count == null ? label : `${label}: ${s.count}`;
            return s.fresh && s.newCount ? `${counted}, ${s.newCount} new` : counted;
        }
        default:
            return `No ${label.toLowerCase()}`;
    }
}

// RailStats counts the agent's lists after the tabs, past a short rule and a step dimmer than the tabs, so the tabs read
// as the panel's views and the counts as what it holds; one icon each in a fixed order, only those a click acts on: a count
// opens its section, or closes it when it is open on screen (railStatClick); an empty Uploads attaches (inert, with aria-disabled, where there is no terminal to attach to; not
// disabled: a disabled button shows no tooltip). An empty list has no icon.
// `hold`: on File, where the file tab's name gives way first (RailTabStrip), the counts keep their width.
export function RailStats({
    stats,
    canAttach,
    hold,
    onOpen,
    onAttach,
}: {
    stats: AgentRailStat[];
    canAttach: boolean;
    hold?: boolean;
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
            className={cn("ml-[8px] flex min-w-0 items-center overflow-hidden", hold && "shrink-0")}
        >
            <span aria-hidden className="mr-[4px] h-[18px] w-px shrink-0 bg-edge-strong" />
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
                            "relative flex h-[26px] shrink-0 items-center gap-[3px] rounded-[6px] px-[5px] text-[11px] font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                            action === "open"
                                ? "cursor-pointer text-muted hover:bg-surface-hover hover:text-primary"
                                : live
                                  ? "cursor-pointer text-ink-faint hover:bg-surface-hover hover:text-secondary"
                                  : "cursor-default text-ink-faint"
                        )}
                    >
                        <Icon size={13} strokeWidth={1.8} aria-hidden />
                        {s.count ? <span>{s.count}</span> : null}
                        {s.fresh ? (
                            // some of the list is new since the user last looked: a dot on the icon, ringed in the
                            // strip's own colour so it reads against the count beside it
                            <span
                                data-rail-stat-dot
                                aria-hidden
                                className="absolute left-[12px] top-[3px] box-content h-[6px] w-[6px] rounded-full border-[1.5px] border-surface bg-primary"
                            />
                        ) : null}
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
