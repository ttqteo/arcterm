// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The slim bar over each cell of the agent grid while there is more than one: the agent's status dot and
// name, and an x that takes the cell out of the grid (the agent keeps running). The bar is also the handle for
// rearranging: drag it onto another cell and the drop zones answer as they do for a row from the tree.

import { cn } from "@/util/util";
import { GripVertical, X } from "lucide-react";
import { beginAgentDrag, endAgentDrag } from "./agentdragstore";
import type { AgentVM } from "./agentsviewmodel";
import { StatusDot } from "./statusdot";

export function GridCellBar({ agent, focused, onRemove }: { agent: AgentVM; focused: boolean; onRemove: () => void }) {
    return (
        <div
            data-agent-cell-bar={agent.id}
            draggable
            onDragStart={(e) => beginAgentDrag(e, agent.id)}
            onDragEnd={endAgentDrag}
            title={`${agent.name} (${agent.state}). Drag to rearrange`}
            className={cn(
                "flex h-[26px] shrink-0 cursor-grab select-none items-center gap-[7px] border-b border-border bg-surface px-[8px] active:cursor-grabbing",
                focused ? "text-primary" : "text-muted"
            )}
        >
            <GripVertical size={12} aria-hidden className="shrink-0 text-ink-faint" />
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
