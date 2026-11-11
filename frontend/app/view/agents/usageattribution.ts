// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure attribution for the Usage surface's By work lens: what the window's usage was spent on. Joins
// the usage buckets (keyed by session) with the session directory GetUsageStatsCommand returns into
// work items (a run with every session it started, or a session no run started), groups them into
// projects and initiatives, and derives each scope's split and ranked list. A scope's totals are not
// computed here: scopeBuckets narrows the buckets and the surface feeds them to aggregateBuckets, so the
// header, cards, chart and model groups stay one aggregation. Pure module: no React or Wave runtime imports.

import { providerLabel } from "./cockpitrailmodel";
import { priceFor } from "./usagepricing";
import { CLASS_FILL, bucketSpend, bucketTokens, pctStr, usd, type ClassUsage } from "./usagestats";

export const ALL_SCOPE = "all";
export const LIST_COLLAPSED_ROWS = 8;
export const LIST_EXPANDED_ROWS = 25;
// the ranked list's pages: eight rows, then this many more per "Show more" (listPageShown)
export const LIST_PAGE_STEP = 25;
const PROJECT_MIN_SHARE_PCT = 1;
const MAX_PROJECT_ROWS = 8;
const MAX_INITIATIVE_ROWS = 6;
const EFFORT_SCOPE_PREFIX = "effort:";
const EFFORT_LABEL_CHARS = 8;

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
    taskLabel: string; // "<taskid> · <tasktitle>" for a run's task session, else ""
    role: string; // "" outside a run
    buckets: UsageBucket[];
}

export interface WorkItem extends Amount {
    key: string; // `run:<runid>` | `session:<harness>:<session>`
    kind: WorkKind;
    title: string;
    project: string; // repo root path, "" when unknown
    projectLabel: string;
    effort: string; // initiative oid, "" when none
    runId?: string;
    channelId?: string;
    sessions: WorkSession[]; // ranked
    harnesses: string[];
    buckets: UsageBucket[];
}

export interface ProjectUsage extends Amount {
    key: string; // repo root path
    label: string; // the registered project name when the directory gives one, else the folder name
    count: number; // runs and sessions
    sharePct: number; // of the window's estimated spend
    fill: string; // its graph lane, shared by its card dot and its split row
}

export interface InitiativeUsage extends Amount {
    key: string; // `effort:<oid>`
    oid: string;
    label: string;
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
    initiatives: InitiativeUsage[]; // ranked
    other: OtherFolders;
    total: Amount;
    harnesses: string[];
}

export type WorkScope =
    | { kind: "all" }
    | { kind: "project"; project: ProjectUsage }
    | { kind: "initiative"; initiative: InitiativeUsage }
    | { kind: "item"; item: WorkItem };

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
    unpriced: boolean; // tokens, but none priced and no reported cost: the estimate means nothing
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

// the list as the surface pages it (listPageShown): rows plus the labels of the two buttons
export interface WorkListShown {
    rows: (WorkRow & { pct: number })[];
    moreLabel?: string; // set while rows remain
    lessLabel?: string; // set once more than the collapsed rows show
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
// categorical parts by position (DESIGN.md: graph lanes are positional, never identity); written out
// whole so tailwind sees each class. Past the sixth, and for "other folders", the fold grey.
const LANE_FILLS = [
    "bg-graphlane-1",
    "bg-graphlane-2",
    "bg-graphlane-3",
    "bg-graphlane-4",
    "bg-graphlane-5",
    "bg-graphlane-6",
];
export const FOLD_FILL = "bg-graphlane-fold";

export function laneFill(position: number): string {
    return LANE_FILLS[position] ?? FOLD_FILL;
}

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

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
    const held = map.get(key);
    if (held) {
        held.push(value);
    } else {
        map.set(key, [value]);
    }
}

interface Member {
    session: WorkSession;
    meta?: UsageSessionMeta; // the session's own directory entry
    place?: UsageSessionMeta; // the entry that places the item: the lead's for a folded brainstorm session
}

// A brainstorm's builder check or judge joins the work of the agent it was started for: that agent's run
// when the directory places the agent in one, else the agent's session.
function placeOf(
    directory: Map<string, UsageSessionMeta>,
    key: string,
    meta: UsageSessionMeta | undefined
): { itemKey: string; place?: UsageSessionMeta } {
    if (meta?.leadsession) {
        const leadKey = sessionKey(meta.leadharness || meta.harness, meta.leadsession);
        const lead = directory.get(leadKey);
        return lead?.runid
            ? { itemKey: `run:${lead.runid}`, place: lead }
            : { itemKey: `session:${leadKey}`, place: lead ?? meta };
    }
    return { itemKey: meta?.runid ? `run:${meta.runid}` : `session:${key}`, place: meta };
}

type FirstOf = (pick: (m: UsageSessionMeta) => string | undefined) => string;

// A session item takes its lead's title, else its costliest session's. A run item takes its effort chunk,
// else its lead's scanned title (a quick run's lead is its own session), else its goal; only a title the
// directory gave counts there, never the id fallback.
function itemTitle(key: string, kind: WorkKind, members: Member[], sessions: WorkSession[], first: FirstOf): string {
    if (kind === "session") {
        return (sessions.find((s) => `session:${s.key}` === key) ?? sessions[0]).title;
    }
    const lead =
        members.find((m) => m.meta?.role === "lead") ??
        (kind === "quick" ? members.find((m) => m.meta?.runid) : undefined);
    return (
        first((m) => m.runchunk) ||
        lead?.meta?.title ||
        first((m) => m.rungoal) ||
        (sessions.find((s) => s.role === "lead") ?? sessions[0]).title
    );
}

function makeItem(key: string, members: Member[]): WorkItem {
    const sessions = members.map((m) => m.session).sort(bySpend);
    const first: FirstOf = (pick) => members.map((m) => (m.place ? pick(m.place) : undefined)).find((v) => v) ?? "";
    const runId = first((m) => m.runid);
    const kind: WorkKind = runId === "" ? "session" : first((m) => m.runmode) === "quick" ? "quick" : "orchestrator";
    const project = projectKey(first((m) => m.project));
    return {
        key,
        kind,
        title: itemTitle(key, kind, members, sessions, first),
        project,
        projectLabel: project === "" ? "" : folderName(project),
        effort: members.map((m) => m.meta?.effort).find((v) => v) ?? "",
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
export function buildAttribution(
    buckets: UsageBucket[],
    sessions: UsageSessionMeta[],
    efforts: UsageEffort[] = []
): Attribution {
    const directory = new Map(sessions.map((s) => [sessionKey(s.harness, s.session), s]));
    const bySession = new Map<string, UsageBucket[]>();
    for (const b of buckets) {
        pushTo(bySession, sessionKey(b.harness, b.session ?? ""), b);
    }

    const groups = new Map<string, Member[]>();
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
            taskLabel: meta?.taskid && meta.tasktitle ? `${meta.taskid} · ${meta.tasktitle}` : "",
            role: meta?.role ?? "",
            buckets: held,
            ...amount,
        };
        const { itemKey, place } = placeOf(directory, key, meta);
        pushTo(groups, itemKey, { session, meta, place });
    }

    const items = [...groups].map(([key, members]) => makeItem(key, members)).sort(bySpend);
    const total = sumAmounts(items);
    const shareOf = (a: Amount) => (total.spendUsd > 0 ? (a.spendUsd / total.spendUsd) * 100 : 0);

    const byProject = new Map<string, WorkItem[]>();
    const byEffort = new Map<string, WorkItem[]>();
    for (const it of items) {
        if (it.project !== "") {
            pushTo(byProject, it.project, it);
        }
        if (it.effort !== "") {
            pushTo(byEffort, it.effort, it);
        }
    }
    // a registered project keeps the name it was registered under; any other is its folder name
    const names = new Map(
        sessions.filter((s) => s.project && s.projectname).map((s) => [projectKey(s.project!), s.projectname!])
    );
    const labelOf = (key: string) => names.get(key) ?? folderName(key);
    for (const it of items) {
        it.projectLabel = it.project === "" ? "" : labelOf(it.project);
    }
    const all = [...byProject]
        .map(([key, held]) => {
            const amount = sumAmounts(held);
            return { key, label: labelOf(key), count: held.length, sharePct: shareOf(amount), ...amount };
        })
        .sort(bySpend);
    // compared as spend against the total, not as a rounded percentage, so exactly 1% qualifies
    const qualifies = (p: Amount) => p.spendUsd * 100 >= total.spendUsd * PROJECT_MIN_SHARE_PCT;
    const projects: ProjectUsage[] = all
        .filter(qualifies)
        .slice(0, MAX_PROJECT_ROWS)
        .map((p, i) => ({ ...p, fill: laneFill(i) }));
    const railed = sumAmounts(projects);
    const unfiled = items.some((it) => it.project === "") ? 1 : 0;

    const titles = new Map(efforts.map((e) => [e.oid, e.title]));
    const initiatives: InitiativeUsage[] = [...byEffort]
        .map(([oid, held]) => {
            const amount = sumAmounts(held);
            return {
                key: `${EFFORT_SCOPE_PREFIX}${oid}`,
                oid,
                label: titles.get(oid) || oid.slice(0, EFFORT_LABEL_CHARS),
                count: held.length,
                sharePct: shareOf(amount),
                ...amount,
            };
        })
        .sort(bySpend)
        .slice(0, MAX_INITIATIVE_ROWS);

    return {
        items,
        projects,
        initiatives,
        other: {
            count: all.length - projects.length + unfiled,
            tokens: total.tokens - railed.tokens,
            spendUsd: Math.max(0, total.spendUsd - railed.spendUsd),
        },
        total,
        harnesses: [...new Set(items.flatMap((it) => it.harnesses))],
    };
}

// scopeKey is "all", a project key or an initiative key (`effort:<oid>`; project keys are paths, so the
// two never collide); a scope off the rail, or an item the window no longer holds, resolves to the scope
// above it.
export function resolveScope(attr: Attribution, scopeKey: string, itemKey: string | null): WorkScope {
    const item = itemKey != null ? attr.items.find((it) => it.key === itemKey) : undefined;
    if (item) {
        return { kind: "item", item };
    }
    const project = attr.projects.find((p) => p.key === scopeKey);
    if (project) {
        return { kind: "project", project };
    }
    const initiative = attr.initiatives.find((i) => i.key === scopeKey);
    return initiative ? { kind: "initiative", initiative } : { kind: "all" };
}

// the value of data-usage-detail
export function scopeId(scope: WorkScope): string {
    switch (scope.kind) {
        case "item":
            return scope.item.key;
        case "project":
            return `project:${scope.project.key}`;
        case "initiative":
            return scope.initiative.key;
        default:
            return ALL_SCOPE;
    }
}

export function scopeItems(attr: Attribution, scope: WorkScope): WorkItem[] {
    switch (scope.kind) {
        case "item":
            return [scope.item];
        case "project":
            return attr.items.filter((it) => it.project === scope.project.key);
        case "initiative":
            return attr.items.filter((it) => it.effort === scope.initiative.oid);
        default:
            return attr.items;
    }
}

// All usage keeps every bucket, including the ones no work item holds, so it equals today's totals.
export function scopeBuckets(buckets: UsageBucket[], attr: Attribution, scope: WorkScope): UsageBucket[] {
    return scope.kind === "all" ? buckets : scopeItems(attr, scope).flatMap((it) => it.buckets);
}

// the rail scope a drilled item sits under: its project when the rail shows it, else its initiative when
// the rail shows that, else All usage
export function itemScopeKey(attr: Attribution, item: WorkItem): string {
    if (attr.projects.some((p) => p.key === item.project)) {
        return item.project;
    }
    return attr.initiatives.find((i) => i.oid === item.effort)?.key ?? ALL_SCOPE;
}

export function scopeName(attr: Attribution, scopeKey: string): string {
    return (
        attr.projects.find((p) => p.key === scopeKey)?.label ??
        attr.initiatives.find((i) => i.key === scopeKey)?.label ??
        "All usage"
    );
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
        pushTo(roles, s.role || "session", s);
    }
    const parts = [...roles]
        .map(([role, held]) => ({ role, count: held.length, ...sumAmounts(held) }))
        .sort(bySpend)
        .map((r, i) => ({
            key: r.role,
            label: plural(r.count, r.role, `${r.role}s`),
            fill: laneFill(i),
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
    if (scope.kind === "project" || scope.kind === "initiative") {
        const kinds = kindCounts(scopeItems(attr, scope));
        return {
            parts: KIND_ORDER.filter((k) => kinds[k].count > 0).map((k) => ({
                key: k,
                label: `${KIND_SPLIT_LABEL[k]} · ${kinds[k].count}`,
                fill: laneFill(KIND_ORDER.indexOf(k)),
                tokens: kinds[k].tokens,
                spendUsd: kinds[k].spendUsd,
            })),
            note: `How this ${scope.kind} divides between orchestrator runs, quick runs and sessions no run started.`,
        };
    }
    const parts: SplitPart[] = attr.projects.map((p) => ({
        key: p.key,
        label: p.label,
        fill: p.fill,
        tokens: p.tokens,
        spendUsd: p.spendUsd,
    }));
    if (attr.other.count > 0) {
        parts.push({
            key: "other",
            label: plural(attr.other.count, "other folder", "other folders"),
            fill: FOLD_FILL,
            tokens: attr.other.tokens,
            spendUsd: attr.other.spendUsd,
        });
    }
    return {
        parts,
        note: "How usage divides between projects. A project is the repo a run was started in, or the folder a session ran in, with worktrees folded into their repo.",
    };
}

function shownCost(a: Amount): { cost: number; reported: boolean; unpriced: boolean } {
    const reported = a.pricedTokens === 0 && a.reportedCostUsd !== undefined;
    return {
        cost: reported ? a.reportedCostUsd! : a.spendUsd,
        reported,
        unpriced: a.tokens > 0 && a.pricedTokens === 0 && a.reportedCostUsd === undefined,
    };
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
                title: s.taskLabel || s.title,
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
    const meta = `${plural(items.length, "run or session", "runs and sessions")} · ${windowLabel}`;
    return {
        title: scope.kind === "all" ? "Spent on" : "Runs and sessions",
        // an initiative tag lives on tab meta, so a closed tab's sessions drop out of it: say so
        meta: scope.kind === "initiative" ? `${meta} · runs, and sessions from open tabs` : meta,
        summary: `${joinParts(said)}. A run counts its lead, workers and reviewers together; open one to see it the same way as this page.`,
        nav: true,
        // an initiative spans projects, so its rows name theirs as All usage's do
        rows: items.map((it) => itemRow(attr, it, scope.kind !== "project")),
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

// the rows shown after one more press of "Show more"
export function nextShown(shown: number, total: number): number {
    return Math.min(shown + LIST_PAGE_STEP, total);
}

// The list as the surface pages it: the first `shown` rows (eight collapsed, 25 more per step). A row's bar
// is its spend against the top row shown. listPage above keeps its two-state form for its callers.
export function listPageShown(list: WorkList, shown: number): WorkListShown {
    const total = list.rows.length;
    const rows = list.rows.slice(0, Math.max(0, shown));
    const left = total - rows.length;
    const top = rows.length > 0 ? Math.max(rows[0].cost, 0.0001) : 1;
    return {
        rows: rows.map((r) => ({ ...r, pct: Math.min(100, Math.max(1, Math.round((r.cost / top) * 100))) })),
        moreLabel:
            left <= 0 ? undefined : left > LIST_PAGE_STEP ? `Show ${LIST_PAGE_STEP} more` : `Show the last ${left}`,
        lessLabel: rows.length > LIST_COLLAPSED_ROWS ? `Show top ${LIST_COLLAPSED_ROWS}` : undefined,
    };
}

export function otherFoldersText(other: OtherFolders): string {
    const one = other.count === 1;
    return `${plural(other.count, "other folder", "other folders")} ${one ? "holds" : "hold"} ≈ ${usd(other.spendUsd)}${one ? "" : " between them, each"} under 1% of spend. ${one ? "Its" : "Their"} runs and sessions still rank under All usage.`;
}
