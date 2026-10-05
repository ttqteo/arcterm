// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run sheet's Timing section: one bar per activity on a since-launch axis (model: runtiming.ts).

import { cn } from "@/util/util";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { runTiming, type RunTimingView, type TimingKey } from "./runtiming";

const BAR_FILL: Record<TimingKey, string> = {
    planning: "bg-ink-mid",
    execution: "bg-accent",
    review: "bg-accent-soft",
    merge: "bg-accent-500",
    final: "bg-success",
    landing: "bg-ink-mid",
};

export function RunTimingSection({
    run,
    digest,
    tasks,
    now,
}: {
    run: Run;
    digest: DagStatusDigest | undefined;
    tasks: TaskNode[] | undefined;
    now: number;
}) {
    const view = runTiming({ run, digest, tasks, nowMs: now });
    if (view == null) {
        return null;
    }
    // keyed by run so another run starts from its own default; the body mounts only once the digest has
    // timing, so the default it reads is the run's, not a not-yet-loaded one
    return <TimingBody key={run.id} view={view} />;
}

function TimingBody({ view }: { view: RunTimingView }) {
    // a run finishing under the open sheet keeps the user's choice
    const [open, setOpen] = useState(view.defaultOpen);
    return (
        <div data-run-timing className="border-b border-edge-mid">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="flex min-h-12 w-full cursor-pointer items-center gap-2 text-left text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
                <ChevronRight
                    size={14}
                    aria-hidden
                    className={cn("flex-none text-ink-mid transition-transform", open && "rotate-90")}
                />
                <span className="text-[12px] font-semibold">Timing</span>
                <span className="ml-auto text-[11px] tabular-nums text-secondary">{view.header}</span>
            </button>
            {view.summary.length > 0 ? (
                <div className="flex flex-col gap-[5px] pb-3 pl-[22px]">
                    <span className="text-[12px] text-secondary">{view.summary[0]}</span>
                    {view.summary.slice(1).map((line) => (
                        <span key={line} className="text-[11px] leading-[1.5] text-ink-mid">
                            {line}
                        </span>
                    ))}
                </div>
            ) : null}
            {open ? (
                <div className="flex flex-col gap-3 pb-3.5">
                    <div className="ml-[144px] mr-[54px] flex justify-between text-[10.5px] tabular-nums text-ink-mid">
                        {view.axis.map((label, i) => (
                            <span key={i}>{label}</span>
                        ))}
                    </div>
                    <div className="flex flex-col gap-[11px]">
                        {view.rows.map((row) => (
                            <div key={row.key} data-run-timing-row={row.key} className="flex items-center gap-3">
                                <span className="w-[132px] flex-none text-[11.5px] text-secondary">{row.label}</span>
                                <div className="relative h-3 flex-1 rounded-[2px] bg-surface-raised">
                                    <span
                                        className={cn("absolute top-0 h-3 rounded-[2px]", BAR_FILL[row.key])}
                                        style={{ left: `${row.left}%`, width: `${row.width}%` }}
                                    />
                                </div>
                                <span className="w-[42px] flex-none text-right text-[10.5px] tabular-nums text-secondary">
                                    {row.duration}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="flex flex-col gap-1 pt-0.5 text-[11px] leading-[1.5] text-ink-mid">
                        {view.notes.map((note) => (
                            <span key={note}>{note}</span>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
