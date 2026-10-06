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
import { parseAddress, type OpenTarget } from "./address";
import {
    ACTIVE_CAP,
    mergeActiveWork,
    queueKindLabel,
    queueOpenTarget,
    SEVEN_DAYS_MS,
    type ActiveWorkRow,
    type AgentRow,
    type DeltaGroup,
    type DeltaRow,
    type QueueOpenTarget,
    type QueueRow,
    type RunRow,
    type ShippedRow,
} from "./briefingmodel";
import { headline, noteBody } from "./effortfeed";
import type { EffortCardModel } from "./effortmodel";

export type LineTone = "ok" | "active" | "asking" | "error" | "muted" | "faint";
export type LineTarget = { queue: QueueOpenTarget } | { oref: string } | null;

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
};

export type LineGroup = { label: string; lines: BriefLine[] };

export const SHIPPED_LABEL = "Shipped · 7 days";

// What Space peeks on a row: the target its click opens, or null when it has none or names an address
// the router cannot open (a click on that row still says why).
export function lineOpenTarget(target: LineTarget): OpenTarget | null {
    if (target == null) {
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

export function queueLine(q: QueueRow, now: number): BriefLine {
    const tone: LineTone = q.tone === "error" ? "error" : "asking";
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
        detail: "",
    };
}

// An initiative is a tracker once it has a plan. Until then it is a title written down to come back to —
// an idea — and a 0/0 bar beside it, or an "active" state, would claim progress it cannot have.
export function isIdea(card: EffortCardModel): boolean {
    return card.status !== "archived" && card.done + card.remaining + card.skipped === 0;
}

export function initiativeLine(card: EffortCardModel): BriefLine {
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
        };
    }
    const blocked = card.blockedChunks.length;
    // blocked first: it is the one state that is waiting on someone
    const [state, stateTone]: [string, LineTone] =
        card.status === "archived"
            ? ["archived", "faint"]
            : blocked > 0
              ? [`${blocked} blocked`, "asking"]
              : card.activeTone === "deferred"
                ? ["deferred", "muted"]
                : [card.status, card.status === "paused" ? "muted" : "ok"];
    return {
        id: "initiatives:" + card.oref,
        kind: "",
        kindTone: "muted",
        title: card.title,
        // chunk labels run long as "<name> - <detail>"; the name is what fits beside a title
        note: card.activeChunk?.split(" - ")[0] ?? "",
        meta: joined([card.ticket, card.project || "no project"]),
        state,
        stateTone,
        progress: { done: card.done, total: card.done + card.remaining, pct: card.progressPct },
        target: { oref: card.oref },
        why: "",
        age: "",
        detail: "",
    };
}

// Trackers first, ideas after them under their own label; stable, so each group keeps the briefing's
// order. Applied before the region's cap, so a pile of ideas never pushes a live tracker behind "Show more".
export function ideasLast(cards: EffortCardModel[]): EffortCardModel[] {
    return [...cards.filter((c) => !isIdea(c)), ...cards.filter(isIdea)];
}

const needsEyes = (row: ActiveWorkRow) =>
    row.kind === "blocker" || row.chip?.tone === "blocked" || row.chip?.tone === "asking";
// a run that needs nothing from you reads by how long it has been quiet; anything else by its state
const isDated = (row: ActiveWorkRow) => row.kind === "run" && !needsEyes(row);
const isStale = (row: ActiveWorkRow, now: number) => isDated(row) && now - row.ts > SEVEN_DAYS_MS;

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
    chunkLabel: string;
    effortOref: string;
    chunk: string;
};

export type EffortRef = { oref: string; title: string; chunkStages: Record<string, string> };
// keyed by effort oid, the way a run's effortref names its effort
export type EffortIndex = Map<string, EffortRef>;

// A Runs row (design L266-278, model L1615-1627) from the live Run object and the roster.
export function runRowFace(i: {
    line: BriefLine;
    run?: Run;
    asking: boolean;
    project: string;
    effort?: EffortRef;
}): RunRowFace {
    const { line, run } = i;
    if (run == null) {
        const asking = i.asking || line.state === "asking";
        return {
            type: "agent",
            meta: line.meta,
            elapsed: line.age,
            state: asking ? "asking" : line.state === "working" ? "running" : line.state,
            stateTone: asking ? "asking" : "ok",
            dot: asking ? "asking" : "live",
            asking,
            canStop: false,
            stopped: false,
            chunkLabel: "",
            effortOref: "",
            chunk: "",
        };
    }
    const orch = run.mode === "orchestrator";
    const status = run.status ?? "";
    const [state, stateTone]: [string, LineTone] = i.asking
        ? ["asking", "asking"]
        : status === "blocked"
          ? ["blocked", "asking"]
          : status === "awaiting-review"
            ? ["review", "asking"]
            : status === "cancelled"
              ? ["stopped", "faint"]
              : status === "done"
                ? ["done", "ok"]
                : status === "planning"
                  ? ["planning", "ok"]
                  : ["running", "ok"];
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
        dot: i.asking ? "asking" : terminal ? (status === "done" ? "done" : "idle") : "live",
        asking: i.asking,
        canStop: !terminal,
        stopped: status === "cancelled",
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

// One row per initiative per day: the day's notes read as what was written, finished and planned, led by
// the newest note's first sentence. A burst of forty notes from one agent would otherwise be forty rows.
function digestLine(group: string, rows: DeltaRow[], now: number): BriefLine {
    const newestFirst = [...rows].sort((a, b) => b.ts - a.ts);
    const notes = newestFirst
        .filter((r) => r.kind !== "chunk-added" && CHUNK_EVENTS.has(r.kind))
        .map((r) => ({ ts: r.ts, text: eventText(r) }))
        .filter((n) => n.text !== "");
    const done = rows.filter((r) => r.kind === "chunk-done").length;
    const added = rows.filter((r) => r.kind === "chunk-added").length;
    const status = newestFirst.find((r) => r.kind === "effort-status");
    const top = newestFirst[0];
    return {
        id: `behind:effort:${group}:${top.oref}`,
        kind: "Initiative",
        kindTone: "muted",
        title: top.title,
        note: notes.length > 0 ? headline(noteBody(notes[0])) : "",
        meta: "",
        detail: joined([
            notes.length > 0 ? plural(notes.length, "note") : "",
            done > 0 ? plural(done, "chunk") + " done" : "",
            added > 0 ? plural(added, "chunk") + " added" : "",
            rows.some((r) => r.kind === "effort-created") ? "created" : "",
            status != null ? "marked " + eventText(status) : "",
        ]),
        state: age(top.ts, now),
        stateTone: "muted",
        progress: null,
        target: { oref: top.oref ?? "" },
        why: "",
        age: "",
        group: "delta",
    };
}

const DELTA_TONE: Record<string, LineTone> = {
    "run-created": "active",
    "run-done": "ok",
    decision: "muted",
    dossier: "asking",
};

function deltaLine(row: DeltaRow, now: number): BriefLine {
    const detail = row.detail ?? "";
    return {
        id: "behind:" + row.key,
        // a dossier's wording carries its status after " · "; the kind column takes only the event
        kind: row.wording.split(" · ")[0],
        kindTone: DELTA_TONE[row.kind] ?? "muted",
        title: row.title,
        note: "",
        meta: "",
        state: age(row.ts, now),
        stateTone: "muted",
        progress: null,
        target: row.oref != null ? { oref: row.oref } : null,
        why: "",
        age: "",
        detail:
            row.kind === "dossier" && detail.startsWith("status: ")
                ? "current status: " + detail.slice("status: ".length)
                : detail,
        group: "delta",
    };
}

export function behindGroups(groups: DeltaGroup[], shipped: ShippedRow[], now: number): LineGroup[] {
    const out: LineGroup[] = groups.map((g) => {
        const byEffort = new Map<string, DeltaRow[]>();
        for (const r of g.rows.filter(isEffortEvent)) {
            byEffort.set(r.oref!, [...(byEffort.get(r.oref!) ?? []), r]);
        }
        const lines: BriefLine[] = [];
        const placed = new Set<string>();
        for (const r of g.rows) {
            if (!isEffortEvent(r)) {
                lines.push(deltaLine(r, now));
            } else if (!placed.has(r.oref!)) {
                // the digest sits where the initiative's first event did, so the day keeps its order
                placed.add(r.oref!);
                lines.push(digestLine(g.label, byEffort.get(r.oref!)!, now));
            }
        }
        return { label: g.label, lines };
    });
    if (shipped.length > 0) {
        out.push({
            label: "Shipped · 7 days",
            lines: shipped.map((s) => ({
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
                detail: joined([s.project, headline(s.summary)]),
                hasReport: s.hasReport,
                fresh: s.fresh,
                group: "shipped" as const,
            })),
        });
    }
    return out;
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
