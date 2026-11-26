// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The judge menu (board K2) and the agent header's pair controls (board C of the tree-and-toggle follow-up). The menu is
// Wake the judge of the earlier rounds when one rests asleep (or Resume it, when its tab closed with the worker and the worker
// was resumed in a new tab), Open a new judge, then the project's live agents that are in no pair. It opens from ⚖ Judge this reply under a reply in Chat (JudgeReplyMenu, which the conversation draws once and
// anchors at the pressed button; spec docs/superpowers/specs/2026-11-26-judge-on-reply-design.md) and starts the pair from
// that reply, and from the small + of a paired worker's header (another judge for the same pair, which joins the pair as
// it is). The header carries no pair control for an agent in no pair: ⚖ is the way in. A paired worker's header has its Pair
// button beside the +, and a judge's has its Pair button beside a link to the agent it judges. Pair toggles the centre into
// the conversation and back. What picking an entry does is pairlaunch.ts; what the labels say is pairmodel.ts.

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
import { judgeChoices, openNewJudge, pickJudge, restingJudgeOf, resumeJudge, wakeJudge } from "./pairlaunch";
import { liveName, newCount, pairButtonLabel, resumableJudgeOf, type PairRole } from "./pairmodel";
import { pairOnScreen, togglePairOf } from "./pairopen";
import { pairSeenAtom, usePairs, usePairView, useRestingJudges } from "./pairstore";

// keyboard focus on these buttons draws as the accent ring, as it does on the run link's × in the same header
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

const ITEM =
    "flex w-full cursor-pointer items-center gap-[8px] rounded-[5px] border-0 bg-transparent px-[9px] py-[7px] text-left text-[13px] text-ink-hi outline-none hover:bg-surface-hover focus:bg-surface-selected";

function MenuBody({
    model,
    worker,
    project,
    label,
    thisReply,
    onNew,
    onPick,
    onWake,
    onResume,
    onClose,
}: {
    model: AgentsViewModel;
    worker: AgentVM;
    project: string;
    /** the menu's accessible name */
    label: string;
    /** the menu is for a reply the person chose (a `from`), not the agent's latest: the new judge reads that one */
    thisReply: boolean;
    onNew: () => void;
    onPick: (judgeTab: string) => void;
    onWake: (judgeTab: string) => void;
    /** resume the judge whose tab closed with this worker's earlier tab */
    onResume: (judge: PairResting) => void;
    onClose: () => void;
}) {
    const agents = useAtomValue(model.agentsAtom);
    const pairs = usePairs();
    const restingJudges = useRestingJudges();
    // the judge of the earlier rounds, asleep and hidden from the tree: the menu's first entry, so a new round keeps what it read
    const wake = useMemo(() => restingJudgeOf(restingJudges, agents, worker.id), [restingJudges, agents, worker.id]);
    // the roster's name for it (its title as the tree shows it), else the one the server stored
    const wakeName = wake != null ? agents.find((a) => a.id === wake.tab)?.name || wake.name : "";
    // with none to wake, the judge of this conversation's rounds before it was resumed in this tab, its own tab closed
    const resume = useMemo(
        () => (wake == null ? resumableJudgeOf(restingJudges, agents, worker.id) : null),
        [wake, restingJudges, agents, worker.id]
    );
    const choices = useMemo(
        () => judgeChoices(agents, worker.id, project, pairs, restingJudges),
        [agents, worker.id, project, pairs, restingJudges]
    );
    const rootRef = useRef<HTMLDivElement>(null);
    // the keys live in the menu from the moment it opens: the first row (Wake the resting judge, else Open a new judge) is
    // under the cursor, as K2 draws it
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
            aria-label={label}
            data-pair-judge-menu
            data-owns-keys
            onKeyDown={onKeyDown}
            className="frost flex w-[320px] flex-col rounded-[8px] border border-edge-strong p-[5px] shadow-popover-lg outline-none"
        >
            {wake != null ? (
                <button
                    type="button"
                    role="menuitem"
                    data-pair-wake-judge={wake.tab}
                    onClick={() => onWake(wake.tab)}
                    title={wakeName}
                    className={cn(ITEM, "flex-col items-start gap-[2px] py-[8px]")}
                >
                    <span className="max-w-full truncate">Wake {wakeName}</span>
                    <span className="text-[11.5px] text-muted">
                        judge of your earlier rounds, keeps what it read · asleep
                    </span>
                </button>
            ) : null}
            {resume != null ? (
                <button
                    type="button"
                    role="menuitem"
                    data-pair-resume-judge={resume.session}
                    onClick={() => onResume(resume)}
                    title={resume.name}
                    className={cn(ITEM, "flex-col items-start gap-[2px] py-[8px]")}
                >
                    <span className="max-w-full truncate">Resume {resume.name}</span>
                    <span className="text-[11.5px] text-muted">
                        judge of this conversation's earlier rounds, keeps what it read · closed
                    </span>
                </button>
            ) : null}
            <button
                type="button"
                role="menuitem"
                data-pair-new-judge
                onClick={onNew}
                className={cn(ITEM, "flex-col items-start gap-[2px] py-[8px]")}
            >
                Open a new judge
                <span className="text-[11.5px] text-muted">
                    new tab in the same project, reads the plan and {thisReply ? "this" : "the latest"} reply · opus
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

// the menu, anchored under its button: aligned to the button's right edge for the header's + (the buttons sit at the
// header's right), to its left edge for ⚖ under a reply (the button sits at the reply's left)
function PairJudgeMenu({
    open,
    anchor,
    placement,
    origin,
    ...body
}: {
    open: boolean;
    anchor: HTMLElement | null;
    placement: "bottom-end" | "bottom-start";
    /** the panel scales from this corner of its anchor (PopoverReveal) */
    origin: "top right" | "top left";
} & React.ComponentProps<typeof MenuBody>) {
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: (next) => {
            if (!next) {
                body.onClose();
            }
        },
        placement,
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
                <PopoverReveal open={open} origin={origin}>
                    <MenuBody {...body} />
                </PopoverReveal>
            </div>
        </FloatingPortal>
    );
}

/** The menu of ⚖ Judge this reply, anchored at the pressed button and opening to its right (`placement` bottom-start). The
 *  conversation draws one for all its replies and drives `open` (it stays drawn so the menu can leave on the same motion it
 *  arrived on); `anchor` and `from` stay what the last press set while it leaves. Every entry starts the pair from the
 *  reply `from` names ("" is the agent's latest, pi's only choice). `onClose(refocus)`: a dismissal (Escape, a press
 *  outside) hands the keys back to the button, a pick leaves them where the launch or the conversation put them. */
export function JudgeReplyMenu({
    model,
    worker,
    project,
    from,
    open,
    anchor,
    onClose,
}: {
    model: AgentsViewModel;
    worker: AgentVM;
    project: string;
    from: string;
    open: boolean;
    anchor: HTMLElement | null;
    onClose: (refocus: boolean) => void;
}) {
    return (
        <PairJudgeMenu
            open={open}
            anchor={anchor}
            placement="bottom-start"
            origin="top left"
            model={model}
            worker={worker}
            project={project}
            label="Judge this reply"
            thisReply={from !== ""}
            onNew={() => {
                onClose(false);
                fireAndForget(() => openNewJudge(model, worker, project, from));
            }}
            onPick={(judgeTab) => {
                onClose(false);
                fireAndForget(() => pickJudge(worker, judgeTab, from));
            }}
            onWake={(judgeTab) => {
                onClose(false);
                fireAndForget(() => wakeJudge(worker, judgeTab, from));
            }}
            onResume={(judge) => {
                onClose(false);
                fireAndForget(() => resumeJudge(model, worker, project, judge, from));
            }}
            onClose={() => onClose(true)}
        />
    );
}

// The small + beside a paired worker's Pair button: the same menu, to add another judge to the pair it is in. The new judge
// joins that pair as it is, so no reply is chosen (pairlaunch's `from` is left empty and wavesrv ignores it there).
function AddAnotherJudgeButton({
    model,
    agent,
    project,
    iconClass,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    project: string;
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
    return (
        <>
            <button
                ref={setAnchor}
                type="button"
                data-pair-add-judge
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Add another judge"
                onClick={() => setOpen(!open)}
                title="Add another judge to this pair"
                className={cn(iconClass, FOCUS_RING, open && "bg-surface-hover text-primary")}
            >
                {/* beside the Pair button, which has the scales, adding another judge is a plus */}
                <Plus size={15} strokeWidth={1.8} aria-hidden />
            </button>
            <PairJudgeMenu
                open={open}
                anchor={anchor}
                placement="bottom-end"
                origin="top right"
                model={model}
                worker={agent}
                project={project}
                label="Add another judge"
                thisReply={false}
                onNew={() => {
                    close(false);
                    fireAndForget(() => openNewJudge(model, agent, project));
                }}
                onPick={(judgeTab) => {
                    close(false);
                    fireAndForget(() => pickJudge(agent, judgeTab));
                }}
                onWake={(judgeTab) => {
                    close(false);
                    fireAndForget(() => wakeJudge(agent, judgeTab));
                }}
                onResume={(judge) => {
                    close(false);
                    fireAndForget(() => resumeJudge(model, agent, project, judge));
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

// A judge's way to the agent it judges, where the working agent's header has its + icon: that agent's own view.
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

/** What the header carries for pairs, by what the agent is in (`paired`, from usePairOf): no pair, nothing (⚖ under a reply
 *  in Chat starts one); the working agent of one, its Pair button and a small + for another judge (`iconClass` is the
 *  header's own icon button); a judge, its Pair button and a link to the agent it judges. */
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
    if (paired == null) {
        return null;
    }
    if (paired.role === "judge") {
        return (
            <>
                <PairToggle model={model} agent={agent} pair={paired.pair} role="judge" words={words} />
                <JudgedAgentLink model={model} worker={paired.pair.worker} iconClass={iconClass} />
            </>
        );
    }
    return (
        <>
            <PairToggle model={model} agent={agent} pair={paired.pair} role="worker" words={words} />
            <AddAnotherJudgeButton model={model} agent={agent} project={project} iconClass={iconClass} />
        </>
    );
}
