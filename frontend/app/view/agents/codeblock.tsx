// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { pushToast } from "@/app/cockpit/notificationstore";
import { CopyButton } from "@/app/element/copybutton";
import { cn } from "@/util/util";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Play } from "lucide-react";
import { isRunnableLang, runnableCommand } from "./coderun";
import { runInTerminal } from "./coderunstore";
import { highlightLine, isPlainLang, type CodeToken } from "./highlight";
import { PINNED_PROMPT_HEIGHT_VAR } from "./pinnedpromptbar";

// Wrap long lines instead of scrolling sideways, on by default. One mode for every code block, kept across
// reloads (atomWithStorage convention, see cockpitprefsstore.ts).
const codeWrapAtom = atomWithStorage<boolean>("cockpit.codeblock.wrap", true);

// Styled fenced-code block for transcript prose (Wave-transcript-feed.dc.html code block).
// lang label + optional path + wrap/copy affordances + line-number gutter + tokenized source.
export function CodeBlock({ code, lang, path }: { code: string; lang?: string; path?: string }) {
    const [wrap, setWrap] = useAtom(codeWrapAtom);
    const lines = code.replace(/\n$/, "").split("\n");
    const plain = isPlainLang(lang);
    const tokens = (ln: string): CodeToken[] =>
        plain ? [{ t: ln || " ", cls: "text-syntax-ident" }] : highlightLine(ln);
    // a shell block is a command the reply means you to run: Run types it into a new terminal (coderunstore.ts)
    const command = isRunnableLang(lang) ? runnableCommand(code) : undefined;
    const run = () => {
        if (command == null) {
            return;
        }
        runInTerminal(command).catch((e) =>
            pushToast({
                level: "warn",
                title: "Could not run the command",
                message: e instanceof Error ? e.message : String(e),
            })
        );
    };
    // The head sticks to the top of the transcript's scroller while a long block scrolls past, so Wrap and Copy stay in
    // reach; below the pinned prompt when one shows (PINNED_PROMPT_HEIGHT_VAR), and under it (z-[5] < its z-10) as the
    // band slides. overflow-clip, not -hidden: it rounds the corners without making the block a scroller, which would
    // pin the head to the block itself.
    return (
        <div className="my-1.5 overflow-clip rounded-[10px] border border-border bg-surface-code">
            <div
                data-code-head
                className="sticky z-[5] flex select-none items-center gap-2 border-b border-edge-faint bg-surface px-[11px] py-[7px]"
                style={{ top: `var(${PINNED_PROMPT_HEIGHT_VAR}, 0px)` }}
            >
                {lang ? (
                    <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-accent">{lang}</span>
                ) : null}
                {path ? <span className="text-[10.5px] text-muted">{path}</span> : null}
                <div className="flex-1" />
                {command != null ? (
                    <button
                        type="button"
                        title="Run in a new terminal"
                        onClick={run}
                        className={cnHeadButton("text-muted hover:text-accent")}
                    >
                        <Play size={9} strokeWidth={2.5} />
                        Run
                    </button>
                ) : null}
                <button
                    type="button"
                    aria-pressed={wrap}
                    title={wrap ? "Scroll long lines" : "Wrap long lines"}
                    onClick={() => setWrap(!wrap)}
                    className={cnHeadButton(wrap ? "text-accent" : "text-muted")}
                >
                    Wrap
                </button>
                {/* in the head's right end, the block's top-right corner: outside the scroller under it, so it stays put
                    when a long line scrolls */}
                <span data-code-copy className="flex">
                    <CopyButton title="Copy code" content={code} className="text-[12px] text-muted" />
                </span>
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
                            {/* one line's text, without its number: what Chat's focus read quotes a code block from */}
                            <span
                                data-code-line
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

function cnHeadButton(color: string): string {
    return (
        "flex items-center gap-[5px] rounded-sm border border-edge-mid px-2 py-[3px] " +
        "text-[9.5px] tracking-[0.03em] hover:border-edge-strong " +
        color
    );
}
