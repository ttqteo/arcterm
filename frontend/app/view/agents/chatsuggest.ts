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
//   it ends on, or the one next step only the reply shows ("vẽ tôi xem" after a layout told in words).
//
// A reply that ends in a question gets the model's answers alone: a rule's "commit đi" does not answer "A, B or C?", and
// while the answers are on their way the row stays empty rather than offer a bare "ok" the agent would have to read a
// choice into. Only a call that failed or found nothing leaves "ok" there. Pure: chatsuggeststore.ts holds the
// model's answers and makes the call, chatpane.tsx wires the two.

import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import type { HintPart } from "./chatboxstate";
import { agentChunk } from "./initiativepopovermodel";
import { shipOffer, type ShipGit } from "./shipmodel";

export type ChipKind = "commit" | "push" | "reply" | "done" | "next";

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

/** The model's answer for one turn, as the store holds it. */
export type ModelSuggest = { status: "loading" } | { status: "done"; replies: string[] } | { status: "failed" };

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

/** Pure: whether Chat asks the model about this turn: the agent is back at its prompt, awake, with a reply to read and
 *  nothing else asking the person (its own question card, a brainstorm question, a message on its way), and the person
 *  has it in front of them, so an agent nobody looks at costs no call. */
export function wantsModelSuggest(i: {
    reply: string | null;
    idle: boolean;
    asleep: boolean;
    asking: boolean;
    questionWaits: boolean;
    pending: boolean;
    seen: boolean;
}): boolean {
    return i.reply != null && i.idle && !i.asleep && !i.asking && !i.questionWaits && !i.pending && i.seen;
}

/** Pure: the row's chips. A question's are the model's answers (with "ok" only once the call failed or found none); any
 *  other turn's are the rules' chips, then the model's next step when it is not one of them. */
export function chatChips(i: { question: boolean; rules: ChatChip[]; model: ModelSuggest | undefined }): ChatChip[] {
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
    return out.slice(0, MAX_CHIPS);
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

/** Pure: the chips the row draws: a `done` chip needs a way to tick its chunk (`canMarkDone`), or it is left out. Tab
 *  walks these, so the picked chip is always one on screen. */
export function drawnChips(chips: readonly ChatChip[], canMarkDone: boolean): ChatChip[] {
    return chips.filter((c) => !(c.kind === "done" && c.chunk != null && !canMarkDone));
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

/** Pure: the picked chip, or null when the text is no longer one of the row's (the row changed under it). */
export function pickedChip(chips: readonly ChatChip[], picked: string | null): ChatChip | null {
    return picked == null ? null : (chips.find((c) => c.text === picked) ?? null);
}

/** Pure: the empty box's line while a chip is picked: what Enter does with it, then the keys that move on or let go. */
export function pickedHint(chip: ChatChip): HintPart[] {
    const does = chip.kind === "done" && chip.chunk != null ? ` marks “${chip.chunk}” done` : ` sends “${chip.text}”`;
    return [{ key: "Enter" }, does + " · ", { key: "Tab" }, " next · ", { key: "Esc" }, " back to typing"];
}
