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
//   works on: a turn that committed while it holds a chunk offers to tick that chunk done (an action, as the Initiative
//   tab's Mark done, not a message), and once its chunks are settled the next one is offered ("làm tiếp: …");
// - one haiku call (pkg/chatsuggest), a few seconds later, that reads the end of the reply: the answers to the question
//   it ends on, or the one next step only the reply shows ("vẽ tôi xem" after a layout told in words).
//
// A reply that ends in a question gets the model's answers alone: a rule's "commit đi" does not answer "A, B or C?", and
// while the answers are on their way the row stays empty rather than offer a bare "ok" the agent would have to read a
// choice into. Only a call that failed or found nothing leaves "ok" there. A yes-or-no question (yesNoQuestion) is the
// exception: its yes and no show at once, and the model's answers that say more join after them. The row is one line:
// it draws the chips that fit whole (fitChips), however many. Pure: chatsuggeststore.ts holds the
// model's answers and makes the call, chatpane.tsx wires the two.

import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import type { HintPart } from "./chatboxstate";
import { agentChunk } from "./initiativepopovermodel";
import { shipOffer, type ShipGit } from "./shipmodel";

export type ChipKind = "commit" | "push" | "reply" | "done" | "next" | "close";

/** One suggested reply: `text` is both what the chip says and what a click sends, except a `done` chip's, whose click
 *  ticks `chunk` done on the agent's initiative and sends nothing, and the judge's added chip, whose click sends `send`. */
export interface ChatChip {
    text: string;
    kind: ChipKind;
    /** `judge`: the option the deep judge added (chatjudge.ts judgedChips) */
    source: "rule" | "model" | "fallback" | "judge";
    /** a `done` or `next` chip's chunk, by its exact label */
    chunk?: string;
    /** the judge's pick of the row, light or deep: drawn with the scale, and first in the row (chatjudge.ts judgedChips) */
    judged?: boolean;
    /** what a click sends when it is not `text`: only the judge's added chip, which says what its label means */
    send?: string;
}

/** The part of an initiative the initiative rule reads. A workref's `ts` is when it was attached (ms). */
export interface ChipEffort {
    chunks?: { label: string; status: string; workrefs?: { kind: string; oref: string; ts?: number }[] }[];
}

/** What a chip is drawn with: its kind's icon, a reply that asks for a build ("build đi", "build it") the hammer, and
 *  the judge's pick the scale. */
export type ChipIcon = Exclude<ChipKind, "reply"> | "build" | "judge";

const BUILD_REPLY = /^\s*(re)?build\b/i;

/** Pure: the icon a chip is drawn with, or null for a plain reply. A build reply still sends as typed; the hammer only
 *  marks it, as commit's and push's icons mark theirs. The judge's pick has the scale, over the hammer. */
export function chipIcon(c: Pick<ChatChip, "kind" | "text" | "judged">): ChipIcon | null {
    if (c.kind !== "reply") {
        return c.kind;
    }
    if (c.judged === true) {
        return "judge";
    }
    return BUILD_REPLY.test(c.text) ? "build" : null;
}

/** The model's answer for one turn, as the store holds it. */
export type ModelSuggest = { status: "loading" } | { status: "done"; replies: string[] } | { status: "failed" };

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

// a question mark that ends a sentence inside a line, with the marks that may close it and the space after it
const QUESTION_IN_LINE = /([?？])[=*_`"'”’)\]]*[\s\p{Z}]+/gu;
// where a sentence ends in a question's tail, the tail's own end included
const TAIL_SENTENCE = /[.!。:](?:[\s\p{Z}]+|$)/gu;
// a tail that opens with an answer: the agent answered its own question ("Is it fixed? Yes, it is.")
const SELF_ANSWER = /^(yes|no|có|không|vâng|đúng)(?:[\s\p{P}]|$)/iu;
// the tail a question may have after it on its line and still close the reply (pkg/chatsuggest hook.go)
const QUESTION_TAIL_SENTENCES = 2;
const QUESTION_TAIL_CHARS = 200;

const endsInQuestionMark = (s: string) => s.endsWith("?") || s.endsWith("？");

/** Pure: the line ending at its question when a short tail follows the question ("Muốn tôi chạy không? Mất khoảng 5
 *  phút." gives "Muốn tôi chạy không?"), and the line as it is otherwise: one that ends on its question, has none, or
 *  whose tail is long, asks again, or answers the question itself. wavesrv cuts it the same way (pkg/chatsuggest
 *  hook.go cutToQuestion); the two must agree, or the mod's answer is set aside for the headless call. */
function cutToQuestion(line: string): string {
    if (endsInQuestionMark(line)) {
        return line;
    }
    const m = [...line.matchAll(QUESTION_IN_LINE)].at(-1);
    if (m == null) {
        return line;
    }
    const tail = line.slice(m.index + m[0].length).trim();
    if (
        tail === "" ||
        /[?？]/u.test(tail) ||
        [...tail].length > QUESTION_TAIL_CHARS ||
        SELF_ANSWER.test(tail) ||
        (tail.match(TAIL_SENTENCE) ?? []).length > QUESTION_TAIL_SENTENCES
    ) {
        return line;
    }
    return line.slice(0, m.index + m[1].length);
}

/** Pure: the reply's last line of prose with the emphasis and highlight marks closing it taken off, and cut back to its
 *  question when a short tail follows it (cutToQuestion); null when the reply has none. Fenced code (a card block
 *  written after the question) is not prose. */
function lastProseBare(reply: string): string | null {
    const prose = reply.replace(/```[\s\S]*?(```|$)/g, "");
    const line = prose
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "")
        .at(-1);
    return line == null ? null : cutToQuestion(line.replace(/[=*_`"'”’)\]\s]+$/u, ""));
}

/** Pure: the reply's last line of prose ends with a question mark, or with a question and a short tail after it
 *  (cutToQuestion). Fenced code (a card block written after the question) is not prose, and the emphasis and highlight
 *  marks around a sentence do not count. */
export function endsWithQuestion(reply: string): boolean {
    const bare = lastProseBare(reply);
    return bare != null && endsInQuestionMark(bare);
}

// the words that open a question asking yes or no ("Should I build it?", "Want me to commit?")
const YES_NO_OPENERS = new Set(
    "should shall do does did want would could can is are was were will may ready proceed ok okay sound sounds mind need go keep continue".split(
        " "
    )
);
// the words that close one ("…, ok?", "Có build luôn không?", "build nhé?")
const YES_NO_CLOSERS = new Set("ok okay right good fine không ko hông chứ nhé nhe nha nhỉ hả được".split(" "));
// a word that asks for something else than yes or no: what, which, how…, gì, nào, sao, đâu…; and the words that offer
// a choice between options ("A or B", "A hay B")
const NOT_YES_NO = new Set(
    "what which how why where when who whose whom or gì nào sao đâu mấy nhiêu hay hoặc chưa".split(" ")
);
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/** Pure: the reply ends on a question one taps yes or no to: its last sentence, a question, opens like one ("Should
 *  I…", "Want me to…") or closes like one ("…không?", "…nhé?", "…, ok?"), with no word that asks for something else
 *  (what, which, gì, nào…) or offers a choice (or, hay). Those get their yes and no chips at once (yesNoChips), not
 *  only once the model answers. */
export function yesNoQuestion(reply: string): boolean {
    if (!endsWithQuestion(reply)) {
        return false;
    }
    const words = lastSentenceWords(reply);
    if (words.length === 0 || words.some((w) => NOT_YES_NO.has(w))) {
        return false;
    }
    const lead = ["so", "then", "and", "also", "vậy", "thế"].includes(words[0]) ? words.slice(1) : words;
    return (lead.length > 0 && YES_NO_OPENERS.has(lead[0])) || YES_NO_CLOSERS.has(words[words.length - 1]);
}

/** Pure: the words of the reply's last sentence of prose, lower case, its closing marks and question mark left out. */
function lastSentenceWords(reply: string): string[] {
    const line = lastProseBare(reply);
    if (line == null) {
        return [];
    }
    // the last sentence: what follows the sentence before it, if the line holds two
    const bare = line.replace(/[?？]+$/u, "");
    const sentence = bare.split(/[.!?？。:]\s+/u).at(-1) ?? bare;
    return wordsOf(sentence);
}

function wordsOf(text: string): string[] {
    return text
        .normalize("NFC")
        .toLowerCase()
        .split(WORD_SPLIT)
        .filter((w) => w !== "");
}

/** Pure: the yes and the no a yes-or-no question gets at once, in the person's language. */
export function yesNoChips(vi: boolean): ChatChip[] {
    return [
        { text: vi ? "ok" : "yes", kind: "reply", source: "rule" },
        { text: vi ? "không" : "no", kind: "reply", source: "rule" },
    ];
}

// the words that make a reply a bare yes or no: a model answer of only these says what the yes and no chips say
const PLAIN_ANSWER = new Set(
    "ok oke okay okie yes yeah yep sure có ừ ừm được đc vâng uh không ko khỏi no nope đi nhé nha luôn thôi please pls làm go ahead it do cần đâu".split(
        " "
    )
);

/** Pure: a reply that is only a yes or a no ("ok làm đi", "không cần đâu"), which the yes and no chips already offer. */
export function plainAnswer(text: string): boolean {
    const ws = wordsOf(text);
    return ws.length > 0 && ws.every((w) => PLAIN_ANSWER.has(w));
}

// the words that turn a reply against part of what was asked ("đổi, không sync"): such a reply says more than yes
const NEGATION = new Set("không ko khỏi đừng chưa bỏ no not don't dont skip without".split(" "));

/** Pure: a reply to a yes-or-no question that only says the question's own action back ("Đổi luôn đi" to "…đổi luôn
 *  … không?"): every word of it is the question's or a plain yes word, and none says no to a part. It is a yes, which
 *  the yes chip already offers. */
export function restatesQuestion(text: string, reply: string): boolean {
    const asked = new Set(lastSentenceWords(reply));
    const ws = wordsOf(text);
    return ws.length > 0 && !ws.some((w) => NEGATION.has(w)) && ws.every((w) => asked.has(w) || PLAIN_ANSWER.has(w));
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
 *  The chunk it is on is the one the Initiative tab and the header chip read, by the one definition (initiativepopovermodel.ts
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

/** Pure: the chip that closes an agent the cockpit counts as done (`done`: donesuggest.ts doneSuggestion, which the
 *  header's ✓ Close and the sidebar row's read too, so the three come and go together), or none. An action, as a
 *  `done` chip is: a click closes the agent the way the header's ✓ does, and sends nothing. */
export function closeChip(done: boolean, vi: boolean): ChatChip | undefined {
    return done ? { text: vi ? "đóng agent" : "close agent", kind: "close", source: "rule" } : undefined;
}

/** Pure: the row's chips, all of them: the row draws those that fit on its one line (fitChips). A question's are the
 *  model's answers (with "ok" only once the call failed or found none); a yes-or-no question's (`yesNo`, yesNoChips) are
 *  its yes and no at once, then the model's answers that say more than yes or no (not a plain answer, not the question's
 *  action said back: restatesQuestion), after them so the chips already there
 *  do not move. Any other turn's are the rules' chips, then the model's next step when it is not one of them, and last
 *  the close chip (closeChip), which fitChips keeps in a full row. */
export function chatChips(i: {
    question: boolean;
    rules: ChatChip[];
    model: ModelSuggest | undefined;
    close?: ChatChip;
    yesNo?: ChatChip[];
    /** the agent's reply, which a yes-or-no question's answers are checked against (restatesQuestion) */
    reply?: string;
}): ChatChip[] {
    const replies = i.model?.status === "done" ? i.model.replies : [];
    const fromModel = replies.map((text): ChatChip => ({ text, kind: "reply", source: "model" }));
    if (i.question) {
        if (i.yesNo != null && i.yesNo.length > 0) {
            const shown = new Set(i.yesNo.map((c) => c.text.toLowerCase()));
            const saysMore = (c: ChatChip) =>
                !plainAnswer(c.text) &&
                !shown.has(c.text.toLowerCase()) &&
                !(i.reply != null && restatesQuestion(c.text, i.reply));
            return [...i.yesNo, ...fromModel.filter(saysMore)];
        }
        if (fromModel.length > 0) {
            return fromModel;
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
    return i.close == null ? out : [...out, i.close];
}

/** Pure: the waveapp.log line a chip the person takes leaves (`send` sends it or acts on it, `edit` puts its text in
 *  the box first), so which chips get used can be counted by where they came from (the model, a rule, or the "ok" the
 *  row adds itself when the model gave none), by place in the row, and by the kind of question the reply ended on.
 *  The reply's end rides along to judge a choice question by hand: whether the agent leaned to one side. */
export function chipPickLogLine(
    block: string | undefined,
    c: ChatChip,
    row: readonly ChatChip[],
    reply: string | null,
    how: "send" | "edit"
): string {
    const at = row.findIndex((r) => r.text === c.text && r.kind === c.kind) + 1;
    const question = reply != null && endsWithQuestion(reply);
    const shape = !question ? "none" : yesNoQuestion(reply) ? "yesno" : "open";
    const tail = (reply ?? "").replace(/\s+/g, " ").trim().slice(-120);
    return (
        `chatsuggest: block=${(block ?? "").slice(0, 8)} pick ${how} source=${c.source} kind=${c.kind} ` +
        `at=${at}/${row.length} question=${shape} text=${JSON.stringify(c.text)} tail=${JSON.stringify(tail)}`
    );
}

/** the gap between two chips in the row, px (gap-1.5) */
export const CHIP_GAP = 6;
/** the room the row keeps for the key a chip shows (Cmd+Enter's on the first, ↵ on the picked one), px */
export const CHIP_KEY_ROOM = 52;

/** Pure: the chips the row's one line holds, in order: from the first on, each whose whole width (`widths`, by text)
 *  still fits in `avail` after those before it, less `reserve`; one that does not is left out and a shorter one after
 *  it can still take the room. The first is always kept (alone too wide, it ends in …), and a close chip is kept over
 *  the replies before it, which give way from the last. A width not measured yet keeps every chip. */
export function fitChips(
    chips: readonly ChatChip[],
    widths: Readonly<Record<string, number>>,
    avail: number,
    reserve = CHIP_KEY_ROOM,
    gap = CHIP_GAP
): ChatChip[] {
    if (chips.length === 0 || avail <= 0 || chips.some((c) => widths[c.text] == null)) {
        return [...chips];
    }
    const room = avail - reserve;
    const width = (row: readonly ChatChip[]) => row.reduce((sum, c, n) => sum + widths[c.text] + (n > 0 ? gap : 0), 0);
    // the close chip's room is set aside first, and the replies share what is left
    const close = chips.find((c) => c.kind === "close");
    const tail = close == null ? [] : [close];
    const kept: ChatChip[] = [];
    for (const c of chips) {
        if (c !== close && (kept.length === 0 || width([...kept, c, ...tail]) <= room)) {
            kept.push(c);
        }
    }
    // the first is kept even when it and the close chip do not fit together: it is the one that ends in …
    return [...kept, ...tail];
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

// ---- the chips as the person types: the ones the typed text matches light, the rest fade, and the first one it starts
// shows its rest as ghost text in the box (chatcomposer.tsx), which → or Tab takes ----

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** A letter as the typed text is matched against a chip: no tone or other mark, đ as d, lower case ("Đóng" reads
 *  "dong"), so a person typing without marks still finds the chip. */
function foldChar(c: string): string {
    return c.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

/** The folded text, and for each of its letters the index in `s` it came from (a mark folds to nothing). */
function folded(s: string): { text: string; from: number[] } {
    let text = "";
    const from: number[] = [];
    let i = 0;
    for (const c of s) {
        const f = foldChar(c);
        text += f;
        for (let k = 0; k < f.length; k++) {
            from.push(i);
        }
        i += c.length;
    }
    return { text, from };
}

/** Where the typed text matches a chip: the chip's text from `start` to `end` (indices in it), and whether it is the
 *  chip's start (`prefix`) rather than the start of one of its later words. */
export interface ChipMatch {
    start: number;
    end: number;
    prefix: boolean;
}

/** Pure: where the typed text matches the chip's text: at its start, else at the start of one of its words, marks and
 *  case aside (foldChar). Leading spaces in the box are not part of it; an empty box, or text of more than one line,
 *  matches nothing. */
export function chipMatch(chipText: string, typed: string): ChipMatch | null {
    const t = typed.replace(/^\s+/, "");
    if (t.trim() === "" || t.includes("\n")) {
        return null;
    }
    const want = folded(t).text;
    const chip = folded(chipText);
    const end = (at: number) => (at + want.length >= chip.from.length ? chipText.length : chip.from[at + want.length]);
    if (chip.text.startsWith(want)) {
        return { start: 0, end: end(0), prefix: true };
    }
    for (let at = 1; at < chip.text.length; at++) {
        if (!WORD_CHAR.test(chip.text[at - 1]) && WORD_CHAR.test(chip.text[at]) && chip.text.startsWith(want, at)) {
            return { start: chip.from[at], end: end(at), prefix: false };
        }
    }
    return null;
}

/** Pure: the chips Tab walks: with text typed, the ones it matches (chipMatch); with none matched, or nothing typed,
 *  every chip, as before. */
export function tabWalk(chips: readonly ChatChip[], typed: string): ChatChip[] {
    const hit = chips.filter((c) => chipMatch(c.text, typed) != null);
    return hit.length > 0 ? hit : [...chips];
}

/** Pure: the ghost text the box shows after what is typed: the rest of the first chip in the row the typed text starts
 *  (chipMatch's prefix) whose text can go in the box (chipEditable: a close or done chip does more than send its words).
 *  `take` is what → or Tab puts in the box: the chip's whole text, so "dong" becomes "đóng agent", marks and all. Null
 *  when no chip is started or the typed text is the whole chip already. */
export function chipGhost(
    chips: readonly ChatChip[],
    typed: string,
    canGoOn: boolean
): { chip: ChatChip; rest: string; take: string } | null {
    for (const c of chips) {
        const m = chipMatch(c.text, typed);
        if (m == null || !m.prefix || !chipEditable(c, canGoOn) || m.end >= c.text.length) {
            continue;
        }
        return { chip: c, rest: c.text.slice(m.end), take: c.text };
    }
    return null;
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

/** Pure: the empty box's line while a chip is picked: what Enter does with it, then the judge's `reason` when the chip is
 *  its pick, Shift+Enter when the chip's text can be edited first (chipEditable), then the keys that move on or let go. */
export function pickedHint(chip: ChatChip, editable = false, reason?: string): HintPart[] {
    const does =
        chip.kind === "close"
            ? " closes this agent"
            : chip.kind === "done" && chip.chunk != null
              ? ` marks “${chip.chunk}” done`
              : ` sends “${chip.text}”`;
    const why = reason?.trim() ?? "";
    const edit: HintPart[] = editable ? [{ key: "Shift+Enter" }, " edits first · "] : [];
    return [
        { key: "Enter" },
        (why === "" ? does : `${does} — ${why}`) + " · ",
        ...edit,
        { key: "Tab" },
        " next · ",
        { key: "Esc" },
        " back to typing",
    ];
}
