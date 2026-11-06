// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A pending land's line under its run in the Agent tree, and the peek it opens. The line says the step and how long
// it has run, or what it waits on in the heavy-job queue (landprogress.ts); hovering it shows the lines another agent
// needs to take the land over. A press opens the peek beside the tree: the same lines, Run now while the step waits
// in the queue, Jobs, and Copy for an agent. Esc and a press outside close it. Mounted only while the land is pending,
// so only those lines tick with the 1s clock.

import { jobQueueAtom, toggleJobQueue } from "@/app/cockpit/jobqueuestore";
import { pushToast } from "@/app/cockpit/notificationstore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
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
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { landProgress, type LandProgress } from "./landprogress";
import type { RunInfo } from "./runlineage";

// beside the tree, past its own 8px padding, as BackgroundTaskPeek sits
const PEEK_GAP_PX = 16;

function runNow(job: JobQueueJob): void {
    fireAndForget(async () => {
        try {
            await RpcApi.JobQueueRunNowCommand(TabRpcClient, { id: job.id });
        } catch (e) {
            // wavesrv refuses a job that has just left the queue (started meanwhile)
            pushToast({ title: "Couldn't run the land's step now", message: String(e), level: "error" });
        }
    });
}

function copyForAgent(lines: string[]): void {
    fireAndForget(async () => {
        await navigator.clipboard.writeText(lines.join("\n"));
        pushToast({
            title: "Copied the land's state",
            message: "Paste it to an agent to take the land over.",
            level: "info",
        });
    });
}

function PeekButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
    return (
        <button
            type="button"
            data-testid={testId}
            onClick={onClick}
            className="h-[22px] cursor-pointer rounded-[5px] border border-edge-mid px-[8px] text-[11px] text-secondary hover:border-edge-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            {label}
        </button>
    );
}

function LandPeek({
    model,
    progress,
    anchor,
    onClose,
}: {
    model: AgentsViewModel;
    progress: LandProgress;
    anchor: HTMLElement;
    onClose: () => void;
}) {
    const { refs, floatingStyles, context } = useFloating({
        open: true,
        onOpenChange: (open) => !open && onClose(),
        elements: { reference: anchor },
        placement: "right-start",
        strategy: "fixed",
        middleware: [offset(PEEK_GAP_PX), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    // the line counts as inside, so pressing it again toggles the peek; Esc is the root's own (below)
    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: false })]);
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
            onClose();
        }
    }, [surface, onClose]);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "Escape") {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        onClose();
        anchor.focus({ preventScroll: true });
    };
    const queued = progress.job != null && !progress.job.running;
    return (
        <FloatingPortal>
            <div
                ref={setRoot}
                style={floatingStyles}
                {...getFloatingProps()}
                role="dialog"
                aria-label="Land progress"
                tabIndex={-1}
                data-owns-keys
                data-testid="land-peek"
                data-land-wait={progress.wait ?? ""}
                onKeyDown={onKeyDown}
                className="z-[60] w-[420px] overflow-hidden rounded-[9px] border border-edge-strong bg-surface-raised shadow-popover-lg focus:outline-none"
            >
                <div
                    data-testid="land-peek-title"
                    className={cn(
                        "px-[10px] pt-[8px] pb-[6px] text-[12px] font-semibold",
                        progress.wait === "ram" ? "text-warning" : "text-working"
                    )}
                >
                    {progress.text}
                </div>
                <div data-testid="land-peek-lines" className="space-y-[3px] px-[10px] pb-[8px]">
                    {progress.lines.map((l) => (
                        <div key={l} className="font-mono text-[10.5px] leading-[1.45] break-all text-secondary">
                            {l}
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-[6px] border-t border-edge-mid px-[10px] py-[6px]">
                    {queued ? (
                        <PeekButton label="Run now" testId="land-peek-run-now" onClick={() => runNow(progress.job!)} />
                    ) : null}
                    <PeekButton
                        label="Jobs"
                        testId="land-peek-jobs"
                        onClick={() => {
                            onClose();
                            toggleJobQueue(anchor);
                        }}
                    />
                    <span className="flex-1" />
                    <PeekButton
                        label="Copy for an agent"
                        testId="land-peek-copy"
                        onClick={() => copyForAgent(progress.lines)}
                    />
                </div>
            </div>
        </FloatingPortal>
    );
}

/** The run's line while its land is pending: a button whose title holds the hand-over lines, opening LandPeek. */
export function LandLine({ model, run, className }: { model: AgentsViewModel; run: RunInfo; className?: string }) {
    const jobs = useAtomValue(jobQueueAtom)?.jobs;
    const now = useAtomValue(model.nowAtom);
    const progress = landProgress(run, jobs, now);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const close = useCallback(() => setAnchor(null), []);
    if (progress == null) {
        return null;
    }
    return (
        <>
            <button
                type="button"
                data-testid="land-line"
                data-land-wait={progress.wait ?? ""}
                title={progress.lines.join("\n")}
                aria-expanded={anchor != null}
                onClick={(e) => {
                    // the run row's own press (select, fold) stays out of it
                    e.stopPropagation();
                    const el = e.currentTarget;
                    setAnchor((cur) => (cur != null ? null : el));
                }}
                className={cn(
                    "min-w-0 cursor-pointer truncate text-left underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    progress.wait === "ram" ? "text-warning" : className
                )}
            >
                {progress.text}
            </button>
            {anchor != null ? <LandPeek model={model} progress={progress} anchor={anchor} onClose={close} /> : null}
        </>
    );
}
