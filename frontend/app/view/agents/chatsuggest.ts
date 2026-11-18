// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat's suggested replies: the chips in the message box once an agent's turn ends (chatcomposer.tsx draws them, and
// while the agent works draws its own two, Show the diff and Open the terminal, each once it has something to show:
// runningActions). They are what the person would likely
// send next, in their own words ("commit đi", not "Commit"), and a click sends one. They come from two places:
//
// - rules over what Chat already knows, shown at once: the turn left its edits uncommitted ("commit đi") or its commits
//   unpushed ("push đi"), from the header's one git read (shipmodel.ts, shipstore.ts); and the initiative the agent
//   works on: a turn that committed while it holds a chunk offers to tick that chunk done (an action, as the header
//   popover's Mark done, not a message), and once its chunks are settled the next one is offered ("làm tiếp: …");
// - one haiku call (pkg/chatsuggest), a few seconds later, that reads the end of the reply: the answers to the question
//   it ends on, or the one next step only the reply shows ("vẽ tôi xem" after a layout told in words). After a long turn
//   (isLongTurn) the same call also writes a one-or-two-sentence summary of it, drawn above the chips (turnSummary).
//
// A reply that ends in a question gets the model's answers alone: a rule's "commit đi" does not answer "A, B or C?", and
// while the answers are on their way the row stays empty rather than offer a bare "ok" the agent would have to read a
// choice into. Only a call that failed or found nothing leaves "ok" there. Pure: chatsuggeststore.ts holds the
// model's answers and makes the call, chatpane.tsx wires the two.

import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import type { HintPart } from "./chatboxstate";
import { agentChunk } from "./initiativepopovermodel";
import { shipOffer, type ShipGit } from "./shipmodel";

export type ChipKind = "commit" | "push" | "reply" | "done" | "next" | "close";

/** One suggested reply: `text` is both what the chip says and what a click sends, except a `done` chip's, whose click
 *  ticks `chunk` done on the agent's initiative and sends nothing. */
export interface ChatChip {
    text: string;
    kind: ChipKind;
    source: "rule" | "model" | "fallback";
    /** a `done` or `next` chip's chunk, by its exact label */
    chunk?: string;
}

/** The part of an initiative the initiative rule reads. A workref's `ts` is when it was attached (ms). */
export interface ChipEffort {
    chunks?: { label: string; status: string; workrefs?: { kind: string; oref: string; ts?: number }[] }[];
}

/** What a chip is drawn with: its kind's icon, and a reply that asks for a build ("build đi", "build it") the hammer. */
export type ChipIcon = Exclude<ChipKind, "reply"> | "build";

const BUILD_REPLY = /^\s*(re)?build\b/i;

/** Pure: the icon a chip is drawn with, or null for a plain reply. A build reply still sends as typed; the hammer only
 *  marks it, as commit's and push's icons mark theirs. */
export function chipIcon(c: Pick<ChatChip, "kind" | "text">): ChipIcon | null {
    if (c.kind !== "reply") {
        return c.kind;
    }
    return BUILD_REPLY.test(c.text) ? "build" : null;
}

/** The model's answer for one turn, as the store holds it. A `done` answer carries the turn's summary line when the call
 *  was asked for one (a long turn: isLongTurn) and the model wrote it. */
export type ModelSuggest =
    | { status: "loading" }
    | { status: "done"; replies: string[]; summary?: string }
    | { status: "failed" };

/** at most this many chips in the row */
export const MAX_CHIPS = 3;

/** the person's last messages the model reads for their words and language */
const RECENT = 6;

/** Pure: the agent's message that closed its last turn, or null when the person spoke last, the turn was interrupted,
 *  an API error ended it (the usage limit's line is no reply to answer), or the agent wrote no text since. Tool calls,
 *  notifications and compactions after it do not hide it. */
export function lastReply(entries: readonly AgentEntry[]): string | null {
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "message") {
            return e.text.trim() === "" || e.apiError === true ? null : e.text;
        }
        if (e.kind === "user" || e.kind === "command" || e.kind === "interrupted") {
            return null;
        }
    }
    return null;
}

/** Pure: the reply's last line of prose ends with a question mark. Fenced code (a card block written after the
 *  question) is not prose, and the emphasis and highlight marks around a sentence do not count. */
export function endsWithQuestion(reply: string): boolean {
    const prose = reply.replace(/```[\s\S]*?(```|$)/g, "");
    const lines = prose.split("\n").map((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i] === "") {
            continue;
        }
        const bare = lines[i].replace(/[=*_`"'”’)\]\s]+$/u, "");
        return bare.endsWith("?") || bare.endsWith("？");
    }
    return false;
}

/** Pure: the person's last messages, oldest first, each on one line, with what a paste or a picture brought along left
 *  out: they are what the model matches the replies' wording and language to. */
export function recentPrompts(entries: readonly AgentEntry[], n = RECENT): string[] {
    const out: string[] = [];
    for (let i = entries.length - 1; i >= 0 && out.length < n; i--) {
        const e = entries[i];
        if (e.kind !== "user") {
            continue;
        }
        const own = e.text
            .split(/\n\s*Attached images:/)[0]
            .replace(/\s+/g, " ")
            .trim();
        if (own !== "") {
            out.unshift(own);
        }
    }
    return out;
}

// the letters only Vietnamese writes: one is enough to tell the person writes it
const VIETNAMESE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

/** Pure: the person writes Vietnamese, as their last messages show; the rules' chips are worded in it then. */
export function writesVietnamese(recent: readonly string[]): boolean {
    return recent.some((r) => VIETNAMESE.test(r));
}

/** Pure: the rules' chips for a turn that does not end in a question: the git work it left, from the header's read of
 *  the repo, gated as the header's Ship chip is (an agent at its prompt, no run's, not stopped on part n/m). Edits left
 *  uncommitted ask for a commit; commits only, ahead of the upstream, ask for a push. */
export function ruleChips(
    agent: Pick<AgentVM, "kind" | "blockId" | "state" | "sleeping" | "runId" | "step" | "edited" | "committed">,
    git: ShipGit | null | undefined,
    vi: boolean
): ChatChip[] {
    if (git == null || shipOffer(agent, git) == null) {
        return [];
    }
    if (agent.edited === true && git.dirty > 0) {
        return [{ text: vi ? "commit đi" : "commit it", kind: "commit", source: "rule" }];
    }
    if (git.ahead > 0 && git.upstream !== "") {
        return [{ text: vi ? "push đi" : "push it", kind: "push", source: "rule" }];
    }
    return [];
}

/** Pure: the initiative rule's chip for a turn that does not end in a question, on the initiative the agent works on.
 *  The chunk it is on is the one the band and the header popover read, by the one definition (initiativepopovermodel.ts
 *  agentChunk): the live chunk its tab holds, and nothing else (no active chunk stands in for an agent that holds none).
 *  A turn that ended on a commit offers to tick that chunk done: the work landed, and whether it is the whole chunk stays
 *  the person's call. The chip belongs to the turn: given `turnEnded` (when the agent went idle, ms), a chunk the agent
 *  was attached to after that (a switch, or Mark done carrying it forward) was not that turn's work, so it offers no
 *  done:; a workref with no stamp, or no `turnEnded`, is as it always was. Once every chunk the agent held is settled,
 *  the next one after them that no other agent holds is offered as a message to go on with. A proposed chunk is nobody's
 *  work yet. */
export function initiativeChips(
    effort: ChipEffort | null | undefined,
    tabId: string,
    committed: boolean,
    vi: boolean,
    turnEnded?: number
): ChatChip[] {
    const chunks = (effort?.chunks ?? []).filter((c) => c.status !== "proposed");
    if (chunks.length === 0) {
        return [];
    }
    const ref = "agent:" + tabId;
    const on = agentChunk({ chunks }, tabId);
    if (on != null) {
        const stamp = (on.workrefs ?? []).find((w) => w.oref === ref)?.ts;
        const ofThisTurn = turnEnded === undefined || stamp === undefined || stamp <= turnEnded;
        return committed && ofThisTurn
            ? [{ text: (vi ? "xong: " : "done: ") + on.label, kind: "done", source: "rule", chunk: on.label }]
            : [];
    }
    const mine = chunks.filter((c) => (c.workrefs ?? []).some((w) => w.oref === ref));
    if (mine.length === 0) {
        return [];
    }
    const after = chunks.indexOf(mine[mine.length - 1]) + 1;
    // another agent or a run is on it
    const othersHold = (c: (typeof chunks)[number]) => (c.workrefs ?? []).some((w) => w.oref !== ref);
    const next = chunks.slice(after).find((c) => (c.status === "active" || c.status === "pending") && !othersHold(c));
    return next == null
        ? []
        : [
              {
                  text: (vi ? "làm tiếp: " : "go on with: ") + next.label,
                  kind: "next",
                  source: "rule",
                  chunk: next.label,
              },
          ];
}

/** Pure: whether Chat asks the model about this turn: the agent is back at its prompt or asleep after it, with a reply
 *  to read and nothing else asking the person (its own question card, a brainstorm question, a message on its way), and the person
 *  has it in front of them, so an agent nobody looks at costs no call. */
export function wantsModelSuggest(i: {
    reply: string | null;
    idle: boolean;
    asking: boolean;
    questionWaits: boolean;
    pending: boolean;
    seen: boolean;
}): boolean {
    return i.reply != null && i.idle && !i.asking && !i.questionWaits && !i.pending && i.seen;
}

/** a closing reply longer than this many characters is a long turn: about one screen of the 600px Chat column */
export const LONG_TURN_CHARS = 1200;
/** a turn that made this many tool calls or more is a long turn, whatever its reply's length */
export const LONG_TURN_TOOL_CALLS = 8;

/** Pure: how many tool calls the turn made: the `action` entries after the person's last message (the turn
 *  runningActions walks). Every action counts, whatever its outcome: a command that failed was still a step the
 *  person did not watch. */
export function turnToolCount(entries: readonly AgentEntry[]): number {
    let n = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "user") {
            break;
        }
        if (e.kind === "action") {
            n++;
        }
    }
    return n;
}

/** Pure: whether the turn is long enough that the person who looked away wants it told in a sentence or two (a summary
 *  line above the chips): the closing reply is over LONG_TURN_CHARS characters, or the turn made LONG_TURN_TOOL_CALLS
 *  tool calls or more. A short turn shows only the chips. */
export function isLongTurn(reply: string, toolCalls: number): boolean {
    return reply.length > LONG_TURN_CHARS || toolCalls >= LONG_TURN_TOOL_CALLS;
}

/** Pure: the summary line the model wrote for this turn, or undefined: while the call is on its way, after it failed,
 *  before it was asked, and when it found nothing to say (no line, an empty one). */
export function turnSummary(model: ModelSuggest | undefined): string | undefined {
    if (model?.status !== "done") {
        return undefined;
    }
    const s = model.summary?.trim();
    return s === undefined || s === "" ? undefined : s;
}

/** Pure: the chip that closes an agent the cockpit counts as done (`done`: donesuggest.ts doneSuggestion, which the
 *  header's ✓ Close and the sidebar row's read too, so the three come and go together), or none. An action, as a
 *  `done` chip is: a click closes the agent the way the header's ✓ does, and sends nothing. */
export function closeChip(done: boolean, vi: boolean): ChatChip | undefined {
    return done ? { text: vi ? "đóng agent" : "close agent", kind: "close", source: "rule" } : undefined;
}

/** Pure: the row's chips. A question's are the model's answers (with "ok" only once the call failed or found none); any
 *  other turn's are the rules' chips, then the model's next step when it is not one of them, and last the close chip
 *  (closeChip), which keeps its place in a full row: the model's step gives way to it. */
export function chatChips(i: {
    question: boolean;
    rules: ChatChip[];
    model: ModelSuggest | undefined;
    close?: ChatChip;
}): ChatChip[] {
    const replies = i.model?.status === "done" ? i.model.replies : [];
    const fromModel = replies.map((text): ChatChip => ({ text, kind: "reply", source: "model" }));
    if (i.question) {
        if (fromModel.length > 0) {
            return fromModel.slice(0, MAX_CHIPS);
        }
        const settled = i.model?.status === "failed" || i.model?.status === "done";
        return settled ? [{ text: "ok", kind: "reply", source: "fallback" }] : [];
    }
    const out = [...i.rules];
    const shown = new Set(out.map((c) => c.text.toLowerCase()));
    for (const c of fromModel) {
        if (!shown.has(c.text.toLowerCase())) {
            out.push(c);
            shown.add(c.text.toLowerCase());
        }
    }
    return i.close == null ? out.slice(0, MAX_CHIPS) : [...out.slice(0, MAX_CHIPS - 1), i.close];
}

/** Pure: the key one turn's model answer is kept under: the agent and its reply, so a new turn asks again and the same
 *  turn seen twice does not. */
export function suggestKey(agentId: string, reply: string): string {
    let h = 5381;
    for (let i = 0; i < reply.length; i++) {
        h = ((h << 5) + h + reply.charCodeAt(i)) | 0;
    }
    return `${agentId}:${reply.length}:${(h >>> 0).toString(36)}`;
}

/** What the box's chip line shows: the running agent's actions, the finished turn's suggested replies, or nothing. */
export type ChipRowKind = "actions" | "suggest" | "none";

/** how long the agent must keep working before its actions take the line */
export const ROW_ENTER_ACTIONS_MS = 1000;
/** how long the agent must keep still before its actions leave the line */
export const ROW_LEAVE_ACTIONS_MS = 500;

/** Pure: how long the line waits before it changes from what it shows to what the agent's state now asks for; 0 changes
 *  it at once. Only a change to or from the actions waits: those follow the agent's state, which can flip and come back
 *  inside a second (a turn the usage limit ends as it starts, a blip between two hook events), and each flip swapped
 *  the line and sprang the box's height under the eye. Replies coming or going follow the person (writing, sending)
 *  and change at once. */
export function rowHold(shown: ChipRowKind, target: ChipRowKind): number {
    if (shown === target) {
        return 0;
    }
    if (target === "actions") {
        return ROW_ENTER_ACTIONS_MS;
    }
    if (shown === "actions") {
        return ROW_LEAVE_ACTIONS_MS;
    }
    return 0;
}

/** the verbs of the tools whose call changes a file (transcriptprojection.ts verbFor) */
const EDIT_VERBS = new Set(["edited", "wrote", "multiedit", "notebookedit"]);

/** how long a command runs before its terminal is worth a look: its live output is there, not in Chat */
export const TERMINAL_AFTER_MS = 10_000;

/** Which of a running agent's two actions have something to show, and when the terminal will if a command still short
 *  of TERMINAL_AFTER_MS keeps running (null when none runs). */
export interface RunningActions {
    diff: boolean;
    terminal: boolean;
    terminalAt: number | null;
}

/** Pure: the running agent's actions worth a chip, from its transcript since the person's last message: Show the diff
 *  once the turn has edited a file (an edit that failed or was refused changed nothing), Open the terminal while a
 *  command has run TERMINAL_AFTER_MS or more. A turn that only reads and searches offers neither: the header's Terminal
 *  and the rail's Diff are there all the time. */
export function runningActions(entries: readonly AgentEntry[], now: number): RunningActions {
    let diff = false;
    let terminal = false;
    let terminalAt: number | null = null;
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "user") {
            break;
        }
        if (e.kind !== "action") {
            continue;
        }
        if (EDIT_VERBS.has(e.verb) && e.outcome !== "fail" && e.outcome !== "blocked") {
            diff = true;
        }
        if (e.verb === "ran" && e.outcome == null && e.startedAt != null) {
            const due = e.startedAt + TERMINAL_AFTER_MS;
            if (now >= due) {
                terminal = true;
            } else {
                terminalAt = terminalAt == null ? due : Math.min(terminalAt, due);
            }
        }
    }
    return { diff, terminal, terminalAt: terminal ? null : terminalAt };
}

/** Pure: the chips the row draws: a `done` chip needs a way to tick its chunk (`canMarkDone`), and a `close` chip a
 *  way to close the agent (`canClose`), or it is left out. Tab walks these, so the picked chip is always one on screen. */
export function drawnChips(chips: readonly ChatChip[], canMarkDone: boolean, canClose = false): ChatChip[] {
    return chips.filter(
        (c) => !(c.kind === "done" && c.chunk != null && !canMarkDone) && !(c.kind === "close" && !canClose)
    );
}

/** Pure: the chip Tab picks next (Shift+Tab: the one before), by its text, wrapping round; none picked starts at the
 *  first (Shift+Tab: the last). A picked text no longer in the row counts as none picked. No chips, none. */
export function stepPick(chips: readonly ChatChip[], picked: string | null, back: boolean): string | null {
    const n = chips.length;
    if (n === 0) {
        return null;
    }
    const at = picked == null ? -1 : chips.findIndex((c) => c.text === picked);
    const next = at < 0 ? (back ? n - 1 : 0) : (at + (back ? -1 : 1) + n) % n;
    return chips[next].text;
}

/** Pure: the chip Cmd+Enter (Ctrl+Enter off a Mac) takes at once: the row's first, over an empty box only. With text
 *  in the box the key stays the box's own send. */
export function quickChip(chips: readonly ChatChip[], boxText: string): ChatChip | null {
    return chips.length > 0 && boxText.trim() === "" ? chips[0] : null;
}

/** Pure: the picked chip, or null when the text is no longer one of the row's (the row changed under it). */
export function pickedChip(chips: readonly ChatChip[], picked: string | null): ChatChip | null {
    return picked == null ? null : (chips.find((c) => c.text === picked) ?? null);
}

/** Pure: what a click, or Enter on the picked chip, does with suggested reply `t`: over an empty box, or one already
 *  holding `t`, it sends; over text the person typed the first one arms the chip (it asks on itself, by the box, rather
 *  than in a toast across the screen), and the armed chip taken again sends, dropping the typed text. */
export function suggestTake(typed: string, armed: string | null, t: string): "send" | "arm" {
    return typed.trim() === "" || typed === t || armed === t ? "send" : "arm";
}

/** Pure: whether Shift+Enter can put the chip's text in the box to edit before sending: true for a chip whose Enter
 *  sends its text as typed (a reply, commit, push, or a `next` chip with nothing to start its chunk: `canGoOn` false).
 *  A `done` chip sends nothing and a `next` chip that starts its chunk does more than send, so neither has text to edit. */
export function chipEditable(chip: ChatChip, canGoOn: boolean): boolean {
    if (chip.kind === "close") {
        return false;
    }
    if (chip.chunk == null) {
        return true;
    }
    return !(chip.kind === "done" || (chip.kind === "next" && canGoOn));
}

/** Pure: the box's text once Shift+Enter puts suggestion `t` in to edit: `t` alone over an
 *  empty box, else after what is typed, one space between them unless the typed text already ends in a space or a
 *  line. Enter is the one that replaces the typed text (suggestTake); this keeps it. */
export function withChipText(typed: string, t: string): string {
    if (typed.trim() === "") {
        return t;
    }
    return /\s$/.test(typed) ? typed + t : typed + " " + t;
}

/** Pure: the empty box's line while a chip is picked: what Enter does with it, Shift+Enter when the chip's text can be
 *  edited first (chipEditable), then the keys that move on or let go. */
export function pickedHint(chip: ChatChip, editable = false): HintPart[] {
    const does =
        chip.kind === "close"
            ? " closes this agent"
            : chip.kind === "done" && chip.chunk != null
              ? ` marks “${chip.chunk}” done`
              : ` sends “${chip.text}”`;
    const edit: HintPart[] = editable ? [{ key: "Shift+Enter" }, " edits first · "] : [];
    return [{ key: "Enter" }, does + " · ", ...edit, { key: "Tab" }, " next · ", { key: "Esc" }, " back to typing"];
}
