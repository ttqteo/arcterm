// frontend/app/view/code/codeagentpicker.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The agent list Send review offers. With no live agent for the project, the clipboard is the honest
// fallback rather than a disabled button with no explanation; a worktree browsed outside the registry
// never has one.

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";

export function AgentPicker({
    targets,
    onPick,
    emptyLabel,
    onEmpty,
}: {
    targets: readonly AgentVM[];
    onPick: (target: AgentVM) => void;
    emptyLabel: string;
    onEmpty: () => void;
}) {
    if (targets.length === 0) {
        return (
            <>
                <p className="px-1 pb-1 text-[11px] text-muted">No agent is running in this project.</p>
                <button
                    type="button"
                    data-code-agent-picker-empty
                    onClick={onEmpty}
                    className="w-full cursor-pointer rounded-[6px] border border-border px-2 py-1 text-[11.5px] text-secondary hover:text-primary"
                >
                    {emptyLabel}
                </button>
            </>
        );
    }
    return (
        <>
            {targets.map((t) => {
                // the review is pasted and then Enter is pressed: on an agent waiting on a question that Enter would
                // answer it, so the row is shut until the question is answered, as the Diff's line review does
                const asking = t.state === "asking";
                return (
                    <button
                        key={t.id}
                        type="button"
                        data-code-agent-picker-row={t.name}
                        disabled={asking}
                        title={asking ? `${t.name} is waiting on a question — answer it first` : undefined}
                        onClick={() => onPick(t)}
                        className="flex w-full cursor-pointer items-center justify-between rounded-[6px] px-2 py-1 text-left text-[11.5px] text-secondary hover:bg-accent/10 hover:text-primary disabled:cursor-default disabled:opacity-50"
                    >
                        <span className="min-w-0 truncate">{t.name}</span>
                        <span className="flex-none pl-2 font-mono text-[10.5px] text-muted">{t.state}</span>
                    </button>
                );
            })}
        </>
    );
}
