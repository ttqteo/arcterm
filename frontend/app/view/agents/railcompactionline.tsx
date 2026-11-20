// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail session block's Compacted line: the agent's last compaction, as Chat's divider words it ("Compacted ·
// 202k → 13k · manual"), with when and how many. A click opens the summary it kept in the panel's Summary tab
// (RailCompactionPane), which takes the wide tabs' dragged width; it is the one place the summary is drawn (Chat's
// divider shows only the line). The data is subagentsstore.ts's compactionsByIdAtom, the words railcompaction.ts's.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronRight } from "lucide-react";
import { openRailSummary } from "./agentrailstore";
import { MarkdownMessage } from "./markdownmessage";
import { compactionFacts } from "./railcompaction";
import { compactionsByIdAtom } from "./subagentsstore";

export function RailCompactionLine({ agentId, now }: { agentId: string; now: number }) {
    const list = useAtomValue(compactionsByIdAtom)[agentId];
    // the rail's line leaves out manual or auto, so it fits the rail; the Summary tab's head has the whole of it
    const lineFacts = compactionFacts(list, now, { trigger: false });
    if (lineFacts == null) {
        return null;
    }
    const canOpen = !!list![list!.length - 1].summary;
    return (
        <div data-rail-compaction className="mt-[8px]">
            <button
                type="button"
                disabled={!canOpen}
                onClick={() => openRailSummary(agentId)}
                title={canOpen ? "Show the summary it kept" : undefined}
                className={cn(
                    "-mx-[6px] flex w-[calc(100%+12px)] min-w-0 items-center gap-[7px] rounded-[7px] px-[6px] py-[3px] text-left text-[11px] tabular-nums",
                    canOpen ? "cursor-pointer hover:bg-surface-hover" : "cursor-default"
                )}
            >
                <span className="flex-none text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-soft">
                    Compacted
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">{lineFacts}</span>
                {canOpen ? <ChevronRight size={12} aria-hidden className="flex-none text-accent-soft" /> : null}
            </button>
        </div>
    );
}

// The Summary tab's body: the compaction's facts, then the summary it kept, scrolling on its own
export function RailCompactionPane({ agentId, now }: { agentId: string; now: number }) {
    const list = useAtomValue(compactionsByIdAtom)[agentId];
    const facts = compactionFacts(list, now);
    const summary = list?.[list.length - 1]?.summary;
    return (
        <div data-rail-compaction-summary className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-none items-center gap-2.5 border-b border-edge-faint px-[18px] py-3">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-accent-soft">
                    Compacted
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-muted">{facts ?? ""}</span>
            </div>
            <div className="sc min-h-0 flex-1 overflow-y-auto px-[18px] py-3.5 text-[13px] [scrollbar-gutter:stable]">
                <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Summary — kept context
                </div>
                {summary ? (
                    <MarkdownMessage text={summary} />
                ) : (
                    <span className="text-[12px] text-muted">This agent has no compaction summary.</span>
                )}
            </div>
        </div>
    );
}
