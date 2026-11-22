// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The slim bar over each cell of the agent grid while there is more than one: the agent's status dot and
// name, then what it has beside the conversation (the ◇ chip of the initiative it works on, with its title and `done/total`,
// and the Brainstorm marker with its dot: the surface draws one AgentHeader, for the focused cell, so these are how an
// unfocused cell says it has either; a click focuses the cell and opens its tab on the rail), a Claude agent's Chat |
// Terminal switch (dimmed while it sleeps, ChatSwitch reads that itself), and an x that takes the cell out of the grid (the
// agent keeps running). A terminal's cell shows the terminal mark in place of the dot, and Move to the panel when there is
// an agent to put it under (`onMoveToPanel`), as its head does when it is the one in focus. The bar is also the handle for
// rearranging: drag it onto another cell and the drop zones answer as they do for a row from the tree.

import { globalStore } from "@/app/store/jotaiStore";
import { effortDetailAtom, loadEffortDetail } from "@/app/view/jarvis/effortstore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Diamond, GripVertical, Lightbulb, PanelBottom, Shapes, SquareTerminal, X } from "lucide-react";
import { useEffect } from "react";
import { beginAgentDrag, endAgentDrag } from "./agentdragstore";
import { openRailBrainstorm, openRailInitiative } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { brainstormTabDot } from "./brainstormband";
import { waitsOnUser } from "./brainstormmodel";
import { brainstormAtom, brainstormBandAtom, shownBrainstormFile } from "./brainstormstore";
import { chatCapable } from "./chatmode";
import { ChatSwitch } from "./chatswitch";
import { initiativeTitle } from "./headermodel";
import { chipCount } from "./initiativepopovermodel";
import { StatusDot } from "./statusdot";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const BAR_BUTTON = `flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary ${FOCUS_RING}`;

// The chip and the marker are buttons inside the bar that is the drag handle: a press on one is a click, never the start
// of a drag of the bar (a prevented mousedown starts none)
const noDragStart = (e: React.MouseEvent) => e.preventDefault();

// The ◇ chip of an agent linked to an initiative: its title and `done/total` (the header's chip, one source for the count:
// chipCount). A click focuses this cell and opens the rail's Initiative tab, which takes the keyboard. The name beside it
// gives up width first; under a narrow cell the title is cut and the ◇ and the count stay.
function CellInitiative({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const oref = "effort:" + agent.effortId;
    const effort = useAtomValue(effortDetailAtom).get(oref);
    useEffect(() => {
        // the title is decoration: a failed load leaves the ◇ and the plain word, which still open the tab
        loadEffortDetail(oref).catch(() => {});
    }, [oref]);
    const title = initiativeTitle(agent.name, effort);
    const count = chipCount(effort);
    const words = `${title}${count != null ? `, ${count} chunks done` : ""}. Open the Initiative tab`;
    return (
        <button
            type="button"
            data-agent-cell-initiative={agent.id}
            aria-label={words}
            title={words}
            onMouseDown={noDragStart}
            onClick={() => {
                globalStore.set(model.focusIdAtom, agent.id);
                openRailInitiative(agent.id);
            }}
            className={cn(
                "inline-flex h-[18px] min-w-0 shrink cursor-pointer items-center gap-[4px] rounded-[5px] px-[4px] text-[11px] text-accent-soft hover:bg-surface-hover",
                FOCUS_RING
            )}
        >
            <Diamond size={12} strokeWidth={2} aria-hidden className="flex-none" />
            <span data-agent-cell-initiative-title className="min-w-0 max-w-[120px] truncate">
                {title}
            </span>
            {count != null ? (
                <span data-agent-cell-initiative-progress className="flex-none tabular-nums text-ink-mid">
                    · {count}
                </span>
            ) : null}
        </button>
    );
}

// The Brainstorm marker of an agent with a brainstorm: the rail's Brainstorm icon with its dot (amber while the agent asks,
// the accent while a board is new: the header's switch reads the same brainstormTabDot). The cell never shows the Brainstorm
// view itself, so a click focuses it and opens the rail's Brainstorm tab.
function CellBrainstorm({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const brainstorm = useAtomValue(brainstormAtom(agent.id));
    const band = useAtomValue(brainstormBandAtom(agent.id));
    if (brainstorm == null) {
        return null;
    }
    const file = shownBrainstormFile(brainstorm);
    const asking = file != null && waitsOnUser(file) && agent.state === "asking";
    const newCount = band?.newCount ?? 0;
    const dot = brainstormTabDot(newCount, asking, false);
    const words =
        dot === "asking"
            ? "Brainstorm: asking you. Open the Brainstorm tab"
            : dot === "new"
              ? `Brainstorm: ${newCount} new board${newCount === 1 ? "" : "s"}. Open the Brainstorm tab`
              : "Open the Brainstorm tab";
    return (
        <button
            type="button"
            data-agent-cell-brainstorm={agent.id}
            aria-label={words}
            title={words}
            onMouseDown={noDragStart}
            onClick={() => {
                globalStore.set(model.focusIdAtom, agent.id);
                openRailBrainstorm(agent.id);
            }}
            className={cn(BAR_BUTTON, "relative")}
        >
            <Lightbulb size={12} strokeWidth={2} aria-hidden />
            {dot != null ? (
                <span
                    aria-hidden
                    data-agent-cell-brainstorm-dot={dot}
                    className={cn(
                        "absolute right-[1px] top-[1px] h-[5px] w-[5px] rounded-full",
                        dot === "asking" ? "bg-asking" : "bg-accent"
                    )}
                />
            ) : null}
        </button>
    );
}

export function GridCellBar({
    model,
    agent,
    focused,
    onRemove,
    onMoveToPanel,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    focused: boolean;
    onRemove: () => void;
    onMoveToPanel?: () => void;
}) {
    const terminal = agent.kind === "terminal";
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
            {terminal ? (
                <SquareTerminal size={12} aria-hidden data-agent-cell-terminal className="shrink-0 text-muted" />
            ) : (
                <StatusDot state={agent.state} pulse={agent.state !== "idle"} className="!h-[7px] !w-[7px]" />
            )}
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{agent.name}</span>
            {!terminal && agent.effortId != null ? <CellInitiative model={model} agent={agent} /> : null}
            {!terminal ? <CellBrainstorm model={model} agent={agent} /> : null}
            {chatCapable(agent) ? <ChatSwitch agent={agent} /> : null}
            {terminal && onMoveToPanel != null ? (
                <button
                    type="button"
                    data-agent-cell-to-dock={agent.id}
                    aria-label="Move to the panel"
                    title="Move to the panel"
                    onClick={onMoveToPanel}
                    className={BAR_BUTTON}
                >
                    <PanelBottom size={12} aria-hidden />
                </button>
            ) : null}
            <button
                type="button"
                data-agent-cell-remove={agent.id}
                aria-label={`Remove ${agent.name} from the grid`}
                title="Remove from the grid (the agent keeps running)"
                onClick={onRemove}
                className={BAR_BUTTON}
            >
                <X size={12} aria-hidden />
            </button>
        </div>
    );
}

// The bar over a board cell: the shapes mark, the board's name, the chat it reads, and an x that closes the board (the
// other cells stay). A board cell is a cell of its own, so the bar is a drag handle as a tab's is: drag it onto another
// cell and the drop zones answer as they do for a row from the tree.
export function BoardCellBar({
    cellId,
    title,
    chat,
    onRemove,
}: {
    cellId: string;
    title: string;
    chat: string; // the chat the board reads, "" when it has none
    onRemove: () => void;
}) {
    return (
        <div
            data-board-cell-bar={cellId}
            draggable
            onDragStart={(e) => beginAgentDrag(e, cellId)}
            onDragEnd={endAgentDrag}
            title={`${title}${chat !== "" ? `, reads ${chat}` : ""}. Drag to rearrange`}
            className="flex h-[26px] shrink-0 cursor-grab select-none items-center gap-[7px] border-b border-border bg-surface px-[8px] text-muted active:cursor-grabbing"
        >
            <GripVertical size={12} aria-hidden className="shrink-0 text-ink-faint" />
            <Shapes size={12} aria-hidden className="shrink-0 text-ink-faint" />
            <span className="min-w-0 truncate text-[12px] font-medium">{title}</span>
            {chat !== "" ? (
                <span data-board-cell-chat className="min-w-0 flex-1 truncate text-[11.5px] text-ink-faint">
                    · {chat}
                </span>
            ) : (
                <span className="flex-1" />
            )}
            <button
                type="button"
                data-board-cell-remove={cellId}
                aria-label={`Close the board ${title}`}
                title="Close the board (the other cells stay)"
                onMouseDown={noDragStart}
                onClick={onRemove}
                className={BAR_BUTTON}
            >
                <X size={12} aria-hidden />
            </button>
        </div>
    );
}
