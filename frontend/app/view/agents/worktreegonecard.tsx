// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The card over a terminal whose folder was removed (board WorktreeGone): its last screen stays under it, dimmed, with the
// two things worth doing: reopen it in the project's root (the same tool, when it was one), or close it. The pane stays
// mounted under the card at its size, as under a sleeping agent's transcript. What is read and done is
// worktreegonestore.ts's; the rules are worktreegone.ts's.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { toolTerminalName } from "./toolsmodel";
import { toolsStatusAtom } from "./toolsstore";
import { folderName, reopenLabel, reopenTarget } from "./worktreegone";
import { closeGoneTerminal, projectRootsAtom, reopenTerminal } from "./worktreegonestore";

// `barred`: the cell has a bar on top (h-[26px]: a grid cell's, or the panel's), which stays visible above the card
export function WorktreeGoneCard({
    model,
    terminal,
    barred,
}: {
    model: AgentsViewModel;
    terminal: AgentVM;
    barred: boolean;
}) {
    const roots = useAtomValue(projectRootsAtom);
    const tools = useAtomValue(toolsStatusAtom);
    const [busy, setBusy] = useState(false);
    const [refused, setRefused] = useState<string | null>(null);
    const target = reopenTarget(terminal, roots);
    const folder = folderName(terminal.cwd);
    const name = toolTerminalName(terminal, tools ?? []);

    const reopen = () => {
        setBusy(true);
        setRefused(null);
        void reopenTerminal(model, terminal).then((rtn) => {
            if (rtn.ok === false) {
                setRefused(rtn.reason);
                setBusy(false);
            }
        });
    };

    return (
        <div
            data-worktree-gone={terminal.id}
            className={cn(
                "absolute inset-x-0 bottom-0 z-20 flex items-center justify-center bg-background/70 p-[12px]",
                barred ? "top-[26px]" : "top-0"
            )}
        >
            <div className="flex w-[420px] max-w-full flex-col gap-[10px] rounded-[8px] border border-edge-mid bg-surface-raised p-[18px] shadow-popover">
                <div className="text-[14px] font-semibold text-primary">This terminal's folder was removed</div>
                <div className="text-[13px] leading-[19px] text-secondary">
                    {folder != null ? `${folder} no longer exists` : "The folder it ran in no longer exists"}, usually
                    because its worktree went away when its branch landed. {name} has nothing left to run in.
                </div>
                {refused != null ? (
                    <div data-worktree-error className="text-[12px] text-error-soft">
                        {refused}
                    </div>
                ) : null}
                <div className="mt-[4px] flex gap-[8px]">
                    <button
                        type="button"
                        data-worktree-reopen
                        disabled={busy}
                        onClick={reopen}
                        className="h-[28px] cursor-pointer rounded-[8px] bg-accent px-[12px] text-[12.5px] font-semibold text-background hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:cursor-default disabled:opacity-60 disabled:hover:bg-accent"
                    >
                        {reopenLabel(target)}
                    </button>
                    <button
                        type="button"
                        data-worktree-close
                        disabled={busy}
                        onClick={() => closeGoneTerminal(terminal)}
                        className="h-[28px] cursor-pointer rounded-[8px] border border-edge-mid bg-surface-raised px-[12px] text-[12.5px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-60"
                    >
                        Close terminal
                    </button>
                </div>
            </div>
        </div>
    );
}
