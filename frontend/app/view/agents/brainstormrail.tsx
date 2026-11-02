// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The brainstorm's right rail: Boards beside Decided so far (or the builder check's own rail), one width the user drags.
// The pure rules (widths, columns, tabs, board heads) are in brainstormmodel.ts; this file draws them.
//
// This is the interface the wiring builds on. The rail itself is still only the second tab's content in an aside sized
// as the rail with no Boards tab; the Boards tab, the tab strip, the handle and the widened board land beside it.

import { cn } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { ReactNode } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { RAIL_MIN_W, RAIL_MIN_W_CHECK, type BrainstormFile } from "./brainstormmodel";
import type { BrainstormState } from "./brainstormstore";

// The option index hovered or ticked in the question, or null. The options set it (and clear it), and so does a board's
// tile in the rail: the option lights up beside the board it is tied to, and the board beside its option.
export const optionHoverAtom = atomFamily(
    (_agentId: string) => atom<number | null>(null) as PrimitiveAtom<number | null>
);

// The part the rail is asked to show. A new nonce, even for the same part, switches the rail to Boards and scrolls to the
// part's group, so the same click twice still moves it.
export type RailFocus = { partId: string; nonce: number };

export type BrainstormRailProps = {
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
    // the rail's other tab: Decided so far in the design, the builder check's own rail in the check. `tabbed` is true
    // when a tab strip sits above it (the rail has a Boards tab too), false when it is the whole rail
    second: { label: string; render: (tabbed: boolean) => ReactNode };
    // the rail's smallest width: RAIL_MIN_W in the design, RAIL_MIN_W_CHECK in the check
    minWidth?: number;
    // a question is open (it decides which tabs there are, railTabs)
    question: boolean;
    focus: RailFocus | null;
};

export function BrainstormRail({ second, minWidth = RAIL_MIN_W }: BrainstormRailProps) {
    return (
        <aside
            data-brainstorm-board-rail
            className={cn(
                "flex-none overflow-y-auto border-l border-border bg-surface",
                minWidth === RAIL_MIN_W_CHECK ? "w-[460px]" : "w-[32%] min-w-[280px] max-w-[500px]"
            )}
        >
            {second.render(false)}
        </aside>
    );
}

// The row that holds the question's column and the rail. `question` is what fills the column, which keeps what the
// question has always had: the rest of the row, the background, and room to shrink.
export function RailRow({ question, rail }: { question: ReactNode; rail: ReactNode }) {
    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col bg-background">{question}</div>
            {rail}
        </div>
    );
}
