// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { MemoryStick, TriangleAlert } from "lucide-react";
import { toggleConsumers } from "./consumersstore";
import { capacityChipLabel, capacityTitle, lowRam } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

// The footer's RAM chip, between the usage meters and the version: the free RAM, with how many more workers that
// holds in the tooltip; a click opens the Consumers panel sorted by RAM. Nothing until there is a reading. When the
// free RAM is low (lowRam) it takes the warning tone.
export function WorkerCapacityChip() {
    const cap = useWorkerCapacity();
    if (cap == null) {
        return null;
    }
    const low = lowRam(cap);
    const Icon = low ? TriangleAlert : MemoryStick;
    return (
        <button
            type="button"
            data-worker-capacity
            aria-haspopup="dialog"
            title={capacityTitle(cap)}
            onClick={() => toggleConsumers("ram")}
            className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[11.5px] font-semibold tabular-nums hover:bg-surface-hover",
                low ? "text-warning" : "text-muted"
            )}
        >
            <Icon size={12} aria-hidden />
            {capacityChipLabel(cap)}
        </button>
    );
}
