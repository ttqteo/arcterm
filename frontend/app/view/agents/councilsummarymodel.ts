// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the council Summary (councilsummary.tsx) draws, derived from a `Council`: the ranked directions with one stance
// chip per expert and the expert positions behind each, the lines under the header, and the two things the Summary
// hands on: the seed of the initiative Create initiative makes and the first prompt Brainstorm this opens an agent
// with. Pure, no React, no Wave runtime imports, so every rule here has a test (councilsummarymodel.test.ts). The
// stances, ranking and matrix of the whole council are in councilmodel.ts.

import { councilProjectKey, panel, type StanceLabel } from "./councilmodel";

/** The identity token an expert's avatar is drawn in; the view maps each to its (static) Tailwind classes. */
export type ColorKey = "primary" | "conn-1" | "conn-2" | "conn-3" | "conn-6" | "conn-7" | "conn-8";

// the order the canvas gives a panel (UX blue, RAM purple, New user pink, Skeptic orange), then the rest of the
// identity palette; the coordinator is the ivory ink. The Discussion's avatarTone (councildiscussionmodel.ts) uses the
// same slots, so an expert keeps one color across the views: conn-4 (red reads as an error) and conn-5 (conn-1's twin)
// are left out of both
const PANEL_COLORS: ColorKey[] = ["conn-1", "conn-2", "conn-3", "conn-6", "conn-7", "conn-8"];

/** Pure: the color an expert is drawn in, by its place on the panel (a custom role has no fixed color of its own). */
export function expertColor(c: Council, expertId: string): ColorKey {
    const index = panel(c).findIndex((e) => e.id === expertId);
    return index < 0 ? "primary" : PANEL_COLORS[index % PANEL_COLORS.length];
}

/** Pure: the letter in an expert's avatar. */
export function expertInitial(name: string): string {
    return name.trim().charAt(0).toUpperCase();
}

export const STANCE_WORD: Record<StanceLabel, string> = {
    accept: "Accept",
    challenge: "Challenge",
    oppose: "Oppose",
    proposed: "Proposed",
};

function asStance(s: string | undefined): Exclude<StanceLabel, "proposed"> | undefined {
    return s === "accept" || s === "challenge" || s === "oppose" ? s : undefined;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---- the directions ----

export interface StanceChip {
    expert: CouncilExpert;
    stance: StanceLabel;
}

/** One expert's side of a direction: what it said and what it cited. */
export interface Position {
    expert: CouncilExpert;
    stance: StanceLabel;
    text: string; // the proposal's argument for its author, else the expert's last reply of that stance
    evidence: CouncilEvidence[];
}

export interface DirectionRow {
    direction: CouncilDirection;
    meta: string; // `Merged UX P2 + RAM P3 · 1 weak claim · in Ideas`
    chips: StanceChip[]; // the experts that proposed or took a stance, in panel order
    tag: "Agreed" | "Split";
    positions: Position[];
    firstProposal: string; // the proposal "Ask the experts again" opens, or empty when none of `from` is on the council
}

// the evidence of one expert's reply about a proposal, the last reply by time (ties by arrival) of that stance, else
// the last reply of any stance: the expert's "position" on the direction
function lastReply(c: Council, expertId: string, from: Set<string>, stance?: string): CouncilReply | undefined {
    const mine = (c.replies ?? [])
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.author === expertId && from.has(r.proposalid) && (stance == null || r.stance === stance))
        .sort((a, b) => a.r.ts - b.r.ts || a.i - b.i);
    return mine[mine.length - 1]?.r;
}

/** Pure: the experts' positions behind a direction. The experts that proposed one of its proposals come first, then
 *  the rest, each group in panel order. An expert the coordinator gave a stance is shown with its last reply of that
 *  stance; one that only proposed, with the argument of its proposal. An expert with neither is left out. */
export function positionsOf(c: Council, d: CouncilDirection): Position[] {
    const from = new Set(d.from);
    const proposals = (c.proposals ?? []).filter((p) => from.has(p.id));
    const out: { position: Position; proposer: boolean }[] = [];
    for (const expert of panel(c)) {
        const authored = proposals.filter((p) => p.author === expert.id);
        const stance = asStance(d.stances?.[expert.id]);
        if (stance != null) {
            const reply = lastReply(c, expert.id, from, stance) ?? lastReply(c, expert.id, from);
            out.push({
                position: { expert, stance, text: reply?.text ?? "", evidence: reply?.evidence ?? [] },
                proposer: authored.length > 0,
            });
        } else if (authored.length > 0) {
            out.push({
                position: {
                    expert,
                    stance: "proposed",
                    text: authored[0].argument,
                    evidence: authored.flatMap((p) => p.evidence ?? []),
                },
                proposer: true,
            });
        }
    }
    return [...out.filter((x) => x.proposer), ...out.filter((x) => !x.proposer)].map((x) => x.position);
}

// the folder part of a `path:line` ref; a screenshot region is not a file of the project
function fileOf(e: CouncilEvidence): string {
    if (e.weak || e.ref === "" || e.ref.startsWith("screenshot:")) {
        return "";
    }
    return e.ref.replace(/:\d+(-\d+)?$/, "");
}

function fromLine(c: Council, from: string[]): string {
    const named = from.flatMap((id) => {
        const p = (c.proposals ?? []).find((x) => x.id === id);
        return p == null ? [] : [`${c.experts.find((e) => e.id === p.author)?.name ?? p.author} ${p.id}`];
    });
    if (named.length === 0) {
        return "";
    }
    return named.length === 1 ? `From ${named[0]}` : `Merged ${named.join(" + ")}`;
}

/** Pure: the Summary's directions by rank, each with its line of facts, its stance chips and its positions. */
export function directionRows(c: Council): DirectionRow[] {
    const directions = [...(c.summary?.directions ?? [])].sort((a, b) => a.rank - b.rank);
    return directions.map((direction) => {
        const positions = positionsOf(c, direction);
        const evidence = positions.flatMap((p) => p.evidence);
        const files = new Set(evidence.map(fileOf).filter((f) => f !== ""));
        const weak = evidence.filter((e) => e.weak).length;
        const meta = [
            fromLine(c, direction.from),
            files.size > 0 ? plural(files.size, "file", "files") : "",
            weak > 0 ? plural(weak, "weak claim", "weak claims") : "",
            direction.ideaid ? "in Ideas" : "",
        ].filter((part) => part !== "");
        return {
            direction,
            meta: meta.join(" · "),
            chips: panel(c).flatMap((expert): StanceChip[] => {
                const stance = asStance(direction.stances?.[expert.id]);
                if (stance != null) {
                    return [{ expert, stance }];
                }
                const proposed = (c.proposals ?? []).some(
                    (p) => direction.from.includes(p.id) && p.author === expert.id
                );
                return proposed ? [{ expert, stance: "proposed" }] : [];
            }),
            tag: direction.agreed ? "Agreed" : "Split",
            positions,
            firstProposal: direction.from.find((id) => (c.proposals ?? []).some((p) => p.id === id)) ?? "",
        };
    });
}

/** Pure: how a piece of evidence reads on its chip: the ref, or for a weak one why it is weak. */
export function evidenceLabel(e: CouncilEvidence): string {
    if (e.weak) {
        return `Weak · ${e.note || e.ref || "cites no evidence"}`;
    }
    return e.ref.startsWith("screenshot:") ? `Screenshot ${e.ref.slice("screenshot:".length)}` : e.ref;
}

/** Pure: whether the Summary's Summarize and Summarize again can run: what the runner accepts (a council that is done,
 *  stopped, failed or waiting at the pause, with a proposal to summarize). canSummarize (councilmodel.ts) is the
 *  Discussion's rule and is off for a failed or stopped council still at round 1, which the runner does summarize. */
export function canRunSummary(c: Council): boolean {
    return (
        (c.proposals ?? []).length > 0 &&
        (c.state === "done" || c.state === "stopped" || c.state === "failed" || c.state === "awaiting-you")
    );
}

// ---- the lines under the header ----

function clockTime(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Pure: `Written by the coordinator at 11:02 from 18 replies`: the replies the summary read, not the ones since. */
export function writtenLine(c: Council): string {
    const at = c.summary?.at;
    if (at == null) {
        return "";
    }
    const read = (c.replies ?? []).filter((r) => r.ts <= at).length;
    return `Written by the coordinator at ${clockTime(at)} from ${plural(read, "reply", "replies")}`;
}

/** Pure: the banner over a summary the discussion has moved past. */
export function outdatedLabel(n: number): string {
    return `Outdated · ${n} ${n === 1 ? "reply" : "replies"} since`;
}

/** Pure: a saved doc's path as the Summary shows it: relative to the project when it is inside it. */
export function docPathLabel(project: string, path: string): string {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const root = norm(project);
    const file = norm(path);
    return root !== "" && file.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? file.slice(root.length + 1) : path;
}

/** Pure: the registered project that holds a folder, by name (an initiative and a launched agent are filed under the
 *  project's name, a council keeps its folder). Undefined when the folder is none of the projects'. */
export function projectNameOf(projects: readonly { name: string; path: string }[], folder: string): string | undefined {
    const key = councilProjectKey(folder);
    return projects.find((p) => councilProjectKey(p.path) === key)?.name;
}

// ---- what the Summary hands on ----

const MAX_LABEL = 200; // wavesrv's limit on an initiative's title and a chunk's label

function clip(text: string, max: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface InitiativeSeed {
    title: string;
    chunks: { label: string }[];
}

/** Pure: the initiative Create initiative makes: named after the feature, one chunk per direction in rank order.
 *  wavesrv refuses an empty label, a long one and a repeated one, so those are made fit. */
export function initiativeSeed(c: Council): InitiativeSeed {
    const seen = new Set<string>();
    const chunks: { label: string }[] = [];
    for (const d of [...(c.summary?.directions ?? [])].sort((a, b) => a.rank - b.rank)) {
        const base = clip(d.title, MAX_LABEL) || `Direction ${d.rank}`;
        let label = base;
        for (let n = 2; seen.has(label); n++) {
            label = `${clip(base, MAX_LABEL - 4)} (${n})`;
        }
        seen.add(label);
        chunks.push({ label });
    }
    return { title: clip(c.feature, MAX_LABEL) || "Council", chunks };
}

const PROMPT_REPLY_CHARS = 500;
const PROMPT_REPLIES = 30;
const PROMPT_CHARS = 8000;

/** Pure: the first prompt of the agent Brainstorm this opens: the direction, the coordinator's reasoning, the proposals
 *  it came from and their thread, and the ask to record the direction with `wsh idea add` before brainstorming, so the
 *  new session's Ideas holds it. The thread is cut from its oldest end when the whole would be too long for a launch
 *  argument. */
export function brainstormPrompt(c: Council, row: DirectionRow): string {
    const d = row.direction;
    const name = (id: string) => (id === "you" ? "You" : (c.experts.find((e) => e.id === id)?.name ?? id));
    const from = new Set(d.from);
    const proposals = (c.proposals ?? []).filter((p) => from.has(p.id));
    const thread = (c.replies ?? [])
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => from.has(r.proposalid))
        .sort((a, b) => a.r.ts - b.r.ts || a.i - b.i)
        .map(
            ({ r }) =>
                `- ${name(r.author)} on ${r.proposalid}${r.stance ? ` (${r.stance})` : ""}: ${clip(r.text, PROMPT_REPLY_CHARS)}`
        );
    const head = [
        `Brainstorm this direction with me. A council of expert agents reviewed "${c.feature}"${c.question ? ` (${clip(c.question, 300)})` : ""} and ranked this direction ${d.rank}, ${row.tag.toLowerCase()}.`,
        "",
        `Direction: ${d.title}`,
        d.reasoning ? `Why: ${clip(d.reasoning, 1000)}` : "",
        "",
        ...(proposals.length > 0
            ? [
                  "It came from:",
                  ...proposals.map((p) => `- ${p.id} by ${name(p.author)}, ${p.title}: ${clip(p.argument, 600)}`),
                  "",
              ]
            : []),
    ];
    const tail = [
        "",
        `First, record this direction in my Ideas list so this session holds it: run wsh idea add with the direction's title as its one argument, --kind idea and --topic "${c.feature}". Then start brainstorming it with me.`,
    ];
    const lines = thread.slice(-PROMPT_REPLIES);
    const build = (kept: string[]) =>
        [...head, ...(kept.length > 0 ? ["The thread:", ...kept] : []), ...tail].join("\n");
    while (lines.length > 0 && build(lines).length > PROMPT_CHARS) {
        lines.shift();
    }
    return build(lines);
}
