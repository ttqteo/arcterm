// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The conversation of a Claude agent as chat draws it: your messages as bubbles, the agent's prose and the work between
// two pieces of it as one group behind its avatar, and a prompt arcterm typed (a run's launch prompt, a wake, a message
// from another agent) as a card of its own naming who sent it, never as something you said. Built on groupCompact
// (compacttimeline.ts), so a stretch of tools folds into one "Worked for 38s · 5 tools" line and a file edited many
// times into one `+a −d` count exactly as the compact view does. Pure; chatview.tsx draws it.
//
// The prompts are recognized by their opening, with the arc view mod's own readers (claude/arc-view-mod/hooks, pure and
// import-free), so the engine's wording is pinned once, by the fixtures in that mod's testdata.

import {
    cardHeader,
    parseRunPrompt,
    parseStreamPrompt,
    pointerPath,
    type Card,
} from "../../../../claude/arc-view-mod/hooks/prompt-core";
import { parseWake, recapLine, wakeSummary, type Wake } from "../../../../claude/arc-view-mod/hooks/wake-core";
import type {
    AgentActionEntry,
    AgentEntry,
    AgentState,
    AskQuestionDetail,
    BtwAnswer,
    EditFile,
    ShellResult,
} from "./agentsviewmodel";
import { councilStartAnchor, type CouncilAnchor } from "./chatcouncil";
import { isDocReviewAsk } from "./chatdocreview";
import { isHandoffAsk } from "./chathandoff";
import { runStartAnchor, type RunAnchor } from "./chatruncards";
import {
    pairReviewer,
    REVIEW_LANG,
    splitReviewBlocks,
    verdictFromFindings,
    type ReviewerCall,
    type Verdict,
} from "./chatverdict";
import { groupCompact, workOf, type CompactItem, type WorkItem } from "./compacttimeline";
import { opensPanel } from "./slashcommands";
import type { TurnStats } from "./transcriptprojection";

/** One piece of what the agent did between two of your messages. */
export type AgentPart =
    // `uuid`: the transcript record the prose came from, which Fork from here cuts at. `live`: a reply still being
    // written, which the transcript does not hold yet (chatlive.ts)
    | { kind: "prose"; text: string; uuid?: string; live?: true }
    | { kind: "work"; work: WorkItem }
    // the files that work edited, once per path with the summed counts; follows its work part
    | { kind: "files"; files: EditFile[]; adds: number; dels: number }
    // Five moments Chat draws as cards of their own (chatverdict.ts, chathandoff.ts, chatruncards.ts, chatcouncil.ts,
    // chatdocreview.ts); each `key` is `<kind>:<entry index>` of the message or call it came from, so it holds as entries
    // append. A reviewer's verdict: an ```arc-review block cut out of a reply, or a `ReportFindings` call (`reviewer`: the
    // Agent / Task call a block judges, when one pairs)
    | { kind: "verdict"; key: string; verdict: Verdict; reviewer?: ReviewerCall }
    // the plan handoff: an AskUserQuestion with the header `Handoff`, answered or not (`question.picked` / `typed`)
    | { kind: "handoff"; key: string; question: AskQuestionDetail }
    // a `wsh runs start` call's run: where that run's card sits (the call itself stays a tool line in the work before it)
    | { kind: "runstart"; key: string; anchor: RunAnchor }
    // a `wsh council start` call's council: where its card or row sits (the call itself stays a tool line before it)
    | { kind: "councilstart"; key: string; anchor: CouncilAnchor }
    // a Doc review: an AskUserQuestion `isDocReviewAsk` reads, answered or not (`question.picked` / `typed`)
    | { kind: "docreview"; key: string; question: AskQuestionDetail };

/** Who sent a prompt arcterm typed into the session. */
export type SentFrom = "run" | "cockpit";

/** What stands between two agent groups without being said by either: a compaction, an interruption, a finished task. */
export type ChatMarker = Extract<CompactItem, { kind: "compaction" | "interrupted" | "notification" }>;

export type ChatItem =
    // a message you typed; `images` is what you pasted with it (data URLs), left off when there were none; `uuid` the
    // transcript record it came from, which Fork from here cuts at
    | { kind: "you"; key: string; text: string; images?: string[]; uuid?: string }
    // a slash command or skill you typed, as "/name args" (check with `"command" in item`), or a bash-mode command, which
    // reads "! cmd"; `shell` is what it printed once that lands. `terminal`: a panel only Claude Code's own screen drew
    // (/config, /usage…), which left nothing here to show. `btw`: a /btw's side answer
    | { kind: "you"; key: string; command: string; shell?: ShellResult; terminal?: true; btw?: BtwAnswer }
    // a prompt arcterm typed: `header` names it, `lines` are its fields as "label value" and its body (at most SENT_LINES)
    | { kind: "sent"; key: string; from: SentFrom; header: string; lines: string[] }
    // everything the agent said and did between two of the items around it
    | { kind: "agent"; key: string; parts: AgentPart[] }
    | { kind: "marker"; key: string; item: ChatMarker };

/** The most lines a sent card carries. */
export const SENT_LINES = 6;

/** Header of the card for a launch prompt too long for a command line, which reached the session as a pointer to a file. */
const POINTER_HEADER = "run prompt · from a file";

// a key is the first entry's index (entries are append-only, so it never changes as the transcript grows), prefixed by
// the item's kind so a glance at a key says what it is
function keyOf(kind: ChatItem["kind"], index: number): string {
    return `${kind}:${index}`;
}

function cardLines(card: Card): string[] {
    return [...card.fields.map((f) => `${f.label} ${f.value}`), ...card.body].slice(0, SENT_LINES);
}

// a wake draws as one line per event, what passed unverified, and the recaps it folds away, as its row in the TUI does
function wakeLines(wake: Wake): string[] {
    return [
        ...wake.events.map((e) => e.headline),
        ...wake.caveats.map((c) => `unverified ${c}`),
        ...(wake.recaps > 0 ? [recapLine(wake.recaps)] : []),
    ].slice(0, SENT_LINES);
}

type Sent = { from: SentFrom; header: string; lines: string[] };

// what arcterm typed, or null for text a person wrote. The text is trimmed to be read only: a trailing newline must not
// hide a line the parsers anchor to its end, and the bubble keeps the text as it was.
function readSent(text: string): Sent | null {
    const t = text.trim();
    const run = parseRunPrompt(t);
    if (run != null) {
        return { from: "run", header: cardHeader(run), lines: cardLines(run) };
    }
    const file = pointerPath(t);
    if (file != null) {
        return { from: "run", header: POINTER_HEADER, lines: [file] };
    }
    const wake = parseWake(t);
    if (wake != null) {
        return { from: "cockpit", header: wakeSummary(wake), lines: wakeLines(wake) };
    }
    const sent = parseStreamPrompt(t);
    if (sent != null && !isBrainstormLineOfYours(sent)) {
        return { from: "cockpit", header: cardHeader(sent), lines: cardLines(sent) };
    }
    return null;
}

// The three `brainstorm:` lines wavesrv sends by itself (pkg/brainstormcheck: the judge's result, its failure, the builder
// check's questions). They have no send record, and nothing in Chat's own box or cards can produce them.
const SERVER_BRAINSTORM_LINE = /^(?:judged |judge failed:|builder questions )/;

// A `brainstorm: …` line is your message in Chat, unlike in Claude Code's own transcript, where the view mod draws it as a
// card: the cards and the box send these lines (confirm, check, run <id>, a builder's answer…), and Chat judges one by its
// send record (chatbrainstormwire.ts answerMessages offers `you` items to pairAnswers). A paired line is hidden or folded
// into its ✓ row; an unpaired one is the user's own words, a bubble.
function isBrainstormLineOfYours(card: Card): boolean {
    return card.role === "brainstorm" && !SERVER_BRAINSTORM_LINE.test(card.body[0] ?? "");
}

// "/review PR #402"; a skill's name carries no slash of its own, a slash command's does
function commandText(c: { name: string; args?: string; isSkill?: boolean }): string {
    const name = c.isSkill ? `/${c.name}` : c.name;
    return c.args ? `${name} ${c.args}` : name;
}

// a panel's closing line ("Config dialog dismissed", "Theme picker dismissed"): it says nothing a reader needs
const DISMISSED = /^[^\n]* dismissed$/;

// a command as your side of chat: what it printed under it, or, for a panel that printed nothing but its closing line,
// a mark that it opened on Claude Code's own screen
function commandItem(c: Extract<CompactItem, { kind: "command" }>): Extract<ChatItem, { kind: "you" }> {
    const key = keyOf("you", c.index);
    const command = commandText(c);
    const shell = c.shell;
    const said = shell != null && (shell.error !== "" || !DISMISSED.test(shell.output));
    if (!c.isSkill && c.name.startsWith("/") && !said && opensPanel(c.name.slice(1))) {
        return { kind: "you", key, command, terminal: true };
    }
    return { kind: "you", key, command, ...(shell != null ? { shell } : {}), ...(c.btw != null ? { btw: c.btw } : {}) };
}

// the transcript record a message of yours or a reply came from: a timeline item holds its entry's index, not its uuid
function recordUuid(entry: AgentEntry | undefined): string | undefined {
    return entry != null && (entry.kind === "user" || entry.kind === "message") ? entry.uuid : undefined;
}

// What a tool call is to Chat when it is more than a tool line: the review a `ReportFindings` call reports, the plan
// handoff, a Doc review ask, a run `wsh runs start` began, or a council `wsh council start` began.
type Moment =
    | { kind: "verdict"; verdict: Verdict }
    | { kind: "handoff"; question: AskQuestionDetail }
    | { kind: "docreview"; question: AskQuestionDetail }
    | { kind: "runstart"; anchor: RunAnchor }
    | { kind: "councilstart"; anchor: CouncilAnchor };

function momentOf(action: AgentActionEntry): Moment | null {
    if (action.findings != null) {
        const verdict = verdictFromFindings({ findings: action.findings });
        return verdict != null ? { kind: "verdict", verdict } : null;
    }
    const detail = action.detail;
    if (detail?.kind === "ask") {
        if (isHandoffAsk(detail.questions)) {
            return { kind: "handoff", question: detail.questions[0] };
        }
        return isDocReviewAsk(detail.questions) ? { kind: "docreview", question: detail.questions[0] } : null;
    }
    if (detail?.kind === "bash") {
        const command = detail.command ?? "";
        const run = runStartAnchor(command, detail.output);
        if (run != null) {
            return { kind: "runstart", anchor: run };
        }
        const council = councilStartAnchor(command, detail.output);
        return council != null ? { kind: "councilstart", anchor: council } : null;
    }
    return null;
}

// a work part, and the files part that follows it when its tools edited any
function pushWork(parts: AgentPart[], work: WorkItem): void {
    parts.push({ kind: "work", work });
    if (work.files.length > 0) {
        parts.push({ kind: "files", files: work.files, adds: work.adds, dels: work.dels });
    }
}

type VerdictPart = Extract<AgentPart, { kind: "verdict" }>;

/**
 * Pure: the transcript as chat items. Every agent-side item (a message, a stretch of tools) between two of your
 * messages, a sent card or a marker joins one group; a marker splits the agent's side in two, since it is a point in the
 * conversation of its own.
 *
 * A group is cut at five moments, each a part of its own: a reply holding an ```arc-review block (the prose before and
 * after it kept as parts), a `ReportFindings` call, a `Handoff` ask and a Doc review ask (all cut out of the stretch of
 * tools they sit in, no tool line left for them), and a `wsh runs start` or `wsh council start` call whose output names a
 * run or a council (the stretch is split after the call, which stays a tool line).
 */
export function chatItems(entries: AgentEntry[]): ChatItem[] {
    const out: ChatItem[] = [];
    let group: Extract<ChatItem, { kind: "agent" }> | null = null;
    // the Agent / Task calls of the group so far, which a reply's review block pairs with; a block is paired once the
    // group is complete, since the call it names may come after it
    let calls: ReviewerCall[] = [];
    const unpaired: { part: VerdictPart; blockIndex: number; calls: ReviewerCall[] }[] = [];
    // the group the next agent-side item joins, opened by that item's own entry index
    const agentParts = (index: number): AgentPart[] => {
        if (group == null) {
            group = { kind: "agent", key: keyOf("agent", index), parts: [] };
            calls = [];
            out.push(group);
        }
        return group.parts;
    };
    for (const item of groupCompact(entries)) {
        switch (item.kind) {
            case "user": {
                group = null;
                const sent = readSent(item.text);
                if (sent != null) {
                    out.push({ kind: "sent", key: keyOf("sent", item.index), ...sent });
                } else {
                    const uuid = recordUuid(entries[item.index]);
                    out.push({
                        kind: "you",
                        key: keyOf("you", item.index),
                        text: item.text,
                        ...(item.images != null ? { images: item.images } : {}),
                        ...(uuid != null ? { uuid } : {}),
                    });
                }
                break;
            }
            case "command":
                group = null;
                out.push(commandItem(item));
                break;
            case "message": {
                const uuid = recordUuid(entries[item.index]);
                const parts = agentParts(item.index);
                // a reply with no review block is kept as it was written (the split trims the prose around a block)
                const pieces = item.text.includes(REVIEW_LANG) ? splitReviewBlocks(item.text) : [];
                const blocks = pieces.filter((p) => p.kind === "verdict").length;
                if (blocks === 0) {
                    parts.push({ kind: "prose", text: item.text, ...(uuid != null ? { uuid } : {}) });
                    break;
                }
                let n = 0;
                for (const piece of pieces) {
                    if (piece.kind === "prose") {
                        parts.push({ kind: "prose", text: piece.text, ...(uuid != null ? { uuid } : {}) });
                        continue;
                    }
                    const key = blocks > 1 ? `verdict:${item.index}.${n}` : `verdict:${item.index}`;
                    n++;
                    const part: VerdictPart = { kind: "verdict", key, verdict: piece.verdict };
                    parts.push(part);
                    unpaired.push({ part, blockIndex: item.index, calls });
                }
                break;
            }
            case "work": {
                const parts = agentParts(item.startIndex);
                item.actions.forEach((a, k) => {
                    if (a.subagent != null) {
                        calls.push({
                            description: a.subagent.description,
                            ...(a.subagent.subagentType != null ? { subagentType: a.subagent.subagentType } : {}),
                            ...(a.subagent.toolUseId != null ? { toolUseId: a.subagent.toolUseId } : {}),
                            index: item.startIndex + k,
                        });
                    }
                });
                // the tools [from, to) as a work part; the stretch itself when nothing cuts it
                let from = 0;
                const cut = (to: number): void => {
                    if (to > from) {
                        const whole = from === 0 && to === item.actions.length;
                        pushWork(parts, whole ? item : workOf(item.startIndex + from, item.actions.slice(from, to)));
                    }
                    from = to;
                };
                item.actions.forEach((a, k) => {
                    const moment = momentOf(a);
                    if (moment == null) {
                        return;
                    }
                    const index = item.startIndex + k;
                    if (moment.kind === "runstart") {
                        cut(k + 1);
                        parts.push({ kind: "runstart", key: `runstart:${index}`, anchor: moment.anchor });
                        return;
                    }
                    if (moment.kind === "councilstart") {
                        cut(k + 1);
                        parts.push({ kind: "councilstart", key: `councilstart:${index}`, anchor: moment.anchor });
                        return;
                    }
                    cut(k);
                    from = k + 1;
                    switch (moment.kind) {
                        case "verdict":
                            parts.push({ kind: "verdict", key: `verdict:${index}`, verdict: moment.verdict });
                            break;
                        case "handoff":
                            parts.push({ kind: "handoff", key: `handoff:${index}`, question: moment.question });
                            break;
                        case "docreview":
                            parts.push({ kind: "docreview", key: `docreview:${index}`, question: moment.question });
                            break;
                    }
                });
                cut(item.actions.length);
                break;
            }
            case "compaction":
            case "interrupted":
            case "notification":
                group = null;
                out.push({ kind: "marker", key: keyOf("marker", item.index), item });
                break;
        }
    }
    for (const { part, blockIndex, calls: groupCalls } of unpaired) {
        const reviewer = pairReviewer(part.verdict, groupCalls, blockIndex);
        if (reviewer != null) {
            part.reviewer = reviewer;
        }
    }
    return out;
}

/**
 * Pure: whether the agent went on after the verdict at `parts[p]` of an agent item, which is when its card stops waiting on
 * you and folds. It did when it wrote another reply or made another call after the entry the verdict came from (the key
 * holds that entry's index), or is writing one now (a `live` prose part after it). The closing words of the reply that
 * holds a block ("Tell me which of these to fix.") are the same entry, so they are no sign of it: the card waits while
 * nothing but those follows it. `entries` are the ones `chatItems` was given.
 */
export function agentWentOn(entries: readonly AgentEntry[], parts: readonly AgentPart[], p: number): boolean {
    const part = parts[p];
    if (part?.kind !== "verdict") {
        return false;
    }
    if (parts.slice(p + 1).some((q) => q.kind === "prose" && q.live)) {
        return true;
    }
    const at = parseInt(part.key.slice(part.key.indexOf(":") + 1), 10);
    return entries.slice(at + 1).some((e) => e.kind === "message" || e.kind === "action");
}

// "860", "3.1k", "13k", "1.3M": one decimal while the number is short, as the TUI's counter reads
function shortCount(n: number): string {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    }
    if (n >= 10_000) {
        return `${Math.round(n / 1_000)}k`;
    }
    if (n >= 1_000) {
        return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    }
    return String(n);
}

// "34s", "1m 11s", "1h 2m"
function shortDuration(ms: number): string {
    const secs = Math.max(0, Math.floor(ms / 1000));
    if (secs < 60) {
        return `${secs}s`;
    }
    const mins = Math.floor(secs / 60);
    if (mins < 60) {
        return `${mins}m ${secs % 60}s`;
    }
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Pure: what the working line adds of the turn under way, as the TUI's "(1m 11s · ↓ 3.1k tokens)": how long it has
 *  run and the output tokens of its replies so far (transcriptprojection.ts turnStats). The tokens are left out before
 *  the first reply lands, and the time when the prompt carried none. */
export function turnStatsLabel(stats: TurnStats, now: number): string {
    const parts: string[] = [];
    if (Number.isFinite(stats.startedAt)) {
        parts.push(shortDuration(now - stats.startedAt));
    }
    if (stats.outputTokens > 0) {
        parts.push(`↓ ${shortCount(stats.outputTokens)} ${stats.outputTokens === 1 ? "token" : "tokens"}`);
    }
    return parts.join(" · ");
}

/** Pure: whether the box's text runs as a bash command: it starts with `!`, which Claude Code's own box reads as bash
 *  mode when the text is typed into it, so the command runs in the agent's shell and its output joins the
 *  conversation. A `!` after a leading space is plain text there too. */
export function bashMode(text: string): boolean {
    return text.startsWith("!");
}

/** Claude Code's send-now chord, ctrl+x ctrl+s (its other key, ctrl+enter, reaches it as a plain Enter from some
 *  terminals): it sends every queued message at once, moving the running tools to the background instead of ending
 *  the turn (v2.1.281 on). */
export const SEND_NOW_KEYS = "\x18\x13";

/** Pure: whether a queued message offers Send now: only while Claude works. While it asks, a permission or question
 *  prompt holds the keys, and the chord would land in the prompt instead. */
export function canSendNow(state: AgentState): boolean {
    return state === "working";
}

/** The activity a typed /compact reports while it runs (baseds.AgentDetail_Compacting, from the PreCompact hook); the
 *  SessionStart that follows the compaction reads idle and clears it. */
export const COMPACTING_ACTIVITY = "compacting";

/** Pure: whether the agent is compacting its conversation: no turn of its own is under way, so the working line says
 *  Compacting… with no turn time, which would count from the last prompt. */
export function compactingNow(state: AgentState, activity: string | undefined): boolean {
    return state === "working" && activity?.trim() === COMPACTING_ACTIVITY;
}

/** Pure: the agent side's "working" line while the agent works, null otherwise. */
export function workingLine(state: AgentState, activity: string | undefined): string | null {
    if (state !== "working") {
        return null;
    }
    if (compactingNow(state, activity)) {
        return "Compacting…";
    }
    const what = activity?.trim();
    return what ? `Working · ${what}` : "Working…";
}

/** Pure: the working line, naming the running tool's own description when the last entry is a tool with no result yet. */
export function workingText(state: AgentState, activity: string | undefined, entries: AgentEntry[]): string | null {
    const line = workingLine(state, activity);
    if (line == null || compactingNow(state, activity)) {
        return line;
    }
    const last = entries[entries.length - 1];
    if (last?.kind === "action" && last.outcome == null && last.target.trim() !== "") {
        return `Working · ${last.target.trim()}`;
    }
    return line;
}

/** How many more items a "Show earlier" reveals, and how many the view starts with. */
export const CHAT_RENDER_STEP = 120;

/** Pure: the last `shown` items, so a long conversation draws its newest part and reveals earlier ones on request. */
export function shownItems<T>(items: T[], shown: number): T[] {
    const n = Math.floor(shown);
    if (!(n > 0)) {
        return [];
    }
    return n >= items.length ? items : items.slice(items.length - n);
}
