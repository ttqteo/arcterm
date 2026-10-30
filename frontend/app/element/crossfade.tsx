// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Micro cross-fade for a small mark that swaps in place (a status glyph, copy -> copied): a new `swapKey`
// fades the old content out while the new fades in. initial={false}, so mounting never plays; popLayout pops
// the leaving copy out of flow, so the box takes the new content's size at once instead of holding both.

import { cn } from "@/util/util";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";
import { microFade } from "./motiontokens";

export function CrossFade({
    swapKey,
    className,
    children,
}: {
    swapKey: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                    key={swapKey}
                    data-crossfade={swapKey}
                    variants={microFade}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className={cn("inline-flex items-center", className)}
                >
                    {children}
                </motion.span>
            </AnimatePresence>
        </MotionConfig>
    );
}
