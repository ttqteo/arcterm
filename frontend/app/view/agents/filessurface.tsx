// frontend/app/view/agents/filessurface.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Diff surface: one left panel (diffpanel.tsx — a source dropdown over Commit | Log tabs) beside a wide diff
// (diffpane.tsx). Uncommitted work is row zero of the history, not a separate mode. The surface owns what to load and
// what the diff pane shows; the panel and the pane are views over the stores it feeds.

import { useSyncMonacoTheme } from "@/app/monaco/monacotheme";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { buildFilesBindings } from "@/app/store/keybindings/bindings";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import { useKeybindings } from "@/app/store/keybindings/store";
import { joinRepoPath, sameRepoPath } from "@/util/paths";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { RotateCcw } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentDiffScope, projectDiffScope } from "./agentdiffnav";
import type { AgentsViewModel } from "./agents";
import { AGGREGATE, buildCompareRows, compareNavIds } from "./comparerows";
import {
    compareActiveChangesAtom,
    compareAggregateAtom,
    compareOnAtom,
    compareRefsAtom,
    compareSelectedFileAtom,
    compareSelectionAtom,
    compareSidesAtom,
    dismissFetchFailure,
    fetchStateOf,
    fetchStatesAtom,
    runFetch,
    selectCompareFile,
    selectCompareRow,
} from "./comparestore";
import type { CompareForm, DiffSelection } from "./diffcontent";
import { clearDiffPair, loadDiffPair } from "./diffcontentstore";
import { panelAppliedKeyAtom, panelTabAtom, panelTabToApply } from "./difflayout";
import { DiffPane } from "./diffpane";
import { DiffPanel } from "./diffpanel";
import {
    defaultRangeFor,
    historyOptsFor,
    measuredAgainst,
    originCwd,
    rangeKey,
    scopeKey,
    type DiffOrigin,
} from "./diffscope";
import { defaultFocusId, focusFollowAgent } from "./diffsource";
import {
    filesErrorAtom,
    filesStateAtom,
    loadFilesForScope,
    startChangesPoll,
    type FilesProject,
    type FilesState,
} from "./filesstore";
import {
    activeChangesAtom,
    dismissRestoreNotice,
    historyFailureAtom,
    historyRowsAtom,
    loadHistory,
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
import { RESTORE_DISMISS_MS } from "./historyquery";
import { WORKING_TREE } from "./historyrows";
import { openLauncher } from "./launcherstore";
import { projectListAtom } from "./projectsstore";
import { revealSourcePicker } from "./sourcepicker";
import { SurfaceEmptyState, SurfaceError } from "./surfacescaffold";
import { worktreeLabel } from "./worktreesidebar";
import { diffSurfaceWidthAtom, panelShownFoldedAtom } from "./worktreesidebarstore";

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
    const restoreMsg = useAtomValue(restoreNoticeAtom);
    const selectedCommit = useAtomValue(selectedCommitAtom);
    const selectedFile = useAtomValue(selectedFileAtom);
    const activeChanges = useAtomValue(activeChangesAtom);
    const compareOn = useAtomValue(compareOnAtom);
    const compareRefs = useAtomValue(compareRefsAtom);
    const compareSides = useAtomValue(compareSidesAtom);
    const compareAggregate = useAtomValue(compareAggregateAtom);
    const compareSelection = useAtomValue(compareSelectionAtom);
    const compareFile = useAtomValue(compareSelectedFileAtom);
    const compareChanges = useAtomValue(compareActiveChangesAtom);
    const panelFolded = useAtomValue(panelShownFoldedAtom);
    // a file clicked in a list, for Review to scroll to; n tells two clicks on one file apart
    const [reviewScroll, setReviewScroll] = useState<{ path: string; n: number } | null>(null);

    // The whole surface, panel included: the panel's fold is judged by it, so folding never moves it.
    const rootRef = useRef<HTMLDivElement>(null);
    const surfaceRef = useRef<HTMLDivElement>(null);

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

    const pickAgent = (id: string) => {
        const a = agents.find((x) => x.id === id);
        globalStore.set(model.diffScopeAtom, agentDiffScope(id, a?.name ?? id));
        globalStore.set(model.focusIdAtom, id);
    };
    const pickProject = (p: FilesProject) => {
        globalStore.set(model.diffScopeAtom, projectDiffScope(p.name, p.path));
    };
    const pickWorktree = (project: string, wt: GitWorktree) => {
        const origin: DiffOrigin = { kind: "worktree", path: wt.path, project };
        globalStore.set(model.diffScopeAtom, {
            repo: { origin, label: worktreeLabel(wt) },
            range: defaultRangeFor(origin),
        });
    };

    // Both rules live in diffsource.ts: whether focus may move the surface, and what to show when
    // nothing has been picked yet. The effects are the only part that has to be an effect.
    useEffect(() => {
        const a = focusFollowAgent(scope, focusId, agents);
        if (a != null) {
            globalStore.set(model.diffScopeAtom, agentDiffScope(a.id, a.name));
        }
    }, [focusId, scope, agents]);

    useEffect(() => {
        const id = defaultFocusId(scope, focusId, agents);
        if (id != null) {
            globalStore.set(model.focusIdAtom, id);
        }
    }, [scope, focusId, agents]);

    // The surface unmounts on every nav switch; stamping the time on the way out is all it has to do.
    // The next history load decides whether anything is worth announcing (historyquery.restoreNotice).
    useEffect(() => () => noteSurfaceLeft(), []);

    // Keeps the change list from going stale while this surface is on screen; stops the moment it isn't.
    useEffect(() => startChangesPoll(), []);

    useEffect(() => {
        const root = rootRef.current;
        if (root == null) {
            return;
        }
        const measure = () => globalStore.set(diffSurfaceWidthAtom, root.clientWidth);
        const ro = new ResizeObserver(measure);
        ro.observe(root);
        measure();
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

    // The panel opens on the tab the subject calls for (difflayout.ts defaultPanelTab), once per subject and only when
    // its change list has arrived: a dirty project opens Commit, never Log off a list that has not landed. A comparison
    // is Log's own mode, so the key is the scope it interrupted: entering and leaving one never re-picks the tab.
    // Held in an atom, not a ref, so a return from another surface keeps the tab the person chose; openDiff clears it
    // when something else (the agent rail's View diff) sends them here.
    const tabScope =
        scope == null ? null : scope.range.kind === "compare" ? { ...scope, range: scope.range.from } : scope;
    const tabKey = tabScope ? scopeKey(tabScope) : "";
    const knownCwd = tabScope ? originCwd(tabScope.repo.origin) : null;
    const listLoaded = state != null && (knownCwd == null || (state.cwd != null && sameRepoPath(state.cwd, knownCwd)));
    const dirtyCount = state?.changes?.files.length ?? 0;
    useEffect(() => {
        if (scope == null || tabScope == null) {
            return;
        }
        const next = panelTabToApply(
            globalStore.get(panelAppliedKeyAtom),
            tabKey,
            listLoaded,
            tabScope.repo.origin.kind,
            scope.range.kind,
            dirtyCount
        );
        if (next != null) {
            globalStore.set(panelAppliedKeyAtom, tabKey);
            globalStore.set(panelTabAtom, next);
        }
    }, [tabKey, listLoaded, dirtyCount]);

    // the comparison lives in the Log tab, whichever way it was entered (`c`, the button, a branch's View diff)
    useEffect(() => {
        if (compareOn) {
            globalStore.set(panelTabAtom, "log");
        }
    }, [compareOn]);

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

    // A file clicked in a list (or stepped to from the folded header) opens in the diff, and Review scrolls to it.
    const revealFile = (path: string) => setReviewScroll((prev) => ({ path, n: (prev?.n ?? 0) + 1 }));
    const selectShownFile = (path: string) => {
        if (compareOn) {
            selectCompareFile(path);
            return;
        }
        if (selectedCommit != null) {
            selectCommitFile(selectedCommit, path);
        }
        revealFile(path);
    };

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
                          navFile && state.cwd
                              ? () => getApi().openExternal(joinRepoPath(state.cwd!, navFile))
                              : undefined,
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
                action={{ label: "New agent", onClick: () => openLauncher(model, "agent") }}
            />
        );
    }

    // a broken read is checked first: it also reports isRepo:false, and showing it as an absent repository would hide
    // the reason behind a screen that reads like normality
    const notARepo = historyFailure == null && state?.isRepo === false && !!state?.cwd;
    const unreadable = historyFailure != null || notARepo;
    // the panel holds the source dropdown, so a screen that says "pick another source" keeps it on show
    const showPanel = !panelFolded || unreadable;
    const commitShown = compareOn
        ? compareSelection === AGGREGATE
            ? null
            : compareSelection
        : selectedCommit === WORKING_TREE
          ? null
          : selectedCommit;

    return (
        <MotionConfig reducedMotion="user">
            <div ref={rootRef} className="absolute inset-0 flex min-h-0">
                {showPanel ? (
                    <DiffPanel
                        agents={agents}
                        projects={projects}
                        scope={scope}
                        focusId={focusId}
                        state={state}
                        compareRows={compareRows}
                        onPickAgent={pickAgent}
                        onPickProject={pickProject}
                        onPickWorktree={pickWorktree}
                        onRevealFile={revealFile}
                        unreadable={unreadable}
                    />
                ) : null}
                <div ref={surfaceRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="flex-none pt-[10px] empty:hidden">
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
                    </div>

                    {/* the detailed panel below says the same thing with git's own words behind it */}
                    {loadError && historyFailure == null ? (
                        <SurfaceError message="Couldn’t read this repository." />
                    ) : null}

                    {historyFailure ? (
                        <GitFailurePanel failure={historyFailure} onRetry={() => retryHistory()} />
                    ) : notARepo && state?.cwd ? (
                        <NotARepoPanel path={state.cwd} onChooseSource={revealSourcePicker} />
                    ) : (
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
                            against={scope ? measuredAgainst({ range: scope.range, commit: commitShown }) : ""}
                            folded={panelFolded}
                            onStepFile={selectShownFile}
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
                    )}
                </div>
            </div>
        </MotionConfig>
    );
}
