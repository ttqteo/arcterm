// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Agent tree's place on the Agent surface, beside a thin strip that folds and opens it by hand (treeFoldedAtom,
// boardsplitstore.ts), a choice kept across launches. The tree stays open beside a board: it holds the board's row. It
// slides open and shut on the spring (springFoldWidth), and the strip's chevron turns with it.

import { MOTION, springFoldWidth } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { Tooltip } from "@/app/element/tooltip";
import { useAtom } from "jotai";
import { ChevronLeft } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { treeFoldedAtom } from "../boards/boardsplitstore";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { AgentTree } from "./agenttree";

export function AgentTreeSlot({ model, agent }: { model: AgentsViewModel; agent: AgentVM | undefined }) {
    if (agent == null) {
        return <AgentTree model={model} />;
    }
    return <FoldableTree model={model} />;
}

function FoldableTree({ model }: { model: AgentsViewModel }) {
    const [folded, setFolded] = useAtom(treeFoldedAtom);
    const fold = usePartMotion(springFoldWidth);
    const toggle = () => setFolded(!folded);
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
                content={folded ? "Show agents" : "Fold agents"}
                placement="right"
                divClassName="flex h-full shrink-0"
                hideOnClick
            >
                <button
                    type="button"
                    data-agent-tree-strip={folded ? "folded" : "open"}
                    aria-label={folded ? "Show agents" : "Fold agents"}
                    onClick={toggle}
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
