// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: everything the brainstorm pane, tree, popup, roster and approve flow derive from the agent's
// brainstorm.json. The agent writes the file; Arc only reads it and types one line back.

import type { NewRunPrefill } from "@/app/view/jarvis/newrun";
import type { AgentVM } from "./agentsviewmodel";
import { canvasDir, canvasProjectDir, join } from "./canvasmodel";

export const BRAINSTORM_POLL_MS = 3000;
export const BUILDER_PART = "builder";

const FILE_VERSION = 1;
const RUN_ID_CHARS = 8;
const PART_STATES = ["yours", "guess", "asked", "open"] as const;

export type PartState = (typeof PART_STATES)[number];
// a note is background the decisions stand on (recon, research, a trade-off write-up): nothing to confirm, so every
// count, gate and confirm leaves it out, whatever state it carries
export type BrainstormPart = {
    id: string;
    title: string;
    state: PartState;
    kind?: "note";
    from?: string;
    gist?: string;
    body: string;
    boards?: string[];
    // throwaway live pages, as paths under the canvas folder
    spikes?: string[];
    was?: string;
    why?: string;
};
// an answer the agent offers; pick marks the one it recommends, pros and cons are its reasons for and against
export type AnswerOption = { label: string; detail: string; pick?: boolean; pros?: string[]; cons?: string[] };
// what the agent lists for the judge on an approach question: facts only, no odds or pick
export type Approach = { name: string; description: string; facts: string[] };
// Arc's account of the judge's work: what it added and dropped, or why it failed and left the agent's options standing
export type JudgeRecord =
    | { kind: "weighed"; added: string[]; dropped: { name: string; reason: string }[] }
    | { kind: "failed"; reason: string };
// read is the one-line comparison of the options: the judge's on a weighed question, else the agent's. multi says
// the user may take more than one option together
export type BrainstormQuestion = {
    n: number;
    text: string;
    part: string;
    why?: string;
    read?: string;
    options?: AnswerOption[];
    multi?: true;
    approaches?: Approach[];
    judge?: JudgeRecord;
};
// picked is the option's index, or their indexes when the user took several, absent when the answer was typed in the
// user's own words. A superseded question was dropped after pushback, unanswered: part is the part it was asked for,
// which stays open
export type HistoryEntry = {
    kind: "question" | "recon";
    n?: number;
    q: string;
    // why the question was asked, kept so the rail can show it again
    why?: string;
    a: string;
    into: string[];
    options?: AnswerOption[];
    picked?: number | number[];
    part?: string;
    superseded?: true;
    judge?: JudgeRecord;
};
// a question the builder check left for the user. into is every decision its answer changed; label is the rail's
// short line for it, the full q when absent
export type BuilderQuestion = {
    q: string;
    label?: string;
    why?: string;
    a?: string;
    into?: string[];
    part?: string;
    options?: AnswerOption[];
};
export type BuilderCall = { text: string; part?: string };
export type BuilderCheck = { yours: BuilderQuestion[]; calls: BuilderCall[]; answered: string[]; touched?: string[] };
export type BrainstormFile = {
    v: 1;
    title: string;
    spec: string;
    canvas?: string;
    question: BrainstormQuestion | null;
    working: string | null;
    parts: BrainstormPart[];
    history: HistoryEntry[];
    done: boolean;
    check: BuilderCheck | null;
    run: string | null;
    compacted?: number;
};
export type ParseResult = { ok: true; file: BrainstormFile } | { ok: false; error: string };

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
    return v != null && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
    return typeof v === "string" ? v : undefined;
}

function strings(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function lines(v: unknown): string[] {
    return strings(v).filter((s) => s.trim() !== "");
}

// a path under the canvas folder, with / between its segments; anything that could leave the folder is dropped
function spikePaths(v: unknown): string[] {
    return strings(v)
        .map((s) =>
            s
                .trim()
                .replace(/\\/g, "/")
                .replace(/^(\.\/)+/, "")
        )
        .filter((s) => s !== "" && !s.startsWith("/") && !/^[a-z]:/i.test(s) && !s.split("/").includes(".."));
}

class FieldError extends Error {}

function parsePart(raw: unknown, i: number): BrainstormPart {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") {
        throw new FieldError(`parts[${i}] has no id`);
    }
    const id = raw.id;
    const note = raw.kind === "note";
    const known = PART_STATES.includes(raw.state as PartState);
    if (!note && !known) {
        throw new FieldError(`part "${id}" has an unknown state "${String(raw.state)}"`);
    }
    const boards = strings(raw.boards);
    const spikes = spikePaths(raw.spikes);
    return {
        id,
        title: str(raw.title) ?? id,
        state: known ? (raw.state as PartState) : "yours",
        ...(note ? { kind: "note" as const } : {}),
        body: str(raw.body) ?? "",
        ...(str(raw.from) != null ? { from: str(raw.from) } : {}),
        ...(str(raw.gist) ? { gist: str(raw.gist) } : {}),
        ...(boards.length > 0 ? { boards } : {}),
        ...(spikes.length > 0 ? { spikes } : {}),
        ...(str(raw.was) != null ? { was: str(raw.was) } : {}),
        ...(str(raw.why) != null ? { why: str(raw.why) } : {}),
    };
}

// an option with no label is dropped, not an error: the question still reads with the rest and the answer box
function parseOptions(raw: unknown): AnswerOption[] {
    return (Array.isArray(raw) ? raw : [])
        .filter((o): o is Rec => isRecord(o) && typeof o.label === "string" && o.label.trim() !== "")
        .map((o) => {
            const pros = lines(o.pros);
            const cons = lines(o.cons);
            return {
                label: o.label as string,
                detail: str(o.detail) ?? "",
                ...(o.pick === true ? { pick: true } : {}),
                ...(pros.length > 0 ? { pros } : {}),
                ...(cons.length > 0 ? { cons } : {}),
            };
        });
}

// an approach with no name is dropped, as the server leaves it out of the five it counts
function parseApproaches(raw: unknown): Approach[] {
    return (Array.isArray(raw) ? raw : [])
        .filter((a): a is Rec => isRecord(a) && typeof a.name === "string" && a.name.trim() !== "")
        .map((a) => ({ name: a.name as string, description: str(a.description) ?? "", facts: lines(a.facts) }));
}

// a judge of any other shape is no record, so the question draws as the agent wrote it. dropped may be absent: a
// judge that dropped nothing can leave it out
function parseJudge(raw: unknown): JudgeRecord | null {
    if (!isRecord(raw)) {
        return null;
    }
    if (typeof raw.failed === "string" && raw.failed.trim() !== "") {
        return { kind: "failed", reason: raw.failed };
    }
    if (!Array.isArray(raw.added) || (raw.dropped != null && !Array.isArray(raw.dropped))) {
        return null;
    }
    const dropped = (Array.isArray(raw.dropped) ? raw.dropped : [])
        .filter((d): d is Rec => isRecord(d) && typeof d.name === "string" && d.name.trim() !== "")
        .map((d) => ({ name: d.name as string, reason: str(d.reason) ?? "" }));
    return { kind: "weighed", added: lines(raw.added), dropped };
}

function parseQuestion(raw: unknown): BrainstormQuestion | null {
    if (raw == null) {
        return null;
    }
    if (!isRecord(raw) || typeof raw.n !== "number" || typeof raw.text !== "string") {
        throw new FieldError("question needs a numeric n and a text");
    }
    const options = parseOptions(raw.options);
    const approaches = parseApproaches(raw.approaches);
    const judge = parseJudge(raw.judge);
    return {
        n: raw.n,
        text: raw.text,
        part: str(raw.part) ?? "",
        ...(str(raw.why) ? { why: str(raw.why) } : {}),
        ...(str(raw.read) ? { read: str(raw.read) } : {}),
        ...(options.length > 0 ? { options } : {}),
        ...(raw.multi === true ? { multi: true as const } : {}),
        ...(approaches.length > 0 ? { approaches } : {}),
        ...(judge != null ? { judge } : {}),
    };
}

// an index past the options it names reads as an answer in the user's own words; a list keeps the indexes that name
// one, once each, and one left reads as a single pick
function parsePicked(raw: unknown, n: number): number | number[] | undefined {
    const ok = (i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < n;
    if (!Array.isArray(raw)) {
        return ok(raw) ? raw : undefined;
    }
    const list = [...new Set(raw.filter(ok))];
    return list.length === 0 ? undefined : list.length === 1 ? list[0] : list;
}

// the indexes of the options the user picked, none for an answer in their own words
export function pickedIndexes(h: Pick<HistoryEntry, "picked">): number[] {
    return h.picked == null ? [] : Array.isArray(h.picked) ? h.picked : [h.picked];
}

function parseHistory(raw: unknown): HistoryEntry[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter(isRecord).map((h) => {
        const options = parseOptions(h.options);
        const picked = parsePicked(h.picked, options.length);
        const recon = h.kind === "recon";
        const judge = parseJudge(h.judge);
        return {
            kind: recon ? "recon" : "question",
            ...(typeof h.n === "number" ? { n: h.n } : {}),
            q: str(h.q) ?? "",
            ...(str(h.why) ? { why: str(h.why) } : {}),
            a: str(h.a) ?? "",
            into: strings(h.into),
            ...(options.length > 0 ? { options } : {}),
            ...(picked != null ? { picked } : {}),
            ...(str(h.part) ? { part: str(h.part) } : {}),
            ...(!recon && h.superseded === true ? { superseded: true as const } : {}),
            ...(judge != null ? { judge } : {}),
        };
    });
}

function parseCheck(raw: unknown): BuilderCheck | null {
    if (raw == null) {
        return null;
    }
    if (!isRecord(raw)) {
        throw new FieldError("check must be an object");
    }
    const yours = (Array.isArray(raw.yours) ? raw.yours : []).filter(isRecord).map((y): BuilderQuestion => {
        // a file written before into became a list names its one part as a string
        const into = lines(typeof y.into === "string" ? [y.into] : y.into);
        const options = parseOptions(y.options);
        return {
            q: str(y.q) ?? "",
            ...(str(y.label) ? { label: str(y.label) } : {}),
            ...(str(y.why) != null ? { why: str(y.why) } : {}),
            ...(str(y.a) != null ? { a: str(y.a) } : {}),
            ...(into.length > 0 ? { into } : {}),
            ...(str(y.part) ? { part: str(y.part) } : {}),
            ...(options.length > 0 ? { options } : {}),
        };
    });
    const calls: BuilderCall[] = [];
    for (const c of Array.isArray(raw.calls) ? raw.calls : []) {
        if (typeof c === "string") {
            calls.push({ text: c });
        } else if (isRecord(c) && typeof c.text === "string") {
            calls.push({ text: c.text, ...(str(c.part) != null ? { part: str(c.part) } : {}) });
        }
    }
    return {
        yours,
        calls,
        answered: strings(raw.answered),
        ...(Array.isArray(raw.touched) ? { touched: strings(raw.touched) } : {}),
    };
}

function buildFile(j: Rec): BrainstormFile {
    if (j.v !== FILE_VERSION) {
        throw new FieldError(
            `unsupported brainstorm.json version ${String(j.v)}; this Arc reads version ${FILE_VERSION}`
        );
    }
    if (typeof j.title !== "string") {
        throw new FieldError("brainstorm.json has no title");
    }
    if (!Array.isArray(j.parts)) {
        throw new FieldError("brainstorm.json has no parts array");
    }
    const parts = j.parts.map(parsePart);
    const seen = new Set<string>();
    for (const p of parts) {
        if (seen.has(p.id)) {
            throw new FieldError(`duplicate part id "${p.id}"`);
        }
        seen.add(p.id);
    }
    return {
        v: FILE_VERSION,
        title: j.title,
        spec: str(j.spec) ?? "",
        ...(str(j.canvas) ? { canvas: str(j.canvas) } : {}),
        question: parseQuestion(j.question),
        working: str(j.working) ?? null,
        parts,
        history: parseHistory(j.history),
        done: j.done === true,
        check: parseCheck(j.check),
        run: str(j.run) ?? null,
        ...(typeof j.compacted === "number" ? { compacted: j.compacted } : {}),
    };
}

export function parseBrainstorm(text: string): ParseResult {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (e) {
        return { ok: false, error: `brainstorm.json is not valid JSON: ${(e as Error).message}` };
    }
    if (!isRecord(json)) {
        return { ok: false, error: "brainstorm.json is not a JSON object" };
    }
    try {
        return { ok: true, file: buildFile(json) };
    } catch (e) {
        if (e instanceof FieldError) {
            return { ok: false, error: e.message };
        }
        throw e;
    }
}

export function brainstormFilePath(cwd: string, topic: string): string {
    return join(cwd, ".superpowers", "brainstorm", topic, "brainstorm.json");
}

const BRAINSTORM_PATH = /^(.+?)[\\/]\.superpowers[\\/]brainstorm[\\/]([^\\/]+)[\\/]brainstorm\.json$/i;

export function parseBrainstormPath(path: string): { cwd: string; topic: string } | null {
    const m = BRAINSTORM_PATH.exec(path);
    return m ? { cwd: m[1], topic: m[2] } : null;
}

export function isNote(p: BrainstormPart): boolean {
    return p.kind === "note";
}

export function brainstormCounts(f: BrainstormFile): { yours: number; guesses: number; open: number } {
    const n = (...states: PartState[]) => decisionParts(f).filter((p) => states.includes(p.state)).length;
    return { yours: n("yours"), guesses: n("guess"), open: n("asked", "open") };
}

// a question still open (one about no part can come after done) waits for its answer first
export function canCheck(f: BrainstormFile): boolean {
    const parts = decisionParts(f);
    return f.done && f.question == null && parts.length > 0 && parts.every((p) => p.state === "yours");
}

// a line Arc sent, which the agent has not answered yet: modifiedMs is the file's when it was sent. An answer closes
// the question, a check hands the design to a builder (its send time outlives the line, sentCheckAt), any other line
// is a change
export type SentKind = "answer" | "check" | "line";
export type SentLine = { at: number; modifiedMs: number | null; kind: SentKind };

export function sentKind(a: BrainstormAction): SentKind {
    return a.kind === "answer" || a.kind === "check" ? a.kind : "line";
}

const PENDING_ANSWER = "Writing up your answer.";
const PENDING_CHECK = "A builder is reading the design.";
const PENDING_LINE = "Taking in your change.";

// the agent has taken a line delivered at `at` once its turn ends after it, or its file changed while it is not at
// work. A write mid-turn settles nothing: a line sent before that turn ends would join it, not start the next
function lineTaken(at: number, written: boolean, agent: Pick<AgentVM, "state" | "idleSince"> | undefined): boolean {
    const turnEnded = agent?.state === "idle" && agent.idleSince != null && agent.idleSince > at;
    return turnEnded || (written && agent?.state !== "working");
}

export function settleSent(
    sent: SentLine | null,
    modifiedMs: number | null,
    agent: Pick<AgentVM, "state" | "idleSince"> | undefined
): SentLine | null {
    if (sent == null) {
        return null;
    }
    return lineTaken(sent.at, modifiedMs !== sent.modifiedMs, agent) ? null : sent;
}

// Arc's record of the builder check, from the agent's tab meta (brainstorm:check*); only the server writes it
export type BuilderCheckRecord = {
    state: "reading" | "answered" | "failed" | "stopped";
    ts: number;
    runId?: string;
    reason?: string;
};

// a pending check is the builder reading, then the agent taking in the builder's questions
export type BuilderCheckView =
    | { kind: "none" }
    | { kind: "pending"; stage: "reading" | "taking-in"; text: string }
    | { kind: "failed"; reason: string };

const CHECK_TAKING_IN = "Taking in the builder's questions.";
const CHECK_NOT_STARTED = "The agent ended its turn without starting the builder check.";

// the send time of the last `brainstorm: check`, kept once the agent has taken it (settled), until a record newer
// than it says the check started
export function nextSentCheckAt(
    prev: number | null,
    sent: SentLine | null,
    settled: SentLine | null,
    record: BuilderCheckRecord | undefined
): number | null {
    const at = sent?.kind === "check" && settled == null ? sent.at : prev;
    return at != null && record != null && record.ts >= at ? null : at;
}

// the builder check as the pane shows it. Once the agent takes the delivered questions the record is inert and the
// file's check drives the view; a failure shows only while the file has no check
export function builderCheckView(
    record: BuilderCheckRecord | undefined,
    sentCheckAt: number | null,
    f: BrainstormFile | null,
    modifiedMs: number | null,
    agent: Pick<AgentVM, "state" | "idleSince"> | undefined
): BuilderCheckView {
    const unchecked = f?.check == null;
    if (sentCheckAt != null && (record == null || record.ts < sentCheckAt)) {
        return unchecked ? { kind: "failed", reason: CHECK_NOT_STARTED } : { kind: "none" };
    }
    if (record?.state === "reading") {
        return { kind: "pending", stage: "reading", text: PENDING_CHECK };
    }
    if (record?.state === "answered") {
        const taken = lineTaken(record.ts, modifiedMs != null && modifiedMs > record.ts, agent);
        return taken ? { kind: "none" } : { kind: "pending", stage: "taking-in", text: CHECK_TAKING_IN };
    }
    if (record?.state === "failed" && unchecked) {
        return { kind: "failed", reason: record.reason ?? "" };
    }
    return { kind: "none" };
}

// an answer typed in the terminal never passes through Arc: a turn that started after the file last asked is one,
// pending like a sent answer until that turn ends. A turn that wrote the question itself started before the write
export function terminalAnswer(
    f: BrainstormFile,
    modifiedMs: number | null,
    agent: Pick<AgentVM, "state"> | undefined,
    turnStartMs: number | undefined
): SentLine | null {
    if (f.question == null || agent?.state !== "working" || modifiedMs == null || turnStartMs == null) {
        return null;
    }
    return turnStartMs > modifiedMs ? { at: turnStartMs, modifiedMs, kind: "answer" } : null;
}

// the file as Arc shows it: the agent writes once per turn, so while a sent line is pending Arc says the agent is
// writing, as a `working` the file sets itself would
// A line sent during the judge's wait reads as it does with no `working` at all: the judge's own `working` would
// otherwise hide that Arc sent it.
export function shownFile(f: BrainstormFile, sent: SentLine | null): BrainstormFile {
    if (sent == null || (f.working != null && !judgeWait(f, false))) {
        return f;
    }
    if (sent.kind === "answer") {
        return { ...f, working: PENDING_ANSWER, question: null };
    }
    return { ...f, working: sent.kind === "check" ? PENDING_CHECK : PENDING_LINE };
}

// why a line is not sent, for the file as Arc shows it: a check while the agent is at work, one already underway
// included, would start a second builder
export function sendBlocker(a: BrainstormAction, shown: BrainstormFile | null): string | null {
    return a.kind === "check" && shown?.working != null
        ? "The agent is still working; check with a builder once it is done"
        : null;
}

export function isAsking(f: BrainstormFile): boolean {
    return f.question != null && f.working == null;
}

export function asksUser(f: BrainstormFile | null, agent: Pick<AgentVM, "state" | "atPrompt">): boolean {
    return f != null && isAsking(f) && (agent.state === "idle" || agent.atPrompt === true);
}

// the file knows a question the agent's own status does not: its turn ended on a prose question
export function withBrainstorm(agent: AgentVM, f: BrainstormFile | null, now: number): AgentVM {
    if (!asksUser(f, agent)) {
        return agent;
    }
    return {
        ...agent,
        state: "asking",
        activeMs: undefined,
        blockedMs: agent.idleSince != null ? Math.max(0, now - agent.idleSince) : agent.blockedMs,
    };
}

export type TreeLine = { text: string; runId?: string };

// runText is what Arc knows of the brainstorm's run
export function treeLine(f: BrainstormFile, asking: boolean, runText?: string): TreeLine {
    if (f.run != null) {
        return { text: runText ?? `run ${f.run.slice(0, RUN_ID_CHARS)}`, runId: f.run };
    }
    if (asking) {
        return { text: `asking question ${f.question?.n ?? ""}`.trim() };
    }
    if (f.check != null) {
        return { text: "builder check" };
    }
    if (judgeWait(f, false)) {
        return { text: `judge weighing question ${f.question!.n}` };
    }
    // only a closed question means the agent is writing up an answer; a kept one is a change being taken in
    if (f.working != null) {
        return { text: f.question == null ? "writing up your answer" : "working" };
    }
    return { text: "in progress" };
}

export type BrainstormAction =
    | { kind: "answer"; text: string }
    | { kind: "guess" }
    | { kind: "skip" }
    | { kind: "confirm"; part: string }
    | { kind: "confirm-all" }
    | { kind: "edit"; part: string; text: string }
    | { kind: "keep"; part: string }
    | { kind: "restore"; part: string }
    | { kind: "keep-all" }
    | { kind: "check" }
    | { kind: "builder-answer"; text: string }
    | { kind: "builder-decide" }
    | { kind: "approved" }
    | { kind: "keep-talking" }
    | { kind: "run"; runId: string };

// a typed line is one line: every run of whitespace, newlines included, becomes one space
function oneLine(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

export function brainstormLine(a: BrainstormAction): string | null {
    switch (a.kind) {
        case "answer":
            return oneLine(a.text) || null;
        case "edit": {
            const t = oneLine(a.text);
            return t ? `brainstorm: edit ${a.part}: ${t}` : null;
        }
        case "builder-answer": {
            const t = oneLine(a.text);
            return t ? `brainstorm: builder answer: ${t}` : null;
        }
        case "guess":
            return "brainstorm: guess";
        case "skip":
            return "brainstorm: skip questions";
        case "confirm":
            return `brainstorm: confirm ${a.part}`;
        case "confirm-all":
            return "brainstorm: confirm every guess";
        case "keep":
            return `brainstorm: keep ${a.part}`;
        case "restore":
            return `brainstorm: restore ${a.part}`;
        case "keep-all":
            return "brainstorm: keep every change";
        case "builder-decide":
            return "brainstorm: builder decide";
        case "check":
            return "brainstorm: check";
        case "approved":
            return "brainstorm: approved";
        case "keep-talking":
            return "brainstorm: keep talking";
        case "run":
            return `brainstorm: run ${a.runId}`;
    }
}

// a part id the file names but does not define shows as the raw id
export function partTitle(f: BrainstormFile, id: string): string {
    return f.parts.find((p) => p.id === id)?.title ?? id;
}

// a part's mockups draw once the brainstorm names its canvas and the canvas is served (base)
export function partBoards(f: BrainstormFile, p: BrainstormPart | undefined, base: string | null): string[] | null {
    return p?.boards != null && p.boards.length > 0 && f.canvas != null && base != null ? p.boards : null;
}

// a part's spikes, like its boards, open once the canvas is named and served
export function partSpikes(f: BrainstormFile, p: BrainstormPart | undefined, base: string | null): string[] | null {
    return p?.spikes != null && p.spikes.length > 0 && f.canvas != null && base != null ? p.spikes : null;
}

// whether a part has anything to open: a review row with nothing else under it still opens for this
export function hasMockups(f: BrainstormFile, p: BrainstormPart | undefined, base: string | null): boolean {
    return partBoards(f, p, base) != null || partSpikes(f, p, base) != null;
}

// a spike is served from the canvas folder itself, where boards are served from its project/ (boardUrl)
export function spikeUrl(base: string, canvas: string, path: string): string {
    return `${base}/${encodeURIComponent(canvas)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// the asked part's mockups, beside the answers, so a question between layouts shows them
export function questionBoards(f: BrainstormFile, base: string | null): string[] | null {
    const id = f.question?.part;
    const p = id ? f.parts.find((x) => x.id === id) : undefined;
    return partBoards(f, p, base);
}

export type HistoryRow = {
    // the entry's place in the history: entries only append, so a new one leaves the others' keys alone
    key: string;
    kind: "question" | "recon";
    // a question dropped after pushback: nothing was decided by it
    dropped: boolean;
    label: string;
    q: string;
    // every option the question offered, the picked one and the agent's recommendation marked
    options: { label: string; detail: string; picked: boolean; agentPick: boolean }[];
    // the judge weighed the question, so the marked recommendation is the judge's
    judged: boolean;
    why: string | null;
    // the reasoning toggle has something to show: why it was asked, or an option not picked that says what it is
    reasons: boolean;
    // the answer as said, drawn after the options; null when it was one of them
    answer: string | null;
    // the question offered options and the user answered in their own words instead
    ownWords: boolean;
    into: { id: string; title: string }[];
    // a recon entry added or changed since the user last saw the design
    unseen: boolean;
};

function historyRow(f: BrainstormFile, h: HistoryEntry, i: number, unseen: Unseen): HistoryRow {
    const picked = pickedIndexes(h);
    const options = (h.options ?? []).map((o, j) => ({
        label: o.label,
        detail: o.detail,
        picked: picked.includes(j),
        agentPick: o.pick === true,
    }));
    const recon = h.kind === "recon";
    const answer = h.picked != null ? null : (recon ? h.a || h.q : h.a) || null;
    const why = recon ? null : (h.why ?? null);
    return {
        key: `${h.kind}:${i}`,
        kind: h.kind,
        dropped: h.superseded === true,
        label: recon ? "Recon" : `Q${h.n ?? i + 1}`,
        q: h.q,
        options,
        judged: h.judge?.kind === "weighed",
        why,
        reasons: why != null || options.some((o) => !o.picked && o.detail !== ""),
        answer,
        ownWords: answer != null && options.length > 0,
        into: h.into.map((id) => ({ id, title: partTitle(f, id) })),
        unseen: unseen.recon.includes(i),
    };
}

// the questions the user answered: one dropped after pushback was never answered
export function answeredQuestions(f: BrainstormFile): HistoryEntry[] {
    return f.history.filter((h) => h.kind === "question" && h.superseded !== true);
}

// what was decided, oldest first so the newest lands at the bottom; recon is the ground every question stood on, so it
// stays at the top
export function historyRows(f: BrainstormFile, unseen: Unseen = NOTHING_UNSEEN): HistoryRow[] {
    const rows = f.history.map((h, i) => historyRow(f, h, i, unseen));
    return [...rows.filter((r) => r.kind === "recon"), ...rows.filter((r) => r.kind === "question")];
}

export const OPTION_KEYS = ["a", "b", "c", "d"] as const;

// the question carries the agent's reasons, which the pane draws under each answer behind one toggle
export function hasProsCons(q: BrainstormQuestion): boolean {
    return (q.options ?? []).some((o) => o.pros != null || o.cons != null);
}

export function optionLetter(i: number): string {
    return String.fromCharCode("A".charCodeAt(0) + i);
}

// several picked options reach the agent as their labels joined by " + ", one as its label alone
export function pickedLine(labels: string[]): string {
    return labels.join(" + ");
}

// the ticked rows of a question that takes more than one option, kept in the order the options are listed
export function togglePick(picked: number[], i: number): number[] {
    return picked.includes(i) ? picked.filter((j) => j !== i) : [...picked, i].sort((a, b) => a - b);
}

// what the send button for the ticked rows says: "Send B + D"
export function sendPickedLabel(picked: number[]): string {
    return `Send ${pickedLine(picked.map(optionLetter))}`;
}

export type JudgeWork = { line: string; judged: boolean; dropped: { name: string; reason: string }[] };

// "A", "A and B", "A, B and C"
function nameList(names: string[]): string {
    return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// the line under a judged question's options, after "Judge’s work: ": how the judge got to its options, or on a
// failed judge why the read and pick are still the agent's. How many the agent listed is never stored, only counted
export function judgeWork(q: BrainstormQuestion): JudgeWork | null {
    const j = q.judge;
    if (j == null) {
        return null;
    }
    if (j.kind === "failed") {
        return {
            line: `the judge failed, so the read and pick are the agent’s: ${j.reason}`,
            judged: false,
            dropped: [],
        };
    }
    const listed =
        q.approaches != null ? `the ${plural(q.approaches.length, "approach", "approaches")}` : "the approaches";
    const added = j.added.length > 0 ? nameList(j.added) : "none";
    const dropped = j.dropped.length > 0 ? String(j.dropped.length) : "none";
    return {
        line: `weighed ${listed} the agent listed, added ${added}, dropped ${dropped}.`,
        judged: true,
        dropped: j.dropped,
    };
}

// the judge weighing an approach question: the file says it works while the question already lists the approaches.
// The agent writing up an answer has `working` but no question, and a `working` over no approaches is any other wait.
// A line Arc sent (linePending) ends the wait: the agent has taken the question over
export function judgeWait(f: BrainstormFile, linePending: boolean): boolean {
    return !linePending && f.working != null && (f.question?.approaches?.length ?? 0) > 0;
}

// a line sent during the wait stops the judge: an answer or Skip, which the agent takes before the judge's options
export function stopsJudge(a: BrainstormAction, f: BrainstormFile | null, linePending: boolean): boolean {
    return f != null && judgeWait(f, linePending) && (a.kind === "answer" || a.kind === "skip");
}

// what the design view's main area holds: the question, or the agent writing, unless the user opened the design
// over it; with neither, the design itself, a pending builder check's clock included. The judge's wait is the
// question with its approaches, "judging"
export type MainView = "question" | "judging" | "working" | "design";

export function mainView(f: BrainstormFile, designOpen: boolean, linePending = false): MainView {
    if (designOpen) {
        return "design";
    }
    if (f.working != null) {
        return judgeWait(f, linePending) ? "judging" : "working";
    }
    return f.question != null ? "question" : "design";
}

// the main view the design was opened over, which the design's back control returns to; the design itself when it
// was not opened over one
export function designUnder(f: BrainstormFile, designOpen: boolean, linePending = false): MainView {
    return designOpen ? mainView(f, false, linePending) : "design";
}

// a board opened from the question goes back to it; one opened from the design, to the design
export function boardBackLabel(f: BrainstormFile | null, designOpen: boolean, linePending = false): string {
    const view = f != null ? mainView(f, designOpen, linePending) : "design";
    return view === "question" || view === "judging" ? "Back to the question" : "Back to the design";
}

// what the builder check's main area holds. The talk question comes first: the agent waits on it in the terminal, and
// its answer may settle the builder's questions. The design opened over a question is the review
export type CheckMain = "working" | "judging" | "question" | "builder" | "review";

export function checkMain(f: BrainstormFile, designOpen: boolean, linePending = false): CheckMain {
    if (designOpen) {
        return "review";
    }
    if (f.working != null) {
        return judgeWait(f, linePending) ? "judging" : "working";
    }
    if (f.question != null) {
        return "question";
    }
    return openBuilderQuestion(f) != null ? "builder" : "review";
}

// the check's main area the review was opened over, which the review's back control returns to; the review itself
// when it was not opened over one
export function checkUnder(f: BrainstormFile, designOpen: boolean, linePending = false): CheckMain {
    return designOpen ? checkMain(f, false, linePending) : "review";
}

function openBuilderQuestion(f: BrainstormFile): BuilderQuestion | null {
    return f.check?.yours.find((y) => y.a == null) ?? null;
}

// the box for a line of the user's own, which the agent reads as pushback or a question back: offered whenever no
// question (talk or builder) is open and no run has started, locked while the agent writes or a check is pending
export type LineBox = "open" | "locked" | "none";

export function lineBox(f: BrainstormFile, checkPending = false): LineBox {
    if (f.question != null || f.run != null || openBuilderQuestion(f) != null) {
        return "none";
    }
    return f.working != null || checkPending ? "locked" : "open";
}

// why the design's edits are locked: the agent writing, or a builder check pending, since the agent rewrites parts
// while it takes in the builder's questions; null while they are open
export type EditLock = "working" | "check" | null;

export function editLock(f: BrainstormFile, check: BuilderCheckView): EditLock {
    if (f.working != null) {
        return "working";
    }
    return check.kind === "pending" ? "check" : null;
}

// a pending check's start and, once the builder is done, its end (ms). The check's run is the source, the one place
// both survive a reload; until the run loads, a reading check starts at its record's time and a finished one is
// unknown, since the record's time was moved to when the builder finished
export type CheckSpan = { start: number; end: number | null };
type CheckRunTimes = { createdts?: number; completedts?: number };

export function checkSpan(record: BuilderCheckRecord | undefined, run: CheckRunTimes | null): CheckSpan | null {
    if (record?.state === "reading") {
        return { start: run?.createdts || record.ts, end: null };
    }
    if (record?.state === "answered" && run?.createdts && run.completedts) {
        return { start: run.createdts, end: run.completedts };
    }
    return null;
}

// the clock strip over the design while a check is pending: the check's time against how long this machine's past
// checks took. bar is fractions of the longest, null before the first past check or with no time to show; over is
// a reading check past the usual time
export type CheckClock = {
    line: string;
    elapsed: string | null;
    running: boolean;
    bar: { fill: number; usual: number } | null;
    note: string;
    over: boolean;
    times: string | null;
};

// m:ss, the clock's own reading
export function clockText(ms: number): string {
    const secs = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

function aboutText(ms: number): string {
    const mins = Math.round(ms / 60_000);
    return mins < 1 ? "under a minute" : `about ${plural(mins, "minute", "minutes")}`;
}

export function checkClock(
    check: Extract<BuilderCheckView, { kind: "pending" }>,
    span: CheckSpan | null,
    times: BrainstormCheckTimes | null,
    now: number
): CheckClock {
    const ms = span == null ? null : (span.end ?? now) - span.start;
    const elapsed = ms == null ? null : clockText(ms);
    const known = times != null && times.usualms > 0 && times.longestms > 0;
    const bar =
        known && ms != null
            ? { fill: Math.min(1, ms / times.longestms), usual: Math.min(1, times.usualms / times.longestms) }
            : null;
    const clock = { line: check.text, elapsed, running: check.stage === "reading", bar, over: false };
    const timesText = known ? `usual ${clockText(times.usualms)} · longest ${clockText(times.longestms)}` : null;
    if (check.stage === "taking-in") {
        const done = elapsed == null ? "The builder finished." : `The builder finished in ${elapsed}.`;
        return {
            ...clock,
            note: `${done} The agent is sorting its questions into yours, its calls and what the design already answers.`,
            times: timesText,
        };
    }
    if (!known) {
        return { ...clock, note: "You can read the design meanwhile.", times: null };
    }
    const about = aboutText(times.usualms);
    const over = ms != null && ms > times.usualms;
    return {
        ...clock,
        note: over
            ? `Taking longer than usual: most checks here finish in ${about}.`
            : `Checks here usually take ${about}. You can read the design meanwhile.`,
        over,
        times: timesText,
    };
}

// how many of the asked question's options a letter key picks: as many as the pane draws, up to the keys there are.
// During the judge's wait the pane draws the approaches as the rows, so a key picks one of them
export function pickableOptions(
    f: BrainstormFile | null,
    s: { designOpen: boolean; board: string | null; removed: boolean; sent?: SentLine | null }
): number {
    if (f == null || s.board != null || s.removed) {
        return 0;
    }
    const linePending = s.sent != null;
    let options: unknown[] | undefined;
    if (f.check != null) {
        const main = checkMain(f, s.designOpen, linePending);
        options =
            main === "question"
                ? f.question!.options
                : main === "builder"
                  ? openBuilderQuestion(f)!.options
                  : main === "judging"
                    ? f.question!.approaches
                    : [];
    } else if (isAsking(f) && mainView(f, s.designOpen) === "question") {
        options = f.question!.options;
    } else if (mainView(f, s.designOpen, linePending) === "judging") {
        options = f.question!.approaches;
    }
    return Math.min(options?.length ?? 0, OPTION_KEYS.length);
}

// the bar over the question: one segment per question answered, the one asked now, and one per part still open,
// each of which a question is still to fill. The builder part is written last without one
export type TrackSegment = "done" | "now" | "ahead";

export function questionTrack(f: BrainstormFile): TrackSegment[] {
    const done = answeredQuestions(f).length;
    const ahead = decisionParts(f).filter((p) => p.state === "open" && p.id !== BUILDER_PART).length;
    return [
        ...Array<TrackSegment>(done).fill("done"),
        ...(f.question != null ? (["now"] as TrackSegment[]) : []),
        ...Array<TrackSegment>(ahead).fill("ahead"),
    ];
}

export function designLabel(f: BrainstormFile): string {
    const n = decisionParts(f).length;
    if (n === 0) {
        return "The design";
    }
    return `The design · ${brainstormCounts(f).yours} of ${n} yours`;
}

export function orderedParts(f: BrainstormFile): BrainstormPart[] {
    return [...f.parts.filter((p) => p.id !== BUILDER_PART), ...f.parts.filter((p) => p.id === BUILDER_PART)];
}

// what the run builds, each of which has to be yours
export function decisionParts(f: BrainstormFile): BrainstormPart[] {
    return orderedParts(f).filter((p) => !isNote(p));
}

export function noteParts(f: BrainstormFile): BrainstormPart[] {
    return orderedParts(f).filter(isNote);
}

// what the user has seen of a brainstorm: each part's text and each recon entry, as the design last drew them. A
// state change is left out, since the user's own confirm makes it
export type SeenMark = { parts: Record<string, string>; recon: string[] };

function partText(p: BrainstormPart): string {
    return [p.title, p.gist ?? "", p.body].join("\n");
}

function reconText(h: HistoryEntry): string {
    return `${h.q}\n${h.a}`;
}

export function seenMark(f: BrainstormFile): SeenMark {
    return {
        parts: Object.fromEntries(f.parts.map((p) => [p.id, partText(p)])),
        recon: f.history.filter((h) => h.kind === "recon").map(reconText),
    };
}

// what the file holds that the user has not seen: parts added or changed since (notes among them, in the design's
// order) and recon entries, by their index in history. Before the first read there is nothing to compare against
export type Unseen = { parts: string[]; notes: string[]; recon: number[] };

const NOTHING_UNSEEN: Unseen = { parts: [], notes: [], recon: [] };

export function unseenSince(f: BrainstormFile, seen: SeenMark | null): Unseen {
    if (seen == null) {
        return NOTHING_UNSEEN;
    }
    // a decision written from the user's own answer is not news to them: its answer line already says where it came from
    const parts = orderedParts(f).filter(
        (p) => seen.parts[p.id] !== partText(p) && !(p.state === "yours" && partAnswer(f, p) != null)
    );
    const known = new Set(seen.recon);
    return {
        parts: parts.map((p) => p.id),
        notes: parts.filter(isNote).map((p) => p.id),
        recon: f.history.flatMap((h, i) => (h.kind === "recon" && !known.has(reconText(h)) ? [i] : [])),
    };
}

// how a part draws: a guess that was yours reads as changed, an asked part the agent is writing up as writing
export type PartView = "yours" | "guess" | "changed" | "asked" | "writing" | "open";

export function partView(f: BrainstormFile, p: BrainstormPart): PartView {
    if (p.state === "guess") {
        return p.was != null ? "changed" : "guess";
    }
    if (p.state === "asked" && f.working != null && f.question == null) {
        return "writing";
    }
    return p.state;
}

export type Phase = "talk" | "check" | "run";
export type PhaseStep = { phase: Phase; label: string; status: "done" | "current" | "todo" };

const PHASES: { phase: Phase; label: string }[] = [
    { phase: "talk", label: "Talking it through" },
    { phase: "check", label: "Builder check" },
    { phase: "run", label: "Run" },
];

export function brainstormPhase(f: BrainstormFile): Phase {
    if (f.run != null) {
        return "run";
    }
    return f.check != null ? "check" : "talk";
}

// once the run merged nothing is current: every phase is done
export function phaseSteps(f: BrainstormFile, merged = false): PhaseStep[] {
    const at = merged ? PHASES.length : PHASES.findIndex((p) => p.phase === brainstormPhase(f));
    return PHASES.map((p, i) => ({ ...p, status: i < at ? "done" : i === at ? "current" : "todo" }));
}

export type ProgressView = {
    segments: { id: string; title: string; state: PartState }[];
    lead: string;
    rest: string;
};

// one segment per part, in the order the design draws them; the label reads per phase
export function progressView(f: BrainstormFile): ProgressView {
    const parts = decisionParts(f);
    const { yours, open } = brainstormCounts(f);
    const segments = parts.map((p) => ({ id: p.id, title: p.title, state: p.state }));
    if (brainstormPhase(f) === "talk") {
        return { segments, lead: `${yours} of ${parts.length}`, rest: "parts yours" };
    }
    return { segments, lead: `${yours} yours`, rest: open === 0 ? "· nothing open" : `· ${open} open` };
}

// the answer a part came from, as the user said it, so a part that says more than the answer shows it
export type PartAnswer = { n: number; text: string };

const ANSWER_FROM = /^(?:your )?answer (\d+)/i;

// the answer the part's from names: the answered question with that n whose into lists the part. A from that names
// no answer, or an answer the history does not tie to the part, has none
export function partAnswer(f: BrainstormFile, p: BrainstormPart): PartAnswer | null {
    const m = ANSWER_FROM.exec(p.from ?? "");
    if (m == null) {
        return null;
    }
    const n = Number(m[1]);
    const h = answeredQuestions(f)
        .filter((e) => e.n === n && e.into.includes(p.id))
        .pop();
    const text = h == null ? "" : h.a || pickedLine(pickedIndexes(h).map((i) => h.options![i].label));
    return text ? { n, text } : null;
}

// an opened row shows the body only when it says more than the gist the row already reads
export function bodyBeyondGist(f: BrainstormFile, p: BrainstormPart): boolean {
    const body = p.body.trim();
    return body !== "" && body !== partGist(f, p).trim();
}

export function answerLine(a: PartAnswer): string {
    return `answer ${a.n}: “${a.text}”`;
}

// a decision still open because pushback dropped the question asked for it: that question's n. A later question for
// the part makes it asked, so the drop no longer stands
export function droppedQuestion(f: BrainstormFile, p: BrainstormPart): number | null {
    if (isNote(p) || p.state !== "open") {
        return null;
    }
    const h = f.history.filter((e) => e.superseded === true && (e.part === p.id || e.into.includes(p.id))).pop();
    return h?.n ?? null;
}

// the one line a part reads as in the design: the agent's gist, else the body's first sentence, else what the part
// waits on
export function partGist(f: BrainstormFile, p: BrainstormPart): string {
    if (p.gist) {
        return p.gist;
    }
    const first = sentences(p.body.trim())[0];
    if (first) {
        return first;
    }
    switch (partView(f, p)) {
        case "asked":
            return f.question?.part === p.id
                ? `Written from your answer to question ${f.question.n}.`
                : "Waiting on the agent’s question.";
        case "writing":
            return "The agent is writing this from your answer.";
        case "open": {
            const dropped = droppedQuestion(f, p);
            if (dropped != null) {
                return `Question ${dropped} was dropped after your pushback; nothing is decided yet.`;
            }
            return p.id === BUILDER_PART ? "The agent writes this last." : "Not talked through yet.";
        }
        default:
            return "";
    }
}

// the guesses one press confirms: a changed part is left out, since it asks keep or restore
export function confirmableGuesses(f: BrainstormFile): number {
    return decisionParts(f).filter((p) => partView(f, p) === "guess").length;
}

// the head of the design once there is something to review: what stands before the builder check, and the one
// press that moves it on. Confirm all needs two guesses, since one has its own That's right. Check is offered only
// with no check under way: a pending one shows its clock in this head's place, a failed one its Try again
export type ReviewHead = { line: string; action: "confirm-all" | "check" | null; guesses: number };

export function reviewHead(f: BrainstormFile, check: BuilderCheckView = { kind: "none" }): ReviewHead {
    if (canCheck(f)) {
        return {
            line: "Every decision is yours. Next, a fresh agent reads the design as a builder would.",
            action: check.kind === "none" ? "check" : null,
            guesses: 0,
        };
    }
    const guesses = confirmableGuesses(f);
    const changed = decisionParts(f).filter((p) => partView(f, p) === "changed").length;
    const said: string[] = [];
    if (guesses > 0) {
        said.push(`${plural(guesses, "decision is", "decisions are")} still the agent’s guess.`);
    }
    if (changed > 0) {
        said.push(
            `${plural(changed, "decision", "decisions")} changed since you confirmed ${changed === 1 ? "it" : "them"}.`
        );
    }
    if (said.length > 0) {
        said.push("Each reads in one line; open one to read it whole.");
    } else {
        said.push("Nothing to confirm; the agent still has questions.");
    }
    return { line: said.join(" "), action: guesses > 1 ? "confirm-all" : null, guesses };
}

// what the left column holds under the question: the builder check once it is ready, else what stands before it.
// nothing while the agent writes, nor beside the first question, when the list would only repeat it
export function leftPanel(f: BrainstormFile): "ready" | "left" | "none" {
    if (f.working != null) {
        return "none";
    }
    if (canCheck(f)) {
        return "ready";
    }
    return f.history.length === 0 && f.question != null ? "none" : "left";
}

export type SentenceDiff = { kind: "same" | "added" | "removed"; text: string }[];

function sentences(text: string): string[] {
    return text.split(/(?<=[.!?])\s+/).filter((s) => s !== "");
}

export function sentenceDiff(was: string, now: string): SentenceDiff {
    const a = sentences(was);
    const b = sentences(now);
    // lcs[i][j]: the longest common run of a[i..] and b[j..]
    const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const out: SentenceDiff = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            out.push({ kind: "same", text: a[i] });
            i++;
            j++;
        } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
            out.push({ kind: "removed", text: a[i++] });
        } else {
            out.push({ kind: "added", text: b[j++] });
        }
    }
    return out;
}

export type HandoffView = {
    questions: number;
    open: BuilderQuestion | null;
    answered: BuilderQuestion[];
    calls: BuilderCall[];
    callsByPart: Record<string, string[]>;
    touched: BrainstormPart[];
    untouched: BrainstormPart[];
    // the check's three tiles: the builder's questions for you, the calls the agent made, those already answered
    forYou: number;
    already: number;
};

export function handoffView(f: BrainstormFile): HandoffView {
    const check = f.check ?? { yours: [], calls: [], answered: [] };
    const callsByPart: Record<string, string[]> = {};
    for (const c of check.calls) {
        if (c.part != null) {
            (callsByPart[c.part] ??= []).push(c.text);
        }
    }
    const parts = orderedParts(f);
    const touchedIds = check.touched != null ? new Set(check.touched) : null;
    const isTouched = (p: BrainstormPart) => touchedIds == null || touchedIds.has(p.id);
    const open = openBuilderQuestion(f);
    return {
        questions: check.yours.length + check.calls.length + check.answered.length,
        open,
        answered: check.yours.filter((y) => y.a != null),
        calls: check.calls,
        callsByPart,
        touched: parts.filter(isTouched),
        untouched: parts.filter((p) => !isTouched(p)),
        forYou: check.yours.length,
        already: check.answered.length,
    };
}

export function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// why Approve is off, said in words beside it; null when it is on. The design is settled only once the builder is
// answered, no talk question is open, and every decision is yours
export function approveBlocker(f: BrainstormFile): string | null {
    if (f.run != null) {
        return null;
    }
    if (f.working != null) {
        return "The agent is writing; this opens when it is done";
    }
    const asked = f.question != null ? `answer question ${f.question.n}` : null;
    const unanswered = f.check?.yours.filter((y) => y.a == null).length ?? 0;
    if (unanswered > 0) {
        const answer = `Answer the builder’s ${plural(unanswered, "question, then review what it changes", "questions, then review what they change")}`;
        return asked != null ? `${answer}, and ${asked}` : answer;
    }
    const decisions = decisionParts(f);
    const count = (view: PartView) => decisions.filter((p) => partView(f, p) === view).length;
    const changed = count("changed");
    const guesses = count("guess");
    const open = decisions.filter(
        (p) => (p.state === "asked" || p.state === "open") && p.id !== f.question?.part
    ).length;
    const items = [
        changed > 0 ? `review ${plural(changed, "change", "changes")}` : null,
        guesses > 0 ? `confirm ${plural(guesses, "guess", "guesses")}` : null,
        asked,
        open > 0 ? `${plural(open, "decision", "decisions")} still open` : null,
    ].filter((s): s is string => s != null);
    return items.length > 0 ? capitalize(items.join(", ")) : null;
}

// the agent's calls under the part each is about. A call about no part, or one the design does not have, is still
// shown, among the others
function groupCalls(f: BrainstormFile): { byPart: Map<string, string[]>; other: string[] } {
    const ids = new Set(f.parts.map((p) => p.id));
    const byPart = new Map<string, string[]>();
    const other: string[] = [];
    for (const c of f.check?.calls ?? []) {
        if (c.part != null && ids.has(c.part)) {
            byPart.set(c.part, [...(byPart.get(c.part) ?? []), c.text]);
        } else {
            other.push(c.text);
        }
    }
    return { byPart, other };
}

// the builder check while it asks: the open builder question, the rail's queue, and the agent's calls by part
export type AskModel = {
    index: number;
    total: number;
    open: BuilderQuestion | null;
    queue: { label: string; state: "now" | "waiting" | "answered" }[];
    callGroups: { part: string | null; title: string; calls: string[] }[];
    calls: number;
    already: string[];
    questions: number;
};

export function checkAsk(f: BrainstormFile): AskModel {
    const check = f.check ?? { yours: [], calls: [], answered: [] };
    const open = openBuilderQuestion(f);
    const { byPart, other } = groupCalls(f);
    const callGroups: AskModel["callGroups"] = orderedParts(f)
        .filter((p) => byPart.has(p.id))
        .map((p) => ({ part: p.id, title: p.title, calls: byPart.get(p.id)! }));
    if (other.length > 0) {
        callGroups.push({ part: null, title: "Other decisions", calls: other });
    }
    return {
        index: open != null ? check.yours.indexOf(open) + 1 : 0,
        total: check.yours.length,
        open,
        queue: check.yours.map((y) => ({
            label: y.label ?? y.q,
            state: y === open ? "now" : y.a != null ? "answered" : "waiting",
        })),
        callGroups,
        calls: check.calls.length,
        already: check.answered,
        questions: check.yours.length + check.calls.length + check.answered.length,
    };
}

// one decision in the check's review: what caused its change, and the one action it asks for
export type ReviewRow = {
    id: string;
    title: string;
    gist: string;
    cause: string;
    // the answer the part came from, as said; the cause leaves out the from it replaces
    said?: PartAnswer;
    was?: string;
    body: string;
    view: PartView;
    action: "keep-restore" | "confirm" | "answer" | null;
    question?: number;
    calls: string[];
};

export type ReviewModel = {
    changed: ReviewRow[];
    fresh: ReviewRow[];
    unchanged: BrainstormPart[];
    notes: BrainstormPart[];
    cursorIds: string[];
    // the changed decisions still waiting on keep or put back
    pending: number;
    summary: string;
    answered: { q: string; a: string; changed: { id: string; title: string }[] }[];
};

function reviewRow(f: BrainstormFile, p: BrainstormPart, calls: string[]): ReviewRow {
    const view = partView(f, p);
    const asks = p.state === "asked" && f.question?.part === p.id;
    const action = view === "changed" ? "keep-restore" : view === "guess" ? "confirm" : asks ? "answer" : null;
    const said = partAnswer(f, p);
    return {
        id: p.id,
        title: p.title,
        gist: partGist(f, p),
        // the skill names the answer that caused the change in why
        cause: p.why ?? (said != null ? "" : (p.from ?? "")),
        ...(said != null ? { said } : {}),
        ...(p.was != null ? { was: p.was } : {}),
        body: p.body,
        view,
        action,
        ...(asks ? { question: f.question!.n } : {}),
        calls,
    };
}

function reviewSummary(changed: number, fresh: number, pending: number, calls: number): string {
    const what: string[] = [];
    if (changed > 0) {
        what.push(
            `Your answers to the builder changed ${plural(changed, "decision", "decisions")} you had confirmed` +
                (fresh > 0 ? `, and ${fresh} ${fresh === 1 ? "is" : "are"} new.` : ".")
        );
    } else if (fresh > 0) {
        what.push(`${plural(fresh, "decision is", "decisions are")} new since the check.`);
    } else {
        what.push("The check changed nothing you had confirmed.");
    }
    const callLine =
        calls > 0
            ? `the agent’s ${plural(calls, "call sits under the decision it belongs", "calls sit under the decision they belong")} to.`
            : null;
    if (pending > 0) {
        what.push(
            callLine != null ? `Keep each change or put yours back; ${callLine}` : "Keep each change or put yours back."
        );
    } else if (callLine != null) {
        what.push(capitalize(callLine));
    }
    return what.join(" ");
}

// what the check changed, for the review. Only yours exists when the check starts, so a decision that is a guess
// without was, or asked or open, is new since it; a yours decision the check touched or put a call under is changed,
// though settled
export function checkReview(f: BrainstormFile): ReviewModel {
    const { byPart } = groupCalls(f);
    const touched = new Set(f.check?.touched ?? []);
    const callsOf = (p: BrainstormPart) => byPart.get(p.id) ?? [];
    const changed: ReviewRow[] = [];
    const fresh: ReviewRow[] = [];
    const unchanged: BrainstormPart[] = [];
    for (const p of decisionParts(f)) {
        if (p.was != null || (p.state === "yours" && (touched.has(p.id) || callsOf(p).length > 0))) {
            changed.push(reviewRow(f, p, callsOf(p)));
        } else if (p.state !== "yours") {
            fresh.push(reviewRow(f, p, callsOf(p)));
        } else {
            unchanged.push(p);
        }
    }
    const rows = [...changed, ...fresh];
    const pending = changed.filter((r) => r.action === "keep-restore").length;
    const calls = rows.reduce((n, r) => n + r.calls.length, 0);
    return {
        changed,
        fresh,
        unchanged,
        notes: noteParts(f),
        cursorIds: rows.map((r) => r.id),
        pending,
        summary: reviewSummary(changed.length, fresh.length, pending, calls),
        answered: (f.check?.yours ?? [])
            .filter((y) => y.a != null)
            .map((y) => ({
                q: y.q,
                a: y.a!,
                changed: (y.into ?? []).map((id) => ({ id, title: partTitle(f, id) })),
            })),
    };
}

export function compactedSummary(f: BrainstormFile): string {
    const c = brainstormCounts(f);
    return `The agent compacted its context and re-read its brainstorm file: ${plural(c.yours, "part", "parts")} yours, ${plural(c.guesses, "guess", "guesses")}, ${c.open} open. Nothing was lost.`;
}

export function exitedSummary(f: BrainstormFile): string {
    const c = brainstormCounts(f);
    const saved = `The brainstorm is saved: ${plural(c.yours, "part", "parts")} yours, ${plural(c.guesses, "guess", "guesses")}`;
    if (f.question != null) {
        return `${saved}, and question ${f.question.n} still unanswered. A new agent reads it and carries on from that question.`;
    }
    return `${saved}. A new agent reads it and carries on.`;
}

export function resumePrompt(path: string): string {
    return `Resume the brainstorm in ${path} with arc:brainstorm.`;
}

const ABSOLUTE_PATH = /^([a-zA-Z]:[\\/]|[\\/])/;

function absoluteSpec(spec: string, cwd: string): string {
    if (ABSOLUTE_PATH.test(spec)) {
        return spec;
    }
    const sep = cwd.includes("\\") ? "\\" : "/";
    return join(cwd, ...spec.split(/[\\/]+/).filter(Boolean)).replace(/[\\/]/g, sep);
}

// the first board any part lists: a brainstorm's canvas need not have a Main board
function firstBoard(f: BrainstormFile): string | undefined {
    return f.parts.find((p) => p.boards != null && p.boards.length > 0)?.boards?.[0];
}

export function runPrefill(f: BrainstormFile, a: { projectName: string; cwd: string }): NewRunPrefill {
    const board = firstBoard(f);
    const prototype = f.canvas && board ? join(canvasProjectDir(canvasDir(a.cwd, f.canvas)), board) : undefined;
    const goal = f.spec ? `Build ${f.title} as specified in ${absoluteSpec(f.spec, a.cwd)}.` : `Build ${f.title}.`;
    return { projectName: a.projectName, shape: "orchestrator", goal, ...(prototype != null ? { prototype } : {}) };
}

export function runLine(projectName: string): string {
    return `${projectName} · orchestrator · this design attached`;
}

// made in the frontend and fed only to the taskbar flash; the server has no such item
export function brainstormAttention(
    a: { agentId: string; agentName: string; topic: string },
    f: BrainstormFile
): AttentionItem {
    const q = f.question ?? { n: 0, text: "", part: "" };
    return {
        kind: "brainstorm",
        key: `brainstorm:${a.agentId}:${q.n}`,
        source: a.agentName,
        text: q.text,
        action: "brainstorm",
        oref: `brainstorm:${a.topic}`,
        phaseidx: 0,
        waitingsince: 0,
    };
}

/** Pure: whether the agent's process exit reads as an exit. Putting an agent to sleep ends its process too, but the
 *  agent is asleep, not gone: the card over the terminal wakes it with its conversation, which the exited card's
 *  "Resume in a new agent" would not. */
export function procExited(exit: { code: number; at: number } | undefined, sleeping: AgentVM["sleeping"]): boolean {
    return exit != null && sleeping == null;
}

export type PaneView = "error" | "removed" | "exited" | "run" | "check" | "board" | "design";

export function paneView(s: {
    file: BrainstormFile | null;
    error: string | null;
    removed: boolean;
    exited: boolean;
    showDesign: boolean;
    board: string | null;
}): PaneView {
    if (s.removed) {
        return "removed";
    }
    if (s.error != null && s.file == null) {
        return "error";
    }
    if (s.exited && !s.showDesign && s.file?.run == null) {
        return "exited";
    }
    if (s.board != null) {
        return "board";
    }
    if (s.file?.run != null) {
        return "run";
    }
    return s.file?.check != null ? "check" : "design";
}

// The one level the pane's back control steps up, or null where it draws none: a full-size board goes back to where
// it was opened, and the design opened over the question or the working note goes back to it. Esc takes the same
// step (agent:brainstorm-back), so the key and the controls cannot disagree on when there is one
export type PaneBack = "board" | "design";

export function paneBack(
    s: Parameters<typeof paneView>[0] & { designOpen: boolean },
    f: BrainstormFile | null
): PaneBack | null {
    const view = paneView(s);
    if (view === "board") {
        return "board";
    }
    if (f == null) {
        return null;
    }
    if (view === "check") {
        return checkUnder(f, s.designOpen) !== "review" ? "design" : null;
    }
    if (view === "design") {
        return designUnder(f, s.designOpen) !== "design" ? "design" : null;
    }
    return null;
}
