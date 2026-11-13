// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Confirm the design card (docs/superpowers/specs/2026-11-12-chat-brainstorm-review-design.md, section 1): once the
// agent has stopped asking, the design waits on the user's review and the conversation ends with this card. It shows
// `reviewHead`'s line and its one action, a row for each decision that needs the user (a guess, or a decision the agent
// changed since the user confirmed it), and the user's own decisions folded into `N yours ›`. What it shows is
// chatbrainstorm.ts's `brainstormCard`; the shell, the rows and the fold are chatbrainstormparts.tsx's.

import { springReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { ListChecks } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { AgentVM } from "./agentsviewmodel";
import type { BrainstormFile } from "./brainstormmodel";
import { sendBrainstorm } from "./brainstormsend";
import { baselineBrainstormSeen, markBrainstormSeen } from "./brainstormstore";
import { ERROR_LINE, useAction } from "./brainstormui";
import type { ConfirmCard } from "./chatbrainstorm";
import { CardShell, DecisionRow, FOCUS_RING, Fold, PRIMARY_BTN } from "./chatbrainstormparts";

/** The Confirm the design card at the end of the conversation. `file` is the file the card was made from and `path` its
 *  brainstorm.json: the card writes what the user has seen of it (`brainstormSeenAtom`), so the `New` marks on its rows
 *  have a baseline in Chat, and clear when the user leaves Chat or the card folds. Every button is off while the card is
 *  `working` (the agent is writing up a click) or `static` (the agent exited). */
export function ChatBrainstormConfirm({
    agent,
    card,
    path,
    file,
}: {
    agent: AgentVM;
    card: ConfirmCard;
    path: string;
    file: BrainstormFile;
}) {
    // what the card drew last is what the user has seen once they leave it: what came while it was open showed marked new
    const drawn = useRef(file);
    useEffect(() => {
        drawn.current = file;
    });
    useEffect(() => {
        baselineBrainstormSeen(path, drawn.current);
        return () => markBrainstormSeen(path, drawn.current);
    }, [path]);

    const act = useAction();
    const idle = card.state === "waiting";
    const off = !idle || act.busy;
    return (
        <CardShell
            kind="confirm"
            state={card.state}
            head="Confirm the design"
            icon={<ListChecks size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            agent={agent}
        >
            <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[8px]">
                <span
                    data-chat-bscard-review-line
                    className="min-w-[200px] flex-1 text-[13px] leading-[1.5] text-secondary"
                >
                    {card.line}
                </span>
                {card.action === "confirm-all" ? (
                    <button
                        type="button"
                        data-chat-bscard-confirm-all
                        disabled={off}
                        onClick={() => void act.run(() => sendBrainstorm(agent, { kind: "confirm-all" }))}
                        className={cn(PRIMARY_BTN, FOCUS_RING)}
                    >
                        Confirm all {card.guesses} guesses
                    </button>
                ) : null}
                {card.action === "check" ? (
                    <button
                        type="button"
                        data-chat-bscard-check
                        disabled={off}
                        onClick={() => void act.run(() => sendBrainstorm(agent, { kind: "check" }))}
                        className={cn(PRIMARY_BTN, FOCUS_RING)}
                    >
                        Check with a builder
                    </button>
                ) : null}
            </div>
            {act.error ? (
                <div role="alert" className={ERROR_LINE}>
                    {act.error}
                </div>
            ) : null}
            {/* a row leaves on the spring when its decision turns yours; the padding under each row is its gap, so the
                collapsing row takes its gap with it, and the negative margin takes the last one back */}
            <div className="-mb-[8px] flex flex-col empty:hidden">
                <AnimatePresence initial={false}>
                    {card.rows.map((row) => (
                        <motion.div
                            key={row.id}
                            variants={springReveal}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="overflow-hidden"
                        >
                            <div className="pb-[8px]">
                                <DecisionRow agent={agent} row={row} disabled={!idle} />
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
            <Fold name="yours" label={`${card.yours.length} yours`} items={card.yours} />
        </CardShell>
    );
}
