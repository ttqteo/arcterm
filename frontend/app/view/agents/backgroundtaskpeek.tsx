// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A background task's events and output in a floating peek beside its Agent tree row (or above its row in the chat box's
// background list, chatbgline.tsx): a Monitor has an Events tab (what
// it has reported) and an Output tab, a background shell only its output. A running task's output is re-read on a timer
// and followed at the tail; an ended one is read once. A running task of a live agent has a Stop in the header.
// It opens at a set size (long lines wrap) and its right edge, bottom edge and corner drag it larger; it keeps that size.
// The task is open while monitorPeekAtom names it (subagentsstore.ts); Esc and a press outside clear it. The root
// is data-owns-keys, so while focus is in the peek the Agent surface's Escape (agent:back) stands down and Esc closes
// only the peek. The task's words (state, footer, kind) are monitortasks.ts; this file is the view.

import { viewFade } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { isWindows } from "@/util/platformutil";
import { cn, fireAndForget } from "@/util/util";
import {
    autoUpdate,
    FloatingPortal,
    offset,
    shift,
    size,
    useDismiss,
    useFloating,
    useInteractions,
    type Placement,
} from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { Radio, Terminal, X } from "lucide-react";
import { motion, MotionConfig } from "motion/react";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type PointerEvent,
    type ReactNode,
    type RefObject,
} from "react";
import { bgSessionLive, bgTaskStoppable } from "./agentrailsections";
import type { AgentsViewModel } from "./agents";
import { parseAnsiLines, runCss } from "./ansitext";
import {
    backgroundTaskKind,
    backgroundTaskState,
    clampPeekSize,
    clockTime,
    monitorEventsFooter,
    monitorExpiresAt,
    OUTPUT_MAX_CHARS,
    parsePeekSize,
    PEEK_DEFAULT_BODY_PX,
    PEEK_DEFAULT_SIZE,
    PEEK_MIN_WIDTH_PX,
    type BackgroundTaskState,
    type PeekSize,
} from "./monitortasks";
import { ServerStopButton } from "./railservers";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import {
    backgroundTasksByIdAtom,
    monitorPeekAtom,
    readBackgroundTaskOutput,
    stopBackgroundTask,
} from "./subagentsstore";
import type { BackgroundTask, MonitorEvent } from "./transcriptprojection";

const OUTPUT_POLL_MS = 2000;
// from a tree row's right edge past the tree's own 8px padding, so the peek sits 8px beside the tree
const PEEK_GAP_PX = 16;
const NO_LINES: string[] = [];
const NO_EVENTS: MonitorEvent[] = [];
type PeekView = "events" | "output";

const STATE_TONE: Record<BackgroundTaskState, string> = {
    watching: "text-accent",
    running: "text-accent",
    completed: "text-success",
    failed: "text-error",
    stopped: "text-muted",
};

const close = () => globalStore.set(monitorPeekAtom, null);

// the size the peek keeps between opens, per viewer: a convenience, so storage that fails leaves the default
const SIZE_KEY = "bgtaskpeek.size";
// what a peek of a dragged height leaves the window besides its body: header, command, tabs, footer and a margin
const PEEK_CHROME_PX = 160;

function readStoredSize(): PeekSize {
    try {
        return parsePeekSize(localStorage.getItem(SIZE_KEY));
    } catch {
        return PEEK_DEFAULT_SIZE;
    }
}

function storeSize(size: PeekSize) {
    try {
        localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    } catch {
        // per-viewer convenience only
    }
}

type ResizeAxis = "x" | "y" | "xy";
type ResizeDrag = {
    id: number;
    axis: ResizeAxis;
    x: number;
    y: number;
    width: number;
    body: number;
    maxWidth: number;
    maxBody: number;
};

// The peek's size and the handlers its edges drag it with: the right edge widens it, the bottom edge makes its body
// taller, the corner both. It grows right and down from where it hangs; a double click on an edge puts the default back.
function usePeekResize(root: RefObject<HTMLDivElement | null>) {
    const [size, setSize] = useState(readStoredSize);
    const drag = useRef<ResizeDrag | null>(null);
    const live = useRef(size);
    const set = (next: PeekSize) => {
        live.current = next;
        setSize(next);
    };
    const gripProps = (axis: ResizeAxis) => ({
        onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
            const el = root.current;
            if (el == null || e.button !== 0) {
                return;
            }
            const rect = el.getBoundingClientRect();
            const bodyPx = el.querySelector<HTMLElement>("[data-peek-body]")?.offsetHeight ?? PEEK_DEFAULT_BODY_PX;
            drag.current = {
                id: e.pointerId,
                axis,
                x: e.clientX,
                y: e.clientY,
                width: rect.width,
                body: bodyPx,
                maxWidth: window.innerWidth - rect.left - 8,
                maxBody: window.innerHeight - 16 - (rect.height - bodyPx),
            };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
            e.stopPropagation();
        },
        onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
            const d = drag.current;
            if (d == null || d.id !== e.pointerId) {
                return;
            }
            const next: PeekSize = {
                width: d.axis === "y" ? live.current.width : d.width + (e.clientX - d.x),
                body: d.axis === "x" ? live.current.body : d.body + (e.clientY - d.y),
            };
            set(clampPeekSize(next, d.maxWidth, d.maxBody));
        },
        onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
            if (drag.current?.id === e.pointerId) {
                drag.current = null;
                storeSize(live.current);
            }
        },
        onLostPointerCapture: (e: PointerEvent<HTMLDivElement>) => {
            if (drag.current?.id === e.pointerId) {
                drag.current = null;
                storeSize(live.current);
            }
        },
        onDoubleClick: () => {
            set(PEEK_DEFAULT_SIZE);
            storeSize(PEEK_DEFAULT_SIZE);
        },
    });
    // a size kept from a larger window still fits this one (the width is also capped by the root's max-width)
    const shown = clampPeekSize(size, window.innerWidth, window.innerHeight - PEEK_CHROME_PX);
    return { size: shown, gripProps };
}

const GRIP_CLASS: Record<ResizeAxis, string> = {
    x: "inset-y-0 right-0 w-[4px] cursor-ew-resize",
    y: "inset-x-0 bottom-0 h-[4px] cursor-ns-resize",
    xy: "bottom-0 right-0 h-[12px] w-[12px] cursor-nwse-resize",
};

// an edge or the corner the peek is dragged by; it lights the edge on hover, as the rail's resize grip does
function ResizeGrip({
    axis,
    props,
}: {
    axis: ResizeAxis;
    props: ReturnType<ReturnType<typeof usePeekResize>["gripProps"]>;
}) {
    return (
        <div
            aria-hidden
            data-testid={`background-task-peek-resize-${axis}`}
            title="Drag to resize · double-click for the default size"
            {...props}
            className={cn(
                "absolute z-10 transition-colors duration-150",
                axis === "xy" ? "" : "hover:bg-accent",
                GRIP_CLASS[axis]
            )}
        />
    );
}

function sameLines(a: string[] | null, b: string[]): boolean {
    return a != null && a.length === b.length && a.every((line, i) => line === b[i]);
}

// a running task's output is still growing, so it is re-read on a timer; an ended one once. null until the first read
function useTaskOutput(path: string | undefined, running: boolean): string[] | null {
    const [lines, setLines] = useState<string[] | null>(null);
    useEffect(() => {
        if (!path) {
            setLines(NO_LINES);
            return;
        }
        let mounted = true;
        // the same text keeps the same array, so the follow-the-tail effect does not run for nothing
        const read = () =>
            void readBackgroundTaskOutput(path).then(
                (l) => mounted && setLines((cur) => (sameLines(cur, l) ? cur : l))
            );
        read();
        const timer = running ? setInterval(read, OUTPUT_POLL_MS) : null;
        return () => {
            mounted = false;
            if (timer != null) {
                clearInterval(timer);
            }
        };
    }, [path, running]);
    return lines;
}

// what an inverse run swaps in for an unset side: this view's own text and background
const INVERSE_FG = "var(--color-secondary)";
const INVERSE_BG = "var(--color-surface-code)";

// output lines with the program's ANSI colors drawn (vite, go test, cargo all color theirs), not their raw escapes
function AnsiLines({ lines }: { lines: string[] }) {
    const parsed = useMemo(() => parseAnsiLines(lines), [lines]);
    return parsed.map((runs, i) => (
        <div key={i} className="whitespace-pre-wrap break-words text-secondary">
            {runs.map((r, j) => (
                <span key={j} style={runCss(r.style, INVERSE_FG, INVERSE_BG)}>
                    {r.text}
                </span>
            ))}
        </div>
    ));
}

// The body's height: null fits its lines up to the default, a number is the height a drag gave it. A body marks its
// scroller with data-peek-body, which a drag measures to start from.
const PeekBodyContext = createContext<number | null>(null);

// a scroller's style; an empty body (no lines yet) takes only a dragged height, so it does not stand 360px tall
function useBodyStyle(): { scroll: CSSProperties; empty: CSSProperties | undefined } {
    const bodyPx = useContext(PeekBodyContext);
    return bodyPx != null
        ? { scroll: { height: bodyPx }, empty: { height: bodyPx } }
        : { scroll: { maxHeight: PEEK_DEFAULT_BODY_PX }, empty: undefined };
}

function OutputBody({ path, running }: { path: string | undefined; running: boolean }) {
    const lines = useTaskOutput(path, running);
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(lines ?? NO_LINES);
    const bodyStyle = useBodyStyle();
    return (
        <div data-testid="background-task-peek-output" className="relative border-t border-edge-mid bg-surface-code">
            <div
                ref={scrollRef}
                onScroll={onScroll}
                data-peek-body
                style={bodyStyle.scroll}
                className="overflow-auto p-[10px] font-mono text-[11.5px] leading-[1.5]"
            >
                {lines != null && lines.length === 0 ? (
                    <div data-testid="background-task-peek-output-empty" className="text-muted">
                        No output yet.
                    </div>
                ) : (
                    <AnsiLines lines={lines ?? NO_LINES} />
                )}
            </div>
            <JumpToLatestPill show={!atBottom} onClick={jumpToBottom} />
        </div>
    );
}

function EventsBody({ events }: { events: MonitorEvent[] }) {
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(events);
    const bodyStyle = useBodyStyle();
    return (
        <>
            <div
                data-testid="background-task-peek-events"
                className="relative border-t border-edge-mid bg-surface-code"
            >
                {events.length === 0 ? (
                    <div
                        data-testid="background-task-peek-events-empty"
                        data-peek-body
                        style={bodyStyle.empty}
                        className="p-[10px] font-mono text-[11.5px] leading-[1.5] text-muted"
                    >
                        No events yet.
                    </div>
                ) : (
                    <div
                        ref={scrollRef}
                        onScroll={onScroll}
                        data-peek-body
                        style={bodyStyle.scroll}
                        className="overflow-auto px-[10px] py-[4px] font-mono text-[11.5px] leading-[1.5]"
                    >
                        {events.map((e, i) => (
                            <div
                                key={i}
                                data-testid="background-task-peek-event"
                                className={cn("flex gap-[10px] py-[6px]", i > 0 && "border-t border-edge-faint")}
                            >
                                <span className="w-[62px] flex-none pt-[1px] text-[10.5px] text-muted">
                                    {e.ts != null ? clockTime(e.ts) : ""}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <AnsiLines lines={e.lines} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <JumpToLatestPill show={!atBottom} onClick={jumpToBottom} />
            </div>
        </>
    );
}

function PeekFooter({
    left,
    leftTitle,
    children,
}: {
    left: string | undefined;
    leftTitle?: string;
    children?: ReactNode;
}) {
    return (
        <div
            data-testid="background-task-peek-footer"
            className="flex items-center gap-[8px] border-t border-edge-mid px-[10px] py-[6px] text-[10.5px] text-muted"
        >
            <span className="min-w-0 flex-1 truncate" title={leftTitle}>
                {left}
            </span>
            {children}
        </div>
    );
}

function PeekTab({
    label,
    view,
    active,
    onSelect,
}: {
    label: string;
    view: PeekView;
    active: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            role="tab"
            data-testid={`background-task-peek-tab-${view}`}
            aria-selected={active}
            onClick={onSelect}
            className={cn(
                "h-[20px] cursor-pointer rounded-[4px] px-[8px] text-[10.5px] font-semibold",
                active ? "bg-accentbg text-accent-soft" : "text-secondary hover:text-primary"
            )}
        >
            {label}
        </button>
    );
}

function OutputFooter({ path, running }: { path: string | undefined; running: boolean }) {
    return (
        <PeekFooter left={path?.split(/[\\/]/).pop() ?? "no output file"} leftTitle={path}>
            <span className="flex-none">{`last ${OUTPUT_MAX_CHARS / 1024} KB${running ? " · live" : ""}`}</span>
        </PeekFooter>
    );
}

function MonitorBody({ task, now }: { task: BackgroundTask; now: number }) {
    const [view, setView] = useState<PeekView>("events");
    const events = task.events ?? NO_EVENTS;
    const running = task.status === "running";
    const footer = monitorEventsFooter(task, now);
    const expiresAt = running ? monitorExpiresAt(task) : null;
    return (
        <>
            <div className="px-[10px] pb-[8px]">
                <div
                    role="tablist"
                    aria-label="Monitor view"
                    className="inline-flex gap-[2px] rounded-[6px] border border-edge-mid bg-surface p-[2px]"
                >
                    <PeekTab
                        label={`Events ${events.length}`}
                        view="events"
                        active={view === "events"}
                        onSelect={() => setView("events")}
                    />
                    <PeekTab
                        label="Output"
                        view="output"
                        active={view === "output"}
                        onSelect={() => setView("output")}
                    />
                </div>
            </div>
            <MotionConfig reducedMotion="user">
                <motion.div key={view} variants={viewFade} initial="initial" animate="animate">
                    {view === "events" ? (
                        <>
                            <EventsBody events={events} />
                            <PeekFooter left={footer.left}>
                                {footer.right != null ? (
                                    <span
                                        title={expiresAt != null ? `expires ${clockTime(expiresAt)}` : undefined}
                                        className="flex-none"
                                    >
                                        {footer.right}
                                    </span>
                                ) : null}
                            </PeekFooter>
                        </>
                    ) : (
                        <>
                            <OutputBody path={task.outputFile} running={running} />
                            <OutputFooter path={task.outputFile} running={running} />
                        </>
                    )}
                </motion.div>
            </MotionConfig>
        </>
    );
}

export function BackgroundTaskPeek({
    model,
    agentId,
    task,
    anchor,
    placement = "right-start",
    gap = PEEK_GAP_PX,
}: {
    model: AgentsViewModel;
    agentId: string;
    task: BackgroundTask;
    anchor: HTMLElement;
    /** where it opens from its anchor: beside the tree row (the default), or above the chat box's row ("top-start") */
    placement?: Placement;
    /** the space between the anchor and the peek */
    gap?: number;
}) {
    const now = useAtomValue(model.nowAtom);
    // the task a row hands over is a snapshot: the list holds how it is now (stopped, ended, new events), and an ended
    // task stays in it, so a peek on a task that ends keeps working and says how it ended
    const current = useAtomValue(backgroundTasksByIdAtom)[agentId]?.find((t) => t.toolUseId === task.toolUseId) ?? task;
    const agent = useAtomValue(model.agentsAtom).find((a) => a.id === agentId);
    const blockId = agent?.blockId;
    const monitor = backgroundTaskKind(current) === "monitor";
    const state = backgroundTaskState(current);
    const Mark = monitor ? Radio : Terminal;
    // as the details rail does: the kill finds the task among the agent block's processes, which is Windows only, and
    // only while the session is live (an agent gone from the roster has ended)
    const stoppable = isWindows() && bgTaskStoppable(current, bgSessionLive(blockId, agent == null));

    const { refs, floatingStyles, context } = useFloating({
        open: true,
        onOpenChange: (open) => !open && close(),
        elements: { reference: anchor },
        placement,
        strategy: "fixed",
        middleware: [
            offset(gap),
            shift({ padding: 8 }),
            // as wide as it was dragged, up to the screen's edge; a window too narrow for even the least width keeps
            // that and lets shift slide it over the tree
            size({
                padding: 8,
                apply({ availableWidth, elements }) {
                    elements.floating.style.maxWidth = `${Math.max(availableWidth, PEEK_MIN_WIDTH_PX)}px`;
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });
    const rootRef = useRef<HTMLDivElement | null>(null);
    const { size: peekSize, gripProps } = usePeekResize(rootRef);
    // the anchor row counts as inside, so pressing it again toggles the peek instead of closing and reopening it.
    // Esc is the root's own (below): left on, it would also reach agent:back
    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: false })]);

    // Focus is the peek's own, so the Agent surface's Escape stands down (data-owns-keys) and Esc closes only this.
    // Taken as the root attaches: FloatingPortal mounts its children a render after this component, and the ref's
    // identity is stable, so it runs once.
    const setRoot = useCallback(
        (el: HTMLDivElement | null) => {
            refs.setFloating(el);
            rootRef.current = el;
            if (el != null && !el.contains(document.activeElement)) {
                el.focus({ preventScroll: true });
            }
        },
        [refs]
    );

    // the Agent surface stays mounted off-screen, and the portal would keep the peek over the next surface
    const surface = useAtomValue(model.surfaceAtom);
    useEffect(() => {
        if (surface !== "agent") {
            close();
        }
    }, [surface]);

    // the row it hangs from left the tree (a stopped task is no longer listed there): nothing left to point at
    useEffect(() => {
        if (!anchor.isConnected) {
            close();
        }
    });

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "Escape") {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        close();
        if (anchor.isConnected) {
            anchor.focus({ preventScroll: true });
        }
    };

    const stop = async () => {
        if (blockId == null) {
            return;
        }
        await stopBackgroundTask(agentId, blockId, current);
        // a task that did stop has no row to hang from; one that did not (already gone, refused, failed) stays open
        // beside the toast that says why
        const after = globalStore.get(backgroundTasksByIdAtom)[agentId]?.find((t) => t.toolUseId === current.toolUseId);
        if (after != null && after.status !== "running") {
            close();
        }
    };

    return (
        <FloatingPortal>
            <div
                ref={setRoot}
                style={{ ...floatingStyles, width: peekSize.width }}
                {...getFloatingProps()}
                role="dialog"
                aria-label={`${monitor ? "Monitor" : "Background shell"} ${current.label}`}
                tabIndex={-1}
                data-owns-keys
                data-testid="background-task-peek"
                data-task-kind={monitor ? "monitor" : "shell"}
                data-task-state={state}
                onKeyDown={onKeyDown}
                className="z-[60] overflow-hidden rounded-[9px] border border-edge-strong bg-surface-raised shadow-popover-lg focus:outline-none"
            >
                <div className="flex items-center gap-[8px] px-[10px] py-[8px]">
                    <Mark size={12} aria-hidden className="flex-none text-accent" />
                    <span
                        data-testid="background-task-peek-title"
                        title={current.label}
                        className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-secondary"
                    >
                        {current.label}
                    </span>
                    <span
                        data-testid="background-task-peek-state"
                        className={cn("flex-none text-[10.5px] font-semibold", STATE_TONE[state])}
                    >
                        {state}
                    </span>
                    {stoppable ? (
                        <span data-testid="background-task-peek-stop" className="flex-none">
                            <ServerStopButton confirmLabel="Stop" onStop={() => fireAndForget(stop)} />
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={close}
                        data-testid="background-task-peek-close"
                        aria-label="Close peek"
                        className="flex h-[20px] w-[20px] flex-none cursor-pointer items-center justify-center text-muted hover:text-secondary"
                    >
                        <X size={13} aria-hidden />
                    </button>
                </div>
                {current.command != null && current.command !== current.label ? (
                    <div
                        data-testid="background-task-peek-command"
                        title={current.command}
                        className="truncate px-[10px] pb-[8px] font-mono text-[10.5px] text-muted"
                    >
                        {`$ ${current.command}`}
                    </div>
                ) : null}
                <PeekBodyContext.Provider value={peekSize.body}>
                    {monitor ? (
                        <MonitorBody key={current.toolUseId} task={current} now={now} />
                    ) : (
                        <>
                            <OutputBody
                                key={current.toolUseId}
                                path={current.outputFile}
                                running={current.status === "running"}
                            />
                            <OutputFooter path={current.outputFile} running={current.status === "running"} />
                        </>
                    )}
                </PeekBodyContext.Provider>
                <ResizeGrip axis="x" props={gripProps("x")} />
                <ResizeGrip axis="y" props={gripProps("y")} />
                <ResizeGrip axis="xy" props={gripProps("xy")} />
            </div>
        </FloatingPortal>
    );
}
