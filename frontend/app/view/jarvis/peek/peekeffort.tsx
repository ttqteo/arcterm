// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChunkTone } from "../effortmodel";
import { effortDetailAtom, loadEffortDetail } from "../effortstore";
import { TONE_FG } from "../inlinetrackerview";
import { reportPeekFacts, type PeekTarget } from "../peekstore";
import { effortPeekFacts, effortPeekModel } from "./peekeffortmodel";

const SEGMENT_FILL: Record<ChunkTone, string> = {
    done: "bg-success",
    active: "bg-accent",
    blocked: "bg-warning",
    deferred: "bg-ink-faint",
    skipped: "bg-edge-mid",
    pending: "bg-edge-mid",
};

// a fetch no cached entry can be fresh against
const ALWAYS_REFETCH = Number.MAX_SAFE_INTEGER;

export function PeekEffortBody({ target }: { model: AgentsViewModel; target: PeekTarget }) {
    const oref = target.kind === "effort" ? "effort:" + target.effortId : "";
    const effort = useAtomValue(effortDetailAtom).get(oref);
    const [missing, setMissing] = useState(false);

    // the peek's load trusts a fresh cache entry, so an initiative deleted since it was cached is only found here
    useEffect(() => {
        setMissing(false);
        loadEffortDetail(oref, ALWAYS_REFETCH).catch(() => setMissing(true));
    }, [oref]);

    useEffect(() => {
        if (missing || effort != null) {
            reportPeekFacts(target, effortPeekFacts(missing ? undefined : effort));
        }
    }, [target, effort, missing]);

    if (effort == null || missing) {
        return null;
    }
    const m = effortPeekModel(effort);
    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-2.5 px-3.5 py-3">
                <span className="flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent-soft">
                    Initiative
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink-hi">{m.title}</span>
                <span className="flex-none rounded-[6px] border border-border bg-surface-raised px-2 py-[2px] text-[10.5px] font-semibold text-accent-soft">
                    {m.status}
                </span>
            </div>
            <div className="flex flex-col gap-3.5 px-3.5 pb-3.5">
                {m.objective ? <p className="m-0 text-[13px] leading-[1.6] text-ink-mid">{m.objective}</p> : null}
                <div className="flex flex-col gap-[7px]">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[12.5px] font-semibold text-secondary">{m.progress}</span>
                        <span className="flex-1" />
                        {m.project ? <span className="text-[10.5px] text-muted">{m.project}</span> : null}
                    </div>
                    {m.segments.length > 0 ? (
                        <div
                            aria-hidden="true"
                            className="grid gap-[3px]"
                            style={{ gridTemplateColumns: `repeat(${m.segments.length}, minmax(0, 1fr))` }}
                        >
                            {m.segments.map((tone, i) => (
                                <span key={i} className={cn("h-1 rounded-[2px]", SEGMENT_FILL[tone])} />
                            ))}
                        </div>
                    ) : null}
                </div>
                {m.doneLine || m.remaining.length > 0 ? (
                    <div className="flex flex-col overflow-hidden rounded-[9px] border border-border bg-surface-code">
                        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
                            <span className="flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-mid">
                                Chunks
                            </span>
                            <span className="h-px flex-1 bg-border" />
                        </div>
                        {m.doneLine ? (
                            <div className="flex items-center gap-2.5 px-3 py-[7px]">
                                <Check aria-hidden="true" size={12} strokeWidth={2.4} className="flex-none text-success" />
                                <span className="flex-1 text-[12.5px] text-ink-mid">{m.doneLine}</span>
                            </div>
                        ) : null}
                        {m.remaining.map((c) => (
                            <div
                                key={c.n}
                                className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 border-t border-border px-3 py-[7px] first:border-t-0"
                            >
                                <span className="text-[10.5px] tabular-nums text-muted">{c.n}</span>
                                <span
                                    className={cn("truncate text-[12.5px]", c.active ? "text-ink-hi" : "text-ink-mid")}
                                >
                                    {c.label}
                                </span>
                                <span className={cn("text-[10.5px]", TONE_FG[c.tone])}>{c.status}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
