// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A file's diff hunks as the rail's Changes tab draws them: each hunk a `⋯` label row
// (the function git names) over its numbered rows.

import { cn } from "@/util/util";
import { DiffRow } from "./diffrow";
import { isCitedRow, type ChangesHunk } from "./railchangesmodel";

// as the transcript's inline panels: a long line wraps inside its row rather than scrolling sideways
const ROW_WRAP = "whitespace-pre-wrap break-words";

export const DIFF_NOTES: Record<"binary" | "whitespace" | "toolarge" | "empty", string> = {
    binary: "Binary file",
    whitespace: "Only whitespace changed",
    toolarge: "Too large to show here",
    empty: "No line changes",
};

// cited: the new-side line a citation names, whose row's number draws bold; hunkClassName sets each hunk's scroll margin
export function DiffHunks({
    hunks,
    cited,
    hunkClassName,
}: {
    hunks: ChangesHunk[];
    cited?: number | null;
    hunkClassName?: string;
}) {
    return (
        <>
            {hunks.map((h, i) => (
                <div key={i} data-changes-hunk={i} className={hunkClassName}>
                    {h.label != null ? (
                        <div
                            data-changes-hunk-label
                            className={cn(
                                "flex h-[24px] items-center pl-[3px] font-mono text-[11px] text-muted",
                                i > 0 && "mt-[6px]"
                            )}
                        >
                            <span className="w-[42px] flex-none pr-[14px] text-right text-ink-faint">⋯</span>
                            <span className="min-w-0 truncate">{h.label}</span>
                        </div>
                    ) : null}
                    {h.rows.map((row, k) => (
                        <DiffRow key={k} line={row} numbered wrap={ROW_WRAP} cited={isCitedRow(row, cited)} />
                    ))}
                </div>
            ))}
        </>
    );
}
