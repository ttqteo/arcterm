// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCopyFeedback, type CopyState } from "@/app/element/copyfeedback";
import { CrossFade } from "@/app/element/crossfade";
import { cn } from "@/util/util";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { highlightLine, isPlainLang, type CodeToken } from "./highlight";

// Wrap long lines instead of scrolling sideways, on by default. One mode for every code block, kept across
// reloads (atomWithStorage convention, see cockpitprefsstore.ts).
const codeWrapAtom = atomWithStorage<boolean>("cockpit.codeblock.wrap", true);

// Styled fenced-code block for transcript prose (Wave-transcript-feed.dc.html code block).
// lang label + optional path + wrap/copy affordances + line-number gutter + tokenized source.
export function CodeBlock({ code, lang, path }: { code: string; lang?: string; path?: string }) {
    const { state, copy } = useCopyFeedback();
    const [wrap, setWrap] = useAtom(codeWrapAtom);
    const lines = code.replace(/\n$/, "").split("\n");
    const plain = isPlainLang(lang);
    const tokens = (ln: string): CodeToken[] =>
        plain ? [{ t: ln || " ", cls: "text-syntax-ident" }] : highlightLine(ln);
    return (
        <div className="my-1.5 overflow-hidden rounded-[10px] border border-border bg-surface-code">
            <div
                data-code-head
                className="flex select-none items-center gap-2 border-b border-edge-faint bg-surface px-[11px] py-[7px]"
            >
                {lang ? (
                    <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-accent">{lang}</span>
                ) : null}
                {path ? <span className="text-[10.5px] text-muted">{path}</span> : null}
                <div className="flex-1" />
                <button
                    type="button"
                    aria-pressed={wrap}
                    title={wrap ? "Scroll long lines" : "Wrap long lines"}
                    onClick={() => setWrap(!wrap)}
                    className={cnHeadButton(wrap ? "text-accent" : "text-muted")}
                >
                    Wrap
                </button>
                <button type="button" onClick={() => copy(code)} className={cnHeadButton(COPY_TONE[state])}>
                    <CrossFade swapKey={state}>{COPY_LABEL[state]}</CrossFade>
                </button>
            </div>
            <div className="overflow-x-auto">
                <div className={cn("py-[9px]", !wrap && "min-w-min")}>
                    {lines.map((ln, i) => (
                        <div
                            key={i}
                            className={cn("flex font-mono text-[12px] leading-[1.75]", !wrap && "whitespace-pre")}
                        >
                            <span className="w-[34px] shrink-0 select-none pr-[14px] text-right text-ink-faint">
                                {i + 1}
                            </span>
                            <span
                                className={cn(
                                    "pr-4",
                                    wrap && "min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]"
                                )}
                            >
                                {tokens(ln).map((tk, k) => (
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

const COPY_LABEL: Record<CopyState, string> = { idle: "Copy", copied: "Copied", failed: "Copy failed" };
const COPY_TONE: Record<CopyState, string> = { idle: "text-muted", copied: "text-success", failed: "text-error" };

function cnHeadButton(color: string): string {
    return (
        "flex items-center gap-[5px] rounded-sm border border-edge-mid px-2 py-[3px] " +
        "text-[9.5px] tracking-[0.03em] hover:border-edge-strong " +
        color
    );
}
