// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's Activity region (spec 2026-11-05-jarvis-revamp-design.md decision 5): the Runs and Councils regions
// merged into one, at the top of the side column. What is going now (live runs, a direct agent at work, councils that
// run, wait on you or wait their turn) is a card, newest first; what ended without shipping in the last seven days
// (finished councils, failed or cancelled runs) is a line under `Earlier · 7 days`, five then `+N more`. Shipped runs
// stay in their own region and never show here. Runs quiet for a week fold behind `+N runs older than 7 days`.
//
// The inputs are the lines the Brief already builds: a run's `sessionLine` (with the run's mode and status, and its
// stage face when the Brief has the Run), and the council lines (`councilLines`, paired with each council's time by
// `activityCouncils`). Pure: no React.

import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { councilLines, type CouncilLine } from "./briefcouncils";
import { SEVEN_DAYS_MS } from "./briefingmodel";
import { keepsRunKind, type BriefLine, type LineTone, type RunKindFilter } from "./briefrows";

export type ActivityFilter = "all" | "orchestrator" | "quick" | "councils";
export const ACTIVITY_FILTERS: readonly ActivityFilter[] = ["all", "orchestrator", "quick", "councils"];

// Earlier's window: five lines, the rest behind "+N more"
export const EARLIER_CAP = 5;

// a run that ended without shipping; a shipped run ends "done" and is Shipped's alone
const ENDED_RUN = new Set(["failed", "cancelled"]);

export type ActivityRunInput = {
    // sessionLine's line: its id, title, target and runOid (agentId for a direct agent), and whether it is a week quiet
    line: BriefLine & { stale?: boolean };
    // the run's mode ("orchestrator", anything else a quick run); "" for a direct agent
    mode: string;
    // the run's status; failed and cancelled end it
    status: string;
    // when it started (or ended, for an ended run the caller has the time of): what orders and cuts it
    ts: number;
    // the run's face when the Brief has its Run (runRowFace): the stage word, its tone, `runtime · project`, and
    // whether the run is paused (its card then offers Resume)
    face?: { stage: string; stageTone: LineTone; meta: string; paused?: boolean };
};

export type ActivityCouncilInput = { line: CouncilLine; ts: number };

export type ActivitySource = "run" | "agent" | "council";

export type ActivityItem = {
    id: string;
    source: ActivitySource;
    // the card's kind: "run · orchestrator", "run · quick", "run · agent", "council"
    kind: string;
    // Earlier's kind chip: "orchestrator", "quick", "council"
    chip: string;
    stage: string;
    stageTone: LineTone;
    title: string;
    // the card's meta line, `runtime · project · age`
    meta: string;
    age: string;
    ts: number;
    // the line it came from: what the row opens (target, runOid) and what j/k walks
    line: BriefLine;
    // the council's id, for the council sheet; "" for a run
    councilId: string;
    // a paused run (memory regulation): its card marks it and offers Resume
    paused: boolean;
};

export type ActivityCounts = Record<ActivityFilter, number>;

export type ActivityModel = {
    // newest first
    live: ActivityItem[];
    // Earlier's window: the first EARLIER_CAP lines unless it is open
    earlier: ActivityItem[];
    // what the window hid
    earlierMore: number;
    // every Earlier line, the window's source
    earlierAll: ActivityItem[];
    // runs quiet past seven days: the toggle's count, and its lines when it is open
    older: ActivityItem[];
    // what each tab counts: live and Earlier, never the folded older runs
    counts: ActivityCounts;
};

const joined = (parts: string[]) => parts.filter((p) => p !== "").join(" · ");

// Pure: a council line with its council's last-saved time, which orders it against the runs. `null` is not loaded yet.
export function activityCouncils(
    councils: readonly Council[] | null | undefined,
    projects: Record<string, { path?: string }> | null,
    now: number
): ActivityCouncilInput[] {
    const byId = new Map((councils ?? []).map((c) => [c.id, c]));
    return councilLines(councils, projects, now).map((line) => {
        const c = byId.get(line.id.slice("councils:".length));
        return { line, ts: c != null ? c.updated || c.created : 0 };
    });
}

function runItem(r: ActivityRunInput, now: number): ActivityItem {
    const agent = r.line.agentId != null && r.line.runOid == null;
    const orch = r.mode === "orchestrator";
    const sort = agent ? "agent" : orch ? "orchestrator" : "quick";
    const age = formatAge(now - r.ts);
    return {
        id: r.line.id,
        source: agent ? "agent" : "run",
        kind: "run · " + sort,
        chip: sort,
        stage: r.face?.stage ?? (ENDED_RUN.has(r.status) ? r.status : r.line.state),
        stageTone: r.face?.stageTone ?? (ENDED_RUN.has(r.status) ? "error" : r.line.stateTone),
        title: r.line.title,
        meta: joined([r.face?.meta ?? r.line.meta, age]),
        age,
        ts: r.ts,
        line: r.line,
        councilId: "",
        paused: r.face?.paused === true,
    };
}

function councilItem(c: ActivityCouncilInput): ActivityItem {
    return {
        id: c.line.id,
        source: "council",
        kind: "council",
        chip: "council",
        stage: c.line.state,
        stageTone: c.line.stateTone,
        title: c.line.title,
        meta: joined([c.line.meta, c.line.age]),
        age: c.line.age,
        ts: c.ts,
        line: c.line,
        councilId: c.line.id.slice("councils:".length),
        paused: false,
    };
}

// Pure: whether a tab keeps an item. orchestrator and quick keep runs of that kind (a direct agent is neither),
// councils keeps councils only.
export function keepsActivity(filter: ActivityFilter, item: Pick<ActivityItem, "source" | "chip">): boolean {
    if (filter === "all") {
        return true;
    }
    if (filter === "councils") {
        return item.source === "council";
    }
    return item.source === "run" && item.chip === filter;
}

// Pure: the run filter a tab means, for what still filters by run kind (the run sheet, the queue). councils keeps no
// run: null.
export function activityRunKind(filter: ActivityFilter): RunKindFilter | null {
    return filter === "councils" ? null : filter;
}

// Pure: whether Shipped keeps a run of this mode under the tab. Under councils it keeps none, and Shipped says its
// no-match sentence.
export function keepsShipped(filter: ActivityFilter, mode: string): boolean {
    const kind = activityRunKind(filter);
    return kind != null && keepsRunKind(kind, mode);
}

// Pure: the `Queued N` line's count under the tab, from the queued plans' modes.
export function queuedCount(modes: readonly string[], filter: ActivityFilter): number {
    const kind = activityRunKind(filter);
    return kind == null ? 0 : modes.filter((m) => keepsRunKind(kind, m)).length;
}

const newestFirst = (a: ActivityItem, b: ActivityItem) => b.ts - a.ts;

/** Pure: the region. `earlierOpen` lifts Earlier's window of five. */
export function buildActivity(input: {
    runs: readonly ActivityRunInput[];
    councils: readonly ActivityCouncilInput[];
    filter: ActivityFilter;
    earlierOpen: boolean;
    now: number;
}): ActivityModel {
    const { now } = input;
    const live: ActivityItem[] = [];
    const earlier: ActivityItem[] = [];
    const older: ActivityItem[] = [];
    for (const r of input.runs) {
        const item = runItem(r, now);
        const ended = ENDED_RUN.has(r.status);
        if (r.line.stale === true || (ended && now - r.ts > SEVEN_DAYS_MS)) {
            older.push(item);
        } else if (ended) {
            earlier.push(item);
        } else {
            live.push(item);
        }
    }
    for (const c of input.councils) {
        const item = councilItem(c);
        // councilLines marks running, awaiting-you and queued councils live (isLiveCouncil)
        if (c.line.live) {
            live.push(item);
        } else if (now - c.ts <= SEVEN_DAYS_MS) {
            earlier.push(item);
        }
    }
    const counts = Object.fromEntries(
        ACTIVITY_FILTERS.map((f) => [f, [...live, ...earlier].filter((i) => keepsActivity(f, i)).length])
    ) as ActivityCounts;
    const keep = (i: ActivityItem) => keepsActivity(input.filter, i);
    const earlierAll = earlier.filter(keep).sort(newestFirst);
    const window = input.earlierOpen ? earlierAll : earlierAll.slice(0, EARLIER_CAP);
    return {
        live: live.filter(keep).sort(newestFirst),
        earlier: window,
        earlierMore: earlierAll.length - window.length,
        earlierAll,
        older: older.filter(keep).sort(newestFirst),
        counts,
    };
}

/** Pure: the head's `N live`. */
export function activityMeta(model: Pick<ActivityModel, "live">): string {
    return `${model.live.length} live`;
}
