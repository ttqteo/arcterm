// frontend/app/view/agents/diffpane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pane 3 of the Diff surface. One Monaco diff editor for every state the surface has — the working
// tree, a commit, a comparison — because they differ only in which two refs feed it. Split is gated
// on the pane's own measured width rather than the window's: a collapsed history column at the
// shipped 1000x700 leaves enough room for unified and not for split.

import { MOTION } from "@/app/element/motiontokens";
import { SkeletonLine } from "@/app/element/skeleton";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { openInCode } from "@/app/view/code/codestore";
import { joinRepoPath, splitRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronUp, Code, ExternalLink, FileText, Pilcrow } from "lucide-react";
import { motion } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { firstDifferingLine } from "./diffcontent";
import { diffPairAtom } from "./diffcontentstore";
import { emptyDiffState, type EmptyDiff } from "./diffempty";
import { changePosition, clearDiffNav, diffNavPosAtom, gotoChange, setDiffNav } from "./diffnav";
import { ignoreWsAtom, paneHeaderLayout, paneOptions, splitViewAtom } from "./diffoptions";
import { fmtBytes } from "./runcompletion";

const MonacoDiffViewer = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoDiffViewer })));

const headerBtn =
    "flex h-[28px] flex-none items-center gap-[6px] rounded-[8px] border border-edge-mid px-[10px] text-[11.5px] font-semibold";
const navBtn =
    "flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[6px] text-muted hover:text-ink-hi";

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
        <div className="flex-1 overflow-hidden px-[20px] py-[14px]">
            {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="mb-[10px] flex gap-[10px]">
                    <SkeletonLine className="h-[12px] w-[30px]" />
                    <SkeletonLine className="h-[12px] w-[72%]" />
                </div>
            ))}
        </div>
    );
}

export function DiffPane({
    path,
    adds,
    dels,
    editorCwd,
    repoCwd,
    model,
    nothingToCompare = null,
}: {
    path: string | null;
    adds: number;
    dels: number;
    editorCwd: string | null;
    repoCwd: string | null;
    model: AgentsViewModel;
    // compare's aggregate is selected and the two refs list no files
    nothingToCompare?: { base: string; head: string } | null;
}) {
    const pair = useAtomValue(diffPairAtom);
    const split = useAtomValue(splitViewAtom);
    const ignoreWs = useAtomValue(ignoreWsAtom);
    const navPos = useAtomValue(diffNavPosAtom);
    const hostRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

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
    const options = useMemo(() => paneOptions(split && layout.split, ignoreWs), [split, layout.split, ignoreWs]);
    const empty = emptyDiffState({ path, pair, nothingToCompare });

    const body = () => {
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

    const header = () => {
        const { dir, file } = splitRepoPath(path);
        return (
            <div className="flex h-[48px] flex-none items-center gap-[10px] border-b border-border pl-[18px] pr-[14px]">
                <span className="flex min-w-0 items-baseline font-mono text-[12.5px]">
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
                <div className="flex-1" />
                {navPos != null && navPos.total > 0 ? (
                    <div className="flex flex-none items-center gap-[2px]">
                        <button
                            onClick={() => gotoChange("previous")}
                            title="Previous change (⇧P)"
                            aria-label="Previous change (⇧P)"
                            className={navBtn}
                        >
                            <ChevronUp size={14} />
                        </button>
                        <span className="text-center text-[11px] tabular-nums text-muted">
                            {layout.labelled ? "change " : ""}
                            {navPos.index}/{navPos.total}
                        </span>
                        <button
                            onClick={() => gotoChange("next")}
                            title="Next change (⇧N)"
                            aria-label="Next change (⇧N)"
                            className={navBtn}
                        >
                            <ChevronDown size={14} />
                        </button>
                    </div>
                ) : null}
                {layout.split ? (
                    <div
                        role="group"
                        title="Unified / split (⇧D)"
                        className="flex h-[28px] flex-none overflow-hidden rounded-[8px] border border-edge-mid"
                    >
                        {[false, true].map((v) => (
                            <button
                                key={String(v)}
                                onClick={() => globalStore.set(splitViewAtom, v)}
                                aria-pressed={split === v}
                                className={cn(
                                    "px-[10px] text-[11.5px] font-semibold",
                                    split === v ? "bg-surface-selected text-ink-hi" : "text-muted hover:text-ink-hi"
                                )}
                            >
                                {v ? "Split" : "Unified"}
                            </button>
                        ))}
                    </div>
                ) : null}
                <button
                    onClick={() => globalStore.set(ignoreWsAtom, !ignoreWs)}
                    title="Hide whitespace (⇧W)"
                    aria-label="Hide whitespace (⇧W)"
                    aria-pressed={ignoreWs}
                    className={cn(
                        headerBtn,
                        ignoreWs ? "border-accent/30 bg-accentbg text-ink-hi" : "text-ink-mid hover:text-ink-hi"
                    )}
                >
                    <Pilcrow size={13} />
                    {layout.labelled ? "Hide whitespace" : null}
                </button>
                {repoCwd && (
                    <button
                        onClick={() =>
                            fireAndForget(() =>
                                openInCode(model, {
                                    projectPath: repoCwd,
                                    rel: path,
                                    line: pair ? firstDifferingLine(pair.original, pair.modified) : undefined,
                                })
                            )
                        }
                        title="Open in Code"
                        aria-label="Open in Code"
                        className={cn(headerBtn, "text-ink-mid hover:text-ink-hi")}
                    >
                        <Code size={13} />
                        {layout.labelled ? "Open in Code" : null}
                    </button>
                )}
                {editorCwd && (
                    <button
                        onClick={() => getApi().openExternal(joinRepoPath(editorCwd, path))}
                        title="Open in editor"
                        aria-label="Open in editor"
                        className={cn(headerBtn, "text-ink-mid hover:text-ink-hi")}
                    >
                        <ExternalLink size={13} />
                    </button>
                )}
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
        >
            {path ? header() : null}
            {body()}
        </motion.div>
    );
}
