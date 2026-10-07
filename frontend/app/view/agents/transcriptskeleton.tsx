// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Placeholder for a narration timeline that has not arrived yet: ragged message rows, the shape the
// timeline will take, instead of a "Loading transcript…" line.

import { SkeletonLine, SkeletonRows } from "@/app/element/skeleton";
import { cn } from "@/util/util";

const ROW_WIDTHS = ["w-[72%]", "w-[48%]", "w-[86%]", "w-[60%]", "w-[40%]"];

export function TranscriptSkeleton({ className }: { className?: string }) {
    return (
        <SkeletonRows className={cn("h-full space-y-4", className)}>
            {(i) => (
                <div key={i} className="flex flex-col gap-1.5">
                    <SkeletonLine className="h-[9px] w-[64px]" />
                    <SkeletonLine className={cn("h-[11px]", ROW_WIDTHS[i % ROW_WIDTHS.length])} />
                </div>
            )}
        </SkeletonRows>
    );
}
