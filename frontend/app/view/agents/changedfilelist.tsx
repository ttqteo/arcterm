// frontend/app/view/agents/changedfilelist.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The changed-file list shared by the panel's Log tab in both of its states, one commit's files (commitpane) and the
// aggregate between two refs (aggregatepane), and by the Commit tab. Extracted rather than duplicated — the row is
// identical in the mockup for all of them, so one renderer is one source of truth for status colour, path truncation
// and the selected tint. The list is focusable: ↑/↓ in it select the next or previous file at once, with no Enter
// (spec decision 0), through the same select callback a click uses. Given a review subject, each row carries a
// review check at its right end.

import { SkeletonLine, SkeletonRows } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { shownPaths, stepFile } from "./filestep";
import { buildFileTree, collapsedDirsAtom, treeModeAtom, type FileTreeRow } from "./filetree";
import { CHANGE_NOTE_TITLE, statusColor, type GitChange, type GitChanges } from "./gitstatus";
import {
    clearReviewed,
    markState,
    reviewMarksAtom,
    reviewProgress,
    setReviewed,
    toggleReviewed,
    type ReviewState,
    type ReviewSubject,
} from "./reviewmarks";

const INDENT_PX = 14;
const ROW_PAD_PX = 8;

function FileListSkeleton() {
    return (
        <SkeletonRows className="h-full space-y-[7px] px-[8px] py-[6px]">
            {(i) => (
                <div key={i} className="flex items-center gap-[8px] px-[8px] py-[5px]">
                    <SkeletonLine className="h-[12px] flex-1" />
                    <SkeletonLine className="h-[10px] w-[22px]" />
                </div>
            )}
        </SkeletonRows>
    );
}

// The tree/flat switch, in the header of whichever pane is hosting the list. Here rather than in the
// two panes so the atom has one reader and the two headers cannot drift apart.
export function TreeModeToggle() {
    const tree = useAtomValue(treeModeAtom);
    return (
        <button
            onClick={() => globalStore.set(treeModeAtom, !tree)}
            title={tree ? "Show a flat path list" : "Group files by directory"}
            className="flex-none rounded border border-edge-mid px-[6px] py-[1px] text-[10.5px] text-muted hover:text-foreground"
        >
            {tree ? "tree" : "flat"}
        </button>
    );
}

// The check at a row's right end: a sibling of the row's own button, because a button cannot nest
// inside one. Drawn empty from the start so the column reads as a checklist.
function ReviewBox({
    state,
    title,
    onToggle,
    attrs,
}: {
    state: ReviewState;
    title: string;
    onToggle: () => void;
    attrs: Record<string, string>;
}) {
    return (
        <button
            {...attrs}
            onClick={onToggle}
            aria-pressed={state === "ok"}
            aria-label={title}
            title={title}
            className={cn(
                "mr-[6px] flex h-[16px] w-[16px] flex-none items-center justify-center rounded-[4px] border",
                state === "ok"
                    ? "border-accent/30 bg-accentbg"
                    : state === "stale"
                      ? "border-dashed border-warning"
                      : "border-edge-strong group-hover:border-muted"
            )}
        >
            {state === "ok" ? <Check size={11} strokeWidth={3} className="text-accent" /> : null}
        </button>
    );
}

function reviewTitle(state: ReviewState, name: string): string {
    if (state === "ok") {
        return `Unmark ${name}`;
    }
    return state === "stale" ? `Changed since you reviewed it. Mark ${name} reviewed` : `Mark ${name} reviewed`;
}

function FileRow({
    change,
    label,
    depth,
    selected,
    review,
    onSelect,
    onToggle,
}: {
    change: GitChange;
    label: string;
    depth: number;
    selected: boolean;
    // null when the list has no review subject, which draws no check
    review: ReviewState | null;
    onSelect: () => void;
    onToggle: () => void;
}) {
    const ok = review === "ok";
    return (
        <div
            className={cn(
                "group flex items-center rounded-[7px] transition-colors duration-[140ms] hover:bg-surface-hover",
                selected && "bg-surface-selected"
            )}
        >
            <button
                data-changed-file-row={change.path}
                data-review-state={review ?? "none"}
                aria-current={selected ? "true" : undefined}
                onClick={onSelect}
                style={{ paddingLeft: ROW_PAD_PX + depth * INDENT_PX }}
                title={change.path}
                className="flex h-[26px] min-w-0 flex-1 items-center gap-[8px] pr-[8px] text-left"
            >
                <span
                    className={cn(
                        "w-[13px] flex-none text-center text-[10.5px] font-bold",
                        ok ? "text-muted" : statusColor(change.status)
                    )}
                >
                    {change.status}
                </span>
                <span
                    className={cn(
                        "min-w-0 flex-1 truncate text-[11.5px]",
                        ok ? (selected ? "text-ink-mid" : "text-muted") : selected ? "text-ink-hi" : "text-ink-mid"
                    )}
                >
                    {label}
                </span>
                {change.note ? (
                    <span title={CHANGE_NOTE_TITLE[change.note]} className="flex-none text-[10.5px] text-muted">
                        {change.note}
                    </span>
                ) : (
                    <>
                        <span
                            className={cn(
                                "flex-none text-[10.5px] font-semibold tabular-nums",
                                ok ? "text-ink-faint" : "text-diff-added"
                            )}
                        >
                            +{change.adds}
                        </span>
                        <span
                            className={cn(
                                "flex-none text-[10.5px] font-semibold tabular-nums",
                                ok ? "text-ink-faint" : "text-diff-removed"
                            )}
                        >
                            −{change.dels}
                        </span>
                    </>
                )}
            </button>
            {review != null ? (
                <ReviewBox
                    state={review}
                    title={reviewTitle(review, label)}
                    onToggle={onToggle}
                    attrs={{ "data-review-toggle": change.path }}
                />
            ) : null}
        </div>
    );
}

function DirRow({
    row,
    collapsed,
    done,
    onToggle,
    onReview,
}: {
    row: FileTreeRow;
    collapsed: boolean;
    // reviewed files under this directory; null when the list has no review subject
    done: number | null;
    onToggle: () => void;
    onReview: () => void;
}) {
    const all = done != null && done === row.files;
    const partial = done != null && done > 0 && !all;
    return (
        <div className="group flex items-center rounded-[7px] hover:bg-surface-hover">
            <button
                data-changed-dir-row={row.id}
                onClick={onToggle}
                style={{ paddingLeft: ROW_PAD_PX + row.depth * INDENT_PX }}
                title={row.id}
                className="flex h-[24px] min-w-0 flex-1 items-center gap-[6px] pr-[8px] text-left"
            >
                {collapsed ? (
                    <ChevronRight size={12} className="flex-none text-muted" />
                ) : (
                    <ChevronDown size={12} className="flex-none text-muted" />
                )}
                <span
                    className={cn(
                        "min-w-0 flex-1 truncate text-[11px] font-semibold",
                        all ? "text-muted" : "text-ink-mid"
                    )}
                >
                    {row.label}
                </span>
                <span className={cn("flex-none text-[10.5px] tabular-nums", partial ? "text-ink-mid" : "text-muted")}>
                    {partial ? `${done}/${row.files}` : row.files}
                </span>
                <span
                    className={cn("flex-none text-[10.5px] tabular-nums", all ? "text-ink-faint" : "text-diff-added")}
                >
                    +{row.adds}
                </span>
                <span
                    className={cn("flex-none text-[10.5px] tabular-nums", all ? "text-ink-faint" : "text-diff-removed")}
                >
                    −{row.dels}
                </span>
            </button>
            {done != null ? (
                <ReviewBox
                    state={all ? "ok" : "none"}
                    title={all ? `Unmark every file in ${row.label}` : `Mark every file in ${row.label} reviewed`}
                    onToggle={onReview}
                    attrs={{ "data-review-toggle-dir": row.id }}
                />
            ) : null}
        </div>
    );
}

// The pane's reviewed count, under its file-count row; here rather than in the two panes for the same
// reason as the toggle above. The track is drawn at 0 too, so the first mark does not shift the list.
export function ReviewProgress({ review, changes }: { review: ReviewSubject | null; changes: GitChanges | null }) {
    const marks = useAtomValue(reviewMarksAtom);
    if (review == null || changes == null || changes.files.length === 0) {
        return null;
    }
    const { done, total } = reviewProgress(marks[review], changes.files);
    return (
        <div
            data-files-reviewed
            data-done={done}
            data-total={total}
            className="mt-[8px] flex h-[18px] items-center gap-[9px]"
        >
            <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-edge-faint">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(done / total) * 100}%` }} />
            </div>
            {done === total ? (
                <span className="flex items-center gap-[5px] text-[10.5px] font-semibold tabular-nums text-accent-soft">
                    <Check size={11} strokeWidth={3} className="text-accent" />
                    all {total} reviewed
                </span>
            ) : (
                <span className="text-[10.5px] font-semibold tabular-nums text-ink-mid">
                    {done}/{total} reviewed
                </span>
            )}
            {done > 0 ? (
                <button
                    data-review-clear
                    onClick={() => clearReviewed(review)}
                    title="Clear every review mark on this list"
                    className="flex-none text-[11px] font-semibold text-muted underline decoration-edge-strong underline-offset-2 hover:text-foreground"
                >
                    Clear
                </button>
            ) : null}
        </div>
    );
}

export function ChangedFileList({
    changes,
    selectedFile,
    onSelectFile,
    review = null,
}: {
    changes: GitChanges | null;
    selectedFile: string | null;
    onSelectFile: (path: string) => void;
    // the list's review subject; null (or left out) draws no checks
    review?: ReviewSubject | null;
}) {
    const tree = useAtomValue(treeModeAtom);
    const collapsed = useAtomValue(collapsedDirsAtom);
    const marks = useAtomValue(reviewMarksAtom);
    const rows = useMemo(
        () => (changes != null && tree ? buildFileTree(changes.files, collapsed) : []),
        [changes, tree, collapsed]
    );
    const listRef = useRef<HTMLDivElement>(null);

    // The selected row stays in view as ↑/↓ walk the list. Found by attribute value rather than a selector, since a
    // path may hold any character.
    useEffect(() => {
        if (selectedFile == null) {
            return;
        }
        for (const el of listRef.current?.querySelectorAll<HTMLElement>("[data-changed-file-row]") ?? []) {
            if (el.dataset.changedFileRow === selectedFile) {
                el.scrollIntoView({ block: "nearest" });
                return;
            }
        }
    }, [selectedFile, changes, tree]);

    if (changes == null) {
        return <FileListSkeleton />;
    }
    if (changes.files.length === 0) {
        return <div className="px-[8px] py-[6px] text-[12px] text-ink-mid">No files changed</div>;
    }

    // Only a bare arrow: a modified one belongs to a binding elsewhere. The cockpit's own ↑/↓ list cursor stands down
    // while focus is in this list (bindings.ts list:next / list:prev), so the key reaches here.
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
            return;
        }
        e.preventDefault();
        const next = stepFile(shownPaths(changes.files, tree, collapsed), selectedFile, e.key === "ArrowDown" ? 1 : -1);
        if (next != null && next !== selectedFile) {
            onSelectFile(next);
        }
    };

    const subjectMarks = review != null ? marks[review] : undefined;
    const fileRow = (change: GitChange, label: string, depth: number) => (
        <FileRow
            key={change.path}
            change={change}
            label={label}
            depth={depth}
            selected={change.path === selectedFile}
            review={review != null ? markState(subjectMarks, change) : null}
            onSelect={() => onSelectFile(change.path)}
            onToggle={() => review != null && toggleReviewed(review, change)}
        />
    );
    const dirMembers = (id: string) => changes.files.filter((c) => c.path.startsWith(id + "/"));

    return (
        <div
            ref={listRef}
            data-file-list
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label="Changed files"
            className="rounded-[7px] outline-none focus-visible:ring-1 focus-visible:ring-edge-strong"
        >
            {tree
                ? rows.map((r) => {
                      if (r.kind === "file") {
                          return fileRow(r.change!, r.label, r.depth);
                      }
                      const members = dirMembers(r.id);
                      const done =
                          review != null ? members.filter((c) => markState(subjectMarks, c) === "ok").length : null;
                      return (
                          <DirRow
                              key={`dir:${r.id}`}
                              row={r}
                              collapsed={collapsed.has(r.id)}
                              done={done}
                              // a new Set every time: jotai compares by reference, so mutating one would
                              // change the value without telling anybody
                              onToggle={() => {
                                  const next = new Set(collapsed);
                                  if (!next.delete(r.id)) {
                                      next.add(r.id);
                                  }
                                  globalStore.set(collapsedDirsAtom, next);
                              }}
                              // all reviewed unmarks all; anything less marks the rest
                              onReview={() => review != null && setReviewed(review, members, done !== members.length)}
                          />
                      );
                  })
                : changes.files.map((f) => fileRow(f, f.path, 0))}
        </div>
    );
}
