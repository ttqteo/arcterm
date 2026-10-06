// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Conversation History: the old Sessions surface's master-detail, now the Agent surface's `history` centre mode
// (agentcenter.ts). A recency-grouped list with a pinned "All activity" entry. An orchestrator run is one entry, with
// a row under it only for the members that need you; its detail lists the lead and every task and reads the one in
// view. Every other session is its own entry. Live agents are overlaid (matched by transcript path) so the primary
// action is Jump (live) or Resume (ended). @theme tokens only — no hardcoded colors.

import { cardVariants, MOTION } from "@/app/element/motiontokens";
import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import * as WOS from "@/app/store/wos";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue } from "jotai";
import { Activity, ArrowLeft, Check, Workflow } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { formatAge, formatAgeShort, formatTokens } from "./agentsviewmodel";
import { FocusBanner } from "./focusbanner";
import { filterSessionsByFocus, focusBannerCopy } from "./focusscope";
import { activeFocusAtom, exitFocus, focusRevealAtom, focusScopeAtom, revealSurface } from "./focusstore";
import type { RunInfo } from "./runlineage";
import { runDigestsAtom, useRunDigests } from "./runlineagestore";
import { runtimeMeta } from "./runtimemeta";
import {
    filterByProject,
    filterByStatus,
    groupByRecency,
    loadSessionsArchive,
    mergedFeed,
    overlayLive,
    resolveSelectedSession,
    sessionsArchiveAtom,
    sessionsErrorAtom,
    totalEvents,
    type LiveSession,
    type SessionStatusFilter,
} from "./sessionsarchivestore";
import { eventColor, RunDetail, runSessionPrimary, SEG_COLOR, SoloDetail, StatusMark } from "./sessionsdetail";
import {
    defaultMember,
    groupRunSessions,
    LEAD_MEMBER,
    memberSession,
    rosterSession,
    runIdOfSel,
    runSelKey,
    runView,
    sessionKey,
    sessionLabel,
    sessionSelection,
    type RunMember,
    type RunSessions,
    type RunView,
    type Status,
} from "./sessionsruns";
import { SurfaceEmptyState, SurfaceError, SurfaceHeader } from "./surfacescaffold";

const FILTERS: { key: SessionStatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "live", label: "Live" },
    { key: "needs", label: "Needs you" },
    { key: "done", label: "Done" },
];

// one entry of the left list: an orchestrator run or a session on its own
interface Row {
    key: string;
    live: boolean;
    lastactivets: number;
    run?: { group: RunSessions; view: RunView };
    session?: LiveSession;
}

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
function memberLiveSession(m: RunMember, runId: string, roster: AgentVM[]): LiveSession | undefined {
    if (m.session) {
        return m.session;
    }
    const childRunId = m.key === LEAD_MEMBER ? runId : m.childRunId;
    const agent = childRunId ? roster.find((a) => a.runId === childRunId) : undefined;
    return agent ? rosterSession(agent) : undefined;
}

export function ConversationHistory({ model }: { model: AgentsViewModel }) {
    const base = useAtomValue(sessionsArchiveAtom);
    const loadError = useAtomValue(sessionsErrorAtom);
    const roster = useAtomValue(model.agentsAtom);
    const now = useAtomValue(model.nowAtom);
    const [sel, setSel] = useAtom(model.sessionsSelAtom);
    const [member, setMember] = useAtom(model.sessionsMemberAtom);
    const [filter, setFilter] = useAtom(model.sessionsStatusFilterAtom);
    const projectFilter = useAtomValue(model.projectFilterAtom);
    const activeSpace = useAtomValue(activeFocusAtom);
    const spaceScope = useAtomValue(focusScopeAtom);
    const spaceRevealed = useAtomValue(focusRevealAtom).has("history");
    const digests = useAtomValue(runDigestsAtom);

    useEffect(() => {
        fireAndForget(loadSessionsArchive);
    }, []);

    const live = useMemo(() => (base == null ? [] : overlayLive(base, roster, now)), [base, roster, now]);
    const { runs: runGroups, solos } = useMemo(() => groupRunSessions(live), [live]);

    // each run's own object and its dag, read from the object store (loaded on first read)
    const runIdsKey = runGroups.map((g) => g.runId).join(",");
    const runObjsAtom = useMemo(
        () =>
            atom((get) => {
                const out: Record<string, { run?: Run; dag?: TaskGroup }> = {};
                for (const id of runIdsKey.split(",").filter(Boolean)) {
                    const run = get(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", id)));
                    const dag = run?.dagoref
                        ? get(WOS.getWaveObjectAtom<TaskGroup>(WOS.makeORef("dag", run.dagoref)))
                        : undefined;
                    out[id] = { run, dag };
                }
                return out;
            }),
        [runIdsKey]
    );
    const runObjs = useAtomValue(runObjsAtom);

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
        session: s,
    }));
    const inScope = (sessions: LiveSession[]) => filterSessionsByFocus(sessions, spaceScope, spaceRevealed).length > 0;
    const projectScoped = [
        ...runRows.filter((r) => projectFilter === "all" || r.run!.view.project === projectFilter),
        ...soloRows.filter((r) => filterByProject([r.session!], projectFilter).length > 0),
    ];
    const scoped = projectScoped.filter((r) => inScope(r.run ? r.run.group.sessions : [r.session!]));
    const groups = groupByRecency(
        scoped.filter((r) => keepRow(r, filter)),
        now
    );
    const scopedSessions = scoped.flatMap((r) => (r.run ? r.run.group.sessions : [r.session!]));
    const liveCount = scopedSessions.filter((s) => s.live).length;
    const needsCount = scoped.filter(needsRow).length;
    // without the reveal, so the banner still counts the focus's own rows after Show all
    const spaceInScope = projectScoped.filter(
        (r) => filterSessionsByFocus(r.run ? r.run.group.sessions : [r.session!], spaceScope, false).length > 0
    ).length;
    // the empty list is the focus's doing, not an empty archive, so the empty state must say so
    const focusHidesAll = activeSpace != null && !spaceRevealed && spaceInScope === 0 && projectScoped.length > 0;

    // detail resolves against every row so project, Space, and status filters never blank an explicit selection
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

    // publish the "All activity" + row order for global j/k list-nav. cursor==selection. Refs keep the
    // controller stable while reading this render's rows, so it isn't re-registered on every roster tick; the ids are
    // keyed by content, since groupByRecency hands back fresh arrays every render.
    const navIdsKey = ["all", ...groups.flatMap((g) => g.items.map((r) => r.key))].join("\n");
    const navIds = useMemo(() => navIdsKey.split("\n"), [navIdsKey]);
    const selectRef = useRef(select);
    selectRef.current = select;
    const actRef = useRef<() => void>(() => {});
    actRef.current = () => {
        if (primary) {
            runSessionPrimary(model, primary);
        }
    };
    const cursorId = viewRunId ? runSelKey(viewRunId) : sel;
    const listNav = useMemo<ListNavController>(
        () => ({
            surface: "agent",
            navigableIds: navIds,
            cursorId,
            setCursor: (id) => selectRef.current(id),
            activate: () => actRef.current(),
        }),
        [navIds, cursorId]
    );
    // The Agent surface stays mounted, hidden, with its centre mode kept, so History can be mounted while another
    // surface is showing. Publish only while this surface is: a hidden History would otherwise take listNavAtom
    // from the visible surface's own list (Radar, Usage, Diff, Brief), whose j/k then go dead.
    const onSurface = useAtomValue(model.surfaceAtom) === "agent";
    useSurfaceListNav(onSurface ? listNav : null);

    const runTitles = Object.fromEntries(runRows.map((r) => [r.run!.group.runId, r.run!.view.title]));
    const detailKind = selRun ? "run" : selSession ? "solo" : "feed";

    return (
        <MotionConfig reducedMotion="user">
            <div data-agent-history className="flex h-full min-h-0 flex-col bg-background">
                <button
                    type="button"
                    data-agent-history-close
                    onClick={showTerminal}
                    className="ml-[28px] mt-3 flex w-fit flex-none cursor-pointer items-center gap-[6px] rounded-[6px] px-[6px] py-[3px] text-[12px] text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <ArrowLeft size={13} aria-hidden />
                    Back to terminal
                </button>
                <SurfaceHeader
                    title="Conversation History"
                    badge={
                        liveCount > 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-pill px-[9px] py-[3px] text-[10.5px] tabular-nums text-secondary">
                                <span className="h-1.5 w-1.5 pulse-dot rounded-full bg-working" />
                                {liveCount} {liveCount === 1 ? "agent" : "agents"} live
                            </span>
                        ) : null
                    }
                    actions={
                        <div
                            role="group"
                            aria-label="Status filter"
                            className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
                        >
                            {FILTERS.map((f) => (
                                <button
                                    key={f.key}
                                    type="button"
                                    aria-pressed={filter === f.key}
                                    onClick={() => setFilter(f.key)}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-1.5 rounded-[6px] px-[11px] py-[5px] text-[11.5px] font-semibold",
                                        filter === f.key
                                            ? "bg-accentbg text-primary"
                                            : "text-ink-mid hover:text-primary"
                                    )}
                                >
                                    {f.label}
                                    {f.key === "needs" && needsCount > 0 ? (
                                        <span className="text-[10.5px] tabular-nums text-asking">{needsCount}</span>
                                    ) : null}
                                </button>
                            ))}
                        </div>
                    }
                />

                {activeSpace != null ? (
                    <FocusBanner
                        surface="history"
                        copy={focusBannerCopy(
                            activeSpace.label,
                            spaceInScope,
                            projectScoped.length,
                            spaceRevealed,
                            "sessions"
                        )}
                        revealed={spaceRevealed}
                    />
                ) : null}

                {loadError ? (
                    <SurfaceError
                        message="Couldn’t load sessions."
                        onRetry={() => fireAndForget(loadSessionsArchive)}
                    />
                ) : null}

                <div className="flex min-h-0 flex-1">
                    <div className="flex w-[380px] flex-none flex-col gap-1.5 overflow-y-auto border-r border-edge-faint p-3 pb-10">
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
                            <Activity size={14} strokeWidth={1.8} className="flex-none text-ink-mid" aria-hidden />
                            <span className="flex-1 text-[12.5px] font-semibold text-secondary">All activity</span>
                            <span className="text-[10.5px] tabular-nums text-muted">
                                {totalEvents(scopedSessions)} events
                            </span>
                        </button>

                        {base == null ? (
                            <div className="mt-3 flex flex-col gap-[7px]">
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <SkeletonLine key={i} className="h-[58px] rounded-[10px]" />
                                ))}
                            </div>
                        ) : groups.length === 0 && focusHidesAll ? (
                            <div className="mt-6">
                                <SurfaceEmptyState
                                    title="Nothing in this focus"
                                    body={`No live session belongs to ${activeSpace.label}. The focus hides all ${projectScoped.length}.`}
                                    action={{
                                        label: `Show all ${projectScoped.length}`,
                                        onClick: () => revealSurface("history"),
                                    }}
                                    secondaryAction={{ label: "Clear focus", onClick: exitFocus }}
                                />
                            </div>
                        ) : groups.length === 0 ? (
                            <div className="mt-6">
                                <SurfaceEmptyState
                                    title="No sessions found"
                                    body="Sessions appear here as agents run. Start one to begin."
                                    action={{
                                        label: "New agent",
                                        onClick: () => globalStore.set(model.newAgentOpenAtom, true),
                                    }}
                                />
                            </div>
                        ) : (
                            groups.map((g) => (
                                <div key={g.key} className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-2.5 px-1 pb-0.5 pt-3">
                                        <span className={cn(REGION_LABEL, "text-muted")}>{g.label}</span>
                                        <div className="h-px flex-1 bg-edge-faint" />
                                        <span className="text-[10.5px] tabular-nums text-muted">{g.items.length}</span>
                                    </div>
                                    <AnimatePresence initial={false} mode="popLayout">
                                        {g.items.map((r) =>
                                            r.run ? (
                                                <RunCard
                                                    key={r.key}
                                                    view={r.run.view}
                                                    active={viewRunId === r.run.group.runId}
                                                    member={member}
                                                    now={now}
                                                    onSelect={() => select(r.key)}
                                                    onMember={(key) => selectMember(r.run!.group.runId, key)}
                                                />
                                            ) : (
                                                <SoloCard
                                                    key={r.key}
                                                    session={r.session!}
                                                    active={sel === r.key}
                                                    now={now}
                                                    onSelect={() => setSel(r.key)}
                                                />
                                            )
                                        )}
                                    </AnimatePresence>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col px-8 py-[22px]">
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={detailKind}
                                className="flex min-h-0 flex-1 flex-col"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                            >
                                {selRun && selMember ? (
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
                        <span className="flex gap-[3px]" aria-hidden="true">
                            {view.segs.map((k, i) => (
                                <span
                                    key={i}
                                    className="h-1 w-3.5 rounded-[2px]"
                                    style={{ backgroundColor: view.complete ? "var(--color-success)" : SEG_COLOR[k] }}
                                />
                            ))}
                        </span>
                    ) : null}
                    {view.complete ? (
                        <span className="flex items-center gap-[5px] text-success">
                            <Check size={11} aria-hidden className="flex-none" />
                            {view.total > 0 ? `${view.landed}/${view.total} landed` : "complete"}
                        </span>
                    ) : (
                        <span>{view.total > 0 ? `${view.landed}/${view.total} landed` : "planning"}</span>
                    )}
                    <span className="flex-1" />
                    <span className="truncate">
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
}: {
    session: LiveSession;
    active: boolean;
    now: number;
    onSelect: () => void;
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
            onClick={onSelect}
            className={cn(
                "flex w-full cursor-pointer flex-col gap-2 rounded-[10px] border px-3 py-2.5 text-left",
                active ? "border-accent bg-surface-selected" : "border-border bg-surface hover:border-edge-strong"
            )}
        >
            <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary">
                    {session.task || "(untitled session)"}
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
