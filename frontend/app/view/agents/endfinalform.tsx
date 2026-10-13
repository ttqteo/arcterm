// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SHEET_BTN } from "@/app/view/jarvis/briefrunsheet";
import { cn, fireAndForget } from "@/util/util";
import { useState } from "react";
import { endFinalStage, type FinalEndOutcome } from "./runactions";

// the run sheet's dock button. Built on call, not at load: the sheet's module imports this one.
export function dockButtonClass(): string {
    return cn(SHEET_BTN, "bg-transparent px-3 py-1.5 text-[11.5px]");
}

// Ends a stuck final stage on the human's word. The reason is required: it is what the run records, and for
// a fail what the lead plans the fix round from.
export function EndFinalForm({
    channelId,
    runId,
    onClose,
    onError,
}: {
    channelId: string;
    runId: string;
    onClose: (done: string | null) => void;
    onError: (text: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const blank = reason.trim() === "";
    const btn = dockButtonClass();
    const end = (outcome: FinalEndOutcome) => {
        setBusy(true);
        fireAndForget(async () => {
            try {
                await endFinalStage(channelId, runId, outcome, reason.trim());
                onClose(
                    outcome === "failed"
                        ? "Final stage failed; the lead has the reason."
                        : "Final stage ended unverified."
                );
            } catch (e) {
                onError(`Ending the final stage failed: ${e instanceof Error ? e.message : String(e)}`);
                setBusy(false);
            }
        });
    };
    return (
        <div data-run-sheet-end-final className="flex flex-col gap-1.5">
            <textarea
                autoFocus
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why end it? Recorded on the run; a fail's reason goes to the lead."
                aria-label="Reason for ending the final stage"
                className="resize-none rounded-[6px] border border-edge-mid bg-transparent px-2 py-1.5 text-[12px] leading-[1.5] text-primary outline-none placeholder:text-muted focus-visible:border-accent"
            />
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    disabled={blank || busy}
                    onClick={() => end("unverified")}
                    className={cn(btn, "disabled:opacity-60")}
                >
                    Pass unverified
                </button>
                <button
                    type="button"
                    disabled={blank || busy}
                    onClick={() => end("failed")}
                    className={cn(
                        btn,
                        "border-edge-mid text-muted hover:border-error hover:text-error disabled:opacity-60"
                    )}
                >
                    Fail
                </button>
                <span className="flex-1" />
                <button type="button" disabled={busy} onClick={() => onClose(null)} className={btn}>
                    Keep running
                </button>
            </div>
        </div>
    );
}
