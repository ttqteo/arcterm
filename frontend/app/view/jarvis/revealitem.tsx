// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One row of a Jarvis list (a chunk in an initiative's plan, an entry in a chunk's trail) arriving or leaving on the spring
// (docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md, Design §2 and §3). The list sits in an
// <AnimatePresence initial={false} custom={batch}> and passes `batch`, useSpringBatch's answer for the render: a row that
// arrives alone opens its height on springReveal's transition, and one that leaves alone folds the same way, while a batch
// (a first load, a filter switch, 3+ rows at once) shows at once.
//
// A row that leaves is no longer rendered, so its `exit` is read from the props of its last render and a batch's "instant"
// never reaches it: AnimatePresence's `custom` does, and `exit` is a function of it. The row clips only while it moves
// (foldReveal's pattern), so a menu or a focus ring hanging past its edge shows once it has settled.

import { MOTION } from "@/app/element/motiontokens";
import { usePartMotion, type BatchMotion } from "@/app/element/springbatch";
import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

// springReveal's transition: the height on the spring, the opacity on the micro ease
const REVEAL = { height: MOTION.spring, opacity: { duration: MOTION.durMicro, ease: MOTION.easeFluid } };

export const itemReveal: Variants = {
    initial: { opacity: 0, height: 0, overflow: "hidden" },
    animate: {
        opacity: 1,
        height: "auto",
        overflow: "hidden",
        transition: REVEAL,
        transitionEnd: { overflow: "visible" },
    },
    exit: (batch: BatchMotion) => ({
        opacity: 0,
        height: 0,
        overflow: "hidden",
        transition: batch === "instant" ? { duration: 0 } : REVEAL,
    }),
};

export function RevealItem({
    batch,
    className,
    children,
}: {
    batch: BatchMotion;
    className?: string;
    children: ReactNode;
}) {
    const part = usePartMotion(itemReveal);
    // `initial` is read once, at mount: a row that arrives in a batch mounts open
    return (
        <motion.div {...part} initial={batch === "instant" ? false : part.initial} className={className}>
            {children}
        </motion.div>
    );
}
