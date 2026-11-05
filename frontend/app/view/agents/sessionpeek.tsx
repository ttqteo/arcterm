// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Quick look: one ended session's transcript in a dialog over the project Overview, so a session can be read without
// leaving the page. It is SessionBody (sessionsdetail.tsx), the read the session pane gives, with the Activity /
// Transcript toggle, Resume, and Open, which opens the full session pane (its Back returns to the Overview). Esc, the
// close button or a press outside closes it. Which session is HistoryColumn's (projecthistory.tsx).

import { ModalShell } from "@/app/modals/modalshell";
import { cn } from "@/util/util";
import { Maximize2, X } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import type { AgentsViewModel } from "./agents";
import { historySessionLine } from "./projectoverviewmodel";
import { runtimeMeta } from "./runtimemeta";
import type { LiveSession } from "./sessionsarchivestore";
import { PrimaryButton, SessionBody, ViewToggle } from "./sessionsdetail";

const ICON_BTN =
    "flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-[7px] border border-edge-strong bg-surface-raised px-[10px] text-[12px] font-semibold text-secondary hover:border-accent hover:text-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function SessionPeek({
    model,
    session,
    onClose,
    onOpen,
}: {
    model: AgentsViewModel;
    // null: closed
    session: LiveSession | null;
    onClose: () => void;
    // open the session in the full pane
    onOpen: (s: LiveSession) => void;
}) {
    // the dialog fades out after its session is cleared: it keeps drawing the last one meanwhile
    const last = useRef<LiveSession | null>(session);
    if (session != null) {
        last.current = session;
    }
    const s = session ?? last.current;
    const rt = s != null ? runtimeMeta(s.runtime) : null;
    return createPortal(
        <ModalShell
            open={session != null}
            onClose={onClose}
            align="center"
            className="flex h-[min(80vh,820px)] w-[min(920px,92vw)] flex-col"
            christmasLights
        >
            {s != null && rt != null ? (
                <div data-session-peek={s.id} className="flex min-h-0 flex-1 flex-col">
                    <div className="flex flex-none items-center gap-2.5 border-b border-edge-faint px-5 py-3">
                        <span className={cn("flex-none text-[13px]", rt.text)} title={rt.label}>
                            {rt.glyph}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                            <h2 className="truncate text-[14px] font-semibold text-primary" title={s.task || undefined}>
                                {s.task || "(untitled session)"}
                            </h2>
                            <span className="truncate text-[11.5px] text-muted">{historySessionLine(s)}</span>
                        </div>
                        <ViewToggle model={model} />
                        {/* Resume (or Jump) leaves the Overview for the agent's terminal: the dialog closes with it */}
                        <span className="contents" onClickCapture={onClose}>
                            <PrimaryButton model={model} session={s} />
                        </span>
                        <button
                            type="button"
                            data-session-peek-open
                            onClick={() => onOpen(s)}
                            title="Open the full session"
                            className={ICON_BTN}
                        >
                            <Maximize2 size={12} aria-hidden />
                            Open
                        </button>
                        <button
                            type="button"
                            data-session-peek-close
                            onClick={onClose}
                            title="Close (Esc)"
                            aria-label="Close"
                            className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <X size={14} aria-hidden />
                        </button>
                    </div>
                    <SessionBody model={model} session={s} empty="" className="px-5 pb-3" pinBg="bg-modalbg" />
                </div>
            ) : null}
        </ModalShell>,
        document.body
    );
}
