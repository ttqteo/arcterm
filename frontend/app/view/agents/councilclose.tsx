// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Close an ended council (an X), or Reopen a closed one (an arrow): one button for both of a council's views, the
// Discussion's header (councildiscussion.tsx) and the Report's tab bar (councilsummary.tsx). A closed council opened
// from Councils lands on its Report when it has one, so the Report needs it too. Nothing shows while it runs.

import { cn } from "@/util/util";
import { RotateCcw, X } from "lucide-react";
import { canRemoveCouncil, isClosedCouncil } from "./councilmodel";
import { closeCouncil } from "./councilstore";

export function CouncilCloseButton({ c, className }: { c: Council; className?: string }) {
    if (!canRemoveCouncil(c)) {
        return null;
    }
    const closed = isClosedCouncil(c);
    return (
        <button
            type="button"
            data-council-close={closed ? "reopen" : "close"}
            title={
                closed
                    ? "Put this council back in the tree"
                    : "Take this council off the tree; Councils still lists it, nothing is deleted"
            }
            aria-label={closed ? "Reopen council" : "Close council"}
            onClick={() => void closeCouncil(c.id, !closed)}
            className={cn(
                "flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center rounded-[6px] border border-transparent bg-transparent text-muted outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent",
                className
            )}
        >
            {closed ? <RotateCcw size={14} strokeWidth={2} aria-hidden /> : <X size={16} strokeWidth={2} aria-hidden />}
        </button>
    );
}
