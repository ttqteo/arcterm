// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TriangleAlert } from "lucide-react";
import { capacityWarnTitle, overCapacity, type WorkerCapacity } from "./workercapacity";

// A worker stepper's over-capacity mark: nothing while the pick fits in RAM, a warning triangle with the reason
// in its tooltip when it does not. It disables nothing; the user decides.
export function CapacityWarn({ cap, extra }: { cap: WorkerCapacity | null; extra: number }) {
    if (cap == null || !overCapacity(cap, extra)) {
        return null;
    }
    return (
        <span data-capacity-warn title={capacityWarnTitle(cap)} className="flex shrink-0 text-warning">
            <TriangleAlert size={12} aria-label="More workers than fit in RAM" />
        </span>
    );
}
