// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { ReactNode } from "react";

// more rows than any pane is tall: the clip is what makes a list skeleton fill its pane at every window size
const FILL_ROWS = 48;

// edge-strong, not a surface tone: a surface tone at half pulse is lost against the background
export function skeletonClass(className?: string): string {
    return cn("rounded-[6px] bg-edge-strong animate-pulse motion-reduce:animate-none", className);
}

export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden="true" className={skeletonClass(className)} />;
}

export function SkeletonLine({ className }: { className?: string }) {
    return <Skeleton className={cn("h-3", className)} />;
}

/** Placeholder rows repeated past the bottom of the pane and clipped. The caller's className gives the
 *  box its height (`h-full`, or `min-h-0 flex-1` in a flex column). */
export function SkeletonRows({ className, children }: { className?: string; children: (i: number) => ReactNode }) {
    return (
        <div aria-hidden="true" className={cn("overflow-hidden", className)}>
            {Array.from({ length: FILL_ROWS }, (_, i) => children(i))}
        </div>
    );
}
