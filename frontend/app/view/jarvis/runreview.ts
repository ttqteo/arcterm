// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// To review (spec 2026-11-19-run-followups-visible-design.md): the chunks the runs' leads proposed, grouped by run, which
// the Brief draws as one strip and a sheet. Pure: the groups are wavesrv's (WorkState.runreview, jarvisstate.RunReview);
// this derives what is drawn from them, the hidden keys (briefUndo's pending Later and Drop) and the ticks, and what the
// Start button does. runreviewstore.ts holds the state and runreviewsheet.tsx draws it.

import { formatAgeShort } from "@/app/view/agents/agentsviewmodel";
import { chunkKey } from "./briefundo";
import type { NewRunPrefill } from "./newrun";

export type ReviewItem = RunReviewItem & { key: string };
export type ReviewGroup = Omit<RunReviewGroup, "items"> & { items: ReviewItem[] };

// what the footer says with nothing ticked, and what Start says when the ticked items belong to two projects
export const TICK_PROMPT = "Tick what to do, then start one run with it.";
export const REFUSAL_PROJECTS = "Tick items from one project to start a run";

// a chunk is named by its initiative and its label, as briefUndo hides it
export const reviewKey = (i: Pick<RunReviewItem, "effortoid" | "label">): string =>
    chunkKey("effort:" + i.effortoid, i.label);

/**
 * The keys of every proposal To review lists, read off the snapshot's own groups (WorkState.runreview), not off what the
 * sheet draws: a row a pending Later or Drop folds is still a proposed chunk until its edit lands, so it must not drop
 * back into an initiative's "N proposed" for the length of the undo window.
 */
export function listedKeys(groups: RunReviewGroup[] | undefined): ReadonlySet<string> {
    return new Set((groups ?? []).flatMap((g) => g.items.map(reviewKey)));
}

/**
 * The labels of an initiative's proposed chunks that To review does not list: the ones its row still counts (spec decision
 * 12, a run's proposal is decided in To review only). `effortOref` is the initiative's oref, `listed` is `listedKeys`;
 * with no To review data every label stays.
 */
export function unlistedProposals(
    effortOref: string,
    labels: string[],
    listed: ReadonlySet<string> | undefined
): string[] {
    if (listed == null || listed.size === 0) {
        return labels;
    }
    const effortoid = effortOref.replace(/^effort:/, "");
    return labels.filter((label) => !listed.has(reviewKey({ effortoid, label })));
}

/**
 * The groups the sheet draws: a row a pending Later or Drop hides is out at once, and so is one whose edit went through
 * while the Brief's snapshot still lists it (`settled`), so it does not come back for the length of a refetch. A group
 * with no row left is out too. wavesrv's order is kept (oldest run first, each run's oldest proposal first).
 */
export function visibleGroups(
    groups: RunReviewGroup[] | undefined,
    hidden: ReadonlySet<string>,
    settled: ReadonlySet<string>
): ReviewGroup[] {
    const out: ReviewGroup[] = [];
    for (const g of groups ?? []) {
        const items: ReviewItem[] = [];
        for (const i of g.items) {
            const key = reviewKey(i);
            if (!hidden.has(key) && !settled.has(key)) {
                items.push({ ...i, key });
            }
        }
        if (items.length > 0) {
            out.push({ ...g, items });
        }
    }
    return out;
}

const countOf = (groups: ReviewGroup[]) => groups.reduce((n, g) => n + g.items.length, 0);

/** The strip's and the sheet's count line: "<N> things <M> runs left". */
export function stripLine(groups: ReviewGroup[]): string {
    const things = countOf(groups);
    const runs = groups.length;
    return `${things} ${things === 1 ? "thing" : "things"} ${runs} ${runs === 1 ? "run" : "runs"} left`;
}

/** "oldest 3d": how long the oldest proposal still drawn has waited; "" with nothing to review. */
export function oldestLine(groups: ReviewGroup[], now: number): string {
    let oldest = Infinity;
    for (const g of groups) {
        for (const i of g.items) {
            oldest = Math.min(oldest, i.proposedts);
        }
    }
    return Number.isFinite(oldest) ? `oldest ${formatAgeShort(now - oldest)}` : "";
}

/** A group's age is its run's. */
export function groupAge(g: Pick<RunReviewGroup, "createdts">, now: number): string {
    return formatAgeShort(now - g.createdts);
}

/** Every drawn row's key, in the order drawn: the sheet's j/k order. */
export function reviewRowKeys(groups: ReviewGroup[]): string[] {
    return groups.flatMap((g) => g.items.map((i) => i.key));
}

/** The ticked rows still drawn, in the order drawn. A tick whose row is gone does not count. */
export function tickedKeys(groups: ReviewGroup[], ticks: ReadonlySet<string>): string[] {
    return reviewRowKeys(groups).filter((k) => ticks.has(k));
}

export const footerLine = (marked: number): string => (marked === 0 ? TICK_PROMPT : `${marked} marked to do`);

export const startLabel = (marked: number): string => `Start a run with ${marked} ${marked === 1 ? "item" : "items"}`;

export type StartPlan =
    // nothing ticked: Start does nothing
    | { kind: "none" }
    // the ticked items belong to two projects: the footer says so and nothing changes
    | { kind: "refuse"; line: string }
    | { kind: "start"; prefill: NewRunPrefill };

/**
 * What Start does with the ticked rows. The goal is a line per item, its label and its initiative; one item is a quick
 * run and more are an orchestrator's (the launcher can change it). An initiative with no project fits any, so the run's
 * project is the one the ticked items that have a project share, "" when none has one (the launcher's pick). Two
 * different projects refuse.
 */
export function startPlan(groups: ReviewGroup[], ticks: ReadonlySet<string>): StartPlan {
    const picked = groups.flatMap((g) => g.items).filter((i) => ticks.has(i.key));
    if (picked.length === 0) {
        return { kind: "none" };
    }
    const projects = new Set(picked.map((i) => i.project ?? "").filter((p) => p !== ""));
    if (projects.size > 1) {
        return { kind: "refuse", line: REFUSAL_PROJECTS };
    }
    return {
        kind: "start",
        prefill: {
            projectName: [...projects][0] ?? "",
            goal: picked.map((i) => `- ${i.label} (${i.efforttitle})`).join("\n"),
            shape: picked.length === 1 ? "quick" : "orchestrator",
            chunks: picked.map((i) => ({ effortoid: i.effortoid, chunklabel: i.label })),
        },
    };
}

/**
 * The settled keys to keep once a snapshot lands: an edit that went through leaves its key settled while the snapshot
 * still lists the chunk (briefUndo un-hides a key as its commit returns, a refetch earlier), and drops it once a
 * snapshot no longer does. The same set comes back when nothing dropped, so the atom does not churn.
 */
export function pruneSettled(settled: ReadonlySet<string>, snapshot: RunReviewGroup[] | undefined): Set<string> {
    const listed = new Set((snapshot ?? []).flatMap((g) => g.items.map(reviewKey)));
    const kept = [...settled].filter((k) => listed.has(k));
    return kept.length === settled.size ? (settled as Set<string>) : new Set(kept);
}

/** Where the sheet's cursor goes when `key`'s row folds away: the next row, else the one before, else nowhere. */
export function neighborKey(keys: string[], key: string): string | undefined {
    const at = keys.indexOf(key);
    if (at < 0) {
        return undefined;
    }
    return keys[at + 1] ?? keys[at - 1];
}
