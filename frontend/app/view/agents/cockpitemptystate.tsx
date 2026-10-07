// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit's "No agents running" empty state. Extracted from cockpitsurface.tsx.

import { cardVariants } from "@/app/element/motiontokens";
import { formatChordString } from "@/util/keysym";
import { motion } from "motion/react";

export function CockpitEmptyState({ onNewAgent }: { onNewAgent: () => void }) {
    return (
        <motion.div
            key="empty"
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center px-[30px] py-12 text-center"
        >
            <div className="flex w-full max-w-[600px] flex-col items-center">
                {/* terminal-window glyph. Ambience is CSS-driven (cockpit.scss) — framer
                    repeat loops don't run nested under the entrance variant tree; the CSS
                    also carries a prefers-reduced-motion guard. */}
                <div className="cockpit-empty-glyph relative mb-7 h-[104px] w-[104px]">
                    <div className="cockpit-empty-glow absolute -inset-5 rounded-full bg-accent/25 blur-2xl" />
                    <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[22px] border border-edge-mid bg-gradient-to-br from-surface-raised to-surface shadow-popover-2xl">
                        <div className="flex shrink-0 items-center gap-[5px] border-b border-border px-[11px] py-[9px]">
                            <span className="h-1.5 w-1.5 rounded-full bg-muted/40" />
                            <span className="h-1.5 w-1.5 rounded-full bg-muted/40" />
                            <span className="h-1.5 w-1.5 rounded-full bg-muted/40" />
                        </div>
                        <div className="flex flex-1 items-center justify-center gap-[5px]">
                            <span className="font-mono text-[22px] font-bold text-accent">&gt;</span>
                            <span className="cockpit-empty-caret h-5 w-[9px] rounded-[1px] bg-accent" />
                        </div>
                    </div>
                </div>

                <h2 className="mb-2.5 text-[25px] font-bold tracking-[-0.02em] text-primary">No agents running</h2>
                <p className="mb-[30px] max-w-[400px] text-[14px] leading-[1.6] text-muted">
                    Launch a terminal agent and it lands here as a live lane — watch it work, answer its questions, and
                    review changes in place.
                </p>

                <motion.button
                    type="button"
                    onClick={onNewAgent}
                    whileHover={{ y: -1 }}
                    whileTap={{ y: 0 }}
                    style={{
                        boxShadow:
                            "0 14px 34px color-mix(in srgb, var(--color-accent) 34%, transparent), var(--shadow-inset-highlight)",
                    }}
                    className="flex cursor-pointer items-center gap-[11px] rounded-lg bg-accent px-[26px] py-3.5 text-[15px] font-bold text-background hover:bg-accenthover"
                >
                    <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-background/15 font-mono text-[12px]">
                        &gt;_
                    </span>
                    <span>New terminal agent</span>
                    <span className="ml-0.5 rounded-sm bg-background/15 px-[7px] py-[3px] font-mono text-[11px] font-semibold">
                        {formatChordString("Mod:n")}
                    </span>
                </motion.button>

                <div className="mt-[18px] text-[12.5px] text-muted">
                    or press{" "}
                    <span className="rounded-[5px] border border-border px-1.5 py-0.5 font-mono text-[11px]">
                        {formatChordString("Mod:p")}
                    </span>{" "}
                    to run a saved command
                </div>
            </div>
        </motion.div>
    );
}
