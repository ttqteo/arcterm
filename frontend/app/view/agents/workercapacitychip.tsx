// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { MemoryStick, TriangleAlert } from "lucide-react";
import { capacityChipLabel, capacityTitle, lowRam, type WorkerCapacity } from "./workercapacity";

// The RAM half of the app bar's usage button (usagemeters.tsx HeaderUsage): the free RAM, with how many more workers
// that holds in the tooltip, and where the Resource Manager runs, what Arc and its agents use. A click on it opens the
// Resource Manager there, else the Consumers panel sorted by RAM. When the free RAM is low (lowRam) or the Resource
// Manager reads Arc as busy, it takes the warning tone.
export function WorkerCapacityChip({
    cap,
    busy = null,
    arc = null,
}: {
    cap: WorkerCapacity;
    busy?: string | null;
    arc?: { cpu: string; mem: string } | null;
}) {
    const low = lowRam(cap) || busy != null;
    const Icon = low ? TriangleAlert : MemoryStick;
    const title = [
        capacityTitle(cap),
        arc ? `Arc and its agents: ${arc.cpu} CPU · ${arc.mem}${busy ? `, ${busy}` : ""}` : null,
    ]
        .filter(Boolean)
        .join("\n");
    return (
        <span
            data-worker-capacity
            title={title}
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
