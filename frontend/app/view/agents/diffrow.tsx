// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One numbered diff row, as the rail's Changes tab draws it (diffhunks.tsx). Ported from the kaeltran16 fork, where it
// lives in tooldetailbody.tsx beside the transcript's own diffs.

import { cn } from "@/util/util";
import type { DiffLine } from "./agentsviewmodel";
import { highlightLine } from "./highlight";

export const CODE_TEXT = "text-[12.5px]";

function HighlightedCode({ text }: { text: string }) {
    return (
        <>
            {highlightLine(text).map((tk, k) => (
                <span key={k} className={tk.cls}>
                    {tk.t}
                </span>
            ))}
        </>
    );
}

// the shared diff look (tailwindsetup.css) marks the side, the gutter holds the line's number (the new side's, a
// removed line's old one), or its sign when the diff carries no numbers
export function DiffRow({
    line,
    numbered,
    wrap,
    cited,
}: {
    line: DiffLine;
    numbered: boolean;
    wrap: string;
    // the row of the line a citation names: its number draws bold in accent-soft, the band is the diff's own
    cited?: boolean;
}) {
    const tint = line.sign === "+" ? "diff-line-added" : line.sign === "-" ? "diff-line-removed" : undefined;
    const gutter = numbered ? (line.sign === "-" ? line.oldNo : (line.newNo ?? line.oldNo)) : line.sign;
    return (
        <div
            data-diff-line={line.sign}
            data-diff-cited={cited || undefined}
            className={cn("flex pl-[3px] font-mono leading-[1.6]", CODE_TEXT, tint)}
        >
            <span
                data-diff-no
                className={cn(
                    "shrink-0 select-none text-right",
                    cited ? "font-bold text-accent-soft" : "text-ink-faint",
                    numbered ? "w-[42px] pr-3.5" : "w-[22px] pr-2"
                )}
            >
                {gutter}
            </span>
            {/* the gutter stays put, so a wrapped line hangs under its own text */}
            <span className={cn("min-w-0 pr-3.5", wrap)}>
                <HighlightedCode text={line.text} />
            </span>
        </div>
    );
}
