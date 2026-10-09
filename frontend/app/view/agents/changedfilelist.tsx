// frontend/app/view/agents/changedfilelist.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The changed-file list shared by the panel's Log tab in both of its states, one commit's files (commitpane) and the
// aggregate between two refs (aggregatepane), and by the Commit tab. Extracted rather than duplicated — the row is
// identical in the mockup for all of them, so one renderer is one source of truth for status colour, path truncation
// and the selected tint. The list is focusable: ↑/↓ in it select the next or previous file at once, with no Enter
// (spec decision 0), through the same select callback a click uses.

import { SkeletonLine, SkeletonRows } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { shownPaths, stepFile } from "./filestep";
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
                "flex h-[26px] w-full items-center gap-[8px] rounded-[7px] pr-[8px] text-left transition-colors duration-[140ms] hover:bg-surface-hover",
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
            className="flex h-[24px] w-full items-center gap-[6px] rounded-[7px] pr-[8px] text-left hover:bg-surface-hover"
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
                ? rows.map((r) =>
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
                  )
                : changes.files.map((f) => (
                      <FileRow
                          key={f.path}
                          change={f}
                          label={f.path}
                          depth={0}
                          selected={f.path === selectedFile}
                          onSelect={() => onSelectFile(f.path)}
                      />
                  ))}
        </div>
    );
}
