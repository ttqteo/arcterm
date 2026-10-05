// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ModalShell } from "@/app/modals/modalshell";
import { modalsModel } from "@/app/store/modalmodel";
import type { AgentActionEntry } from "./agentsviewmodel";
import { ToolDetailBody } from "./narrationtimeline";
import { formatDuration } from "./tooldetail";

// Viewport-level full-detail view for one tool call. Pushed via
// modalsModel.pushModal("AgentToolDetailModal", { action }). The card is overflow-hidden, so detail
// that exceeds the inline budget escalates here where there is room. Reuses ToolDetailBody (shared
// with the inline view). Rides the shared ModalShell chrome (scrim, motion, Esc), like every modal.
export function AgentToolDetailModal({ action }: { action: AgentActionEntry }) {
    const close = () => modalsModel.popModal();
    const ok = action.outcome !== "fail";
    return (
        <ModalShell open onClose={close} className="w-[min(720px,90vw)]">
            <div className="px-4 pt-5 pb-4">
                <div className="flex w-full items-center gap-2.5 border-b border-edge-faint pb-3">
                    <span className={ok ? "text-success" : "text-error"}>{ok ? "✓" : "✗"}</span>
                    <span className="text-xxxs font-bold uppercase tracking-[0.06em] text-feed-label">
                        {action.verb}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-primary">{action.target}</span>
                    {action.durationMs ? (
                        <span className="text-[11px] tabular-nums text-muted">{formatDuration(action.durationMs)}</span>
                    ) : null}
                    <button
                        type="button"
                        onClick={close}
                        className="rounded-[7px] border border-edge-mid px-2 py-1 text-muted hover:text-primary"
                    >
                        ✕
                    </button>
                </div>
                <div className="mt-3 w-full max-h-[70vh] overflow-y-auto rounded-[10px] border border-edge-faint bg-surface-code">
                    {action.detail ? <ToolDetailBody detail={action.detail} variant="modal" /> : null}
                </div>
            </div>
        </ModalShell>
    );
}
