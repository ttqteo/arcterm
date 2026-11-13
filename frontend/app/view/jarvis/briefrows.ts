// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's one-line rows. The regions used to draw four row shapes: a card per waiting item, the whole
// effort card per initiative, a session row and a past row. Each is now the same line: a kind or a progress
// bar, the title with a muted tail, a meta column and a state. A row opens its sheet in one click, which is
// where every action lives, so a line carries where it goes and nothing it could do in place.
//
// Pure: no React.

import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { runStage, type StageTone } from "@/app/view/agents/runstage";
import { parseAddress, type OpenTarget } from "./address";
import {
    ACTIVE_CAP,
    capRegion,
    mergeActiveWork,
    queueKindLabel,
    queueOpenTarget,
    SEVEN_DAYS_MS,
    type ActiveWorkRow,
    type AgentRow,
    type DeltaRow,
    type QueueOpenTarget,
    type QueueRow,
    type RunRow,
    type ShippedRow,
} from "./briefingmodel";
import { headline, noteBody } from "./effortfeed";
import type { ChunkTone, EffortCardModel } from "./effortmodel";

export type LineTone = "ok" | "active" | "running" | "asking" | "error" | "muted" | "faint";
export type LineTarget = { queue: QueueOpenTarget } | { oref: string } | { runQueue: string } | null;

export type QueuedFace = { entryId: string; blocked: boolean; reason: string };

export type BriefLine = {
    // region-prefixed: one object can sit in two regions, and j/k has to see both rows
    id: string;
    kind: string;
    kindTone: LineTone;
    title: string;
    note: string;
    meta: string;
    state: string;
    stateTone: LineTone;
    progress: { done: number; total: number; pct: number } | null;
    target: LineTarget;
    // the per-region fields the design's row anatomies read; "" where a region has none
    why: string;
    age: string;
    detail: string;
    runOid?: string;
    agentId?: string;
    hasReport?: boolean;
    fresh?: boolean;
    group?: "delta" | "shipped";
    // an initiative with no chunks yet: a captured idea, not a tracker, so it has no progress to draw
    idea?: boolean;
    // "4 proposed": the chunks an agent put forward that wait for a decision; absent when none do
    proposed?: string;
    // a tracker card's chunk line: what note names, and each chunk's tone for its segmented bar
    noteLabel?: "Next" | "Blocked on" | "Done";
    segments?: ChunkTone[];
    // a tracker nested under another (nestInitiatives): how deep it sits, and the initiative it is part of
    depth?: number;
    parentOref?: string;
    // direct sub-initiatives under this one, for the title's "+N sub"
    subCount?: number;
    // a run-queue entry drawn among the Runs (briefqueue.ts): its id, whether it is blocked and why
    queued?: QueuedFace;
};

// What nestInitiatives adds to a card: its depth under the top-level initiatives (0 at the top), the sub-initiatives
// directly beneath it, and the initiative it is part of when that one is in the same list.
export type Nesting = { depth: number; subCount: number; parentOref?: string; parentTitle?: string };
export type NestedCard = EffortCardModel & Nesting;

export type LineGroup = { label: string; lines: BriefLine[] };

// the side column's head shows the seven-day window as its meta, so the label is the bare word
export const SHIPPED_LABEL = "Shipped";
export const SHIPPED_EMPTY = "Nothing shipped in the last seven days.";

// A first visit has no last look to be "since", so it says what will show up instead.
export function sinceEmptyLine(firstVisit: boolean): string {
    return firstVisit ? "Runs that land show up here." : "Nothing new since you last looked.";
}

// What Space peeks on a row: the target its click opens, or null when it has none or names an address
// the router cannot open (a click on that row still says why).
export function lineOpenTarget(target: LineTarget): OpenTarget | null {
    if (target == null) {
        return null;
    }
    if ("runQueue" in target) {
        return null;
    }
    let address = "oref" in target ? target.oref : "";
    if ("queue" in target) {
        const q = target.queue;
        if (q.kind === "channel") {
            return { kind: "channel", channelId: q.channelId, runId: q.runId ?? undefined };
        }
        address = q.oref;
    }
    const parsed = parseAddress(address);
    return parsed.kind === "unsupported" ? null : parsed;
}

const age = (ts: number, now: number) => formatAge(now - ts);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const joined = (parts: (string | undefined)[]) => parts.filter((p) => p != null && p !== "").join(" · ");

// The kind chip's colour says who is held up: amber where an agent or a run waits on your answer, grey for a
// reminder or a pile to sort, red for anything stuck. One amber for every row made the column say nothing.
const ANSWER_KINDS = new Set(["dag-gate", "ask", "escalation", "plan-review", "council"]);
const REMINDER_KINDS = new Set(["chunk-due", "radar-triage", "run-unverified", "learn-proposal"]);

function queueTone(q: QueueRow): LineTone {
    if (q.tone === "error") {
        return "error";
    }
    return ANSWER_KINDS.has(q.wireKind) ? "asking" : REMINDER_KINDS.has(q.wireKind) ? "muted" : "error";
}

export function queueLine(q: QueueRow, now: number): BriefLine {
    const tone = queueTone(q);
    const target = queueOpenTarget(q.nav);
    return {
        id: "waiting:" + q.key,
        kind: queueKindLabel(q),
        kindTone: tone,
        title: q.title,
        note: q.why,
        meta: joined([q.attrib, q.detail]),
        state: "",
        stateTone: tone,
        progress: null,
        target: target != null ? { queue: target } : null,
        why: q.why,
        age: q.ts != null ? age(q.ts, now) : "",
        // a note written after the block often says it cleared, which is what Unblock and Done act on
        detail: q.chunk?.latest != null ? `latest ${age(q.chunk.latest.ts, now)} · ${q.chunk.latest.text}` : "",
    };
}

// A search reaches every fold: a match hidden behind "+N more" would read as no match.
export function foldOpen(open: boolean, query: string): boolean {
    return open || query.trim() !== "";
}

// The Initiatives head's quiet count: live trackers nobody has touched for seven days or more. A paused initiative was
// stopped on purpose and a finished one is done, so neither is "quiet"; the rest stopped without anyone saying so, and the
// list sorts them down behind its fold, so the count is the only place they show.
export function quietCount(cards: EffortCardModel[], now: number): number {
    return cards.filter(
        (c) =>
            !isIdea(c) &&
            // a topic moves only through its sub-initiatives, so its own date says nothing
            c.topic !== true &&
            c.status !== "archived" &&
            c.status !== "paused" &&
            c.status !== "done" &&
            !(c.remaining === 0 && c.done > 0) &&
            now - c.updatedts >= SEVEN_DAYS_MS
    ).length;
}

// An initiative is a tracker once it has a plan. Until then it is a title written down to come back to —
// an idea — and a 0/0 bar beside it, or an "active" state, would claim progress it cannot have.
// A topic (buildEffortCards) is not one: it has no plan because its sub-initiatives hold the work.
export function isIdea(card: EffortCardModel): boolean {
    return card.status !== "archived" && card.topic !== true && card.done + card.remaining + card.skipped === 0;
}

// The meta line under a tracker's title: where it sits. A sub-initiative says what it is part of in place of its own
// ticket and project; a parent adds how many sub-initiatives it holds.
function trackerMeta(card: EffortCardModel & Partial<Nesting>): string {
    const sub = card.subCount ?? 0;
    return joined([
        card.parentTitle != null
            ? `↳ Part of ${card.parentTitle}`
            : joined([card.ticket, card.project || "no project"]),
        sub > 0 ? plural(sub, "sub-initiative") : undefined,
    ]);
}

// the nesting a card carries, if nestInitiatives gave it any; a card never nested leaves the line without the fields
function nestingFields(card: EffortCardModel & Partial<Nesting>): Partial<BriefLine> {
    if (card.depth == null) {
        return {};
    }
    return {
        depth: card.depth,
        subCount: card.subCount ?? 0,
        ...(card.parentOref != null ? { parentOref: card.parentOref } : {}),
    };
}

export function initiativeLine(card: EffortCardModel & Partial<Nesting>): BriefLine {
    const proposed = card.proposed.length > 0 ? { proposed: `${card.proposed.length} proposed` } : {};
    if (isIdea(card)) {
        return {
            id: "initiatives:" + card.oref,
            kind: "",
            kindTone: "muted",
            title: card.title,
            note: "",
            meta: joined([card.ticket, card.project || "no project"]),
            // only a state worth saying: every idea is "active" until it is paused
            state: card.status === "active" ? "" : card.status,
            stateTone: "muted",
            progress: null,
            target: { oref: card.oref },
            why: "",
            age: "",
            detail: "",
            idea: true,
            ...proposed,
        };
    }
    const blocked = card.blockedChunks.length;
    const finished = card.remaining === 0 && card.done > 0;
    // blocked first: it is the one state that is waiting on someone. Plain active says nothing: it is
    // every live card's state, so a chip for it would only repeat down the grid.
    const [state, stateTone]: [string, LineTone] =
        card.status === "archived"
            ? ["archived", "faint"]
            : blocked > 0
              ? [`${blocked} blocked`, "asking"]
              : finished || card.status === "done"
                ? ["done", "ok"]
                : card.activeTone === "deferred"
                  ? ["deferred", "muted"]
                  : card.status === "paused"
                    ? ["paused", "muted"]
                    : ["", "ok"];
    const [noteLabel, note]: [BriefLine["noteLabel"], string] =
        blocked > 0
            ? ["Blocked on", card.blockedChunks[0]]
            : finished
              ? ["Done", `all ${plural(card.done, "chunk")} done`]
              : card.activeChunk != null
                ? ["Next", card.activeChunk]
                : [undefined, ""];
    return {
        id: "initiatives:" + card.oref,
        kind: "",
        kindTone: "muted",
        title: card.title,
        // the whole label: the card gives it a line of its own and truncates it there
        note,
        noteLabel,
        meta: trackerMeta(card),
        state,
        stateTone,
        // a topic with no chunks of its own has no progress to show: a 0/0 bar would claim it stalled
        progress:
            card.topic === true && card.done + card.remaining === 0
                ? null
                : { done: card.done, total: card.done + card.remaining, pct: card.progressPct },
        segments: card.segments,
        target: { oref: card.oref },
        why: "",
        age: "",
        detail: "",
        ...nestingFields(card),
        ...proposed,
    };
}

// Trackers and ideas, each in the briefing's order. Split before the caps, which are per group, so a pile
// of ideas never pushes a live tracker behind "Show more" and the reverse.
export function splitIdeas(cards: EffortCardModel[]): { trackers: EffortCardModel[]; ideas: EffortCardModel[] } {
    return { trackers: cards.filter((c) => !isIdea(c)), ideas: cards.filter(isIdea) };
}

const oidOf = (oref: string) => oref.replace(/^effort:/, "");

// The trackers as the List draws them: each sub-initiative right after the initiative it is part of (a grandchild one
// level deeper), the top-level ones keeping the order they came in and a sub-initiative keeping its place among its
// siblings. A parent that is not in `cards` (archived, filtered out, deleted: `parentoid` can dangle) leaves its child
// at the top, and data that holds a cycle or a self-link loses no row: what the walk from the top never reaches is
// walked from where it stands.
export function nestInitiatives(cards: EffortCardModel[]): NestedCard[] {
    const byOid = new Map(cards.map((c) => [oidOf(c.oref), c]));
    const parentOf = (c: EffortCardModel): EffortCardModel | undefined => {
        const p = c.parentoid != null && c.parentoid !== "" ? byOid.get(c.parentoid) : undefined;
        return p !== c ? p : undefined;
    };
    const kids = new Map<string, EffortCardModel[]>();
    for (const c of cards) {
        const p = parentOf(c);
        if (p != null) {
            kids.set(p.oref, [...(kids.get(p.oref) ?? []), c]);
        }
    }
    const out: NestedCard[] = [];
    const seen = new Set<string>();
    const place = (c: EffortCardModel, depth: number, parent?: NestedCard) => {
        if (seen.has(c.oref)) {
            return;
        }
        seen.add(c.oref);
        const row: NestedCard = {
            ...c,
            depth,
            subCount: 0,
            ...(parent != null ? { parentOref: parent.oref, parentTitle: parent.title } : {}),
        };
        out.push(row);
        if (parent != null) {
            parent.subCount++;
        }
        for (const k of kids.get(c.oref) ?? []) {
            place(k, depth + 1, row);
        }
    };
    for (const c of cards) {
        if (parentOf(c) == null) {
            place(c, 0);
        }
    }
    for (const c of cards) {
        place(c, 0);
    }
    return out;
}

// What a row's depth reads once some of the rows are gone (a filter, a delete waiting out its undo window): a row whose
// parent is no longer drawn stands at the top, and what hangs under it moves up with it. The same list comes back when
// nothing moves.
export function settleNesting(lines: BriefLine[]): BriefLine[] {
    const depthOf = new Map<string, number>();
    let moved = false;
    const out = lines.map((l) => {
        const parentDepth = l.parentOref != null ? depthOf.get(l.parentOref) : undefined;
        const depth = parentDepth != null ? parentDepth + 1 : 0;
        if (l.target != null && "oref" in l.target) {
            depthOf.set(l.target.oref, depth);
        }
        if (depth === (l.depth ?? 0)) {
            return l;
        }
        moved = true;
        return { ...l, depth };
    });
    return moved ? out : lines;
}

// What is linked under an initiative, for its opened detail: the sub-initiatives (they have a plan) and the ideas
// (they do not yet), live ones only, each in the order `cards` has them.
export function linkedUnder(
    parentOref: string,
    cards: EffortCardModel[]
): { subs: EffortCardModel[]; ideas: EffortCardModel[] } {
    const oid = oidOf(parentOref);
    const under = cards.filter((c) => c.parentoid === oid && c.status !== "archived" && c.oref !== parentOref);
    return { subs: under.filter((c) => !isIdea(c)), ideas: under.filter(isIdea) };
}

const needsEyes = (row: ActiveWorkRow) =>
    row.kind === "blocker" || row.chip?.tone === "blocked" || row.chip?.tone === "asking";
// a run that needs nothing from you reads by how long it has been quiet; anything else by its state
const isDated = (row: ActiveWorkRow) => row.kind === "run" && !needsEyes(row);
// a run quiet past seven days folds, and so does one blocked that long: a week-old block is a leftover the Runs count
// would otherwise call live while nothing runs. An asking row stays, its ask is still open.
const isStale = (row: ActiveWorkRow, now: number) =>
    row.kind === "run" && (isDated(row) || row.chip?.tone === "blocked") && now - row.ts > SEVEN_DAYS_MS;

export function sessionLine(row: ActiveWorkRow, now: number): BriefLine & { stale: boolean } {
    const eyes = needsEyes(row);
    const running = row.chip?.tone === "running";
    const dated = isDated(row);
    return {
        id: "sessions:" + row.key,
        kind: (eyes ? "!" : running ? "▶" : "·") + " " + row.kind,
        kindTone: eyes ? "asking" : running ? "active" : "muted",
        title: row.name,
        note: "",
        meta: row.meta,
        state: dated ? age(row.ts, now) : (row.chip?.label ?? row.kind),
        stateTone: eyes ? "asking" : !dated && running ? "ok" : "muted",
        progress: null,
        // a run has a sheet; a blocker or a direct agent has none yet, so its row opens nothing
        target: row.kind === "run" ? { oref: row.oref } : null,
        why: "",
        age: age(row.ts, now),
        detail: "",
        runOid: row.kind === "run" ? row.oref.replace(/^run:/, "") : undefined,
        agentId: row.kind === "agent" ? row.key.split(":")[1] : undefined,
        stale: isStale(row, now),
    };
}

export type RunRowFace = {
    type: "quick run" | "orchestrator" | "agent";
    meta: string;
    elapsed: string;
    state: string;
    stateTone: LineTone;
    dot: "live" | "asking" | "done" | "idle";
    asking: boolean;
    canStop: boolean;
    stopped: boolean;
    // a paused run: its state says so in full, and its row offers Resume beside Stop
    paused: boolean;
    chunkLabel: string;
    effortOref: string;
    chunk: string;
};

export type EffortRef = { oref: string; title: string; chunkStages: Record<string, string> };
// keyed by effort oid, the way a run's effortref names its effort
export type EffortIndex = Map<string, EffortRef>;

const STAGE_LINE_TONE: Record<StageTone, LineTone> = {
    working: "ok",
    running: "running",
    asking: "asking",
    done: "ok",
    error: "error",
    muted: "faint",
};

// A Runs row (design L266-278, model L1615-1627) from the live Run object and the roster. The run's state word and
// tone are its stage (runstage.ts), read with the dag when the lineage holds it, so the row says what the Agent
// tree and the run sheet say.
export function runRowFace(i: {
    line: BriefLine;
    run?: Run;
    dag?: TaskGroup;
    asking: boolean;
    project: string;
    effort?: EffortRef;
}): RunRowFace {
    const { line, run } = i;
    if (run == null) {
        const asking = i.asking || line.state === "asking";
        // a direct agent (or a run not loaded yet) has no Run to read, so its line's own tone is the truth
        const tone: LineTone = asking ? "asking" : line.stateTone;
        return {
            type: "agent",
            meta: line.meta,
            elapsed: line.age,
            state: asking ? "asking" : line.state === "working" ? "running" : line.state,
            stateTone: tone,
            dot: tone === "asking" ? "asking" : tone === "ok" ? "live" : "idle",
            asking,
            canStop: false,
            stopped: false,
            paused: false,
            chunkLabel: "",
            effortOref: "",
            chunk: "",
        };
    }
    const orch = run.mode === "orchestrator";
    const status = run.status ?? "";
    const s = runStage({ status: run.status, land: run.land, dag: i.dag }, i.asking);
    const paused = s.paused;
    // a paused run says so in the tree's own words, whole (the row has room for them); a question names itself, a run
    // whose worker died keeps the word blocked (its stage alone would say working), and a cancelled run keeps the
    // Brief's own word, stopped, which its Stop button earns
    const state = paused
        ? s.label
        : i.asking
          ? "asking"
          : status === "blocked"
            ? "blocked"
            : s.key === "cancelled"
              ? "stopped"
              : s.label.toLowerCase();
    const stateTone = STAGE_LINE_TONE[s.tone];
    const terminal = status === "done" || status === "cancelled";
    const ref = run.effortref;
    const linked = ref != null && i.effort != null;
    const stage = linked ? (i.effort.chunkStages[ref.chunklabel] ?? "") : "";
    return {
        type: orch ? "orchestrator" : "quick run",
        meta: orch ? `lead · ${i.project}` : `${run.runtime || "claude"} · ${i.project}`,
        elapsed: line.age,
        state,
        stateTone,
        dot: s.needsYou ? "asking" : s.complete ? "done" : s.key === "cancelled" || paused ? "idle" : "live",
        asking: i.asking,
        canStop: !terminal,
        stopped: status === "cancelled",
        paused,
        chunkLabel: linked ? `${i.effort.title} · ${stage || "unstaged"}` : "",
        effortOref: linked ? i.effort.oref : "",
        chunk: ref?.chunklabel ?? "",
    };
}

// The Sessions region's rows. Blockers are not among them: they wait on you, so they join the queue
// (buildAttentionQueue). Stale runs leave before the cap: capped first, a window full of week-quiet runs
// drew nothing but the fold, and its "+N more" only fed the fold. The live rows still cap per kind, as the
// legs always did, and the stale ones follow them, drawn only while the fold is open.
export function sessionWindow(
    legs: { activeRuns: RunRow[]; directAgents: AgentRow[] },
    open: boolean,
    now: number
): { rows: ActiveWorkRow[]; more: number } {
    const merged = mergeActiveWork({ activeRuns: legs.activeRuns, blockers: [], directAgents: legs.directAgents });
    const live = merged.filter((r) => !isStale(r, now));
    const perKind = new Map<string, number>();
    const shown = live.filter((r) => {
        const n = (perKind.get(r.kind) ?? 0) + 1;
        perKind.set(r.kind, n);
        return open || n <= ACTIVE_CAP;
    });
    return { rows: [...shown, ...merged.filter((r) => isStale(r, now))], more: live.length - shown.length };
}

// The Runs filter. An orchestrator run carries the most to read, so it can be looked at alone; a direct
// agent is neither kind, so a filtered view drops it. Any mode but orchestrator reads as a quick run,
// the same split runRowFace badges.
export type RunKindFilter = "all" | "orchestrator" | "quick";
export const RUN_KIND_FILTERS: readonly RunKindFilter[] = ["all", "orchestrator", "quick"];

export function keepsRunKind(filter: RunKindFilter, mode: string): boolean {
    return filter === "all" || (mode === "orchestrator") === (filter === "orchestrator");
}

export function runKindLegs(
    legs: { activeRuns: RunRow[]; directAgents: AgentRow[] },
    filter: RunKindFilter
): { activeRuns: RunRow[]; directAgents: AgentRow[] } {
    if (filter === "all") {
        return legs;
    }
    return { activeRuns: legs.activeRuns.filter((r) => keepsRunKind(filter, r.mode)), directAgents: [] };
}

// The Initiatives filter: null is every project, and "" picks the initiatives that name none. The options
// sort by name rather than by count, so a chip does not move while you reach for it.
export function initiativeProjects(cards: { project?: string }[]): string[] {
    const names = [...new Set(cards.map((c) => c.project ?? ""))];
    return names.sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
}

export function keepsProject(filter: string | null, project: string | undefined): boolean {
    return filter == null || (project ?? "") === filter;
}

export function projectCounts(cards: { project?: string }[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const c of cards) {
        counts.set(c.project ?? "", (counts.get(c.project ?? "") ?? 0) + 1);
    }
    return counts;
}

// a direct agent is neither kind, so only all counts it
export function runKindCounts(modes: string[], unkinded = 0): Record<RunKindFilter, number> {
    const orchestrator = modes.filter((m) => keepsRunKind("orchestrator", m)).length;
    return { all: modes.length + unkinded, orchestrator, quick: modes.length - orchestrator };
}

// A region filter's chips get a line of their own under the head while there are few; past this many
// choices besides all, a line of them runs on and wraps, so the head carries one menu instead.
export const FILTER_LINE_MAX = 6;

// options counts the all choice, which every filter leads with
export function filterAsMenu(options: number): boolean {
    return options - 1 > FILTER_LINE_MAX;
}

const CHUNK_EVENTS = new Set(["effort-note", "chunk-status", "chunk-done", "chunk-added"]);
const EFFORT_EVENTS = new Set([...CHUNK_EVENTS, "effort-created", "effort-status"]);

const isEffortEvent = (row: DeltaRow): boolean => EFFORT_EVENTS.has(row.kind) && (row.oref ?? "").startsWith("effort:");

// the timeline folds a chunk event's label into its detail as "<label> · <text>"
function eventText(row: DeltaRow): string {
    const detail = row.detail ?? "";
    if (!CHUNK_EVENTS.has(row.kind)) {
        return detail;
    }
    const at = detail.indexOf(" · ");
    return at < 0 ? "" : detail.slice(at + " · ".length);
}

const RUN_EVENTS = new Set(["run-created", "run-done"]);

// A run goal runs to paragraphs; a Behind you row is one line, so it takes the goal's first line's lead sentence.
export function shortTitle(text: string): string {
    return headline(text.trim().split("\n")[0] ?? "");
}

const MD_LIST = /^(?:[-*+]|\d+[.)])\s+/;
const MD_INLINE = /\*\*|__|`/g;
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g;

// A run's summary is often its report's markdown ("# Run report: ... ## Tasks - t-1: ..."); a row's second line takes its
// first line of prose instead: headings skipped, list markers, emphasis, code ticks and link targets dropped.
export function plainSummary(md: string): string {
    const line = md
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l !== "" && !l.startsWith("#") && !/^[-*_=|]{3,}/.test(l));
    if (line == null) {
        return "";
    }
    return headline(line.replace(MD_LIST, "").replace(MD_LINK, "$1").replace(MD_INLINE, "").trim());
}

// One row per initiative over the whole window: its notes read as what was written, finished and planned, led by the
// newest note's first sentence, with the runs it started or finished counted beside them. A burst of forty notes from one
// agent would otherwise be forty rows, and a row per day would show an initiative that moved on both days twice.
function digestLine(oref: string, title: string, rows: DeltaRow[], now: number): BriefLine {
    const newestFirst = [...rows].sort((a, b) => b.ts - a.ts);
    const notes = newestFirst
        .filter((r) => r.kind !== "chunk-added" && CHUNK_EVENTS.has(r.kind))
        .map((r) => ({ ts: r.ts, text: eventText(r) }))
        .filter((n) => n.text !== "");
    const done = rows.filter((r) => r.kind === "chunk-done").length;
    const added = rows.filter((r) => r.kind === "chunk-added").length;
    const runs = new Set(rows.filter((r) => RUN_EVENTS.has(r.kind)).map((r) => r.oref)).size;
    const status = newestFirst.find((r) => r.kind === "effort-status");
    const top = newestFirst[0];
    return {
        id: `behind:effort:${oref}`,
        kind: "Initiative",
        kindTone: "muted",
        title,
        note: notes.length > 0 ? headline(noteBody(notes[0])) : "",
        meta: "",
        detail: joined([
            notes.length > 0 ? plural(notes.length, "note") : "",
            done > 0 ? plural(done, "chunk") + " done" : "",
            added > 0 ? plural(added, "chunk") + " added" : "",
            runs > 0 ? plural(runs, "run") : "",
            rows.some((r) => r.kind === "effort-created") ? "created" : "",
            status != null ? "marked " + eventText(status) : "",
        ]),
        state: age(top.ts, now),
        stateTone: "muted",
        progress: null,
        target: { oref },
        why: "",
        age: "",
        group: "delta",
    };
}

// a record's update asks nothing of anyone, so it is not drawn in the asking amber
const DELTA_TONE: Record<string, LineTone> = {
    "run-created": "active",
    "run-done": "ok",
    decision: "muted",
    dossier: "muted",
};

// the second line: the project, then what happened. A run's start says its status, its finish its summary.
function deltaDetail(row: DeltaRow, project: string): string {
    const detail = row.detail ?? "";
    const status = detail.startsWith("status: ") ? detail.slice("status: ".length) : null;
    if (row.kind === "dossier" && status != null) {
        return joined([project, "current status: " + status]);
    }
    if (row.kind === "run-done") {
        return joined([project, plainSummary(detail)]);
    }
    return joined([project, row.kind === "run-created" && status != null ? status : detail]);
}

function deltaLine(row: DeltaRow, now: number, project: string): BriefLine {
    return {
        id: "behind:" + row.key,
        // a dossier's wording carries its status after " · "; the kind column takes only the event
        kind: row.wording.split(" · ")[0],
        kindTone: DELTA_TONE[row.kind] ?? "muted",
        title: shortTitle(row.title),
        note: "",
        meta: "",
        state: age(row.ts, now),
        stateTone: "muted",
        progress: null,
        target: row.oref != null ? { oref: row.oref } : null,
        why: "",
        age: "",
        detail: deltaDetail(row, project),
        group: "delta",
    };
}

// what Behind you reads beyond the rows: initiative titles for a run's fold, project names for the rest
export type BehindContext = {
    efforts?: EffortIndex;
    projects?: Record<string, { path?: string }> | null;
};

// Since you looked, by kind: the runs that moved, one row per initiative, then the records. Runs and initiatives
// open SINCE_CAP rows at a time; the records fold into one summary row, because a record's update says only its
// current status, and twenty of them saying "active" were the region's whole first screen.
export type SinceKind = "runs" | "initiatives" | "records";
export type SinceSection = {
    kind: SinceKind;
    label: string;
    lines: BriefLine[];
    // records only: the row the closed fold shows, and the one that opens it
    summary?: BriefLine;
};
export const SINCE_CAP = 5;
export const RECORDS_SUMMARY_ID = "behind:records";
const RECORD_EVENTS = new Set(["dossier", "decision"]);

function recordsSummary(rows: DeltaRow[], now: number): BriefLine {
    const statuses = new Map<string, number>();
    for (const r of rows) {
        const status = (r.detail ?? "").startsWith("status: ") ? r.detail!.slice("status: ".length) : null;
        if (r.kind === "dossier" && status != null) {
            statuses.set(status, (statuses.get(status) ?? 0) + 1);
        }
    }
    const decisions = rows.filter((r) => r.kind === "decision").length;
    // a decision is recorded, not updated: with nothing else in the fold, the title says so and needs no detail
    const onlyDecisions = decisions === rows.length;
    return {
        id: RECORDS_SUMMARY_ID,
        kind: "Records",
        kindTone: "muted",
        title: onlyDecisions ? plural(decisions, "decision") + " recorded" : plural(rows.length, "record") + " updated",
        note: "",
        meta: "",
        detail: joined([
            ...[...statuses].sort((a, b) => b[1] - a[1]).map(([status, n]) => `${n} ${status}`),
            decisions > 0 && !onlyDecisions ? plural(decisions, "decision") : "",
        ]),
        state: age(Math.max(...rows.map((r) => r.ts)), now),
        stateTone: "muted",
        progress: null,
        target: null,
        why: "",
        age: "",
        group: "delta",
    };
}

export function sinceSections(delta: DeltaRow[], now: number, ctx: BehindContext = {}): SinceSection[] {
    const name = (path: string | undefined) => projectName(path ?? "", ctx.projects ?? null);
    const rows = [...delta].sort((a, b) => b.ts - a.ts);
    // an initiative's title: from its own events, else the index; a run whose initiative has neither (archived, or
    // another project's) stays a run rather than a digest with no name
    const titles = new Map<string, string>();
    for (const r of rows.filter(isEffortEvent)) {
        if (!titles.has(r.oref!)) {
            titles.set(r.oref!, r.title);
        }
    }
    const foldKey = (r: DeltaRow): string | null => {
        if (isEffortEvent(r)) {
            return r.oref!;
        }
        if (!RUN_EVENTS.has(r.kind) || !r.effortOid) {
            return null;
        }
        const oref = "effort:" + r.effortOid;
        const indexed = ctx.efforts?.get(r.effortOid)?.title;
        if (!titles.has(oref) && indexed != null) {
            titles.set(oref, indexed);
        }
        return titles.has(oref) ? oref : null;
    };
    const byEffort = new Map<string, DeltaRow[]>();
    const runs: BriefLine[] = [];
    const records: DeltaRow[] = [];
    // a run that finished inside the window says so on its finish; its start would repeat it
    const finished = new Set(rows.filter((r) => r.kind === "run-done" && r.oref != null).map((r) => r.oref));
    for (const r of rows) {
        const k = foldKey(r);
        if (k != null) {
            byEffort.set(k, [...(byEffort.get(k) ?? []), r]);
        } else if (RECORD_EVENTS.has(r.kind)) {
            records.push(r);
        } else if (!(r.kind === "run-created" && finished.has(r.oref))) {
            runs.push(deltaLine(r, now, name(r.project)));
        }
    }
    // newest activity first: the map keeps the order each initiative's newest event was met in
    const initiatives = [...byEffort].map(([oref, evs]) => digestLine(oref, titles.get(oref)!, evs, now));
    const out: SinceSection[] = [];
    if (runs.length > 0) {
        out.push({ kind: "runs", label: "Runs", lines: runs });
    }
    if (initiatives.length > 0) {
        out.push({ kind: "initiatives", label: "Initiatives", lines: initiatives });
    }
    if (records.length > 0) {
        out.push({
            kind: "records",
            label: "Records",
            lines: records.map((r) => deltaLine(r, now, name(r.project))),
            summary: recordsSummary(records, now),
        });
    }
    return out;
}

// What a section draws: the filter narrows its rows and reaches past every fold (foldOpen). Runs and initiatives show
// SINCE_CAP rows and count the rest; the records show their summary row, and their rows under it once opened.
export function sinceWindow(
    section: SinceSection,
    open: boolean,
    query: string
): { summary: BriefLine | null; lines: BriefLine[]; more: number; total: number } {
    const lines = filterLines(section.lines, query);
    const searching = query.trim() !== "";
    if (section.kind === "records") {
        return {
            summary: searching ? null : (section.summary ?? null),
            lines: foldOpen(open, query) ? lines : [],
            more: 0,
            total: lines.length,
        };
    }
    const w = capRegion(lines, SINCE_CAP, foldOpen(open, query));
    return { summary: null, lines: w.rows, more: w.more, total: lines.length };
}

// Shipped: the last seven days' landed runs, its own region beside Since you looked
export function shippedBriefLines(shipped: ShippedRow[], now: number, ctx: BehindContext = {}): BriefLine[] {
    const name = (path: string | undefined) => projectName(path ?? "", ctx.projects ?? null);
    return shipped.map((s) => ({
        id: "behind:shipped:" + s.oref,
        kind: "Shipped",
        kindTone: "ok",
        title: s.goal,
        note: "",
        meta: "",
        state: age(s.completedTs, now),
        stateTone: "muted",
        progress: null,
        target: { oref: s.oref },
        why: "",
        age: "",
        detail: joined([name(s.project), plainSummary(s.summary)]),
        hasReport: s.hasReport,
        fresh: s.fresh,
        group: "shipped" as const,
    }));
}

export function filterLines<T extends BriefLine>(lines: T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return lines;
    }
    return lines.filter((l) =>
        [l.kind, l.title, l.note, l.meta, l.detail, l.state].join(" ").toLowerCase().includes(q)
    );
}

// a project's registry name for its path; the path's last segment when the registry has no entry
export function projectName(path: string, projects: Record<string, { path?: string }> | null): string {
    if (path === "") {
        return "";
    }
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const hit = Object.entries(projects ?? {}).find(([, v]) => v.path != null && norm(v.path) === norm(path));
    return hit != null ? hit[0] : (path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? path);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// Behind you's meta (design L1793). firstVisit: no stored cursor, so the window is the seven-day default.
export function sinceLabel(cursorTs: number, nowTs: number, firstVisit: boolean): string {
    if (firstVisit) {
        return "the last 7 days";
    }
    const d = new Date(cursorTs);
    const today = new Date(nowTs);
    today.setHours(0, 0, 0, 0);
    const day = new Date(cursorTs);
    day.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    if (diff === 0) {
        return `since today ${hhmm(d)}`;
    }
    if (diff === 1) {
        return `since yesterday ${hhmm(d)}`;
    }
    return `since ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
