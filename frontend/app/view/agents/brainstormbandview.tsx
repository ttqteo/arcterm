// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The brainstorm part of the Chat band (docs/superpowers/specs/2026-11-14-chat-brainstorm-status-design.md): while a
// brainstorm is attached to the agent, its Chat always says how many boards it has (with a dot for the ones that are new
// since the Brainstorm tab was last looked at) and how many decisions are yours, and opens in place to the decisions and
// the boards. What it reads is brainstormband.ts (through `brainstormBandAtom`); this file draws it. It loads no board page
// (no thumbnail), so it costs no RAM in any number of Chat cells. A click on a board, or on the link, opens the Brainstorm
// tab, which is what takes the board names as seen; expanding the part never does. The root (chatband.tsx) owns the keys.

import { cn } from "@/util/util";
import { ChevronDown, Lightbulb, PanelsTopLeft } from "lucide-react";
import type { MouseEvent } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import type { BrainstormBandModel } from "./brainstormband";
import { toggleBandPart } from "./initiativebandstore";

// a mouse press must not take focus off whatever has it: the band's keys live on its root
const keepFocus = (e: MouseEvent) => e.preventDefault();

const boardsText = (n: number) => `${n} ${n === 1 ? "board" : "boards"}`;

/** Opens the agent's Brainstorm tab: the tab is what the user looks at, so it takes the board names as seen. */
function openBrainstorm(agentId: string): void {
    setAgentView(agentId, "brainstorm", Date.now());
}

/** The part's line: a lightbulb, `Brainstorm`, the board icon and `N boards` (not drawn with none), an accent dot and
 *  `N new` when boards are new, a divider, `Decided N`, a chevron. A brainstorm-only band shows the brainstorm's title
 *  too. In a narrow cell the words go and the icon, the board count with its dot and `Decided N` stay. The whole line is
 *  one button that expands or collapses the part. */
export function BrainstormLine({
    agent,
    bs,
    narrow,
    only,
    open,
}: {
    agent: AgentVM;
    bs: BrainstormBandModel;
    narrow: boolean;
    /** there is no initiative part beside this one */
    only: boolean;
    open: boolean;
}) {
    const boards = bs.boards.length;
    return (
        <button
            type="button"
            data-brainstorm-band={agent.id}
            aria-expanded={open}
            onMouseDown={keepFocus}
            onClick={() => toggleBandPart(agent.id, "brainstorm")}
            title={open ? "Collapse the brainstorm" : "Expand the brainstorm"}
            className={cn(
                "flex h-[36px] min-w-0 cursor-pointer items-center border-0 bg-transparent text-left text-secondary",
                // beside the initiative part it keeps its width (that part gives way); alone it gives way to the title
                only ? "flex-1 overflow-hidden" : "flex-[1_0_auto]",
                narrow ? "gap-[8px] px-3" : only ? "gap-[10px] px-4" : "gap-[10px] pl-[14px] pr-4"
            )}
        >
            <Lightbulb size={13} strokeWidth={1.7} aria-hidden className="flex-none text-warning" />
            {only ? (
                <span
                    data-bsband-title
                    title={bs.title}
                    className="min-w-0 max-w-[320px] truncate text-[12.5px] font-semibold text-ink-hi"
                >
                    {bs.title}
                </span>
            ) : null}
            {narrow && !only ? null : (
                <span
                    className={cn(
                        "flex-none text-[12.5px]",
                        only ? "font-normal text-muted" : "font-semibold text-ink-hi"
                    )}
                >
                    Brainstorm
                </span>
            )}
            {boards > 0 ? (
                <span
                    data-bsband-boards
                    title={narrow ? boardsText(boards) : undefined}
                    className="flex flex-none items-center gap-[6px] text-[12px] text-secondary"
                >
                    <PanelsTopLeft size={13} strokeWidth={1.6} aria-hidden className="flex-none text-muted" />
                    {narrow ? boards : boardsText(boards)}
                </span>
            ) : null}
            {bs.newCount > 0 ? (
                <span
                    data-bsband-new
                    title={narrow ? `${bs.newCount} new` : undefined}
                    className="flex flex-none items-center gap-[5px] text-[11.5px] font-semibold text-accent-soft"
                >
                    <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-accent" />
                    {narrow ? bs.newCount : `${bs.newCount} new`}
                </span>
            ) : null}
            <span aria-hidden className="h-[14px] w-px flex-none bg-edge-mid" />
            <span data-bsband-decided className="flex-none text-[12px] text-secondary">
                Decided {bs.decided.length}
            </span>
            <span className="min-w-0 flex-1" />
            <ChevronDown
                size={14}
                strokeWidth={1.8}
                aria-hidden
                className={cn(
                    "flex-none text-muted transition-transform motion-reduce:transition-none",
                    open && "rotate-180"
                )}
            />
        </button>
    );
}

/** The expanded part, in two columns (one in a narrow cell): `Decided N` (a title, then its gist, per decision that is
 *  yours, in the design's order) and `Boards N` (a button per board: the board icon, its file name with `new` when it is
 *  new, the part it illustrates; then one `Open in Brainstorm (b)` link). The rows are buttons reached with Tab; there is
 *  no arrow-key cursor. */
export function BrainstormBody({
    agent,
    bs,
    narrow,
    only,
}: {
    agent: AgentVM;
    bs: BrainstormBandModel;
    narrow: boolean;
    only: boolean;
}) {
    return (
        <div
            data-bsband-body
            className={cn(
                "grid gap-x-6 gap-y-3 border-t border-edge-mid pb-4 pr-4 pt-[14px]",
                narrow ? "grid-cols-1 pl-4" : only ? "grid-cols-2 pl-[39px]" : "grid-cols-2 pl-[395px]"
            )}
        >
            <div className="flex min-w-0 flex-col gap-[2px]">
                <div className="mb-[6px] text-[11px] text-muted">Decided {bs.decided.length}</div>
                {bs.decided.length === 0 ? <div className="text-[12px] text-muted">Nothing is yours yet.</div> : null}
                {bs.decided.map((d) => (
                    <div key={d.id} data-bsband-decision={d.id} className="flex min-w-0 flex-col gap-px py-[5px]">
                        <span className="break-words text-[12px] font-semibold text-ink-hi">{d.title}</span>
                        <span className="break-words text-[12px] leading-[1.45] text-muted">{d.gist}</span>
                    </div>
                ))}
            </div>
            <div className="flex min-w-0 flex-col gap-[8px]">
                <div className="text-[11px] text-muted">Boards {bs.boards.length}</div>
                {bs.boards.length === 0 ? <div className="text-[12px] text-muted">No boards yet.</div> : null}
                {bs.boards.map((b) => (
                    <button
                        key={b.name}
                        type="button"
                        data-bsband-board={b.name}
                        data-new={b.isNew ? "" : undefined}
                        onMouseDown={keepFocus}
                        onClick={() => openBrainstorm(agent.id)}
                        title="Open it in Brainstorm"
                        className="flex min-w-0 cursor-pointer items-center gap-[10px] rounded-[6px] border-0 bg-transparent p-0 text-left hover:bg-surface-hover"
                    >
                        <PanelsTopLeft size={16} strokeWidth={1.5} aria-hidden className="flex-none text-muted" />
                        <span className="flex min-w-0 flex-col gap-px">
                            <span className="flex min-w-0 items-center gap-[6px] text-[12px] text-ink-hi">
                                <span className="min-w-0 truncate">{b.name}</span>
                                {b.isNew ? (
                                    <span className="flex-none text-[10.5px] font-semibold text-accent-soft">new</span>
                                ) : null}
                            </span>
                            <span className="truncate text-[11px] text-muted">{b.part}</span>
                        </span>
                    </button>
                ))}
                <button
                    type="button"
                    data-bsband-open-brainstorm
                    onMouseDown={keepFocus}
                    onClick={() => openBrainstorm(agent.id)}
                    className="mt-[2px] cursor-pointer self-start border-0 bg-transparent p-0 text-[12px] text-accent-soft hover:underline"
                >
                    Open in Brainstorm (b)
                </button>
            </div>
        </div>
    );
}
