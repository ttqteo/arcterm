// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The agent header's pair controls (board K2, and board C of the tree-and-toggle follow-up): an unpaired agent's Add judge
// button and its menu (Open a new judge, then the project's live agents that are in no pair), a paired worker's Pair
// button beside a small + (another judge for the same pair), and a judge's Pair button beside a link to the agent it
// judges. Pair toggles the centre into the conversation and back. What picking an entry does is pairlaunch.ts; what the
// labels say is pairmodel.ts.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { Link2, Plus, Scale } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { centerModeAtom, pairSelAtom, showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { judgeChoices, openNewJudge, pickJudge } from "./pairlaunch";
import { liveName, newCount, pairButtonLabel, type PairRole } from "./pairmodel";
import { pairOnScreen, togglePairOf } from "./pairopen";
import { pairSeenAtom, usePairs, usePairView } from "./pairstore";

// keyboard focus on these buttons draws as the accent ring, as it does on the run link's × in the same header
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

const ITEM =
    "flex w-full cursor-pointer items-center gap-[8px] rounded-[5px] border-0 bg-transparent px-[9px] py-[7px] text-left text-[13px] text-ink-hi outline-none hover:bg-surface-hover focus:bg-surface-selected";

function MenuBody({
    model,
    worker,
    project,
    onNew,
    onPick,
    onClose,
}: {
    model: AgentsViewModel;
    worker: AgentVM;
    project: string;
    onNew: () => void;
    onPick: (judgeTab: string) => void;
    onClose: () => void;
}) {
    const agents = useAtomValue(model.agentsAtom);
    const pairs = usePairs();
    const choices = useMemo(() => judgeChoices(agents, worker.id, project, pairs), [agents, worker.id, project, pairs]);
    const rootRef = useRef<HTMLDivElement>(null);
    // the keys live in the menu from the moment it opens: the first row (Open a new judge) is under the cursor, as K2 draws it
    useEffect(() => {
        rootRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    }, []);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
            const at = rows.indexOf(document.activeElement as HTMLElement);
            rows[(at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus({ preventScroll: true });
        }
    };
    return (
        <div
            ref={rootRef}
            role="menu"
            aria-label="Add judge"
            data-pair-judge-menu
            data-owns-keys
            onKeyDown={onKeyDown}
            className="frost flex w-[320px] flex-col rounded-[8px] border border-edge-strong p-[5px] shadow-popover-lg outline-none"
        >
            <button
                type="button"
                role="menuitem"
                data-pair-new-judge
                onClick={onNew}
                className={cn(ITEM, "flex-col items-start gap-[2px] py-[8px]")}
            >
                Open a new judge
                <span className="text-[11.5px] text-muted">
                    new tab in the same project, reads the plan and the latest reply · opus
                </span>
            </button>
            <div className="px-[9px] pb-[4px] pt-[8px] text-[11.5px] text-muted">Or pick a live agent</div>
            {choices.length === 0 ? (
                <div data-pair-no-choices className="px-[9px] pb-[6px] text-[11.5px] text-ink-faint">
                    No other claude or pi agent is running in {project || "this project"}.
                </div>
            ) : (
                choices.map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        role="menuitem"
                        data-pair-judge-choice={c.id}
                        onClick={() => onPick(c.id)}
                        title={c.name}
                        className={ITEM}
                    >
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <span className="flex-none font-mono text-[11px] text-muted">
                            {c.short} · {c.state}
                        </span>
                    </button>
                ))
            )}
        </div>
    );
}

// the menu, anchored under its button and aligned to its right edge (the buttons sit at the header's right)
function PairJudgeMenu({
    open,
    anchor,
    ...body
}: { open: boolean; anchor: HTMLElement | null } & React.ComponentProps<typeof MenuBody>) {
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: (next) => {
            if (!next) {
                body.onClose();
            }
        },
        placement: "bottom-end",
        strategy: "fixed",
        elements: { reference: anchor },
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: open ? autoUpdate : undefined,
    });
    // Escape is the body's own; this is the press outside, which the button is not
    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: false })]);
    // React events bubble through a portal to what opened it: a click or right-click in the menu is not the header's
    const contained = {
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
    };
    return (
        <FloatingPortal>
            <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps(contained)} className="z-[80]">
                <PopoverReveal open={open} origin="top right">
                    <MenuBody {...body} />
                </PopoverReveal>
            </div>
        </FloatingPortal>
    );
}

// The Add judge button and its menu. `compact` is a paired worker's small icon beside its Paired button: the same menu, to
// add another judge.
function AddJudgeButton({
    model,
    agent,
    project,
    words,
    compact,
    iconClass,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    project: string;
    words: boolean;
    compact: boolean;
    iconClass: string;
}) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    // the header stays mounted while its agent changes: a menu left open must not belong to the next one
    useEffect(() => setOpen(false), [agent.id]);
    // a dismissal hands the keys back to the button; a pick leaves them where the launch or the conversation put them
    const close = (refocus: boolean) => {
        setOpen(false);
        if (refocus) {
            anchor?.focus({ preventScroll: true });
        }
    };
    const label = compact ? "Add another judge" : "Add judge";
    return (
        <>
            <button
                ref={setAnchor}
                type="button"
                data-pair-add-judge
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={label}
                onClick={() => setOpen(!open)}
                title={
                    compact
                        ? "Add another judge to this pair"
                        : "Add judge: another agent reads this one's replies and answers them"
                }
                className={
                    compact
                        ? cn(iconClass, FOCUS_RING, open && "bg-surface-hover text-primary")
                        : cn(
                              "flex cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border border-edge-strong px-[9px] py-[5px] text-[12px] font-semibold text-ink-hi hover:bg-surface-hover",
                              FOCUS_RING,
                              open && "bg-surface-hover"
                          )
                }
            >
                {/* beside the Pair button, which has the scales, adding another judge is a plus */}
                {compact ? (
                    <Plus size={15} strokeWidth={1.8} aria-hidden />
                ) : (
                    <Scale size={14} strokeWidth={1.8} aria-hidden />
                )}
                {!compact && words ? "Add judge" : null}
            </button>
            <PairJudgeMenu
                open={open}
                anchor={anchor}
                model={model}
                worker={agent}
                project={project}
                onNew={() => {
                    close(false);
                    fireAndForget(() => openNewJudge(model, agent, project));
                }}
                onPick={(judgeTab) => {
                    close(false);
                    fireAndForget(() => pickJudge(agent, judgeTab));
                }}
                onClose={() => close(true)}
            />
        </>
    );
}

// The Pair button, beside the header's Chat / Terminal control: it toggles the centre between the agent's own view and its
// pair's conversation, lit while the conversation shows. The working agent's carries the count of new messages; its whole
// label ("Paired with judge 4c6ba858 · 2 new", "Judging 61483cd6") is its aria-label. Narrow, the word gives way to the icon.
function PairToggle({
    model,
    agent,
    pair,
    role,
    words,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    pair: PairInfo;
    role: PairRole;
    words: boolean;
}) {
    const view = usePairView(pair.id);
    const seen = useAtomValue(pairSeenAtom(pair.id));
    const on = pairOnScreen(useAtomValue(centerModeAtom), useAtomValue(pairSelAtom), pair.id);
    // until the view is read the list's row stands in: no messages known, so no count
    const known = view ?? ({ ...pair, messages: [] } as PairView);
    const label = pairButtonLabel(known, role, seen);
    const fresh = role === "worker" && !on ? newCount(known, seen) : 0;
    return (
        <button
            type="button"
            data-pair-open={pair.id}
            data-pair-role={role}
            aria-label={label}
            aria-pressed={on}
            onClick={() => togglePairOf(model, agent.id, pair.id)}
            title={
                on
                    ? "Back to this agent's own view (Esc)"
                    : role === "worker"
                      ? "Open the conversation with your judge"
                      : "Open the conversation you judge in"
            }
            className={cn(
                "flex cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border px-[9px] py-[5px] text-[12px] font-semibold transition-colors duration-[140ms] motion-reduce:transition-none",
                on
                    ? "border-accent/45 bg-accentbg text-primary hover:border-accent"
                    : "border-edge-mid bg-surface-raised text-secondary hover:border-edge-strong hover:text-primary",
                FOCUS_RING
            )}
        >
            <Scale size={14} strokeWidth={1.8} aria-hidden className="flex-none text-accent-soft" />
            {words ? "Pair" : null}
            {fresh > 0 ? (
                <span
                    data-pair-new={fresh}
                    className="flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold tabular-nums text-background"
                >
                    {fresh}
                </span>
            ) : null}
        </button>
    );
}

// A judge's way to the agent it judges, where the working agent's header has its Add judge icon: that agent's own view.
function JudgedAgentLink({
    model,
    worker,
    iconClass,
}: {
    model: AgentsViewModel;
    worker: PairSide;
    iconClass: string;
}) {
    const roster = useAtomValue(model.agentsAtom);
    const name = liveName(worker, roster);
    return (
        <button
            type="button"
            data-pair-worker-link={worker.tab}
            aria-label={`Open ${name}, the agent you judge`}
            title={`Open ${name}, the agent you judge`}
            onClick={() => {
                globalStore.set(model.focusIdAtom, worker.tab);
                showTerminal();
            }}
            className={cn(iconClass, FOCUS_RING)}
        >
            <Link2 size={15} strokeWidth={1.8} aria-hidden />
        </button>
    );
}

/** What the header carries for pairs, by what the agent is in (`paired`, from usePairOf): no pair, an Add judge button; the
 *  working agent of one, its Pair button and a small Add judge icon (`iconClass` is the header's own icon button); a
 *  judge, its Pair button and a link to the agent it judges. */
export function PairHeaderControls({
    model,
    agent,
    project,
    words,
    paired,
    iconClass,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    project: string;
    words: boolean;
    paired: { pair: PairInfo; role: PairRole } | null;
    iconClass: string;
}) {
    if (paired?.role === "judge") {
        return (
            <>
                <PairToggle model={model} agent={agent} pair={paired.pair} role="judge" words={words} />
                <JudgedAgentLink model={model} worker={paired.pair.worker} iconClass={iconClass} />
            </>
        );
    }
    return (
        <>
            {paired != null ? (
                <PairToggle model={model} agent={agent} pair={paired.pair} role="worker" words={words} />
            ) : null}
            <AddJudgeButton
                model={model}
                agent={agent}
                project={project}
                words={words}
                compact={paired != null}
                iconClass={iconClass}
            />
        </>
    );
}
