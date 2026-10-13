// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's one toast: bottom-centre over the surface, with Undo when the edit can be taken back.
// Brief-local rather than the cockpit's notificationstore, which is global and has no action button.

import { cardVariants } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
import { briefToastAtom } from "./briefundo";

// a leaving toast takes no clicks: its Undo belongs to an edit that has already committed or been replaced
const toastVariants: Variants = { ...cardVariants, exit: { ...cardVariants.exit, pointerEvents: "none" } };

export function BriefToastView() {
    const toast = useAtomValue(briefToastAtom);
    // keyed by id so a toast replacing another crosses over it rather than swapping its text in place
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence mode="popLayout">
                {toast != null ? (
                    <motion.div
                        key={toast.id}
                        layout
                        variants={toastVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        role="status"
                        data-jarvis-brief-toast={toast.error ? "error" : "info"}
                        className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[9px] border border-edge-strong bg-surface-raised py-2 pl-3.5 pr-2.5 shadow-[0_12px_34px_var(--color-background)]"
                    >
                        <span
                            className={cn(
                                "whitespace-nowrap text-[12.5px]",
                                toast.error ? "text-error" : "text-secondary"
                            )}
                        >
                            {toast.text}
                        </span>
                        {toast.undo != null ? (
                            <button
                                type="button"
                                data-jarvis-toast-undo
                                onClick={toast.undo}
                                className="cursor-pointer rounded-[6px] border border-edge-mid px-[9px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                Undo
                            </button>
                        ) : null}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </MotionConfig>
    );
}
