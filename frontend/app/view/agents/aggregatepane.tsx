// frontend/app/view/agents/aggregatepane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The bottom half of the Log tab while the comparison's aggregate row is selected: what head introduces relative to
// base, anchored at their merge base. When a *commit* row is selected
// instead, the surface renders the shipped CommitPane — a compare commit row is a HistoryRow, so no
// adapter is needed.

import { ChangedFileList, TreeModeToggle } from "./changedfilelist";
import { formSentence } from "./comparerows";
import type { CompareForm } from "./diffcontent";
import type { GitChanges } from "./gitstatus";

export function AggregatePane({
    base,
    head,
    form,
    mergeBase = "",
    changes,
    selectedFile,
    onSelectFile,
}: {
    base: string;
    head: string;
    form: CompareForm;
    mergeBase?: string;
    changes: GitChanges | null;
    selectedFile: string | null;
    onSelectFile: (path: string) => void;
}) {
    const count = changes?.files.length ?? 0;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* The refs and the range form are the compare bar's now (diffpanel.tsx); this pane says what the form
                asks, so the file list under it is never read as the other question. */}
            <div className="flex-none border-b border-edge-faint px-[12px] pb-[8px] pt-[8px]">
                <p className="text-[11px] leading-[1.45] text-muted">{formSentence(form, base, head, mergeBase)}</p>
                <div className="mt-[8px] flex items-center gap-[8px]">
                    <span className="text-[11px] font-semibold tabular-nums text-ink-mid">
                        {count} {count === 1 ? "file" : "files"}
                    </span>
                    <span className="text-[11px] font-semibold tabular-nums text-diff-added">
                        +{changes?.adds ?? 0}
                    </span>
                    <span className="text-[11px] font-semibold tabular-nums text-diff-removed">
                        −{changes?.dels ?? 0}
                    </span>
                    <div className="flex-1" />
                    <TreeModeToggle />
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-[6px] pb-[12px] pt-[6px]">
                <ChangedFileList changes={changes} selectedFile={selectedFile} onSelectFile={onSelectFile} />
            </div>
        </div>
    );
}
