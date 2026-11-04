// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A background task's events and output in a floating peek beside its Agent tree row: a Monitor has an Events tab (what
// it has reported) and an Output tab, a background shell only its output. A running task's output is re-read on a timer
// and followed at the tail; an ended one is read once. A running task of a live agent has a Stop in the header.
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
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { Radio, Terminal, X } from "lucide-react";
import { motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { bgTaskStoppable } from "./agentrailsections";
import type { AgentsViewModel } from "./agents";
import { parseAnsiLines, runCss } from "./ansitext";
import {
    backgroundTaskKind,
    backgroundTaskState,
    clockTime,
    monitorEventsFooter,
    monitorExpiresAt,
    OUTPUT_MAX_CHARS,
    type BackgroundTaskState,
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

function OutputBody({ path, running }: { path: string | undefined; running: boolean }) {
    const lines = useTaskOutput(path, running);
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(lines ?? NO_LINES);
    return (
        <div data-testid="background-task-peek-output" className="relative border-t border-edge-mid bg-surface-code">
            <div
                ref={scrollRef}
                onScroll={onScroll}
                className="max-h-[360px] overflow-auto p-[10px] font-mono text-[11.5px] leading-[1.5]"
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
    return (
        <div data-testid="background-task-peek-events" className="relative border-t border-edge-mid bg-surface-code">
            {events.length === 0 ? (
                <div
                    data-testid="background-task-peek-events-empty"
                    className="p-[10px] font-mono text-[11.5px] leading-[1.5] text-muted"
                >
                    No events yet.
                </div>
            ) : (
                <div
                    ref={scrollRef}
                    onScroll={onScroll}
                    className="max-h-[360px] overflow-auto px-[10px] py-[4px] font-mono text-[11.5px] leading-[1.5]"
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
}: {
    model: AgentsViewModel;
    agentId: string;
    task: BackgroundTask;
    anchor: HTMLElement;
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
    // as the details rail does: the kill finds the task among the agent block's processes, which is Windows only
    const stoppable = isWindows() && blockId != null && bgTaskStoppable(current, true);

    const { refs, floatingStyles, context } = useFloating({
        open: true,
        onOpenChange: (open) => !open && close(),
        elements: { reference: anchor },
        placement: "right-start",
        strategy: "fixed",
        middleware: [offset(PEEK_GAP_PX), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    // the anchor row counts as inside, so pressing it again toggles the peek instead of closing and reopening it.
    // Esc is the root's own (below): left on, it would also reach agent:back
    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: false })]);

    // Focus is the peek's own, so the Agent surface's Escape stands down (data-owns-keys) and Esc closes only this.
    // Taken as the root attaches: FloatingPortal mounts its children a render after this component, and the ref's
    // identity is stable, so it runs once.
    const setRoot = useCallback(
        (el: HTMLDivElement | null) => {
            refs.setFloating(el);
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
                style={floatingStyles}
                {...getFloatingProps()}
                role="dialog"
                aria-label={`${monitor ? "Monitor" : "Background shell"} ${current.label}`}
                tabIndex={-1}
                data-owns-keys
                data-testid="background-task-peek"
                data-task-kind={monitor ? "monitor" : "shell"}
                data-task-state={state}
                onKeyDown={onKeyDown}
                className="z-[60] w-[560px] overflow-hidden rounded-[9px] border border-edge-strong bg-surface-raised shadow-popover-lg focus:outline-none"
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
            </div>
        </FloatingPortal>
    );
}
