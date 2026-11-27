// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat's Plan to review card: the chunks the agent proposed for its initiative (`wsh effort chunk add --proposed`), drawn
// at the end of the conversation, where the person reads the reply that proposed them, instead of only on the rail's
// Initiative tab, which is often on another tab or folded. It is the rail's section (planreviewsection.tsx) in Chat's card
// frame: the same rows, Accept / Rename / Drop, Accept all and continue, and the same store, so a decision made here
// shows on the rail, the header's "N to review" chip and Jarvis.

import { MOTION, springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { AgentVM } from "./agentsviewmodel";
import { chatPlanShown } from "./planreviewmodel";
import { PlanReviewSection } from "./planreviewsection";
import { useInitiativeReread, usePlanReview } from "./planreviewstore";

// The gap of the conversation's item column (chatconversation.tsx ITEM_GAP: gap-4). The card is a direct child of that
// column, so while it is closed its margin takes the gap back, as the other end-of-conversation cards do: a card opening
// from nothing would shove what is above it by the gap, and one closing would hold the gap open.
const ITEM_GAP = 16;

/** The card, after the conversation's last row while the agent's initiative has a chunk to review (or one just decided,
 *  held for Undo). Draws nothing for an agent with no initiative. */
export function ChatPlanReview({ agent, exited }: { agent: AgentVM; exited: boolean }) {
    // Chat is what is on screen when the agent stops with a plan, so it reads the initiative again on each state change,
    // as the rail does; the read also ends the rows the section holds for Undo (planreviewstore.ts)
    useInitiativeReread(agent.effortId, agent.state, true);
    const view = usePlanReview(agent.effortId);
    const reduceMotion = useReducedMotion();
    const reveal = usePartMotion(springReveal);
    // a margin is no height or transform, so the app's reduced-motion config would still glide it: it jumps here
    const rowSpring = reduceMotion ? { duration: 0 } : MOTION.spring;
    return (
        <AnimatePresence initial={false}>
            {chatPlanShown(view.effort != null, view.rows) ? (
                <motion.div
                    key="plan"
                    data-chat-plan-row
                    initial={{ marginTop: -ITEM_GAP }}
                    animate={{ marginTop: 0, transition: rowSpring }}
                    exit={{ marginTop: -ITEM_GAP, transition: rowSpring }}
                >
                    <motion.div {...reveal} className="overflow-hidden rounded-[12px]">
                        {/* the view goes in as a prop, so the element held for the exit folds with the rows it last
                            showed instead of an emptied card */}
                        <PlanReviewSection agent={agent} place="chat" exited={exited} view={view} />
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
