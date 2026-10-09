// frontend/app/view/agents/commitpane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The bottom half of the panel's Log tab: who made the selected commit, when, and which files it touched. Authoring a
// commit is the Commit tab's job, not this pane's.

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { Copy, Loader2 } from "lucide-react";
import { formatAgo } from "./agentsviewmodel";
import { ChangedFileList, TreeModeToggle } from "./changedfilelist";
import { type ChangesStatus } from "./changesstatus";
import { filesListLabel } from "./fileslistlabel";
import { type GitChanges } from "./gitstatus";
import { WORKING_TREE, refChipClass, type HistoryRow } from "./historyrows";

function WorkingTreeHeader({ row, caption }: { row: HistoryRow; caption?: string }) {
    return (
        <>
            <div className={cn(REGION_LABEL, "mb-[6px] flex items-center gap-[7px] text-warning")}>
                <span className="h-[9px] w-[9px] rounded-full border border-dashed border-warning" />
                Working tree
            </div>
            <div className="text-[12.5px] font-semibold leading-[1.4] text-ink-hi">{row.subject}</div>
            {caption ? <div className="mt-[4px] text-[11px] leading-[1.45] text-muted">{caption}</div> : null}
        </>
    );
}

function CommitHeader({ row }: { row: HistoryRow }) {
    return (
        <>
            <div className="mb-[6px] flex items-center gap-[4px] text-[11px] text-muted">
                <button
                    onClick={() => fireAndForget(() => navigator.clipboard.writeText(row.hash))}
                    title="Copy hash"
                    aria-label="Copy hash"
                    className="group flex items-center gap-[4px] rounded-[4px] font-mono text-ink-mid hover:text-ink-hi"
                >
                    {row.hash.slice(0, 7)}
                    <Copy size={11} className="opacity-0 group-hover:opacity-100" />
                </button>
                <span>·</span>
                <span className="min-w-0 truncate">{row.author}</span>
                <span>·</span>
                <span className="flex-none tabular-nums">{formatAgo(Date.now() - row.ts)}</span>
            </div>
            <div className="text-[12.5px] font-semibold leading-[1.4] text-ink-hi">{row.subject}</div>
            {row.refs.length > 0 ? (
                <div className="mt-[7px] flex flex-wrap gap-[6px]">
                    {row.refs.map((r) => (
                        <span
                            key={r.label}
                            className={cn(
                                "rounded-[5px] border px-[5px] text-[10px] font-semibold leading-[16px]",
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
    listStatus,
    onRetry,
    selectedFile,
    onSelectFile,
    caption,
}: {
    row: HistoryRow | null;
    changes: GitChanges | null;
    // changes is null both while the list loads and after its read failed; this says which
    listStatus: ChangesStatus;
    // re-reads the list after a failure
    onRetry: () => void;
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
    const label = filesListLabel(listStatus, changes);
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-none border-b border-edge-faint px-[12px] pb-[9px] pt-[8px]">
                {isWorkingTree ? <WorkingTreeHeader row={row} caption={caption} /> : <CommitHeader row={row} />}
            </div>
            <div className="flex flex-none items-center gap-[8px] px-[12px] pb-[6px] pt-[8px]">
                <span
                    data-files-count
                    role={listStatus === "loading" ? "status" : undefined}
                    className={cn(
                        "flex items-center gap-[7px] text-[11px] text-ink-mid",
                        listStatus !== "loading" && "font-semibold"
                    )}
                >
                    {listStatus === "loading" ? <Loader2 size={12} className="animate-spin" /> : null}
                    {label.text}
                </span>
                <div className="flex-1" />
                {label.counts ? (
                    <>
                        <span className="text-[11px] font-semibold tabular-nums text-diff-added">
                            +{changes?.adds ?? 0}
                        </span>
                        <span className="text-[11px] font-semibold tabular-nums text-diff-removed">
                            −{changes?.dels ?? 0}
                        </span>
                    </>
                ) : null}
                <TreeModeToggle />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-[6px] pb-[12px]">
                {listStatus === "failed" ? (
                    <div className="flex flex-col items-start gap-[8px] px-[7px] py-[6px]">
                        <button
                            data-files-retry
                            onClick={onRetry}
                            className="h-[26px] rounded-[7px] border border-edge-mid px-[10px] text-[11.5px] font-semibold text-ink-mid hover:text-ink-hi"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <ChangedFileList changes={changes} selectedFile={selectedFile} onSelectFile={onSelectFile} />
                )}
            </div>
        </div>
    );
}
