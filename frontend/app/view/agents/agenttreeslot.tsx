// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Agent tree's place on the Agent surface, beside a thin strip that folds and opens it by hand (treeFoldedAtom,
// boardsplitstore.ts), a choice kept across launches. The tree stays open beside a board: it holds the board's row. It
// slides open and shut on the spring (springFoldWidth), and the strip's chevron turns with it. Folded, the strip shows a
// dot per agent, and a pause on it (or Alt held) opens the peek card to pick one without unfolding (treepeek.tsx).

import { MOTION, springFoldWidth } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { Tooltip } from "@/app/element/tooltip";
import { cn } from "@/util/util";
import { useAtom } from "jotai";
import { ChevronLeft } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { treeFoldedAtom } from "../boards/boardsplitstore";
import type { AgentsViewModel } from "./agents";
import { AgentTree } from "./agenttree";
import { PeekStripDots, TreePeekCard, usePeekHover } from "./treepeek";

// The person's fold holds in every centre mode, and with no agent open: a launch arcterm held while the machine was
// busy switches the centre to its held pane, and that must not unfold the tree they folded.
export function AgentTreeSlot({ model }: { model: AgentsViewModel }) {
    const [folded, setFolded] = useAtom(treeFoldedAtom);
    const fold = usePartMotion(springFoldWidth);
    const toggle = () => setFolded(!folded);
    const peek = usePeekHover(folded);
    const strip = (
        <button
            type="button"
            data-agent-tree-strip={folded ? "folded" : "open"}
            aria-label={folded ? "Show agents" : "Fold agents"}
            onClick={toggle}
            className={cn(
                "flex h-full shrink-0 cursor-pointer flex-col items-center border-r border-border bg-surface text-muted hover:bg-surface-raised hover:text-primary",
                // folded, it is wide enough for the lit tile behind the open agent's dot (treepeek.tsx)
                folded ? "w-[20px] justify-start pt-[8px]" : "w-[14px] justify-center"
            )}
        >
            <motion.span
                className="flex shrink-0"
                animate={{ rotate: folded ? 180 : 0 }}
                transition={{ duration: MOTION.durMacro, ease: MOTION.easeFluid }}
            >
                <ChevronLeft size={11} strokeWidth={2} aria-hidden />
            </motion.span>
            {folded ? <PeekStripDots model={model} /> : null}
        </button>
    );
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence initial={false}>
                {folded ? null : (
                    <motion.div key="tree" data-agent-tree-fold className="flex h-full shrink-0" {...fold}>
                        <AgentTree model={model} />
                    </motion.div>
                )}
            </AnimatePresence>
            {folded ? (
                // folded, the strip lists the agents as dots and a pause on it opens the peek card, which names them, so
                // it carries no tooltip of its own
                <div className="relative flex h-full shrink-0" onPointerEnter={peek.enter} onPointerLeave={peek.leave}>
                    {strip}
                    <TreePeekCard model={model} folded={folded} hoverOpen={peek.hoverOpen} onPicked={peek.close} />
                </div>
            ) : (
                <Tooltip content="Fold agents" placement="right" divClassName="flex h-full shrink-0" hideOnClick>
                    {strip}
                </Tooltip>
            )}
        </MotionConfig>
    );
}
