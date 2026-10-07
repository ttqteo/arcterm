// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { MemoryStick, TriangleAlert } from "lucide-react";
import { capacityChipLabel, capacityTitle } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

// The app bar's RAM chip: the free RAM, with how many more workers that holds in the tooltip. Nothing until
// there is a reading. When not one more worker fits it takes the warning tone of the version-mismatch pill
// beside it. A drag region like the bar's other non-interactive pieces (app-bar.tsx explains why each one
// carries its own).
export function WorkerCapacityChip() {
    const cap = useWorkerCapacity();
    if (cap == null) {
        return null;
    }
    const full = cap.moreworkers === 0;
    const Icon = full ? TriangleAlert : MemoryStick;
    return (
        <span
            data-tauri-drag-region
            data-worker-capacity
            title={capacityTitle(cap)}
            className={cn(
                "flex shrink-0 items-center gap-1 whitespace-nowrap text-[11.5px] font-semibold tabular-nums",
                full ? "text-warning" : "text-muted"
            )}
        >
            <Icon size={12} aria-hidden />
            {capacityChipLabel(cap)}
        </span>
    );
}
