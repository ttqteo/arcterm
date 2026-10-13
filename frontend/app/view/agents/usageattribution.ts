// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure attribution for the Usage surface's By work lens: what the window's usage was spent on. Joins
// the usage buckets (keyed by session) with the session directory GetUsageStatsCommand returns into
// work items (a run with every session it started, or a session no run started), groups them into
// projects, and derives each scope's split and ranked list. A scope's totals are not computed here:
// scopeBuckets narrows the buckets and the surface feeds them to aggregateBuckets, so the header,
// cards, chart and model groups stay one aggregation. Pure module: no React or Wave runtime imports.

import { providerLabel } from "./cockpitrailmodel";
import { priceFor } from "./usagepricing";
import { CLASS_FILL, bucketSpend, bucketTokens, pctStr, usd, type ClassUsage } from "./usagestats";

export const ALL_SCOPE = "all";
export const LIST_COLLAPSED_ROWS = 8;
export const LIST_EXPANDED_ROWS = 25;
const PROJECT_MIN_SHARE_PCT = 1;
const MAX_PROJECT_ROWS = 8;

export type WorkKind = "orchestrator" | "quick" | "session";

export interface Amount {
    tokens: number;
    spendUsd: number; // api-equivalent estimate, priced models only
    pricedTokens: number;
    reportedCostUsd?: number; // set only where a bucket reports a cost
}

export interface WorkSession extends Amount {
    key: string; // `${harness}:${session}`
    harness: string;
    session: string;
    title: string;
    role: string; // "" outside a run
    buckets: UsageBucket[];
}

export interface WorkItem extends Amount {
    key: string; // `run:<runid>` | `session:<harness>:<session>`
    kind: WorkKind;
    title: string;
    project: string; // repo root path, "" when unknown
    projectLabel: string;
    runId?: string;
    channelId?: string;
    sessions: WorkSession[]; // ranked
    harnesses: string[];
    buckets: UsageBucket[];
}

export interface ProjectUsage extends Amount {
    key: string; // repo root path
    label: string; // folder name
    count: number; // runs and sessions
    sharePct: number; // of the window's estimated spend
}

export interface OtherFolders {
    count: number; // folders folded off the rail; work with no folder at all counts as one
    tokens: number;
    spendUsd: number;
}

export interface Attribution {
    items: WorkItem[]; // ranked
    projects: ProjectUsage[]; // the rail rows, ranked
    other: OtherFolders;
    total: Amount;
    harnesses: string[];
}

export type WorkScope = { kind: "all" } | { kind: "project"; project: ProjectUsage } | { kind: "item"; item: WorkItem };

export interface SplitPart {
    key: string;
    label: string;
    fill: string; // tailwind bg utility over an existing @theme token
    tokens: number;
    spendUsd: number;
}

export interface WorkSplit {
    parts: SplitPart[];
    note: string;
}

export interface WorkRow {
    key: string;
    title: string;
    sub: string;
    isRun: boolean;
    tokens: number;
    spendUsd: number;
    cost: number; // what the row shows: the estimate, or the reported cost where nothing is priced
    reported: boolean;
}

export interface WorkList {
    title: string;
    meta: string;
    summary?: string;
    rows: WorkRow[]; // ranked, uncapped
    nav: boolean; // a row opens its item
}

export interface WorkListPage {
    rows: (WorkRow & { pct: number })[];
    hasMore: boolean;
    moreLabel: string;
}

const KIND_LABEL: Record<WorkKind, string> = {
    orchestrator: "orchestrator run",
    quick: "quick run",
    session: "session",
};
const KIND_ORDER: WorkKind[] = ["orchestrator", "quick", "session"];
const KIND_SPLIT_LABEL: Record<WorkKind, string> = {
    orchestrator: "Orchestrator runs",
    quick: "Quick runs",
    session: "Sessions no run started",
};
// categorical parts of a work split, cycled; "other folders" takes the grey the cache-read class uses
const PART_FILLS = [
    "bg-accent",
    "bg-success",
    "bg-warning",
    "bg-accent-300",
    "bg-provider-opencode",
    "bg-provider-claude",
];
const OTHER_FILL = "bg-cacheread";

export function kindLabel(kind: WorkKind): string {
    return KIND_LABEL[kind];
}

export function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

function joinParts(parts: string[]): string {
    return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts.join("");
}

function bySpend(a: Amount, b: Amount): number {
    return b.spendUsd - a.spendUsd || b.tokens - a.tokens;
}

function amountOf(buckets: UsageBucket[]): Amount {
    const out: Amount = { tokens: 0, spendUsd: 0, pricedTokens: 0 };
    for (const b of buckets) {
        const tokens = bucketTokens(b);
        out.tokens += tokens;
        out.spendUsd += bucketSpend(b);
        if (priceFor(b.model) != null) {
            out.pricedTokens += tokens;
        }
        if (b.reportedcostusd !== undefined) {
            out.reportedCostUsd = (out.reportedCostUsd ?? 0) + b.reportedcostusd;
        }
    }
    return out;
}

function sumAmounts(amounts: Amount[]): Amount {
    const out: Amount = { tokens: 0, spendUsd: 0, pricedTokens: 0 };
    for (const a of amounts) {
        out.tokens += a.tokens;
        out.spendUsd += a.spendUsd;
        out.pricedTokens += a.pricedTokens;
        if (a.reportedCostUsd !== undefined) {
            out.reportedCostUsd = (out.reportedCostUsd ?? 0) + a.reportedCostUsd;
        }
    }
    return out;
}

function sessionKey(harness: string, session: string): string {
    return `${harness}:${session}`;
}

export function folderName(path: string): string {
    const parts = path.split(/[\\/]/).filter((p) => p !== "");
    return parts.length > 0 ? parts[parts.length - 1] : path;
}

// a run's project path and a transcript's cwd can name one repo with different slashes or drive-letter
// case on windows; without this they would be two projects
function projectKey(path: string): string {
    const slashed = path.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-z]:/.test(slashed) ? slashed.charAt(0).toUpperCase() + slashed.slice(1) : slashed;
}

function makeItem(key: string, members: { session: WorkSession; meta?: UsageSessionMeta }[]): WorkItem {
    const sessions = members.map((m) => m.session).sort(bySpend);
    const first = (pick: (m: UsageSessionMeta) => string | undefined): string =>
        members.map((m) => (m.meta ? pick(m.meta) : undefined)).find((v) => v) ?? "";
    const runId = first((m) => m.runid);
    const lead = sessions.find((s) => s.role === "lead") ?? sessions[0];
    const project = projectKey(first((m) => m.project));
    return {
        key,
        kind: runId === "" ? "session" : first((m) => m.runmode) === "quick" ? "quick" : "orchestrator",
        title: first((m) => m.rungoal) || lead.title,
        project,
        projectLabel: project === "" ? "" : folderName(project),
        runId: runId || undefined,
        channelId: first((m) => m.channelid) || undefined,
        sessions,
        harnesses: [...new Set(sessions.map((s) => s.harness))],
        buckets: sessions.flatMap((s) => s.buckets),
        ...sumAmounts(sessions),
    };
}

// A bucket whose session the directory does not list still counts, as a session with no project. A
// session that billed nothing and reported nothing (a request that failed before any token) is no work.
export function buildAttribution(buckets: UsageBucket[], sessions: UsageSessionMeta[]): Attribution {
    const directory = new Map(sessions.map((s) => [sessionKey(s.harness, s.session), s]));
    const bySession = new Map<string, UsageBucket[]>();
    for (const b of buckets) {
        const key = sessionKey(b.harness, b.session ?? "");
        const held = bySession.get(key);
        if (held) {
            held.push(b);
        } else {
            bySession.set(key, [b]);
        }
    }

    const groups = new Map<string, { session: WorkSession; meta?: UsageSessionMeta }[]>();
    for (const [key, held] of bySession) {
        const amount = amountOf(held);
        if (amount.tokens === 0 && !amount.reportedCostUsd) {
            continue;
        }
        const { harness } = held[0];
        const id = held[0].session ?? "";
        const meta = directory.get(key);
        const session: WorkSession = {
            key,
            harness,
            session: id,
            title: meta?.title || id || "no session id",
            role: meta?.role ?? "",
            buckets: held,
            ...amount,
        };
        const itemKey = meta?.runid ? `run:${meta.runid}` : `session:${key}`;
        const members = groups.get(itemKey);
        if (members) {
            members.push({ session, meta });
        } else {
            groups.set(itemKey, [{ session, meta }]);
        }
    }

    const items = [...groups].map(([key, members]) => makeItem(key, members)).sort(bySpend);
    const total = sumAmounts(items);

    const byProject = new Map<string, WorkItem[]>();
    for (const it of items) {
        if (it.project === "") {
            continue;
        }
        const held = byProject.get(it.project);
        if (held) {
            held.push(it);
        } else {
            byProject.set(it.project, [it]);
        }
    }
    const all: ProjectUsage[] = [...byProject]
        .map(([key, held]) => {
            const amount = sumAmounts(held);
            return {
                key,
                label: folderName(key),
                count: held.length,
                sharePct: total.spendUsd > 0 ? (amount.spendUsd / total.spendUsd) * 100 : 0,
                ...amount,
            };
        })
        .sort(bySpend);
    // compared as spend against the total, not as a rounded percentage, so exactly 1% qualifies
    const qualifies = (p: ProjectUsage) => p.spendUsd * 100 >= total.spendUsd * PROJECT_MIN_SHARE_PCT;
    const projects = all.filter(qualifies).slice(0, MAX_PROJECT_ROWS);
    const railed = sumAmounts(projects);
    const unfiled = items.some((it) => it.project === "") ? 1 : 0;

    return {
        items,
        projects,
        other: {
            count: all.length - projects.length + unfiled,
            tokens: total.tokens - railed.tokens,
            spendUsd: Math.max(0, total.spendUsd - railed.spendUsd),
        },
        total,
        harnesses: [...new Set(items.flatMap((it) => it.harnesses))],
    };
}

// scopeKey is "all" or a project key; a project off the rail, or an item the window no longer holds,
// resolves to the scope above it.
export function resolveScope(attr: Attribution, scopeKey: string, itemKey: string | null): WorkScope {
    const item = itemKey != null ? attr.items.find((it) => it.key === itemKey) : undefined;
    if (item) {
        return { kind: "item", item };
    }
    const project = attr.projects.find((p) => p.key === scopeKey);
    return project ? { kind: "project", project } : { kind: "all" };
}

// the value of data-usage-detail
export function scopeId(scope: WorkScope): string {
    if (scope.kind === "item") {
        return scope.item.key;
    }
    return scope.kind === "project" ? `project:${scope.project.key}` : ALL_SCOPE;
}

export function scopeItems(attr: Attribution, scope: WorkScope): WorkItem[] {
    if (scope.kind === "item") {
        return [scope.item];
    }
    return scope.kind === "project" ? attr.items.filter((it) => it.project === scope.project.key) : attr.items;
}

// All usage keeps every bucket, including the ones no work item holds, so it equals today's totals.
export function scopeBuckets(buckets: UsageBucket[], attr: Attribution, scope: WorkScope): UsageBucket[] {
    return scope.kind === "all" ? buckets : scopeItems(attr, scope).flatMap((it) => it.buckets);
}

// the rail scope a drilled item sits under: its project when the rail shows it, else All usage
export function itemScopeKey(attr: Attribution, item: WorkItem): string {
    return attr.projects.some((p) => p.key === item.project) ? item.project : ALL_SCOPE;
}

export function scopeName(attr: Attribution, scopeKey: string): string {
    return attr.projects.find((p) => p.key === scopeKey)?.label ?? "All usage";
}

interface KindCount {
    count: number;
    tokens: number;
    spendUsd: number;
}

function kindCounts(items: WorkItem[]): Record<WorkKind, KindCount> {
    const out: Record<WorkKind, KindCount> = {
        orchestrator: { count: 0, tokens: 0, spendUsd: 0 },
        quick: { count: 0, tokens: 0, spendUsd: 0 },
        session: { count: 0, tokens: 0, spendUsd: 0 },
    };
    for (const it of items) {
        out[it.kind].count++;
        out[it.kind].tokens += it.tokens;
        out[it.kind].spendUsd += it.spendUsd;
    }
    return out;
}

function classParts(classes: ClassUsage[]): SplitPart[] {
    return classes.map((c) => ({
        key: c.cls,
        label: c.label,
        fill: CLASS_FILL[c.cls],
        tokens: c.tokens,
        spendUsd: c.spendUsd,
    }));
}

// today's token-class split, for a provider page and for a single session
export function classSplit(classes: ClassUsage[]): WorkSplit {
    const tokens = classes.reduce((s, c) => s + c.tokens, 0);
    const cacheRead = classes.find((c) => c.cls === "cacheRead")?.tokens ?? 0;
    return {
        parts: classParts(classes),
        note: `${pctStr(tokens > 0 ? (cacheRead / tokens) * 100 : 0)} of the token count is cache reads, so a single “tokens” number misleads. Cache reads price at a fraction of input, so the two bars tell different stories.`,
    };
}

function roleSplit(item: WorkItem): WorkSplit {
    const roles = new Map<string, WorkSession[]>();
    for (const s of item.sessions) {
        const role = s.role || "session";
        const held = roles.get(role);
        if (held) {
            held.push(s);
        } else {
            roles.set(role, [s]);
        }
    }
    const parts = [...roles]
        .map(([role, held]) => ({ role, count: held.length, ...sumAmounts(held) }))
        .sort(bySpend)
        .map((r, i) => ({
            key: r.role,
            label: plural(r.count, r.role, `${r.role}s`),
            fill: PART_FILLS[i % PART_FILLS.length],
            tokens: r.tokens,
            spendUsd: r.spendUsd,
        }));
    return {
        parts,
        note: "How this run divides between its lead, its workers and the sessions that checked them. The two bars differ where a role runs a cheaper model or reads more from cache.",
    };
}

// Where it goes, by the next level down. `classes` is the scope aggregate's token-class split, used
// where there is no level below: a single session, and a run of one session.
export function scopeSplit(attr: Attribution, scope: WorkScope, classes: ClassUsage[]): WorkSplit {
    if (scope.kind === "item") {
        return scope.item.sessions.length > 1 ? roleSplit(scope.item) : classSplit(classes);
    }
    if (scope.kind === "project") {
        const kinds = kindCounts(scopeItems(attr, scope));
        return {
            parts: KIND_ORDER.filter((k) => kinds[k].count > 0).map((k) => ({
                key: k,
                label: `${KIND_SPLIT_LABEL[k]} · ${kinds[k].count}`,
                fill: PART_FILLS[KIND_ORDER.indexOf(k)],
                tokens: kinds[k].tokens,
                spendUsd: kinds[k].spendUsd,
            })),
            note: "How this project divides between orchestrator runs, quick runs and sessions no run started.",
        };
    }
    const parts: SplitPart[] = attr.projects.map((p, i) => ({
        key: p.key,
        label: p.label,
        fill: PART_FILLS[i % PART_FILLS.length],
        tokens: p.tokens,
        spendUsd: p.spendUsd,
    }));
    if (attr.other.count > 0) {
        parts.push({
            key: "other",
            label: plural(attr.other.count, "other folder", "other folders"),
            fill: OTHER_FILL,
            tokens: attr.other.tokens,
            spendUsd: attr.other.spendUsd,
        });
    }
    return {
        parts,
        note: "How usage divides between projects. A project is the repo a run was started in, or the folder a session ran in, with worktrees folded into their repo.",
    };
}

function shownCost(a: Amount): { cost: number; reported: boolean } {
    const reported = a.pricedTokens === 0 && a.reportedCostUsd !== undefined;
    return { cost: reported ? a.reportedCostUsd! : a.spendUsd, reported };
}

function itemRow(attr: Attribution, it: WorkItem, withProject: boolean): WorkRow {
    const parts =
        withProject && it.projectLabel !== "" ? [it.projectLabel, KIND_LABEL[it.kind]] : [KIND_LABEL[it.kind]];
    if (it.kind !== "session" && it.sessions.length > 1) {
        parts.push(`${it.sessions.length} sessions`);
    }
    if (attr.harnesses.length > 1) {
        parts.push(it.harnesses.map(providerLabel).join(" + "));
    }
    return {
        key: it.key,
        title: it.title,
        sub: parts.join(" · "),
        isRun: it.kind !== "session",
        tokens: it.tokens,
        spendUsd: it.spendUsd,
        ...shownCost(it),
    };
}

// The one ranked list of a By work page, or null where the page has none (a single session, a run of
// one session, an empty window).
export function scopeList(attr: Attribution, scope: WorkScope, windowLabel: string): WorkList | null {
    if (scope.kind === "item") {
        const { sessions } = scope.item;
        if (sessions.length <= 1) {
            return null;
        }
        return {
            title: "Sessions in this run",
            meta: plural(sessions.length, "session", "sessions"),
            nav: false,
            rows: sessions.map((s) => ({
                key: s.key,
                title: s.title,
                sub: `${s.role || "session"} · ${providerLabel(s.harness)}`,
                isRun: false,
                tokens: s.tokens,
                spendUsd: s.spendUsd,
                ...shownCost(s),
            })),
        };
    }
    const items = scopeItems(attr, scope);
    if (items.length === 0) {
        return null;
    }
    const kinds = kindCounts(items);
    const said: string[] = [];
    if (kinds.orchestrator.count > 0) {
        const n = plural(kinds.orchestrator.count, "orchestrator run", "orchestrator runs");
        said.push(`${n} took ≈ ${usd(kinds.orchestrator.spendUsd)}`);
    }
    if (kinds.quick.count > 0) {
        said.push(`${plural(kinds.quick.count, "quick run", "quick runs")} ≈ ${usd(kinds.quick.spendUsd)}`);
    }
    if (kinds.session.count > 0) {
        const n = plural(kinds.session.count, "session", "sessions");
        said.push(`${n} no run started ≈ ${usd(kinds.session.spendUsd)}`);
    }
    return {
        title: scope.kind === "project" ? "Runs and sessions" : "Spent on",
        meta: `${plural(items.length, "run or session", "runs and sessions")} · ${windowLabel}`,
        summary: `${joinParts(said)}. A run counts its lead, workers and reviewers together; open one to see it the same way as this page.`,
        nav: true,
        rows: items.map((it) => itemRow(attr, it, scope.kind === "all")),
    };
}

// Eight rows, or up to twenty-five expanded. A row's bar is its spend against the top row shown.
export function listPage(list: WorkList, expanded: boolean): WorkListPage {
    const total = list.rows.length;
    const shown = list.rows.slice(0, expanded ? LIST_EXPANDED_ROWS : LIST_COLLAPSED_ROWS);
    const top = shown.length > 0 ? Math.max(shown[0].cost, 0.0001) : 1;
    const canShow = Math.min(total, LIST_EXPANDED_ROWS);
    return {
        rows: shown.map((r) => ({ ...r, pct: Math.min(100, Math.max(1, Math.round((r.cost / top) * 100))) })),
        hasMore: total > LIST_COLLAPSED_ROWS,
        moreLabel: expanded
            ? `Show top ${LIST_COLLAPSED_ROWS}`
            : canShow < total
              ? `Show top ${canShow} of ${total}`
              : `Show all ${total}`,
    };
}

export function otherFoldersText(other: OtherFolders): string {
    const one = other.count === 1;
    return `${plural(other.count, "other folder", "other folders")} ${one ? "holds" : "hold"} ≈ ${usd(other.spendUsd)}${one ? "" : " between them, each"} under 1% of spend. ${one ? "Its" : "Their"} runs and sessions still rank under All usage.`;
}
