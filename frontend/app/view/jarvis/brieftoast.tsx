// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's one toast: bottom-centre over the surface (centred in the part left of the To review sheet while that is
// open), with Undo when the edit can be taken back.
// Brief-local rather than the cockpit's notificationstore, which is global and has no action button.

import { springPop } from "@/app/element/motiontokens";
import { shapeTransition, usePartMotion } from "@/app/element/springbatch";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    AnimatePresence,
    MotionConfig,
    motion,
    useReducedMotion,
    type TargetAndTransition,
    type Variants,
} from "motion/react";
import { briefToastAtom } from "./briefundo";
import { runReviewOpenAtom } from "./runreviewstore";

// a leaving toast takes no clicks: its Undo belongs to an edit that has already committed or been replaced
const toastVariants: Variants = {
    ...springPop,
    exit: { ...(springPop.exit as TargetAndTransition), pointerEvents: "none" },
};

// Where the toast's centre sits. With the To review sheet open it is the middle of the page left of the sheet, so the
// toast (and its Undo) never covers part of the sheet: the sheet's width is --run-review-sheet-w, the one value
// tailwindsetup.css holds for it, and the toast shrinks to that part less a gutter rather than reach the sheet. The
// underscores are spaces in a Tailwind arbitrary value.
const CENTRED = "left-1/2";
const BESIDE_REVIEW_SHEET =
    "left-[calc((100%_-_var(--run-review-sheet-w))_/_2)] max-w-[calc(100%_-_var(--run-review-sheet-w)_-_48px)]";

export function BriefToastView() {
    const toast = useAtomValue(briefToastAtom);
    const reviewOpen = useAtomValue(runReviewOpenAtom);
    const reduce = useReducedMotion();
    const part = usePartMotion(toastVariants);
    // keyed by id so a toast replacing another crosses over it rather than swapping its text in place
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence mode="popLayout">
                {toast != null ? (
                    <motion.div
                        key={toast.id}
                        layout
                        transition={{ layout: shapeTransition("animate", reduce) }}
                        {...part}
                        role="status"
                        data-jarvis-brief-toast={toast.error ? "error" : "info"}
                        className={cn(
                            "absolute bottom-6 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[9px] border border-edge-strong frost py-2 pl-3.5 pr-2.5 shadow-[0_12px_34px_var(--color-background)]",
                            reviewOpen ? BESIDE_REVIEW_SHEET : CENTRED
                        )}
                    >
                        <span
                            className={cn(
                                // the toast's width is capped beside the sheet, so a long line gives way to an ellipsis
                                // rather than run under the sheet; the Undo button beside it keeps its size
                                "whitespace-nowrap text-[12.5px]",
                                reviewOpen && "min-w-0 truncate",
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
