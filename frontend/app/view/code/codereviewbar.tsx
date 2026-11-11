// frontend/app/view/code/codereviewbar.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The review's toolbar controls, shown only while the project has comments: how many (which opens the list),
// Send review and Clear. A review spans the project like a PR spans files, so the count is the project's total.

import { COPY_HOLD_MS, type CopyState } from "@/app/element/copyfeedback";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { MessageSquare, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { AgentPicker } from "./codeagentpicker";
import { handoffProjectName, liveAgentsForProject } from "./codehandoff";
import { projectComments, reviewListRows } from "./codereview";
import {
    codeReviewSendOpenAtom,
    codeReviewsAtom,
    confirmClearReview,
    deleteComment,
    sendReview,
} from "./codereviewstore";
import { codeProjectAtom, codeWorktreesAtom, openInCode, registeredProjects } from "./codestore";

const BUTTON =
    "flex flex-none cursor-pointer items-center gap-1 rounded-[8px] border border-border bg-surface px-2 py-1 text-[12px] text-secondary hover:text-primary";
const POPOVER =
    "absolute right-0 top-[calc(100%+6px)] z-[60] overflow-hidden rounded-[10px] border border-border bg-surface p-2 shadow-popover-md";
const SEND_LABEL: Record<CopyState, string> = { idle: "Send review", copied: "Copied", failed: "Copy failed" };

// Closes a popover on Escape and hands focus back to the button that opened it. The surface's own Escape (back to the
// Cockpit) runs on window capture and stands down while focus is in a data-owns-keys region, so the bar marks itself one
// while a popover is open and the key then reaches this listener. Focus goes to the trigger on open for the same reason:
// a click does not focus a button everywhere (WebKit), and focus outside the region would let Escape leave Code instead.
function useDismissOnEscape(open: boolean, close: () => void, trigger: RefObject<HTMLElement | null>) {
    const closeRef = useRef(close);
    closeRef.current = close;
    useEffect(() => {
        if (!open) {
            return;
        }
        trigger.current?.focus({ preventScroll: true });
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") {
                return;
            }
            e.preventDefault();
            closeRef.current();
            trigger.current?.focus({ preventScroll: true });
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, trigger]);
}

export function CodeReviewBar({ model }: { model: AgentsViewModel }) {
    const project = useAtomValue(codeProjectAtom);
    const reviews = useAtomValue(codeReviewsAtom);
    const registry = useAtomValue(projectsAtom);
    const worktrees = useAtomValue(codeWorktreesAtom);
    const agents = useAtomValue(model.agentsAtom);
    const [open, setOpen] = useAtom(codeReviewSendOpenAtom);
    const [listOpen, setListOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copyState, setCopyState] = useState<CopyState>("idle");
    const sendRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLButtonElement>(null);
    const closeSend = () => setOpen(false);
    const closeList = () => setListOpen(false);
    useDismissOnEscape(open, closeSend, sendRef);
    useDismissOnEscape(listOpen, closeList, listRef);
    // the flag is module-scoped so a key can open it, which would otherwise reopen it on the way back to Code
    useEffect(() => () => globalStore.set(codeReviewSendOpenAtom, false), []);

    const comments = project == null ? [] : projectComments(reviews, project.path);
    const count = comments.length;
    if (project == null || count === 0) {
        return null;
    }
    const projectName = handoffProjectName(
        project,
        registeredProjects(registry),
        worktrees.find((wt) => wt.ismain)?.path ?? null
    );
    const targets = liveAgentsForProject(agents, projectName);

    const send = async (target: AgentVM | null) => {
        setOpen(false);
        const res = await sendReview(target, projectName);
        setError("message" in res ? res.message : null);
        if (target == null) {
            setCopyState(res.ok ? "copied" : "failed");
            window.setTimeout(() => setCopyState("idle"), COPY_HOLD_MS);
        }
    };

    const openRow = (path: string, line: number) => {
        setListOpen(false);
        void openInCode(model, { projectPath: project.path, rel: path, line });
    };

    return (
        <div
            data-code-review-bar
            data-owns-keys={open || listOpen ? "" : undefined}
            className="flex flex-none items-center gap-1.5"
        >
            <div className="relative">
                <button
                    ref={listRef}
                    type="button"
                    data-code-review-count={count}
                    title={`${count} review comment${count === 1 ? "" : "s"} in this project`}
                    onClick={() => setListOpen((v) => !v)}
                    className="flex flex-none cursor-pointer items-center gap-1 rounded-[6px] px-1 py-0.5 text-[12px] text-accent-soft hover:bg-accent/10"
                >
                    <MessageSquare size={13} strokeWidth={1.8} />
                    {count}
                </button>
                {listOpen ? <div className="fixed inset-0 z-50" onClick={closeList} /> : null}
                <PopoverReveal open={listOpen} origin="top right" className={cn(POPOVER, "w-[320px]")}>
                    <div data-code-review-list className="max-h-[46vh] overflow-y-auto">
                        {reviewListRows(comments).map((row) => (
                            <div
                                key={row.id}
                                data-code-review-row={row.label}
                                className="flex items-start gap-1 rounded-[6px] hover:bg-accent/10"
                            >
                                <button
                                    type="button"
                                    onClick={() => openRow(row.path, row.line)}
                                    className="flex min-w-0 flex-1 cursor-pointer flex-col items-start px-2 py-1 text-left"
                                >
                                    <span className="max-w-full truncate font-mono text-[10.5px] text-muted">
                                        {row.label}
                                    </span>
                                    <span className="max-w-full truncate text-[11.5px] text-secondary">{row.note}</span>
                                </button>
                                <button
                                    type="button"
                                    aria-label="Delete comment"
                                    title="Delete comment"
                                    onClick={() => deleteComment(row.id)}
                                    className="mr-1 mt-1 flex-none cursor-pointer rounded-[4px] p-0.5 text-muted hover:text-error"
                                >
                                    <X size={12} strokeWidth={2} />
                                </button>
                            </div>
                        ))}
                    </div>
                </PopoverReveal>
            </div>
            <div className="relative">
                <button
                    ref={sendRef}
                    type="button"
                    data-code-review-send
                    title="Send the review (Alt+Shift+M)"
                    onClick={() => {
                        setError(null);
                        setOpen(!open);
                    }}
                    className={cn(
                        BUTTON,
                        copyState === "copied" && "text-accent-soft",
                        copyState === "failed" && "text-error"
                    )}
                >
                    <Send size={13} strokeWidth={1.8} />
                    <span>{SEND_LABEL[copyState]}</span>
                </button>
                {open ? <div className="fixed inset-0 z-50" onClick={closeSend} /> : null}
                <PopoverReveal open={open} origin="top right" className={cn(POPOVER, "w-[260px]")}>
                    <AgentPicker
                        targets={targets}
                        onPick={(t) => void send(t)}
                        emptyLabel="Copy review"
                        onEmpty={() => void send(null)}
                    />
                </PopoverReveal>
            </div>
            <button
                type="button"
                data-code-review-clear
                title="Clear every comment in this project"
                aria-label="Clear review"
                onClick={confirmClearReview}
                className={BUTTON}
            >
                <Trash2 size={13} strokeWidth={1.8} />
            </button>
            {error != null ? (
                <span
                    role="alert"
                    data-code-review-error
                    className="max-w-[240px] truncate text-[11.5px] text-error"
                    title={error}
                >
                    {error}
                </span>
            ) : null}
        </div>
    );
}
