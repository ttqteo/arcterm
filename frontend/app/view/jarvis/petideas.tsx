// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sprout's ideas line (docs/superpowers/specs/2026-11-26-session-ideas-design.md, "Jarvis", board Jarvis-Ask): under the updates,
// "N ideas from your sessions to review · Review in Jarvis", then Sprout's fixed chips. Each chip does one thing and none waits on
// a model: What's waiting? and Which lose their transcript soon? open a list in place, Go through N and Discuss open an agent
// and show its started line with Go to agent. Not a queue row, so it never counts in the badge, and hidden with nothing in
// review. The rows, the chips and the log line are sessionideasmodel.ts's; the words and the started state petideasmodel.ts's.

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { getApi } from "@/app/store/global";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Lightbulb } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { openTarget } from "./openref";
import { closePeek } from "./peekstore";
import { ideaChipTab, ideaLeavesLabel, ideasLine, ideaWhere, startedLine } from "./petideasmodel";
import {
    discussIdea,
    goThroughIdeas,
    ideaLaunchesAtom,
    ideaLaunchKindsAtom,
    launchedFor,
    openTabIds,
} from "./sessionideaslaunch";
import { chipsFor, ideaChipLogLine, leavingSoonRows, reviewRows, type IdeaChip } from "./sessionideasmodel";
import { openSessionIdeas, sessionIdeasAtom } from "./sessionideasstore";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// the two chips that open a list in place, by the list they open
type ListKind = "waiting" | "leaving";

function IdeaList({ rows, now }: { rows: readonly SessionIdea[]; now: number }) {
    return (
        <ul
            data-pet-ideas-list
            className="flex max-h-[200px] flex-col overflow-y-auto rounded-[8px] border border-border bg-surface"
        >
            {rows.map((idea) => {
                const leaves = ideaLeavesLabel(idea, now);
                return (
                    <li
                        key={idea.id}
                        data-pet-idea-row={idea.id}
                        className="flex flex-col gap-0.5 border-b border-border px-[9px] py-[7px] last:border-b-0"
                    >
                        <span title={idea.gist} className="truncate text-[11.5px] text-primary">
                            {idea.gist}
                        </span>
                        <span className="flex gap-1.5 text-[10px] text-muted">
                            <span className="min-w-0 truncate">{ideaWhere(idea)}</span>
                            {leaves != null ? <span className="flex-none text-warning">· {leaves}</span> : null}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

function StartedLine({ chip, rows, onGo }: { chip: IdeaChip; rows: readonly SessionIdea[]; onGo: () => void }) {
    const { title, detail } = startedLine(chip, rows);
    return (
        <div
            data-pet-idea-started={chip.kind}
            className="flex items-center gap-2 rounded-[8px] border border-border bg-surface px-[9px] py-[7px]"
        >
            <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
            <span className="flex min-w-0 flex-1 gap-1 text-[11px] text-secondary">
                <span className="min-w-0 truncate">{title}</span>
                <span className="flex-none">· {detail}</span>
            </span>
            <button
                type="button"
                data-pet-idea-go
                onClick={onGo}
                className={cn(
                    "h-[22px] flex-none cursor-pointer whitespace-nowrap rounded-[6px] border border-edge-strong px-2 text-[10.5px] font-semibold text-secondary hover:bg-surface-hover hover:text-primary",
                    FOCUS_RING
                )}
            >
                Go to agent
            </button>
        </div>
    );
}

// `folded` is Sprout folded out of the float, where the chat is for looking, not asking: the line and its Review stay, and the
// chips that open an agent behind a hidden window do not.
export function PetIdeas({
    model,
    now,
    folded,
    onLeave,
}: {
    model: AgentsViewModel;
    now: number;
    folded: boolean;
    onLeave: () => void;
}) {
    const data = useAtomValue(sessionIdeasAtom);
    const launches = useAtomValue(ideaLaunchesAtom);
    const agents = useAtomValue(model.agentsAtom);
    const pending = useAtomValue(model.pendingLaunchesAtom);
    const part = usePartMotion(springReveal);
    const [list, setList] = useState<ListKind | null>(null);

    const rows = reviewRows(data);
    const chips = folded ? [] : chipsFor(data, now);
    const open = openTabIds(agents, pending);
    const tabOf = (ideaId: string) => launchedFor(ideaId, launches, open);
    const kinds = useAtomValue(ideaLaunchKindsAtom);
    const kindOf = (tab: string) => kinds[tab];
    // the list a chip opened, while it has rows: the leaving list closes on its own when its last idea is decided
    const listRows = list === "waiting" ? rows : list === "leaving" ? leavingSoonRows(data, now) : [];
    const started = chips.flatMap((chip) => {
        const tab = ideaChipTab(chip, rows, tabOf, kindOf);
        return tab !== undefined ? [{ chip, tab }] : [];
    });

    const review = async () => {
        onLeave();
        const result = await openSessionIdeas(model);
        // an escort leaves the popup only once the landing succeeds, as petactrun.ts's does: a refusal is the toast's
        if (result.ok) {
            closePeek();
        }
    };

    const goToAgent = async (tabId: string) => {
        onLeave();
        const result = await openTarget(model, { kind: "agent", tabId });
        if (result.ok) {
            closePeek();
        }
    };

    const press = (chip: IdeaChip, position: number) => {
        getApi().sendLog(ideaChipLogLine(chip, position));
        if (chip.kind === "waiting" || chip.kind === "leaving") {
            const kind: ListKind = chip.kind;
            setList((prior) => (prior === kind ? null : kind));
            return;
        }
        // its agent is open and its started line is on screen: a second press would open a second agent
        if (ideaChipTab(chip, rows, tabOf, kindOf) !== undefined) {
            return;
        }
        if (chip.kind === "go-through") {
            void goThroughIdeas(model, rows);
            return;
        }
        const idea = rows.find((r) => r.id === chip.ideaId);
        if (idea != null) {
            void discussIdea(model, idea);
        }
    };

    return (
        <AnimatePresence initial={false}>
            {rows.length > 0 ? (
                <motion.div key="ideas" {...part} data-pet-ideas className="flex-none overflow-hidden">
                    <div className="flex flex-col gap-2 border-t border-border px-3.5 py-[9px]">
                        <div className="flex items-center gap-2">
                            <Lightbulb
                                aria-hidden="true"
                                size={12}
                                strokeWidth={1.8}
                                className="flex-none text-muted"
                            />
                            <span data-pet-ideas-line className="min-w-0 flex-1 text-[11.5px] text-secondary">
                                {ideasLine(rows.length)}
                            </span>
                            <button
                                type="button"
                                data-pet-ideas-review
                                onClick={() => void review()}
                                className={cn(
                                    "flex-none cursor-pointer whitespace-nowrap rounded-[6px] border border-border px-2 py-[3px] text-[10.5px] font-medium text-accent-soft hover:border-edge-strong hover:text-primary",
                                    FOCUS_RING
                                )}
                            >
                                Review in Jarvis
                            </button>
                        </div>
                        {chips.length > 0 ? (
                            <div role="group" aria-label="Session ideas" className="flex flex-wrap gap-1.5">
                                {chips.map((chip, index) => {
                                    const on =
                                        chip.kind === "waiting" || chip.kind === "leaving"
                                            ? list === chip.kind
                                            : started.some((s) => s.chip.kind === chip.kind);
                                    return (
                                        <button
                                            key={chip.kind}
                                            type="button"
                                            data-pet-idea-chip={chip.kind}
                                            aria-pressed={on}
                                            title={chip.text}
                                            onClick={() => press(chip, index + 1)}
                                            className={cn(
                                                "h-6 max-w-full cursor-pointer truncate rounded-full border px-2.5 text-[11px] font-medium",
                                                FOCUS_RING,
                                                on
                                                    ? "border-edge-strong bg-surface-hover text-primary"
                                                    : "border-border text-secondary hover:border-edge-mid hover:bg-surface-hover"
                                            )}
                                        >
                                            {chip.text}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                        <AnimatePresence initial={false}>
                            {listRows.length > 0 ? (
                                <motion.div key="list" {...part} className="overflow-hidden">
                                    <IdeaList rows={listRows} now={now} />
                                </motion.div>
                            ) : null}
                            {started.map(({ chip, tab }) => (
                                <motion.div key={`started:${chip.kind}`} {...part} className="overflow-hidden">
                                    <StartedLine chip={chip} rows={rows} onGo={() => void goToAgent(tab)} />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
