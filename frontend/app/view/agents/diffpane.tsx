// frontend/app/view/agents/diffpane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Diff surface's diff, beside the panel. One Monaco diff editor for every state the surface has — the working
// tree, a commit, a comparison — because they differ only in which two refs feed it. Split is gated on the pane's own
// measured width rather than the window's. The header is one line: where the file is, what it is measured against, the
// change walker, File | Review and a ⋯ menu that holds the view options. With the panel folded away the header also
// carries the panel's entry points (the source, the upstream counts, the two tabs) and a file stepper.

import { MOTION } from "@/app/element/motiontokens";
import { SkeletonLine, SkeletonRows } from "@/app/element/skeleton";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { openInCode } from "@/app/view/code/codestore";
import { toggleWrap, useWrap } from "@/app/view/code/codewrap";
import { formatChordString } from "@/util/keysym";
import { joinRepoPath, splitRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Ellipsis, FileText, PanelLeft } from "lucide-react";
import { motion } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { firstDifferingLine } from "./diffcontent";
import { diffPairAtom } from "./diffcontentstore";
import { emptyDiffState, type EmptyDiff } from "./diffempty";
import { commitTabCount, panelFoldedAtom, panelTabAtom, sourceTitle, type PanelTab } from "./difflayout";
import { changePosition, clearDiffNav, diffNavPosAtom, gotoChange, setDiffNav } from "./diffnav";
import {
    diffWrapPathAtom,
    ignoreWsAtom,
    optionItems,
    paneHeaderLayout,
    paneOptions,
    splitViewAtom,
    type OptionId,
    type OptionItem,
} from "./diffoptions";
import { filesStateAtom } from "./filesstore";
import { fileStepLabel, shownPaths, stepFile } from "./filestep";
import { collapsedDirsAtom, treeModeAtom } from "./filetree";
import { activeChangesStatusAtom, shownChangesAtom } from "./githistorystore";
import { activeReviewKeyAtom, reviewModeAtom } from "./linecommentstore";
import { LineReviewTray } from "./linereviewtray";
import { ReviewList } from "./reviewlistview";
import { fmtBytes } from "./runcompletion";
import { syncView } from "./syncstate";

const MonacoDiffViewer = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoDiffViewer })));

const headerBar =
    "flex h-[40px] flex-none items-center gap-[10px] border-b border-border bg-background pl-[14px] pr-[12px]";
const navBtn =
    "flex h-[24px] w-[24px] flex-none items-center justify-center rounded-[6px] text-ink-mid hover:bg-surface-hover hover:text-ink-hi";
const stepBtn =
    "flex h-[24px] w-[24px] flex-none items-center justify-center rounded-[6px] border border-edge-mid text-ink-mid hover:text-ink-hi";

function EmptyState({ empty }: { empty: EmptyDiff }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-[8px] px-[32px] text-center">
            <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] border border-edge-mid bg-surface text-muted">
                <FileText size={16} />
            </span>
            <div className="text-[13px] font-semibold text-ink-hi">{empty.title}</div>
            <div className="max-w-[360px] text-[12px] leading-[1.5] text-ink-mid">{empty.body}</div>
        </div>
    );
}

function PaneSkeleton() {
    return (
        <SkeletonRows className="min-h-0 flex-1 px-[20px] py-[14px]">
            {(i) => (
                <div key={i} className="mb-[10px] flex gap-[10px]">
                    <SkeletonLine className="h-[12px] w-[30px]" />
                    <SkeletonLine className="h-[12px] w-[72%]" />
                </div>
            )}
        </SkeletonRows>
    );
}

// With the panel folded away the header starts with the panel's entry points: the source button that unfolds it, the
// upstream counts, the two tabs (each unfolds the panel on its tab) and a stepper through the file list the panel would
// show. Everything it draws is a read of a store, so the pane needs no props for it beyond the select callback.
function FoldedLead({
    model,
    path,
    onStepFile,
}: {
    model: AgentsViewModel;
    path: string | null;
    onStepFile: (path: string) => void;
}) {
    const scope = useAtomValue(model.diffScopeAtom);
    const state = useAtomValue(filesStateAtom);
    const tab = useAtomValue(panelTabAtom);
    const shown = useAtomValue(shownChangesAtom);
    const tree = useAtomValue(treeModeAtom);
    const collapsed = useAtomValue(collapsedDirsAtom);
    const title = sourceTitle(scope, state?.branch ?? "");
    const sync = syncView({
        branch: state?.branch ?? "",
        upstream: state?.upstream ?? "",
        ahead: state?.upstreamAhead ?? 0,
        behind: state?.upstreamBehind ?? 0,
        running: null,
        fetchedAgo: "",
    });
    const count = commitTabCount(state);
    const paths = shownPaths(shown?.files ?? [], tree, collapsed);
    const unfold = (t?: PanelTab) => {
        if (t != null) {
            globalStore.set(panelTabAtom, t);
        }
        globalStore.set(panelFoldedAtom, false);
    };
    const step = (delta: number) => {
        const next = stepFile(paths, path, delta);
        if (next != null && next !== path) {
            onStepFile(next);
        }
    };
    return (
        <>
            <button
                data-folded-source
                onClick={() => unfold()}
                title={`Open the panel (${formatChordString("Shift:b")})`}
                className="flex h-[28px] min-w-0 flex-none items-center gap-[7px] rounded-[7px] border border-edge-mid px-[8px] text-ink-hi hover:border-edge-strong"
            >
                <PanelLeft size={14} className="flex-none text-ink-mid" />
                <span className="max-w-[160px] truncate text-[12.5px] font-semibold">{title.name}</span>
                {title.branch ? (
                    <span className="max-w-[120px] truncate text-[12px] text-muted">{title.branch}</span>
                ) : null}
            </button>
            {state?.isRepo ? (
                <span title={sync.countsTitle} className="flex-none text-[11px] tabular-nums text-ink-mid">
                    {sync.counts}
                </span>
            ) : null}
            <span className="flex flex-none items-center gap-[2px]">
                {(["commit", "log"] as const).map((t) => (
                    <button
                        key={t}
                        data-folded-tab={t}
                        onClick={() => unfold(t)}
                        title={`${t === "commit" ? "Commit" : "Log"} (${formatChordString(t === "commit" ? "Shift:c" : "Shift:h")})`}
                        className={cn(
                            "h-[26px] rounded-[6px] px-[8px] text-[12px] font-semibold",
                            t === tab ? "bg-surface-raised text-ink-hi" : "text-muted hover:text-ink-hi"
                        )}
                    >
                        {t === "commit" ? "Commit" : "Log"}
                        {t === "commit" && count != null && count > 0 ? (
                            <span className="ml-[6px] text-[10.5px] font-medium tabular-nums text-muted">{count}</span>
                        ) : null}
                    </button>
                ))}
            </span>
            <span className="h-[18px] w-px flex-none bg-edge-mid" />
            <span data-file-step className="flex flex-none items-center gap-[6px]">
                <button
                    onClick={() => step(-1)}
                    aria-label="Previous file"
                    title="Previous file"
                    disabled={paths.length === 0}
                    className={stepBtn}
                >
                    <ChevronLeft size={12} />
                </button>
                <span className="text-[11px] tabular-nums text-muted">{fileStepLabel(paths, path)}</span>
                <button
                    onClick={() => step(1)}
                    aria-label="Next file"
                    title="Next file"
                    disabled={paths.length === 0}
                    className={stepBtn}
                >
                    <ChevronRight size={12} />
                </button>
            </span>
        </>
    );
}

// The header's ⋯ menu: the view options the old header spread over four buttons. While it is open it owns its keys, so
// Escape closes it rather than leaving the surface; closing blurs the button so the surface's keys come back.
function OptionsMenu({ items, onPick }: { items: OptionItem[]; onPick: (id: OptionId) => void }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [open]);

    const close = () => {
        setOpen(false);
        triggerRef.current?.blur();
    };

    return (
        <div
            ref={wrapRef}
            data-owns-keys={open ? "" : undefined}
            onKeyDown={(e) => {
                if (open && e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                }
            }}
            className="relative flex-none"
        >
            <button
                ref={triggerRef}
                data-diff-options
                onClick={() => setOpen(!open)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="View options"
                title="Whitespace, wrap, side-by-side"
                className={cn(
                    "flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-edge-mid text-ink-mid hover:text-ink-hi",
                    open && "bg-surface-raised text-ink-hi"
                )}
            >
                <Ellipsis size={14} />
            </button>
            {open ? (
                <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+6px)] z-30 w-[236px] rounded-[10px] border border-edge-mid bg-surface-raised p-[4px] shadow-popover-md"
                >
                    {items.map((i) => (
                        <button
                            key={i.id}
                            role={i.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                            aria-checked={i.checked}
                            data-diff-options-item={i.id}
                            disabled={i.disabled}
                            title={i.reason}
                            onClick={() => {
                                onPick(i.id);
                                // a switch stays open to be read; an action is done
                                if (i.checked === undefined) {
                                    close();
                                }
                            }}
                            className={cn(
                                "flex h-[28px] w-full items-center gap-[8px] rounded-[6px] px-[8px] text-left text-[12px]",
                                i.disabled ? "text-ink-faint" : "text-ink-hi hover:bg-surface-hover"
                            )}
                        >
                            <span className="flex w-[12px] flex-none items-center justify-center text-ink-hi">
                                {i.checked ? <Check size={12} /> : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{i.label}</span>
                            {i.chord ? (
                                <span className="flex-none font-mono text-[10.5px] text-muted">
                                    {formatChordString(i.chord)}
                                </span>
                            ) : null}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export interface ReviewTarget {
    source: string; // "worktree" or a commit hash
    base: string; // FilesState.ref: what the Uncommitted row's file list diffs against
    // changes when the working tree does, so Review re-reads it without blanking
    refreshKey: string;
    // the file the commit pane's list was last clicked on; n grows with each click
    scrollTo: { path: string; n: number } | null;
}

export function DiffPane({
    path,
    adds,
    dels,
    editorCwd,
    repoCwd,
    model,
    nothingToCompare = null,
    review = null,
    against,
    folded,
    onStepFile,
}: {
    path: string | null;
    adds: number;
    dels: number;
    editorCwd: string | null;
    repoCwd: string | null;
    model: AgentsViewModel;
    // what the file is measured against, as measuredAgainst words it
    against: string;
    // the panel is folded away, so the header carries its entry points and the file stepper
    folded: boolean;
    // selects a file by path, as a click on the list would; the folded stepper moves with it
    onStepFile: (path: string) => void;
    // compare's aggregate is selected and the two refs list no files
    nothingToCompare?: { base: string; head: string } | null;
    // what Review would show: the Uncommitted row or one commit, never compare; null hides the File | Review control
    review?: ReviewTarget | null;
}) {
    const pair = useAtomValue(diffPairAtom);
    // the file list this pane picks from: with no path selected, whether it is loading, failed or empty decides the words
    const listStatus = useAtomValue(activeChangesStatusAtom);
    const shownChanges = useAtomValue(shownChangesAtom);
    const split = useAtomValue(splitViewAtom);
    const ignoreWs = useAtomValue(ignoreWsAtom);
    const navPos = useAtomValue(diffNavPosAtom);
    const mode = useAtomValue(reviewModeAtom);
    const hostRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const reviewing = review != null && repoCwd != null && mode === "review";
    const wrapPath = path != null && repoCwd != null && !reviewing ? joinRepoPath(repoCwd, path) : "";
    const wrap = useWrap(wrapPath);

    // the tray and the send key read the comments of the repository this pane shows, in either mode
    useEffect(() => {
        globalStore.set(activeReviewKeyAtom, repoCwd ?? "");
        return () => globalStore.set(activeReviewKeyAtom, "");
    }, [repoCwd]);

    // Alt+Z (bindings.ts files:wrap) toggles the file this pane shows
    useEffect(() => {
        globalStore.set(diffWrapPathAtom, wrapPath);
        return () => globalStore.set(diffWrapPathAtom, "");
    }, [wrapPath]);

    useEffect(() => {
        const el = hostRef.current;
        if (el == null) {
            return;
        }
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, []);

    const layout = paneHeaderLayout(width);
    const options = useMemo(
        () => paneOptions(split && layout.split, ignoreWs, wrap),
        [split, layout.split, ignoreWs, wrap]
    );
    const empty = emptyDiffState({
        path,
        pair,
        nothingToCompare,
        listStatus,
        fileCount: shownChanges?.files.length ?? null,
    });

    const body = () => {
        if (reviewing) {
            return (
                <ReviewList
                    // a new repository or selection starts over: its folds, collapsed files and anchor are its own
                    key={`${repoCwd}|${review.source}`}
                    repoKey={repoCwd}
                    source={review.source}
                    base={review.base}
                    refreshKey={review.refreshKey}
                    scrollTo={review.scrollTo}
                    loading={<PaneSkeleton />}
                />
            );
        }
        if (empty) {
            return <EmptyState empty={empty} />;
        }
        if (pair == null || pair.path !== path) {
            return <PaneSkeleton />;
        }
        return (
            <Suspense fallback={<PaneSkeleton />}>
                <MonacoDiffViewer
                    path={path}
                    original={pair.original}
                    modified={pair.modified}
                    options={options}
                    // publishes the editor so Shift+N / Shift+P can walk its hunks without focusing it
                    onMount={(diff) => {
                        setDiffNav(diff);
                        const update = () =>
                            globalStore.set(
                                diffNavPosAtom,
                                changePosition(
                                    (diff.getLineChanges() ?? []).map((c) => ({
                                        start: c.modifiedStartLineNumber,
                                        end: c.modifiedEndLineNumber,
                                    })),
                                    diff.getModifiedEditor().getPosition()?.lineNumber ?? 0
                                )
                            );
                        const subs = [
                            diff.onDidUpdateDiff(update),
                            diff.getModifiedEditor().onDidChangeCursorPosition(update),
                        ];
                        return () => {
                            subs.forEach((s) => s.dispose());
                            clearDiffNav(diff);
                            globalStore.set(diffNavPosAtom, null);
                        };
                    }}
                />
            </Suspense>
        );
    };

    const modeControl = () =>
        review == null ? null : (
            <div
                role="group"
                data-diff-mode={reviewing ? "review" : "file"}
                title="One file, or every changed file to comment on"
                className="flex h-[26px] flex-none gap-[2px] rounded-[7px] border border-edge-mid p-[2px]"
            >
                {(["file", "review"] as const).map((m) => (
                    <button
                        key={m}
                        data-diff-mode-option={m}
                        onClick={() => globalStore.set(reviewModeAtom, m)}
                        aria-pressed={mode === m}
                        className={cn(
                            "rounded-[5px] px-[10px] text-[11px] font-semibold",
                            mode === m ? "bg-surface-raised text-ink-hi" : "text-muted hover:text-ink-hi"
                        )}
                    >
                        {m === "file" ? "File" : "Review"}
                    </button>
                ))}
            </div>
        );

    const lead = () => (folded ? <FoldedLead model={model} path={path} onStepFile={onStepFile} /> : null);

    const reviewHeader = () => (
        <div data-diff-header className={headerBar}>
            {lead()}
            <span className="min-w-0 truncate text-[12.5px] text-ink-mid">
                {review.source === "worktree" ? "Every uncommitted change" : "Every file in this commit"}
            </span>
            <div className="flex-1" />
            {modeControl()}
        </div>
    );

    const onPickOption = (id: OptionId) => {
        switch (id) {
            case "split":
                globalStore.set(splitViewAtom, !split);
                return;
            case "whitespace":
                globalStore.set(ignoreWsAtom, !ignoreWs);
                return;
            case "wrap":
                toggleWrap(wrapPath);
                return;
            case "editor":
                if (editorCwd && path) {
                    getApi().openExternal(joinRepoPath(editorCwd, path));
                }
                return;
            case "code":
                if (repoCwd && path) {
                    fireAndForget(() =>
                        openInCode(model, {
                            projectPath: repoCwd,
                            rel: path,
                            line: pair ? firstDifferingLine(pair.original, pair.modified) : undefined,
                        })
                    );
                }
                return;
        }
    };

    const header = () => {
        // no file yet: the lead keeps its place, and a list still loading says so instead of leaving a bare bar
        if (!path) {
            return (
                <div data-diff-header className={headerBar}>
                    {lead()}
                    {listStatus === "loading" ? <SkeletonLine className="h-[12px] w-[260px] rounded-[6px]" /> : null}
                </div>
            );
        }
        const { dir, file } = splitRepoPath(path);
        return (
            <div data-diff-header className={headerBar}>
                {lead()}
                <span className="flex min-w-0 items-baseline text-[12.5px]">
                    {/* rtl truncates from the left, but alone it would move the directory's trailing "/"
                        to its front; the bdi keeps the text itself left-to-right */}
                    <span className="min-w-0 truncate text-muted [direction:rtl]">
                        <bdi dir="ltr">{dir}</bdi>
                    </span>
                    <span className="flex-none font-semibold text-ink-hi">{file}</span>
                </span>
                <span className="flex-none text-[11px] font-bold tabular-nums text-diff-added">+{adds}</span>
                <span className="flex-none text-[11px] font-bold tabular-nums text-diff-removed">−{dels}</span>
                {empty?.kind === "toolarge" && pair != null ? (
                    <span className="flex-none text-[11px] tabular-nums text-muted">{fmtBytes(pair.size)}</span>
                ) : null}
                <span className="min-w-0 truncate text-[10.5px] text-muted">{against}</span>
                <div className="flex-1" />
                {navPos != null && navPos.total > 0 ? (
                    <div className="flex flex-none items-center gap-[2px]">
                        <button
                            onClick={() => gotoChange("previous")}
                            title={`Previous change (${formatChordString("Shift:p")})`}
                            aria-label={`Previous change (${formatChordString("Shift:p")})`}
                            className={navBtn}
                        >
                            <ChevronUp size={14} />
                        </button>
                        <span className="text-center text-[11px] tabular-nums text-ink-mid">
                            {layout.labelled ? "change " : ""}
                            {navPos.index} / {navPos.total}
                        </span>
                        <button
                            onClick={() => gotoChange("next")}
                            title={`Next change (${formatChordString("Shift:n")})`}
                            aria-label={`Next change (${formatChordString("Shift:n")})`}
                            className={navBtn}
                        >
                            <ChevronDown size={14} />
                        </button>
                    </div>
                ) : null}
                {modeControl()}
                <OptionsMenu
                    items={optionItems({
                        split,
                        splitAllowed: layout.split,
                        ignoreWs,
                        wrap,
                        wrapAllowed: wrapPath !== "" && empty == null,
                        editorAllowed: !!editorCwd,
                        codeAllowed: !!repoCwd,
                    })}
                    onPick={onPickOption}
                />
            </div>
        );
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            ref={hostRef}
            data-diff-pane
            data-diff-panel={folded ? "folded" : undefined}
        >
            {reviewing ? reviewHeader() : header()}
            {body()}
            {repoCwd ? <LineReviewTray repoKey={repoCwd} model={model} /> : null}
        </motion.div>
    );
}
