// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The quick pick card at the end of Chat (docs/superpowers/specs/2026-11-16-canvas-quick-pick-design.md): the agent's
// question over one row per option board of its Canvas. A row sends `A — <title>` to the agent at once; its small
// button and the footer link open the board, or all of them, in the Canvas. What shows and what is sent is
// chatcanvaspick.ts's; the shell and the rows are the brainstorm card's (chatbrainstormparts.tsx).

import { cn } from "@/util/util";
import { ArrowUpRight, PanelsTopLeft } from "lucide-react";
import type { AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import { ERROR_LINE, useAction } from "./brainstormui";
import { ALL_TAB } from "./canvasmodel";
import { selectCanvasTab } from "./canvasstore";
import { CardShell, FOCUS_RING, OptionRows } from "./chatbrainstormparts";
import { pickLine, type CanvasPick } from "./chatcanvaspick";

function openInCanvas(agentId: string, tab: string): void {
    selectCanvasTab(agentId, tab);
    setAgentView(agentId, "canvas", Date.now());
}

/** `send` delivers the row's line to the agent; once it resolves, `onSent` hears it (the pane then hides the card). */
export function ChatCanvasPickCard({
    agent,
    pick,
    send,
    onSent,
}: {
    agent: AgentVM;
    pick: CanvasPick;
    send: (line: string) => Promise<void>;
    onSent: () => void;
}) {
    const act = useAction();
    const sendRow = async (i: number) => {
        if (act.busy) {
            return;
        }
        if (await act.run(() => send(pickLine(pick.rows[i])))) {
            onSent();
        }
    };
    return (
        <CardShell
            kind="canvaspick"
            state="waiting"
            head="Pick a board"
            icon={<PanelsTopLeft size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            label="Pick a board from the Canvas"
            extra={{ "data-chat-canvaspick": agent.id }}
        >
            <div data-chat-canvaspick-question className="text-[15px] font-semibold leading-[1.45] text-primary">
                {pick.question}
            </div>
            <OptionRows
                options={pick.rows.map((r) => ({ label: r.title, detail: "" }))}
                letters={pick.rows.map((r) => r.letter)}
                pick={null}
                pickLabel=""
                disabled={act.busy}
                onSend={(_, i) => void sendRow(i)}
                trail={(i) => (
                    <button
                        type="button"
                        data-chat-canvaspick-open={pick.rows[i].board}
                        title={`Open board ${pick.rows[i].letter} in Canvas`}
                        aria-label={`Open board ${pick.rows[i].letter} in Canvas`}
                        onClick={() => openInCanvas(agent.id, pick.rows[i].board)}
                        className={cn(
                            "flex flex-none cursor-pointer items-center border-0 bg-transparent px-[12px] text-muted hover:text-primary",
                            FOCUS_RING
                        )}
                    >
                        <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
                    </button>
                )}
            />
            {act.error ? (
                <div role="alert" className={ERROR_LINE}>
                    {act.error}
                </div>
            ) : null}
            <div className="flex items-center gap-[10px] border-t border-edge-mid pt-[10px] text-[12px] text-muted">
                <button
                    type="button"
                    data-chat-canvaspick-compare
                    onClick={() => openInCanvas(agent.id, ALL_TAB)}
                    className={cn(
                        "flex cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent p-0 text-accent-soft hover:underline",
                        FOCUS_RING
                    )}
                >
                    <PanelsTopLeft size={13} strokeWidth={2} aria-hidden />
                    {`Compare ${pick.rows.length} boards in Canvas`}
                </button>
                <span className="ml-auto text-right">Type below to answer in your own words</span>
            </div>
        </CardShell>
    );
}
