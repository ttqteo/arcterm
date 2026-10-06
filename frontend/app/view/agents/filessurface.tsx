// frontend/app/view/agents/filessurface.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Diff surface (Wave-git-review.dc.html): three panes on one time axis — commit history with a lane
// gutter (historypane), the selected commit's metadata + files (commitpane), and that file's diff
// (diffpane). Uncommitted work is row zero of the history, not a separate mode. Read-only.

import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { joinRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { RefreshCw, RotateCcw } from "lucide-react";
import { MotionConfig } from "motion/react";
import { buildFilesBindings } from "@/app/store/keybindings/bindings";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import { useKeybindings } from "@/app/store/keybindings/store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSyncMonacoTheme } from "@/app/monaco/monacotheme";
import type { AgentsViewModel } from "./agents";
import { formatAge } from "./agentsviewmodel";
import { DiffPane } from "./diffpane";
import type { CompareForm, DiffSelection } from "./diffcontent";
import { clearDiffPair, loadDiffPair } from "./diffcontentstore";
import { defaultFocusId, focusFollowAgent, sourceFor, type FilesSource } from "./diffsource";
import {
    filesErrorAtom,
    filesStateAtom,
    loadFilesForScope,
    startChangesPoll,
    type FilesProject,
    type FilesState,
} from "./filesstore";
import { availableRanges, historyOptsFor, originKey, rangeKey, scopeKey, summaryLine } from "./diffscope";
import { agentDiffScope, diffScopeOfRun, openDiff, projectDiffScope } from "./agentdiffnav";
import { DivergenceBanner } from "./focusbanner";
import { activeFocusAtom } from "./focusstore";
import { subjectDecision, type SubjectDecision } from "./focussubject";
import { setDiffRange } from "./diffscopeatom";
import { historyCollapsedAtom, resolveCollapsed } from "./difflayout";
import { HistoryRail } from "./historyrail";
import { peekSessionStart } from "./agentsessionstore";
import { RangeStrip } from "./rangestrip";
import { projectListAtom } from "./projectsstore";
import { CommitPane } from "./commitpane";
import { AggregatePane } from "./aggregatepane";
import { CompareColumn } from "./comparecolumn";
import { AGGREGATE, buildCompareRows, compareNavIds, type CompareCommitRow } from "./comparerows";
import {
    compareActiveChangesAtom,
    compareAggregateAtom,
    compareBranchesAtom,
    compareErrorAtom,
    compareOnAtom,
    compareRefsAtom,
    compareSelectedFileAtom,
    compareSelectionAtom,
    compareSidesAtom,
    dismissFetchFailure,
    enterCompare,
    fetchStateOf,
    fetchStatesAtom,
    leaveCompare,
    runFetch,
    selectCompareFile,
    selectCompareRow,
    setCompareForm,
    setCompareRefs,
    swapCompareRefs,
} from "./comparestore";
import { RefPicker } from "./refpicker";
import {
    activeChangesAtom,
    dismissRestoreNotice,
    graphOnAtom,
    historyAppendAtom,
    historyFailureAtom,
    historyFilteredAtom,
    historyFiltersAtom,
    historyHasMoreAtom,
    historyRowsAtom,
    historyScrollAtom,
    loadHistory,
    loadMoreHistory,
    noteSurfaceLeft,
    refreshHistoryIfMoved,
    resetHistory,
    restoreNoticeAtom,
    retryHistory,
    selectCommit,
    selectCommitFile,
    selectedCommitAtom,
    selectedFileAtom,
    setHistoryOpts,
    startFromTop,
} from "./githistorystore";
import { GitFailureNotice, GitFailurePanel, NotARepoPanel, SurfaceBanner } from "./gitstatepanels";
import { HistoryPane } from "./historypane";
import { RESTORE_DISMISS_MS, countLabel } from "./historyquery";
import { WORKING_TREE, worktreeCaption } from "./historyrows";
import { SourcePicker } from "./sourcepicker";
import { SurfaceEmptyState, SurfaceError } from "./surfacescaffold";

// What the change poll saw, as one string: Review re-reads the whole patch only when this moves, not on
// every tick the way the single-file diff does (that one reads a single file).
function liveChangesKey(s: FilesState): string {
    return `${s.head}|${(s.changes?.files ?? []).map((f) => `${f.path}:${f.status}:${f.adds}:${f.dels}`).join(",")}`;
}

export function FilesSurface({ model }: { model: AgentsViewModel }) {
    const focusId = useAtomValue(model.focusIdAtom);
    const agents = useAtomValue(model.agentsAtom);
    const projects: FilesProject[] = useAtomValue(projectListAtom);
    const state = useAtomValue(filesStateAtom);
    const loadError = useAtomValue(filesErrorAtom);
    const historyRows = useAtomValue(historyRowsAtom);
    const historyFailure = useAtomValue(historyFailureAtom);
    const fetchStates = useAtomValue(fetchStatesAtom);
    const fetchState = fetchStateOf(fetchStates, state?.cwd);
    const historyFiltered = useAtomValue(historyFilteredAtom);
    const historyFilters = useAtomValue(historyFiltersAtom);
    const historyScroll = useAtomValue(historyScrollAtom);
    const historyHasMore = useAtomValue(historyHasMoreAtom);
    const historyAppend = useAtomValue(historyAppendAtom);
    const restoreMsg = useAtomValue(restoreNoticeAtom);
    const selectedCommit = useAtomValue(selectedCommitAtom);
    const selectedFile = useAtomValue(selectedFileAtom);
    const graphOn = useAtomValue(graphOnAtom);
    const activeChanges = useAtomValue(activeChangesAtom);
    const compareOn = useAtomValue(compareOnAtom);
    const compareRefs = useAtomValue(compareRefsAtom);
    const compareSides = useAtomValue(compareSidesAtom);
    const compareAggregate = useAtomValue(compareAggregateAtom);
    const compareSelection = useAtomValue(compareSelectionAtom);
    const compareFile = useAtomValue(compareSelectedFileAtom);
    const compareError = useAtomValue(compareErrorAtom);
    const compareBranches = useAtomValue(compareBranchesAtom);
    const compareChanges = useAtomValue(compareActiveChangesAtom);
    // the ref picker's own open/closed state: `c` and a click on the chip open it, Enter/Escape close it
    const [pickerOpen, setPickerOpen] = useState(false);
    // a file clicked in the commit pane's list, for Review to scroll to; n tells two clicks on one file apart
    const [reviewScroll, setReviewScroll] = useState<{ path: string; n: number } | null>(null);

    // The history column folds to a rail below a width threshold. Measured on the surface root rather
    // than the window: the surface does not own the whole window, and the rail's whole purpose is to
    // leave the diff pane something to render in.
    const surfaceRef = useRef<HTMLDivElement>(null);
    const [surfaceWidth, setSurfaceWidth] = useState(0);
    const collapsed = resolveCollapsed(useAtomValue(historyCollapsedAtom), surfaceWidth);

    // Rebuilt from the raw divergence on every render: buildCompareRows is pure and the input is at
    // most a few hundred commits, the same reasoning the history rows use.
    const compareRows = useMemo(
        () =>
            compareRefs == null
                ? []
                : buildCompareRows({
                      base: compareRefs.base,
                      head: compareRefs.head,
                      ahead: compareSides?.ahead ?? [],
                      behind: compareSides?.behind ?? [],
                      aggregate: compareAggregate,
                      now: Date.now(),
                  }),
        [compareRefs, compareSides, compareAggregate]
    );

    // The surface's stored subject: which repository, and which range within it.
    const scope = useAtomValue(model.diffScopeAtom);
    const origin = scope?.repo.origin;
    const agent = origin?.kind === "agent" ? agents.find((a) => a.id === origin.id) : undefined;
    const source: FilesSource | null = sourceFor(scope, focusId);

    const pickAgent = (id: string) => {
        const a = agents.find((x) => x.id === id);
        globalStore.set(model.diffScopeAtom, agentDiffScope(id, a?.name ?? id));
        globalStore.set(model.focusIdAtom, id);
    };
    const pickProject = (p: FilesProject) => {
        globalStore.set(model.diffScopeAtom, projectDiffScope(p.name, p.path));
    };

    // Entering compare is a repo-scoped two-ref read, so it needs a cwd and a branch to start from.
    const startCompare = () => {
        if (!state?.cwd || !state.isRepo) {
            return;
        }
        setPickerOpen(true);
        fireAndForget(() => enterCompare(state.cwd!, state.branch ?? ""));
    };
    // The ref fields are this surface's own state; the range itself is restored by the store.
    const stopCompare = () => {
        setPickerOpen(false);
        leaveCompare();
    };

    // Files declares "subject" posture on both dimensions. A task focus is deliberately not a subject
    // here: its bundle spans many agents and runs, so there is no single diff to open and nothing for
    // "Follow focus" to do. Only an agent or a run names one.
    const cockpitFocus = useAtomValue(activeFocusAtom);
    const diffFocus = cockpitFocus?.ref.kind === "agent" || cockpitFocus?.ref.kind === "run" ? cockpitFocus : null;

    // Reuses the shared builders + openDiff rather than assembling a DiffScope, so the scope key the
    // loader guards on is the same string every other entry point produces.
    const openFocusedDiff = useCallback(() => {
        if (diffFocus == null) {
            return;
        }
        if (diffFocus.ref.kind === "agent") {
            openDiff(model, agentDiffScope(diffFocus.ref.id, diffFocus.label));
            return;
        }
        fireAndForget(async () => {
            const run = await WOS.loadAndPinWaveObject<Run>(WOS.makeORef("run", diffFocus.ref.id));
            if (run != null) {
                openDiff(model, diffScopeOfRun(run));
            }
        });
    }, [model, diffFocus?.ref.kind, diffFocus?.ref.id, diffFocus?.label]);

    // An explicit cockpit focus outranks both fallbacks below, which exist only to fill an otherwise
    // empty surface. While it is seeding they stand down, or the run seed (async, via a WOS read)
    // would land after the adopt-the-first-agent fallback had already claimed the scope.
    const focusSeeding = scope == null && diffFocus != null;
    useEffect(() => {
        if (focusSeeding) {
            openFocusedDiff();
        }
    }, [focusSeeding, openFocusedDiff]);

    // Both rules live in diffsource.ts: whether focus may move the surface, and what to show when
    // nothing has been picked yet. The effects are the only part that has to be an effect.
    useEffect(() => {
        if (focusSeeding) {
            return;
        }
        const a = focusFollowAgent(scope, focusId, agents);
        if (a != null) {
            globalStore.set(model.diffScopeAtom, agentDiffScope(a.id, a.name));
        }
    }, [focusId, scope, agents, focusSeeding]);

    useEffect(() => {
        if (focusSeeding) {
            return;
        }
        const id = defaultFocusId(scope, focusId, agents);
        if (id != null) {
            globalStore.set(model.focusIdAtom, id);
        }
    }, [scope, focusId, agents, focusSeeding]);

    // The surface unmounts on every nav switch; stamping the time on the way out is all it has to do.
    // The next history load decides whether anything is worth announcing (historyquery.restoreNotice).
    useEffect(() => () => noteSurfaceLeft(), []);

    // Keeps the change list from going stale while this surface is on screen; stops the moment it isn't.
    useEffect(() => startChangesPoll(), []);

    useEffect(() => {
        const el = surfaceRef.current;
        if (el == null) {
            return;
        }
        const ro = new ResizeObserver(() => setSurfaceWidth(el.clientWidth));
        ro.observe(el);
        setSurfaceWidth(el.clientWidth);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (restoreMsg == null) {
            return;
        }
        const t = setTimeout(() => dismissRestoreNotice(), RESTORE_DISMISS_MS);
        return () => clearTimeout(t);
    }, [restoreMsg]);

    // Which subject the surface is scoped to, in the same vocabulary filesstore's loader uses as its
    // guard token. Both the change-list load and the history load are keyed off this, so a deep link
    // built for one of them is claimable by the other.
    const loadScope = scope ? scopeKey(scope) : undefined;

    useEffect(() => {
        if (scope == null) {
            return;
        }
        fireAndForget(() =>
            loadFilesForScope(scope, { transcriptPath: agent?.transcriptPath, blockId: agent?.blockId })
        );
    }, [loadScope, agent?.transcriptPath, agent?.blockId]);

    // History follows whatever directory the change-list load resolved. The anchor and its labels are
    // derived from the range, and are pushed separately so switching range relabels without a re-read.
    useEffect(() => {
        // A null state means the change list is still loading, not that there is no repository here:
        // beginLoad() nulls it at the start of every load, including the one this surface fires on
        // every mount. Resetting on that transient would wipe the scroll offset, the filters and the
        // selection on every return to the surface — the exact state this surface exists to keep.
        if (state == null || scope == null) {
            return;
        }
        // A failed change-list read also lands here as isRepo:false, but a repository git cannot read
        // is not an absent one. Ask git for the history anyway: its refusal is what carries the real
        // message the failure panel shows.
        if (!state.cwd || (!state.isRepo && !loadError)) {
            resetHistory();
            return;
        }
        // loadScope names the subject this load is for, so it can claim a file an evidence card or an
        // agent's file rail asked for, once that scope's change set is in.
        fireAndForget(() => loadHistory(state.cwd, historyOptsFor(scope.range, state.ref), loadScope));
    }, [state?.cwd, state?.isRepo, state?.ref, loadScope, loadError]);

    useEffect(() => {
        if (scope == null || state == null) {
            return;
        }
        setHistoryOpts(historyOptsFor(scope.range, state.ref));
    }, [scope && rangeKey(scope.range), state?.ref]);

    // A commit landing under the open surface — an agent committing in the worktree this is scoped to,
    // or a commit made in another window — has to reach the commit column. The change-list poll above
    // is the only thing reading the repository on a timer, so HEAD rides along with it and this keys on
    // the sha: one log re-read per actual commit, nothing at all on a quiet tick. The store decides
    // whether the sha really moved, so the first value after a load is not a second read.
    useEffect(() => {
        refreshHistoryIfMoved(state?.head ?? "");
    }, [state?.head]);

    // Which range form the comparison is asking about. The scope is the one place that says so, which
    // is what keeps the file list and the diff pane from answering two different questions.
    const compareForm: CompareForm = scope?.range.kind === "compare" ? scope.range.form : "mergebase";

    // What the diff pane is showing. The header's +/- come from the row that is already loaded, so
    // opening a file costs no extra read.
    const shownPath = compareOn ? compareFile : selectedFile;
    const shownChanges = compareOn ? compareChanges : activeChanges;
    const selectedChange = shownChanges?.files.find((f) => f.path === shownPath) ?? null;
    // The working-tree side is live — an agent editing under this surface must not leave a stale diff
    // on screen. The change poll replaces filesStateAtom on every tick, so its identity IS the tick;
    // a commit or a comparison is immutable and stays out of the dep so it is read exactly once.
    const liveTick = !compareOn && selectedCommit === WORKING_TREE ? state : null;

    // publish the visible column's rows for global j/k list-nav. cursor == selection: moving selects,
    // which loads that row's files and first diff. Must run before the early return (hooks rules).
    const navIds = compareOn ? compareNavIds(compareRows) : (historyRows ?? []).map((r) => r.hash);
    const navCursor = compareOn ? compareSelection : (selectedCommit ?? undefined);
    const navFile = shownPath;
    const listNav = useMemo<ListNavController | null>(
        () =>
            state?.cwd && navIds.length > 0
                ? {
                      surface: "files",
                      navigableIds: navIds,
                      cursorId: navCursor,
                      setCursor: (id) =>
                          fireAndForget(() =>
                              compareOn ? selectCompareRow(state.cwd!, id) : selectCommit(state.cwd!, id)
                          ),
                      activate:
                          navFile && state.cwd ? () => getApi().openExternal(joinRepoPath(state.cwd!, navFile)) : undefined,
                      // Tab needs to know which side a row belongs to, which an id list cannot say.
                      rows: compareOn ? compareRows : undefined,
                  }
                : null,
        [state?.cwd, compareOn, navIds.join(" "), navCursor, navFile, compareRows]
    );
    useSurfaceListNav(listNav);

    // stable array: every run() reads live atoms, so it never needs rebuilding
    const filesBindings = useMemo(() => buildFilesBindings(), []);
    useKeybindings(filesBindings);

    // the diff pane is Monaco, which reads the same theme tokens the Code surface syncs
    useSyncMonacoTheme();

    // One place decides which two refs the pane reads; the three selection states differ only in
    // what they name, which is diffcontent.ts's whole job.
    useEffect(() => {
        const cwd = state?.cwd;
        if (!cwd || !shownPath) {
            clearDiffPair();
            return;
        }
        // In compare mode only the aggregate row means "the whole comparison"; a commit row there is
        // still one commit against its parent, exactly as in history.
        const sel: DiffSelection = compareOn
            ? compareSelection === AGGREGATE
                ? {
                      kind: "compare",
                      base: compareRefs?.base ?? "",
                      head: compareRefs?.head ?? "",
                      mergeBase: compareSides?.mergeBase ?? "",
                      form: compareForm,
                  }
                : { kind: "commit", hash: compareSelection ?? "" }
            : selectedCommit === WORKING_TREE
              ? { kind: "worktree", anchorRef: state?.ref ?? "" }
              : { kind: "commit", hash: selectedCommit ?? "" };
        fireAndForget(() => loadDiffPair(cwd, shownPath, sel));
    }, [
        state?.cwd,
        state?.ref,
        shownPath,
        compareOn,
        compareRefs?.base,
        compareRefs?.head,
        compareSides?.mergeBase,
        compareSelection,
        compareForm,
        selectedCommit,
        liveTick,
    ]);

    if (agents.length === 0 && projects.length === 0) {
        return (
            <SurfaceEmptyState
                title="No changes to show"
                body="Start an agent or pick a project to see its changed files here."
                action={{ label: "New agent", onClick: () => globalStore.set(model.newAgentOpenAtom, true) }}
            />
        );
    }
    const selectedRow = (historyRows ?? []).find((r) => r.hash === selectedCommit) ?? null;
    const collapseHistory = () => globalStore.set(historyCollapsedAtom, true);

    // Compared by entity key — originKey's own vocabulary, which is the identity — then relabelled for
    // display, because "agent:9f2c1de…" is not something to show a user.
    const rawDecision = subjectDecision(
        origin == null ? null : originKey(origin),
        diffFocus == null ? null : `${diffFocus.ref.kind}:${diffFocus.ref.id}`
    );
    const decision: SubjectDecision =
        rawDecision.kind === "diverged"
            ? { kind: "diverged", focus: diffFocus.label, local: scope.repo.label }
            : rawDecision;

    return (
        <MotionConfig reducedMotion="user">
            <div ref={surfaceRef} className="absolute inset-0 flex min-h-0 flex-col">
                <DivergenceBanner scope="focus" decision={decision} onRejoin={openFocusedDiff} />
                {/* subject bar: which repository, and which range within it */}
                <div className="flex-none px-[18px] pt-[14px]">
                    {/* wraps because compare adds two controls to this row: at the shipped 1000x700 the
                        ref picker's editing form plus Fetch need 901px of an 886px row, and a nowrap flex
                        pays for that by squeezing the source picker from its 210px to 155px and pushing
                        Fetch off the window edge. Wrapping costs a second line only at the width that
                        cannot hold one. */}
                    <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[8px] pb-[12px]">
                        <h1 className="flex-none text-[16px] font-bold">Diff</h1>
                        <div className="w-[210px] rounded-[9px] bg-surface">
                            <SourcePicker
                                agents={agents}
                                projects={projects}
                                source={source}
                                currentLabel={scope?.repo.label}
                                onPickAgent={pickAgent}
                                onPickProject={pickProject}
                            />
                        </div>
                        {scope ? (
                            <RangeStrip
                                options={availableRanges(scope, {
                                    sessionStartTs: peekSessionStart(agent?.transcriptPath),
                                    sessionRef: state?.ref ?? "",
                                })}
                                active={scope.range}
                                onPick={(r) =>
                                    r.kind === "compare"
                                        ? startCompare()
                                        : compareOn
                                          ? (stopCompare(), setDiffRange(r))
                                          : setDiffRange(r)
                                }
                            />
                        ) : null}
                        {compareOn ? (
                            <RefPicker
                                base={compareRefs?.base ?? ""}
                                head={compareRefs?.head ?? ""}
                                branches={compareBranches}
                                editing={pickerOpen}
                                onEdit={() => setPickerOpen(true)}
                                onApply={(b, h) => {
                                    setPickerOpen(false);
                                    if (state?.cwd) {
                                        fireAndForget(() => setCompareRefs(state.cwd!, b, h));
                                    }
                                }}
                                onCancel={() => setPickerOpen(false)}
                                onSwap={() => state?.cwd && fireAndForget(() => swapCompareRefs(state.cwd!))}
                            />
                        ) : null}
                        {compareOn ? (
                            <div className="flex items-center gap-[7px]">
                                <button
                                    onClick={() => state?.cwd && fireAndForget(() => runFetch(state.cwd!))}
                                    disabled={fetchState.running}
                                    title="Update remote-tracking refs"
                                    className={cn(
                                        "flex flex-none items-center gap-[6px] rounded-[7px] border border-edge-mid px-[9px] py-[5px] text-[11.5px] font-semibold",
                                        fetchState.running
                                            ? "text-ink-faint opacity-50"
                                            : "text-ink-mid hover:border-edge-strong hover:text-foreground"
                                    )}
                                >
                                    <RefreshCw size={13} className={cn(fetchState.running && "animate-spin")} />
                                    {fetchState.running ? "Fetching…" : "Fetch"}
                                </button>
                                {/* A remote-tracking ref is only as fresh as the last fetch, so the
                                    clock is part of reading the comparison. Absent until one has
                                    happened — "just now" on an unfetched session would be a lie. */}
                                {fetchState.at > 0 ? (
                                    <span className="text-[10.5px] tabular-nums text-muted">
                                        fetched {formatAge(Date.now() - fetchState.at * 1000)} ago
                                    </span>
                                ) : null}
                            </div>
                        ) : null}
                        <div className="flex-1" />
                        {scope ? (
                            <span
                                data-files-range-summary
                                className="min-w-0 truncate text-[11.5px] tabular-nums text-ink-faint"
                            >
                                {summaryLine({
                                    range: scope.range,
                                    branch: state?.branch ?? "",
                                    ref: state?.ref ?? "",
                                    mergeBase: compareSides?.mergeBase ?? "",
                                    commit: compareOn
                                        ? compareSelection === AGGREGATE
                                            ? null
                                            : compareSelection
                                        : selectedCommit === WORKING_TREE
                                          ? null
                                          : selectedCommit,
                                    changes: shownChanges,
                                })}
                            </span>
                        ) : null}
                    </div>
                </div>

                {restoreMsg ? (
                    <SurfaceBanner
                        data-restore-notice
                        tone="neutral"
                        icon={<RotateCcw size={14} />}
                        action={{ label: "Start from the top", onClick: startFromTop }}
                        onDismiss={dismissRestoreNotice}
                    >
                        <span className="min-w-0 flex-1 truncate text-ink-hi">{restoreMsg}</span>
                    </SurfaceBanner>
                ) : null}

                {fetchState.failure ? (
                    <GitFailureNotice
                        failure={fetchState.failure}
                        onRetry={() => state?.cwd && fireAndForget(() => runFetch(state.cwd!))}
                        onDismiss={() => state?.cwd && dismissFetchFailure(state.cwd)}
                    />
                ) : null}

                {/* the detailed panel below says the same thing with git's own words behind it */}
                {loadError && historyFailure == null ? <SurfaceError message="Couldn’t read this repository." /> : null}

                {/* a broken read is checked first: it also reports isRepo:false, and showing it as an
                    absent repository would hide the reason behind a screen that reads like normality */}
                {historyFailure ? (
                    <GitFailurePanel failure={historyFailure} onRetry={() => retryHistory()} />
                ) : state?.isRepo === false && state?.cwd ? (
                    <NotARepoPanel
                        path={state.cwd}
                        // the same click-through the bindings use to open the picker
                        onChooseSource={() =>
                            document.querySelector<HTMLElement>("[data-files-source-picker]")?.click()
                        }
                    />
                ) : (
                    <div className="flex min-h-0 flex-1 border-t border-edge-faint">
                        <div
                            className={cn(
                                "flex flex-none flex-col border-r border-edge-faint",
                                collapsed ? "w-[44px]" : "w-[460px]"
                            )}
                        >
                            {collapsed ? (
                                <HistoryRail
                                    // a compare commit row IS a HistoryRow, so the rail takes it directly
                                    rows={
                                        compareOn
                                            ? (compareRows.filter((r) => r.kind === "commit") as CompareCommitRow[])
                                            : (historyRows ?? [])
                                    }
                                    selected={compareOn ? compareSelection : selectedCommit}
                                    onSelect={(hash) =>
                                        state?.cwd &&
                                        fireAndForget(() =>
                                            compareOn
                                                ? selectCompareRow(state.cwd!, hash)
                                                : selectCommit(state.cwd!, hash)
                                        )
                                    }
                                    onExpand={() => globalStore.set(historyCollapsedAtom, false)}
                                />
                            ) : (
                                <>
                                    {compareOn ? (
                                        <CompareColumn
                                            rows={compareRows}
                                            selected={compareSelection}
                                            mergeBase={compareSides?.mergeBase ?? ""}
                                            mergeBaseTs={compareSides?.mergeBaseTs ?? 0}
                                            onCollapse={collapseHistory}
                                            error={compareError}
                                            loading={compareSides == null && compareError == null}
                                            onSelect={(id) =>
                                                state?.cwd && fireAndForget(() => selectCompareRow(state.cwd!, id))
                                            }
                                        />
                                    ) : (
                                        <HistoryPane
                                            rows={historyRows ?? []}
                                            selected={selectedCommit}
                                            // a filtered set mostly lacks its own parents, so lane assignment
                                            // would sprawl to the fold limit and draw edges to commits that
                                            // are not there
                                            graphOn={graphOn && !historyFiltered}
                                            loading={historyRows == null}
                                            countLabel={countLabel(
                                                historyFilters,
                                                historyRows?.length ?? 0,
                                                historyRows == null
                                            )}
                                            filtered={historyFiltered}
                                            initialScroll={historyScroll}
                                            hasMore={historyHasMore}
                                            appendState={historyAppend}
                                            onSelect={(hash) =>
                                                state?.cwd && fireAndForget(() => selectCommit(state.cwd!, hash))
                                            }
                                            onScroll={(top) => globalStore.set(historyScrollAtom, top)}
                                            onLoadMore={() => fireAndForget(() => loadMoreHistory())}
                                            onCollapse={collapseHistory}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                        <div className="flex w-[300px] flex-none flex-col border-r border-edge-faint bg-surface">
                            {compareOn ? (
                                compareSelection === AGGREGATE ? (
                                    <AggregatePane
                                        base={compareRefs?.base ?? ""}
                                        head={compareRefs?.head ?? ""}
                                        form={compareForm}
                                        mergeBase={compareSides?.mergeBase ?? ""}
                                        changes={compareChanges}
                                        selectedFile={compareFile}
                                        onSelectFile={(path) => selectCompareFile(path)}
                                        onSetForm={(f) =>
                                            state?.cwd && fireAndForget(() => setCompareForm(state.cwd!, f))
                                        }
                                    />
                                ) : (
                                    // a compare commit row *is* a HistoryRow, so the shipped pane takes it directly
                                    <CommitPane
                                        row={
                                            (compareRows.find(
                                                (r) => r.kind === "commit" && r.id === compareSelection
                                            ) as CompareCommitRow | undefined) ?? null
                                        }
                                        changes={compareChanges}
                                        selectedFile={compareFile}
                                        onSelectFile={(path) => selectCompareFile(path)}
                                    />
                                )
                            ) : (
                                <CommitPane
                                    row={selectedRow}
                                    caption={
                                        scope && state
                                            ? worktreeCaption(scope.range, state.branch, state.head, state.ref)
                                            : undefined
                                    }
                                    changes={activeChanges}
                                    selectedFile={selectedFile}
                                    onSelectFile={(path) => {
                                        if (selectedCommit != null) {
                                            selectCommitFile(selectedCommit, path);
                                        }
                                        setReviewScroll((prev) => ({ path, n: (prev?.n ?? 0) + 1 }));
                                    }}
                                />
                            )}
                        </div>
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                            <DiffPane
                                path={shownPath}
                                adds={selectedChange?.adds ?? 0}
                                dels={selectedChange?.dels ?? 0}
                                // "Open in editor" only makes sense for a path that exists in the working tree
                                editorCwd={!compareOn && selectedCommit === WORKING_TREE ? (state?.cwd ?? null) : null}
                                // "Open in Code" wants only the repository: the Code surface always shows the
                                // working-tree file, and says so itself when the path is gone
                                repoCwd={state?.cwd ?? null}
                                nothingToCompare={
                                    compareOn &&
                                    compareSelection === AGGREGATE &&
                                    compareChanges != null &&
                                    compareChanges.files.length === 0
                                        ? { base: compareRefs?.base ?? "", head: compareRefs?.head ?? "" }
                                        : null
                                }
                                model={model}
                                review={
                                    compareOn || selectedCommit == null
                                        ? null
                                        : {
                                              source: selectedCommit === WORKING_TREE ? "worktree" : selectedCommit,
                                              // the file list's own base, so Review shows what the list shows
                                              base: state?.ref ?? "",
                                              refreshKey: liveTick == null ? "" : liveChangesKey(liveTick),
                                              scrollTo: reviewScroll,
                                          }
                                }
                            />
                        </div>
                    </div>
                )}
            </div>
        </MotionConfig>
    );
}
