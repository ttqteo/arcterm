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

import { stripMarks } from "./councilmarks";

export type CouncilView = "discussion" | "summary" | "setup" | "map";

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

/** Pure: what the person asked, as the council skill writes it (skills/council/SKILL.md): the question, then after
 *  "Keep to:" the limits they stated, split at semicolons with a closing period dropped. Without "Keep to:" there are
 *  no limits; the question is trimmed, its own line breaks kept. */
export function askedParts(question: string | undefined): { question: string; limits: string[] } {
    const q = (question ?? "").trim();
    const at = q.indexOf("Keep to:");
    if (at < 0) {
        return { question: q, limits: [] };
    }
    const limits = q
        .slice(at + "Keep to:".length)
        .split(";")
        .map((s) => s.trim().replace(/\.$/, "").trim())
        .filter((s) => s !== "");
    const head = q.slice(0, at).trim();
    return { question: head === "" ? q : head, limits };
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
    if (id === ROUTER && !c.experts.some((e) => e.id === id)) {
        return "Router";
    }
    return c.experts.find((e) => e.id === id)?.name ?? id;
}

// the author of the router's own answer to small talk (Go council routerId): it is no seat
const ROUTER = "router";

/** Pure: whether a reply is agreement with nothing to add: an expert's accept with no text, or its answer to the person
 *  with no text and no stance (it agrees with the answer another seat gave first). It is drawn as a reaction, never as
 *  a reply, and counts in no reply total; an accept still counts in the vote and the synthesis reads it. */
export function isReaction(r: CouncilReply): boolean {
    return r.author !== YOU && (r.stance === "accept" || !r.stance) && r.text.trim() === "";
}

/** The person's like or dislike on a seat's sent idea or reply (Go council.ThumbLike, council.ThumbDislike); the seats'
 *  later prompts and the summary read it as the person's view. Not a reaction: that is a seat's agreement. */
export type CouncilThumb = "like" | "dislike";

/** Pure: an idea's or a reply's thumb, "" for none or a word the cockpit does not know. */
export function thumbOf(x: { thumb?: string }): CouncilThumb | "" {
    return x.thumb === "like" || x.thumb === "dislike" ? x.thumb : "";
}

/** Pure: the thumb a press leaves: the one pressed, or none when it was already on (a second press takes it back). */
export function nextThumb(current: CouncilThumb | "", pressed: CouncilThumb): CouncilThumb | "" {
    return current === pressed ? "" : pressed;
}

/** Pure: `c` with the thumb of the idea or reply `item` set ("" takes it off), the rest of the record as it was; `c`
 *  itself when it has no such item. */
export function withThumb(c: Council, item: string, thumb: CouncilThumb | ""): Council {
    const set = <T extends { id: string; thumb?: string }>(xs: T[] | undefined): T[] | undefined =>
        xs?.map((x) => (x.id === item ? { ...x, thumb: thumb === "" ? undefined : thumb } : x));
    if ((c.proposals ?? []).some((p) => p.id === item)) {
        return { ...c, proposals: set(c.proposals) };
    }
    if ((c.replies ?? []).some((r) => r.id === item)) {
        return { ...c, replies: set(c.replies) };
    }
    return c;
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

/** Pure: a council the person pinned, in any state: only the person pins, a run never touches it. */
export function isPinnedCouncil(c: Pick<Council, "pinned">): boolean {
    return (c.pinned ?? 0) > 0;
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

// ---- file mentions ----

// What an `@` can start a file with: letters, digits and `_ - . / ~`. pkg/council reads an `@` the same way
// (fileMentions in runner.go): the two share the example table in their tests, so change them together.
const PATH_CHARS = "\\p{L}\\p{N}_\\-./~";
const PATH_RUN = new RegExp(`[${PATH_CHARS}]*`, "uy");
const PATH_WHOLE = new RegExp(`^[${PATH_CHARS}]+$`, "u");
const AFTER_WORD = /[\p{L}\p{N}_]$/u;

/** A file the person named with an `@`: where the `@` sits (`start`), where the path ends (`end`) and the path, without
 *  the `@`. */
export interface FileMention {
    start: number;
    end: number;
    path: string;
}

/** Pure: the files a message names. An `@` that does not follow a letter, digit or `_` (an address's `@` sits inside a
 *  word) starts one when the longest run of path characters after it, less the dots that end a sentence, holds a `/` or a
 *  `.`: `@ux/plan.md`, `@ram.go`, `@./x`, `@~/x`; `@UX.` is the seat UX and a full stop. A seat or a chat is never named
 *  by an `@` that starts a file mention (`mentions`, `mentionsChat`), so `@ux/plan.md` is no mention of UX. */
export function fileMentions(text: string): FileMention[] {
    const out: FileMention[] = [];
    for (let at = text.indexOf("@"); at >= 0; at = text.indexOf("@", at + 1)) {
        if (at > 0 && AFTER_WORD.test(text.slice(Math.max(0, at - 2), at))) {
            continue;
        }
        PATH_RUN.lastIndex = at + 1;
        const run = PATH_RUN.exec(text)?.[0] ?? "";
        const path = run.replace(/\.+$/, "");
        if (/[/.]/.test(path)) {
            out.push({ start: at, end: at + 1 + path.length, path });
        }
    }
    return out;
}

/** Pure: whether `path` is a file `@<path>` names whole: every character is one a path run holds, it holds a `/` or a
 *  `.` and does not end in a dot. A project file that is not (a space, a bracket, no slash or dot in `Makefile`) would
 *  be cut short or left unread, so the `@` list does not offer it. */
export function isMentionablePath(path: string): boolean {
    return PATH_WHOLE.test(path) && /[/.]/.test(path) && !path.endsWith(".");
}

// `text` with the `@` of each file mention turned into a `#`, so the seat and chat readers below, which look for an
// `@`, pass over the files. Nothing else moves: an `@` right after a file mention's last character still has a word
// before it, as it does in the Go reader.
function withoutFileMentions(text: string): string {
    let out = "";
    let from = 0;
    for (const m of fileMentions(text)) {
        out += `${text.slice(from, m.start)}#`;
        from = m.start + 1;
    }
    return from === 0 ? text : out + text.slice(from);
}

// ---- who answers a reply ----

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `@RAM` or `@new user` or `@nu`: the expert's name or id after an @ that does not sit inside a word, and does not
// run on into a longer one; not an @ that starts a file (`@ram.go`)
function mentions(text: string, e: CouncilExpert): boolean {
    const said = withoutFileMentions(text);
    return [e.name, e.id].some((word) => {
        const w = word.trim();
        return w !== "" && new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapeRe(w)}(?![\\p{L}\\p{N}_])`, "iu").test(said);
    });
}

// `@all` or `@everyone` as a whole word after an @ that does not sit inside a word: the rule `mentions` reads a seat by
const NAMES_ALL = /(^|[^\p{L}\p{N}_])@(?:all|everyone)(?![\p{L}\p{N}_])/iu;

/** Pure: whether `text` asks every seat on purpose, with `@all` or `@everyone` (a whole word, any case; not `@allison`,
 *  an address, or an `@all.md` that starts a file). Such a message skips the router and reaches the whole panel, as
 *  `replyTargets` in pkg/council reads it. */
export function mentionsAll(text: string): boolean {
    return NAMES_ALL.test(withoutFileMentions(text));
}

/** The fewest characters of a chat's tab id that make a mention key: `@82faafca`. */
export const MIN_CHAT_KEY = 8;

// the word after an @ that does not sit inside another word, read as far as it runs over letters, digits, `_` and `-`
// (a UUID tab id has its first `-` at character 9, so a key that tells two chats apart reads `3e19c0d2-a`)
const MENTIONED_WORD = /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/gu;

/** Pure: whether `text` @-mentions the chat whose tab id is `tabId` by its mention key: `@` and a whole word of
 *  {@link MIN_CHAT_KEY} characters or more that starts the tab id (any case) and starts no other tab id in `tabIds`
 *  (the chats it must be told apart from: the chat seats' and, in the composer, the ones joining). An `@` that starts a
 *  file mention (`@3e19c0d2-a/x.ts`) names no chat. It is the rule wavesrv reads a chat seat's mention by, so what the
 *  composer shows is what Send reaches. */
export function mentionsChat(text: string, tabId: string, tabIds: readonly string[]): boolean {
    const own = tabId.toLowerCase();
    if (own.length < MIN_CHAT_KEY) {
        return false;
    }
    const others = tabIds.map((t) => t.toLowerCase()).filter((t) => t !== own);
    for (const found of withoutFileMentions(text).toLowerCase().matchAll(MENTIONED_WORD)) {
        const word = found[2];
        if (word.length >= MIN_CHAT_KEY && own.startsWith(word) && !others.some((t) => t.startsWith(word))) {
            return true;
        }
    }
    return false;
}

/** Pure: the tab ids of the chats seated in a council, the chats a chat's mention key must be told apart from. */
export function chatSeatTabs(c: Pick<Council, "experts">): string[] {
    return c.experts.flatMap((e) => (e.agent ? [e.agent] : []));
}

// the seats a text names by an @ (and the chats joining with it), as `answerers` reads them: by name or id, a chat seat
// also by its mention key
function namedExperts(c: Council, text: string, joining: readonly SeatableAgent[]): CouncilExpert[] {
    const seated = new Set(chatSeatTabs(c));
    const joined = new Set(joining.map((a) => a.id));
    const tabs = [...seated, ...joined];
    return [
        ...panel(c).filter(
            (e) => mentions(text, e) || (isAgentSeat(e) && (joined.has(e.agent) || mentionsChat(text, e.agent, tabs)))
        ),
        ...joining.filter((a) => !seated.has(a.id)).map(agentSeat),
    ];
}

/** Pure: the experts a reply of the person's reaches (pkg/council's `To`, worked out the same way): every expert for an
 *  `@all` or `@everyone` (`mentionsAll`); else the ones it @-mentions by name or id (a chat seat also by its mention key,
 *  `mentionsChat`), else the proposal's author and every expert on the path to the reply it answers; with no proposal
 *  (Ask the whole council), every non-coordinator expert. The coordinator never answers. Whether the router narrows
 *  that last case to one seat or two is `routedMessage`: this is who it is addressed to.
 *
 *  `joining` are the live chats the message adds to the council (the ones its @ picked): they count as named, after the
 *  seats, each as the seat wavesrv seats it as (`agentSeat`); a chat that already is a seat is the seat, once. */
export function answerers(
    c: Council,
    proposalId: string,
    parentId: string,
    text: string,
    joining: readonly SeatableAgent[] = []
): CouncilExpert[] {
    const pool = panel(c);
    if (mentionsAll(text)) {
        const seated = new Set(chatSeatTabs(c));
        return [...pool, ...joining.filter((a) => !seated.has(a.id)).map(agentSeat)];
    }
    const named = namedExperts(c, text, joining);
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

/** Pure: whether the router takes up a message of the person's: wavesrv's rule (`appendPersonReply` in pkg/council) for
 *  when it narrows a whole-council message to the seat or two best placed to answer. The message is on no idea and
 *  under no reply, names no seat and no chat with an @, holds no `@all`, seats no chat (`joining`), and the council has
 *  two seats or more with no failed call to choose from: with one there is nothing to choose, and the whole panel
 *  answers as before. */
export function routedMessage(
    c: Council,
    proposalId: string,
    parentId: string,
    text: string,
    joining: readonly SeatableAgent[] = []
): boolean {
    if (proposalId !== "" || parentId !== "" || joining.length > 0 || mentionsAll(text)) {
        return false;
    }
    if (namedExperts(c, text, []).length > 0) {
        return false;
    }
    return panel(c).filter((e) => c.failed?.[e.id] == null).length >= 2;
}

/** Pure: the label under the person's own reply while it waits for an answer; empty once it is answered, and for
 *  anyone else's reply. A reply posted before the last seat round reaches the seats at the next one; one posted in the
 *  last round or while the summary is written is answered in the follow-up pass, after the summary. */
// the person's follow-up while the seats answer it (councilseen.ts reads it as Sent, then Seen)
export const ANSWERING = "Answering…";

/** Pure: what the person's post says when a seat it went to failed on it and never answered it: `New user could not
 *  answer: <error>`, the seats' Retry brings it back. The pass that answers a post marks it answered whatever came of its
 *  calls, so a post that is answered while a seat it went to failed in its round or later and wrote no answer under it
 *  is one that seat failed on. Empty for a post not answered yet (a seat that failed meanwhile has its own failure line,
 *  and the pass may still reach the post), and when every seat it went to answered or has not failed. */
function failedOn(c: Council, reply: CouncilReply): string {
    if (!reply.answered) {
        return "";
    }
    const lines: string[] = [];
    for (const id of reply.to ?? []) {
        const failure = c.failed?.[id];
        if (failure == null || failure.round < reply.round) {
            continue;
        }
        const answered = (c.replies ?? []).some((r) => r.parentid === reply.id && r.author === id);
        if (!answered) {
            const error = failure.error.trim();
            lines.push(`${authorName(c, id)} could not answer${error === "" ? "" : `: ${error}`}`);
        }
    }
    return lines.join(" · ");
}

/** What the person's post says while the router has not picked its seats yet (`routed.pending`: its `to` is empty). */
export const ROUTER_CHOOSING = "Router is choosing a seat…";

export function replyLabel(c: Council, reply: CouncilReply): string {
    if (reply.author !== YOU) {
        return "";
    }
    const failed = failedOn(c, reply);
    if (failed !== "") {
        return failed;
    }
    if (reply.answered) {
        return "";
    }
    if (reply.routed?.pending) {
        return ROUTER_CHOOSING;
    }
    if (reply.round >= firstFollowRound(c)) {
        return c.state === "running" ? ANSWERING : "";
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

// a range's ends in one unit where they can be (`35k–235k`, not `35k–0.2M`): thousands up to a million, then estimateTokens
function rangeTokens(n: number): string {
    return n >= 1000 && n < 1_000_000 ? `${Math.round(n / 1000)}k` : estimateTokens(n);
}

/** Pure: `≈ 9 calls · ~0.8M tokens · ~6 min`; `minutes` false leaves the time out (`≈ 5 calls · ~0.3M tokens`). An
 *  estimate that holds a high end (`callsmax`, `tokensmax`: a message the router picks the seats for) draws each end that
 *  differs from its low end as a range: `≈ 2–3 calls · ~35k–235k tokens`. */
export function estimateLabel(est: CouncilEstimateRtnData, minutes = true): string {
    const callsMax = est.callsmax != null && est.callsmax !== est.calls ? est.callsmax : null;
    const tokensMax = est.tokensmax != null && est.tokensmax !== est.tokens ? est.tokensmax : null;
    const parts = [
        callsMax == null
            ? `≈ ${plural(est.calls, "call", "calls")}`
            : `≈ ${est.calls}–${plural(callsMax, "call", "calls")}`,
        tokensMax == null
            ? `~${estimateTokens(est.tokens)} tokens`
            : `~${rangeTokens(est.tokens)}–${rangeTokens(tokensMax)} tokens`,
    ];
    if (minutes) {
        parts.push(`~${est.minutes} min`);
    }
    return parts.join(" · ");
}

/** The line under a composer whose message the router would take, outside a follow-up (nothing is priced there). */
export const ROUTER_PICKS_WHO = "The router picks who answers";

/** Pure: the cost label under a follow-up's composer for a message the router takes (`routedMessage`): `Router picks 1–2
 *  seats`, then the estimate's range once it is in (`≈ 2–3 calls · ~35k–235k tokens`). A reply of no calls is wavesrv's
 *  "nobody can answer": it draws no figure, as before the estimate came back. */
export function routedLabel(est: CouncilEstimateRtnData | null): string {
    const head = "Router picks 1–2 seats";
    return est == null || est.calls <= 0 ? head : `${head} · ${estimateLabel(est, false)}`;
}

/** Pure: the cost label under a follow-up's composer: who answers (`experts` role experts and `chats` live chats, both
 *  counted: `1 expert and 1 chat answer`, `2 experts answer`, `1 chat answers`), whether they read files, and the
 *  estimate (which may not have come back yet). Empty when no one would answer. */
export function followupLabel(est: CouncilEstimateRtnData | null, experts: number, tools: boolean, chats = 0): string {
    if (experts <= 0 && chats <= 0) {
        return "";
    }
    const groups = [
        experts > 0 ? plural(experts, "expert", "experts") : "",
        chats > 0 ? plural(chats, "chat", "chats") : "",
    ].filter((g) => g !== "");
    const who = `${groups.join(" and ")} ${groups.length === 1 && experts + chats === 1 ? "answers" : "answer"}`;
    const head = tools ? `${who}, reading files` : who;
    return est == null ? head : `${head} · ${estimateLabel(est, false)}`;
}

function clock(ms: number): string {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Pure: a span the way the expert stats read it: `42 s`, `2 min`, `2 min 5 s`. */
export function duration(ms: number): string {
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

// the time the council ran: the runs' total (`ranms`) plus the run going now (`runstarted`), so a council started
// yesterday and chatted in today counts only its runs. A council that keeps neither (an older file) is timed from
// `started` to where its clock stops.
function elapsedMs(c: Council, nowMs: number): number {
    const ran = c.ranms ?? 0;
    const since = c.runstarted ?? 0;
    if (ran > 0 || since > 0) {
        return ran + (since > 0 ? Math.max(0, nowMs - since) : 0);
    }
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

/** Pure: the three figures of the report's glance box: the experts, the minutes (when the council started) and the
 *  tokens, each a value over its label. */
export function glanceFigures(c: Council, nowMs: number): { value: string; label: string }[] {
    const n = panel(c).length;
    const figures = [{ value: String(n), label: n === 1 ? "expert" : "experts" }];
    if (c.started) {
        figures.push({ value: String(Math.max(1, Math.round(elapsedMs(c, nowMs) / 60_000))), label: "min" });
    }
    figures.push({ value: countTokens(c.tokens), label: "tokens" });
    return figures;
}

/** Pure: the Summary's state word, with `4 experts · 11 min · 0.86M tokens` as the glance box's label. */
export function summaryFacts(c: Council, nowMs: number): { state: string; facts: string } {
    const facts = glanceFigures(c, nowMs)
        .map((f) => `${f.value} ${f.label}`)
        .join(" · ");
    return { state: STATE_WORD[c.state] ?? c.state, facts };
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

/** What came after a council's summary: the sent ideas posted since (`ideas`), the ideas their authors revised since
 *  (`revised`), the seats whose latest stance on an idea differs from their stance on it before the summary
 *  (`stances`), and every other reply sent since, the person's included and reactions left out (`replies`). */
export interface OutdatedChanges {
    ideas: number;
    revised: number;
    stances: number;
    replies: number;
}

/** Pure: what changed after the summary (`summary.at`), by plain comparison. Only a new idea, a revision or a changed
 *  stance could change the answer; a seat's first stance on an idea is no change, and the stances and replies on an
 *  idea posted after the summary fold into that new idea. A held or a dropped idea or reply reached no seat and counts
 *  for nothing. All zero before a summary. */
export function outdatedChanges(c: Council): OutdatedChanges {
    const out: OutdatedChanges = { ideas: 0, revised: 0, stances: 0, replies: 0 };
    const at = c.summary?.at;
    if (at == null) {
        return out;
    }
    const fresh = new Set(
        sentProposals(c)
            .filter((p) => p.ts > at)
            .map((p) => p.id)
    );
    out.ideas = fresh.size;
    const before = latestStances({ ...c, replies: (c.replies ?? []).filter((r) => r.ts <= at) });
    const after = latestStances(c);
    // `${seat} ${idea}` of each changed stance
    const changed = new Set<string>();
    for (const [idea, of] of Object.entries(after)) {
        if (fresh.has(idea)) {
            continue;
        }
        for (const [seat, stance] of Object.entries(of)) {
            const was = before[idea]?.[seat];
            if (was != null && was !== stance) {
                changed.add(`${seat} ${idea}`);
            }
        }
    }
    out.stances = changed.size;
    const revised = new Set<string>();
    for (const r of sentReplies(c)) {
        if (r.ts <= at || fresh.has(r.proposalid)) {
            continue;
        }
        if (r.revised && r.author !== YOU) {
            revised.add(r.proposalid);
        } else if (!(isStance(r.stance) && changed.has(`${r.author} ${r.proposalid}`)) && !isReaction(r)) {
            out.replies++;
        }
    }
    out.revised = revised.size;
    return out;
}

/** Pure: how many changes make the summary `Outdated` (outdatedChanges' ideas, revisions and changed stances); the
 *  plain replies since do not. */
export function outdatedCount(c: Council): number {
    const o = outdatedChanges(c);
    return o.ideas + o.revised + o.stances;
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

// ---- the council's language and the check labels ----

/** The two languages a council is held in (Go's `LangEn`, `LangVi`): the words of the Map, the check badges and the
 *  timeline follow it. A council saved before the language was kept has none, which reads as English. */
export type CouncilLang = "en" | "vi";

/** Pure: a council's language; anything but `vi` reads as English. */
export function councilLang(c: Pick<Council, "lang"> | null | undefined): CouncilLang {
    return c?.lang === "vi" ? "vi" : "en";
}

/** The label Go gives a claim, from what it checked (Go's `LabelRan`…): `ran` a command ran and its result matched what
 *  the expert expected, `disproved` it ran and the result contradicts it, `read` at least one cite resolves, `guess`
 *  nothing checkable. */
export type CheckLabel = "ran" | "disproved" | "read" | "guess";

/** The four labels, in the order the evidence bar draws them. */
export const CHECK_LABELS: readonly CheckLabel[] = ["ran", "disproved", "read", "guess"];

// the badge words, one pair per label; the legend and the evidence chips read them too
const CHECK_WORD: Record<CouncilLang, Record<CheckLabel, string>> = {
    en: { ran: "Ran", disproved: "Disproved", read: "Read code", guess: "Guess" },
    vi: { ran: "Đã chạy", disproved: "Bị bác", read: "Đã đọc code", guess: "Chỉ đoán" },
};

const WRONG_CITE_WORD: Record<CouncilLang, string> = { en: "Wrong cite", vi: "Trích sai" };

/** Pure: the label on a proposal or a reply, `""` for none or a word the cockpit does not know. */
export function checkLabelOf(x: { label?: string }): CheckLabel | "" {
    return CHECK_LABELS.find((l) => l === x.label) ?? "";
}

/** Pure: a label's badge word in the council's language: `Ran`, `Disproved`, `Read code`, `Guess`. */
export function checkWord(label: CheckLabel, lang: CouncilLang): string {
    return CHECK_WORD[lang][label];
}

/** Pure: the word on a cite Go found wrong (`CouncilEvidence.cite` is `wrong`). */
export function wrongCiteWord(lang: CouncilLang): string {
    return WRONG_CITE_WORD[lang];
}

// ---- the matrix ----

// the words the matrix rows carry, one table per language: the pills, the agreement line, the revised note, the outcomes
// of an idea with no summary, the Builds on pill and a verify command's result
interface MatrixWords {
    pill: Record<StanceLabel | "none", string>;
    agree: (n: number) => string;
    doubt: (n: number) => string;
    against: (n: number) => string;
    noStances: string;
    revised: (round: number) => string;
    cut: string;
    withdrawn: string;
    builds: (n: number) => string;
    passedAsExpected: string;
    failedAsExpected: string;
    passedUnexpectedly: string;
    failedUnexpectedly: string;
    notRun: (reason: string) => string;
}

const MATRIX_WORDS: Record<CouncilLang, MatrixWords> = {
    en: {
        pill: { proposed: "Proposed", accept: "Agrees", challenge: "Has doubts", oppose: "Against", none: "not said" },
        agree: (n) => `${n} agree`,
        doubt: (n) => `${n} ${n === 1 ? "doubt" : "doubts"}`,
        against: (n) => `${n} against`,
        noStances: "No stances yet",
        revised: (round) => `revised in round ${round}`,
        cut: "Cut at the pause",
        withdrawn: "Withdrawn",
        builds: (n) => `Builds on · ${n}`,
        passedAsExpected: "passed, as expected",
        failedAsExpected: "failed, as expected",
        passedUnexpectedly: "passed, but a failure was expected",
        failedUnexpectedly: "failed, but a pass was expected",
        notRun: (reason) => (reason === "" ? "not run" : `not run: ${reason}`),
    },
    vi: {
        pill: {
            proposed: "Đưa ra ý",
            accept: "Đồng ý",
            challenge: "Còn nghi ngờ",
            oppose: "Phản đối",
            none: "chưa nói",
        },
        agree: (n) => `${n} đồng ý`,
        doubt: (n) => `${n} nghi ngờ`,
        against: (n) => `${n} phản đối`,
        noStances: "Chưa ai nêu ý kiến",
        revised: (round) => `đã sửa ở vòng ${round}`,
        cut: "Bị cắt ở điểm dừng",
        withdrawn: "Đã rút",
        builds: (n) => `Phát triển thêm · ${n}`,
        passedAsExpected: "đạt, đúng như dự đoán",
        failedAsExpected: "thất bại, đúng như dự đoán",
        passedUnexpectedly: "đạt, nhưng dự đoán là thất bại",
        failedUnexpectedly: "thất bại, nhưng dự đoán là đạt",
        notRun: (reason) => (reason === "" ? "không chạy" : `không chạy: ${reason}`),
    },
};

export interface MatrixCell {
    expert: CouncilExpert;
    stance: StanceLabel | ""; // empty: the expert never took a stance on it
    reason: string;
    word: string; // the pill's word: `Agrees`, `Has doubts`, `not said`…
    revisedRound: number; // the round the idea's author revised it after this seat's challenge; 0 for none
    note: string; // `revised in round 2`; empty for none
}

/** The check badge under an idea's title: the label Go gave the idea, and what backs it. */
export interface CheckBadge {
    label: CheckLabel;
    word: string; // `Ran`, `Disproved`, `Read code`, `Guess`
    command: string; // Ran or Disproved: the first command that tested the idea
    result: string; // that command's result in words (`failed, as expected`)
    cite: string; // Read code: the first cite that holds (`path:line`)
}

/** A Brainstorm idea's Builds on pill: the seats whose reply builds on it. */
export interface BuildsPill {
    count: number;
    by: string[]; // the seats' ids, in panel order
    word: string; // `Builds on · 2`
}

export interface MatrixRow {
    proposal: CouncilProposal;
    cells: MatrixCell[]; // one per expert of the panel, in its order
    outcome: string; // `Direction 1`, `Merged into direction 3`, `Withdrawn`; empty while the idea is in the running
    withdrawn: boolean; // its author withdrew it
    dimmed: boolean; // withdrawn, or cut by the person at the pause: the row is drawn dim
    agrees: number; // the seats other than the author, by the stance each took last
    doubts: number;
    against: number;
    consensus: string; // `2 agree · 1 doubt`
    check: CheckBadge | null; // null where Go labelled nothing, and always in a Brainstorm
    builds: BuildsPill | null; // a Brainstorm idea some seat builds on; null for any other
}

/** Pure: a message without its tables, diagrams and code blocks, and its list items as plain lines: a matrix cell has
 *  room for words only. A message that is nothing but a table comes back empty. */
export function proseOf(text: string): string {
    const out: string[] = [];
    let fenced = false;
    for (const line of text.split("\n")) {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            continue;
        }
        if (fenced || /^\s*\|/.test(line)) {
            continue;
        }
        out.push(line.replace(/^\s*(?:\d+[.)]|[-*+])\s+/, ""));
    }
    return out
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// a proposal's argument down to its first sentence: the author's cell in the matrix
function firstSentence(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    const m = /^.*?[.!?](?=\s|$)/.exec(flat);
    return m != null ? m[0] : flat;
}

// a verify command's result in words: whether it passed or failed and whether that is what the expert expected; a command
// that did not run says why. Only a pass or a fail tested the idea.
function runResult(run: CouncilRun, w: MatrixWords): string {
    if (run.state !== "pass" && run.state !== "fail") {
        return w.notRun(run.reason ?? "");
    }
    const asExpected = run.matched === true;
    if (run.state === "pass") {
        return asExpected ? w.passedAsExpected : w.passedUnexpectedly;
    }
    return asExpected ? w.failedAsExpected : w.failedUnexpectedly;
}

// the badge under an idea's title; none where Go labelled nothing, and none in a Brainstorm, which asks for no evidence
function checkBadge(c: Council, p: CouncilProposal, lang: CouncilLang, w: MatrixWords): CheckBadge | null {
    const label = checkLabelOf(p);
    if (label === "" || c.mode === "brainstorm") {
        return null;
    }
    const badge: CheckBadge = { label, word: checkWord(label, lang), command: "", result: "", cite: "" };
    if (label === "ran" || label === "disproved") {
        // the first command that tested the idea and came out the way the label says; else the first that tested it
        const runs = p.runs ?? [];
        const tested = runs.filter((r) => r.state === "pass" || r.state === "fail");
        const run = tested.find((r) => (r.matched === true) === (label === "ran")) ?? tested[0] ?? runs[0];
        if (run != null) {
            badge.command = run.command;
            badge.result = runResult(run, w);
        }
    } else if (label === "read") {
        badge.cite = (p.evidence ?? []).find((e) => e.cite === "ok")?.ref ?? "";
    }
    return badge;
}

// the Builds on pill of a Brainstorm idea: the seats, not its author, whose sent reply builds on it
function buildsPill(c: Council, p: CouncilProposal, replies: CouncilReply[], w: MatrixWords): BuildsPill | null {
    if (c.mode !== "brainstorm") {
        return null;
    }
    const by = panel(c)
        .filter(
            (e) =>
                e.id !== p.author &&
                replies.some((r) => r.proposalid === p.id && r.builds === true && r.author === e.id)
        )
        .map((e) => e.id);
    return by.length === 0 ? null : { count: by.length, by, word: w.builds(by.length) };
}

// per idea and seat, the round the idea's author revised it after that seat's challenge: a revised reply of the author's
// answers (`parentid`) the challenge it was written for; the latest round wins
function revisedRounds(c: Council, replies: CouncilReply[]): Map<string, number> {
    const byId = new Map(replies.map((r) => [r.id, r]));
    const authors = new Map((c.proposals ?? []).map((p) => [p.id, p.author]));
    const out = new Map<string, number>();
    for (const r of replies) {
        if (!r.revised || !r.parentid || r.author === YOU || r.author !== authors.get(r.proposalid)) {
            continue;
        }
        const asked = byId.get(r.parentid);
        if (asked == null || asked.proposalid !== r.proposalid || asked.author === r.author || asked.author === YOU) {
            continue;
        }
        const key = `${r.proposalid} ${asked.author}`;
        out.set(key, Math.max(out.get(key) ?? 0, r.round));
    }
    return out;
}

/** Pure: the matrix behind the Summary and the Map: every sent proposal against every expert of the panel, each cell the
 *  expert's last stance with its pill word and its reason (the author's cell, `proposed`, carries the first sentence of
 *  the argument) and, where the author revised the idea after that seat's challenge, `revised in round N`; then the
 *  outcome the summary gave the proposal (before a summary it comes from cut and withdrawn alone), the agreement counts
 *  with their words, Go's check badge and, in a Brainstorm, the Builds on pill. Rows follow the direction a proposal
 *  went into, those in none last, so before a summary they are in arrival order; the Map sorts them with `byAgreement`.
 *  It works while the council runs. An idea that was held or dropped has no row, and a reply that was held or dropped
 *  is no cell's reason. The words follow the council's language. */
export function matrixRows(c: Council): MatrixRow[] {
    const summary = c.summary;
    const lang = councilLang(c);
    const w = MATRIX_WORDS[lang];
    const stances = latestStances(c);
    const replies = byTime(sentReplies(c));
    const revised = revisedRounds(c, replies);
    const rankOf = (id: string) => {
        const ranks = (summary?.directions ?? []).filter((d) => d.from.includes(id)).map((d) => d.rank);
        return ranks.length > 0 ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER;
    };
    return sentProposals(c)
        .map((proposal, i) => ({ proposal, i, rank: rankOf(proposal.id) }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map(({ proposal }): MatrixRow => {
            const cells = panel(c).map((expert): MatrixCell => {
                const stance = stances[proposal.id]?.[expert.id];
                // a withdrawn idea was not revised: its last revised reply is the withdrawal
                const revisedRound = proposal.withdrawn ? 0 : (revised.get(`${proposal.id} ${expert.id}`) ?? 0);
                const note = revisedRound > 0 ? w.revised(revisedRound) : "";
                if (stance == null) {
                    return { expert, stance: "", reason: "", word: w.pill.none, revisedRound, note };
                }
                const word = w.pill[stance];
                if (stance === "proposed") {
                    // the marks go first: the first sentence could cut a mark in half
                    const reason = firstSentence(stripMarks(proseOf(proposal.argument)));
                    return { expert, stance, reason, word, revisedRound, note };
                }
                const last = replies.filter(
                    (r) => r.proposalid === proposal.id && r.author === expert.id && r.stance === stance
                );
                return { expert, stance, reason: proseOf(last[last.length - 1]?.text ?? ""), word, revisedRound, note };
            });
            const others = cells.filter((x) => x.stance !== "" && x.stance !== "proposed");
            const agrees = others.filter((x) => x.stance === "accept").length;
            const doubts = others.filter((x) => x.stance === "challenge").length;
            const against = others.filter((x) => x.stance === "oppose").length;
            const said = [
                agrees > 0 ? w.agree(agrees) : "",
                doubts > 0 ? w.doubt(doubts) : "",
                against > 0 ? w.against(against) : "",
            ].filter((s) => s !== "");
            return {
                proposal,
                cells,
                outcome:
                    summary?.outcomes?.[proposal.id] ?? (proposal.cut ? w.cut : proposal.withdrawn ? w.withdrawn : ""),
                withdrawn: proposal.withdrawn === true,
                dimmed: proposal.withdrawn === true || proposal.cut === true,
                agrees,
                doubts,
                against,
                consensus: said.length > 0 ? said.join(" · ") : w.noStances,
                check: checkBadge(c, proposal, lang, w),
                builds: buildsPill(c, proposal, replies, w),
            };
        });
}

/** Pure: the rows by agreement, the most agreed first: the seats that agree minus the ones against, then the fewer
 *  doubts, then the order they came in (`matrixRows`'). The Map's order; the rows it is given are left as they were. */
export function byAgreement(rows: MatrixRow[]): MatrixRow[] {
    return rows
        .map((row, i) => ({ row, i }))
        .sort(
            (a, b) =>
                b.row.agrees - b.row.against - (a.row.agrees - a.row.against) ||
                a.row.doubts - b.row.doubts ||
                a.i - b.i
        )
        .map((x) => x.row);
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
    autoState?: "asking" | "confirm" | "failed"; // Auto-generate: waiting on the answer, on Replace / Keep, or failed; absent = idle
    autoError?: string; // the one-line reason while Auto-generate is `failed`
    autoPending?: CouncilAutoGenerate; // an answer that waits on Replace / Keep, for a composer that holds text
    autoLast?: string; // the composer text the last applied answer produced, so a second press may replace it unasked
    modeFrom?: "conversation"; // Auto-generate picked the mode; a flip of the chip clears it
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
