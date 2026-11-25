// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pairing sheet (board K1 of docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md): what the Agent tree's
// Pair: worker + judge opens for the two picked agents. A popover beside the tree, drawn by AgentTree itself and not a
// registered modal: who works and who judges (Swap trades them), the hold box, a note to the judge and the token cap.
// Pair starts the pair (PairStartCommand) and hands the view to the tree, which opens the conversation; a refusal reads in
// the sheet and keeps it open. Escape and Cancel close it. The draft's rules are pairsheetmodel.ts.
//
// It holds the keys while it is open (data-owns-keys): the Agent surface's own Escape stands down, so Esc closes only this.

import { springPop, springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { TextSwap } from "@/app/element/textswap";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { autoUpdate, FloatingPortal, offset, shift, useFloating } from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { shortTabId } from "./agentrowmodel";
import type { AgentsViewModel } from "./agents";
import {
    CAP_MAX_MILLIONS,
    CAP_MIN_MILLIONS,
    capTokens,
    newDraft,
    sheetSides,
    startData,
    swapSides,
    type PairSheetDraft,
    type PairSheetPick,
    type PairSheetSide,
} from "./pairsheetmodel";

// how far the sheet stands off the tree's edge: clear of the fold strip beside it (14px wide), with a little air
const TREE_GAP_PX = 20;

const FOCUS_RING = "outline-none focus-visible:ring-1 focus-visible:ring-accent";
const FIELD =
    "box-border w-full rounded-[6px] border border-edge-strong bg-surface px-[10px] py-[8px] text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted focus:border-accent";

function SideRow({ label, role, side }: { label: string; role: "worker" | "judge"; side: PairSheetSide }) {
    return (
        <>
            <dt className="text-muted">{label}</dt>
            <dd
                data-pair-side={role}
                data-pair-side-tab={side.id}
                className="m-0 flex min-w-0 items-baseline gap-[6px]"
            >
                <span title={side.name} className="min-w-0 truncate text-primary">
                    <TextSwap text={side.name} swapKey={role} />
                </span>
                <span className="shrink-0 font-mono text-[11.5px] text-muted">{shortTabId(side.id)}</span>
            </dd>
        </>
    );
}

export function PairSheet({
    model,
    anchor,
    picked,
    onClose,
    onPaired,
}: {
    model: AgentsViewModel;
    /** the element the sheet stands beside: the tree */
    anchor: HTMLElement;
    picked: PairSheetPick;
    /** Cancel or Escape: the tree gives the focus back */
    onClose: () => void;
    /** the pair was made: the tree opens its conversation */
    onPaired: (view: PairView) => void;
}) {
    const [draft, setDraft] = useState<PairSheetDraft>(newDraft);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pop = usePartMotion(springPop);
    const reveal = usePartMotion(springReveal);
    const { refs, floatingStyles } = useFloating({
        elements: { reference: anchor },
        placement: "right-start",
        strategy: "fixed",
        // crossAxis: in a window too narrow for the tree and the sheet side by side, the sheet slides over the tree
        // instead of off the right edge
        middleware: [offset({ mainAxis: TREE_GAP_PX, crossAxis: 8 }), shift({ padding: 8, crossAxis: true })],
        whileElementsMounted: autoUpdate,
    });

    // the Agent surface stays mounted off-screen, and the portal would keep the sheet over the next surface
    const surface = useAtomValue(model.surfaceAtom);
    useEffect(() => {
        if (surface !== "agent") {
            onClose();
        }
    }, [surface]);

    const { worker, judge } = sheetSides(picked, draft);
    const data = startData(picked, draft);
    const capValid = capTokens(draft.cap) != null;
    const edit = (patch: Partial<PairSheetDraft>) => {
        setDraft((d) => ({ ...d, ...patch }));
        setError(null);
    };

    const pair = async () => {
        if (data == null || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            onPaired(await RpcApi.PairStartCommand(TabRpcClient, data));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
        }
    };
    const submit = (e: FormEvent) => {
        e.preventDefault();
        void pair();
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && !busy) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        }
    };

    return (
        <FloatingPortal>
            <div ref={refs.setFloating} style={floatingStyles} className="z-[60]">
                <motion.form
                    {...pop}
                    data-pair-sheet
                    data-owns-keys
                    role="dialog"
                    aria-label="Pair: worker + judge"
                    tabIndex={-1}
                    onKeyDown={onKeyDown}
                    onSubmit={submit}
                    className="flex max-h-[calc(100vh-16px)] w-[420px] max-w-[calc(100vw-16px)] origin-top-left flex-col gap-[14px] overflow-y-auto rounded-[12px] border border-edge-mid p-[18px] frost shadow-popover focus:outline-none"
                >
                    <div className="text-[15px] font-semibold text-primary">Pair: worker + judge</div>
                    <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-[12px] gap-y-[8px] text-[13px]">
                        <SideRow label="Works" role="worker" side={worker} />
                        <SideRow label="Judges" role="judge" side={judge} />
                    </dl>
                    <button
                        type="button"
                        data-pair-swap
                        onClick={() => edit(swapSides(draft))}
                        className={cn(
                            "-mx-[4px] cursor-pointer self-start rounded-[4px] border-0 bg-transparent px-[4px] py-0 text-[12.5px] text-accent hover:text-accenthover",
                            FOCUS_RING
                        )}
                    >
                        Swap
                    </button>
                    <label className="flex cursor-pointer items-start gap-[10px] text-[13px] leading-[1.45] text-primary">
                        <input
                            type="checkbox"
                            data-pair-hold
                            checked={draft.hold}
                            onChange={(e) => edit({ hold: e.target.checked })}
                            className="m-0 mt-[3px] h-[13px] w-[13px] shrink-0 cursor-pointer accent-accent"
                        />
                        <span>
                            Hold heavy commands until the judge answers
                            <span className="block text-[12px] text-muted">tests, builds, Docker, long commands</span>
                        </span>
                    </label>
                    <label className="flex flex-col gap-[6px] text-[13px]">
                        <span className="text-muted">Note to the judge (optional)</span>
                        <textarea
                            data-pair-note
                            rows={2}
                            value={draft.note}
                            onChange={(e) => edit({ note: e.target.value })}
                            placeholder="What to look at, e.g. the plan to judge"
                            className={cn(FIELD, "resize-none")}
                        />
                    </label>
                    <div className="flex flex-col gap-[4px] text-[13px]">
                        <label className="flex items-center gap-[8px]">
                            <span className="text-muted">Token cap</span>
                            <input
                                data-pair-cap
                                inputMode="decimal"
                                value={draft.cap}
                                onChange={(e) => edit({ cap: e.target.value })}
                                aria-invalid={!capValid}
                                aria-describedby="pair-cap-hint"
                                className={cn(
                                    FIELD,
                                    "w-[64px] px-[8px] py-[4px] text-right tabular-nums",
                                    !capValid && "border-error focus:border-error"
                                )}
                            />
                            <span className="text-muted">million</span>
                        </label>
                        <span
                            id="pair-cap-hint"
                            data-pair-cap-hint
                            className={cn("text-[12px]", capValid ? "text-muted" : "text-error")}
                        >
                            {capValid
                                ? "The pair pauses once it has used this many tokens"
                                : `A number from ${CAP_MIN_MILLIONS} to ${CAP_MAX_MILLIONS}`}
                        </span>
                    </div>
                    {/* a group of its own with no gap: the refusal opens and folds on the spring above the buttons, and its
                        own bottom padding is the space under it, so the sheet's gap does not jump when it mounts */}
                    <div className="flex flex-col">
                        <AnimatePresence initial={false}>
                            {error != null ? (
                                <motion.div key="error" {...reveal} className="overflow-hidden">
                                    <div
                                        role="alert"
                                        data-pair-error
                                        className="break-words pb-[14px] text-[12.5px] leading-[1.45] text-error"
                                    >
                                        {error}
                                    </div>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                        <div className="flex justify-end gap-[8px]">
                            <button
                                type="button"
                                data-pair-cancel
                                disabled={busy}
                                onClick={onClose}
                                className={cn(
                                    "h-[32px] cursor-pointer rounded-[6px] border border-edge-strong bg-transparent px-[14px] text-[13px] text-secondary hover:bg-surface-hover disabled:cursor-default disabled:opacity-50",
                                    FOCUS_RING
                                )}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                data-pair-submit
                                // Enter pairs with the defaults: the quick way through the sheet
                                autoFocus
                                disabled={data == null || busy}
                                className={cn(
                                    "h-[32px] cursor-pointer rounded-[6px] border-0 bg-accent px-[14px] text-[13px] font-medium text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50",
                                    FOCUS_RING
                                )}
                            >
                                {busy ? "Pairing…" : "Pair"}
                            </button>
                        </div>
                    </div>
                </motion.form>
            </div>
        </FloatingPortal>
    );
}
