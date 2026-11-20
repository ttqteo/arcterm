// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Agent tree's place on the Agent surface. While the shown agent's cell shows Chat with a board beside it, the tree
// folds to a thin strip so the board has the room (treeFolds, boardsplitstore.ts); the strip opens the tree again, and
// stays beside it to fold it back, until the board closes. The tree slides open and shut on the spring (springFoldWidth),
// and the strip's chevron turns with it.

import { MOTION, springFoldWidth } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { Tooltip } from "@/app/element/tooltip";
import { useAtom, useAtomValue } from "jotai";
import { ChevronLeft } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { boardSplitAtom, treeFolds, treePeekAtom } from "../boards/boardsplitstore";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { AgentTree } from "./agenttree";
import { useChatShown } from "./chatmodestore";

export function AgentTreeSlot({ model, agent }: { model: AgentsViewModel; agent: AgentVM | undefined }) {
    if (agent == null) {
        return <AgentTree model={model} />;
    }
    return <BoardAwareTree model={model} agent={agent} />;
}

function BoardAwareTree({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const split = useAtomValue(boardSplitAtom(agent.id));
    const chatShown = useChatShown(agent);
    const [peek, setPeek] = useAtom(treePeekAtom);
    const fold = usePartMotion(springFoldWidth);
    if (split == null || !chatShown) {
        return <AgentTree model={model} />;
    }
    const folded = treeFolds(split, chatShown, peek);
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence initial={false}>
                {folded ? null : (
                    <motion.div key="tree" data-agent-tree-fold className="flex h-full shrink-0" {...fold}>
                        <AgentTree model={model} />
                    </motion.div>
                )}
            </AnimatePresence>
            <Tooltip
                content={folded ? "Show agents" : "Fold agents beside the board"}
                placement="right"
                divClassName="flex h-full shrink-0"
                hideOnClick
            >
                <button
                    type="button"
                    data-agent-tree-strip={folded ? "folded" : "open"}
                    aria-label={folded ? "Show agents" : "Fold agents"}
                    onClick={() => setPeek(folded)}
                    className="flex h-full w-[14px] shrink-0 cursor-pointer items-center justify-center border-r border-border bg-surface text-muted hover:bg-surface-raised hover:text-primary"
                >
                    <motion.span
                        className="flex"
                        animate={{ rotate: folded ? 180 : 0 }}
                        transition={{ duration: MOTION.durMacro, ease: MOTION.easeFluid }}
                    >
                        <ChevronLeft size={11} strokeWidth={2} aria-hidden />
                    </motion.span>
                </button>
            </Tooltip>
        </MotionConfig>
    );
}
