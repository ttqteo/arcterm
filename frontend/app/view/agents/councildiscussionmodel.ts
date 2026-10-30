// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the council Discussion (councildiscussion.tsx) draws beyond councilmodel.ts, and what the chat (councilchat.tsx,
// councilchatmodel.ts) borrows: an expert's colour and initial, what it is doing (the avatar's hover and the first step's
// cards), the reactions under an idea, which body a council gets, what the Summarize button does, whether a reply is a
// follow-up, the header's words, and the pause's ticks. Every word here is the plain one; the wire's stances, rounds and
// ids stay in the data. Pure, no React, no Wave runtime imports, so every rule here has a test
// (councildiscussionmodel.test.ts).

import {
    authorName,
    callSegments,
    costLine,
    heldDrafts,
    isReaction,
    outdatedCount,
    panel,
    readableReplies,
    roundsOf,
    sentProposals,
    synthesisRound,
    type SegmentState,
} from "./councilmodel";

const YOU = "you";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const PILL_STANCES: ReadonlySet<string> = new Set(["accept", "challenge", "oppose"]);

// ---- who is who ----

/** The identity colour an avatar is drawn in: the expert's slot among the panel (the `conn-*` palette, which stays the
 *  same in every theme), the person's own the accent, the coordinator the ink, an expert no longer on the panel muted. */
export type AvatarTone =
    | "you"
    | "coordinator"
    | "muted"
    | "conn-1"
    | "conn-2"
    | "conn-3"
    | "conn-6"
    | "conn-7"
    | "conn-8";

// conn-4 (red) and conn-5 (a second blue) are left out: red reads as an error, and blue as conn-1's twin
const PANEL_TONES: AvatarTone[] = ["conn-1", "conn-2", "conn-3", "conn-6", "conn-7", "conn-8"];

/** Pure: the colour of an author's avatar (an expert id, or `you`). */
export function avatarTone(c: Council, id: string): AvatarTone {
    if (id === YOU) {
        return "you";
    }
    const expert = c.experts.find((e) => e.id === id);
    if (expert == null) {
        return "muted";
    }
    if (expert.coordinator) {
        return "coordinator";
    }
    return PANEL_TONES[panel(c).findIndex((e) => e.id === id) % PANEL_TONES.length];
}

/** What the Discussion's body shows: the chat (the channel and its threads), the round 1 cards while the experts are
 *  still proposing (or when none brought a proposal), the pause's ticks, or the not-run council's Start. */
export type DiscussionBody = "chat" | "experts" | "pause" | "not-run";

/** Pure: which body a council gets. A council waiting on the person is at the pause, unless held drafts wait: those are
 *  the chat's, and the person settles them there (no Continue). */
export function discussionBody(c: Council): DiscussionBody {
    if (c.state === "not-run") {
        return "not-run";
    }
    if (c.state === "awaiting-you") {
        return heldDrafts(c).length > 0 ? "chat" : "pause";
    }
    return (c.proposals ?? []).length === 0 || (c.state === "running" && c.round <= 1) ? "experts" : "chat";
}

/** Pure: a council that waits for the one running council to end. */
export function isQueued(c: Council): boolean {
    return c.state === "queued";
}

/** Pure: the mode in a word, for the Discussion's chip; an empty, missing or unknown mode reads as Review (councils saved
 *  before modes have none). */
export function modeWord(c: Council): "Review" | "Brainstorm" {
    return c.mode === "brainstorm" ? "Brainstorm" : "Review";
}

/** Pure: the avatar stack for a screen reader: the panel, and who is writing. */
export function avatarStackLabel(c: Council): string {
    const names = c.experts.map((e) => e.name).join(", ");
    const lit = c.experts.filter((e) => isLit(c, e.id)).map((e) => e.name);
    return lit.length === 0 ? names : `${names}; ${listNames(lit)} ${lit.length === 1 ? "is" : "are"} writing`;
}

/** Pure: the letter in an avatar. */
export function initialOf(name: string): string {
    const first = [...name.trim()][0];
    return first == null ? "?" : first.toUpperCase();
}

/** Pure: whether an expert is writing right now (the avatar's green dot). Nothing is while the council is not running. */
export function isLit(c: Council, id: string): boolean {
    return c.state === "running" && c.activity?.[id] != null;
}

const proposalsBy = (c: Council, id: string) => sentProposals(c).filter((p) => p.author === id).length;
const repliesBy = (c: Council, id: string) => readableReplies(c).filter((r) => r.author === id).length;

/** Pure: where a failed call failed, in words: round 1 proposing, a later seat round replying, the round after them
 *  writing the summary, the ones after that the follow-up. */
export function failedWhile(c: Council, round: number): string {
    if (round < 1) {
        return "Failed";
    }
    if (round === 1) {
        return "Failed while proposing";
    }
    if (round <= roundsOf(c)) {
        return "Failed while replying";
    }
    return round === synthesisRound(c) ? "Failed while writing the summary" : "Failed while answering";
}

/** Pure: what an avatar's hover says after the name (`Skeptic: Replying to UX`): the tool or reply being written,
 *  else where the expert stands. */
export function expertDoing(c: Council, e: CouncilExpert): string {
    const act = c.state === "running" ? c.activity?.[e.id] : undefined;
    if (act != null) {
        return act.text;
    }
    const failure = c.failed?.[e.id];
    if (failure != null) {
        return failedWhile(c, failure.round);
    }
    if (e.coordinator) {
        return c.summary != null
            ? "Wrote the summary"
            : c.state === "running"
              ? "Waits for the answer"
              : "No summary yet";
    }
    const replies = repliesBy(c, e.id);
    if (c.state === "running" && c.round <= 1) {
        return (c.stats?.[e.id]?.calls ?? 0) >= 1
            ? `Proposed · ${plural(proposalsBy(c, e.id), "idea", "ideas")}`
            : "Waits to start";
    }
    if (c.state === "running") {
        return replies > 0 ? `Replied · ${plural(replies, "reply", "replies")}` : "Replied";
    }
    const posts = [
        proposalsBy(c, e.id) > 0 ? plural(proposalsBy(c, e.id), "idea", "ideas") : "",
        replies > 0 ? plural(replies, "reply", "replies") : "",
    ].filter(Boolean);
    return posts.length > 0 ? posts.join(" · ") : "No posts";
}

/** How a first-step expert card's dot reads: `working` green, `done` the green dimmed, `failed` red, `waiting` grey. */
export type CardDot = "working" | "done" | "failed" | "waiting";

/** Pure: a first-step expert card's state line and its dot: the tool being used (`Grep "IdleSleep" in pkg/services`),
 *  then `Proposed · 2 ideas`, `Failed`, or why there is nothing yet. */
export function expertCard(c: Council, e: CouncilExpert): { dot: CardDot; text: string } {
    const act = c.state === "running" ? c.activity?.[e.id] : undefined;
    if (act != null) {
        return { dot: "working", text: act.text };
    }
    const failure = c.failed?.[e.id];
    if (failure != null && failure.round <= 1) {
        return { dot: "failed", text: "Failed" };
    }
    if ((c.stats?.[e.id]?.calls ?? 0) >= 1) {
        const n = proposalsBy(c, e.id);
        return { dot: "done", text: n === 0 ? "Proposed · no ideas" : `Proposed · ${plural(n, "idea", "ideas")}` };
    }
    if (failure != null) {
        return { dot: "failed", text: "Failed" };
    }
    return { dot: "waiting", text: c.state === "running" ? "Waits to start" : "Did not run" };
}

// ---- the call bar ----

/** Pure: the call bar in words (`9 calls: 2 done, 2 running, 5 waiting`), for its aria-label: a state with no segments
 *  is left out. */
export function segmentSummary(segments: SegmentState[]): string {
    const count = (s: SegmentState) => segments.filter((x) => x === s).length;
    const parts = (["done", "failed", "running", "pending"] as const)
        .filter((s) => count(s) > 0)
        .map((s) => `${count(s)} ${s === "pending" ? "waiting" : s}`);
    return `${plural(segments.length, "call", "calls")}: ${parts.join(", ")}`;
}

/** Pure: the header's cost line (`7:20 · 19 replies · 0.55M tokens`), without the `0 replies` of a council that has had
 *  no discussion yet (the experts' first step, the pause). */
export function headerCost(c: Council, nowMs: number): string {
    const parts = costLine(c, nowMs).split(" · ");
    return readableReplies(c).length === 0 ? parts.filter((p) => p !== "0 replies").join(" · ") : parts.join(" · ");
}

/** Pure: the call bar's words for a council. */
export function callBarLabel(c: Council): string {
    return segmentSummary(callSegments(c));
}

// ---- the post and its replies ----

function clock(ms: number): string {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Pure: when something was posted, as the council's clock read (`5:03`); empty for a council with no start. */
export function sinceStart(c: Council, ts: number): string {
    return c.started ? clock(ts - c.started) : "";
}

/** Pure: an evidence chip: the reference, or for a weak claim `Weak ·` and why (an amber chip). */
export function evidenceChip(e: CouncilEvidence): { text: string; weak: boolean } {
    if (!e.weak) {
        return { text: e.ref, weak: false };
    }
    return { text: `Weak · ${e.note || e.ref || "no evidence"}`, weak: true };
}

/** Pure: the reactions under a post, `Reader agrees` one per expert whose latest word on it is an accept with no text
 *  (an expert that agreed and then spoke up is not one), in the order they came. */
export function reactions(c: Council, proposalId: string): string[] {
    const latest = new Map<string, CouncilReply>();
    (c.replies ?? [])
        .map((r, i) => ({ r, i }))
        .sort((a, b) => a.r.ts - b.r.ts || a.i - b.i)
        .forEach(({ r }) => {
            if (r.proposalid === proposalId && r.author !== YOU && PILL_STANCES.has(r.stance ?? "")) {
                latest.delete(r.author);
                latest.set(r.author, r);
            }
        });
    return [...latest.values()].filter(isReaction).map((r) => `${authorName(c, r.author)} agrees`);
}

// ---- the composer ----

/** Pure: `UX`, `UX and RAM`, `UX, RAM and Skeptic`. */
export function listNames(names: string[]): string {
    if (names.length <= 1) {
        return names.join("");
    }
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Pure: whether a reply now starts its own short round (the council is over), rather than waiting for a round of the
 *  council's own. */
export function isFollowUp(c: Council): boolean {
    return c.state === "done" || c.state === "stopped" || c.state === "failed";
}

// ---- the header's Summarize ----

/** Pure: what the Summarize button says and does: with no summary it asks for one, with one that replies came after (or
 *  whose rerun failed) it asks for a new one, and with a current one it only opens it. */
export function summarizeAction(c: Council): { label: string; call: boolean } {
    const coordinator = c.experts.find((e) => e.coordinator);
    if (c.summary == null) {
        return { label: "Summarize", call: true };
    }
    if (outdatedCount(c) > 0 || (coordinator != null && c.failed?.[coordinator.id] != null)) {
        return { label: "Summarize again", call: true };
    }
    return { label: "Open summary", call: false };
}

// ---- failures ----

export interface FailedExpert {
    expert: CouncilExpert;
    round: number;
    error: string;
}

/** Pure: the experts of the panel whose call failed and has not been retried, for their cards' Retry. */
export function failedExperts(c: Council): FailedExpert[] {
    return panel(c).flatMap((expert) => {
        const f = c.failed?.[expert.id];
        return f == null ? [] : [{ expert, round: f.round, error: f.error }];
    });
}

/** Pure: the coordinator's failed call (the synthesis), for the Summary failed panel. */
export function coordinatorFailure(c: Council): FailedExpert | null {
    const expert = c.experts.find((e) => e.coordinator);
    const f = expert == null ? undefined : c.failed?.[expert.id];
    return expert == null || f == null ? null : { expert, round: f.round, error: f.error };
}

/** Pure: whether a failed council has nothing left to retry: Retry brought every call back, and Summarize is its next
 *  step (the state stays `failed` until a summary succeeds). */
export function retriedOut(c: Council): boolean {
    return c.state === "failed" && Object.keys(c.failed ?? {}).length === 0;
}

// ---- the pause ----

/** Pure: the proposal ids still ticked, from the ones the person unticked (`cut`); a withdrawn proposal is not asked. */
export function keptProposals(c: Council, cut: readonly string[]): string[] {
    return (c.proposals ?? []).filter((p) => !p.withdrawn && !cut.includes(p.id)).map((p) => p.id);
}

/** Pure: `cut` with one proposal ticked or unticked. */
export function toggleCut(cut: readonly string[], id: string): string[] {
    return cut.includes(id) ? cut.filter((x) => x !== id) : [...cut, id];
}

/** Pure: whether the pause can go on: the argument needs an idea to review. */
export function canContinue(c: Council, cut: readonly string[]): boolean {
    return keptProposals(c, cut).length > 0;
}
