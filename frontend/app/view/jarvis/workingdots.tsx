// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { motion, useReducedMotion } from "motion/react";
import type { PetCharacter } from "./petsprite";

// Spider-Man's working mark: a 12px web whose three rings light in turn, as the dots do; still under reduced motion
function WorkingWeb({ reduce }: { reduce: boolean }) {
    return (
        <svg data-working-web width={12} height={12} viewBox="0 0 12 12" aria-hidden className="block">
            {[
                [6, 0, 6, 12],
                [0, 6, 12, 6],
                [1.8, 1.8, 10.2, 10.2],
                [1.8, 10.2, 10.2, 1.8],
            ].map(([x1, y1, x2, y2], i) => (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-spidey-web)" strokeWidth={0.75} />
            ))}
            {[1.8, 3.6, 5.4].map((r, i) => (
                <motion.circle
                    key={r}
                    cx={6}
                    cy={6}
                    r={r}
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth={0.9}
                    animate={reduce ? undefined : { opacity: [0.3, 1, 0.3] }}
                    transition={reduce ? undefined : { duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
            ))}
        </svg>
    );
}

// "…" and how many agents are working, beside Sprout's head in Float and folded: the dots pulse in turn, and hold
// still under reduced motion (Spider-Man's are a web). No title and no shadow: folded, it sits over the app behind the
// see-through window.
export function WorkingDots({
    count,
    className,
    character = "sprout",
}: {
    count: number;
    className?: string;
    character?: PetCharacter;
}) {
    const reduce = useReducedMotion() === true;
    return (
        <span
            aria-hidden
            className={cn(
                "pointer-events-none flex h-4 items-center gap-[3px] rounded-full border border-edge-mid bg-surface-raised pl-[5px] pr-1 text-[10px] font-semibold leading-none text-secondary tabular-nums",
                className
            )}
        >
            {character === "spidey" ? (
                <WorkingWeb reduce={reduce} />
            ) : (
                [0, 1, 2].map((i) => (
                    <motion.span
                        key={i}
                        className="h-[3px] w-[3px] rounded-full bg-success"
                        animate={reduce ? undefined : { opacity: [0.3, 1, 0.3] }}
                        transition={reduce ? undefined : { duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                    />
                ))
            )}
            {/* Spider-Man's web shows while Jarvis thinks, with no agent working: nothing to count */}
            {count > 0 ? <span className="ml-0.5">{count}</span> : null}
        </span>
    );
}
