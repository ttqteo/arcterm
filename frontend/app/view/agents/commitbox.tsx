// frontend/app/view/agents/commitbox.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The commit box's pieces shared by the Diff surface's Commit tab and the rail's commit mode.

import { CircleAlert, X } from "lucide-react";

const MIN_BOX_PX = 72; // three lines
const MAX_BOX_PX = 198; // ten lines

// a commit message box grows from three lines to ten with what is typed
export function growMessageBox(el: HTMLTextAreaElement): void {
    el.style.height = "auto";
    el.style.height = `${Math.min(MAX_BOX_PX, Math.max(MIN_BOX_PX, el.scrollHeight + 2))}px`;
}

export function CommitFailure({ failure, onDismiss }: { failure: GitFailure; onDismiss: () => void }) {
    const hook = /hook/i.test(failure.stderr);
    return (
        <div
            data-commit-failure
            className="flex flex-col gap-[5px] rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[8px]"
        >
            <div className="flex items-center gap-[6px] text-[11.5px] font-semibold text-error">
                <CircleAlert size={12} className="flex-none" />
                <span className="min-w-0 flex-1">
                    {hook ? "A hook stopped the commit" : "The commit did not go through"}
                </span>
                <button
                    onClick={onDismiss}
                    aria-label="Dismiss"
                    className="flex flex-none text-muted hover:text-ink-hi"
                >
                    <X size={12} />
                </button>
            </div>
            <div className="select-text break-words font-mono text-[10.5px] text-muted">
                {failure.command}
                {failure.exitcode >= 0 ? ` · exit ${failure.exitcode}` : ""}
            </div>
            {failure.stderr ? (
                <pre className="max-h-[120px] select-text overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.5] text-secondary">
                    {failure.stderr.trim()}
                </pre>
            ) : null}
            <div className="text-[11px] text-ink-mid">Your message and ticks are kept. Fix it, then commit again.</div>
        </div>
    );
}
