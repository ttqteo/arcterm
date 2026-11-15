// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Shared height reveal for disclosures and banners: owns AnimatePresence, the reduced-motion handling and the
// variant, so a pane grows in and out instead of snapping and pushing its neighbours. initial={false} keeps a
// pane already open at mount from replaying. Like PopoverReveal, render it UNCONDITIONALLY and drive `open`; a
// `{open ? <PaneReveal/> : null}` caller defeats the exit. Pass composerReveal for a strip a few dozen pixels
// tall (a banner), springReveal for one that opens on the spring; the paneReveal default suits a pane several
// hundred. Reduced motion goes through usePartMotion, not MotionConfig alone: MotionConfig's "user" setting drops
// only transform and layout animations, so the height and opacity of a pane would still play.

import { cn } from "@/util/util";
import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { paneReveal } from "./motiontokens";
import { usePartMotion } from "./springbatch";

interface PaneRevealProps {
    open: boolean;
    variants?: Variants;
    className?: string;
    children: ReactNode;
}

export function PaneReveal({ open, variants = paneReveal, className, children }: PaneRevealProps) {
    const part = usePartMotion(variants);
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div {...part} className={cn("overflow-hidden", className)}>
                        {children}
                    </motion.div>
                )}
            </AnimatePresence>
        </MotionConfig>
    );
}
