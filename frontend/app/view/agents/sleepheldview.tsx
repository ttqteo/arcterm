// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Chat draws for a sleeping agent's kept question once you have answered it: your answer, and under it the line
// `Goes in when <name> wakes` (sleepheld.ts holds the lines and the clearing rule). It takes the place of the question's
// card, which leaves with the ask: the sleeping agent will never clear it. It opens and closes on the spring a part
// that changes shape rides (springReveal, through usePartMotion so reduced motion shows it at once), so the answer
// grows in under the conversation and folds away when the agent wakes and the answer has gone in.

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { useAtomValue } from "jotai";
import { motion } from "motion/react";
import { useEffect } from "react";
import type { AgentVM } from "./agentsviewmodel";
import {
    dropHeldAnswer,
    getHeldAnswerAtom,
    heldCleared,
    heldLineText,
    heldShown,
    wakesLine,
    type HeldAnswer,
} from "./sleepheld";

/** The answer kept for `agent`'s wake while it still sleeps, or null. It drops the kept answer from its atom once the
 *  agent is awake (or asleep in a later sleep), which is when the answer went in, so a wake while Chat was on another
 *  surface leaves nothing for the next sleep to show. */
export function useHeldAnswer(agent: Pick<AgentVM, "blockId" | "sleeping">): HeldAnswer | null {
    const oref = agent.blockId != null ? `block:${agent.blockId}` : "";
    const held = useAtomValue(getHeldAnswerAtom(oref));
    const cleared = heldCleared(held, agent.sleeping);
    useEffect(() => {
        if (cleared && oref !== "") {
            dropHeldAnswer(oref);
        }
    }, [cleared, oref]);
    return heldShown(held, agent.sleeping);
}

// the ask card's footprint (channelsprimitives.tsx AskRow): the answer sits where the question stood
const CARD = "rounded-[9px] border border-edge-mid bg-lane p-3";

/** The answer, one line per question, and when it reaches the agent. Mounted inside an AnimatePresence, so it leaves on
 *  the same spring it arrived on. */
export function ChatHeldAnswer({ agent, held }: { agent: Pick<AgentVM, "id" | "name">; held: HeldAnswer }) {
    const part = usePartMotion(springReveal);
    return (
        <motion.div {...part} data-chat-held={agent.id} className="overflow-hidden">
            <div className={CARD}>
                {/* a long answer scrolls inside the card rather than pushing the conversation off the screen */}
                <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto">
                    {held.lines.map((line, i) => (
                        <div
                            key={i}
                            data-chat-held-line
                            className="text-[12.5px] leading-[1.5] text-primary [overflow-wrap:anywhere]"
                        >
                            {heldLineText(line)}
                        </div>
                    ))}
                </div>
                <div data-chat-held-note className="mt-1.5 text-[11.5px] text-muted [overflow-wrap:anywhere]">
                    {wakesLine(agent.name)}
                </div>
            </div>
        </motion.div>
    );
}
