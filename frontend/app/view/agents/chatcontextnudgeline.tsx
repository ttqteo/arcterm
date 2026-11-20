// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The line over Chat's box that asks once, past the red line, whether to compact or clear the context
// (chatcontextnudge.ts). Compact and Clear type the slash command into the terminal, as the details rail's buttons do;
// Later only hides the line until the context next falls under 150k and crosses 200k again.

import { springReveal } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue } from "jotai";
import { Gauge } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { driveAgent } from "./agentactions";
import { contextLevel } from "./agentrailmodel";
import type { AgentVM } from "./agentsviewmodel";
import { contextNudgeShows, contextNudgeText, stillAnswered } from "./chatcontextnudge";
import { usePartMotion } from "./chatfooter";
import { canDrive } from "./consumers";

// the agents whose crossing was answered: module-level, so switching surface or agent keeps the answer
const answeredAtom = atom<ReadonlySet<string>>(new Set<string>());

function setAnswered(id: string, on: boolean): void {
    const cur = globalStore.get(answeredAtom);
    if (cur.has(id) === on) {
        return;
    }
    const next = new Set(cur);
    if (on) {
        next.add(id);
    } else {
        next.delete(id);
    }
    globalStore.set(answeredAtom, next);
}

const BTN =
    "flex-none cursor-pointer rounded-[6px] border-0 bg-transparent px-[7px] py-[2px] text-[11.5px] font-semibold hover:bg-surface-hover";

export function ContextNudgeLine({ agent }: { agent: AgentVM }) {
    const answeredSet = useAtomValue(answeredAtom);
    const pct = agent.usage?.contextpct;
    const max = agent.usage?.contextmax;
    const level = pct != null && Number.isFinite(pct) ? contextLevel(pct, max) : "ok";
    const answered = answeredSet.has(agent.id);
    useEffect(() => {
        if (answered && !stillAnswered(answered, level)) {
            setAnswered(agent.id, false);
        }
    }, [agent.id, answered, level]);
    const part = usePartMotion(springReveal);
    const shows =
        pct != null &&
        contextNudgeShows({
            isClaude: (agent.agent || "claude") === "claude",
            state: agent.state,
            level,
            live: canDrive(agent),
            answered,
        });
    const answer = (cmd: string | null) => {
        setAnswered(agent.id, true);
        if (cmd != null) {
            driveAgent(agent.blockId, cmd);
        }
    };
    return (
        <AnimatePresence initial={false}>
            {shows ? (
                <motion.div key="ctx-nudge" {...part} className="overflow-hidden">
                    <div
                        data-chat-context-nudge=""
                        role="status"
                        // a frame on the surface, as the switch line has: the conversation scrolls under the dock
                        className="mb-1.5 flex items-center gap-2 rounded-[10px] border border-error/30 bg-surface py-[4px] pl-3 pr-1.5 text-[12px] text-secondary"
                    >
                        <Gauge size={12} strokeWidth={1.8} aria-hidden className="flex-none text-error" />
                        <span className="min-w-0 flex-1 truncate">{contextNudgeText(pct ?? 0, max)}</span>
                        <button
                            type="button"
                            data-chat-context-nudge-compact=""
                            title="summarize the conversation so far and keep going from the summary"
                            onClick={() => answer("/compact\r")}
                            className={`${BTN} text-accent-soft`}
                        >
                            Compact
                        </button>
                        <button
                            type="button"
                            data-chat-context-nudge-clear=""
                            title="start a fresh conversation; /resume brings this one back"
                            onClick={() => answer("/clear\r")}
                            className={`${BTN} text-accent-soft`}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            data-chat-context-nudge-later=""
                            title="hide this until the context falls under 150k and crosses 200k again"
                            onClick={() => answer(null)}
                            className={`${BTN} text-muted`}
                        >
                            Later
                        </button>
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
