// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { motion, useReducedMotion } from "motion/react";

// "…" and how many agents are working, beside Sprout's head in Float and folded: the dots pulse in turn, and hold
// still under reduced motion. No title and no shadow: folded, it sits over the app behind the see-through window.
export function WorkingDots({ count, className }: { count: number; className?: string }) {
    const reduce = useReducedMotion() === true;
    return (
        <span
            aria-hidden
            className={cn(
                "pointer-events-none flex h-4 items-center gap-[3px] rounded-full border border-edge-mid bg-surface-raised pl-[5px] pr-1 text-[10px] font-semibold leading-none text-secondary tabular-nums",
                className
            )}
        >
            {[0, 1, 2].map((i) => (
                <motion.span
                    key={i}
                    className="h-[3px] w-[3px] rounded-full bg-success"
                    animate={reduce ? undefined : { opacity: [0.3, 1, 0.3] }}
                    transition={reduce ? undefined : { duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
            ))}
            <span className="ml-0.5">{count}</span>
        </span>
    );
}
