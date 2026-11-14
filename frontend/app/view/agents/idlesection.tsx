// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion, useSpringBatch } from "@/app/element/springbatch";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { AgentComposer } from "./agentcomposer";
import { formatAge, projectOf, type AgentVM } from "./agentsviewmodel";
import { batchReveal } from "./cardgridlayout";
import { SectionHeader } from "./sectionheader";

export function IdleSection({ agents, onOpen }: { agents: AgentVM[]; onOpen: (id: string) => void }) {
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
        <div className="shrink-0">
            <SectionHeader
                className="mb-2 py-1.5"
                label="Idle"
                labelClassName="text-muted"
                count={agents.length}
                dotClassName="bg-muted"
                countPillClassName="bg-surface-raised text-muted"
                dividerClassName="bg-gradient-to-r from-edge-mid to-transparent"
                open={open}
                onClick={() => setOpen((v) => !v)}
            />
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div key="rows" {...listPart} className="flex flex-col gap-1 overflow-hidden">
                        <AnimatePresence initial={false} custom={instant}>
                            {agents.map((a) => {
                                const project = projectOf(a);
                                return (
                                    <motion.div
                                        key={a.id}
                                        {...rowPart}
                                        initial={instant ? false : rowPart.initial}
                                        className="flex flex-col overflow-hidden rounded-sm hover:bg-white/[0.04]"
                                    >
                                        <div
                                            onClick={() => onOpen(a.id)}
                                            className="flex cursor-pointer items-center gap-2.5 px-2 py-1.5"
                                        >
                                            <span className="h-2 w-2 shrink-0 rounded-full bg-muted" />
                                            <b className="shrink-0 text-[12px] text-secondary">{a.name}</b>
                                            {project ? (
                                                <span className="shrink-0 rounded-[5px] border border-edge-mid bg-surface-raised px-1.5 py-px text-[10.5px] text-muted">
                                                    {project}
                                                </span>
                                            ) : null}
                                            <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                                                {a.activity}
                                            </span>
                                            <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-muted">
                                                {formatAge(a.activeMs)} idle
                                            </span>
                                        </div>
                                        {a.blockId ? (
                                            <AgentComposer
                                                blockId={a.blockId}
                                                agent={a}
                                                placeholder={`message ${a.name}…`}
                                            />
                                        ) : null}
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
