// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail session block's Compacted line: the agent's last compaction, as Chat's divider words it ("Compacted ·
// 202k → 13k · manual"), with when and how many; a click opens its summary under it, as the divider does. The data is
// subagentsstore.ts's compactionsByIdAtom, the words railcompaction.ts's.

import { foldReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { MarkdownMessage } from "./markdownmessage";
import { compactionFacts } from "./railcompaction";
import { compactionsByIdAtom } from "./subagentsstore";

export function RailCompactionLine({ agentId, now }: { agentId: string; now: number }) {
    const list = useAtomValue(compactionsByIdAtom)[agentId];
    const [open, setOpen] = useState(false);
    const facts = compactionFacts(list, now);
    if (facts == null) {
        return null;
    }
    const summary = list![list!.length - 1].summary;
    const canOpen = !!summary;
    return (
        <div data-rail-compaction className="mt-[8px]">
            <button
                type="button"
                disabled={!canOpen}
                onClick={() => setOpen((v) => !v)}
                aria-expanded={canOpen ? open : undefined}
                title={canOpen ? (open ? "Hide the summary" : "Show the summary it kept") : undefined}
                className={cn(
                    "-mx-[6px] flex w-[calc(100%+12px)] min-w-0 items-center gap-[7px] rounded-[7px] px-[6px] py-[3px] text-left text-[11px] tabular-nums",
                    canOpen ? "cursor-pointer hover:bg-surface-hover" : "cursor-default"
                )}
            >
                <span className="flex-none text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-soft">
                    Compacted
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">{facts}</span>
                {canOpen ? (
                    open ? (
                        <ChevronUp size={12} aria-hidden className="flex-none text-accent-soft" />
                    ) : (
                        <ChevronDown size={12} aria-hidden className="flex-none text-accent-soft" />
                    )
                ) : null}
            </button>
            <AnimatePresence initial={false}>
                {open && summary ? (
                    <motion.div
                        key="summary"
                        data-rail-compaction-summary
                        variants={foldReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden"
                    >
                        <div className="mt-[6px] max-h-[320px] overflow-y-auto rounded-[8px] border border-border bg-surface px-[11px] py-[9px] text-[12px]">
                            <MarkdownMessage text={summary} />
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
