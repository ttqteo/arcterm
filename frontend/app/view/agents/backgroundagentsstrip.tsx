// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Background section: detached `claude --bg` / `claude agents` sessions the hook roster can't see
// (they have no Wave block). Deduped against live agents by session id and scoped by the same project
// switcher as the roster. Background agents are view + attach only — no transcript/answer/open (there's
// no block to drive); Attach resumes one into a fresh Wave terminal, after which it becomes a normal
// hook-tracked agent. Lives collapsed at the bottom of the roster (like Idle) — low-signal, so it
// stays out of the way until expanded.

import { attachBackgroundAgent } from "@/app/cockpit/cockpit-actions";
import { cardVariants } from "@/app/element/motiontokens";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import { dedupBackgroundAgents, formatAge, matchesProjectFilter, type AgentVM } from "./agentsviewmodel";
import { backgroundAgentVMsAtom, dismissBackgroundAgent } from "./backgroundagentsstore";
import { SectionHeader } from "./sectionheader";

export function BackgroundAgentsStrip({ model }: { model: AgentsViewModel }) {
    const backgroundVMs = useAtomValue(backgroundAgentVMsAtom);
    const live = useAtomValue(model.agentsAtom);
    const projectFilter = useAtomValue(model.projectFilterAtom);
    const [open, setOpen] = useState(false);

    const shown = dedupBackgroundAgents(backgroundVMs, live).filter((a) => matchesProjectFilter(a, projectFilter));
    if (shown.length === 0) {
        return null;
    }

    const attach = (a: AgentVM) =>
        fireAndForget(() =>
            attachBackgroundAgent(model, { sessionId: a.id, cwd: a.cwd ?? "", project: a.project ?? "" })
        );

    const dismiss = (a: AgentVM) => fireAndForget(() => dismissBackgroundAgent(a.id));

    return (
        <div className="shrink-0" data-cockpit-background-agents>
            <SectionHeader
                className="mb-2 py-1.5"
                label="Background"
                labelClassName="text-muted"
                count={shown.length}
                dotClassName="bg-muted"
                countPillClassName="bg-surface-raised text-muted"
                dividerClassName="bg-gradient-to-r from-edge-mid to-transparent"
                open={open}
                onClick={() => setOpen((v) => !v)}
            />
            {open ? (
                <div className="flex flex-col gap-1">
                    <AnimatePresence initial={false}>
                        {shown.map((a) => (
                            <motion.div
                                key={a.id}
                                layout
                                variants={cardVariants}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                className="flex items-center gap-2 rounded-[9px] border border-edge-mid bg-lane px-3 py-1.5"
                            >
                                <span className={a.needsInput ? "text-warning" : "text-ink-mid"}>●</span>
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{a.name}</span>
                                {a.project ? (
                                    <span className="shrink-0 text-[11px] text-ink-mid">{a.project}</span>
                                ) : null}
                                {a.needsInput ? (
                                    <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-semibold text-warning">
                                        needs input
                                    </span>
                                ) : null}
                                <span className="shrink-0 text-[11px] text-ink-mid">{formatAge(a.activeMs)}</span>
                                <button
                                    onClick={() => attach(a)}
                                    className="shrink-0 rounded-[7px] border border-border px-[11px] py-[3px] text-[11px] font-semibold text-ink-mid hover:text-foreground"
                                >
                                    Attach
                                </button>
                                <button
                                    onClick={() => dismiss(a)}
                                    title="Dismiss — remove this background session (transcript kept)"
                                    className="shrink-0 rounded-[7px] border border-transparent px-[8px] py-[3px] text-[13px] leading-none text-ink-mid hover:border-border hover:text-warning"
                                >
                                    ×
                                </button>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            ) : null}
        </div>
    );
}
