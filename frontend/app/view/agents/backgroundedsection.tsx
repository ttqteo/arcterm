// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion, useSpringBatch } from "@/app/element/springbatch";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { formatAge, type AgentVM } from "./agentsviewmodel";
import { batchReveal } from "./cardgridlayout";
import { SectionHeader } from "./sectionheader";

// Collapsed lane for still-running agents the user has muted with `b`. Distinct from Idle (finished):
// clicking a row un-backgrounds it (returns it to the working region) via onRestore.
export function BackgroundedSection({ agents, onRestore }: { agents: AgentVM[]; onRestore: (id: string) => void }) {
    const [open, setOpen] = useState(false);
    // the list opens and folds on springReveal; one row arriving or leaving does too, and 3 or more at once land in a frame
    const batch = useSpringBatch(agents.map((a) => a.id));
    const listPart = usePartMotion(springReveal);
    const rowPart = usePartMotion(batchReveal);
    if (agents.length === 0) {
        return null;
    }
    const instant = batch === "instant";
    return (
        <div className="shrink-0" data-cockpit-backgrounded>
            <SectionHeader
                className="mb-2 py-1.5"
                label="Backgrounded"
                labelClassName="text-muted"
                note="still running"
                count={agents.length}
                dotClassName="bg-accent/50"
                countPillClassName="bg-surface-raised text-muted"
                dividerClassName="bg-gradient-to-r from-edge-mid to-transparent"
                open={open}
                onClick={() => setOpen((v) => !v)}
            />
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div key="rows" {...listPart} className="flex flex-col gap-1 overflow-hidden">
                        <AnimatePresence initial={false} custom={instant}>
                            {agents.map((a) => (
                                // the padding is on the inner row: a box folded to height 0 cannot be shorter than its padding
                                <motion.div
                                    key={a.id}
                                    {...rowPart}
                                    initial={instant ? false : rowPart.initial}
                                    className="overflow-hidden rounded-sm"
                                >
                                    <div
                                        onClick={() => onRestore(a.id)}
                                        title="Restore to working"
                                        className="flex cursor-pointer items-center gap-2.5 px-2 py-1.5 hover:bg-white/[0.04]"
                                    >
                                        <span className="h-2 w-2 shrink-0 rounded-full bg-accent/50" />
                                        <b className="shrink-0 text-[12px] text-secondary">{a.name}</b>
                                        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                                            {a.task || a.activity || ""}
                                        </span>
                                        <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-muted">
                                            {formatAge(a.activeMs)}
                                        </span>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
