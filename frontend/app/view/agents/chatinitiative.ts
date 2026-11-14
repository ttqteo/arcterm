// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Add to an initiative from Chat, the pure model (docs/superpowers/specs/2026-11-12-chat-add-to-initiative-design.md and
// its plan): the ```arc-initiative block an agent writes, the card's draft and its default target, the card's phases, the
// folded rows, the result line that tells the agent the outcome and its stripping from the person's bubble, and the pure
// halves of the maps chatinitiativestore.ts keeps in localStorage. No React, no jotai, no RPC: the store does the I/O, the
// card (chatinitiativecard.tsx) draws.

import { unwrapWholePaste } from "./chattagblocks";
import { hashText } from "./texthash";

export const INITIATIVE_LANG = "arc-initiative";

export type InitiativeKind = "chunk" | "note" | "initiative";

const KINDS: readonly InitiativeKind[] = ["chunk", "note", "initiative"];

/** The block as the agent wrote it, kept to the fields this model knows. */
export type InitiativeBlock = {
    kind: InitiativeKind;
    /** an initiative, as a bare oid or `effort:<oid>` */
    effort?: string;
    /** a chunk's label */
    chunk?: string;
    text: string;
    title?: string;
    /** a new initiative's first chunks */
    chunks?: string[];
    /** a new initiative's topic, as a bare oid or `effort:<oid>` */
    parent?: string;
};

// a trimmed string, or undefined for anything else (a non-string, a blank)
function str(v: unknown): string | undefined {
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Pure: the one JSON object of an ```arc-initiative block. Null for broken JSON, a non-object, an unknown kind or a
 *  missing or blank `text` (the block then stays a code block); a field it does not know is dropped. */
export function parseInitiativeBlock(raw: string): InitiativeBlock | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }
    const o = parsed as Record<string, unknown>;
    const kind = KINDS.find((k) => k === o.kind);
    const text = str(o.text);
    if (kind == null || text == null) {
        return null;
    }
    const block: InitiativeBlock = { kind, text };
    const effort = str(o.effort);
    if (effort != null) {
        block.effort = effort;
    }
    const chunk = str(o.chunk);
    if (chunk != null) {
        block.chunk = chunk;
    }
    const title = str(o.title);
    if (title != null) {
        block.title = title;
    }
    const parent = str(o.parent);
    if (parent != null) {
        block.parent = parent;
    }
    if (Array.isArray(o.chunks)) {
        const chunks = o.chunks.map(str).filter((c): c is string => c != null);
        if (chunks.length > 0) {
            block.chunks = chunks;
        }
    }
    return block;
}

// an ```arc-initiative fence at the start of a line (the same shape chatskim.ts looks for an arc-visual one)
const INITIATIVE_FENCE = new RegExp(`^\\s*\`\`\`${INITIATIVE_LANG}(?![\\w-])`, "m");

/** Pure: whether a reply holds an arc-initiative fence. */
export function hasInitiativeBlock(text: string): boolean {
    return INITIATIVE_FENCE.test(text);
}

/** Pure: the key a block's handled record is kept under: a hash of its content alone, the parsed object re-serialised with
 *  sorted keys. Not its position: a position does not survive a fork or a Chat window that loads earlier entries, content
 *  does, so a fork sees its copied cards as handled. */
export function blockKey(block: InitiativeBlock): string {
    const sorted = Object.fromEntries(
        Object.entries(block)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    );
    return hashText(JSON.stringify(sorted));
}

/** Pure: `effort:<oid>` from a bare oid (`AgentVM.effortId`) or an oref (`EffortSummary.oref`); "" for a blank one. */
export function effortOref(idOrRef: string): string {
    const oid = idOrRef
        .trim()
        .replace(/^effort:/, "")
        .trim();
    return oid === "" ? "" : `effort:${oid}`;
}

// ---- labels and clips ----

/** wavesrv's limit on a chunk's label, as the council sheet clips to it (councilsheetmodel.ts chunkLabelFor). */
export const MAX_CHUNK_LABEL = 200;

// the Create path counts a title's and a seed label's bytes (`len` in wshserver_effort.go), not its characters
const MAX_CREATE_BYTES = 200;

// the text a fold row keeps: a row shows one line, CSS clips it, the record need not hold a whole message
const MAX_ROW_TEXT = 300;

// a title made from a text: its first line
const MAX_TITLE_FROM_TEXT = 120;

const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
    const f = flat(text);
    return f.length <= max ? f : `${f.slice(0, max - 1).trimEnd()}…`;
}

/** Pure: a chunk's label from a text, clipped as chunkLabelFor does: whitespace folded to single spaces, at most 200
 *  characters, a cut one ending in an ellipsis. */
export function clipLabel(text: string): string {
    return clip(text, MAX_CHUNK_LABEL);
}

const utf8 = new TextEncoder();

/** Pure: a text of at most `max` UTF-8 bytes (a cut one ends in an ellipsis), for what EffortCreate counts in bytes. */
export function fitBytes(text: string, max: number): string {
    const f = flat(text);
    if (utf8.encode(f).length <= max) {
        return f;
    }
    let out = "";
    for (const ch of f) {
        if (utf8.encode(out + ch + "…").length > max) {
            break;
        }
        out += ch;
    }
    return `${out.trimEnd()}…`;
}

// the first line of a text, as the title of an initiative made from it
function titleFromText(text: string): string {
    const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
    return clip(first, MAX_TITLE_FROM_TEXT);
}

/** Pure: a new initiative's first chunks from the editor's textarea: one per line, blank lines dropped, each fit to a
 *  create's limit, a repeat dropped (wavesrv refuses a duplicate label). */
export function chunkLinesOf(chunks: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of chunks.split("\n")) {
        const label = fitBytes(line, MAX_CREATE_BYTES);
        if (label !== "" && !seen.has(label)) {
            seen.add(label);
            out.push(label);
        }
    }
    return out;
}

// ---- the draft ----

/** What the card holds while it waits: the person edits it, and it persists with the card. `chunks` is a new initiative's
 *  first chunks, one per line. A target is null until one is found or picked. */
export type InitiativeDraft = {
    kind: InitiativeKind;
    text: string;
    title: string;
    chunks: string;
    effort: string | null;
    chunk: string | null;
    parent: string | null;
};

/** What the default target is looked up in. `efforts` is the initiative list (empty until it loads, and a target not in it
 *  is left empty); `chunksOf` gives an initiative's chunk labels when they are known. */
export type InitiativeCtx = {
    agentEffortId?: string;
    agentChunk?: string | null;
    efforts: Pick<EffortSummary, "oref" | "parentoid">[];
    chunksOf?: (oref: string) => string[] | undefined;
};

// The default target (spec §8): the block's own, else the agent's. A target that is not in the list, or a chunk not among
// the initiative's chunks (when they are known), is left null, so the card opens with that row empty and Change… ready. The
// agent's chunk belongs to the agent's initiative only, and its initiative's topic is where a new initiative goes by default.
function targetOf(
    ctx: InitiativeCtx,
    want: { effort?: string; chunk?: string; parent?: string }
): Pick<InitiativeDraft, "effort" | "chunk" | "parent"> {
    const agent = ctx.agentEffortId != null ? effortOref(ctx.agentEffortId) : "";
    const known = (oref: string): boolean => oref !== "" && ctx.efforts.some((e) => effortOref(e.oref) === oref);
    const wantEffort = want.effort != null ? effortOref(want.effort) : agent;
    const effort = known(wantEffort) ? wantEffort : null;
    let chunk: string | null = null;
    if (effort != null) {
        const wantChunk = (want.chunk ?? (effort === agent ? (ctx.agentChunk ?? undefined) : undefined))?.trim();
        if (wantChunk) {
            const labels = ctx.chunksOf?.(effort);
            chunk = labels == null || labels.includes(wantChunk) ? wantChunk : null;
        }
    }
    const agentParent = ctx.efforts.find((e) => effortOref(e.oref) === agent)?.parentoid;
    const wantParent = want.parent != null ? effortOref(want.parent) : agentParent ? effortOref(agentParent) : "";
    return { effort, chunk, parent: known(wantParent) ? wantParent : null };
}

/** Pure: the card's first draft from a block the agent proposed. Every field is filled whatever the kind, so switching the
 *  kind in the editor keeps what was there; a chunk's text is clipped to a label, as the editor will show it. */
export function draftFromBlock(block: InitiativeBlock, ctx: InitiativeCtx): InitiativeDraft {
    return {
        kind: block.kind,
        text: block.kind === "chunk" ? clipLabel(block.text) : block.text,
        title: block.title ?? (block.kind === "initiative" ? titleFromText(block.text) : ""),
        chunks: (block.chunks ?? []).join("\n"),
        ...targetOf(ctx, block),
    };
}

/** Pure: the card's first draft from a message the person picked Add to initiative… on: a note with the whole text, into
 *  the agent's initiative and the chunk it holds. */
export function draftFromMessage(text: string, ctx: InitiativeCtx): InitiativeDraft {
    return { kind: "note", text, title: "", chunks: "", ...targetOf(ctx, {}) };
}

/** Pure: the draft with another kind. A chunk's text is clipped to a label (spec §8), a new initiative with no title takes
 *  its first line; nothing else changes, so switching back and forth loses only the clip. */
export function withKind(draft: InitiativeDraft, kind: InitiativeKind): InitiativeDraft {
    if (kind === draft.kind) {
        return draft;
    }
    const next = { ...draft, kind };
    if (kind === "chunk") {
        next.text = clipLabel(draft.text);
    }
    if (kind === "initiative" && draft.title.trim() === "") {
        next.title = titleFromText(draft.text);
    }
    return next;
}

/** Pure: whether Add can run: a note needs an initiative, a chunk and text; a chunk an initiative and text; a new
 *  initiative a title. */
export function canAdd(draft: InitiativeDraft): boolean {
    switch (draft.kind) {
        case "note":
            return draft.effort != null && draft.chunk != null && draft.text.trim() !== "";
        case "chunk":
            return draft.effort != null && draft.text.trim() !== "";
        case "initiative":
            return draft.title.trim() !== "";
    }
}

/** Pure: what a disabled Add waits on, in a few words for its tooltip; null once `canAdd`. */
export function addBlocker(draft: InitiativeDraft): string | null {
    if (draft.kind === "initiative") {
        return draft.title.trim() === "" ? "Give it a title first" : null;
    }
    if (draft.effort == null) {
        return "Pick an initiative first";
    }
    if (draft.kind === "note" && draft.chunk == null) {
        return "Pick a chunk first";
    }
    return draft.text.trim() === "" ? `Write the ${draft.kind} first` : null;
}

/** The button that adds, by kind. */
export function verbOf(kind: InitiativeKind): string {
    return kind === "note" ? "Add note" : kind === "chunk" ? "Add chunk" : "Create initiative";
}

/** The kind switch's label, by kind. */
export function kindLabel(kind: InitiativeKind): string {
    return kind === "note" ? "Note" : kind === "chunk" ? "New chunk" : "New initiative";
}

// ---- what the card view decides ----

/** Where a card came from: the agent proposed it with a block, or the person opened it from a message. */
export type CardOrigin = "agent" | "message";

/** Pure: whether a card opens in its editor: one from a message always does; one the agent proposed does once the person
 *  edited its body (kind, text, title or first chunks), so a switch to Terminal and back, or a reload, keeps the editor
 *  they were in. A changed target (initiative, chunk, topic) alone is no edit: the compact card has those controls too. */
export function startsInEditor(origin: CardOrigin, draft: InitiativeDraft, initial: InitiativeDraft): boolean {
    return (
        origin === "message" ||
        draft.kind !== initial.kind ||
        draft.text !== initial.text ||
        draft.title !== initial.title ||
        draft.chunks !== initial.chunks
    );
}

// openMessageCard's id: "m", Date.now() in base 36, four random characters
const MESSAGE_CARD_ID = /^m([0-9a-z]+)[0-9a-z]{4}$/;

/** Pure: whether a message card was opened a moment ago (its id carries the time), so its editor takes focus: the person
 *  just asked for it. One a reload or a switch back to Chat brings back must not take focus from the box. */
export function isFreshMessageCard(id: string, now: number, windowMs = 2000): boolean {
    const m = MESSAGE_CARD_ID.exec(id);
    if (m == null) {
        return false;
    }
    const age = now - parseInt(m[1], 36);
    return age >= 0 && age <= windowMs;
}

/** Pure: the draft aimed at another initiative (`Change…`). The agent's own initiative keeps the chunk the agent holds; any
 *  other asks for a chunk, so a note is never filed on a chunk that initiative may not have. */
export function withEffort(
    draft: InitiativeDraft,
    oref: string,
    agent: Pick<InitiativeCtx, "agentEffortId" | "agentChunk">
): InitiativeDraft {
    const effort = effortOref(oref);
    const own = agent.agentEffortId != null && effortOref(agent.agentEffortId) === effort;
    return { ...draft, effort, chunk: own ? (agent.agentChunk ?? null) : null };
}

/** Pure: the draft with another topic for a new initiative, or none (null). */
export function withTopic(draft: InitiativeDraft, oref: string | null): InitiativeDraft {
    return { ...draft, parent: oref == null ? null : effortOref(oref) };
}

/** One row of the `Chunk` dropdown: its place in the initiative (from 1), its label, and whether it is the chunk the agent
 *  holds (marked `· this agent's`). */
export type ChunkOption = { n: number; label: string; mine: boolean };

/** Pure: the dropdown's rows from an initiative's chunk labels, in plan order. */
export function chunkOptions(labels: readonly string[], mine: string | null): ChunkOption[] {
    return labels.map((label, i) => ({ n: i + 1, label, mine: mine != null && label === mine }));
}

/** Pure: the initiative chip's count, as the picker words it: done over done plus remaining. */
export function chipProgress(card: { done: number; remaining: number }): string {
    return `${card.done}/${card.done + card.remaining}`;
}

// ---- the card's phases ----

export type CardPhase = "waiting" | "editing" | "adding" | "failed" | "added" | "dismissed";
export type CardEvent = "edit" | "add" | "added" | "failed" | "retry" | "dismiss" | "cancel";

// from a phase, the phase each event leads to; an event not listed leaves the phase as it was
const TRANSITIONS: Record<CardPhase, Partial<Record<CardEvent, CardPhase>>> = {
    waiting: { edit: "editing", add: "adding", dismiss: "dismissed" },
    editing: { add: "adding", cancel: "waiting", dismiss: "dismissed" },
    adding: { added: "added", failed: "failed" },
    failed: { retry: "adding", add: "adding", edit: "editing", cancel: "waiting", dismiss: "dismissed" },
    added: {},
    dismissed: {},
};

/** Pure: the card's phase after an event. `cancel` closes the editor of a card an agent proposed (back to its compact
 *  form); a card the person opened from a message is removed by the view instead. Added and dismissed are the ends. */
export function cardPhase(prev: CardPhase, event: CardEvent): CardPhase {
    return TRANSITIONS[prev][event] ?? prev;
}

/** Pure: an exited agent's waiting card is static (no amber dot); its Add still works, since the write needs no agent. */
export function cardStatic(exited: boolean): boolean {
    return exited;
}

/** Pure: whether the card shows the amber "Waiting on you" dot: while it waits on the person (not while it adds, and not
 *  for an agent that has exited). */
export function waitingDot(phase: CardPhase, exited: boolean): boolean {
    return !cardStatic(exited) && (phase === "waiting" || phase === "editing" || phase === "failed");
}

// ---- the handled record, its row and its line ----

/** What a handled card keeps: the outcome and what the row and the line say. `initiative` is its title (the new one's for
 *  a created initiative); `effort` its oref (the new one's, or null when a dismissed card had none); `chunk` a note's chunk
 *  label; `chunkNumber` the chunk's place (1-based), a new chunk's included; `text` the note, the chunk's label or the
 *  block's text; `topic` the new initiative's topic title. */
export type HandledRecord = {
    outcome: "added" | "dismissed";
    kind: InitiativeKind;
    effort: string | null;
    initiative: string;
    chunk?: string;
    chunkNumber?: number;
    text: string;
    topic?: string;
    at: number;
};

/** Pure: the record of a card that was added. `done` is what the write learned: the initiative's title, its oref (the new
 *  one's for a created initiative), the chunk's number and the topic's title. */
export function addedRecord(
    draft: InitiativeDraft,
    done: { initiative: string; effort: string; chunkNumber?: number; topic?: string },
    at: number
): HandledRecord {
    const rec: HandledRecord = {
        outcome: "added",
        kind: draft.kind,
        effort: done.effort,
        initiative: done.initiative,
        text: draft.kind === "chunk" ? clipLabel(draft.text) : clip(draft.text, MAX_ROW_TEXT),
        at,
    };
    if (draft.kind === "note" && draft.chunk != null) {
        rec.chunk = draft.chunk;
    }
    if (done.chunkNumber != null && draft.kind !== "initiative") {
        rec.chunkNumber = done.chunkNumber;
    }
    if (draft.kind === "initiative" && done.topic != null && done.topic !== "") {
        rec.topic = done.topic;
    }
    return rec;
}

/** Pure: the record of a card that was dismissed. `names` is the titles the view knows: the initiative the card aimed at
 *  and the topic a new initiative was to go under. */
export function dismissedRecord(
    draft: InitiativeDraft,
    names: { initiative?: string; topic?: string },
    at: number
): HandledRecord {
    const isNew = draft.kind === "initiative";
    const rec: HandledRecord = {
        outcome: "dismissed",
        kind: draft.kind,
        effort: isNew ? null : draft.effort,
        initiative: isNew ? draft.title.trim() : (names.initiative ?? ""),
        text: draft.kind === "chunk" ? clipLabel(draft.text) : clip(draft.text, MAX_ROW_TEXT),
        at,
    };
    if (draft.kind === "note" && draft.chunk != null) {
        rec.chunk = draft.chunk;
    }
    if (isNew && names.topic != null && names.topic !== "") {
        rec.topic = names.topic;
    }
    return rec;
}

/** The three spans of a folded row: the lead (`Note added ·`), the subject (`<initiative> › 2`) and the tail (`— <text>`,
 *  absent when the row has no text). The view styles them apart, as the board does. */
export type FoldRowParts = { lead: string; subject: string; tail?: string };

/** Pure: a folded row's spans (decision 8, board fold-rows.dc.html): `Note added · <initiative> › <chunk number> — <text>`,
 *  `Chunk added · <initiative> › <new chunk's number> — <label>`, `Initiative created · “<title>” under <topic>`,
 *  `Dismissed · <note|chunk> for <initiative>`, `Dismissed · new initiative “<title>” under <topic>`; `under …` is left out
 *  with no topic. The ✓ and ✕ glyphs are the view's. */
export function foldRowParts(rec: HandledRecord): FoldRowParts {
    const initiative = flat(rec.initiative);
    const under = rec.topic != null && flat(rec.topic) !== "" ? ` under ${flat(rec.topic)}` : "";
    if (rec.outcome === "dismissed") {
        if (rec.kind === "initiative") {
            return { lead: "Dismissed ·", subject: `new initiative “${initiative}”${under}` };
        }
        return { lead: "Dismissed ·", subject: initiative === "" ? rec.kind : `${rec.kind} for ${initiative}` };
    }
    if (rec.kind === "initiative") {
        return { lead: "Initiative created ·", subject: `“${initiative}”${under}` };
    }
    const place = rec.chunkNumber != null ? String(rec.chunkNumber) : rec.kind === "note" ? flat(rec.chunk ?? "") : "";
    const subject = place === "" ? initiative : `${initiative} › ${place}`;
    const text = flat(rec.text);
    return {
        lead: rec.kind === "note" ? "Note added ·" : "Chunk added ·",
        subject,
        ...(text === "" ? {} : { tail: `— ${text}` }),
    };
}

/** Pure: a folded row as one line. */
export function foldRowLabel(rec: HandledRecord): string {
    const p = foldRowParts(rec);
    return [p.lead, p.subject, p.tail].filter((s): s is string => s != null).join(" ");
}

/** Pure: the one line that tells the agent what became of a card (decision 6). It names the initiative's oref so the agent
 *  can act on it with `wsh effort` without searching. */
export function resultLine(rec: HandledRecord): string {
    const title = flat(rec.initiative);
    const oref = rec.effort != null && rec.effort !== "" ? ` (${effortOref(rec.effort)})` : "";
    if (rec.outcome === "dismissed") {
        return `initiative: dismissed ${rec.kind}${title === "" ? "" : ` for ${title}`}`;
    }
    if (rec.kind === "initiative") {
        const topic = rec.topic != null && flat(rec.topic) !== "" ? ` under ${flat(rec.topic)}` : "";
        return `initiative: created initiative ${title}${oref}${topic}`;
    }
    if (rec.kind === "chunk") {
        return `initiative: added chunk "${flat(rec.text)}" to ${title}${oref}`;
    }
    const chunk = rec.chunk != null && flat(rec.chunk) !== "" ? ` › ${flat(rec.chunk)}` : "";
    return `initiative: added note to ${title}${oref}${chunk}`;
}

/** Pure: the message to send: the result lines first, one blank line, then the person's text. No lines leave it as it was. */
export function withResultLines(lines: readonly string[], message: string): string {
    return lines.length === 0 ? message : `${lines.join("\n")}\n\n${message}`;
}

const RESULT_LINE = /^initiative: (added|created|dismissed|switched) /;

/** Pure: the line that tells the agent the person moved it to another chunk (spec
 *  2026-11-14-chat-initiative-link-design.md §4): `initiative: switched you to chunk <n> <label> (effort:<oid>)`, `n` the
 *  chunk's place in the plan from 1. The oref is left out for an initiative with none. The skill (skills/initiatives)
 *  says how the agent reads it. */
export function switchLine(n: number, label: string, oref: string): string {
    const o = effortOref(oref);
    return `initiative: switched you to chunk ${n} ${flat(label)}${o === "" ? "" : ` (${o})`}`;
}

const SWITCH_PREFIX = "initiative: switched ";
const isSwitchLine = (line: string): boolean => line.startsWith(SWITCH_PREFIX);

// the label runs lazily up to the oref in parentheses at the end, so a label with parentheses of its own stays whole
const SWITCH_LINE = /^initiative: switched you to chunk (\d+) (.+?)(?: \(effort:[^()\s]*\))?$/;

/** Pure: the waiting line's chunk, read from the last switched line among an agent's pending lines; null when none. */
export function pendingSwitch(lines: readonly string[]): { n: number; label: string } | null {
    for (let i = lines.length - 1; i >= 0; i--) {
        if (!isSwitchLine(lines[i])) {
            continue;
        }
        const m = SWITCH_LINE.exec(lines[i]);
        if (m != null) {
            return { n: Number(m[1]), label: m[2] };
        }
    }
    return null;
}

/** Pure: the pending lines with a switched line for an agent, at the end, in place of any earlier one: several switches
 *  before a message send only the last. The agent's other lines stay, in order. */
export function withSwitchLine(pending: PendingMap, agentId: string, line: string): PendingMap {
    const kept = ownList(pending, agentId).filter((l) => !isSwitchLine(l));
    return queueLine({ ...pending, [agentId]: kept }, agentId, line);
}

/** Pure: the agents whose `go on with:` send is on its way, with `agentId` put in or taken out. The switch queues its
 *  line before the box has shown the chip's text and sent it, and the waiting line over the box stays hidden for these
 *  agents, so it never draws on that path (spec section 9). The same list when it is as asked. */
export function withSwitchHeld(held: readonly string[], agentId: string, on: boolean): readonly string[] {
    if (held.includes(agentId) === on) {
        return held;
    }
    return on ? [...held, agentId] : held.filter((id) => id !== agentId);
}

/** Pure: the pending lines without an agent's switched line (the waiting line's ✕), its other lines kept; the agent's
 *  entry goes once nothing else is in it. The same map when there is no switched line to drop. */
export function withoutSwitchLine(pending: PendingMap, agentId: string): PendingMap {
    const lines = ownList(pending, agentId);
    if (!lines.some(isSwitchLine)) {
        return pending;
    }
    const rest = lines.filter((l) => !isSwitchLine(l));
    const next = { ...pending };
    if (rest.length === 0) {
        delete next[agentId];
    } else {
        next[agentId] = rest;
    }
    return next;
}

/** Pure: a transcript message without the result lines Arc put in front of it: the leading run of lines that start
 *  `initiative: added|created|dismissed|switched ` and the one blank line after it, nothing else. Claude Code wraps a
 *  whole multi-line message as one pasted block, which is what a message carrying result lines is, so a wrapped message
 *  is read as the paste first; one with lines comes back unwrapped, one with none comes back exactly as it was. */
export function stripResultLines(text: string): string {
    const body = unwrapWholePaste(text);
    const lines = body.split("\n");
    let n = 0;
    while (n < lines.length && RESULT_LINE.test(lines[n].replace(/\r$/, ""))) {
        n++;
    }
    if (n === 0) {
        return text;
    }
    if (n < lines.length && lines[n].replace(/\r$/, "") === "") {
        n++;
    }
    return lines.slice(n).join("\n");
}

// ---- topics ----

const bareOid = (oref: string): string => oref.trim().replace(/^effort:/, "");

/** Pure: the initiatives that are topics, as `wsh effort list --topics` finds them (topicEfforts, wshcmd-effort.go): the
 *  ones another listed initiative's `parentoid` points at. In list order. */
export function topicsOf<T extends Pick<EffortSummary, "oref" | "parentoid">>(summaries: readonly T[]): T[] {
    const parents = new Set(summaries.map((s) => bareOid(s.parentoid ?? "")).filter((p) => p !== ""));
    return summaries.filter((s) => parents.has(bareOid(s.oref)));
}

// ---- the stored maps, their pure halves ----

/** A card the person opened from a message: where it sits (the key of the chat item it opened after), the message's text
 *  and, once handled, what became of it. Its draft, once edited, is in the drafts map under messageDraftKey(id). */
export type MessageCard = { id: string; anchor: string; text: string; outcome?: HandledRecord };

export type HandledMap = Record<string, HandledRecord>;
export type CardsMap = Record<string, MessageCard[]>;
export type DraftsMap = Record<string, InitiativeDraft>;
export type PendingMap = Record<string, string[]>;

// a drafts map key per card: a proposed block's, and a message card's
export const blockDraftKey = (key: string): string => `block:${key}`;
export const messageDraftKey = (id: string): string => `message:${id}`;

const MAX_HANDLED = 500;
const MAX_CARDS_PER_AGENT = 100;
const MAX_DRAFTS = 100;
const MAX_PENDING_LINES = 30;

const has = (map: object, key: string): boolean => Object.prototype.hasOwnProperty.call(map, key);

// an agent's own entry: its id of "constructor" must not read an Object.prototype member
function ownList<T>(map: Record<string, T[]>, key: string): T[] {
    return has(map, key) ? map[key] : [];
}

export type StoredMap<T> = { map: Record<string, T>; reason?: string };

/** Pure: a stored map read back from its localStorage string. Never throws: nothing stored, or broken or non-object JSON,
 *  gives an empty map (and a reason for the last two, for the caller to log). `coerce` reads one entry's value into its
 *  type, undefined dropping the entry; without it every value passes as it was. */
export function readStoredMap<T = unknown>(
    raw: string | null | undefined,
    coerce?: (v: unknown) => T | undefined
): StoredMap<T> {
    if (raw == null || raw === "") {
        return { map: {} };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { map: {}, reason: "not valid JSON" };
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { map: {}, reason: "not an object" };
    }
    const map: Record<string, T> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        // assigning map["__proto__"] would swap the map's prototype instead of adding an entry
        if (key === "__proto__") {
            continue;
        }
        const v = coerce == null ? (value as T) : coerce(value);
        if (v !== undefined) {
            map[key] = v;
        }
    }
    return { map };
}

const isObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const isKind = (v: unknown): v is InitiativeKind => KINDS.some((k) => k === v);
const optString = (v: unknown): boolean => v === undefined || typeof v === "string";
const optNumber = (v: unknown): boolean => v === undefined || (typeof v === "number" && Number.isFinite(v));
const nullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

/** Pure: a stored value as a handled record, or undefined when it is not one. */
export function coerceHandled(v: unknown): HandledRecord | undefined {
    if (
        !isObject(v) ||
        (v.outcome !== "added" && v.outcome !== "dismissed") ||
        !isKind(v.kind) ||
        !nullableString(v.effort) ||
        typeof v.initiative !== "string" ||
        typeof v.text !== "string" ||
        typeof v.at !== "number" ||
        !Number.isFinite(v.at) ||
        !optString(v.chunk) ||
        !optNumber(v.chunkNumber) ||
        !optString(v.topic)
    ) {
        return undefined;
    }
    return v as HandledRecord;
}

/** Pure: a stored value as a draft, or undefined when it is not one. */
export function coerceDraft(v: unknown): InitiativeDraft | undefined {
    if (
        !isObject(v) ||
        !isKind(v.kind) ||
        typeof v.text !== "string" ||
        typeof v.title !== "string" ||
        typeof v.chunks !== "string" ||
        !nullableString(v.effort) ||
        !nullableString(v.chunk) ||
        !nullableString(v.parent)
    ) {
        return undefined;
    }
    return v as InitiativeDraft;
}

/** Pure: a stored value as an agent's message cards: the ones that are cards kept, undefined when none is. */
export function coerceCards(v: unknown): MessageCard[] | undefined {
    if (!Array.isArray(v)) {
        return undefined;
    }
    const cards = v.filter(
        (c): c is MessageCard =>
            isObject(c) &&
            typeof c.id === "string" &&
            c.id !== "" &&
            typeof c.anchor === "string" &&
            typeof c.text === "string" &&
            (c.outcome === undefined || coerceHandled(c.outcome) !== undefined)
    );
    return cards.length > 0 ? cards.slice(-MAX_CARDS_PER_AGENT) : undefined;
}

/** Pure: a stored value as an agent's pending result lines: the strings kept, undefined when none is. */
export function coerceLines(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) {
        return undefined;
    }
    const lines = v.filter((l): l is string => typeof l === "string" && l !== "");
    return lines.length > 0 ? lines.slice(-MAX_PENDING_LINES) : undefined;
}

/** Pure: the pending lines with one more for an agent, at the end; at most 30 are kept, the oldest dropped. */
export function queueLine(pending: PendingMap, agentId: string, line: string): PendingMap {
    return { ...pending, [agentId]: [...ownList(pending, agentId), line].slice(-MAX_PENDING_LINES) };
}

/** Pure: an agent's pending lines, oldest first, and the map without them. */
export function takeLines(pending: PendingMap, agentId: string): { lines: string[]; next: PendingMap } {
    if (!has(pending, agentId)) {
        return { lines: [], next: pending };
    }
    const next = { ...pending };
    delete next[agentId];
    return { lines: pending[agentId], next };
}

/** Pure: lines a send did not use, back at the front of an agent's queue, before whatever came in meanwhile. */
export function putBackLines(pending: PendingMap, agentId: string, lines: readonly string[]): PendingMap {
    if (lines.length === 0) {
        return pending;
    }
    return { ...pending, [agentId]: [...lines, ...ownList(pending, agentId)].slice(-MAX_PENDING_LINES) };
}

/** Pure: the handled map with a record under a block's key; past 500 the oldest records go. */
export function withHandled(handled: HandledMap, key: string, rec: HandledRecord): HandledMap {
    const next = { ...handled, [key]: rec };
    const keys = Object.keys(next);
    if (keys.length <= MAX_HANDLED) {
        return next;
    }
    const keep = keys.sort((a, b) => next[b].at - next[a].at).slice(0, MAX_HANDLED);
    return Object.fromEntries(keep.map((k) => [k, next[k]]));
}

/** Pure: the cards map with one more card for an agent, at the end; at most 100 are kept per agent. */
export function withMessageCard(cards: CardsMap, agentId: string, card: MessageCard): CardsMap {
    return { ...cards, [agentId]: [...ownList(cards, agentId), card].slice(-MAX_CARDS_PER_AGENT) };
}

/** Pure: a message card settled. A record becomes its outcome; null removes the card (a Cancel: the agent never proposed
 *  it, so there is no row to leave). A card already settled, or one not found, leaves the map as it was. */
export function settleCard(cards: CardsMap, agentId: string, id: string, rec: HandledRecord | null): CardsMap {
    const list = ownList(cards, agentId);
    const card = list.find((c) => c.id === id);
    if (card == null || card.outcome != null) {
        return cards;
    }
    if (rec == null) {
        const rest = list.filter((c) => c.id !== id);
        const next = { ...cards };
        if (rest.length === 0) {
            delete next[agentId];
        } else {
            next[agentId] = rest;
        }
        return next;
    }
    return { ...cards, [agentId]: list.map((c) => (c.id === id ? { ...c, outcome: rec } : c)) };
}

/** Pure: the drafts map with a draft under a card's key, as the newest; past 100 the oldest go. */
export function withDraft(drafts: DraftsMap, key: string, draft: InitiativeDraft): DraftsMap {
    const next = { ...drafts };
    delete next[key];
    next[key] = draft;
    const keys = Object.keys(next);
    return keys.length <= MAX_DRAFTS ? next : Object.fromEntries(keys.slice(-MAX_DRAFTS).map((k) => [k, next[k]]));
}

/** Pure: a map without a key; the same map when it holds none. */
export function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
    if (!has(map, key)) {
        return map;
    }
    const next = { ...map };
    delete next[key];
    return next;
}
