// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's tab strip (icons, plus an editor-style tab per open file), the counts beside it, and the
// grip that sizes the wide tabs. The panel itself is AgentDetailsRail, through CollapsibleRail's tabs/body/width props.

import { MOTION } from "@/app/element/motiontokens";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { pathMenuItems } from "@/app/view/code/pathmenu";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    FileDiff,
    FileText,
    FolderTree,
    FoldVertical,
    GitBranch,
    LayoutList,
    LayoutTemplate,
    MessagesSquare,
    Monitor,
    Paperclip,
    ScrollText,
    Server,
    SquareTerminal,
    X,
    type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { railStatAction, type AgentRailStat, type AgentRailStatId } from "./agentrailsections";
import { closeRailFile, closeRailSummary, railWideDragAtom, railWidthAtoms, selectRailKey } from "./agentrailstore";
import {
    activeFile,
    clampWideWidth,
    fileKey,
    fileRel,
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
import { railCouncilTab } from "./railcouncil";
import { verifyStripIcon, verifyStripTone } from "./railverify";
import { agentTreeWidth } from "./rowfields";
import { rowFieldsAtom } from "./rowfieldsstore";

// the tabs are pills in the strip's 44px band: the one on show filled, the rest bare until hovered
const TAB =
    "flex h-[28px] min-w-[32px] shrink-0 cursor-pointer items-center justify-center gap-[5px] rounded-full border-0 bg-transparent px-[8px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const TAB_ON = "bg-surface-selected text-primary";
const TAB_OFF = "text-muted hover:bg-surface-hover hover:text-secondary";

interface TabProps {
    role: "tab";
    "aria-selected": boolean;
    tabIndex: number;
    "data-rail-tab": RailTab;
    "data-rail-key": string;
    onClick: () => void;
}

export function RailTabStrip({
    agentId,
    panel,
    hasTree,
    hasTranscript,
    council,
}: {
    agentId: string;
    panel: PanelState;
    hasTree: boolean;
    hasTranscript: boolean;
    council: Council | null; // the council the agent started: the Council tab's, none without one
}) {
    const hasCouncil = council != null;
    const keys = stripKeys(panel, hasTree, hasTranscript, hasCouncil);
    const shown = shownTab(panel, hasTree, hasTranscript, hasCouncil);
    const current = shownKey(panel, hasTree, hasTranscript, hasCouncil);
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
        selectRailKey(agentId, next, hasTree, hasTranscript, hasCouncil);
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
        onClick: () => selectRailKey(agentId, key, hasTree, hasTranscript, hasCouncil),
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
                "flex items-center gap-[2px]",
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
            <button
                type="button"
                {...tabProps("changes")}
                aria-label="Changes"
                title="Changes"
                className={cn(TAB, current === "changes" ? TAB_ON : TAB_OFF)}
            >
                <FileDiff size={16} strokeWidth={1.8} aria-hidden />
            </button>
            {hasTranscript ? (
                <button
                    type="button"
                    {...tabProps("transcript")}
                    aria-label="Transcript"
                    title="Transcript"
                    className={cn(TAB, current === "transcript" ? TAB_ON : TAB_OFF)}
                >
                    <ScrollText size={16} strokeWidth={1.8} aria-hidden />
                </button>
            ) : null}
            {council != null ? (
                <RailCouncilTab
                    key={council.id}
                    council={council}
                    on={current === "council"}
                    tabProps={tabProps("council")}
                />
            ) : null}
            {panel.summary ? (
                <RailSummaryTab agentId={agentId} on={current === "summary"} tabProps={tabProps("summary")} />
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

const COUNCIL_DOT = { working: "bg-working", asking: "bg-asking", error: "bg-error" } as const;

// The Council tab (canvas rail-council-chat, board B): there while the agent has started a council, its body the
// council's chat. Its dot is the tone of the council's row in the tree, and `c` selects it (agent:council-chat). It fades
// in as the council appears.
function RailCouncilTab({ council, on, tabProps }: { council: Council; on: boolean; tabProps: TabProps }) {
    const { dot, title } = railCouncilTab(council);
    return (
        <motion.button
            type="button"
            {...tabProps}
            aria-label={`Council: ${title}`}
            aria-keyshortcuts="c"
            title={`Council: ${title}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
            className={cn(TAB, "relative", on ? TAB_ON : TAB_OFF)}
        >
            <MessagesSquare size={16} strokeWidth={1.8} aria-hidden />
            {dot != null ? (
                <span
                    aria-hidden
                    className={cn(
                        "absolute left-[19px] top-[4px] h-[7px] w-[7px] rounded-full ring-2",
                        on ? "ring-surface-selected" : "ring-surface",
                        COUNCIL_DOT[dot]
                    )}
                />
            ) : null}
        </motion.button>
    );
}

// The Summary tab: the summary the agent's last compaction kept, opened from Overview's Compacted line. Its x, or a
// middle click, closes it.
function RailSummaryTab({ agentId, on, tabProps }: { agentId: string; on: boolean; tabProps: TabProps }) {
    return (
        <div
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    closeRailSummary(agentId);
                }
            }}
            className={cn("flex h-[28px] shrink-0 items-center rounded-full", on ? TAB_ON : TAB_OFF)}
        >
            <button
                type="button"
                {...tabProps}
                aria-label="Compaction summary"
                title="Compaction summary: what the last compaction kept"
                className="flex cursor-pointer items-center border-0 bg-transparent py-0 pl-2 pr-1 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
                <FoldVertical size={16} strokeWidth={1.8} aria-hidden />
            </button>
            <button
                type="button"
                aria-label="Close compaction summary"
                data-rail-summary-close
                onClick={() => closeRailSummary(agentId)}
                className="mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-pill hover:text-primary"
            >
                <X size={12} strokeWidth={2} aria-hidden />
            </button>
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
            // the folded tab that stands for several files has no one path to copy
            onContextMenu={
                folded == null || folded === 1
                    ? (e) => ContextMenuModel.getInstance().showContextMenu(pathMenuItems(file.abs, fileRel(file)), e)
                    : undefined
            }
            className={cn(
                "ml-0.5 flex h-[28px] min-w-0 items-center rounded-full",
                folded == null && "max-w-[200px]",
                on ? TAB_ON : TAB_OFF
            )}
        >
            <button
                type="button"
                {...tabProps}
                aria-label={`File ${label}`}
                title={folded != null && folded > 1 ? `${folded} files open` : file.abs}
                // folded, it sits on Overview's 300px beside the counts, so it is drawn tighter
                className={cn(
                    "flex min-w-0 cursor-pointer items-center border-0 bg-transparent py-0 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    folded == null ? "gap-[7px] pl-2.5" : "gap-[4px] pl-2",
                    closable ? "pr-1" : "pr-2"
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
                    className="mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-pill hover:text-primary"
                >
                    <X size={12} strokeWidth={2} aria-hidden />
                </button>
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
    verify: Monitor, // the strip's own figures (the stat's `verify`) pick the glyph
};

const STAT_LABEL: Record<AgentRailStatId, string> = {
    subagents: "Subagents",
    files: "Files changed",
    artifacts: "Artifacts",
    uploads: "Uploads",
    servers: "Servers",
    bgtasks: "Background tasks",
    verify: "Verify",
};

function statTitle(s: AgentRailStat, canAttach: boolean, verifyTitle?: string): string {
    const label = STAT_LABEL[s.id];
    // Verify's count is a tone and a figure, not a number of rows: its title says what the tile's head says
    if (s.id === "verify") {
        return verifyTitle ?? label;
    }
    switch (railStatAction(s)) {
        case "attach":
            return canAttach ? "Attach files: insert their paths at this agent's prompt" : "No uploads";
        case "open":
            return s.count == null ? label : `${label}: ${s.count}`;
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
    verifyTitle,
    canAttach,
    hold,
    onOpen,
    onAttach,
}: {
    stats: AgentRailStat[];
    verifyTitle?: string; // the Verify count's title: "Verify: 1 failed · 1 no result"
    canAttach: boolean;
    hold?: boolean;
    onOpen: (id: AgentRailStatId) => void;
    onAttach: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    // when the panel is too narrow for every count, the group scrolls sideways: the mouse wheel moves it (the scrollbar
    // is hidden), and a fade on the edge that hides some says there is more
    const [fade, setFade] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
    useEffect(() => {
        const el = ref.current;
        if (el == null) {
            return;
        }
        const measure = () => {
            const left = el.scrollLeft > 0;
            const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
            setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
        };
        const onWheel = (e: WheelEvent) => {
            if (el.scrollWidth <= el.clientWidth || e.deltaX !== 0) {
                return;
            }
            e.preventDefault();
            el.scrollLeft += e.deltaY;
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        el.addEventListener("scroll", measure, { passive: true });
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            ro.disconnect();
            el.removeEventListener("scroll", measure);
            el.removeEventListener("wheel", onWheel);
        };
    }, [stats.length]);
    if (stats.length === 0) {
        return null;
    }
    const mask =
        fade.left || fade.right
            ? `linear-gradient(to right, ${fade.left ? "transparent, black 14px" : "black"}, ${fade.right ? "black calc(100% - 14px), transparent" : "black"})`
            : undefined;
    return (
        <div
            ref={ref}
            role="group"
            aria-label="Agent counts"
            data-owns-keys
            style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
            className={cn(
                "ml-[8px] flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                hold && "shrink-0"
            )}
        >
            <span aria-hidden className="mr-[4px] h-[18px] w-px shrink-0 bg-edge-strong" />
            {stats.map((s) => {
                const action = railStatAction(s);
                const live = action === "open" || (action === "attach" && canAttach);
                const verify = s.verify;
                const Icon = verify ? verifyStripIcon(verify) : STAT_ICON[s.id];
                const title = statTitle(s, canAttach, verifyTitle);
                return (
                    <button
                        key={s.id}
                        type="button"
                        data-rail-stat={s.id}
                        data-rail-count={verify ? "verify" : undefined}
                        data-count={verify ? verify.label : (s.count ?? "")}
                        data-verify-tone={verify?.tone}
                        data-verify-pulsing={verify ? String(verify.pulsing) : undefined}
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
                                ? "cursor-pointer text-muted hover:bg-surface-hover hover:text-primary"
                                : live
                                  ? "cursor-pointer text-ink-faint hover:bg-surface-hover hover:text-secondary"
                                  : "cursor-default text-ink-faint",
                            // red or amber read at a glance, over the strip's muted default; a pulsing one is running
                            verify && verifyStripTone(verify)
                        )}
                    >
                        <Icon
                            size={13}
                            strokeWidth={1.8}
                            aria-hidden
                            className={verify?.pulsing ? "text-success pulse-dot-slow" : undefined}
                        />
                        {verify ? (
                            verify.label !== "" ? (
                                <span>{verify.label}</span>
                            ) : null
                        ) : s.count ? (
                            <span>{s.count}</span>
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
    const treeWidth = agentTreeWidth(useAtomValue(rowFieldsAtom));
    const max = wideWidthMax(win, navRailCollapsed(win) ? 56 : 78, treeWidth);
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
