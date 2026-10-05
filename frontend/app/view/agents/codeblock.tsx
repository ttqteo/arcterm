// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { highlightLine } from "./highlight";

// Styled fenced-code block for transcript prose (Wave-transcript-feed.dc.html code block).
// lang label + optional path + copy affordance + line-number gutter + tokenized source.
export function CodeBlock({ code, lang, path }: { code: string; lang?: string; path?: string }) {
    const [copied, setCopied] = useState(false);
    const lines = code.replace(/\n$/, "").split("\n");
    const copy = () => {
        try {
            void navigator.clipboard?.writeText(code);
        } catch {
            // clipboard unavailable — no-op
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
    };
    return (
        <div className="my-1.5 overflow-hidden rounded-[10px] border border-border bg-surface-code">
            <div
                data-code-head
                className="flex items-center gap-2 border-b border-edge-faint bg-surface px-[11px] py-[7px]"
            >
                {lang ? (
                    <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-accent">{lang}</span>
                ) : null}
                {path ? <span className="font-mono text-[10.5px] text-muted">{path}</span> : null}
                <div className="flex-1" />
                <button type="button" onClick={copy} className={cnCopy(copied)}>
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
            <div className="overflow-x-auto">
                <div className="min-w-min py-[9px]">
                    {lines.map((ln, i) => (
                        <div key={i} className="flex whitespace-pre font-mono text-[12px] leading-[1.75]">
                            <span className="w-[34px] shrink-0 select-none pr-[14px] text-right text-ink-faint">
                                {i + 1}
                            </span>
                            <span className="pr-4">
                                {highlightLine(ln).map((tk, k) => (
                                    <span key={k} className={tk.cls}>
                                        {tk.t}
                                    </span>
                                ))}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function cnCopy(copied: boolean): string {
    return (
        "flex items-center gap-[5px] rounded-sm border border-edge-mid px-2 py-[3px] " +
        "text-[9.5px] tracking-[0.03em] hover:border-edge-strong " +
        (copied ? "text-success" : "text-muted")
    );
}
