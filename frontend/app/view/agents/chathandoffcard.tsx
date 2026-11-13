// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The plan handoff as Chat draws it (docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md section 3, board
// H-A-rows): a card holding the plan's title and facts and the four ways to build it as lettered rows, in place of the
// plain choices of the AskUserQuestion with header `Handoff`; once answered, one ✓ row. The rows, the facts line and the
// ✓ row text come from chathandoff.ts; the plan's facts and the run slots from chathandoffstore.ts. The card sends
// nothing itself: a click hands the agent's own option index to `onPick`, whose owner answers the ask.

import { cn, fireAndForget } from "@/util/util";
import { FileCheck } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { AgentAskOption, AgentVM } from "./agentsviewmodel";
import { CardShell, DoneRow, FOCUS_RING, LETTER, ROW, ROW_PICK, ROW_PLAIN } from "./chatbrainstormparts";
import { factsLine, handoffDoneLine, handoffRows, planPathOf } from "./chathandoff";
import { useAgentCwd, usePlanFacts, useRunSlots } from "./chathandoffstore";
import { openAgentPath } from "./pathlinkroute";

// the header's own link, as the board draws it: the accent colour, no box
const LINK_BTN =
    "flex-none cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-[12px] text-accent hover:text-accent-soft hover:underline";

// the file name of the facts line in the mono face, as the board draws it; the rest of the line stays in its own face
function FactsLine({ line, path }: { line: string; path: string | null }): ReactNode {
    const name =
        path
            ?.trim()
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() ?? "";
    if (name === "" || !line.startsWith(name)) {
        return line;
    }
    return (
        <>
            <span className="font-mono">{name}</span>
            {line.slice(name.length)}
        </>
    );
}

/** The handoff card. `waiting` is the live card (the agent is asking and the rows answer it); `static` is an agent that has
 *  exited, whose rows are drawn but cannot be clicked. A row sends the index of the agent's own option for its choice
 *  through `onPick`; one the agent did not offer is disabled. `agent` is only for resolving and opening the plan, so the
 *  link is left out without one (or without a path in the question). */
export function ChatHandoffCard({
    question,
    state,
    agent,
    onPick,
}: {
    question: { question: string; options?: AgentAskOption[] };
    state: "waiting" | "static";
    agent?: AgentVM;
    onPick?: (optionIndex: number) => void;
}) {
    const path = useMemo(() => planPathOf(question.question), [question.question]);
    const rows = useMemo(() => handoffRows(question), [question]);
    const cwd = useAgentCwd(agent);
    const facts = usePlanFacts(path, cwd);
    const slots = useRunSlots();
    const line = factsLine({ path, facts, runs: slots });
    const waiting = state === "waiting";
    const openPlan = agent != null && path != null ? () => fireAndForget(() => openAgentPath(agent, path)) : null;
    return (
        <CardShell
            kind="handoff"
            state={state}
            head="Plan ready"
            icon={<FileCheck size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            label="Plan handoff"
            action={
                openPlan != null ? (
                    <button
                        type="button"
                        data-chat-hcard-plan-open
                        title={`Open ${path}`}
                        onClick={openPlan}
                        className={cn(LINK_BTN, FOCUS_RING)}
                    >
                        Open the plan
                    </button>
                ) : undefined
            }
        >
            {facts?.title != null || line !== "" ? (
                <div className="flex min-w-0 flex-col gap-[4px]">
                    {facts?.title != null ? (
                        <div
                            data-chat-hcard-title
                            title={facts.title}
                            className="truncate text-[15px] font-semibold leading-[1.45] text-primary"
                        >
                            {facts.title}
                        </div>
                    ) : null}
                    {line !== "" ? (
                        <div data-chat-hcard-facts className="truncate text-[12.5px] leading-[1.5] text-muted">
                            <FactsLine line={line} path={path} />
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div role="group" aria-label="How to build it" className="flex flex-col gap-[6px]">
                {rows.map((r) => (
                    <div key={r.letter} className={cn(ROW, r.recommended ? ROW_PICK : ROW_PLAIN)}>
                        <button
                            type="button"
                            data-chat-hcard-row={r.letter}
                            data-choice={r.label}
                            disabled={!waiting || r.optionIndex == null || onPick == null}
                            onClick={() => {
                                if (r.optionIndex != null) {
                                    onPick?.(r.optionIndex);
                                }
                            }}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-[12px] border-0 bg-transparent px-[12px] py-[9px] text-left outline-none disabled:cursor-default"
                        >
                            <span className={LETTER}>{r.letter}</span>
                            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                                <span className="text-[13.5px] font-semibold leading-[1.4] text-primary">
                                    {r.label}
                                </span>
                                <span className="text-[12.5px] leading-[1.45] text-ink-mid">{r.detail}</span>
                            </span>
                            {r.recommended ? (
                                <span
                                    data-chat-hcard-recommended
                                    className="flex-none text-[12px] font-semibold text-accent-soft"
                                >
                                    Recommended
                                </span>
                            ) : null}
                        </button>
                    </div>
                ))}
            </div>
            {waiting ? (
                <div className="text-[12px] leading-[1.5] text-muted">Or type below to answer in your own words</div>
            ) : null}
        </CardShell>
    );
}

/** The ✓ row an answered handoff folds into: `Handoff · Arc engine`, or `Handoff · You replied` for words typed in the box
 *  (the words as the row's tooltip). `picked` and `typed` are the answered question's own fields. */
export function ChatHandoffDone({ picked, typed }: { picked: readonly string[]; typed?: string }) {
    const row = <DoneRow kind="handoff" head={handoffDoneLine({ picked, typed })} />;
    return typed?.trim() ? (
        <div title={typed} className="min-w-0">
            {row}
        </div>
    ) : (
        row
    );
}
