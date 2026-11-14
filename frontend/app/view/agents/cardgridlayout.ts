// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit grid's pure layout: which column a card sits in and how much of the column's height it takes.
// The columns are flex columns at least one viewport tall, so these numbers are flex shares and floors,
// not pixel rects. No React, no atoms.

import { springPop, springReveal } from "@/app/element/motiontokens";
import type { TargetAndTransition, Transition, Variants } from "motion/react";
import type { ChipFilter } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { leadAgentOf, roleRunId, runFinished, type Lineage, type RunInfo } from "./runlineage";

// a card that needs you is readable at a glance; below these the content clips
export const CARD_MIN_PX = { agent: 200, agentAsk: 320, run: 280, runAsk: 400 } as const;

export interface CardShare {
    grow: 1 | 2;
    minPx: number;
}

// the grid's content width from which one kind of card spreads over three columns: three asking cards of
// about 440px each, so a maximized window fills its width instead of stretching two cards across it
export const GRID_THREE_COL_MIN_PX = 1340;

/** Pure: how many columns one kind of card spreads over at this grid width (0 = not measured yet). */
export function gridColumnCount(gridWidthPx: number): number {
    return gridWidthPx >= GRID_THREE_COL_MIN_PX ? 3 : 2;
}

/** Pure: leads in column 1 and agents in column 2 when both are present, so a lead never trades places
 *  with an agent as states change. One kind alone alternates across `cols` columns (never more than there
 *  are cards); a lone card spans. */
export function splitGridColumns<T>(items: T[], isRun: (t: T) => boolean, cols = 2): T[][] {
    const runs = items.filter(isRun);
    const plain = items.filter((t) => !isRun(t));
    if (runs.length > 0 && plain.length > 0) {
        return [runs, plain];
    }
    if (items.length <= 1) {
        return items.length === 1 ? [items] : [];
    }
    const n = Math.min(cols, items.length);
    return Array.from({ length: n }, (_, c) => items.filter((_, i) => i % n === c));
}

/** Pure: a card's flex share of its column and its floor. */
export function cardShare(isRun: boolean, needsYou: boolean): CardShare {
    if (isRun) {
        return { grow: needsYou ? 2 : 1, minPx: needsYou ? CARD_MIN_PX.runAsk : CARD_MIN_PX.run };
    }
    return { grow: needsYou ? 2 : 1, minPx: needsYou ? CARD_MIN_PX.agentAsk : CARD_MIN_PX.agent };
}

// What the grid hands one card to move on the spring (docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md, §3);
// only the grid's own call passes it, so the Office panel's card moves on springPop alone.
export interface GridCardMotion {
    // mount at the end state: a first load, a batch, or a card that was in the grid already (re-dealt to another column,
    // so this is the same card arriving by its layoutId, not a new one)
    still: boolean;
    // the card's layout transition: the spring for one change, no time for a batch or under reduced motion
    layout: Transition;
    // the grid's layout as one string (gridLayoutKey): a layout animation runs only when it changes, never on a resize
    dep: string;
}

/** Pure: the layout props of one of a grid card's direct parts (header, banner, body). While the card slides or resizes
 *  its box is scaled by the layout animation, which squashes everything inside it; a part that carries `layout` is
 *  counter-scaled by motion and keeps its own size. It keys on the card's `dep` and rides the card's layout transition
 *  (a child does not inherit it), so the parts measure and move exactly when the card does and never on a re-render of
 *  the live feed. No `grid` (the Office panel's card): no props.
 *  A part whose own size changes with the card's (the body, which takes what the header and strips leave) passes
 *  "position": plain `layout` would animate its size as a scale and squash its content with it, so it takes its new size
 *  at once and slides in place, and the card's clipped edge opens over it.
 *  `id` is the part's own layoutId (the card's id and the part's name): a card re-dealt to the other column is a new
 *  instance, and a part with no counterpart in the old copy has nothing to start from, so it trails its card by the
 *  distance the card has to travel. Sharing the id gives it the old part's box to slide from, as its card has. */
export function gridPartLayout(grid: GridCardMotion | undefined, id: string, layout: true | "position" = true) {
    return grid
        ? ({ layout, layoutId: id, layoutDependency: grid.dep, transition: { layout: grid.layout } } as const)
        : {};
}

/** Pure: the grid's layout as one string, which column and which flex share each card has. A card's layout animation is
 *  keyed on it, so cards slide only when the layout changes: a window resize re-lays the same string out at a new size
 *  and must not set every card sliding behind the cursor. */
export function gridLayoutKey<T>(columns: T[][], place: (t: T) => { id: string; share: CardShare }): string {
    return columns
        .map((col) =>
            col
                .map((t) => {
                    const { id, share } = place(t);
                    return `${id}:${share.grow}:${share.minPx}`;
                })
                .join(",")
        )
        .join("|");
}

// What a column's AnimatePresence hands a leaving card (its `custom`): the ids still in the grid, and whether this change
// is a batch. A leaving card reads its exit from the props of its last render, so the render that removes it cannot say
// either, and only `custom` reaches it.
export interface GridExit {
    stay: ReadonlySet<string>;
    instant: boolean;
}

// gone at the next frame: opacity 0 with no time, so it never shows a frame beside the cards that took its place
const LEAVE_AT_ONCE: TargetAndTransition = { opacity: 0, transition: { duration: 0 } };

/** The variants of one grid card: springPop in, and out on springPop only when the card is really gone. A card still in
 *  the grid (re-dealt to the other column, where its copy slides from this box) or leaving in a batch is gone at once, so
 *  it never fades or pops beside its own copy. Without a `custom` (the Office panel's card) it is plain springPop. */
export function gridCardVariants(id: string): Variants {
    return {
        ...springPop,
        exit: (exit?: GridExit) =>
            exit != null && (exit.instant || exit.stay.has(id))
                ? LEAVE_AT_ONCE
                : (springPop.exit as TargetAndTransition),
    };
}

// a list row of the Idle, Backgrounded and Background sections: springReveal, and at once when it leaves in a batch
// (its AnimatePresence's `custom` is true then)
const ROW_LEAVES_AT_ONCE: TargetAndTransition = { opacity: 0, height: 0, transition: { duration: 0 } };
export const batchReveal: Variants = {
    ...springReveal,
    exit: (instant?: boolean) => (instant ? ROW_LEAVES_AT_ONCE : (springReveal.exit as TargetAndTransition)),
};

// a card is a plain agent or an orchestrator run; a run's card carries its lead whenever the lead is in the roster
export type GridCard =
    | { kind: "agent"; id: string; agent: AgentVM }
    | { kind: "run"; id: string; run: RunInfo; lead?: AgentVM };

const LEADLESS_PREFIX = "run:";

/** Pure: the grid's cards in the order of `shown`. A run's workers are rows of its card, never cards of their
 *  own. A run gets one card at the place of whichever of its lead or workers is shown first, and the card
 *  carries the lead from the roster even when the lead itself is parked or filtered out. */
export function buildGridCards(shown: AgentVM[], lineage: Lineage, roster: AgentVM[]): GridCard[] {
    const cards: GridCard[] = [];
    const placed = new Set<string>();
    for (const a of shown) {
        const role = lineage.roles[a.id];
        const runId = role ? roleRunId(role) : undefined;
        if (runId == null || !lineage.runs[runId]) {
            cards.push({ kind: "agent", id: a.id, agent: a });
            continue;
        }
        if (placed.has(runId)) {
            continue;
        }
        placed.add(runId);
        const lead = role?.kind === "lead" ? a : leadAgentOf(lineage, roster, runId);
        cards.push({ kind: "run", id: lead?.id ?? `${LEADLESS_PREFIX}${runId}`, run: lineage.runs[runId], lead });
    }
    return cards;
}

const FINISHED_RUN = new Set(["done", "cancelled"]);

/** Pure: `shown` plus each lead in `scoped` whose run is still going. A lead idles between wakes, so parking it
 *  (or Live only) must not take its running run off the grid. */
export function withActiveRunLeads(shown: AgentVM[], scoped: AgentVM[], lineage: Lineage): AgentVM[] {
    const ids = new Set(shown.map((a) => a.id));
    const extra = scoped.filter((a) => {
        const role = lineage.roles[a.id];
        const dag = role?.kind === "lead" ? lineage.runs[role.runId]?.dag : undefined;
        return !ids.has(a.id) && dag != null && !FINISHED_RUN.has(dag.status);
    });
    return extra.length > 0 ? [...shown, ...extra] : shown;
}

/** Pure: backgrounding a lead backgrounds its run's card, until something in the run needs you. */
export function isBackgroundedRun(card: GridCard, backgroundedIds: Set<string>, needsYou: boolean): boolean {
    return card.kind === "run" && card.lead != null && backgroundedIds.has(card.lead.id) && !needsYou;
}

/** Pure: does the status chip show this card. A run card shows under Asking when anything in it needs you. */
/** Pure: a status tab's press. Pressing the selected tab again returns to everything. */
export function toggleChip(current: ChipFilter, pressed: ChipFilter): ChipFilter {
    return current === pressed ? "all" : pressed;
}

export function cardMatchesChip(card: GridCard, chip: ChipFilter, needsYou: boolean): boolean {
    if (chip === "all") {
        return true;
    }
    if (card.kind === "agent") {
        return card.agent.state === chip;
    }
    if (chip === "asking") {
        return needsYou;
    }
    if (chip === "working") {
        return card.lead?.state === "working" || card.run.dag?.status === "running";
    }
    // a run is up for review once it ends; a lead idling between wakes is still running it
    return runFinished(card.run);
}

// what the keyboard does on a focused task row: open, answer the worker's question, or run the row's actions
export interface RowTarget {
    openId?: string;
    askAgentId?: string;
    actions: (() => void)[];
}

/** Pure: whose question the cursor is on: a card's own agent, or the asking worker of a task row. */
export function askerAt(
    cursorId: string | undefined,
    roster: AgentVM[],
    rowTargets: Record<string, RowTarget>
): AgentVM | undefined {
    if (cursorId == null) {
        return undefined;
    }
    const id = cursorId in rowTargets ? rowTargets[cursorId].askAgentId : cursorId;
    return id != null ? roster.find((a) => a.id === id) : undefined;
}

/** Pure: each column's cursor stops: a card, then its task rows. */
export function columnNavIds(columns: GridCard[][], rowKeysOf: (card: GridCard) => string[]): string[][] {
    return columns.map((col) => col.flatMap((c) => [c.id, ...rowKeysOf(c)]));
}

/** Pure: h/l. From a card or one of its rows, go to the card at the same card index in the neighbouring column. */
export function columnJump(
    cols: string[][],
    cardOf: (id: string) => string,
    cur: string | undefined,
    dir: -1 | 1
): string | undefined {
    if (cols.length < 2 || cur == null) {
        return undefined;
    }
    const card = cardOf(cur);
    const cardsIn = (col: string[]) => col.filter((id) => cardOf(id) === id);
    const from = cols.findIndex((col) => col.includes(cur));
    const to = from + dir;
    if (from < 0 || to < 0 || to >= cols.length) {
        return undefined;
    }
    const target = cardsIn(cols[to]);
    return target[Math.min(cardsIn(cols[from]).indexOf(card), target.length - 1)];
}

/** Pure: keep the cursor on something visible. An id with no stop of its own (a worker, whose ask lives in its
 *  lead's row) goes to its alias. */
export function resolveCursor(
    cur: string | undefined,
    nav: string[],
    alias: Record<string, string>
): string | undefined {
    if (nav.length === 0) {
        return undefined;
    }
    if (cur != null && nav.includes(cur)) {
        return cur;
    }
    const aliased = cur != null ? alias[cur] : undefined;
    return aliased != null && nav.includes(aliased) ? aliased : nav[0];
}
