// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Conversation History: the old Sessions surface's master-detail, now Library's Conversations tab, `list` view
// (library/librarysurface.tsx). A recency-grouped list with a pinned "All activity" entry. An orchestrator run is one entry, with
// a row under it only for the members that need you; its detail lists the lead and every task and reads the one in
// view. Every other session is its own entry. Live agents are overlaid (matched by transcript path) so the primary
// action is Jump (live) or Resume (ended). Judge pairs and councils are in it too (conversationrows.ts is their model): one
// nests as a tree line under the session that started it, one no loaded session started is a card of its own placed by its
// own time, and the Judge and Council chips over the list swap it for a flat list of pairs, councils or both, each naming
// its session (the status filter hides then, and the Council chip brings the benchmark over the list). A pair row selects
// `pair:<id>` and the detail pane reads it, read-only (PairReadView); a council row opens it (openCouncil). A search box
// under the title finds a conversation by what was said in it (SearchSessions, every project): while it holds a query the
// list shows the results as solo cards, under the councils and pairs the query matches, and the sessions they name that no
// loaded page holds join the ones History groups and resolves against, so a click can open them.
// @theme tokens only — no hardcoded colors.

import { cardVariants, MOTION } from "@/app/element/motiontokens";
import { SkeletonLine, SkeletonRows } from "@/app/element/skeleton";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Activity, Check, Scale, Search, Workflow } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { libraryConvKindsAtom } from "../library/librarystore";
import type { AgentsViewModel } from "./agents";
import { formatAge, formatAgeShort, formatTokens } from "./agentsviewmodel";
import {
    councilSources,
    flatRows,
    nestedRows,
    navIds as rowNavIds,
    searchRows,
    type ConversationRow,
    type FlatRow,
    type ItemRow,
    type PairRow,
} from "./conversationrows";
import { CouncilBenchChart } from "./councilbenchchart";
import { councilHistoryRows } from "./councilhistory";
import { CouncilHistoryRowView, CouncilNestedLine } from "./councilhistoryview";
import { councilOpenedAtom } from "./councilopened";
import { councilUnreadAtom, useCouncils } from "./councilstore";
import { openLauncher } from "./launcherstore";
import { nearListEnd } from "./listend";
import { PairReadView } from "./pairreadpane";
import { usePairHistory } from "./pairstore";
import { projectsAtom } from "./projectsstore";
import type { RunInfo } from "./runlineage";
import { runDigestsAtom, useRunDigests } from "./runlineagestore";
import { useRunObjects } from "./runobjects";
import { runtimeMeta } from "./runtimemeta";
import { SearchSnippet } from "./searchsnippet";
import {
    filterByStatus,
    groupByRecency,
    loadMoreSessionsArchive,
    loadSessionsArchive,
    mergedFeed,
    overlayLive,
    resolveSelectedSession,
    sessionsArchiveAtom,
    sessionsCursorAtom,
    sessionsErrorAtom,
    sessionsLoadingMoreAtom,
    totalEvents,
    withLookedUp,
    type LiveSession,
    type SessionStatusFilter,
} from "./sessionsarchivestore";
import { eventColor, RunDetail, runSessionPrimary, SEG_COLOR, SoloDetail, StatusMark } from "./sessionsdetail";
import { useSessionSearch } from "./sessionsearchstore";
import { findTerms, openSessionHit } from "./sessionsfind";
import {
    defaultMember,
    groupRunSessions,
    LEAD_MEMBER,
    memberLiveSession,
    memberSession,
    runIdOfSel,
    runSelKey,
    runView,
    sessionKey,
    sessionLabel,
    sessionSelection,
    type RunSessions,
    type RunView,
    type Status,
} from "./sessionsruns";
import { SurfaceEmptyState, SurfaceError } from "./surfacescaffold";

const FILTERS: { key: SessionStatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "live", label: "Live" },
    { key: "needs", label: "Needs you" },
    { key: "done", label: "Done" },
];

// one entry of the left list: an orchestrator run or a session on its own. `sessions` are the ones it holds (a run's every
// member), which is what the pairs and councils nested under it are placed by.
interface Row {
    key: string;
    live: boolean;
    lastactivets: number;
    sessions: readonly LiveSession[];
    run?: { group: RunSessions; view: RunView };
    session?: LiveSession;
}

// a pair is selected as `pair:<id>` on the model's sessions selection, as a run is `run:<id>`
const PAIR_SEL = "pair:";
const pairIdOfSel = (sel: string): string | null => (sel.startsWith(PAIR_SEL) ? sel.slice(PAIR_SEL.length) : null);

// what the Judge and Council chips show: `startedFrom` is set on a row of the flat list alone
const startedFromOf = (r: ConversationRow<Row>): string | undefined => (r as Partial<FlatRow>).startedFrom;

const NO_PAIRS: readonly PairInfo[] = [];

const CHIPS: { key: "judge" | "council"; label: string }[] = [
    { key: "judge", label: "Judge" },
    { key: "council", label: "Council" },
];

function keepRow(r: Row, f: SessionStatusFilter): boolean {
    if (f === "all") {
        return true;
    }
    if (f === "live") {
        return r.live;
    }
    if (r.run) {
        return f === "needs" ? r.run.view.needs.length > 0 : !r.live;
    }
    return filterByStatus([r.session!], f).length > 0;
}

// a search answer holds at most this many sessions, newest first (the backend's default Limit; the request sets none)
const SEARCH_LIMIT = 200;

// one search result as a card in the list: its session as History holds it (the live overlay applied) and the answer
interface ResultRow {
    row: Row;
    result: SessionSearchResult;
}

function needsRow(r: Row): boolean {
    return r.run ? r.run.view.needs.length > 0 : r.session!.needsAttention;
}

function soloStatus(s: LiveSession, now: number): Status {
    if (s.live) {
        return s.needsAttention ? { key: "asking", text: "asking" } : { key: "running", text: "running" };
    }
    return { key: "muted", text: formatAge(now - s.lastactivets) };
}

// the session a member opens: its own, else the live agent of its run the scan has not picked up yet
export function ConversationHistory({ model }: { model: AgentsViewModel }) {
    const base = useAtomValue(sessionsArchiveAtom);
    const loadError = useAtomValue(sessionsErrorAtom);
    const cursor = useAtomValue(sessionsCursorAtom);
    const loadingMore = useAtomValue(sessionsLoadingMoreAtom);
    const onSurface = useAtomValue(model.surfaceAtom) === "library";
    const roster = useAtomValue(model.agentsAtom);
    const now = useAtomValue(model.nowAtom);
    const [sel, setSel] = useAtom(model.sessionsSelAtom);
    const [member, setMember] = useAtom(model.sessionsMemberAtom);
    const [filter, setFilter] = useAtom(model.sessionsStatusFilterAtom);
    const digests = useAtomValue(runDigestsAtom);
    // the Judge and Council chips: with one on the list is the flat one of pairs, councils or both, not sessions
    const [kinds, setKinds] = useAtom(libraryConvKindsAtom);
    const flat = kinds.judge || kinds.council;
    // the search box: a query with terms replaces the paged list with the SearchSessions results (every project)
    const [query, setQuery] = useState("");
    const search = useSessionSearch(query, {});
    const searching = useMemo(() => findTerms(query).length > 0, [query]);

    useEffect(() => {
        fireAndForget(loadSessionsArchive);
    }, []);

    // older pages load as the list scrolls to its end. The same check runs after each page lands and when the status
    // filter changes: a list that does not fill its container has no scrollbar and so no scroll event, and keeps
    // loading until it fills or the store's cursor is "" (the store sends one request at a time and none after that).
    // A hidden History measures 0 high, which would read as "at the end" and load
    // every page: it checks only while it has a height, and again when its surface comes back. While the search box
    // holds a query it loads none: a short results list fills no scroll and would page through the whole archive, and
    // the cursor it leaves is where the paged list picks up again when the box is cleared. A chip's flat list loads none
    // either: it is not the sessions' list, and a short one would page through the archive for nothing (a session it names
    // that is on a page not loaded reads as its short id)
    const listRef = useRef<HTMLDivElement>(null);
    const paging = !searching && !flat;
    const loadIfAtEnd = useCallback(() => {
        const el = listRef.current;
        if (paging && el != null && el.clientHeight > 0 && nearListEnd(el)) {
            fireAndForget(loadMoreSessionsArchive);
        }
    }, [paging]);
    useEffect(loadIfAtEnd, [loadIfAtEnd, base, cursor, filter, onSurface]);

    // every council and every pair, of every project: nested under the session that started them, or a row of their own
    const councils = useCouncils("");
    const pairInfos = usePairHistory("");
    const pairs = pairInfos ?? NO_PAIRS;
    const unread = useAtomValue(councilUnreadAtom);
    const registered = useAtomValue(projectsAtom);
    const opened = useAtomValue(councilOpenedAtom);
    // Resume reads the tree rule on the minute, as the tree does, so the rows are not rebuilt every second
    const minute = Math.floor(now / 60_000);
    // project name -> root path, as the tree builds it, so a council reads its folder's name
    const roots = useMemo(() => {
        const out = new Map<string, string>();
        for (const [name, project] of Object.entries(registered ?? {})) {
            if (project?.path) {
                out.set(name, project.path);
            }
        }
        return out;
    }, [registered]);
    const councilSrc = useMemo(
        () => councilSources(councils, councilHistoryRows(councils, roots, unread, { opened, now: minute * 60_000 })),
        [councils, roots, unread, opened, minute]
    );

    // the loaded sessions plus the results' that no loaded page holds (older ones), so a result opens in the detail;
    // the live overlay applies to both. Everything History groups and resolves below reads this list.
    const resultSessions = useMemo(() => (search.results ?? []).map((r) => r.session), [search.results]);
    const live = useMemo(
        () => overlayLive(withLookedUp(base ?? [], resultSessions), roster, now),
        [base, resultSessions, roster, now]
    );
    const { runs: runGroups, solos } = useMemo(() => groupRunSessions(live), [live]);

    // each run's own object and its dag
    const runObjs = useRunObjects(runGroups.map((g) => g.runId));

    const runRows: Row[] = useMemo(
        () =>
            runGroups.map((group) => {
                const lead = memberSession(group.lead);
                const leadAgent = lead?.liveId ? roster.find((a) => a.id === lead.liveId) : undefined;
                const o = runObjs[group.runId];
                const view = runView({
                    group,
                    run: o?.run,
                    dag: o?.dag,
                    digest: digests[group.runId],
                    leadAtPrompt: leadAgent?.atPrompt,
                    now,
                });
                return {
                    key: runSelKey(group.runId),
                    live: group.live,
                    lastactivets: group.lastactivets,
                    sessions: group.sessions,
                    run: { group, view },
                };
            }),
        [runGroups, runObjs, digests, roster, now]
    );

    // only a live run can raise a question, and the one in view shows its ask
    const selRunId = runIdOfSel(sel);
    useRunDigests(
        runGroups
            .filter((g) => g.live || g.runId === selRunId)
            .map(
                (g): RunInfo => ({
                    runId: g.runId,
                    channelId: g.channelId || runObjs[g.runId]?.dag?.channelid || "",
                    title: "",
                    project: "",
                    dag: runObjs[g.runId]?.dag,
                })
            )
    );

    const soloRows: Row[] = solos.map((s) => ({
        key: sessionKey(s),
        live: s.live,
        lastactivets: s.lastactivets,
        sessions: [s],
        session: s,
    }));
    // every project, from the oldest scanned session on: the app bar's project switcher narrows the sidebar's
    // Conversations, not History, which is where a conversation from any folder can still be found
    const scoped = [...runRows, ...soloRows];
    const scopedSessions = scoped.flatMap((r) => r.sessions);
    const liveCount = scopedSessions.filter((s) => s.live).length;
    const needsCount = scoped.filter(needsRow).length;
    const runTitles = Object.fromEntries(runRows.map((r) => [r.run!.group.runId, r.run!.view.title]));
    // the list as drawn: each entry that stays under the status filter with the pairs and councils nested under it, and
    // the ones no loaded session started as rows of their own; or, with a chip on, the flat list of what the chip names
    const rows: ConversationRow<Row>[] = flat
        ? flatRows(kinds, live, councilSrc, pairs, runTitles)
        : nestedRows(scoped, councilSrc, pairs, { filter, keep: keepRow, more: cursor !== "" });
    const groups = groupByRecency(rows, now);
    // the list waits for what it is made of (the sessions, or what the chips name): one not read yet is not an empty one
    const loaded = flat ? !((kinds.judge && pairInfos == null) || (kinds.council && councils == null)) : base != null;
    const listState = !loaded ? "loading" : rows.length === 0 ? "empty" : "rows";

    // detail resolves against every row so project and status filters never blank an explicit selection
    const selSession = selRunId ? undefined : resolveSelectedSession(live, sel);
    const viewRunId = selRunId ?? selSession?.runid;
    const selRun = viewRunId ? runRows.find((r) => r.run!.group.runId === viewRunId)?.run : undefined;
    const selMember = selRun
        ? (selRun.view.members.find((m) => m.key === member) ?? selRun.view.members[0])
        : undefined;
    const selMemberSession = selRun && selMember ? memberLiveSession(selMember, selRun.view.runId, roster) : undefined;
    const primary = selRun ? selMemberSession : selSession;

    const select = (key: string) => {
        setSel(key);
        const runId = runIdOfSel(key);
        const view = runId ? runRows.find((r) => r.run!.group.runId === runId)?.run?.view : undefined;
        if (view) {
            setMember(defaultMember(view));
        }
    };
    const selectMember = (runId: string, key: string) => {
        setSel(runSelKey(runId));
        setMember(key);
    };
    const openSession = (key: string) => {
        const s = live.find((x) => sessionKey(x) === key);
        const to: { sel: string; member?: string } = s != null ? sessionSelection(s) : { sel: key };
        setSel(to.sel);
        if (to.member != null) {
            setMember(to.member);
        }
    };

    // the results, one solo card per session as the answer lists them (newest first), under the status filter as
    // keepRow filters solo rows. A run's session is a card of its own here, not a part of the run's card.
    const liveByKey = new Map(live.map((s) => [sessionKey(s), s]));
    const resultRows: ResultRow[] = (searching ? (search.results ?? []) : []).flatMap((result) => {
        const s = liveByKey.get(sessionKey(result.session));
        if (s == null) {
            return [];
        }
        const row: Row = { key: sessionKey(s), live: s.live, lastactivets: s.lastactivets, sessions: [s], session: s };
        return keepRow(row, filter) ? [{ row, result }] : [];
    });
    // the councils and pairs the query matches (each of every project, whatever the chips say): a section of their own
    // above the sessions' results
    const found: ItemRow[] = searching ? searchRows(query, councilSrc, pairs) : [];
    // a click selects the session as History does (a run's session selects its run and member) and opens it at the hit
    const openResult = (result: SessionSearchResult) => openSessionHit(model, result, query.trim(), search.terms);
    const selectResult = (key: string) => {
        if (pairIdOfSel(key) != null) {
            select(key);
            return;
        }
        const hit = resultRows.find((r) => r.row.key === key);
        if (hit != null) {
            openResult(hit.result);
        }
    };
    // a result is selected when its session's selection is the one in view (a run's member counts)
    const resultActive = (result: SessionSearchResult) => {
        const to = sessionSelection(result.session);
        return sel === to.sel && (to.member == null || member === to.member);
    };
    // Esc empties the box and brings the paged list back; Esc on an empty box gives the keys back to the page. The Esc
    // that leaves the centre stands down while an input holds focus, so neither leaves History.
    const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Escape") {
            return;
        }
        e.preventDefault();
        if (query !== "") {
            setQuery("");
        } else {
            e.currentTarget.blur();
        }
    };

    // publish the "All activity" + row order for global j/k list-nav (the matched pairs' keys, then the results' keys while
    // searching; no "All activity" under a chip, whose list has none). A pair's row is in it and a council's is not:
    // selecting a council leaves the list (rowNavIds). cursor==selection. Refs keep the controller stable while reading this
    // render's rows, so it isn't re-registered on every roster tick; the ids are keyed by content, since groupByRecency hands
    // back fresh arrays every render.
    const navIdsKey = (
        searching
            ? [...rowNavIds(found), ...resultRows.map((r) => r.row.key)]
            : [...(flat ? [] : ["all"]), ...rowNavIds(groups.flatMap((g) => g.items))]
    ).join("\n");
    const navIds = useMemo(() => (navIdsKey === "" ? [] : navIdsKey.split("\n")), [navIdsKey]);
    const selectRef = useRef(select);
    selectRef.current = searching ? selectResult : select;
    const actRef = useRef<() => void>(() => {});
    actRef.current = () => {
        if (primary) {
            runSessionPrimary(model, primary);
        }
    };
    const selPairId = pairIdOfSel(sel);
    const cursorId = searching
        ? selPairId != null
            ? sel
            : (resultRows.find((r) => resultActive(r.result))?.row.key ?? sel)
        : viewRunId
          ? runSelKey(viewRunId)
          : sel;
    const listNav = useMemo<ListNavController>(
        () => ({
            surface: "library",
            navigableIds: navIds,
            cursorId,
            setCursor: (id) => selectRef.current(id),
            activate: () => actRef.current(),
        }),
        [navIds, cursorId]
    );
    // Publish only while Library is the surface on screen: a History mounted while another surface shows would otherwise
    // take listNavAtom from that surface's own list (Usage, Diff, Brief), whose j/k then go dead.
    useSurfaceListNav(onSurface ? listNav : null);

    const detailKind = selPairId != null ? "pair" : selRun ? "run" : selSession ? "solo" : "feed";

    // the nested lines under an entry's card: a pair selects `pair:<id>` (the detail pane reads it), a council opens
    const nestedLines = (items: readonly ItemRow[]) =>
        items.map((n) =>
            n.kind === "pair" ? (
                <NestedPairLine key={n.key} row={n} active={sel === n.key} onSelect={() => select(n.key)} />
            ) : (
                <CouncilNestedLine key={n.key} row={n.row} line={n.nestedLine} model={model} />
            )
        );
    // a pair or a council as a card of its own: standing by its own time, in the flat list (`startedFrom`), or found by a search
    const itemCard = (r: ItemRow, startedFrom?: string) =>
        r.kind === "pair" ? (
            <PairCard
                key={r.key}
                row={r}
                active={sel === r.key}
                now={now}
                startedFrom={startedFrom}
                onSelect={() => select(r.key)}
            />
        ) : (
            <CouncilHistoryRowView key={r.key} row={r.row} now={now} model={model} startedFrom={startedFrom} />
        );
    const renderRow = (r: ConversationRow<Row>) => {
        if (r.kind !== "entry") {
            return itemCard(r, startedFromOf(r));
        }
        const e = r.entry;
        const card = e.run ? (
            <RunCard
                key={r.key}
                view={e.run.view}
                active={viewRunId === e.run.group.runId}
                member={member}
                now={now}
                onSelect={() => select(r.key)}
                onMember={(key) => selectMember(e.run!.group.runId, key)}
            />
        ) : (
            <SoloCard
                key={r.key}
                session={e.session!}
                active={sel === r.key}
                now={now}
                onSelect={() => setSel(r.key)}
            />
        );
        if (r.nested.length === 0) {
            return card;
        }
        // the card as it is, with a tree line under it for each pair and council its sessions started
        return (
            <div key={r.key} className="flex flex-col">
                {card}
                <motion.div layout data-history-nested-group className="flex flex-col gap-px pb-0.5 pl-3 pr-1 pt-1">
                    {nestedLines(r.nested)}
                </motion.div>
            </div>
        );
    };

    return (
        <MotionConfig reducedMotion="user">
            <div data-agent-history className="flex h-full min-h-0 flex-col bg-background">
                {loadError ? (
                    <SurfaceError
                        message="Couldn’t load sessions."
                        onRetry={() => fireAndForget(loadSessionsArchive)}
                    />
                ) : null}

                {/* no page-wide header: the list column heads itself (title, live count, status filter) and the
                    detail column keeps its own session or run header, the two starting on one line. Library's tab strip
                    is above all of it, and there is nothing to close back to */}
                <div className="flex min-h-0 flex-1">
                    <div className="flex w-[380px] flex-none flex-col border-r border-edge-faint">
                        <div className="flex flex-none flex-col gap-2.5 border-b border-edge-faint px-3 pb-3 pt-[18px]">
                            <div className="flex h-7 items-center gap-1.5">
                                <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-primary">
                                    Conversation History
                                </h1>
                                {liveCount > 0 ? (
                                    <span className="inline-flex flex-none items-center gap-1.5 rounded-full bg-pill px-[9px] py-[3px] text-[10.5px] tabular-nums text-secondary">
                                        <span className="h-1.5 w-1.5 pulse-dot rounded-full bg-working" />
                                        {liveCount} live
                                    </span>
                                ) : null}
                            </div>
                            <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 focus-within:border-accent">
                                <Search size={13} aria-hidden className="flex-none text-muted" />
                                <input
                                    data-history-search
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={onSearchKey}
                                    placeholder="Search conversations"
                                    aria-label="Search conversations"
                                    spellCheck={false}
                                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-muted"
                                />
                            </label>
                            <div role="group" aria-label="Show only" className="flex gap-1.5">
                                {CHIPS.map((c) => (
                                    <button
                                        key={c.key}
                                        type="button"
                                        data-history-chip={c.key}
                                        aria-pressed={kinds[c.key]}
                                        onClick={() => setKinds((k) => ({ ...k, [c.key]: !k[c.key] }))}
                                        className={cn(
                                            "flex h-6 cursor-pointer items-center whitespace-nowrap rounded-full border px-2.5 text-[11.5px] font-semibold",
                                            kinds[c.key]
                                                ? "border-accent bg-accentbg text-primary"
                                                : "border-border bg-surface text-ink-mid hover:border-edge-strong hover:text-primary"
                                        )}
                                    >
                                        {c.label}
                                    </button>
                                ))}
                            </div>
                            {/* a chip's list is not sessions, so the filter by a session's status has nothing to filter */}
                            {!flat ? (
                                <div
                                    role="group"
                                    aria-label="Status filter"
                                    className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5"
                                >
                                    {FILTERS.map((f) => (
                                        <button
                                            key={f.key}
                                            type="button"
                                            aria-pressed={filter === f.key}
                                            onClick={() => setFilter(f.key)}
                                            className={cn(
                                                "flex flex-auto cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-[5px] text-[11.5px] font-semibold",
                                                filter === f.key
                                                    ? "bg-accentbg text-primary"
                                                    : "text-ink-mid hover:text-primary"
                                            )}
                                        >
                                            {f.label}
                                            {f.key === "needs" && needsCount > 0 ? (
                                                <span className="text-[10.5px] tabular-nums text-asking">
                                                    {needsCount}
                                                </span>
                                            ) : null}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                        {kinds.council ? (
                            // the benchmark, folded to one line until opened, over the list; it draws nothing (and
                            // `empty:hidden` takes this box with it) until the bench has a scored row. Its box scrolls when
                            // the open chart is taller than the pane lets it be, so the list under it keeps a place.
                            <div
                                data-library-bench
                                className="max-h-[60vh] flex-none overflow-y-auto border-b border-edge-faint px-3 py-2 empty:hidden"
                            >
                                <CouncilBenchChart />
                            </div>
                        ) : null}
                        <div
                            ref={listRef}
                            data-history-list
                            onScroll={loadIfAtEnd}
                            className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3 pb-10"
                        >
                            {searching ? (
                                <>
                                    {found.length > 0 ? (
                                        <>
                                            <div className="flex items-center gap-2.5 px-1 pb-0.5 pt-1">
                                                <span
                                                    data-history-items-head
                                                    className={cn(REGION_LABEL, "text-muted")}
                                                >
                                                    Councils and pairs
                                                </span>
                                                <div className="h-px flex-1 bg-edge-faint" />
                                                <span className="text-[10.5px] tabular-nums text-muted">
                                                    {found.length}
                                                </span>
                                            </div>
                                            {found.map((r) => itemCard(r))}
                                        </>
                                    ) : null}
                                    {search.error != null ? (
                                        <div data-history-search-error className="px-1 pt-3 text-[12px] text-muted">
                                            Search failed: {search.error}
                                        </div>
                                    ) : search.results == null ? (
                                        <div className="px-1 pt-3 text-[12px] text-muted">Searching…</div>
                                    ) : resultRows.length === 0 ? (
                                        // the councils and pairs above are a match too: this says there is no session to add
                                        found.length === 0 ? (
                                            <div data-history-search-empty className="px-1 pt-3 text-[12px] text-muted">
                                                {search.incomplete
                                                    ? "No conversations match yet · indexing…"
                                                    : "No conversations match"}
                                            </div>
                                        ) : null
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2.5 px-1 pb-0.5 pt-1">
                                                <span
                                                    data-history-results-head
                                                    className={cn(REGION_LABEL, "text-muted")}
                                                >
                                                    {resultRows.length} {resultRows.length === 1 ? "result" : "results"}
                                                    {search.incomplete ? " · indexing…" : ""}
                                                    {search.truncated ? ` · newest ${SEARCH_LIMIT}` : ""}
                                                </span>
                                                <div className="h-px flex-1 bg-edge-faint" />
                                            </div>
                                            {resultRows.map(({ row, result }) => (
                                                <SoloCard
                                                    key={row.key}
                                                    session={row.session!}
                                                    active={resultActive(result)}
                                                    now={now}
                                                    onSelect={() => openResult(result)}
                                                    result={{
                                                        title: sessionLabel(row.session!, runTitles),
                                                        hit: result.hits?.[0],
                                                    }}
                                                />
                                            ))}
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    {!flat ? (
                                        <button
                                            type="button"
                                            onClick={() => setSel("all")}
                                            className={cn(
                                                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-[9px] text-left",
                                                sel === "all"
                                                    ? "border-accent bg-surface-selected"
                                                    : "border-border bg-surface hover:bg-surface-hover"
                                            )}
                                        >
                                            <Activity
                                                size={14}
                                                strokeWidth={1.8}
                                                className="flex-none text-ink-mid"
                                                aria-hidden
                                            />
                                            <span className="flex-1 text-[12.5px] font-semibold text-secondary">
                                                All activity
                                            </span>
                                            <span className="text-[10.5px] tabular-nums text-muted">
                                                {totalEvents(scopedSessions)} events
                                            </span>
                                        </button>
                                    ) : null}

                                    {listState === "loading" ? (
                                        <SkeletonRows className="mt-3 min-h-0 flex-1 space-y-[7px]">
                                            {(i) => <SkeletonLine key={i} className="h-[58px] rounded-[10px]" />}
                                        </SkeletonRows>
                                    ) : listState === "empty" ? (
                                        flat ? (
                                            <div data-history-flat-empty className="mt-6">
                                                <SurfaceEmptyState
                                                    title={
                                                        kinds.judge && kinds.council
                                                            ? "No pairs or councils yet"
                                                            : kinds.judge
                                                              ? "No judge pairs yet"
                                                              : "No councils yet"
                                                    }
                                                    body={
                                                        kinds.council
                                                            ? "Start a council from New → Council, or ask an agent for one. Every council shows up here, a judge pair too once you pair an agent."
                                                            : "A pair shows up here once you pair an agent with a judge, and stays after it ends."
                                                    }
                                                />
                                            </div>
                                        ) : (
                                            <div className="mt-6">
                                                <SurfaceEmptyState
                                                    title="No sessions found"
                                                    body="Sessions appear here as agents run. Start one to begin."
                                                    action={{
                                                        label: "New agent",
                                                        onClick: () => openLauncher(model, "agent"),
                                                    }}
                                                />
                                            </div>
                                        )
                                    ) : (
                                        groups.map((g) => (
                                            <div
                                                key={g.key}
                                                data-history-group={g.key}
                                                className="flex flex-col gap-1.5"
                                            >
                                                <div className="flex items-center gap-2.5 px-1 pb-0.5 pt-3">
                                                    <span className={cn(REGION_LABEL, "text-muted")}>{g.label}</span>
                                                    <div className="h-px flex-1 bg-edge-faint" />
                                                    <span className="text-[10.5px] tabular-nums text-muted">
                                                        {g.items.length}
                                                    </span>
                                                </div>
                                                <AnimatePresence initial={false} mode="popLayout">
                                                    {g.items.map(renderRow)}
                                                </AnimatePresence>
                                            </div>
                                        ))
                                    )}
                                    {loadingMore ? (
                                        <div className="flex-none px-1 py-2 text-[11.5px] text-muted">
                                            Loading older sessions…
                                        </div>
                                    ) : null}
                                </>
                            )}
                        </div>
                    </div>

                    {/* a pair reads edge to edge, as its own view does at full width (its header and its Decided column
                        carry their own borders), and never narrower than the Decided column plus a thread that reads: a
                        narrow window scrolls the pane sideways. A session, a run and the feed sit in the page's padding */}
                    <div
                        data-history-detail
                        className={cn(
                            "flex min-w-0 flex-1 flex-col",
                            selPairId != null ? "overflow-x-auto" : "px-8 pb-[22px] pt-[18px]"
                        )}
                    >
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={detailKind}
                                className="flex min-h-0 flex-1 flex-col"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                            >
                                {selPairId != null ? (
                                    <div className="flex min-h-0 min-w-[720px] flex-1 flex-col">
                                        <PairReadView
                                            key={selPairId}
                                            model={model}
                                            pairId={selPairId}
                                            openSession={openSession}
                                        />
                                    </div>
                                ) : selRun && selMember ? (
                                    <RunDetail
                                        model={model}
                                        view={selRun.view}
                                        member={selMember}
                                        memberSession={selMemberSession}
                                        now={now}
                                    />
                                ) : selSession ? (
                                    <SoloDetail model={model} session={selSession} />
                                ) : (
                                    <MergedFeed
                                        list={scopedSessions}
                                        titles={runTitles}
                                        now={now}
                                        onOpen={openSession}
                                    />
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </MotionConfig>
    );
}

// a pair under the session its working agent ran in: one tree line, `└ Pair with judge 4c6ba858 · both sides settled`. The one
// open in the detail pane reads as selected.
function NestedPairLine({ row, active, onSelect }: { row: PairRow; active: boolean; onSelect: () => void }) {
    return (
        <button
            type="button"
            data-history-nested="pair"
            data-history-item={row.key}
            aria-current={active ? "true" : undefined}
            title={row.nestedLine}
            onClick={onSelect}
            className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-[6px] py-[5px] pl-1.5 pr-2 text-left text-[12.5px]",
                active ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover"
            )}
        >
            <span aria-hidden className="flex-none text-muted">
                └
            </span>
            <span className="min-w-0 flex-1 truncate">{row.nestedLine}</span>
        </button>
    );
}

// a pair no listed session started, or any pair in the flat list the Judge chip shows (`startedFrom` names the session that
// started it there): its working agent's name, then its judge and why it stopped or that it still relays
function PairCard({
    row,
    active,
    now,
    onSelect,
    startedFrom,
}: {
    row: PairRow;
    active: boolean;
    now: number;
    onSelect: () => void;
    startedFrom?: string;
}) {
    return (
        <motion.button
            layout
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            type="button"
            data-history-pair={row.id}
            data-history-item={row.key}
            onClick={onSelect}
            className={cn(
                // cardVariants animates opacity per frame: the base button transition must not ease it too
                "flex w-full cursor-pointer flex-col gap-1.5 rounded-[10px] border px-3 py-2.5 text-left transition-[border-color,background-color]",
                active ? "border-accent bg-surface-selected" : "border-border bg-surface hover:border-edge-strong"
            )}
        >
            <span className="flex w-full items-center gap-2">
                <Scale size={13} strokeWidth={1.8} className="flex-none text-ink-mid" aria-hidden />
                <span
                    data-history-pair-title
                    className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary"
                >
                    {row.title}
                </span>
                <span className="flex-none whitespace-nowrap text-[10.5px] tabular-nums text-muted">
                    {formatAgeShort(now - row.lastactivets)}
                </span>
            </span>
            <span data-history-pair-line className="min-w-0 truncate text-[11.5px] text-secondary">
                {row.line}
            </span>
            {startedFrom != null ? (
                <span data-history-pair-from title={startedFrom} className="min-w-0 truncate text-[10.5px] text-muted">
                    {startedFrom}
                </span>
            ) : null}
        </motion.button>
    );
}

function RunCard({
    view,
    active,
    member,
    now,
    onSelect,
    onMember,
}: {
    view: RunView;
    active: boolean;
    member: string;
    now: number;
    onSelect: () => void;
    onMember: (key: string) => void;
}) {
    const rt = runtimeMeta(view.runtime);
    // a finished run reads as its age alone; its members' checks already say it landed
    const head: Status = view.head.key === "done" ? { key: "muted", text: view.head.text } : view.head;
    const elapsed = (view.live ? now : view.lastactivets) - view.startedts;
    return (
        <motion.div
            layout
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={cn(
                "rounded-[10px] border",
                active ? "border-accent bg-surface-selected" : "border-border bg-surface hover:border-edge-strong"
            )}
        >
            <button
                type="button"
                onClick={onSelect}
                className="flex w-full cursor-pointer flex-col gap-2 rounded-[10px] px-3 pb-[11px] pt-2.5 text-left"
            >
                <span className="flex w-full items-center gap-2">
                    <Workflow size={13} strokeWidth={1.8} className="flex-none text-ink-mid" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary">{view.title}</span>
                    <StatusMark status={head} />
                </span>
                <span className="flex w-full items-center gap-2 text-[10.5px] tabular-nums text-muted">
                    {view.segs.length > 0 ? (
                        // a segment is 14px while they fit and thins to 2px for a long plan, so the strip never
                        // pushes the landed count out of the card
                        <span className="flex min-w-0 gap-[3px] overflow-hidden" aria-hidden="true">
                            {view.segs.map((k, i) => (
                                <span
                                    key={i}
                                    className="h-1 w-3.5 min-w-[2px] rounded-[2px]"
                                    style={{ backgroundColor: view.complete ? "var(--color-success)" : SEG_COLOR[k] }}
                                />
                            ))}
                        </span>
                    ) : null}
                    {view.complete ? (
                        <span className="flex flex-none items-center gap-[5px] whitespace-nowrap text-success">
                            <Check size={11} aria-hidden className="flex-none" />
                            {view.total > 0 ? `${view.landed}/${view.total} landed` : "complete"}
                        </span>
                    ) : (
                        <span className="flex-none whitespace-nowrap">
                            {view.total > 0 ? `${view.landed}/${view.total} landed` : "planning"}
                        </span>
                    )}
                    <span className="flex-1" />
                    <span className="min-w-0 truncate">
                        <span className={rt.text}>{rt.glyph}</span>{" "}
                        {[view.project, formatAgeShort(elapsed)].filter(Boolean).join(" · ")}
                    </span>
                </span>
            </button>
            {view.needs.length > 0 ? (
                <div
                    role="group"
                    aria-label={`Needs you in ${view.title}`}
                    className="flex flex-col gap-px border-t border-edge-faint px-1.5 pb-1.5 pt-1"
                >
                    {view.needs.map((m) => (
                        <button
                            key={m.key}
                            type="button"
                            onClick={() => onMember(m.key)}
                            className={cn(
                                "grid h-[30px] cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-[6px] px-1.5 text-left",
                                active && member === m.key ? "bg-surface-selected" : "hover:bg-surface-hover"
                            )}
                        >
                            <span
                                className={cn(
                                    "text-center text-[10.5px] tabular-nums",
                                    m.key === LEAD_MEMBER ? rt.text : "text-muted"
                                )}
                            >
                                {m.key === LEAD_MEMBER ? rt.glyph : m.num}
                            </span>
                            <span className="truncate text-[12px] text-secondary">{m.label}</span>
                            <StatusMark status={m.status} />
                        </button>
                    ))}
                </div>
            ) : null}
        </motion.div>
    );
}

function SoloCard({
    session,
    active,
    now,
    onSelect,
    result,
}: {
    session: LiveSession;
    active: boolean;
    now: number;
    onSelect: () => void;
    // a search result: the title it reads under (a run's session reads as its run) and its first hit's snippet
    result?: { title: string; hit?: SessionHit };
}) {
    const rt = runtimeMeta(session.runtime);
    return (
        <motion.button
            layout
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            type="button"
            data-history-result={result != null ? sessionKey(session) : undefined}
            onClick={onSelect}
            className={cn(
                // cardVariants animates opacity per frame: the base button transition must not ease it too
                "flex w-full cursor-pointer flex-col gap-2 rounded-[10px] border px-3 py-2.5 text-left transition-[border-color,background-color]",
                active ? "border-accent bg-surface-selected" : "border-border bg-surface hover:border-edge-strong"
            )}
        >
            <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary">
                    {result?.title ?? (session.task || "(untitled session)")}
                </span>
                <StatusMark status={soloStatus(session, now)} />
            </span>
            <span className="flex w-full items-center gap-2 text-[10.5px] tabular-nums text-muted">
                <span className={rt.text}>{rt.glyph}</span>
                <span className="min-w-0 truncate text-secondary" title={session.projectname}>
                    {session.projectname}
                </span>
                <span className="min-w-0 truncate" title={session.branch || undefined}>
                    {session.branch || "—"}
                </span>
                <span className="flex-1" />
                {session.tokenstotal > 0 ? (
                    <span className="flex-none whitespace-nowrap">{formatTokens(session.tokenstotal)} tok</span>
                ) : null}
            </span>
            {result?.hit != null ? <SearchSnippet hit={result.hit} /> : null}
        </motion.button>
    );
}

function MergedFeed({
    list,
    titles,
    now,
    onOpen,
}: {
    list: LiveSession[];
    titles: Record<string, string>;
    now: number;
    onOpen: (sessionKey: string) => void;
}) {
    const feed = mergedFeed(list, (s) => sessionLabel(s, titles));
    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-1.5 flex items-center gap-2.5">
                <h2 className={cn(REGION_LABEL, "text-muted")}>All activity</h2>
                <div className="h-px flex-1 bg-edge-faint" />
                <span className="text-[10.5px] tabular-nums text-muted">{feed.length} events</span>
            </div>
            {feed.length === 0 ? (
                <div className="mt-8 text-center text-[13px] text-muted">No recent activity.</div>
            ) : (
                <div className="flex flex-col">
                    {feed.map((e) => (
                        <button
                            key={e.key}
                            type="button"
                            onClick={() => onOpen(e.sessionKey)}
                            className="grid cursor-pointer grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-x-3.5 border-b border-edge-faint px-2 py-2.5 text-left hover:bg-surface-hover"
                        >
                            <span
                                className="mt-[7px] h-[7px] w-[7px] rounded-full"
                                style={{ backgroundColor: eventColor(e.type) }}
                            />
                            <span className="min-w-0">
                                <span className="block text-[13px] leading-[1.5] text-secondary">{e.text}</span>
                                <span className="mt-[3px] flex items-center gap-2 whitespace-nowrap text-[10.5px]">
                                    <span
                                        className="flex-none uppercase tracking-[0.06em]"
                                        style={{ color: eventColor(e.type) }}
                                    >
                                        {e.type}
                                    </span>
                                    <span className="min-w-0 truncate text-muted">{e.sessionTitle}</span>
                                </span>
                            </span>
                            <span className="pt-0.5 text-[10.5px] tabular-nums text-muted">
                                {now - e.ts < 60_000 ? "now" : formatAge(now - e.ts)}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
