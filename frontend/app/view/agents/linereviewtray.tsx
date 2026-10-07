// frontend/app/view/agents/linereviewtray.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The line review tray, pinned to the diff pane's bottom in File and Review mode: how many comments wait,
// and the one button that sends them all to the agent as one message. It sends to the Diff scope's agent;
// with none in scope, to the project's live agent, a menu of them when there are several, or the
// clipboard when there are none. The Ctrl+Enter binding (files:review-send) presses data-review-send, so
// every check — the ask, a note typed but not added, the target — lives here.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { liveAgentsForProject } from "@/app/view/code/codehandoff";
import { formatChordString } from "@/util/keysym";
import { sameRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { historyRowsAtom } from "./githistorystore";
import { commentSources, formatLineComments, type LineComment } from "./linecomments";
import { lineReviewAtom, recordSend, sendBlock, type LineReviewState, type SendResult } from "./linecommentstore";
import { sendLineComments } from "./linereviewsend";
import { projectListAtom } from "./projectsstore";

const ACCENT_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] bg-accent px-3.5 py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const KBD = "rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px]";

// who a send goes to: the scope's agent, else the project's live agents (one, several, or none: Copy)
type Target = { kind: "agent"; agent: AgentVM } | { kind: "menu"; agents: AgentVM[] } | { kind: "copy" };

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function countLine(comments: LineComment[]): string {
    return `${plural(comments.length, "comment")} on ${plural(new Set(comments.map((c) => c.file)).size, "file")}`;
}

// the one status line: why the button is disabled, else what the last send or copy did
function statusLine(
    state: LineReviewState,
    direct: AgentVM | null
): { text: string; tone: "muted" | "success" | "error"; title?: string } | null {
    if (state.comments.length > 0) {
        const block = sendBlock(state, direct);
        if (block?.kind === "asking") {
            return { text: `${block.agent} is waiting on a question — answer it first`, tone: "muted" };
        }
        if (block?.kind === "draft") {
            return { text: "A comment is not added yet", tone: "muted" };
        }
    }
    const last = state.lastSend;
    if (last == null) {
        return null;
    }
    if (last.ok === false) {
        const text = last.agent ? `Couldn't reach ${last.agent} — comments kept` : "Couldn't copy — comments kept";
        return { text, tone: "error", title: last.error };
    }
    if (last.kind === "copied") {
        return { text: "Copied — paste it to an agent", tone: "success" };
    }
    return { text: `Sent to ${last.agent}`, tone: "success" };
}

export function LineReviewTray({ repoKey, model }: { repoKey: string; model: AgentsViewModel }) {
    const state = useAtomValue(lineReviewAtom(repoKey));
    const scope = useAtomValue(model.diffScopeAtom);
    const agents = useAtomValue(model.agentsAtom);
    const projects = useAtomValue(projectListAtom);
    const historyRows = useAtomValue(historyRowsAtom);
    const [busy, setBusy] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // A click outside closes the menu. No Escape: the key dispatcher listens on window capture first and gives the
    // surface's own Escape its meaning.
    useEffect(() => {
        if (!menuOpen) {
            return;
        }
        const down = (e: PointerEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        window.addEventListener("pointerdown", down);
        return () => window.removeEventListener("pointerdown", down);
    }, [menuOpen]);

    if (state.comments.length === 0 && state.lastSend == null) {
        return null;
    }

    const origin = scope?.repo.origin;
    const scoped = origin?.kind === "agent" ? agents.find((a) => a.id === origin.id) : undefined;
    // a run's (or a vanished agent's) repository is matched to its registered project by path
    const projectName =
        origin?.kind === "project" ? origin.name : (projects.find((p) => sameRepoPath(p.path, repoKey))?.name ?? "");
    const live = scoped ? [] : liveAgentsForProject(agents, projectName);
    const target: Target = scoped
        ? { kind: "agent", agent: scoped }
        : live.length === 1
          ? { kind: "agent", agent: live[0] }
          : live.length > 1
            ? { kind: "menu", agents: live }
            : { kind: "copy" };
    const direct = target.kind === "agent" ? target.agent : null;
    const blocked = sendBlock(state, direct) != null;
    const status = statusLine(state, direct);

    // the same source order the Review cards number by, so a card's number is the number the agent reads
    const message = () => {
        const labelOf = (id: string) => {
            if (id === "worktree") {
                return "your changes";
            }
            const row = (historyRows ?? []).find((r) => r.hash === id);
            return row ? `commit ${id.slice(0, 7)} (${row.subject})` : `commit ${id.slice(0, 7)}`;
        };
        return formatLineComments(state.comments, commentSources(state.comments, labelOf));
    };

    const run = (work: () => Promise<SendResult>) => {
        setBusy(true);
        fireAndForget(async () => {
            try {
                recordSend(repoKey, await work());
            } finally {
                setBusy(false);
            }
        });
    };

    const sendTo = (agent: AgentVM) => {
        setMenuOpen(false);
        run(async () => {
            const r = await sendLineComments(agent, message());
            if (r.ok === false) {
                console.error(`line review: couldn't send to ${agent.name}:`, r.error);
                return { ok: false, agent: agent.name, error: r.error };
            }
            return { ok: true, kind: "sent", agent: agent.name };
        });
    };

    const copy = () =>
        run(async () => {
            try {
                await navigator.clipboard.writeText(message());
                return { ok: true, kind: "copied" };
            } catch (e) {
                console.error("line review: couldn't copy the comments:", e);
                return { ok: false, agent: "", error: String((e as Error)?.message ?? e) };
            }
        });

    const press = () => {
        if (target.kind === "agent") {
            sendTo(target.agent);
        } else if (target.kind === "menu") {
            setMenuOpen((v) => !v);
        } else {
            copy();
        }
    };

    const n = state.comments.length;
    const label = target.kind === "copy" ? "Copy" : `Send ${plural(n, "comment")}`;

    return (
        <div
            data-review-tray
            className="flex flex-none items-center gap-[12px] border-t border-border bg-surface px-[18px] py-[10px] text-[12.5px]"
        >
            <div className="flex min-w-0 flex-1 items-center gap-[10px]">
                {n > 0 ? (
                    <span className="flex-none font-semibold text-ink-hi">{countLine(state.comments)}</span>
                ) : null}
                {status ? (
                    <span
                        data-review-tray-line
                        title={status.title}
                        className={cn(
                            "flex min-w-0 items-center gap-[6px] truncate",
                            status.tone === "success"
                                ? "text-success"
                                : status.tone === "error"
                                  ? "text-error"
                                  : "text-muted"
                        )}
                    >
                        {status.tone === "success" ? (
                            <Check size={14} strokeWidth={2.2} className="flex-none" aria-hidden />
                        ) : null}
                        <span className="min-w-0 truncate">{status.text}</span>
                    </span>
                ) : null}
            </div>
            {n > 0 ? (
                <div ref={menuRef} className="relative flex-none">
                    <button
                        type="button"
                        data-review-send
                        disabled={blocked || busy}
                        aria-haspopup={target.kind === "menu" ? "menu" : undefined}
                        aria-expanded={target.kind === "menu" ? menuOpen : undefined}
                        title={
                            target.kind === "copy"
                                ? "No agent is running in this project: copy the comments to paste to one"
                                : direct
                                  ? `Send every comment to ${direct.name} as one message`
                                  : "Send every comment to an agent as one message"
                        }
                        onClick={press}
                        className={ACCENT_BTN}
                    >
                        {label}
                        {target.kind === "menu" ? <ChevronUp size={13} strokeWidth={2.2} aria-hidden /> : null}
                        <span className={KBD}>{formatChordString("Mod:Enter")}</span>
                    </button>
                    <PopoverReveal
                        open={menuOpen && target.kind === "menu"}
                        origin="bottom right"
                        className="absolute bottom-[calc(100%+6px)] right-0 z-20 w-[240px] overflow-hidden rounded-[10px] border border-border bg-surface p-1 shadow-lg"
                    >
                        <div data-review-agent-menu role="menu" className="flex flex-col">
                            <span className="px-2 pb-1 pt-[2px] text-[10.5px] text-muted">Send to</span>
                            {(target.kind === "menu" ? target.agents : []).map((a) => {
                                const asking = a.state === "asking";
                                return (
                                    <button
                                        key={a.id}
                                        type="button"
                                        role="menuitem"
                                        data-review-agent-option={a.id}
                                        disabled={asking}
                                        title={
                                            asking ? `${a.name} is waiting on a question — answer it first` : undefined
                                        }
                                        onClick={() => sendTo(a)}
                                        className="flex w-full cursor-pointer items-center rounded-[6px] px-2 py-1 text-left text-[12px] text-secondary hover:bg-accent/10 hover:text-primary disabled:cursor-default disabled:opacity-50"
                                    >
                                        <span className="min-w-0 truncate">{a.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </PopoverReveal>
                </div>
            ) : null}
        </div>
    );
}
