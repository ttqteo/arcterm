// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cardVariants } from "@/app/element/motiontokens";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { formatAge, type AgentVM } from "./agentsviewmodel";
import { SectionHeader } from "./sectionheader";

// Collapsed lane for still-running agents the user has muted with `b`. Distinct from Idle (finished):
// clicking a row un-backgrounds it (returns it to the working region) via onRestore.
export function BackgroundedSection({ agents, onRestore }: { agents: AgentVM[]; onRestore: (id: string) => void }) {
    const [open, setOpen] = useState(false);
    if (agents.length === 0) {
        return null;
    }
    return (
        <div className="shrink-0">
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
            {open ? (
                <div className="flex flex-col gap-1">
                    <AnimatePresence initial={false}>
                        {agents.map((a) => (
                            <motion.div
                                key={a.id}
                                layout
                                variants={cardVariants}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                onClick={() => onRestore(a.id)}
                                title="Restore to working"
                                className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-white/[0.04]"
                            >
                                <span className="h-2 w-2 shrink-0 rounded-full bg-accent/50" />
                                <b className="shrink-0 text-[12px] text-secondary">{a.name}</b>
                                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                                    {a.task || a.activity || ""}
                                </span>
                                <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-muted">
                                    {formatAge(a.activeMs)}
                                </span>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            ) : null}
        </div>
    );
}
