// frontend/app/view/code/codechangedpane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The third column mode: what the working tree changed, as one flat list. A row opens the EDITOR,
// not a diff — this is the answer to "which of these do I want to read next", and a Changed tab
// that opened diffs would be the Diff surface with a worse layout.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { statusGlyph } from "./codestatus";
import { codeProjectAtom, codeStatusAtom, codeStatusErrorAtom, loadStatus, openInCode } from "./codestore";

export function CodeChangedPane({ model }: { model: AgentsViewModel }) {
    const project = useAtomValue(codeProjectAtom);
    const status = useAtomValue(codeStatusAtom);
    const error = useAtomValue(codeStatusErrorAtom);

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
    return (
        <div className="h-full overflow-y-auto border-r border-border py-1">
            {rows.map(([path, s]) => {
                const g = statusGlyph(s.status);
                const cut = path.lastIndexOf("/");
                const dir = cut === -1 ? "" : path.slice(0, cut + 1);
                const name = cut === -1 ? path : path.slice(cut + 1);
                return (
                    <div
                        key={path}
                        data-code-changed-row={path}
                        onClick={() => {
                            if (project != null) {
                                fireAndForget(() => openInCode(model, { projectPath: project.path, rel: path }));
                            }
                        }}
                        className="flex cursor-pointer items-center gap-2 px-3 py-[3px] text-[11.5px] hover:bg-accent/10"
                    >
                        <span title={g.label} className={`w-[10px] flex-none text-[10.5px] ${g.className}`}>
                            {g.letter}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                            <span className="text-muted">{dir}</span>
                            <span className="text-secondary">{name}</span>
                        </span>
                        <span className="flex-none text-[10.5px] tabular-nums text-diff-added">+{s.adds}</span>
                        <span className="flex-none text-[10.5px] tabular-nums text-diff-removed">-{s.dels}</span>
                    </div>
                );
            })}
        </div>
    );
}
