// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The compact Chat | Terminal switch in a split cell's bar. A canvas, review or brainstorm takes the whole centre,
// never a cell, so a cell only ever chooses between these two; the single-cell header has the full control. The
// selected option's fill slides to the other when one is picked (indicatorSlide; reduced motion snaps it). Asleep it
// stays drawn, dimmed, with Chat selected and both options disabled: a sleeping cell always draws the conversation,
// and there is no terminal to show until the agent is woken.

import { indicatorSlide } from "@/app/element/motiontokens";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { MotionConfig, motion } from "motion/react";
import { useId } from "react";
import type { AgentVM } from "./agentsviewmodel";
import type { ChatMode } from "./chatmode";
import { selectCellView, useChatMode } from "./chatmodestore";

const OPTIONS: { key: ChatMode; label: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "terminal", label: "Terminal" },
];

export const ASLEEP_VIEW_TITLE = "Wake the agent to show its terminal";

export function ChatSwitch({ agent }: { agent: AgentVM }) {
    const asleep = agent.sleeping != null;
    // asleep, the cell draws the conversation whatever the stored mode says
    const stored = useChatMode(agent);
    const mode = asleep ? "chat" : stored;
    const key = formatChordString("Mod:Shift:k");
    // unique per switch, so two cells' switches never share a fill
    const fillId = useId();
    return (
        <div
            role="group"
            aria-label={`Show ${agent.name}'s chat or terminal`}
            data-agent-chat-switch={agent.id}
            data-chat-mode={mode}
            data-chat-view-asleep={asleep ? "" : undefined}
            // the bar is a drag handle: a press on the switch is a click, never the start of a drag
            draggable={false}
            onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            className={cn(
                "flex shrink-0 cursor-default rounded-[5px] border border-border bg-surface-raised p-[2px]",
                asleep && "opacity-40"
            )}
        >
            <MotionConfig reducedMotion="user">
                {OPTIONS.map((o) => (
                    <button
                        key={o.key}
                        type="button"
                        aria-pressed={mode === o.key}
                        title={asleep ? ASLEEP_VIEW_TITLE : `${o.label} (${key} in the focused cell)`}
                        disabled={asleep}
                        onClick={() => selectCellView(agent.id, o.key, Date.now())}
                        className={cn(
                            "relative rounded-[3px] border-0 bg-transparent px-[7px] py-[1px] text-[10.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            asleep ? "cursor-default" : "cursor-pointer",
                            mode === o.key ? "text-primary" : cn("text-muted", !asleep && "hover:text-primary")
                        )}
                    >
                        {mode === o.key ? (
                            <motion.span
                                layoutId={fillId}
                                data-slide-fill
                                aria-hidden
                                transition={indicatorSlide}
                                className="absolute inset-0 rounded-[inherit] bg-accentbg"
                            />
                        ) : null}
                        <span className="relative">{o.label}</span>
                    </button>
                ))}
            </MotionConfig>
        </div>
    );
}
