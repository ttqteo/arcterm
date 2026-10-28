// frontend/app/view/code/codeblamecolumn.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A column beside the editor rather than Monaco decorations: decorations cannot carry clickable text,
// and injected text would shift the code. Rows are placed from the line layout codeviewer.tsx publishes,
// which keeps Monaco out of this module.

import { useCopyFeedback } from "@/app/element/copyfeedback";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { formatAgeShort } from "@/app/view/agents/agentsviewmodel";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { blameClick, blameIsCurrent, type BlameEntry } from "./codeblame";
import { blameKey, codeBlameAtom, loadBlame } from "./codeblamestore";

export interface EditorLineLayout {
    top(line: number): number;
    height(start: number, lines: number): number;
    version: number;
}

export function CodeBlameColumn({
    model,
    path,
    modtime,
    text,
    layout,
}: {
    model: AgentsViewModel;
    path: string;
    modtime: number;
    text: string;
    layout: EditorLineLayout | null;
}) {
    const state = useAtomValue(codeBlameAtom);
    const lineCount = text.split("\n").length;
    useEffect(() => {
        void loadBlame(path, modtime, lineCount);
    }, [path, modtime, lineCount]);

    const key = blameKey(path);
    const entries = key != null && blameIsCurrent(state, key, modtime) && state.kind === "ready" ? state.entries : null;
    const shownHeight = window.innerHeight;

    return (
        <div
            data-code-blame-column
            className="relative h-full w-[220px] flex-none overflow-hidden border-r border-border bg-surface"
        >
            {state.kind === "loading" && state.path === key ? (
                <p className="px-2 py-1 text-[11px] text-muted">Reading blame…</p>
            ) : null}
            {state.kind === "error" && state.path === key ? (
                <p title={state.message} className="line-clamp-3 px-2 py-1 text-[11px] text-error">
                    Could not read blame: {state.message}
                </p>
            ) : null}
            {entries != null && layout != null
                ? entries.map((e) => {
                      const top = layout.top(e.start);
                      const height = layout.height(e.start, e.lines);
                      // only what is on screen: a scroll re-renders every row drawn
                      if (top + height < 0 || top > shownHeight) {
                          return null;
                      }
                      return <BlameRow key={`${e.start}:${e.sha}`} model={model} entry={e} top={top} height={height} />;
                  })
                : null}
        </div>
    );
}

const ROW =
    "absolute left-0 right-0 flex items-start gap-1.5 overflow-hidden border-t border-border px-2 text-[11px] leading-[18px]";

function BlameRow({
    model,
    entry,
    top,
    height,
}: {
    model: AgentsViewModel;
    entry: BlameEntry;
    top: number;
    height: number;
}) {
    const { state: copyState, copy } = useCopyFeedback();
    const style = { top, height };
    if (!entry.committed) {
        return (
            <div
                data-code-blame-entry={entry.sha}
                title="Not committed"
                style={style}
                className={cn(ROW, "text-muted")}
            >
                not committed
            </div>
        );
    }
    const onClick = () => {
        const click = blameClick(entry);
        if (click.kind === "open-run") {
            fireAndForget(() => openTarget(model, { kind: "run", runId: click.runId }));
        } else if (click.kind === "copy-sha") {
            copy(click.sha);
        }
    };
    return (
        <button
            type="button"
            data-code-blame-entry={entry.sha}
            data-code-blame-run={entry.run?.runId}
            data-code-blame-copied={copyState === "idle" ? undefined : copyState}
            title={`${entry.subject} — ${entry.author}`}
            onClick={onClick}
            style={style}
            className={cn(
                ROW,
                "cursor-pointer text-left text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            )}
        >
            <span className="flex-none font-mono text-secondary">{entry.short}</span>
            {copyState === "idle" ? (
                <span className="flex-none">{formatAgeShort(Date.now() - entry.authorTime * 1000)}</span>
            ) : (
                <span className={cn("flex-none", copyState === "copied" ? "text-accent-soft" : "text-error")}>
                    {copyState === "copied" ? "copied" : "copy failed"}
                </span>
            )}
            {entry.run != null ? <span className="min-w-0 truncate text-accent-soft">{entry.run.goal}</span> : null}
        </button>
    );
}
