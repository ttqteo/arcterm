// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The compact Chat | Terminal switch in a split cell's bar. A canvas, review or brainstorm takes the whole centre,
// never a cell, so a cell only ever chooses between these two; the single-cell header has the full control.

import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import type { AgentVM } from "./agentsviewmodel";
import type { ChatMode } from "./chatmode";
import { selectCellView, useChatMode } from "./chatmodestore";

const OPTIONS: { key: ChatMode; label: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "terminal", label: "Terminal" },
];

export function ChatSwitch({ agent }: { agent: AgentVM }) {
    const mode = useChatMode(agent);
    const key = formatChordString("Mod:Shift:k");
    return (
        <div
            role="group"
            aria-label={`Show ${agent.name}'s chat or terminal`}
            data-agent-chat-switch={agent.id}
            data-chat-mode={mode}
            // the bar is a drag handle: a press on the switch is a click, never the start of a drag
            draggable={false}
            onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            className="flex shrink-0 cursor-default rounded-[5px] border border-border bg-surface-raised p-[2px]"
        >
            {OPTIONS.map((o) => (
                <button
                    key={o.key}
                    type="button"
                    aria-pressed={mode === o.key}
                    title={`${o.label} (${key} in the focused cell)`}
                    onClick={() => selectCellView(agent.id, o.key, Date.now())}
                    className={cn(
                        "cursor-pointer rounded-[3px] border-0 px-[7px] py-[1px] text-[10.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        mode === o.key ? "bg-accentbg text-primary" : "bg-transparent text-muted hover:text-primary"
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
