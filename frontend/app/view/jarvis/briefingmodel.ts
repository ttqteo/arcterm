// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Briefing's pure projection: WorkState + the live agent roster -> render-ready rows. All
// ordering, exact worker suppression, window filtering, wording and navigation normalization happens
// here; React components do not reinterpret wire kinds inline.

import { formatAge, type AgentVM } from "@/app/view/agents/agentsviewmodel";
import { buildEffortCard, type EffortCardModel } from "./effortmodel";

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// The window a region opens at. This projection produces every row it knows about; the caps are what
// the Brief shows before its regions are expanded, so the hidden rows stay addressable rather than
// being discarded here. capRegion applies them.
export const EFFORT_CAP = 6;
export const ACTIVE_CAP = 8;
export const DELTA_CAP = 10;
export const SHIPPED_CAP = 3;

export interface CappedRows<T> {
    rows: T[];
    more: number;
}

// The overflow count is what the cap actually hid, not what it was expected to hide: derived from the
// rows either side of the slice so the "+N more" on a region can never disagree with the rows above it.
export function capRegion<T>(rows: T[], cap: number, expanded: boolean): CappedRows<T> {
    const shown = expanded ? rows : rows.slice(0, cap);
    return { rows: shown, more: rows.length - shown.length };
}

export interface BriefingModelInput {
    state: WorkState;
    agents: AgentVM[];
    actualCursor: number;
    queryStartedAt: number;
    sevenDaysAgo: number;
}

export interface RunRow {
    oref: string;
    oid: string;
    goal: string;
    project: string;
    status: string;
    workerOrefs: string[];
    mode: string;
    ts: number;
}
export interface BlockerRow {
    oref: string;
    objective: string;
    blockers: string;
    project: string | null;
    ts: number;
}
export interface AgentRow {
    oref: string;
    id: string;
    name: string;
    task: string;
    runtime: string;
    project: string | null;
    state: "working" | "asking";
    startedTs: number;
}
export interface DeltaRow {
    key: string;
    ts: number;
    kind: string;
    title: string;
    wording: string;
    detail: string | null;
    oref: string | null;
}
export interface ShippedRow {
    oref: string;
    goal: string;
    project: string;
    summary: string;
    completedTs: number;
    fresh: boolean;
    hasReport: boolean;
    effortOid: string;
    chunkLabel: string;
    mode: string;
}
// one recency-sorted list across runs, blockers and direct agents; the kind badge tells the
// story the old per-leg sub-headers told, so the section reads as one triage queue.
export type ActiveWorkKind = "run" | "blocker" | "agent";
export interface ActiveWorkRow {
    key: string;
    kind: ActiveWorkKind;
    oref: string;
    name: string;
    meta: string;
    chip: { label: string; tone: "blocked" | "asking" | "running" | "muted" } | null;
    ts: number;
}

// calendar-day buckets for the since-last-visit window; empty groups are dropped so a quiet
// day simply doesn't render.
export type DeltaGroupLabel = "Today" | "Yesterday" | "Earlier";
export interface DeltaGroup {
    label: DeltaGroupLabel;
    rows: DeltaRow[];
}
export function groupDelta(delta: DeltaRow[], nowTs: number): DeltaGroup[] {
    const startOfDay = (ts: number) => {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    };
    const today = startOfDay(nowTs);
    const yesterday = today - 24 * 60 * 60 * 1000;
    const groups: DeltaGroup[] = [
        { label: "Today", rows: [] },
        { label: "Yesterday", rows: [] },
        { label: "Earlier", rows: [] },
    ];
    for (const row of delta) {
        const label: DeltaGroupLabel = row.ts >= today ? "Today" : row.ts >= yesterday ? "Yesterday" : "Earlier";
        groups.find((g) => g.label === label)!.rows.push(row);
    }
    return groups.filter((g) => g.rows.length > 0);
}

// The needs-you queue: one actionable row per waiting thing, replacing the single count banner that
// only ever opened the rail. Rows come from the live attention poll (attentionstore), not the
// snapshot, so an ask raised after the snapshot still appears; the snapshot's own attention items
// stay the delta-dedup key and nothing else.
export type QueueTone = "asking" | "error";
export type QueueNav =
    | { kind: "channel"; channelId: string; runId: string | null }
    | { kind: "effort"; oref: string }
    // radar triage names no channel — a scan belongs to a project — so it is the one row addressed by
    // the oref the server sent. The full oref is carried, matching the effort variant: the consumer
    // strips the otype, so the model never has to know which surface answers for it.
    | { kind: "radar"; oref: string }
    | { kind: "record"; oref: string };
export interface QueueRow {
    key: string;
    kind: string;
    title: string;
    source: string;
    detail: string;
    ts: number | null;
    action: string | null;
    nav: QueueNav | null;
    tone: QueueTone;
    // The initiative this waiting thing belongs to: the effort's title joined here from the list the
    // Brief already holds, plus the chunk the run executes. The server sends the oid and the chunk and
    // NOT the title, so the name of an initiative has one source on this surface.
    attrib: string;
    // One derived sentence of context, composed server-side from counts (pkg/jarvis/attention.go).
    why: string;
    // What the decision rests on, rendered as numbered labels. Never controls: the row itself is the
    // button, and a second control inside it is the affordance defect invariant 4 names.
    cites: string[];
    // the raw wire kind and the ids an in-place Approve or Retry acts on (queueAction)
    wireKind: string;
    channelId: string;
    runId: string | null;
    phaseIdx: number;
    taskId: string;
    retry: boolean;
}

// dag-gate/dag-blocked are absent from the rail's map and fell through to the raw wire kind, which
// already reads as a label; spelled out here so every kind the server can emit has a written form.
// A queue row is the one region whose destination is not implied by what it is, and without this it has
// none: the decision a row waits on (a plan gate, an escalation, a released task) is resolved by the run
// body, so a row that cannot open its run cannot be acted on at all. A run is addressed through its channel
// because that is what a subject is — the run id rides along so the sheet lands on THAT run rather than on
// whatever the channel last showed. A triage row and a blocked chunk name no channel, and both already have
// a surface of their own, so they route by oref through the same router everything else uses.
export type QueueOpenTarget =
    | { kind: "channel"; channelId: string; runId: string | null }
    | { kind: "oref"; oref: string };

export function queueOpenTarget(nav: QueueNav | null): QueueOpenTarget | null {
    if (nav == null) {
        return null;
    }
    if (nav.kind === "channel") {
        return { kind: "channel", channelId: nav.channelId, runId: nav.runId };
    }
    return nav.oref === "" ? null : { kind: "oref", oref: nav.oref };
}

const QUEUE_KIND_LABEL: Record<string, string> = {
    gate: "gate",
    escalation: "escalation",
    ask: "ask",
    "dag-gate": "dag gate",
    "dag-blocked": "dag blocked",
    "run-land-held": "land held",
    "run-unverified": "unverified",
    "plan-gate": "plan gate",
    "radar-triage": "triage",
};

export function buildAttentionQueue(input: {
    attention: AttentionItem[];
    efforts: EffortCardModel[];
    blockers?: BlockerRow[];
}): QueueRow[] {
    // an effort the Brief is not holding (archived, or another project's) resolves to no title; the
    // chunk label still names the work, so the row keeps it rather than dropping the attribution.
    const effortTitles = new Map(input.efforts.map((e) => [e.oref.replace(/^effort:/, ""), e.title]));
    // wire order is the priority claim (gates, then escalations, then asks; oldest first inside a
    // kind — pkg/jarvis/attention.go), so this preserves it rather than re-sorting on age.
    const rows: QueueRow[] = (input.attention ?? []).map((a) => {
        const channelId = a.channelid ?? "";
        // a triage row's only destination is its report. If the kind arrived without one it falls
        // through to the channel rule below and ends up static — inventing a target would be worse than
        // saying nothing, which is the same rule the no-channel case has always followed.
        const radarORef = a.kind === "radar-triage" && a.oref != null && a.oref !== "" ? a.oref : null;
        return {
            key: a.key,
            kind: QUEUE_KIND_LABEL[a.kind] ?? a.kind,
            title: a.text,
            source: a.source,
            detail: [a.source, channelId !== "" && a.channelname ? "#" + a.channelname : null]
                .filter((s) => s != null && s !== "")
                .join(" · "),
            ts: a.waitingsince > 0 ? a.waitingsince : null,
            // a standalone item names no channel, so there is no run body to land on; it renders as
            // static info rather than a button that would navigate nowhere (NeedsRow's rule, kept).
            action: channelId !== "" || radarORef != null ? a.action : null,
            nav:
                radarORef != null
                    ? { kind: "radar", oref: radarORef }
                    : channelId !== ""
                      ? { kind: "channel", channelId, runId: a.runid != null && a.runid !== "" ? a.runid : null }
                      : null,
            tone: a.kind === "dag-blocked" ? "error" : "asking",
            attrib:
                a.effortoid != null && a.effortoid !== ""
                    ? [effortTitles.get(a.effortoid) ?? "", a.chunklabel ?? ""].filter((s) => s !== "").join(" · ")
                    : "",
            why: a.why ?? "",
            cites: a.cites ?? [],
            wireKind: a.kind,
            channelId,
            runId: a.runid || null,
            phaseIdx: a.phaseidx ?? 0,
            taskId: a.taskid ?? "",
            retry: a.retry === true,
        };
    });
    // a blocked chunk is attention the server's attention leg never sees; it has no waiting-since to
    // interleave on, so it follows the wire rows rather than competing with them for priority.
    for (const e of input.efforts) {
        for (const label of e.blockedChunks) {
            rows.push({
                key: "chunk:" + e.oref + ":" + label,
                kind: "chunk blocked",
                title: label,
                source: e.title,
                detail: e.title,
                ts: null,
                action: "Open",
                nav: { kind: "effort", oref: e.oref },
                tone: "asking",
                // a blocked chunk IS the initiative's row, so naming the initiative again beside the
                // chunk would say the same thing twice; detail already carries the title.
                attrib: "",
                why: "",
                cites: [],
                wireKind: "chunk-blocked",
                channelId: "",
                runId: null,
                phaseIdx: 0,
                taskId: "",
                retry: false,
            });
        }
    }
    // a record with blockers waits on you as much as a gate does (design L1010: everything that needs you
    // is in this one queue), so it leaves Runs and joins here, opening its record.
    for (const b of input.blockers ?? []) {
        rows.push({
            key: "blocker:" + b.oref,
            kind: "blocked",
            wireKind: "blocker",
            title: b.objective,
            source: b.project ?? "",
            detail: b.project ?? "",
            ts: b.ts,
            action: "Open",
            nav: b.oref !== "" ? { kind: "record", oref: b.oref } : null,
            tone: "asking",
            attrib: "",
            why: b.blockers,
            cites: [],
            channelId: "",
            runId: null,
            phaseIdx: 0,
            taskId: "",
            retry: false,
        });
    }
    return rows;
}

export interface QueueSummary {
    title: string;
    detail: string;
    oldestTs: number | null;
}

// the design's four kind words (design L1010-1013); every wire kind reads as one of them
export function queueKindLabel(row: QueueRow): "gate" | "ask" | "failed" | "blocked" | "triage" {
    switch (row.wireKind) {
        case "gate":
        case "plan-gate":
        case "dag-gate":
            return "gate";
        case "ask":
        case "escalation":
            return "ask";
        case "dag-blocked":
            return row.retry ? "failed" : "blocked";
        case "radar-triage":
            return "triage";
        default:
            return "blocked";
    }
}

export type QueueAct = {
    label: "Approve" | "Retry" | "Acknowledge" | "Land again" | "Open";
    kind: "approve-gate" | "approve-dag" | "retry-dag" | "ack-run" | "land-run" | "open";
};

// What the row's button does in place (design L1598-1609). Approve and Retry need the exact task or phase
// the server named; without it the row opens its run rather than guessing one.
export function queueAction(row: QueueRow): QueueAct {
    if (row.wireKind === "gate" && row.channelId !== "" && row.runId != null) {
        return { label: "Approve", kind: "approve-gate" };
    }
    if (row.wireKind === "dag-gate" && row.taskId !== "" && row.runId != null) {
        return { label: "Approve", kind: "approve-dag" };
    }
    if (row.wireKind === "dag-blocked" && row.retry && row.taskId !== "" && row.runId != null) {
        return { label: "Retry", kind: "retry-dag" };
    }
    if (row.wireKind === "run-unverified" && row.channelId !== "" && row.runId != null) {
        return { label: "Acknowledge", kind: "ack-run" };
    }
    // a held land: the retry `wsh runs land` makes, once the human has cleared the reason the row names
    if (row.wireKind === "run-land-held" && row.channelId !== "" && row.runId != null) {
        return { label: "Land again", kind: "land-run" };
    }
    return { label: "Open", kind: "open" };
}

// the rows Acknowledge all settles: exactly the ones whose own button is Acknowledge
export function ackableRuns(rows: QueueRow[]): { channelId: string; runId: string }[] {
    return rows
        .filter((r) => queueAction(r).kind === "ack-run")
        .map((r) => ({ channelId: r.channelId, runId: r.runId! }));
}

export function summarizeAttentionQueue(rows: QueueRow[], now: number): QueueSummary | null {
    if (rows.length === 0) {
        return null;
    }
    const oldestTs = rows.reduce<number | null>(
        (o, r) => (r.ts == null ? o : o == null ? r.ts : Math.min(o, r.ts)),
        null
    );
    const n = rows.length;
    const kinds = rows.map(queueKindLabel).join(" · ");
    return {
        title: `${n} ${n === 1 ? "thing is" : "things are"} waiting on you`,
        detail: oldestTs != null ? `${kinds} · oldest ${formatAge(now - oldestTs)}` : kinds,
        oldestTs,
    };
}

// needing-eyes first (blocked run / blocker / asking agent), recency within tier, identity last.
export function mergeActiveWork(input: {
    activeRuns: RunRow[];
    blockers: BlockerRow[];
    directAgents: AgentRow[];
}): ActiveWorkRow[] {
    const rows: ActiveWorkRow[] = [
        ...input.activeRuns.map((r) => ({
            key: "run:" + r.oref,
            kind: "run" as const,
            oref: r.oref,
            name: r.goal,
            meta: [r.project, r.status].filter(Boolean).join(" · "),
            chip:
                r.status === "blocked"
                    ? { label: "blocked", tone: "blocked" as const }
                    : { label: r.status || "running", tone: "running" as const },
            ts: r.ts,
        })),
        ...input.blockers.map((b) => ({
            key: "blocker:" + b.oref,
            kind: "blocker" as const,
            oref: b.oref,
            name: b.objective,
            meta: b.blockers,
            chip: b.project == null ? { label: "Unscoped record", tone: "muted" as const } : null,
            ts: b.ts,
        })),
        ...input.directAgents.map((a) => ({
            key: "agent:" + a.id,
            kind: "agent" as const,
            oref: a.oref,
            name: a.name + " · " + (a.task || a.name),
            meta: [a.runtime, a.project].filter(Boolean).join(" · "),
            chip: { label: a.state, tone: a.state === "asking" ? ("asking" as const) : ("running" as const) },
            ts: a.startedTs,
        })),
    ];
    return rows
        .sort((x, y) => {
            const s = (r: ActiveWorkRow) =>
                r.kind === "blocker" || (r.chip != null && (r.chip.tone === "blocked" || r.chip.tone === "asking"))
                    ? 0
                    : 1;
            const d = s(x) - s(y);
            if (d !== 0) {
                return d;
            }
            const t = y.ts - x.ts;
            if (t !== 0) {
                return t;
            }
            return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
        })
        .map((r, i) => ({ ...r, key: r.key + ":" + i }));
}
export interface SourceHealthSummary {
    complete: boolean;
    missingLegs: string[];
    attentionState: string;
}
export interface BriefingModel {
    activeRuns: RunRow[];
    blockers: BlockerRow[];
    directAgents: AgentRow[];
    delta: DeltaRow[];
    shipped: ShippedRow[];
    efforts: EffortCardModel[];
    health: SourceHealthSummary;
    counts: { runs: number; agents: number; delta: number; shipped: number };
}

// the ledger retains no dossier status-transition history; "Record updated · current status: X" is
// the honest shape of a dossier's UpdatedTs event (detail arrives as "status: X").
function dossierWording(detail: string | undefined): string {
    if (detail != null && detail.startsWith("status: ")) {
        return "Record updated · current status: " + detail.slice("status: ".length);
    }
    return "Record updated";
}

const DELTA_WORDING: Record<string, string> = {
    "run-created": "Run started",
    "run-done": "Run completed",
    decision: "Decision recorded",
};

// exact identity only: a delta attention event and the current attention item come from the same
// GatherAttention read, so the (ts, title, detail) triple is exact, never fuzzy.
function matchesAttention(ev: TimelineEvent, items: ActiveWorkItem[]): boolean {
    return items.some(
        (a) => a.kind === "attention" && a.ts === ev.ts && a.title === ev.title && a.detail === ev.detail
    );
}

function sortBy<T>(rows: T[], score: (r: T) => number, tsOf: (r: T) => number, idOf: (r: T) => string): T[] {
    return [...rows].sort((a, b) => {
        const s = score(a) - score(b);
        if (s !== 0) {
            return s;
        }
        const t = tsOf(b) - tsOf(a); // timestamp descending
        if (t !== 0) {
            return t;
        }
        return idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0; // stable identity
    });
}

export function projectBriefing(input: BriefingModelInput): BriefingModel {
    const { state, agents, actualCursor, queryStartedAt } = input;
    const projects = state.projects ?? [];

    // the snapshot's attention items are the delta-dedup key and nothing else — the rendered queue
    // reads the live poll (buildAttentionQueue), so these are never projected into a row.
    const attentionItems = projects.flatMap((p) => p.active ?? []).filter((a) => a.kind === "attention");

    // active runs + blocked records
    const runItems = projects.flatMap((p) => p.active ?? []).filter((a) => a.kind === "run");
    const activeRuns: RunRow[] = sortBy(
        runItems.map((a) => ({
            oref: a.navtarget ?? "run:",
            oid: (a.navtarget ?? "").replace(/^run:/, ""),
            goal: a.title,
            project: a.project,
            status:
                a.detail != null && a.detail.startsWith("status: ")
                    ? a.detail.slice("status: ".length)
                    : (a.detail ?? ""),
            workerOrefs: a.workerorefs ?? [],
            mode: a.mode ?? "",
            ts: a.ts,
        })),
        (r) => (r.status === "blocked" ? 0 : 1),
        (r) => r.ts,
        (r) => r.oref
    );

    const blockerItems = projects.flatMap((p) => p.active ?? []).filter((a) => a.kind === "blocker");
    const blockers: BlockerRow[] = sortBy(
        blockerItems.map((a) => ({
            oref: a.navtarget ?? "",
            objective: a.title,
            blockers: a.detail ?? "",
            project: (a.project ?? "") === "" ? null : a.project,
            ts: a.ts,
        })),
        () => 0,
        (b) => b.ts,
        (b) => b.oref
    );

    // direct agents: only working/asking roster rows, never terminal/background/idle; a row whose
    // tab oref belongs to an active run is represented by the Run only — no fallback dedup.
    const runWorkerOrefs = new Set(activeRuns.flatMap((r) => r.workerOrefs));
    const directAgents: AgentRow[] = sortBy(
        agents
            .filter(
                (a) =>
                    (a.state === "working" || a.state === "asking") &&
                    a.kind !== "terminal" &&
                    a.kind !== "background" &&
                    !runWorkerOrefs.has("tab:" + a.id)
            )
            .map((a) => ({
                oref: "agent:" + a.id,
                id: a.id,
                name: a.name,
                task: a.task ?? a.name,
                runtime: a.agent ?? "",
                project: a.project ?? null,
                state: a.state as "working" | "asking",
                startedTs: queryStartedAt - (a.state === "asking" ? (a.blockedMs ?? 0) : (a.activeMs ?? 0)),
            })),
        (a) => (a.state === "asking" ? 0 : 1),
        (a) => a.startedTs,
        (a) => a.id
    );

    // shipped: only the rolling seven-day window (the server may return more when the cursor is
    // older than seven days); `fresh` when the matching run-done event is in the client-side delta.
    const shippedItems = projects.flatMap((p) => p.shipped ?? []);
    const windowedShipped = shippedItems.filter((s) => s.completedts >= input.sevenDaysAgo);

    // delta: client-side window back to actualCursor (the server fetched since min(cursor, 7d)),
    // minus current-attention duplicates, minus completions promoted into the shipped section.
    const rawDelta = projects
        .flatMap((p) => p.delta ?? [])
        .filter((ev) => ev.ts >= actualCursor && ev.kind !== "session" && !matchesAttention(ev, attentionItems));
    const promotedOrefs = new Set(windowedShipped.map((s) => "run:" + s.runoid));
    const delta: DeltaRow[] = rawDelta
        .filter((ev) => ev.kind !== "run-done" || !promotedOrefs.has(ev.navtarget ?? ""))
        .map((ev) => {
            const wording = ev.kind === "dossier" ? dossierWording(ev.detail) : (DELTA_WORDING[ev.kind] ?? ev.kind);
            return {
                key: ev.kind + ":" + ev.ts + ":" + ev.title,
                ts: ev.ts,
                kind: ev.kind,
                title: ev.title,
                wording,
                detail: ev.detail ?? null,
                oref: ev.navtarget || null,
            };
        });

    const shipped: ShippedRow[] = windowedShipped.map((s) => ({
        oref: "run:" + s.runoid,
        goal: s.goal,
        project: s.project,
        summary: s.summary ?? "",
        completedTs: s.completedts,
        fresh: rawDelta.some((ev) => ev.kind === "run-done" && ev.navtarget === "run:" + s.runoid),
        hasReport: s.hasreport === true,
        effortOid: s.effortoid ?? "",
        chunkLabel: s.chunklabel ?? "",
        mode: s.mode ?? "",
    }));

    const missingLegs: string[] = [];
    if (state.sources.runs !== true) {
        missingLegs.push("Runs");
    }
    if (state.sources.dossiers !== true) {
        missingLegs.push("Records");
    }

    // efforts: non-archived only, newest-updated first (the wire already sorts; the defensive sort
    // keeps the projection total regardless of server ordering).
    const effortCards = (state.efforts ?? [])
        .filter((e) => e.status !== "archived")
        .sort((a, b) => b.updatedts - a.updatedts)
        .map(buildEffortCard);

    return {
        activeRuns,
        blockers,
        directAgents,
        delta,
        shipped,
        efforts: effortCards,
        health: { complete: missingLegs.length === 0, missingLegs, attentionState: state.sources.attention },
        counts: { runs: activeRuns.length, agents: directAgents.length, delta: delta.length, shipped: shipped.length },
    };
}
