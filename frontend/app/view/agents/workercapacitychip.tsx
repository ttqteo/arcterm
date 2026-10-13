// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { MemoryStick, TriangleAlert } from "lucide-react";
import { capacityChipLabel, capacityTitle, lowRam, type WorkerCapacity } from "./workercapacity";

// The RAM half of the app bar's usage button (usagemeters.tsx HeaderUsage): the free RAM, with how many more workers
// that holds in the tooltip. A click on it opens the Consumers panel sorted by RAM. When the free RAM is low (lowRam)
// it takes the warning tone.
export function WorkerCapacityChip({ cap }: { cap: WorkerCapacity }) {
    const low = lowRam(cap);
    const Icon = low ? TriangleAlert : MemoryStick;
    return (
        <span
            data-worker-capacity
            title={capacityTitle(cap)}
            className={cn(
                "flex shrink-0 items-center gap-1 whitespace-nowrap text-[11.5px] font-semibold tabular-nums",
                low ? "text-warning" : "text-muted"
            )}
        >
            <Icon size={12} aria-hidden />
            {capacityChipLabel(cap)}
        </span>
    );
}
