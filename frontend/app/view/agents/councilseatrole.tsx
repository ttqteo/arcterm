// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The line under a seat's name on the first step's cards and the Map's cards: what the seat is there for, its stock focus
// first (`novelty`), then its brief clamped to two lines. The words come from seatRole (councildiscussionmodel.ts); the
// whole brief is the card's hover, set by the card, since the card's cover button takes the pointer.

import { cn } from "@/util/util";
import type { SeatRole } from "./councildiscussionmodel";

export function SeatRoleLine({ role, className }: { role: SeatRole; className?: string }) {
    if (role.focus === "" && role.gist === "") {
        return null;
    }
    return (
        <span
            data-council-seat-role
            className={cn("line-clamp-2 min-w-0 text-[12px] leading-[1.45] text-secondary", className)}
        >
            {role.focus !== "" && (
                <span data-council-seat-focus className="font-medium text-primary">
                    {role.focus}
                </span>
            )}
            {role.focus !== "" && role.gist !== "" && <span className="text-muted"> · </span>}
            {role.gist}
        </span>
    );
}
