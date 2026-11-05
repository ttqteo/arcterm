// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Brief's council sheet draws (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md, decision 8; board
// Council.dc.html): the head, the verdict block (or the round of a council still at work, or what a failed or stopped
// one finished), the ranked directions with their First step, Ask next, the folded Also raised / Matrix line, the foot's
// saved report, and what Work on and Add to initiative… hand on. Built on the Agent surface's report model
// (councilsummarymodel.ts) and the chat's Ask next (councilchatmodel.ts askChips): nothing here re-derives a rule those
// already hold. Pure, no React.

import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { askChips } from "@/app/view/agents/councilchatmodel";
import { failedWhile } from "@/app/view/agents/councildiscussionmodel";
import {
    askedParts,
    headerChip,
    panel,
    rankedProposals,
    readableReplies,
    roundsOf,
    sentProposals,
    treeMeta,
    UNTITLED_COUNCIL,
} from "@/app/view/agents/councilmodel";
import {
    answerParts,
    directionRows,
    docPathLabel,
    isBrainstorm,
    keptHeading,
    keptRows,
    outcomeLabel,
    projectNameOf,
    type DirectionRow,
} from "@/app/view/agents/councilsummarymodel";
import { projectName } from "./briefrows";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---- the head ----

export interface CouncilSheetHead {
    chip: string; // `council · review`, `council · brainstorm`
    question: string; // what was asked (its limits left out), else the feature
    meta: string; // `website · 6 experts · done 1d`
}

/** Pure: the sheet's head. A council saved before modes reads as a Review (isBrainstorm). The state word is the Agent
 *  tree's (treeMeta), lower-cased, with the age since the council last saved. */
export function councilSheetHead(
    c: Council,
    projects: Record<string, { path?: string }> | null,
    now: number
): CouncilSheetHead {
    const asked = askedParts(c.question).question.replace(/\s+/g, " ").trim();
    const n = panel(c).length;
    const state = treeMeta(c).text.toLowerCase();
    const ts = c.updated || c.created;
    return {
        chip: `council · ${isBrainstorm(c) ? "brainstorm" : "review"}`,
        question: asked !== "" ? asked : c.feature.trim() || UNTITLED_COUNCIL,
        meta: [projectName(c.project, projects), plural(n, "expert", "experts"), `${state} ${formatAge(now - ts)}`]
            .filter((p) => p !== "")
            .join(" · "),
    };
}

// ---- the verdict block ----

export type CouncilVerdict =
    // a council that ended with its summary: the bold one-line answer and the summary under it
    | { kind: "verdict"; answer: string; summary: string }
    // still at work, waiting on the person, or queued: its step instead of a verdict, and the live discussion link
    | { kind: "working"; step: string; line: string }
    // failed, stopped or not run (or done with no summary): it says so, with what finished, and an earlier answer
    // when it has one
    | { kind: "ended"; title: string; finished: string; error: string; answer: string; summary: string };

const WORKING = new Set(["running", "awaiting-you", "queued"]);

// `2 of 2 rounds · 6 ideas · 12 replies`: what a council that ended early got through
function finishedLine(c: Council): string {
    const rounds = roundsOf(c);
    const done = Math.max(0, Math.min(c.round - 1, rounds));
    const ideas = sentProposals(c).length;
    const replies = readableReplies(c).length;
    if (done === 0 && ideas === 0 && replies === 0) {
        return "Nothing finished";
    }
    return `Finished ${done} of ${plural(rounds, "round", "rounds")} · ${plural(ideas, "idea", "ideas")} · ${plural(replies, "reply", "replies")}`;
}

/** Pure: what the sheet's verdict block shows. A done council (a stopped one with its summary reads as done, as the
 *  Agent tree has it) shows its answer; one still at work its step (`Round 2 of 2`, `Writing the summary`, `Waiting on
 *  you`, `Queued`) and how far it got; a failed or stopped one says so with what finished. */
export function councilVerdict(c: Council): CouncilVerdict {
    if (WORKING.has(c.state)) {
        const ideas = sentProposals(c).length;
        const replies = readableReplies(c).length;
        return {
            kind: "working",
            step: c.state === "queued" ? "Queued" : headerChip(c),
            line: `${plural(ideas, "idea", "ideas")} · ${plural(replies, "reply", "replies")} so far`,
        };
    }
    const done = c.state === "done" || (c.state === "stopped" && c.summary != null);
    const { answer, rest } = c.summary != null ? answerParts(c) : { answer: "", rest: "" };
    if (done && c.summary != null) {
        return { kind: "verdict", answer, summary: rest };
    }
    const title =
        c.state === "failed"
            ? failedWhile(c, c.round)
            : c.state === "stopped"
              ? `Stopped in round ${Math.max(1, Math.min(c.round, roundsOf(c)))} of ${roundsOf(c)}`
              : c.state === "not-run"
                ? "Not run"
                : "Ended with no summary";
    return { kind: "ended", title, finished: finishedLine(c), error: (c.error ?? "").trim(), answer, summary: rest };
}

// ---- the directions ----

export interface SheetDirection {
    row: DirectionRow;
    rank: number;
    title: string;
    agreed: boolean;
    outcome: string; // `✓ Agreed`, or the challenged wording (`Skeptic has doubts`, `RAM is against it`)
    step: string; // the coordinator's first step, or empty
    from: string; // the proposals it came from: `P5, P21`
}

/** Pure: the ranked directions as the sheet lists them, on directionRows (rank order, the tag in words). A direction
 *  everyone agrees with reads `✓ Agreed`; any other carries its tag. */
export function sheetDirections(c: Council): SheetDirection[] {
    return directionRows(c).map((row) => {
        const agreed = row.tag === "Everyone agrees";
        return {
            row,
            rank: row.direction.rank,
            title: row.direction.title.trim(),
            agreed,
            outcome: agreed ? "✓ Agreed" : row.tag,
            step: row.step,
            from: row.direction.from.join(", "),
        };
    });
}

// ---- Ask next ----

export interface SheetAsk {
    to: string; // the seat's name, or `Whole panel`
    text: string;
    fill: string; // what Ask in chat drafts in the Discussion's box
}

/** Pure: the report's questions to ask next the person has not asked yet (askChips), each with who it is for. */
export function sheetAsks(c: Council): SheetAsk[] {
    return askChips(c).map((a) => ({
        to: a.to === "" ? "Whole panel" : (c.experts.find((e) => e.id === a.to)?.name ?? a.to),
        text: a.text,
        fill: a.fill,
    }));
}

// ---- the folded line: Also raised and the Matrix ----

export interface SheetFold {
    keptLabel: string; // `Also raised`, or a Brainstorm's `Wild ideas kept aside`
    kept: number;
    proposals: number;
}

/** Pure: the one folded line under Ask next, or null when there is nothing behind it. */
export function sheetFold(c: Council): SheetFold | null {
    const kept = keptRows(c).length;
    const proposals = sentProposals(c).length;
    if (kept === 0 && proposals === 0) {
        return null;
    }
    return { keptLabel: keptHeading(c), kept, proposals };
}

export interface MatrixRow {
    id: string; // `P5`
    title: string;
    author: string;
    standing: string; // `3 picks`, or `+2` by score for a council with no picks
    outcome: string; // the summary's outcome for it (outcomeLabel), or empty
    out: boolean; // withdrawn or cut at the pause: drawn dim
}

/** Pure: the Matrix as the fold opens it: every sent proposal by the experts' standing (rankedProposals), with who
 *  wrote it and the outcome the summary gave it. */
export function matrixRows(c: Council): MatrixRow[] {
    const outcomes = c.summary?.outcomes ?? {};
    return rankedProposals(c).map((r) => ({
        id: r.proposal.id,
        title: r.proposal.title.trim(),
        author: c.experts.find((e) => e.id === r.proposal.author)?.name ?? r.proposal.author,
        standing: r.picks != null ? plural(r.picks, "pick", "picks") : r.score > 0 ? `+${r.score}` : String(r.score),
        outcome: outcomeLabel(outcomes[r.proposal.id] ?? ""),
        out: r.proposal.withdrawn === true || r.proposal.cut === true,
    }));
}

// ---- the foot ----

/** Pure: the saved report's path as the foot shows it (relative to the project when inside it), or empty before the
 *  council saved itself. */
export function reportPath(c: Council): string {
    const path = c.docpath ?? "";
    return path === "" ? "" : docPathLabel(c.project, path);
}

// ---- what the actions hand on ----

const MAX_LABEL = 200; // wavesrv's limit on a chunk's label

function clip(text: string, max: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface WorkOnInput {
    project: string | undefined; // the registered project the dialog selects; undefined leaves it unset
    task: string; // the Task box: the direction's title, then its first step
}

/** Pure: what Work on opens the New dialog's agent half with. The council's project is picked by the registered project
 *  that holds its folder; a council with no project path, or one in a folder no project holds, leaves it unset. */
export function workOnInput(
    c: Council,
    d: Pick<SheetDirection, "title" | "step">,
    projects: readonly { name: string; path: string }[]
): WorkOnInput {
    const folder = c.project.trim();
    const step = d.step.trim();
    return {
        project: folder === "" ? undefined : projectNameOf(projects, folder),
        task: step === "" ? d.title : `${d.title}\n\nFirst step: ${step}`,
    };
}

/** Pure: the chunk Add to initiative… adds: the first step, else the direction's title, fit to a chunk's label. */
export function chunkLabelFor(d: Pick<SheetDirection, "title" | "step">): string {
    return clip(d.step.trim() !== "" ? d.step : d.title, MAX_LABEL);
}
