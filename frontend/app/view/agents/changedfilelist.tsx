// frontend/app/view/agents/changedfilelist.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The changed-file list shared by the Diff surface's middle pane in both of its states: one commit's
// files (commitpane) and the aggregate between two refs (aggregatepane). Extracted rather than
// duplicated — the row is identical in the mockup for both, so one renderer is one source of truth
// for status colour, path truncation and the selected tint.

import { SkeletonLine, SkeletonRows } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { buildFileTree, collapsedDirsAtom, treeModeAtom, type FileTreeRow } from "./filetree";
import { CHANGE_NOTE_TITLE, statusColor, type GitChange, type GitChanges } from "./gitstatus";

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

function FileRow({
    change,
    label,
    depth,
    selected,
    onSelect,
}: {
    change: GitChange;
    label: string;
    depth: number;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            data-changed-file-row={change.path}
            onClick={onSelect}
            style={{ paddingLeft: ROW_PAD_PX + depth * INDENT_PX }}
            title={change.path}
            className={cn(
                "flex w-full items-center gap-[8px] rounded-[7px] py-[7px] pr-[8px] text-left transition-colors duration-[140ms] hover:bg-surface-raised",
                selected && "bg-surface-selected"
            )}
        >
            <span className={cn("w-[13px] flex-none text-center text-[10.5px] font-bold", statusColor(change.status))}>
                {change.status}
            </span>
            <span
                className={cn(
                    "min-w-0 flex-1 truncate text-[11.5px]",
                    selected ? "text-ink-hi" : "text-ink-mid"
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
                    <span className="flex-none text-[10.5px] font-semibold tabular-nums text-diff-added">
                        +{change.adds}
                    </span>
                    <span className="flex-none text-[10.5px] font-semibold tabular-nums text-diff-removed">
                        −{change.dels}
                    </span>
                </>
            )}
        </button>
    );
}

function DirRow({ row, collapsed, onToggle }: { row: FileTreeRow; collapsed: boolean; onToggle: () => void }) {
    return (
        <button
            onClick={onToggle}
            style={{ paddingLeft: ROW_PAD_PX + row.depth * INDENT_PX }}
            title={row.id}
            className="flex w-full items-center gap-[6px] rounded-[7px] py-[5px] pr-[8px] text-left hover:bg-surface-raised"
        >
            {collapsed ? (
                <ChevronRight size={12} className="flex-none text-muted" />
            ) : (
                <ChevronDown size={12} className="flex-none text-muted" />
            )}
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-mid">
                {row.label}
            </span>
            <span className="flex-none text-[10.5px] tabular-nums text-muted">{row.files}</span>
            <span className="flex-none text-[10.5px] tabular-nums text-diff-added">+{row.adds}</span>
            <span className="flex-none text-[10.5px] tabular-nums text-diff-removed">−{row.dels}</span>
        </button>
    );
}

export function ChangedFileList({
    changes,
    selectedFile,
    onSelectFile,
}: {
    changes: GitChanges | null;
    selectedFile: string | null;
    onSelectFile: (path: string) => void;
}) {
    const tree = useAtomValue(treeModeAtom);
    const collapsed = useAtomValue(collapsedDirsAtom);
    const rows = useMemo(
        () => (changes != null && tree ? buildFileTree(changes.files, collapsed) : []),
        [changes, tree, collapsed]
    );
    if (changes == null) {
        return <FileListSkeleton />;
    }
    if (changes.files.length === 0) {
        return <div className="px-[8px] py-[6px] text-[12px] text-ink-mid">No files changed</div>;
    }
    if (!tree) {
        return (
            <>
                {changes.files.map((f) => (
                    <FileRow
                        key={f.path}
                        change={f}
                        label={f.path}
                        depth={0}
                        selected={f.path === selectedFile}
                        onSelect={() => onSelectFile(f.path)}
                    />
                ))}
            </>
        );
    }
    return (
        <>
            {rows.map((r) =>
                r.kind === "dir" ? (
                    <DirRow
                        key={`dir:${r.id}`}
                        row={r}
                        collapsed={collapsed.has(r.id)}
                        // a new Set every time: jotai compares by reference, so mutating one would
                        // change the value without telling anybody
                        onToggle={() => {
                            const next = new Set(collapsed);
                            if (!next.delete(r.id)) {
                                next.add(r.id);
                            }
                            globalStore.set(collapsedDirsAtom, next);
                        }}
                    />
                ) : (
                    <FileRow
                        key={r.id}
                        change={r.change!}
                        label={r.label}
                        depth={r.depth}
                        selected={r.id === selectedFile}
                        onSelect={() => onSelectFile(r.id)}
                    />
                )
            )}
        </>
    );
}
