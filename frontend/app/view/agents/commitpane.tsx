// frontend/app/view/agents/commitpane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pane 2 of the Diff surface (Wave-git-review.dc.html): who made the selected commit, when, and which
// files it touched. Read-only — no stage control, no message box, nothing that authors a commit.

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { Copy } from "lucide-react";
import { formatAgo } from "./agentsviewmodel";
import { ChangedFileList, TreeModeToggle } from "./changedfilelist";
import { type GitChanges } from "./gitstatus";
import { WORKING_TREE, refChipClass, type HistoryRow } from "./historyrows";
import { SubLabel } from "./sectionlabel";

function initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
}

function WorkingTreeHeader({ row, caption }: { row: HistoryRow; caption?: string }) {
    return (
        <>
            <div className={cn(REGION_LABEL, "mb-[8px] flex items-center gap-[7px] text-warning")}>
                <span className="h-[9px] w-[9px] rounded-full border border-dashed border-warning" />
                Working tree
            </div>
            <div className="text-[14px] font-semibold leading-[1.4] text-ink-hi">{row.subject}</div>
            {caption ? <div className="mt-[6px] text-[12px] text-ink-mid">{caption}</div> : null}
        </>
    );
}

function CommitHeader({ row }: { row: HistoryRow }) {
    return (
        <>
            <div className="mb-[9px] flex items-center gap-[8px]">
                <span className="rounded-[5px] border border-accent/30 bg-accentbg px-[7px] py-[2px] font-mono text-[12px] font-semibold text-accent-soft">
                    {row.hash.slice(0, 7)}
                </span>
                <button
                    onClick={() => fireAndForget(() => navigator.clipboard.writeText(row.hash))}
                    title="Copy hash"
                    aria-label="Copy hash"
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-muted hover:bg-surface hover:text-foreground"
                >
                    <Copy size={13} />
                </button>
                <div className="flex-1" />
                <span className="text-[11px] tabular-nums text-muted">{formatAgo(Date.now() - row.ts)}</span>
            </div>
            <div className="mb-[8px] text-[14px] font-semibold leading-[1.4] text-ink-hi">{row.subject}</div>
            <div className="flex items-center gap-[8px]">
                <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-surface-raised text-[10.5px] font-bold text-ink-mid">
                    {initials(row.author)}
                </span>
                <span className="text-[12px] text-ink-mid">{row.author}</span>
            </div>
            {row.refs.length > 0 ? (
                <div className="mt-[9px] flex flex-wrap gap-[6px]">
                    {row.refs.map((r) => (
                        <span
                            key={r.label}
                            className={cn(
                                "rounded-[4px] border px-[6px] py-[2px] text-[10.5px] font-semibold",
                                refChipClass(r.kind)
                            )}
                        >
                            {r.label}
                        </span>
                    ))}
                </div>
            ) : null}
        </>
    );
}

export function CommitPane({
    row,
    changes,
    selectedFile,
    onSelectFile,
    caption,
}: {
    row: HistoryRow | null;
    changes: GitChanges | null;
    selectedFile: string | null;
    onSelectFile: (path: string) => void;
    // the working-tree row's "measured from what" line; worktreeCaption builds it
    caption?: string;
}) {
    if (row == null) {
        return (
            <div className="flex h-full items-center justify-center px-[20px] text-center text-[12.5px] text-muted">
                Select a commit
            </div>
        );
    }
    const isWorkingTree = row.hash === WORKING_TREE;
    const count = changes?.files.length ?? 0;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-none border-b border-edge-faint px-[15px] pb-[12px] pt-[14px]">
                {isWorkingTree ? <WorkingTreeHeader row={row} caption={caption} /> : <CommitHeader row={row} />}
            </div>
            <div className="flex flex-none items-center gap-[9px] px-[15px] pb-[8px] pt-[10px]">
                <SubLabel>
                    {count} {count === 1 ? "file" : "files"}
                </SubLabel>
                <div className="flex-1" />
                <span className="text-[11px] font-semibold tabular-nums text-diff-added">+{changes?.adds ?? 0}</span>
                <span className="text-[11px] font-semibold tabular-nums text-diff-removed">−{changes?.dels ?? 0}</span>
                <TreeModeToggle />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-[8px] pb-[20px]">
                <ChangedFileList changes={changes} selectedFile={selectedFile} onSelectFile={onSelectFile} />
            </div>
        </div>
    );
}
