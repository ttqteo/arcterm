// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// To review on the Brief (spec 2026-11-19-run-followups-visible-design.md, board B-strip-sheet): one strip at the top of
// the main column, and the sheet it opens from the right. The sheet lists what the runs' leads proposed, a group per run,
// oldest first; a row is ticked to do (one run for all the ticked), kept for later or dropped. Presentational: what is
// drawn is runreview.ts's, the state and the actions are runreviewstore.ts's.

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { ModalShell } from "@/app/modals/modalshell";
import type { LauncherModel } from "@/app/view/agents/launcherstore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { CURSOR_RING, cursorAttrs, REGION_LABEL, SMALL_BTN } from "./briefstyle";
import {
    footerLine,
    groupAge,
    oldestLine,
    startLabel,
    stripLine,
    tickedKeys,
    type ReviewGroup,
    type ReviewItem,
} from "./runreview";
import {
    clearTicks,
    closeRunReview,
    foldRow,
    openRunReview,
    runReviewGroupsAtom,
    runReviewNavAtom,
    runReviewOpenAtom,
    runReviewRefusalAtom,
    runReviewTicksAtom,
    setRunReviewCursor,
    startRunReview,
    toggleTick,
} from "./runreviewstore";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** The strip: absent with nothing to review, and it enters and leaves on the spring. */
export function RunReviewStrip() {
    const groups = useAtomValue(runReviewGroupsAtom);
    const reveal = usePartMotion(springReveal);
    const oldest = oldestLine(groups, Date.now());
    return (
        <AnimatePresence initial={false}>
            {groups.length > 0 ? (
                <motion.div key="to-review" {...reveal} className="overflow-hidden">
                    <button
                        type="button"
                        data-run-review-strip
                        aria-haspopup="dialog"
                        onClick={openRunReview}
                        className={cn(
                            "flex h-11 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-[8px] border border-edge-mid bg-surface-raised px-3 text-left hover:border-edge-strong",
                            FOCUS
                        )}
                    >
                        <span className={cn(REGION_LABEL, "text-muted")}>To review</span>
                        <span className="flex-none whitespace-nowrap text-[12.5px] tabular-nums text-primary">
                            {stripLine(groups)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">{oldest}</span>
                        <span className="flex-none text-[11px] font-semibold text-accent-soft">Review</span>
                    </button>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

function Row({
    item,
    marked,
    focused,
    reveal,
}: {
    item: ReviewItem;
    marked: boolean;
    focused: boolean;
    reveal: ReturnType<typeof usePartMotion>;
}) {
    // the cursor rides the row you last touched, so j and k go on from it
    const touch = () => setRunReviewCursor(item.key);
    return (
        // flex-none: in the group's column an overflow-hidden row has a min-height of 0, so it would shrink to fit and
        // clip its label instead of the sheet scrolling
        <motion.div {...reveal} className="flex-none overflow-hidden">
            <div
                data-run-review-row={`${item.effortoid}:${item.label}`}
                data-run-review-marked={marked ? "true" : undefined}
                {...cursorAttrs(focused)}
                className={cn(
                    "flex items-start gap-2.5 rounded-[9px] border-b border-edge-faint px-2.5 py-2",
                    marked && "bg-surface-hover",
                    focused && CURSOR_RING
                )}
            >
                <button
                    type="button"
                    data-run-review-tick
                    aria-pressed={marked}
                    aria-label="Mark to do"
                    title="Mark to do (t)"
                    onClick={() => {
                        touch();
                        toggleTick(item.key);
                    }}
                    className={cn(
                        "mt-0.5 flex h-4 w-4 flex-none cursor-pointer items-center justify-center rounded-[4px] border p-0",
                        marked
                            ? "border-accent bg-accent text-background"
                            : "border-edge-strong bg-transparent text-transparent hover:border-ink-mid",
                        FOCUS
                    )}
                >
                    <Check size={11} strokeWidth={3} aria-hidden />
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="text-[13px] leading-[1.4] text-primary">{item.label}</span>
                    <span className="text-[10.5px] text-muted">{item.efforttitle}</span>
                </div>
                <div className="flex flex-none gap-1 pt-px">
                    <button
                        type="button"
                        data-run-review-later
                        title="Keep it on its initiative (l)"
                        onClick={() => foldRow(item, "later")}
                        className={SMALL_BTN}
                    >
                        Later
                    </button>
                    <button
                        type="button"
                        data-run-review-drop
                        title="Skip it (Delete)"
                        onClick={() => foldRow(item, "drop")}
                        className={SMALL_BTN}
                    >
                        Drop
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

function Group({
    group,
    ticks,
    cursor,
    reveal,
    now,
}: {
    group: ReviewGroup;
    ticks: ReadonlySet<string>;
    cursor: string | undefined;
    reveal: ReturnType<typeof usePartMotion>;
    now: number;
}) {
    return (
        // flex-none, as Row: a group must keep its height in the sheet's scrolling column, not shrink to fit it
        <motion.section
            {...reveal}
            data-run-review-group={group.runid}
            className="flex flex-none flex-col overflow-hidden"
        >
            <div className="flex items-baseline gap-2 px-2.5 pb-1 pt-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-secondary" title={group.goal}>
                    {group.goal}
                </span>
                <span className="flex-none font-mono text-[10px] text-muted">{group.runid.slice(0, 8)}</span>
                <span className="flex-none text-[10.5px] tabular-nums text-muted">{groupAge(group, now)}</span>
            </div>
            <AnimatePresence initial={false}>
                {group.items.map((item) => (
                    <Row
                        key={item.key}
                        item={item}
                        marked={ticks.has(item.key)}
                        focused={cursor === item.key}
                        reveal={reveal}
                    />
                ))}
            </AnimatePresence>
            <div className="h-2 flex-none" />
        </motion.section>
    );
}

export function RunReviewSheet({ model }: { model: LauncherModel }) {
    const open = useAtomValue(runReviewOpenAtom);
    const groups = useAtomValue(runReviewGroupsAtom);
    const ticks = useAtomValue(runReviewTicksAtom);
    const { cursor } = useAtomValue(runReviewNavAtom);
    const refusal = useAtomValue(runReviewRefusalAtom);
    const reveal = usePartMotion(springReveal);
    const marked = tickedKeys(groups, ticks).length;
    const empty = groups.length === 0;
    const now = Date.now();
    return (
        // the width is --run-review-sheet-w (tailwindsetup.css): the Brief's undo toast keeps clear of the sheet by it
        <ModalShell
            open={open}
            variant="sheet"
            onClose={closeRunReview}
            className="h-full w-[var(--run-review-sheet-w)]"
        >
            <div data-run-review-sheet className="flex h-full min-h-0 flex-col bg-surface">
                <div
                    data-run-review-header
                    className="flex flex-none items-center gap-2.5 border-b border-edge-faint px-[18px] py-4"
                >
                    <span className="text-[15px] font-semibold text-ink-hi">To review</span>
                    {!empty ? (
                        <span className="min-w-0 truncate text-[11px] tabular-nums text-muted">
                            {stripLine(groups)}, oldest first
                        </span>
                    ) : null}
                    <span className="flex-1" />
                    <button
                        type="button"
                        aria-label="Close"
                        title="Close (Esc)"
                        onClick={closeRunReview}
                        className={cn(
                            "flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] border border-edge-faint bg-surface-raised text-muted hover:border-edge-strong hover:text-ink-hi",
                            FOCUS
                        )}
                    >
                        <X size={13} aria-hidden />
                    </button>
                </div>
                <div className="sc flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-2">
                    <AnimatePresence initial={false}>
                        {groups.map((g) => (
                            <Group key={g.runid} group={g} ticks={ticks} cursor={cursor} reveal={reveal} now={now} />
                        ))}
                    </AnimatePresence>
                    {empty ? (
                        <p data-run-review-empty className="px-2.5 py-2 text-[12px] text-muted">
                            Nothing a run left is waiting on you.
                        </p>
                    ) : null}
                </div>
                {!empty ? (
                    <div className="flex flex-none items-center gap-2 border-t border-edge-faint px-[18px] py-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5" aria-live="polite">
                            <span data-run-review-marked-line className="text-[12px] text-secondary">
                                {footerLine(marked)}
                            </span>
                            {refusal != null ? (
                                <span data-run-review-refusal className="text-[11.5px] text-error">
                                    {refusal}
                                </span>
                            ) : null}
                        </div>
                        <button
                            type="button"
                            data-run-review-clear
                            disabled={ticks.size === 0}
                            onClick={clearTicks}
                            className={cn(SMALL_BTN, "disabled:cursor-default disabled:opacity-40")}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            data-run-review-start
                            disabled={marked === 0}
                            onClick={() => startRunReview(model)}
                            className={cn(
                                "h-[28px] flex-none cursor-pointer whitespace-nowrap rounded-[8px] bg-accent px-3 text-[11.5px] font-semibold text-background shadow-inset-highlight hover:bg-accenthover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent",
                                FOCUS
                            )}
                        >
                            {startLabel(marked)}
                        </button>
                    </div>
                ) : null}
            </div>
        </ModalShell>
    );
}
