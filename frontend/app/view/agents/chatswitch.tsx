// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Chat / Terminal toggle: one icon button that shows the view a click switches to (the terminal mark while Chat
// shows, the speech bubble while the terminal does). It sits in a split cell's bar and in the single-cell header when
// Chat and Terminal are the only views; a header that also offers a canvas, brainstorm or review keeps the worded
// control. Asleep it stays drawn, dimmed and disabled: a sleeping agent always draws the conversation, and there is no
// terminal to show until it is woken.

import { MOTION } from "@/app/element/motiontokens";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { MessageSquare, SquareTerminal } from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import type { AgentVM } from "./agentsviewmodel";
import type { ChatMode } from "./chatmode";
import { selectCellView, useChatMode } from "./chatmodestore";

export const ASLEEP_VIEW_TITLE = "Wake the agent to show its terminal";

export function ChatToggle({
    agent,
    className,
    iconSize,
    keyHint,
}: {
    agent: AgentVM;
    className: string;
    iconSize: number;
    // where the chord works, after it in the title: the header's switches the focused agent, a cell's the focused cell
    keyHint?: string;
}) {
    const asleep = agent.sleeping != null;
    // asleep, the agent draws the conversation whatever the stored mode says
    const stored = useChatMode(agent);
    const mode: ChatMode = asleep ? "chat" : stored;
    const next: ChatMode = mode === "chat" ? "terminal" : "chat";
    const key = formatChordString("Mod:Shift:k");
    const label = next === "terminal" ? "Show terminal" : "Show chat";
    const Icon = next === "terminal" ? SquareTerminal : MessageSquare;
    return (
        <button
            type="button"
            data-agent-chat-switch={agent.id}
            data-chat-view={mode}
            data-chat-view-asleep={asleep ? "" : undefined}
            aria-label={label}
            title={asleep ? ASLEEP_VIEW_TITLE : `${label} (${key}${keyHint ? ` ${keyHint}` : ""})`}
            disabled={asleep}
            // a cell's bar is a drag handle: a press on the toggle is a click, never the start of a drag
            draggable={false}
            onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onClick={() => selectCellView(agent.id, next, Date.now())}
            className={cn(
                className,
                "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
            )}
        >
            <MotionConfig reducedMotion="user">
                {/* re-keyed so each switch replays the fade-in, marking the flip */}
                <motion.span
                    key={next}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                    className="block"
                >
                    <Icon size={iconSize} strokeWidth={1.8} aria-hidden />
                </motion.span>
            </MotionConfig>
        </button>
    );
}
