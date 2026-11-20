// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail's Changes tab file list, as hunks: every changed file in one scroll, by folder, each a block of its hunks
// that opens and closes, with a change counter (Shift+N / Shift+P), Hide whitespace (Shift+W) and Expand all. Ported
// from the kaeltran16 fork's workspace-pane Changes tab (workspacechangestab.tsx there). The rail's own bits above it
// (where line, Session / Branch, Commits, commit mode) stay agentdetailsrail.tsx's.

import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { openInCode } from "@/app/view/code/codestore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    ArrowUpRight,
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    ChevronUp,
    Code,
    Pilcrow,
    RotateCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { fileTotals } from "./agentrailmodel";
import type { AgentsViewModel } from "./agents";
import { DIFF_NOTES, DiffHunks } from "./diffhunks";
import { ignoreWsAtom } from "./diffoptions";
import { statusColor, type GitChange } from "./gitstatus";
import { anyFileOpen, changesSegments, hunkWalk, type ChangesFile } from "./railchangesmodel";
import {
    changesAtAtom,
    changesGroupsFor,
    changesOpenAtom,
    changesPatchAtom,
    changesScrollAtom,
    changesShownAtom,
    loadChangesPatch,
    sourceKey,
    stepChangesHunk,
    toggleAllChangesFiles,
    toggleChangesFile,
    toggleChangesFolder,
    type ChangesSource,
} from "./railchangesstore";

const LOADING_ROWS = 3;

// what sticks over the scroll, top down: the bar, a folder's label, an open file's header
const BAR_PX = 36;
const FOLDER_PX = 32;

// the bar's buttons: borderless, one style
const barBtn =
    "inline-flex h-[26px] flex-none cursor-pointer items-center justify-center rounded-[7px] text-ink-mid hover:bg-surface-hover hover:text-ink-hi";

const fileSelector = (path: string) => `[data-changes-file="${CSS.escape(path)}"]`;

// moves only the given scroller (scrollIntoView would also move a clipping ancestor), landing the element under the
// sticky rows its scroll-margin names
function revealAtTop(scroller: HTMLElement | null, el: Element | null | undefined): void {
    if (scroller == null || el == null) {
        return;
    }
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin;
}

// files: the list the tab shows (the session's, or the branch view's), read against source. scroller: the rail's own
// scroll box, which this list sits at the foot of. reading: whether the Agent surface is on screen (it stays mounted
// under the others), so an off-screen rail reads nothing
export function RailChangesHunks({
    model,
    agentId,
    files,
    source,
    reading,
    scroller,
    reloadKey,
    onViewDiff,
    commit,
}: {
    model: AgentsViewModel;
    agentId: string;
    files: GitChange[];
    source: ChangesSource;
    reading: boolean;
    scroller: RefObject<HTMLDivElement>;
    // changes when the rail's list was read again (a turn's end, the window back), so the patch is read again too
    reloadKey: unknown;
    onViewDiff: () => void;
    // the rail's Commit… button, while there is something to commit
    commit?: ReactNode;
}) {
    const ignoreWs = useAtomValue(ignoreWsAtom);
    const patch = useAtomValue(changesPatchAtom);
    const openState = useAtomValue(changesOpenAtom(agentId));
    const at = useAtomValue(changesAtAtom(agentId));
    const scroll = useAtomValue(changesScrollAtom(agentId));
    // a step made before this mount was already scrolled to; only a new one scrolls
    const scrolledTo = useRef(scroll?.n);
    const key = sourceKey(source);
    const groups = useMemo(() => changesGroupsFor(agentId, key, files, patch), [agentId, key, files, patch]);
    const total = useMemo(() => hunkWalk(groups).length, [groups]);
    const listed = useMemo(() => groups.flatMap((g) => g.files.map((f) => f.change.path)), [groups]);
    const anyOpen = anyFileOpen(openState, listed);
    const failure = patch?.agentId === agentId && patch.key === key ? patch.failure : undefined;
    const totals = fileTotals(files);

    // the keys walk what is drawn here, and nothing while it is not
    useEffect(() => {
        globalStore.set(changesShownAtom, { agentId, key, files });
        return () => {
            if (globalStore.get(changesShownAtom)?.agentId === agentId) {
                globalStore.set(changesShownAtom, null);
            }
        };
    }, [agentId, key, files]);

    useEffect(() => {
        if (reading && files.length > 0) {
            fireAndForget(() => loadChangesPatch(agentId, source.cwd, source.ref, source.end));
        }
    }, [reading, key, ignoreWs, agentId, reloadKey]);

    useEffect(() => {
        if (scroll == null || scroll.n === scrolledTo.current) {
            return;
        }
        scrolledTo.current = scroll.n;
        const el = scroller.current?.querySelector(`${fileSelector(scroll.path)} [data-changes-hunk="${scroll.hunk}"]`);
        revealAtTop(scroller.current, el);
    }, [scroll?.n]);

    const retry = () => fireAndForget(() => loadChangesPatch(agentId, source.cwd, source.ref, source.end));
    return (
        <div data-rail-changes-hunks className="flex flex-col">
            <div
                data-rail-changes-bar
                className="sticky top-0 z-[4] flex flex-none items-center gap-[2px] bg-surface font-mono"
                style={{ height: BAR_PX }}
            >
                <span
                    data-rail-changes-line
                    className="flex min-w-0 flex-1 items-baseline gap-[8px] overflow-hidden whitespace-nowrap text-[11.5px]"
                >
                    {/* the spaces between the spans are for copied text; a flex row draws none of them */}
                    <span className="flex-none text-ink-hi">{totals.count}</span>{" "}
                    <span className="flex-none text-diff-added">+{totals.adds}</span>{" "}
                    <span className="flex-none text-diff-removed">−{totals.dels}</span>
                </span>
                {total > 0 ? (
                    <>
                        <button
                            type="button"
                            data-changes-prev
                            onClick={() => stepChangesHunk(agentId, "previous")}
                            title="Previous change (⇧P)"
                            aria-label="Previous change (⇧P)"
                            className={cn(barBtn, "w-[24px]")}
                        >
                            <ChevronUp size={14} />
                        </button>
                        <span
                            data-changes-counter
                            aria-label={`Change ${Math.min(at, total)} of ${total}`}
                            className="min-w-[28px] flex-none text-center text-[11px] text-ink-mid"
                        >
                            {Math.min(at, total)}/{total}
                        </span>
                        <button
                            type="button"
                            data-changes-next
                            onClick={() => stepChangesHunk(agentId, "next")}
                            title="Next change (⇧N)"
                            aria-label="Next change (⇧N)"
                            className={cn(barBtn, "w-[24px]")}
                        >
                            <ChevronDown size={14} />
                        </button>
                    </>
                ) : null}
                <button
                    type="button"
                    data-changes-ignore-ws
                    onClick={() => globalStore.set(ignoreWsAtom, !ignoreWs)}
                    title="Hide whitespace (⇧W)"
                    aria-label="Hide whitespace (⇧W)"
                    aria-pressed={ignoreWs}
                    className={cn(barBtn, "ml-[2px] w-[26px]", ignoreWs && "bg-accentbg text-ink-hi")}
                >
                    <Pilcrow size={13} />
                </button>
                <button
                    type="button"
                    data-changes-toggle-all
                    onClick={() => toggleAllChangesFiles(agentId, listed)}
                    title={anyOpen ? "Collapse all" : "Expand all"}
                    aria-label={anyOpen ? "Collapse all" : "Expand all"}
                    className={cn(barBtn, "w-[26px]")}
                >
                    {anyOpen ? <ChevronsDownUp size={13} aria-hidden /> : <ChevronsUpDown size={13} aria-hidden />}
                </button>
            </div>
            <div className="mb-[8px] flex items-center gap-[10px] text-[10.5px]">
                <span className="flex-1" />
                {commit}
                <button
                    type="button"
                    data-rail-changes-view-diff
                    onClick={onViewDiff}
                    className="inline-flex cursor-pointer items-center gap-[3px] rounded-[7px] px-[6px] py-[3px] font-semibold text-accent-soft hover:bg-surface-hover"
                >
                    View diff
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            </div>
            {failure != null ? (
                <div
                    data-rail-changes-patch-failed
                    className="mb-[8px] flex items-center gap-[10px] rounded-[8px] border border-border bg-surface py-[6px] pl-[12px] pr-[6px] text-[12px]"
                >
                    <span className="min-w-0 flex-1 break-words text-ink-mid">
                        <span className="text-error">Couldn’t read the diff.</span> {failure}
                    </span>
                    <button
                        type="button"
                        data-rail-changes-patch-retry
                        onClick={retry}
                        className={cn(barBtn, "gap-[5px] px-[8px] text-[11.5px] font-semibold")}
                    >
                        <RotateCw size={13} />
                        Retry
                    </button>
                </div>
            ) : null}
            {groups.map((g) => {
                const paths = g.files.map((f) => f.change.path);
                const folderOpen = anyFileOpen(openState, paths);
                const folderLabel = `${folderOpen ? "Collapse" : "Expand"} every file in ${g.dir}/`;
                const foldered = g.dir !== "";
                // a jump lands a file under what sticks over it: the bar, and a folder's label under a folder
                const fileMargin = BAR_PX + (foldered ? FOLDER_PX : 0);
                const head = (f: ChangesFile, open: boolean) => (
                    <FileHeader model={model} agentId={agentId} f={f} open={open} cwd={source.cwd} />
                );
                return (
                    <div key={g.dir} data-changes-group={g.dir}>
                        {foldered ? (
                            <button
                                type="button"
                                data-changes-folder
                                onClick={() => toggleChangesFolder(agentId, paths)}
                                aria-expanded={folderOpen}
                                aria-label={folderLabel}
                                title={folderLabel}
                                className="sticky z-[3] flex w-full cursor-pointer items-center gap-[8px] bg-surface px-[2px] text-left font-mono text-[11.5px]"
                                style={{ top: BAR_PX, height: FOLDER_PX }}
                            >
                                <ChevronRight
                                    size={12}
                                    aria-hidden
                                    className={cn(
                                        "flex-none text-ink-faint transition-transform motion-reduce:transition-none",
                                        folderOpen && "rotate-90"
                                    )}
                                />
                                <span className="min-w-0 flex-1 truncate text-muted">{g.dir}/</span>
                                <span className="flex-none text-ink-faint">{g.count}</span>
                            </button>
                        ) : null}
                        {changesSegments(g.files, openState).map((seg) =>
                            seg.kind === "list" ? (
                                <div
                                    key={`list:${seg.files[0].change.path}`}
                                    data-changes-list
                                    className="mb-[8px] overflow-clip rounded-[8px] border border-border bg-surface"
                                >
                                    {seg.files.map((f, i) => (
                                        <div
                                            key={f.change.path}
                                            data-changes-file={f.change.path}
                                            className={cn(
                                                "flex items-center gap-[4px] pr-[6px]",
                                                i > 0 && "border-t border-edge-faint"
                                            )}
                                            style={{ scrollMarginTop: fileMargin }}
                                        >
                                            {head(f, false)}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div
                                    key={seg.file.change.path}
                                    data-changes-file={seg.file.change.path}
                                    data-changes-open
                                    // clip, not hidden: a hidden overflow would make the card the header's sticky
                                    // container
                                    className="mb-[8px] overflow-clip rounded-[8px] border border-border"
                                    style={{ scrollMarginTop: fileMargin }}
                                >
                                    <div
                                        className="sticky z-[2] flex h-[34px] items-center gap-[4px] bg-surface pr-[6px]"
                                        style={{ top: fileMargin }}
                                    >
                                        {head(seg.file, true)}
                                    </div>
                                    <FileBody f={seg.file} hunkMargin={fileMargin + 34} failed={failure != null} />
                                </div>
                            )
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// a file's header row: the toggle and Open in Code, drawn in a list box row (closed) and on a card (open)
function FileHeader({
    model,
    agentId,
    f,
    open,
    cwd,
}: {
    model: AgentsViewModel;
    agentId: string;
    f: ChangesFile;
    open: boolean;
    cwd: string;
}) {
    const { adds, dels, status, path } = f.change;
    // a deleted file has no file on disk to open
    const codable = status !== "D";
    return (
        <>
            <button
                type="button"
                data-changes-toggle
                onClick={() => toggleChangesFile(agentId, path)}
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${f.name}`}
                title={path}
                className="flex h-[34px] min-w-0 flex-1 cursor-pointer items-center gap-[8px] px-[10px] text-left font-mono"
            >
                <ChevronRight
                    size={12}
                    aria-hidden
                    className={cn(
                        "flex-none text-muted transition-transform motion-reduce:transition-none",
                        open && "rotate-90"
                    )}
                />
                <span className={cn("w-[10px] flex-none text-[11px] font-bold", statusColor(f.letter))}>
                    {f.letter}
                </span>
                <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink-hi">{f.name}</span>
                <span className="flex-1" />
                {f.isNew && !open ? (
                    <span data-changes-new className="flex-none text-[11px] text-muted">
                        new
                    </span>
                ) : null}
                <span className={cn("flex-none text-[11px]", adds > 0 ? "text-diff-added" : "text-muted")}>
                    +{adds}
                </span>
                <span
                    className={cn("min-w-[24px] flex-none text-[11px]", dels > 0 ? "text-diff-removed" : "text-muted")}
                >
                    −{dels}
                </span>
            </button>
            {codable ? (
                <button
                    type="button"
                    data-changes-open-code
                    onClick={() =>
                        fireAndForget(() =>
                            openInCode(model, { projectPath: cwd, rel: path, line: f.hunks[0]?.newStart })
                        )
                    }
                    title="Open in Code"
                    aria-label="Open in Code"
                    className="inline-flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-ink-hi"
                >
                    <Code size={13} />
                </button>
            ) : null}
        </>
    );
}

// hunkMargin: what sticks over a hunk a step lands on (the bar, a folder's label, the file's header)
function FileBody({ f, hunkMargin, failed }: { f: ChangesFile; hunkMargin: number; failed: boolean }) {
    if (f.body === "loading") {
        // a failed read has no rows to wait for: the band above says so, and the header alone draws
        return failed ? null : (
            <div
                data-changes-loading
                aria-hidden
                className="flex flex-col gap-[8px] border-t border-edge-faint bg-surface-code px-[13px] py-[10px]"
            >
                {Array.from({ length: LOADING_ROWS }, (_, i) => (
                    <div key={i} className="flex gap-[10px]">
                        <SkeletonLine className="h-[12px] w-[28px]" />
                        <SkeletonLine className={cn("h-[12px]", i % 2 ? "w-[54%]" : "w-[72%]")} />
                    </div>
                ))}
            </div>
        );
    }
    if (f.body !== "hunks") {
        return (
            <div
                data-changes-note={f.body}
                className="border-t border-edge-faint bg-surface-code px-[13px] py-[8px] font-mono text-[11.5px] text-muted"
            >
                {DIFF_NOTES[f.body]}
            </div>
        );
    }
    return (
        <div
            className="border-t border-edge-faint bg-surface-code pb-[6px] pt-[4px]"
            style={{ ["--hunk-mt" as string]: `${hunkMargin}px` }}
        >
            <DiffHunks hunks={f.hunks} hunkClassName="scroll-mt-[var(--hunk-mt)]" />
        </div>
    );
}
