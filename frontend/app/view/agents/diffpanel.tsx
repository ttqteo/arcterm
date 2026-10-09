// frontend/app/view/agents/diffpanel.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Diff surface's left panel: a top bar with the source dropdown and Fetch, a Commit | Log tab strip, and the tab's
// body. Log is the history graph over the selected commit, split by a draggable divider; with a comparison on, the
// graph gives way to the branch's own commits under a compare bar. Commit lists the working tree's changes (a
// read-only list until the commit form lands). The panel is a view over the stores; the surface owns what to load.

import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { RefreshCw, X } from "lucide-react";
import { useRef, useState } from "react";
import { formatAge, type AgentVM } from "./agentsviewmodel";
import { AggregatePane } from "./aggregatepane";
import { ChangedFileList, TreeModeToggle } from "./changedfilelist";
import { CommitPane } from "./commitpane";
import { CompareColumn } from "./comparecolumn";
import { AGGREGATE, type CompareCommitRow, type CompareRow } from "./comparerows";
import {
    compareActiveChangesAtom,
    compareActiveChangesStatusAtom,
    compareBranchesAtom,
    compareErrorAtom,
    compareOnAtom,
    compareRefsAtom,
    compareSelectedFileAtom,
    compareSelectionAtom,
    compareSidesAtom,
    enterCompare,
    fetchStateOf,
    fetchStatesAtom,
    leaveCompare,
    retrySelectedCompareRow,
    runFetch,
    selectCompareFile,
    selectCompareRow,
    setCompareForm,
    setCompareRefs,
    swapCompareRefs,
} from "./comparestore";
import type { CompareForm } from "./diffcontent";
import {
    clampLogSplit,
    clampPanelWidth,
    commitTabCount,
    logSplitAtom,
    panelTabAtom,
    panelWidthAtom,
    type PanelTab,
} from "./difflayout";
import type { DiffScope } from "./diffscope";
import { diffScopeAtom } from "./diffscopeatom";
import type { FilesProject, FilesState } from "./filesstore";
import {
    activeChangesAtom,
    activeChangesStatusAtom,
    graphOnAtom,
    historyAppendAtom,
    historyFilteredAtom,
    historyFiltersAtom,
    historyHasMoreAtom,
    historyRowsAtom,
    historyScrollAtom,
    loadMoreHistory,
    retrySelectedCommit,
    selectCommit,
    selectCommitFile,
    selectedCommitAtom,
    selectedFileAtom,
} from "./githistorystore";
import { HistoryPane } from "./historypane";
import { countLabel } from "./historyquery";
import { WORKING_TREE, worktreeCaption } from "./historyrows";
import { RefPicker } from "./refpicker";
import { SourcePicker } from "./sourcepicker";

const TAB_BASE = "flex items-center gap-[6px] border-b-2 px-[10px] text-[12px] font-semibold";

function PanelTabButton({ id, count, active }: { id: PanelTab; count?: number | null; active: boolean }) {
    return (
        <button
            role="tab"
            data-panel-tab={id}
            aria-selected={active}
            onClick={() => globalStore.set(panelTabAtom, id)}
            title={id === "commit" ? "Commit (Shift+C)" : "Log (Shift+H)"}
            className={cn(
                TAB_BASE,
                active ? "border-foreground text-ink-hi" : "border-transparent text-muted hover:text-ink-hi"
            )}
        >
            {id === "commit" ? "Commit" : "Log"}
            {id === "commit" && count != null && count > 0 ? (
                <span className="text-[10.5px] font-medium tabular-nums text-muted">{count}</span>
            ) : null}
        </button>
    );
}

// The Fetch control the subject bar used to carry, in the panel's top bar. Task 9 turns the bar into the sync bar.
function FetchButton({ cwd }: { cwd: string | undefined }) {
    const states = useAtomValue(fetchStatesAtom);
    const fetch = fetchStateOf(states, cwd);
    return (
        <button
            data-fetch
            onClick={() => cwd && fireAndForget(() => runFetch(cwd))}
            disabled={fetch.running || !cwd}
            aria-label="Fetch"
            // a remote-tracking ref is only as fresh as the last fetch, so the clock is part of reading a comparison;
            // absent until one has happened, because "just now" on an unfetched session would be a lie
            title={
                fetch.running
                    ? "Fetching…"
                    : fetch.at > 0
                      ? `Fetch origin · fetched ${formatAge(Date.now() - fetch.at * 1000)} ago`
                      : "Fetch origin"
            }
            className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[6px] text-ink-mid hover:bg-surface-hover hover:text-ink-hi disabled:opacity-50"
        >
            <RefreshCw size={14} className={cn(fetch.running && "animate-spin")} />
        </button>
    );
}

// Commit tab, until its form arrives: the working tree's changed files, picked to read their diff against HEAD.
function CommitList({
    state,
    rangeKind,
    onRevealFile,
}: {
    state: FilesState | null;
    rangeKind: DiffScope["range"]["kind"] | null;
    onRevealFile: (path: string) => void;
}) {
    const selectedCommit = useAtomValue(selectedCommitAtom);
    const selectedFile = useAtomValue(selectedFileAtom);
    if (rangeKind != null && rangeKind !== "working") {
        return (
            <div className="px-[10px] py-[8px] text-[12px] leading-[1.5] text-ink-mid">
                The Commit tab lists a working tree's changes. The Log tab lists what changed since this source's start.
            </div>
        );
    }
    return (
        <ChangedFileList
            changes={state?.changes ?? null}
            selectedFile={selectedCommit === WORKING_TREE ? selectedFile : null}
            onSelectFile={(path) => {
                if (selectedCommit !== WORKING_TREE && state?.cwd) {
                    void selectCommit(state.cwd, WORKING_TREE);
                }
                selectCommitFile(WORKING_TREE, path);
                onRevealFile(path);
            }}
        />
    );
}

// The compare bar: the two refs, swap and leave, how far apart they are and which range form the file list reads.
function CompareBar({
    state,
    pickerOpen,
    setPickerOpen,
}: {
    state: FilesState | null;
    pickerOpen: boolean;
    setPickerOpen: (v: boolean) => void;
}) {
    const refs = useAtomValue(compareRefsAtom);
    const sides = useAtomValue(compareSidesAtom);
    const branches = useAtomValue(compareBranchesAtom);
    const scope = useAtomValue(diffScopeAtom);
    const form: CompareForm = scope?.range.kind === "compare" ? scope.range.form : "mergebase";
    const cwd = state?.cwd ?? undefined;
    const stop = () => {
        setPickerOpen(false);
        leaveCompare();
    };
    return (
        <div data-compare-bar className="flex flex-none flex-col gap-[6px] border-b border-border p-[8px]">
            <div className="flex items-center gap-[6px]">
                <RefPicker
                    base={refs?.base ?? ""}
                    head={refs?.head ?? ""}
                    branches={branches}
                    editing={pickerOpen}
                    onEdit={() => setPickerOpen(true)}
                    onApply={(b, h) => {
                        setPickerOpen(false);
                        if (cwd) {
                            fireAndForget(() => setCompareRefs(cwd, b, h));
                        }
                    }}
                    onCancel={() => setPickerOpen(false)}
                    onSwap={() => cwd && fireAndForget(() => swapCompareRefs(cwd))}
                />
                <button
                    onClick={stop}
                    aria-label="Leave compare"
                    title="Back to the log (Esc)"
                    className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[6px] text-ink-mid hover:bg-surface-hover hover:text-ink-hi"
                >
                    <X size={13} />
                </button>
            </div>
            <div className="flex items-center gap-[8px] text-[11px] text-muted">
                {sides != null ? (
                    <>
                        <span className="tabular-nums text-foreground">{sides.ahead.length} ahead</span>
                        <span>·</span>
                        <span className="tabular-nums">{sides.behind.length} behind</span>
                    </>
                ) : null}
                <span className="flex-1" />
                <span role="group" aria-label="What to compare" className="flex flex-none gap-[4px]">
                    {(["mergebase", "tips"] as const).map((f) => (
                        <button
                            key={f}
                            data-compare-form={f}
                            onClick={() => cwd && fireAndForget(() => setCompareForm(cwd, f))}
                            aria-pressed={form === f}
                            title={
                                f === "mergebase"
                                    ? `Only what ${refs?.head || "the branch"} added since it left ${refs?.base || "the base"} (three dots)`
                                    : "Everything that differs between the two tips (two dots)"
                            }
                            className={cn(
                                "rounded-[5px] border px-[7px] py-[1px] text-[11px]",
                                form === f
                                    ? "border-edge-strong bg-surface-raised text-ink-hi"
                                    : "border-edge-mid text-ink-mid hover:text-ink-hi"
                            )}
                        >
                            {f === "mergebase" ? `since it left ${refs?.base || "base"}` : "tip to tip"}
                        </button>
                    ))}
                </span>
            </div>
        </div>
    );
}

export function DiffPanel({
    agents,
    projects,
    scope,
    focusId,
    state,
    compareRows,
    onPickAgent,
    onPickProject,
    onPickWorktree,
    onRevealFile,
    unreadable,
}: {
    agents: AgentVM[];
    projects: FilesProject[];
    scope: DiffScope | null;
    focusId: string | undefined;
    state: FilesState | null;
    compareRows: CompareRow[];
    onPickAgent: (id: string) => void;
    onPickProject: (p: FilesProject) => void;
    onPickWorktree: (project: string, wt: GitWorktree) => void;
    // a file clicked in a list: Review scrolls to it
    onRevealFile: (path: string) => void;
    // the repository cannot be read: the surface says so beside the panel, and the tabs have nothing to list
    unreadable: boolean;
}) {
    const tab = useAtomValue(panelTabAtom);
    const width = clampPanelWidth(useAtomValue(panelWidthAtom));
    const split = clampLogSplit(useAtomValue(logSplitAtom));
    const compareOn = useAtomValue(compareOnAtom);
    // the ref picker's own open/closed state: `c` and a click on the chip open it, Enter/Escape close it
    const [pickerOpen, setPickerOpen] = useState(false);
    const logRef = useRef<HTMLDivElement>(null);
    const widthDrag = useRef<{ x: number; w: number } | null>(null);
    const splitDrag = useRef<{ y: number; f: number } | null>(null);

    const historyRows = useAtomValue(historyRowsAtom);
    const historyFilters = useAtomValue(historyFiltersAtom);
    const historyFiltered = useAtomValue(historyFilteredAtom);
    const historyScroll = useAtomValue(historyScrollAtom);
    const historyHasMore = useAtomValue(historyHasMoreAtom);
    const historyAppend = useAtomValue(historyAppendAtom);
    const graphOn = useAtomValue(graphOnAtom);
    const selectedCommit = useAtomValue(selectedCommitAtom);
    const selectedFile = useAtomValue(selectedFileAtom);
    const activeChanges = useAtomValue(activeChangesAtom);
    const activeChangesStatus = useAtomValue(activeChangesStatusAtom);
    const compareRefs = useAtomValue(compareRefsAtom);
    const compareSides = useAtomValue(compareSidesAtom);
    const compareSelection = useAtomValue(compareSelectionAtom);
    const compareFile = useAtomValue(compareSelectedFileAtom);
    const compareError = useAtomValue(compareErrorAtom);
    const compareChanges = useAtomValue(compareActiveChangesAtom);
    const compareChangesStatus = useAtomValue(compareActiveChangesStatusAtom);

    const cwd = state?.cwd ?? undefined;
    const compareForm: CompareForm = scope?.range.kind === "compare" ? scope.range.form : "mergebase";
    const selectedRow = (historyRows ?? []).find((r) => r.hash === selectedCommit) ?? null;

    // Entering compare is a repo-scoped two-ref read, so it needs a cwd and a branch to start from.
    const startCompare = () => {
        if (!state?.cwd || !state.isRepo) {
            return;
        }
        setPickerOpen(true);
        fireAndForget(() => enterCompare(state.cwd!, state.branch ?? ""));
    };

    const logBottom = compareOn ? (
        compareSelection === AGGREGATE ? (
            <AggregatePane
                base={compareRefs?.base ?? ""}
                head={compareRefs?.head ?? ""}
                form={compareForm}
                mergeBase={compareSides?.mergeBase ?? ""}
                changes={compareChanges}
                selectedFile={compareFile}
                onSelectFile={(path) => selectCompareFile(path)}
            />
        ) : (
            // a compare commit row *is* a HistoryRow, so the shipped pane takes it directly
            <CommitPane
                row={
                    (compareRows.find((r) => r.kind === "commit" && r.id === compareSelection) as
                        | CompareCommitRow
                        | undefined) ?? null
                }
                changes={compareChanges}
                listStatus={compareChangesStatus}
                onRetry={retrySelectedCompareRow}
                selectedFile={compareFile}
                onSelectFile={(path) => selectCompareFile(path)}
            />
        )
    ) : (
        <CommitPane
            row={selectedRow}
            listStatus={activeChangesStatus}
            onRetry={retrySelectedCommit}
            caption={scope && state ? worktreeCaption(scope.range, state.branch, state.head, state.ref) : undefined}
            changes={activeChanges}
            selectedFile={selectedFile}
            onSelectFile={(path) => {
                if (selectedCommit != null) {
                    selectCommitFile(selectedCommit, path);
                }
                onRevealFile(path);
            }}
        />
    );

    return (
        <div
            data-diff-panel="open"
            style={{ width }}
            className="relative flex min-h-0 flex-none flex-col border-r border-border bg-surface"
        >
            <div className="flex h-[40px] flex-none items-center gap-[6px] border-b border-border pl-[6px] pr-[8px]">
                <SourcePicker
                    agents={agents}
                    projects={projects}
                    scope={scope}
                    focusId={focusId}
                    filesState={state}
                    onPickAgent={onPickAgent}
                    onPickProject={onPickProject}
                    onPickWorktree={onPickWorktree}
                />
                <FetchButton cwd={cwd} />
            </div>
            <div className="flex h-[34px] flex-none items-stretch gap-[2px] border-b border-border px-[8px]">
                <div role="tablist" className="flex items-stretch gap-[2px]">
                    <PanelTabButton id="commit" count={commitTabCount(state)} active={tab === "commit"} />
                    <PanelTabButton id="log" active={tab === "log"} />
                </div>
                <div className="flex-1" />
                {tab === "log" && !compareOn ? (
                    <button
                        data-compare-button
                        onClick={startCompare}
                        title="Compare two refs (c)"
                        className="h-[24px] flex-none self-center rounded-[6px] border border-edge-mid px-[9px] text-[11px] text-ink-mid hover:border-edge-strong hover:text-ink-hi"
                    >
                        Compare…
                    </button>
                ) : null}
                {tab === "commit" ? (
                    <span className="flex flex-none items-center">
                        <TreeModeToggle />
                    </span>
                ) : null}
            </div>

            {unreadable ? null : tab === "commit" ? (
                <div
                    role="tabpanel"
                    data-panel-body="commit"
                    className="min-h-0 flex-1 overflow-y-auto px-[6px] pb-[12px] pt-[6px]"
                >
                    <CommitList state={state} rangeKind={scope?.range.kind ?? null} onRevealFile={onRevealFile} />
                </div>
            ) : (
                <>
                    {compareOn ? (
                        <CompareBar state={state} pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} />
                    ) : null}
                    <div ref={logRef} role="tabpanel" data-panel-body="log" className="flex min-h-0 flex-1 flex-col">
                        <div
                            style={{ flexBasis: `${split * 100}%` }}
                            className="flex min-h-0 flex-none flex-col overflow-hidden"
                        >
                            {compareOn ? (
                                <CompareColumn
                                    rows={compareRows}
                                    selected={compareSelection}
                                    mergeBase={compareSides?.mergeBase ?? ""}
                                    mergeBaseTs={compareSides?.mergeBaseTs ?? 0}
                                    error={compareError}
                                    loading={compareSides == null && compareError == null}
                                    onSelect={(id) => cwd && fireAndForget(() => selectCompareRow(cwd, id))}
                                />
                            ) : (
                                <HistoryPane
                                    rows={historyRows ?? []}
                                    selected={selectedCommit}
                                    // a filtered set mostly lacks its own parents, so lane assignment would sprawl to
                                    // the fold limit and draw edges to commits that are not there
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
                                    onSelect={(hash) => cwd && fireAndForget(() => selectCommit(cwd, hash))}
                                    onScroll={(top) => globalStore.set(historyScrollAtom, top)}
                                    onLoadMore={() => fireAndForget(() => loadMoreHistory())}
                                />
                            )}
                        </div>
                        <div
                            data-log-split
                            role="separator"
                            aria-orientation="horizontal"
                            aria-valuemin={25}
                            aria-valuemax={80}
                            aria-valuenow={Math.round(split * 100)}
                            onPointerDown={(e) => {
                                e.currentTarget.setPointerCapture(e.pointerId);
                                splitDrag.current = { y: e.clientY, f: split };
                                e.preventDefault();
                            }}
                            onPointerMove={(e) => {
                                const d = splitDrag.current;
                                const h = logRef.current?.getBoundingClientRect().height ?? 0;
                                if (d != null && h > 0) {
                                    globalStore.set(logSplitAtom, clampLogSplit(d.f + (e.clientY - d.y) / h));
                                }
                            }}
                            onPointerUp={(e) => {
                                splitDrag.current = null;
                                e.currentTarget.releasePointerCapture?.(e.pointerId);
                            }}
                            className="h-[5px] flex-none cursor-row-resize border-t border-border hover:bg-surface-hover"
                        />
                        <div className="flex min-h-0 flex-1 flex-col">{logBottom}</div>
                    </div>
                </>
            )}

            <div
                data-panel-resize
                role="separator"
                aria-orientation="vertical"
                aria-valuemin={280}
                aria-valuemax={560}
                aria-valuenow={width}
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    widthDrag.current = { x: e.clientX, w: width };
                    e.preventDefault();
                }}
                onPointerMove={(e) => {
                    const d = widthDrag.current;
                    if (d != null) {
                        globalStore.set(panelWidthAtom, clampPanelWidth(d.w + e.clientX - d.x));
                    }
                }}
                onPointerUp={(e) => {
                    widthDrag.current = null;
                    e.currentTarget.releasePointerCapture?.(e.pointerId);
                }}
                className="absolute inset-y-0 -right-[3px] z-20 w-[6px] cursor-col-resize hover:bg-edge-strong/40"
            />
        </div>
    );
}
