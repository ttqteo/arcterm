// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the council report (councilsummary.tsx) draws, derived from a `Council`: the answer line, the ranked directions
// with their plain tag, one stance chip per expert and the expert positions behind each, the lines under the header,
// which view a council opens on, the outline with the Final proposal's entry (councilfinalmodel.ts), and the two things
// the report hands on: the seed of the initiative Create initiative
// makes and the first prompt Start an agent on it opens an agent with. Pure, no React, no Wave runtime imports, so every rule here has a test (councilsummarymodel.test.ts). The
// stances, ranking and matrix of the whole council are in councilmodel.ts.

import { failedWhile, listNames } from "./councildiscussionmodel";
import { finalProposal } from "./councilfinalmodel";
import {
    checkLabelOf,
    councilProjectKey,
    isReaction,
    outdatedChanges,
    panel,
    sentProposals,
    sentReplies,
    STANCE_WORD,
    type CheckLabel,
    type OutdatedChanges,
    type StanceLabel,
} from "./councilmodel";
import { isUnboxedShot, parseShotRef, shotName, unboxedWords } from "./councilshots";

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

/** The view a council was last shown on, with the time of the summary it had then (0 for none). */
export interface KeptCouncilView {
    view: "discussion" | "summary" | "map";
    summaryAt: number;
}

/** Pure: the view a council opens on when the way in names none (its tree row, the palette): the one the person left
 *  it on, so a council left on its Discussion or its Map opens there again; but a summary written since then opens on
 *  the report, and a council never shown opens on defaultCouncilView. */
export function reopenView(
    c: Council | null | undefined,
    kept: KeptCouncilView | null
): "discussion" | "summary" | "map" {
    if (kept != null && kept.summaryAt === (c?.summary?.at ?? 0)) {
        return kept.view;
    }
    return defaultCouncilView(c);
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
    label: CheckLabel | ""; // the check label Go gave the claim shown (its proposal's, or its reply's); "" for none
}

export interface DirectionRow {
    direction: CouncilDirection;
    meta: string; // `from UX and RAM · 1 file · 1 weak claim`; a Brainstorm's starts `Had it: UX · built on by RAM`
    firstStep: string; // `First step: Try it on one screen`, or empty when the coordinator gave none
    step: string; // the coordinator's first step alone (`Try it on one screen`), or empty: the card's First step box
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
                position: {
                    expert,
                    stance,
                    text: reply?.text ?? "",
                    evidence: reply?.evidence ?? [],
                    label: checkLabelOf(reply ?? {}),
                },
                proposer: authored.length > 0,
            });
        } else if (authored.length > 0) {
            out.push({
                position: {
                    expert,
                    stance: "proposed",
                    text: authored[0].argument,
                    evidence: authored.flatMap((p) => p.evidence ?? []),
                    label: checkLabelOf(authored[0]),
                },
                proposer: true,
            });
        }
    }
    return [...out.filter((x) => x.proposer), ...out.filter((x) => !x.proposer)].map((x) => x.position);
}

// the folder part of a `path:line` ref; a screenshot region is not a file of the project
function fileOf(e: CouncilEvidence): string {
    if (e.weak || e.ref === "" || parseShotRef(e.ref) != null) {
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
        // a region named with no box in a checked claim is no evidence, so it counts as a weak claim
        const weak = positions.flatMap((p) => p.evidence.filter((e) => isWeakEvidence(e, p.label !== ""))).length;
        const meta = [
            brainstorm ? hadLine(c, direction.from) : fromLine(c, direction.from),
            files.size > 0 ? plural(files.size, "file", "files") : "",
            weak > 0 ? plural(weak, "weak claim", "weak claims") : "",
        ].filter((part) => part !== "");
        const firstStep = (direction.firststep ?? "").replace(/\s+/g, " ").trim();
        return {
            direction,
            meta: meta.join(" · "),
            firstStep: firstStep === "" ? "" : `First step: ${firstStep}`,
            step: firstStep,
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
    direction: CouncilDirection; // its title is the idea, its reasoning why it was kept aside or what it asks for
    meta: string; // a Brainstorm's `Had it: New user` (`· built on by …` when any reply built on it), a Review's `from UX`
}

/** Pure: what heads the one-line rows under the directions: a Brainstorm's wild ideas kept aside, or a Review's
 *  directions past the first three. */
export function keptHeading(c: Council): string {
    return isBrainstorm(c) ? "Wild ideas kept aside" : "Also raised";
}

/** Pure: the one-line rows under the directions, by rank: a Brainstorm's wild ideas kept aside, a Review's directions
 *  also raised; empty when there are none. */
export function keptRows(c: Council): KeptRow[] {
    const brainstorm = isBrainstorm(c);
    return [...(c.summary?.kept ?? [])]
        .sort((a, b) => a.rank - b.rank)
        .map((direction) => ({
            direction,
            meta: brainstorm ? hadLine(c, direction.from) : fromLine(c, direction.from),
        }));
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

/** Pure: whether a piece of evidence draws weak: a claim marked weak, or, in a claim Go checked (`checked`), a
 *  screenshot region named with no box, which marks no place on the image. */
export function isWeakEvidence(e: CouncilEvidence, checked: boolean): boolean {
    return e.weak === true || isUnboxedShot(e, checked);
}

/** Pure: how a piece of evidence reads on its chip: the ref (a screenshot region by its name, without its box), or for a
 *  weak one why it is weak. `checked` is whether Go checked the claim it backs (isWeakEvidence). */
export function evidenceLabel(e: CouncilEvidence, checked = false): string {
    if (e.weak) {
        return `Weak · ${e.note || e.ref || "cites no evidence"}`;
    }
    if (isUnboxedShot(e, checked)) {
        return unboxedWords(e.ref);
    }
    return parseShotRef(e.ref) != null ? `Screenshot ${shotName(e.ref)}` : e.ref;
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

/** Pure: `Written by the coordinator at 11:02 from 18 replies`: the replies the summary read. While the summary is
 *  current, the plain replies sent since (outdatedChanges) follow quietly: `… from 18 replies · 3 replies since`; once
 *  it is outdated the banner speaks instead. */
export function writtenLine(c: Council): string {
    const at = c.summary?.at;
    if (at == null) {
        return "";
    }
    const read = (c.replies ?? []).filter((r) => r.ts <= at).length;
    const line = `Written by the coordinator at ${clockTime(at)} from ${plural(read, "reply", "replies")}`;
    const o = outdatedChanges(c);
    return o.ideas + o.revised + o.stances === 0 && o.replies > 0
        ? `${line} · ${plural(o.replies, "reply", "replies")} since`
        : line;
}

/** Pure: the banner over a summary a change could have moved past: `Outdated · 1 new idea, 2 changed stances`, only the
 *  parts that are not zero. The plain replies since are never in it. */
export function outdatedLabel(o: OutdatedChanges): string {
    const parts = [
        o.ideas > 0 ? plural(o.ideas, "new idea", "new ideas") : "",
        o.revised > 0 ? plural(o.revised, "revised idea", "revised ideas") : "",
        o.stances > 0 ? plural(o.stances, "changed stance", "changed stances") : "",
    ].filter((p) => p !== "");
    return `Outdated · ${parts.join(", ")}`;
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
 *  it came from and their thread, and the ask to start brainstorming it. The thread is cut from its oldest end when the
 *  whole would be too long for a launch argument. */
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
    const tail = ["", "Start brainstorming it with me."];
    const lines = thread.slice(-PROMPT_REPLIES);
    const build = (kept: string[]) =>
        [...head, ...(kept.length > 0 ? ["The thread:", ...kept] : []), ...tail].join("\n");
    while (lines.length > 0 && build(lines).length > PROMPT_CHARS) {
        lines.shift();
    }
    return build(lines);
}

// ---- the seat that writes the summary ----

/** Pure: the name of the seat that writes the summary (the expert with `coordinator: true`), by its own `name`, so a
 *  renamed seat and a Vietnamese council's "Thư ký" carry through. "Summarizer" when the council has no such
 *  seat, or its name is blank. */
export function summarizerName(c: Council): string {
    const name = c.experts.find((e) => e.coordinator)?.name.trim() ?? "";
    return name !== "" ? name : "Summarizer";
}

// ---- the column beside the report ----

/** What one seat did, as the column beside the report lists it: `7 ideas, 3 in the summary · 12 replies`. `filter` is
 *  whether a click can show the Discussion with only its messages (an expert who wrote something; never the
 *  coordinator, whose work is the summary). */
export interface ExpertActivity {
    expert: CouncilExpert;
    line: string;
    filter: boolean;
}

/** Pure: each seat of the council, in panel order, with what it did: its ideas (and, once there is a summary, how many
 *  of them went into it), its replies, the ideas it agreed with and nothing more (reactions), and a failed call; the
 *  coordinator says it wrote the summary. Held and dropped drafts are not counted. */
export function expertActivity(c: Council): ExpertActivity[] {
    const summary = c.summary;
    const used = new Set([...(summary?.directions ?? []), ...(summary?.kept ?? [])].flatMap((d) => d.from));
    const replies = sentReplies(c);
    return c.experts.map((expert) => {
        const failure = c.failed?.[expert.id];
        const failed = failure != null ? failedWhile(c, failure.round) : "";
        if (expert.coordinator) {
            return { expert, line: failed !== "" ? failed : summary != null ? "Wrote the summary" : "", filter: false };
        }
        const ideas = sentProposals(c).filter((p) => p.author === expert.id);
        const own = replies.filter((r) => r.author === expert.id);
        const nods = own.filter(isReaction).length;
        const said = own.length - nods;
        const parts: string[] = [];
        if (ideas.length > 0) {
            const inSummary = ideas.filter((p) => used.has(p.id)).length;
            parts.push(
                plural(ideas.length, "idea", "ideas") +
                    (summary == null ? "" : inSummary === 0 ? ", none in the summary" : `, ${inSummary} in the summary`)
            );
        }
        if (said > 0) {
            parts.push(plural(said, "reply", "replies"));
        }
        if (nods > 0) {
            parts.push(`agreed with ${plural(nods, "idea", "ideas")}`);
        }
        if (failed !== "") {
            parts.push(failed.charAt(0).toLowerCase() + failed.slice(1));
        }
        const wrote = ideas.length + own.length > 0;
        return { expert, line: parts.length > 0 ? parts.join(" · ") : "No messages", filter: wrote };
    });
}

/** One entry of the report's outline: a section (`depth` 0) or a direction under its section (`depth` 1). `id` names
 *  the element it scrolls to (`data-council-section`, or `data-council-direction` for `direction:<rank>`); the Final
 *  proposal's is `final`. */
export interface OutlineEntry {
    id: string;
    label: string;
    count: number | null;
    depth: 0 | 1;
    rank: number | null;
}

/** Pure: the report's outline, in page order: the answer, the directions (each one under them), the kept or
 *  also-raised ideas, and last the Final proposal while a message is pinned (finalProposal). Who agrees with which idea
 *  is the Map tab's, not a section here. Empty before a summary unless a message is pinned: then the Final proposal
 *  alone, which the report shows without one. */
export function outlineOf(c: Council): OutlineEntry[] {
    const final: OutlineEntry[] =
        finalProposal(c) == null ? [] : [{ id: "final", label: "Final proposal", count: null, depth: 0, rank: null }];
    const summary = c.summary;
    if (summary == null) {
        return final;
    }
    const entries: OutlineEntry[] = [{ id: "answer", label: "The answer", count: null, depth: 0, rank: null }];
    const directions = [...summary.directions].sort((a, b) => a.rank - b.rank);
    if (directions.length > 0) {
        const heading = directionsHeading(c);
        entries.push({
            id: "directions",
            label: heading !== "" ? heading.replace(/, best first$/, "") : "Directions",
            count: directions.length,
            depth: 0,
            rank: null,
        });
        for (const d of directions) {
            entries.push({ id: `direction:${d.rank}`, label: d.title, count: null, depth: 1, rank: d.rank });
        }
    }
    const kept = keptRows(c);
    if (kept.length > 0) {
        entries.push({ id: "kept", label: keptHeading(c), count: kept.length, depth: 0, rank: null });
    }
    return [...entries, ...final];
}

/** Pure: the tab bar's jump links: the outline's sections after the answer (the answer is the cover), in page order:
 *  the directions and the kept ideas when there are any, then the Final proposal while a message is pinned. Empty
 *  before a summary unless a message is pinned: then the Final proposal alone. */
export function jumpLinks(c: Council): OutlineEntry[] {
    return outlineOf(c).filter((e) => e.depth === 0 && e.id !== "answer");
}
