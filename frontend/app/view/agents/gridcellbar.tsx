// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The slim bar over each cell of the agent grid while there is more than one: the agent's status dot and
// name, and an x that takes the cell out of the grid (the agent keeps running).

import { cn } from "@/util/util";
import { X } from "lucide-react";
import type { AgentVM } from "./agentsviewmodel";
import { StatusDot } from "./statusdot";

export function GridCellBar({ agent, focused, onRemove }: { agent: AgentVM; focused: boolean; onRemove: () => void }) {
    return (
        <div
            data-agent-cell-bar={agent.id}
            title={`${agent.name} (${agent.state})`}
            className={cn(
                "flex h-[26px] shrink-0 select-none items-center gap-[7px] border-b border-border bg-surface px-[8px]",
                focused ? "text-primary" : "text-muted"
            )}
        >
            <StatusDot state={agent.state} pulse={agent.state !== "idle"} className="!h-[7px] !w-[7px]" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{agent.name}</span>
            <button
                type="button"
                data-agent-cell-remove={agent.id}
                aria-label={`Remove ${agent.name} from the grid`}
                title="Remove from the grid (the agent keeps running)"
                onClick={onRemove}
                className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <X size={12} aria-hidden />
            </button>
        </div>
    );
}
