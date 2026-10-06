// frontend/app/view/agents/aggregatepane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pane 2 of the Diff surface while the aggregate row is selected (diff-polish Compare board): what
// head introduces relative to base, anchored at their merge base. When a *commit* row is selected
// instead, the surface renders the shipped CommitPane — a compare commit row is a HistoryRow, so no
// adapter is needed.

import { cn } from "@/util/util";
import { ChangedFileList, TreeModeToggle } from "./changedfilelist";
import { formSentence, SIDE_TEXT } from "./comparerows";
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
    onSetForm,
}: {
    base: string;
    head: string;
    form: CompareForm;
    mergeBase?: string;
    changes: GitChanges | null;
    selectedFile: string | null;
    onSelectFile: (path: string) => void;
    onSetForm: (form: CompareForm) => void;
}) {
    const count = changes?.files.length ?? 0;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-none border-b border-edge-faint px-[15px] pb-[11px] pt-[14px]">
                {/* base first, the order `git diff base...head` reads in and the order the ref chip and
                    the range summary print — this pane was the last place still naming it backwards */}
                <div className="flex flex-wrap items-center gap-[8px] text-[12px] text-ink-mid">
                    <span className={SIDE_TEXT.base}>{base}</span>
                    <span className="text-ink-faint">→</span>
                    <span className={SIDE_TEXT.head}>{head}</span>
                </div>
                {/* The two range forms named in words, with git's separator as the faint hint: three
                    dots is what head introduced since the merge base, two is the full difference
                    between the tips. The file list and the diff pane both read this, so they cannot
                    disagree about which question is asked. */}
                <div
                    role="group"
                    aria-label="What to compare"
                    className="mt-[10px] flex overflow-hidden rounded-[9px] border border-edge-mid"
                >
                    {(["mergebase", "tips"] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => onSetForm(f)}
                            aria-pressed={form === f}
                            className={cn(
                                "flex h-[28px] flex-1 items-center justify-center gap-[6px] text-[11.5px] font-semibold",
                                f === "mergebase" && "border-r border-edge-faint",
                                form === f ? "bg-surface-selected text-ink-hi" : "text-muted hover:text-foreground"
                            )}
                        >
                            {f === "mergebase" ? "Since the split" : "Tip to tip"}
                            <span className="text-[10px] font-normal text-ink-faint">
                                {f === "mergebase" ? "···" : "··"}
                            </span>
                        </button>
                    ))}
                </div>
                <p className="mt-[10px] text-[12px] leading-[1.5] text-ink-mid">
                    {formSentence(form, base, head, mergeBase)}
                </p>
                <div className="mt-[10px] flex items-center gap-[10px]">
                    <span className="text-[11px] font-semibold tabular-nums text-muted">
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
            <div className="min-h-0 flex-1 overflow-y-auto px-[8px] pb-[20px] pt-[8px]">
                <ChangedFileList changes={changes} selectedFile={selectedFile} onSelectFile={onSelectFile} />
            </div>
        </div>
    );
}
