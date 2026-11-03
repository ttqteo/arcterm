// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pin a council, or unpin a pinned one: one labelled button for both of a council's views, the Discussion's header
// (councildiscussion.tsx) and the Report's tab bar (councilsummary.tsx), and for an unfolded council row of a project
// Overview's History (projecthistory.tsx). The Agent tree's rows offer no Pin. It works in any state, running ones too: a
// pinned council stays at the top of its project in the tree, and only the person pins (a run never touches it).

import { cn } from "@/util/util";
import { Pin, PinOff } from "lucide-react";
import { isPinnedCouncil } from "./councilmodel";
import { setCouncilPinned } from "./councilstore";

export function CouncilPinButton({ c, className }: { c: Council; className?: string }) {
    const pinned = isPinnedCouncil(c);
    return (
        <button
            type="button"
            data-council-pin={pinned ? "pinned" : "pin"}
            aria-pressed={pinned}
            title={
                pinned
                    ? "Unpin: the tree stops keeping this council on top"
                    : "Keep this council at the top of its project in the tree"
            }
            onClick={() => void setCouncilPinned(c.id, !pinned)}
            className={cn(
                "inline-flex h-[28px] flex-none cursor-pointer items-center gap-[6px] rounded-[6px] border border-transparent bg-transparent px-[10px] text-[13px] outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent",
                pinned ? "text-primary" : "text-muted hover:text-primary",
                className
            )}
        >
            {pinned ? <PinOff size={13} strokeWidth={2} aria-hidden /> : <Pin size={13} strokeWidth={2} aria-hidden />}
            <span>{pinned ? "Pinned" : "Pin"}</span>
        </button>
    );
}
