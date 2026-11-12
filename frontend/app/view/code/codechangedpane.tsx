// frontend/app/view/code/codechangedpane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The third column mode: what the working tree changed, as one flat list. A row opens the EDITOR,
// not a diff — this is the answer to "which of these do I want to read next", and a Changed tab
// that opened diffs would be the Diff surface with a worse layout.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { CHANGE_NOTE_TITLE } from "@/app/view/agents/gitstatus";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState, type KeyboardEvent } from "react";
import { stepRow } from "./codesearch";
import { statusGlyph } from "./codestatus";
import { codeProjectAtom, codeStatusAtom, codeStatusErrorAtom, loadStatus, openInCode } from "./codestore";

const ROW_SELECTOR = "[data-code-changed-row]";

// rows are buttons, so Enter opens one and Tab leaves the list; there is no input above the rows, so ArrowUp
// from the first row stays on it
function walkRows(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
        return;
    }
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at === -1) {
        return;
    }
    e.preventDefault();
    const next = stepRow(at, e.key === "ArrowDown" ? 1 : -1, rows.length);
    if (next !== -1) {
        rows[next].focus();
    }
}

export function CodeChangedPane({ model }: { model: AgentsViewModel }) {
    const project = useAtomValue(codeProjectAtom);
    const status = useAtomValue(codeStatusAtom);
    const error = useAtomValue(codeStatusErrorAtom);
    const [cursor, setCursor] = useState<string | null>(null);

    if (error != null) {
        return (
            <div className="h-full border-r border-border px-3 py-2 text-[11.5px]">
                <p className="text-error">Could not read git status: {error}</p>
                <button
                    type="button"
                    onClick={() => fireAndForget(loadStatus)}
                    className="mt-1 cursor-pointer rounded-[6px] border border-border px-2 py-[3px] text-[11px] text-secondary hover:text-primary"
                >
                    Retry
                </button>
            </div>
        );
    }
    if (status == null) {
        return <div className="h-full border-r border-border px-3 py-2 text-[11.5px] text-muted">Reading status…</div>;
    }
    const rows = [...status.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (rows.length === 0) {
        return (
            <div className="h-full border-r border-border px-3 py-2 text-[11.5px] text-muted">
                No changes in the working tree.
            </div>
        );
    }
    // roving tabindex: one stop in the list, on the row last focused (the first until one is)
    const stop = rows.some(([path]) => path === cursor) ? cursor : rows[0][0];
    return (
        <div className="h-full overflow-y-auto border-r border-border py-1" onKeyDown={walkRows}>
            {rows.map(([path, s]) => {
                const g = statusGlyph(s.status);
                const cut = path.lastIndexOf("/");
                const dir = cut === -1 ? "" : path.slice(0, cut + 1);
                const name = cut === -1 ? path : path.slice(cut + 1);
                return (
                    <button
                        key={path}
                        type="button"
                        data-code-changed-row={path}
                        tabIndex={path === stop ? 0 : -1}
                        onFocus={() => setCursor(path)}
                        onClick={() => {
                            if (project != null) {
                                fireAndForget(() => openInCode(model, { projectPath: project.path, rel: path }));
                            }
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-[3px] text-left text-[11.5px] hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                        <span title={g.label} className={`w-[10px] flex-none text-[10.5px] ${g.className}`}>
                            {g.letter}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                            <span className="text-muted">{dir}</span>
                            <span className="text-secondary">{name}</span>
                        </span>
                        {s.note ? (
                            <span title={CHANGE_NOTE_TITLE[s.note]} className="flex-none text-[10.5px] text-muted">
                                {s.note}
                            </span>
                        ) : (
                            <>
                                <span className="flex-none text-[10.5px] tabular-nums text-diff-added">+{s.adds}</span>
                                <span className="flex-none text-[10.5px] tabular-nums text-diff-removed">
                                    -{s.dels}
                                </span>
                            </>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
