// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Council's pure model (pkg/council): what the Discussion, the Summary, Setup and the Agent tree read off a
// `Council` record. Pure, no React, no Wave runtime imports, so every rule here has a test (councilmodel.test.ts);
// councilstore.ts holds the atoms and the RPC calls, the views only draw what this file derives.
//
// Every timestamp on the record (`started`, `updated`, `summary.at`, a reply's `ts`) is epoch milliseconds, and a
// call is counted in `calls` and in `stats[expert].calls` only once it has returned a reply: a failed call is in
// `failed`, not in the count. The coordinator is the one expert with `coordinator` set; it never proposes or replies,
// so "the experts" below means the panel, every other seat (`panel`): a role expert, or a live agent (`agent` set).
//
// The round numbers live here and nowhere else (`roundsOf`, `synthesisRound`, `firstFollowRound`; Go's are in
// pkg/council/types.go): the seats answer rounds 1 to `rounds`, the summary is the round after, a follow-up the ones
// after that.

export type CouncilView = "discussion" | "summary" | "setup";

/** A stance in the Discussion: what an expert said of a proposal, or `proposed` for the proposal's own author. */
export type StanceLabel = "accept" | "challenge" | "oppose" | "proposed";

/** How a tree row's meta reads: `working` is green, `asking` amber, `muted` grey, `error` red. */
export type CouncilTone = "working" | "asking" | "muted" | "error";

export type SegmentState = "done" | "running" | "failed" | "pending";

const YOU = "you";
const DEFAULT_ROUNDS = 2;
const MAX_ROUNDS = 3;
const DRAFT_HELD = "held";

/** The name a council with no title goes by in the Agent tree and in another council's queued line. */
export const UNTITLED_COUNCIL = "(untitled council)";

/** The words the person reads for a stance (the wire keeps `accept | challenge | oppose`). */
export const STANCE_WORD: Record<StanceLabel, string> = {
    accept: "Agrees",
    challenge: "Has doubts",
    oppose: "Is against it",
    proposed: "Proposed",
};

const STANCES: ReadonlySet<string> = new Set(["accept", "challenge", "oppose"]);

function isStance(s: string | undefined): s is "accept" | "challenge" | "oppose" {
    return s != null && STANCES.has(s);
}

/** Pure: the seats that propose and review, which is every seat but the coordinator. */
export function panel(c: Council): CouncilExpert[] {
    return c.experts.filter((e) => !e.coordinator);
}

// ---- rounds, agent seats and held drafts ----

/** Pure: how many rounds the seats answer, the ideas round included: `rounds` 1 to 3, and anything else (0 on a council
 *  saved before rounds existed) reads as 2, today's shape. The same rule as `RoundsOf` in pkg/council/types.go. */
export function roundsOf(c: Pick<Council, "rounds"> | null | undefined): number {
    const n = c?.rounds ?? 0;
    return n >= 1 && n <= MAX_ROUNDS ? n : DEFAULT_ROUNDS;
}

/** Pure: the round number of the coordinator's summary, the one after the last seat round (3 for 2 rounds). */
export function synthesisRound(c: Pick<Council, "rounds"> | null | undefined): number {
    return roundsOf(c) + 1;
}

/** Pure: the round number of a council's first follow-up, after it is done (4 for 2 rounds); each later one is one more. */
export function firstFollowRound(c: Pick<Council, "rounds"> | null | undefined): number {
    return roundsOf(c) + 2;
}

/** Pure: whether a seat is a live agent's (its tab id is `agent`), not a role expert's. */
export function isAgentSeat(e: Pick<CouncilExpert, "agent">): boolean {
    return !!e.agent;
}

/** Pure: whether a live agent sits in the council. It then holds every answer as a draft the person settles. */
export function hasAgents(c: Pick<Council, "experts"> | null | undefined): boolean {
    return c != null && c.experts.some(isAgentSeat);
}

/** An idea or a reply a seat wrote that waits for the person to send, edit or drop it. */
export type HeldDraft =
    | { kind: "idea"; id: string; ts: number; proposal: CouncilProposal }
    | { kind: "reply"; id: string; ts: number; reply: CouncilReply };

/** Pure: whether an idea or a reply reached the other seats: its `draft` is empty (sent, or never held). A held draft and
 *  a dropped one did not, so they count in no vote, matrix cell or reply total, as the Go synthesis leaves them out too
 *  (`Sent` in pkg/council/types.go). */
export function isSent(item: { draft?: string }): boolean {
    return !item.draft;
}

/** Pure: the ideas that were sent (or never held), in the order the record keeps them. */
export function sentProposals(c: Pick<Council, "proposals">): CouncilProposal[] {
    return (c.proposals ?? []).filter(isSent);
}

/** Pure: the replies that were sent (or never held), reactions included, in the order the record keeps them. */
export function sentReplies(c: Pick<Council, "replies">): CouncilReply[] {
    return (c.replies ?? []).filter(isSent);
}

/** Pure: the held drafts, ideas and replies, in the order they were written (a tie: the idea, then arrival). A sent
 *  draft (`draft` empty) and a dropped one are not held. */
export function heldDrafts(c: Pick<Council, "proposals" | "replies">): HeldDraft[] {
    const ideas = (c.proposals ?? [])
        .filter((p) => p.draft === DRAFT_HELD)
        .map((proposal): HeldDraft => ({ kind: "idea", id: proposal.id, ts: proposal.ts, proposal }));
    const replies = (c.replies ?? [])
        .filter((r) => r.draft === DRAFT_HELD)
        .map((reply): HeldDraft => ({ kind: "reply", id: reply.id, ts: reply.ts, reply }));
    return [...ideas, ...replies]
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d.ts - b.d.ts || a.i - b.i)
        .map((x) => x.d);
}

/** Pure: the reply author's display name: the expert's, `You` for the person, the raw id for one no longer on the panel. */
export function authorName(c: Council, id: string): string {
    if (id === YOU) {
        return "You";
    }
    return c.experts.find((e) => e.id === id)?.name ?? id;
}

/** Pure: whether a reply is agreement with nothing to add: an expert's accept with no text. It is drawn as a reaction
 *  under the post, never as a reply, and counts in no reply total; the stance still counts in the vote and the
 *  synthesis reads it. */
export function isReaction(r: CouncilReply): boolean {
    return r.author !== YOU && r.stance === "accept" && r.text.trim() === "";
}

/** Pure: the replies a person reads as replies, which leaves out the reactions and every reply that is still a draft
 *  or was dropped. */
export function readableReplies(c: Council): CouncilReply[] {
    return sentReplies(c).filter((r) => !isReaction(r));
}

// replies in the order they were posted: by time, a tie by arrival
function byTime(replies: CouncilReply[]): CouncilReply[] {
    return replies
        .map((r, i) => ({ r, i }))
        .sort((a, b) => a.r.ts - b.r.ts || a.i - b.i)
        .map((x) => x.r);
}

/** Pure: the key a project path is held under, so two spellings of one project share an atom. Separators are
 *  forward slashes and a trailing one is dropped; a Windows drive path is also lower-cased, as the OS compares it
 *  (Go's samePath in pkg/council does the same). */
export function councilProjectKey(project: string): string {
    const key = project.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-z]:\//i.test(key) || /^[a-z]:$/i.test(key) ? key.toLowerCase() : key;
}

/** Pure: the registered project's name whose root is the council's project path, or null when none is. */
export function councilProjectName(
    registry: Readonly<Record<string, { path?: string }>> | null | undefined,
    project: string
): string | null {
    const key = councilProjectKey(project);
    for (const [name, p] of Object.entries(registry ?? {})) {
        if (p?.path && councilProjectKey(p.path) === key) {
            return name;
        }
    }
    return null;
}

/** Pure: a council nothing works on any more (done, failed, stopped, not run), which Remove deletes. One running,
 *  waiting on the person or queued has to be stopped first; wavesrv refuses it too (Runner.Delete). */
export function canRemoveCouncil(c: Pick<Council, "state">): boolean {
    return c.state === "done" || c.state === "failed" || c.state === "stopped" || c.state === "not-run";
}

// ---- stances, score, ranking ----

/** Pure: per proposal id, each expert's last stance on it, from its replies (the last by time wins). The proposal's
 *  author is `proposed` whatever it replied; the person's replies and a reply with no stance word count for nothing.
 *  A held or dropped idea has no entry, and a held or dropped reply takes no stance. */
export function latestStances(c: Council): Record<string, Record<string, StanceLabel>> {
    const out: Record<string, Record<string, StanceLabel>> = {};
    const proposals = sentProposals(c);
    for (const p of proposals) {
        out[p.id] = {};
    }
    for (const r of byTime(sentReplies(c))) {
        const of = out[r.proposalid];
        if (of != null && r.author !== YOU && isStance(r.stance)) {
            of[r.author] = r.stance;
        }
    }
    for (const p of proposals) {
        out[p.id][p.author] = "proposed";
    }
    return out;
}

function scoreOf(stances: Record<string, StanceLabel> | undefined): number {
    let n = 0;
    for (const s of Object.values(stances ?? {})) {
        n += s === "accept" ? 1 : s === "oppose" ? -1 : 0;
    }
    return n;
}

/** Pure: a proposal's score, the experts' accepts minus their opposes. A challenge counts for nothing. */
export function score(c: Council, proposalId: string): number {
    return scoreOf(latestStances(c)[proposalId]);
}

// the number of experts writing a reply under this proposal right now
function replyingOn(c: Council, proposalId: string): number {
    if (c.state !== "running") {
        return 0;
    }
    return Object.values(c.activity ?? {}).filter((a) => a.proposalid === proposalId).length;
}

/** Pure: how many experts put a proposal in their top picks; `null` for a council with no `picks` at all (one from
 *  before picks, or whose round 2 has not reported any), which is ranked by `score` instead. */
export function pickCount(c: Council, proposalId: string): number | null {
    const picks = Object.values(c.picks ?? {});
    if (picks.length === 0) {
        return null;
    }
    return picks.filter((ids) => ids.includes(proposalId)).length;
}

export interface RankedProposal {
    proposal: CouncilProposal;
    score: number; // accepts minus opposes
    picks: number | null; // experts that picked it, null for a council with no picks
    replies: number; // every reply on it a person reads, the person's included (a reaction is not one)
    replying: number; // the experts writing one now
}

/** Pure: the proposals by the experts' picks, best first (a council with no picks: by score), a tie by score and then
 *  in arrival order. A withdrawn one and one the person cut at the pause go last (their count kept, so the list can dim
 *  it). An idea that is still a draft or was dropped is not ranked. */
export function rankedProposals(c: Council): RankedProposal[] {
    const stances = latestStances(c);
    const replies = readableReplies(c);
    return sentProposals(c)
        .map((proposal, i) => ({
            i,
            row: {
                proposal,
                score: scoreOf(stances[proposal.id]),
                picks: pickCount(c, proposal.id),
                replies: replies.filter((r) => r.proposalid === proposal.id).length,
                replying: replyingOn(c, proposal.id),
            },
        }))
        .sort((a, b) => {
            const aOut = a.row.proposal.withdrawn || a.row.proposal.cut ? 1 : 0;
            const bOut = b.row.proposal.withdrawn || b.row.proposal.cut ? 1 : 0;
            return aOut - bOut || (b.row.picks ?? 0) - (a.row.picks ?? 0) || b.row.score - a.row.score || a.i - b.i;
        })
        .map((x) => x.row);
}

// ---- the thread ----

export interface ThreadNode {
    key: string; // the reply's id, or `typing:<expert id>`
    kind: "reply" | "typing";
    depth: number;
    author: string; // an expert id, or `you`
    reply?: CouncilReply; // a reply node
    text?: string; // a typing node: `Skeptic is writing a reply…`
    children: ThreadNode[];
}

function setDepth(nodes: ThreadNode[], depth: number): void {
    for (const n of nodes) {
        n.depth = depth;
        setDepth(n.children, depth + 1);
    }
}

/** Pure: one proposal's replies as a tree: nested by `parentid`, siblings by time. A reaction is no reply, and a reply
 *  that is still a draft or was dropped is not one yet, so none is in the tree; a reply whose parent is not in the
 *  thread (a reaction included) is a root. While the council runs, an expert whose `activity` names this proposal adds a
 *  `typing` node, last among the children of the reply it answers (or of the post itself). */
export function threadTree(c: Council, proposalId: string): ThreadNode[] {
    const ordered = byTime(readableReplies(c).filter((r) => r.proposalid === proposalId));
    const nodes = new Map<string, ThreadNode>();
    const roots: ThreadNode[] = [];
    for (const reply of ordered) {
        const node: ThreadNode = { key: reply.id, kind: "reply", depth: 0, author: reply.author, reply, children: [] };
        // a parent is only taken from the replies before this one, so a loop of parent ids cannot hide a branch
        const parent = reply.parentid ? nodes.get(reply.parentid) : undefined;
        nodes.set(reply.id, node);
        (parent?.children ?? roots).push(node);
    }
    if (c.state === "running") {
        for (const e of panel(c)) {
            const a = c.activity?.[e.id];
            if (a == null || a.proposalid !== proposalId) {
                continue;
            }
            const typing: ThreadNode = {
                key: `typing:${e.id}`,
                kind: "typing",
                depth: 0,
                author: e.id,
                text: `${e.name} is writing a reply…`,
                children: [],
            };
            const parent = a.parentid ? nodes.get(a.parentid) : undefined;
            (parent?.children ?? roots).push(typing);
        }
    }
    setDepth(roots, 0);
    return roots;
}

/** Pure: a thread in reading order, each node before its children. */
export function flattenThread(nodes: ThreadNode[]): ThreadNode[] {
    const out: ThreadNode[] = [];
    const walk = (list: ThreadNode[]) => {
        for (const n of list) {
            out.push(n);
            walk(n.children);
        }
    };
    walk(nodes);
    return out;
}

// ---- who answers a reply ----

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `@RAM` or `@new user` or `@nu`: the expert's name or id after an @ that does not sit inside a word, and does not
// run on into a longer one
function mentions(text: string, e: CouncilExpert): boolean {
    return [e.name, e.id].some((word) => {
        const w = word.trim();
        return w !== "" && new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapeRe(w)}(?![\\p{L}\\p{N}_])`, "iu").test(text);
    });
}

/** Pure: the experts a reply of the person's reaches (pkg/council's `To`, worked out the same way): the ones it
 *  @-mentions by name or id, else the proposal's author and every expert on the path to the reply it answers; with no
 *  proposal (Ask the whole council), every non-coordinator expert. The coordinator never answers. */
export function answerers(c: Council, proposalId: string, parentId: string, text: string): CouncilExpert[] {
    const pool = panel(c);
    const named = pool.filter((e) => mentions(text, e));
    if (named.length > 0) {
        return named;
    }
    const proposal = (c.proposals ?? []).find((p) => p.id === proposalId);
    if (proposal == null) {
        return pool;
    }
    const byId = new Map((c.replies ?? []).map((r) => [r.id, r]));
    const path = new Set<string>([proposal.author]);
    const seen = new Set<string>();
    for (let r = byId.get(parentId); r != null && !seen.has(r.id); r = r.parentid ? byId.get(r.parentid) : undefined) {
        seen.add(r.id);
        path.add(r.author);
    }
    return pool.filter((e) => path.has(e.id));
}

/** Pure: the label under the person's own reply while it waits for an answer; empty once it is answered, and for
 *  anyone else's reply. A reply posted before the last seat round reaches the seats at the next one; one posted in the
 *  last round or while the summary is written is answered in the follow-up pass, after the summary. */
export function replyLabel(c: Council, reply: CouncilReply): string {
    if (reply.author !== YOU || reply.answered) {
        return "";
    }
    if (reply.round >= firstFollowRound(c)) {
        return c.state === "running" ? "Answering…" : "";
    }
    if (reply.round < roundsOf(c) || c.state === "awaiting-you") {
        return "Queued for the next step";
    }
    return "Answered after the summary";
}

// ---- numbers as words ----

/** Pure: a counted token total as the cost line and the expert cards show it: 84k, then hundredths of a million
 *  from 100k up (0.31M, 0.86M). */
export function countTokens(n: number): string {
    if (n < 1000) {
        return String(Math.max(0, Math.round(n)));
    }
    if (n < 100_000) {
        return `${Math.round(n / 1000)}k`;
    }
    return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Pure: an estimated token total as wsh prints it (`FormatTokens` in pkg/council): 84k, then tenths of a million
 *  from 100k up (~0.8M, ~0.3M). */
export function estimateTokens(n: number): string {
    if (n < 1000) {
        return String(Math.max(0, Math.round(n)));
    }
    const k = Math.floor((n + 500) / 1000);
    if (k < 100) {
        return `${k}k`;
    }
    const tenths = Math.floor((n + 50_000) / 100_000);
    const whole = Math.floor(tenths / 10);
    const frac = tenths % 10;
    return `${whole}${frac === 0 ? "" : `.${frac}`}M`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pure: `≈ 9 calls · ~0.8M tokens · ~6 min`; `minutes` false leaves the time out (`≈ 5 calls · ~0.3M tokens`). */
export function estimateLabel(est: CouncilEstimateRtnData, minutes = true): string {
    const parts = [`≈ ${plural(est.calls, "call", "calls")}`, `~${estimateTokens(est.tokens)} tokens`];
    if (minutes) {
        parts.push(`~${est.minutes} min`);
    }
    return parts.join(" · ");
}

/** Pure: the cost label under a follow-up's composer: who answers, whether they read code, and the estimate (which
 *  may not have come back yet). Empty when no one would answer. */
export function followupLabel(est: CouncilEstimateRtnData | null, k: number, tools: boolean): string {
    if (k <= 0) {
        return "";
    }
    const who = k === 1 ? "1 expert answers" : `${k} experts answer`;
    const head = tools ? `${who}, reading code` : who;
    return est == null ? head : `${head} · ${estimateLabel(est, false)}`;
}

function clock(ms: number): string {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function duration(ms: number): string {
    const s = Math.round(Math.max(0, ms) / 1000);
    if (s < 60) {
        return `${s} s`;
    }
    const m = Math.floor(s / 60);
    return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
}

// where a council's clock stops: now while it runs, else its summary or its last save
function endMs(c: Council, nowMs: number): number {
    return c.state === "running" ? nowMs : c.summary?.at || c.updated;
}

function elapsedMs(c: Council, nowMs: number): number {
    return c.started ? Math.max(0, endMs(c, nowMs) - c.started) : 0;
}

// ---- state words ----

// seats with a reply being written or a call running (the coordinator is not one of them)
function writing(c: Council): number {
    return panel(c).filter((e) => c.activity?.[e.id] != null).length;
}

const STATE_WORD: Record<string, string> = {
    running: "Running",
    "awaiting-you": "Waiting on you",
    done: "Done",
    "not-run": "Not run",
    stopped: "Stopped",
    failed: "Failed",
    queued: "Queued",
};

/** Pure: `2 drafts wait for you`, `1 draft waits for you`; empty for none. The Councils row's word, and the tail of
 *  the step chip. */
export function draftsWaitWord(n: number): string {
    if (n <= 0) {
        return "";
    }
    return n === 1 ? "1 draft waits for you" : `${n} drafts wait for you`;
}

// the step a council is in while it works: the seats' round, the summary being written, or a follow-up being answered
function stepWord(c: Council): string {
    if (c.round > synthesisRound(c)) {
        const n = writing(c);
        return n > 0 ? `Follow-up · ${n} answering` : "Follow-up";
    }
    if (c.round === synthesisRound(c)) {
        return "Writing the summary";
    }
    return `Round ${Math.max(1, c.round)} of ${roundsOf(c)}`;
}

/** Pure: the chip in the Discussion's header: the step while the council runs (`Round 2 of 2`, `Writing the summary`,
 *  `Follow-up · 2 answering`), else the state (`Waiting on you`, `Done`). While drafts are held the step carries
 *  ` · 2 drafts wait for you`: a council waiting on held drafts reads its step instead of `Waiting on you`, and a done
 *  one with a held follow-up answer reads `Done · 1 draft waits for you`. */
export function headerChip(c: Council): string {
    const waits = draftsWaitWord(heldDrafts(c).length);
    const tail = waits === "" ? "" : ` · ${waits}`;
    switch (c.state) {
        case "running":
            return stepWord(c) + tail;
        case "awaiting-you":
            return waits === "" ? STATE_WORD[c.state] : stepWord(c) + tail;
        case "done":
            return STATE_WORD[c.state] + tail;
        default:
            return STATE_WORD[c.state] ?? c.state;
    }
}

/** Pure: a council's row in the Agent tree: its state in a word and the tone it is drawn in. A council with held drafts
 *  reads `2 drafts wait for you` in the amber tone (it is the person's move), whether it still runs, waits or is done. */
export function treeMeta(c: Council): { text: string; tone: CouncilTone } {
    const waits = draftsWaitWord(heldDrafts(c).length);
    if (waits !== "" && (c.state === "running" || c.state === "awaiting-you" || c.state === "done")) {
        return { text: waits, tone: "asking" };
    }
    switch (c.state) {
        case "running":
            return { text: c.round > synthesisRound(c) ? "Answering" : "Running", tone: "working" };
        case "awaiting-you":
            return { text: "Waiting on you", tone: "asking" };
        case "failed":
            return { text: "Failed", tone: "error" };
        default:
            return { text: STATE_WORD[c.state] ?? c.state, tone: "muted" };
    }
}

// what a seat's activity reads while its turn waits for the agent behind it to finish its own task (AgentCaller's
// OnTool line in pkg/council/agentcaller.go)
const WAITING_FOR_AGENT = /^Waiting for (.+) to finish its task$/;

// `A`, `A and B`, `A, B and C`
function listAnd(names: string[]): string {
    return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Pure: a queued council's line: `Queued`, or `Queued · after <the council that runs>` once the one it waits on is
 *  known (`holder`, found by the queued council's `queuedafter`), and `Queued · after room · waiting for Witness
 *  synthesis` while that council holds the slot on a busy agent (its seats' activity says `Waiting for <agent> to
 *  finish its task`). The Agent tree's row and the queued council's own body both read it. */
export function queuedLine(holder: Council | null | undefined): string {
    if (holder == null) {
        return "Queued";
    }
    const line = `Queued · after ${holder.feature.trim() || UNTITLED_COUNCIL}`;
    if (holder.state !== "running") {
        return line;
    }
    const agents = Object.values(holder.activity ?? {})
        .map((a) => WAITING_FOR_AGENT.exec(a.text)?.[1])
        .filter((name): name is string => name != null);
    return agents.length > 0 ? `${line} · waiting for ${listAnd([...new Set(agents)])}` : line;
}

/** Pure: the Summary's chip: `Done · 4 experts · 11 min · 0.86M tokens`. */
export function summaryChip(c: Council, nowMs: number): string {
    const parts = [STATE_WORD[c.state] ?? c.state, plural(panel(c).length, "expert", "experts")];
    const ms = elapsedMs(c, nowMs);
    if (c.started) {
        parts.push(`${Math.max(1, Math.round(ms / 60_000))} min`);
    }
    parts.push(`${countTokens(c.tokens)} tokens`);
    return parts.join(" · ");
}

/** Pure: the Discussion header's cost line: `7:20 · 19 replies · 0.55M tokens` (reactions are no replies). */
export function costLine(c: Council, nowMs: number): string {
    const parts: string[] = [];
    if (c.started) {
        parts.push(clock(elapsedMs(c, nowMs)));
    }
    parts.push(plural(readableReplies(c).length, "reply", "replies"), `${countTokens(c.tokens)} tokens`);
    return parts.join(" · ");
}

/** Pure: one expert's time and tokens so far, from `stats`: `1 min 52 s · 84k tokens`; empty before its first call. */
export function expertStat(c: Council, expertId: string): string {
    const s = c.stats?.[expertId];
    return s == null ? "" : `${duration(s.ms)} · ${countTokens(s.tokens)} tokens`;
}

/** Pure: the progress bar, one segment per call of the whole council (one per seat in each round and the synthesis: 9
 *  for four in two rounds): the finished calls first, then the failed ones, then those running, then those still to
 *  come. A `done` council has nothing left to come: a call a failed expert's round 2 skipped counts as done. */
export function callSegments(c: Council): SegmentState[] {
    const total = roundsOf(c) * panel(c).length + 1;
    const failed = Math.min(Object.keys(c.failed ?? {}).length, total);
    const done = Math.max(0, Math.min(c.calls, total - failed));
    const running = c.state === "running" ? Math.min(Object.keys(c.activity ?? {}).length, total - done - failed) : 0;
    const rest = total - done - failed - running;
    const out: SegmentState[] = [];
    const push = (n: number, s: SegmentState) => out.push(...Array<SegmentState>(n).fill(s));
    push(done, "done");
    push(failed, "failed");
    push(running, "running");
    push(rest, c.state === "done" ? "done" : "pending");
    return out;
}

// ---- the summary ----

/** Pure: the replies sent after the summary, which make it `Outdated · N replies since`. A draft the person has not
 *  sent and a dropped one are not in it: the summary is not out of date for a reply no seat has seen. */
export function outdatedCount(c: Council): number {
    const at = c.summary?.at;
    return at == null ? 0 : sentReplies(c).filter((r) => r.ts > at).length;
}

/** Pure: whether Summarize is on: exactly when Runner.summarizeLocked takes it. It refuses a council the runner is
 *  running (in round 2 the synthesis comes by itself when the round ends) and accepts one at rest in any round, so a
 *  council stopped at the pause or failed in round 1 can still be summarized; it needs a sent idea to summarize (a held
 *  draft and a dropped one reached no seat, and the runner refuses a council with only those). */
export function canSummarize(c: Council): boolean {
    if (sentProposals(c).length === 0) {
        return false;
    }
    switch (c.state) {
        case "awaiting-you":
        case "done":
        case "stopped":
        case "failed":
            return true;
        default:
            return false;
    }
}

/** Pure: why Summarize is off, for the button's title (`canSummarize` false). */
export function summarizeHold(c: Council): string {
    if (c.state === "not-run") {
        return "This council has not run";
    }
    if (c.state === "running") {
        if (c.round >= synthesisRound(c)) {
            return "Summarize is on again when the council stops";
        }
        return c.round > 1
            ? "The summary comes by itself when the experts finish replying"
            : "Summarize unlocks after the experts' first ideas";
    }
    // no sent idea: an idea still held waits on the person, else there is nothing to send
    return (c.proposals ?? []).some((p) => p.draft === DRAFT_HELD)
        ? "Send or drop the drafts first"
        : "There is no proposal to summarize";
}

export interface MatrixCell {
    expert: CouncilExpert;
    stance: StanceLabel | ""; // empty: the expert never took a stance on it
    reason: string;
}

export interface MatrixRow {
    proposal: CouncilProposal;
    cells: MatrixCell[]; // one per expert of the panel, in its order
    outcome: string; // `Direction 1`, `Merged into direction 3`, `Withdrawn`
}

// a proposal's argument down to its first sentence: the author's cell in the matrix
function firstSentence(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    const m = /^.*?[.!?](?=\s|$)/.exec(flat);
    return m != null ? m[0] : flat;
}

/** Pure: the Summary's matrix: every proposal against every expert of the panel, each cell the expert's last stance
 *  and its reason (the author's cell, `proposed`, carries the first sentence of the argument), then the outcome the
 *  summary gave the proposal. Rows follow the direction a proposal went into, those in none last. Empty before a
 *  summary. An idea that was held or dropped has no row, and a reply that was held or dropped is no cell's reason. */
export function matrixRows(c: Council): MatrixRow[] {
    const summary = c.summary;
    if (summary == null) {
        return [];
    }
    const stances = latestStances(c);
    const replies = byTime(sentReplies(c));
    const rankOf = (id: string) => {
        const ranks = summary.directions.filter((d) => d.from.includes(id)).map((d) => d.rank);
        return ranks.length > 0 ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER;
    };
    return sentProposals(c)
        .map((proposal, i) => ({ proposal, i, rank: rankOf(proposal.id) }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map(({ proposal }) => ({
            proposal,
            cells: panel(c).map((expert): MatrixCell => {
                const stance = stances[proposal.id]?.[expert.id];
                if (stance == null) {
                    return { expert, stance: "", reason: "" };
                }
                if (stance === "proposed") {
                    return { expert, stance, reason: firstSentence(proposal.argument) };
                }
                const last = replies.filter(
                    (r) => r.proposalid === proposal.id && r.author === expert.id && r.stance === stance
                );
                return { expert, stance, reason: last[last.length - 1]?.text ?? "" };
            }),
            outcome:
                summary.outcomes[proposal.id] ??
                (proposal.cut ? "Cut at the pause" : proposal.withdrawn ? "Withdrawn" : ""),
        }));
}

// ---- Setup ----

/** A live agent a council can seat: what the Agent tree and Setup's Add agent picker know of one. */
export interface SeatableAgent {
    id: string; // the agent's tab id
    name: string;
    project: string; // the path of the project the agent works in
    harness: string; // claude or pi
    context: number; // tokens in its context now, which the estimate prices a turn at
}

/** Pure: the seat for a live agent: the id is its own (it cannot meet a role expert's), `agent` names its tab, and it
 *  has no brief or model of its own (it answers from its own session and context). */
export function agentSeat(a: SeatableAgent): CouncilExpert {
    return {
        id: `agent-${a.id}`,
        name: a.name,
        brief: "",
        model: "",
        agent: a.id,
        harness: a.harness,
        context: a.context,
    };
}

/** An agent seated in a draft: the seat as the wire takes it, and the project the agent works in (a council's own is the
 *  first agent's, so Setup can say how many other projects the seats come from). */
export interface DraftAgent {
    seat: CouncilExpert;
    project: string;
}

/** What Setup holds for one project: the form, the coordinator's suggestion, and whether the person picked the group
 *  (a suggested group never overrides a picked one). A draft lives in `councilSetupDraftAtom` so it survives
 *  switching away. */
export interface CouncilSetupDraft {
    project: string;
    feature: string;
    question: string;
    files: string[];
    screenshots: string[];
    group: string; // the group id, empty for none
    experts: CouncilExpert[]; // the panel, the coordinator last: the role experts only, a group never touches `agents`
    agents: DraftAgent[]; // the live agents seated, in the order they were added; the start sends them before `experts`
    rounds: number; // how many rounds the seats answer, 1 to 3; it counts only while an agent is seated
    pause: boolean;
    sessionId?: string; // the agent session that starts the council
    suggestion?: CouncilSuggestion;
    suggestState: "idle" | "asking" | "done" | "failed";
    groupPicked: boolean;
    mode: "review" | "brainstorm";
    modePicked: boolean; // the person flipped the mode chip, so a new suggestion does not change it
}

/** Pure: a blank draft for a project. */
export function emptyCouncilDraft(project: string): CouncilSetupDraft {
    return {
        project,
        feature: "",
        question: "",
        files: [],
        screenshots: [],
        group: "",
        experts: [],
        agents: [],
        rounds: DEFAULT_ROUNDS,
        pause: false,
        suggestState: "idle",
        groupPicked: false,
        mode: "review",
        modePicked: false,
    };
}

/** Pure: a draft with `agents` seated and the first one's project as the council's project, for Discuss together and
 *  anywhere else that starts Setup from live agents. The panel stays empty, so Setup fills in its first group. */
export function draftWithAgents(agents: readonly SeatableAgent[]): CouncilSetupDraft {
    if (agents.length === 0) {
        throw new Error("draftWithAgents needs at least one agent");
    }
    return {
        ...emptyCouncilDraft(agents[0].project),
        agents: agents.map((a) => ({ seat: agentSeat(a), project: a.project })),
    };
}

/** Pure: the draft Run again opens: the council's inputs and panel, with the group and the mode counted as picked so
 *  a new suggestion does not change them. A council saved before modes has none, which reads as Review. Its agent seats
 *  go to `agents`, each in the council's project (the record keeps no other), and its rounds read as `roundsOf`. */
export function draftFromCouncil(c: Council): CouncilSetupDraft {
    return {
        project: c.project,
        feature: c.feature,
        question: c.question ?? "",
        files: [...(c.files ?? [])],
        screenshots: [...(c.screenshots ?? [])],
        group: c.group ?? "",
        experts: c.experts.filter((e) => !isAgentSeat(e)).map((e) => ({ ...e })),
        agents: c.experts.filter(isAgentSeat).map((e) => ({ seat: { ...e }, project: c.project })),
        rounds: roundsOf(c),
        pause: c.pauseafterround1 ?? false,
        sessionId: c.sessionid || undefined,
        suggestState: "idle",
        groupPicked: true,
        mode: c.mode === "brainstorm" ? "brainstorm" : "review",
        modePicked: true,
    };
}
