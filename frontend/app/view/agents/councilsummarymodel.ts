// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the council report (councilsummary.tsx) draws, derived from a `Council`: the answer line, the ranked directions
// with their plain tag, one stance chip per expert and the expert positions behind each, the lines under the header,
// which view a council opens on, and the two things the report hands on: the seed of the initiative Create initiative
// makes and the first prompt Start an agent on it opens an agent with. Pure, no React, no Wave runtime imports, so every rule here has a test (councilsummarymodel.test.ts). The
// stances, ranking and matrix of the whole council are in councilmodel.ts.

import { listNames } from "./councildiscussionmodel";
import { councilProjectKey, panel, STANCE_WORD, type StanceLabel } from "./councilmodel";

function asStance(s: string | undefined): Exclude<StanceLabel, "proposed"> | undefined {
    return s === "accept" || s === "challenge" || s === "oppose" ? s : undefined;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---- what a council opens on ----

/** Pure: the view a council opens on: its report when it has ended with a summary, else its Discussion (a council still
 *  running or waiting, one with no summary, and one that is not known yet). */
export function defaultCouncilView(c: Council | null | undefined): "discussion" | "summary" {
    if (c == null || c.summary == null) {
        return "discussion";
    }
    return c.state === "done" || c.state === "stopped" || c.state === "failed" ? "summary" : "discussion";
}

// ---- the answer ----

// the first sentence of a text and what follows it: the end of a sentence is . ! or ? before a space or the end
function splitFirstSentence(text: string): { first: string; rest: string } {
    const flat = text.trim();
    const end = flat.search(/[.!?…](\s|$)/);
    if (end < 0) {
        return { first: flat, rest: "" };
    }
    return { first: flat.slice(0, end + 1), rest: flat.slice(end + 1).trim() };
}

/** Pure: the report's bold line and the text under it. The coordinator's one-sentence `answer` when it wrote one (the
 *  whole summary text is then the rest); a council from before answers, or without a question, opens on the summary
 *  text's first sentence and the rest of the text follows. */
export function answerParts(c: Council): { answer: string; rest: string } {
    const text = c.summary?.text ?? "";
    const answer = (c.summary?.answer ?? "").trim();
    if (answer !== "") {
        return { answer, rest: text.trim() };
    }
    const { first, rest } = splitFirstSentence(text);
    return { answer: first, rest };
}

/** Pure: the report's bold line (see answerParts). */
export function answerLine(c: Council): string {
    return answerParts(c).answer;
}

/** Pure: `You asked: <question>`, empty for a council without a question. */
export function askedLine(c: Council): string {
    const q = (c.question ?? "").replace(/\s+/g, " ").trim();
    return q === "" ? "" : `You asked: ${q}`;
}

/** Pure: how a proposal's outcome reads in the report: the round a withdrawal happened in is a v1 detail. */
export function outcomeLabel(outcome: string): string {
    return /^Withdrawn in round \d+$/.test(outcome) ? "Withdrawn" : outcome;
}

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
    meta: string; // `from UX and RAM · 1 file · 1 weak claim · in Ideas`; a Brainstorm's starts `Had it: UX · built on by RAM`
    firstStep: string; // `First step: Try it on one screen`, or empty when the coordinator gave none
    chips: StanceChip[]; // the experts that proposed or took a stance, in panel order
    tag: string; // `Everyone agrees`, `Reader has doubts`, `RAM is against it` (directionTag)
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

// the authors of the proposals a direction came from, each once, in the order they come
function authorNames(c: Council, from: string[]): string[] {
    const named = from.flatMap((id) => {
        const p = (c.proposals ?? []).find((x) => x.id === id);
        return p == null ? [] : [c.experts.find((e) => e.id === p.author)?.name ?? p.author];
    });
    return named.filter((name, i) => named.indexOf(name) === i);
}

// `from UX and RAM`
function fromLine(c: Council, from: string[]): string {
    const authors = authorNames(c, from);
    return authors.length === 0 ? "" : `from ${listNames(authors)}`;
}

/** Pure: whether a council is a Brainstorm; a council saved before modes has none and reads as Review. */
export function isBrainstorm(c: Council): boolean {
    return c.mode === "brainstorm";
}

// the experts whose reply builds on one of these proposals, each once, in panel order (the person's reply is none)
function builderNames(c: Council, from: string[]): string[] {
    const builders = new Set(
        (c.replies ?? []).filter((r) => r.builds === true && from.includes(r.proposalid)).map((r) => r.author)
    );
    return panel(c)
        .filter((e) => builders.has(e.id))
        .map((e) => e.name);
}

// `Had it: UX and RAM · built on by New user`: who had the idea and who built on it (Brainstorm)
function hadLine(c: Council, from: string[]): string {
    const authors = authorNames(c, from);
    if (authors.length === 0) {
        return "";
    }
    const builders = builderNames(c, from);
    return `Had it: ${listNames(authors)}${builders.length > 0 ? ` · built on by ${listNames(builders)}` : ""}`;
}

/** Pure: a direction's tag in words: `Everyone agrees`, `Reader has doubts`, `Reader and UX have doubts`, `RAM is
 *  against it`. Against wins over doubts, so a direction one expert opposes reads as that. The names are in panel
 *  order. */
export function directionTag(c: Council, d: CouncilDirection): string {
    const named = (stance: string) => {
        const ids = Object.keys(d.stances ?? {}).filter((id) => d.stances?.[id] === stance);
        const order = panel(c).map((e) => e.id);
        return ids
            .sort((a, b) => (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1))
            .map((id) => c.experts.find((e) => e.id === id)?.name ?? id);
    };
    const against = named("oppose");
    if (against.length > 0) {
        return `${listNames(against)} ${against.length === 1 ? "is" : "are"} against it`;
    }
    const doubts = named("challenge");
    if (doubts.length > 0) {
        return `${listNames(doubts)} ${doubts.length === 1 ? "has" : "have"} doubts`;
    }
    return d.agreed === false && Object.keys(d.stances ?? {}).length === 0 ? "Not everyone agrees" : "Everyone agrees";
}

/** Pure: what heads the directions: a Brainstorm's are ideas worth trying; a Review's have no heading. */
export function directionsHeading(c: Council): string {
    return isBrainstorm(c) ? "Ideas worth trying, best first" : "";
}

/** Pure: the Summary's directions by rank, each with its line of facts, its stance chips and its positions. */
export function directionRows(c: Council): DirectionRow[] {
    const directions = [...(c.summary?.directions ?? [])].sort((a, b) => a.rank - b.rank);
    const brainstorm = isBrainstorm(c);
    return directions.map((direction) => {
        const positions = positionsOf(c, direction);
        const evidence = positions.flatMap((p) => p.evidence);
        const files = new Set(evidence.map(fileOf).filter((f) => f !== ""));
        const weak = evidence.filter((e) => e.weak).length;
        const meta = [
            brainstorm ? hadLine(c, direction.from) : fromLine(c, direction.from),
            files.size > 0 ? plural(files.size, "file", "files") : "",
            weak > 0 ? plural(weak, "weak claim", "weak claims") : "",
            direction.ideaid ? "in Ideas" : "",
        ].filter((part) => part !== "");
        const firstStep = (direction.firststep ?? "").replace(/\s+/g, " ").trim();
        return {
            direction,
            meta: meta.join(" · "),
            firstStep: firstStep === "" ? "" : `First step: ${firstStep}`,
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
            tag: directionTag(c, direction),
            positions,
            firstProposal: direction.from.find((id) => (c.proposals ?? []).some((p) => p.id === id)) ?? "",
        };
    });
}

export interface KeptRow {
    direction: CouncilDirection; // its title is the idea, its reasoning why it was kept aside
    had: string; // `Had it: New user`, with `· built on by …` when any reply built on it
}

/** Pure: a Brainstorm's wild ideas kept aside, by rank; empty when the coordinator kept none. */
export function keptRows(c: Council): KeptRow[] {
    return [...(c.summary?.kept ?? [])]
        .sort((a, b) => a.rank - b.rank)
        .map((direction) => ({ direction, had: hadLine(c, direction.from) }));
}

/** Pure: `3 more ideas merged or dropped`: a Brainstorm's proposals that are in no direction and not kept; empty at 0,
 *  for a Review and before a summary. */
export function droppedLine(c: Council): string {
    const summary = c.summary;
    if (summary == null || !isBrainstorm(c)) {
        return "";
    }
    const used = new Set([...summary.directions, ...(summary.kept ?? [])].flatMap((d) => d.from));
    const n = (c.proposals ?? []).filter((p) => !used.has(p.id)).length;
    return n === 0 ? "" : `${n} more ${n === 1 ? "idea" : "ideas"} merged or dropped`;
}

/** Pure: `Saved to docs/council/2026-10-22-rail-apps.md with the whole discussion`: where the finished council saved
 *  itself (relative to the project when inside it); empty before it did. */
export function savedLine(c: Council): string {
    const path = c.docpath ?? "";
    return path === "" ? "" : `Saved to ${docPathLabel(c.project, path)} with the whole discussion`;
}

/** Pure: the `⋯` menu's document item: Open the document once the council saved itself, else Save as doc. */
export function docAction(c: Council): { id: "open-doc" | "save-doc"; label: string } {
    return (c.docpath ?? "") !== ""
        ? { id: "open-doc", label: "Open the document" }
        : { id: "save-doc", label: "Save as doc" };
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

// ---- Was this useful? ----

export type CouncilRating = "useful" | "not";

export interface RatingRow {
    text: string; // `Was this useful?`, or once rated `Thanks: this goes into the council benchmark`
    choices: { id: CouncilRating; label: string }[]; // the buttons; none once rated
    change: string; // the link that asks again: `Change` once rated, else empty
}

const isRating = (r: string | undefined): r is CouncilRating => r === "useful" || r === "not";

/** Pure: the row under the report that asks for the person's rating, or null when the report shows none: a council
 *  that is not done or stopped (a running one is re-summarizing over an old summary, a failed one has no report to
 *  rate), one with no summary, and a benchmark's own. Once rated it thanks the person with a Change link; `changing`
 *  (the link clicked) asks again. */
export function ratingRow(c: Council, changing = false): RatingRow | null {
    if (c.bench === true || c.summary == null || (c.state !== "done" && c.state !== "stopped")) {
        return null;
    }
    if (isRating(c.rating) && !changing) {
        return { text: "Thanks: this goes into the council benchmark", choices: [], change: "Change" };
    }
    return {
        text: "Was this useful?",
        choices: [
            { id: "useful", label: "Useful" },
            { id: "not", label: "Not really" },
        ],
        change: "",
    };
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

/** Pure: the first prompt of the agent Start an agent on it opens: the direction, the coordinator's reasoning, the proposals
 *  it came from and their thread, and the ask to record the direction with `wsh idea add` before brainstorming, so the
 *  new session's Ideas holds it. The thread is cut from its oldest end when the whole would be too long for a launch
 *  argument. */
export function brainstormPrompt(c: Council, row: DirectionRow): string {
    const d = row.direction;
    const name = (id: string) => (id === "you" ? "You" : (c.experts.find((e) => e.id === id)?.name ?? id));
    const from = new Set(d.from);
    const proposals = (c.proposals ?? []).filter((p) => from.has(p.id));
    // ideas are named by their title, never by id: the agent's prompt reads like the report
    const titleOf = (id: string) => `"${proposals.find((p) => p.id === id)?.title ?? "an idea"}"`;
    const thread = (c.replies ?? [])
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => from.has(r.proposalid))
        .sort((a, b) => a.r.ts - b.r.ts || a.i - b.i)
        .map(({ r }) => {
            const stance = r.stance && r.stance in STANCE_WORD ? ` (${STANCE_WORD[r.stance as StanceLabel]})` : "";
            const text = clip(r.text, PROMPT_REPLY_CHARS);
            return `- ${name(r.author)} on ${titleOf(r.proposalid)}${stance}${text === "" ? "" : `: ${text}`}`;
        });
    const head = [
        `Brainstorm this direction with me. A council of expert agents reviewed "${c.feature}"${c.question ? ` (${clip(c.question, 300)})` : ""} and ranked this direction ${d.rank} (${row.tag}).`,
        "",
        `Direction: ${d.title}`,
        d.reasoning ? `Why: ${clip(d.reasoning, 1000)}` : "",
        "",
        ...(proposals.length > 0
            ? [
                  "It came from:",
                  ...proposals.map((p) => `- "${p.title}" by ${name(p.author)}: ${clip(p.argument, 600)}`),
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
