// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The peek is a compact global hub anchored to the creature. Its shape follows its responsibility: a quiet
// 300px card when nothing waits, and a 420px queue when work arrives. Both share one grammar: a title that
// carries the count, standing conditions as static lines under it, the body, the updates drawer, the
// composer, and the key hints last. What needs doing leads and carries its actions inline; the quiet card
// leads with the latest update and keeps the rest under Earlier. Everything actionable carries its own
// remedy; everything else is one line.
//
// The derivations live in petpeekmodel.ts and petcondition.ts. This file is a renderer.

import { computeEntrances, initialEntranceState, MOTION, paneReveal, popoverReveal } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { activeChannelAtom, channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { InlineMarkdown } from "@/app/view/agents/inlinemarkdown";
import { MarkdownMessage } from "@/app/view/agents/markdownmessage";
import { projectListAtom, rowsWithChannel } from "@/app/view/agents/projectsstore";
import { cn, fireAndForget } from "@/util/util";
import {
    autoUpdate,
    FloatingFocusManager,
    FloatingPortal,
    offset,
    shift,
    useFloating,
    type Placement,
} from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { ArrowUpRight, ChevronDown, ChevronRight, X } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
} from "react";
import { peekAddress } from "./openref";
import { PeekItemView, runItemCommand, type ItemChrome } from "./peekitem";
import { itemHints, itemKeyCommand } from "./peekitemmodel";
import { backToHub, closePeek, peekFactsAtom, peekItemAtom, peekTargetKey } from "./peekstore";
import { actNavigates, runAct } from "./petactrun";
import { actsForEvent, type PetAct, type PetTarget } from "./petacts";
import { EventLabel, eventTone } from "./petbubble";
import { conditionLine, type PetExpression, type PetSignals } from "./petcondition";
import { PetErrand } from "./peterrand";
import { resolveDestination } from "./peterrandmodel";
import type { PetCorner } from "./petledge";
import {
    dedupeUpdates,
    enterHintLabel,
    eventPeekTarget,
    peekActForCommand,
    peekAnswerAct,
    peekConditions,
    peekKeyCommand,
    queueRows,
    rowKindLabel,
    rowPeekTarget,
    type PeekRow,
} from "./petpeekmodel";
import { petActStateAtom, petPeekDestAtom, petPeekOpenAtom, petSaidAtom } from "./petstore";
import { eventLabel, type PetEvent } from "./petvoice";
import { ageLabel } from "./recallderive";

// Where the peek opens from: the walking creature's corner, or the float bar's top right (petfloatmark.tsx), where
// it drops down.
export type PeekCorner = PetCorner | "top-right";

const PLACEMENT: Record<PeekCorner, Placement> = {
    "bottom-right": "top-end",
    "bottom-left": "top-start",
    "top-right": "bottom-end",
};

const ORIGIN: Record<PeekCorner, string> = {
    "bottom-right": "bottom right",
    "bottom-left": "bottom left",
    "top-right": "top right",
};

// A standing condition's dot. Tone is never the only carrier — the line states the fact in words, and an
// unremedied condition ends in "no action" rather than in nothing. A spent window reads red, not amber:
// the line already says "spent", and the dot must not understate it.
function conditionDot(expr: PetExpression): string {
    if (expr.kind === "ram-full") {
        return "bg-warning";
    }
    if (expr.kind === "tired") {
        return expr.pct >= 100 ? "bg-error" : "bg-warning";
    }
    return "bg-success";
}

// A waiting item's dot, by kind. Paired with the kind word (rowKindLabel), which is what keeps the kind
// legible without relying on colour.
const ROW_DOT: Record<string, string> = {
    gate: "bg-warning",
    "dag-gate": "bg-warning",
    escalation: "bg-error",
    "dag-blocked": "bg-error",
    ask: "bg-accent",
    "run-land-held": "bg-warning",
};

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// Prose cut by height, not by line clamp: a clamp cannot span the blocks markdown produces (a list, a code
// fence). The toggle appears only when the text actually overflows, so a short question never offers it.
function ClampedProse({ text, collapsed, className }: { text: string; collapsed: string; className?: string }) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [overflows, setOverflows] = useState(false);
    const [expanded, setExpanded] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (el == null) {
            return;
        }
        const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [text]);
    return (
        <div className={className}>
            {/* a height cut lands mid-line, so the cut edge fades rather than slicing a line in half. The code
                block's header goes while collapsed: in an 84px cut it took the room the first code lines
                needed, leaving an empty frame with a Copy button. Show all brings it back. */}
            <div
                ref={ref}
                className={cn(
                    "overflow-hidden [overflow-wrap:anywhere]",
                    !expanded && collapsed,
                    !expanded && "[&_[data-code-head]]:hidden",
                    !expanded && overflows && "[mask-image:linear-gradient(to_bottom,black_65%,transparent)]"
                )}
            >
                <MarkdownMessage text={text} />
            </div>
            {overflows || expanded ? (
                <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((prior) => !prior)}
                    className={cn("mt-[3px] text-[10.5px] font-semibold text-accent-soft hover:underline", FOCUS_RING)}
                >
                    {expanded ? "Show less" : "Show all"}
                </button>
            ) : null}
        </div>
    );
}

function ActButton({
    model,
    act,
    filled,
    onLeave,
}: {
    model: AgentsViewModel;
    act: PetAct;
    filled: boolean;
    onLeave: () => void;
}) {
    const state = useAtomValue(petActStateAtom);
    const running = state[act.id]?.status === "running";
    return (
        <button
            type="button"
            data-pet-act={act.id}
            data-peek={act.verb === "open" ? "" : undefined}
            disabled={running}
            aria-busy={running || undefined}
            onClick={(event) => {
                // an escort navigates, so the peek would cover the destination it just sent you to
                if (actNavigates(act, event)) {
                    onLeave();
                }
                fireAndForget(() => runAct(model, act, event));
            }}
            // only the cursor row's act is filled, so one button in the queue reads as "Enter does this"
            className={cn(
                "h-6 flex-none whitespace-nowrap rounded-[6px] px-2.5 text-[11px]",
                FOCUS_RING,
                "disabled:cursor-default disabled:border-transparent disabled:bg-surface-hover disabled:text-muted",
                filled
                    ? "bg-accent font-bold text-background hover:bg-accenthover"
                    : "border border-edge-strong font-semibold text-secondary hover:border-edge-mid hover:bg-surface-hover"
            )}
        >
            {/* an act mid-flight becomes its own progress in place: same box, same width, so the row does
                not move and nothing below it shifts */}
            {act.label}
            {running ? <span className="ml-1">▍</span> : null}
        </button>
    );
}

// Outcome text for a set of acts. Rendered on its own full-width line so a two-line error wraps downward
// instead of pushing the buttons around.
function ActOutcome({ acts, className }: { acts: PetAct[]; className?: string }) {
    const state = useAtomValue(petActStateAtom);
    const done = acts.map((act) => state[act.id]).find((entry) => entry?.text != null && entry.status !== "running");
    if (done?.text == null) {
        return null;
    }
    return (
        <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
            className={cn(
                "text-[10.5px] leading-[1.45]",
                done.status === "error" ? "text-error" : "text-muted",
                className
            )}
        >
            {done.text}
        </motion.p>
    );
}

function ActLinks({ model, acts, onLeave }: { model: AgentsViewModel; acts: PetAct[]; onLeave: () => void }) {
    return (
        <>
            {acts.map((act) => (
                <button
                    key={act.id}
                    type="button"
                    data-pet-act={act.id}
                    data-peek={act.verb === "open" ? "" : undefined}
                    onClick={(event) => {
                        if (actNavigates(act, event)) {
                            onLeave();
                        }
                        fireAndForget(() => runAct(model, act, event));
                    }}
                    className={cn(
                        "whitespace-nowrap text-[11px] font-semibold text-accent-soft hover:text-accenthover hover:underline",
                        FOCUS_RING
                    )}
                >
                    {act.label}
                </button>
            ))}
        </>
    );
}

// A question's options, numbered by the digit that sends them from the keyboard. Once one is in flight or sent,
// all of them lock: an ask takes one answer.
function AnswerButtons({ model, acts }: { model: AgentsViewModel; acts: PetAct[] }) {
    const state = useAtomValue(petActStateAtom);
    const locked = acts.some((act) => state[act.id]?.status === "running" || state[act.id]?.status === "done");
    return (
        <div data-pet-answers className="mt-1.5 flex flex-wrap gap-1.5">
            {acts.map((act, i) => (
                <button
                    key={act.id}
                    type="button"
                    data-pet-act={act.id}
                    disabled={locked}
                    aria-busy={state[act.id]?.status === "running" || undefined}
                    onClick={() => fireAndForget(() => runAct(model, act))}
                    className={cn(
                        "flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-[6px] border border-edge-strong px-2 text-[11px] font-semibold text-secondary hover:border-edge-mid hover:bg-surface-hover",
                        FOCUS_RING,
                        "disabled:cursor-default disabled:border-transparent disabled:bg-surface-hover disabled:text-muted"
                    )}
                >
                    <kbd className="flex-none font-mono text-[10px] text-muted">{i + 1}</kbd>
                    <span className="truncate">{act.label}</span>
                </button>
            ))}
        </div>
    );
}

function QueueRow({
    model,
    row,
    now,
    focused,
    onLeave,
}: {
    model: AgentsViewModel;
    row: PeekRow;
    now: number;
    focused: boolean;
    onLeave: () => void;
}) {
    const acts = [row.primary, ...row.links, ...row.answers].filter((act) => act != null);
    return (
        <div data-pet-row={row.key} className="border-b border-border last:border-b-0">
            <div
                data-pet-cursor={focused ? "true" : undefined}
                className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 pb-2.5 pl-3.5 pr-2.5 pt-[9px]",
                    focused ? "bg-surface-selected ring-1 ring-inset ring-accent/70" : "hover:bg-surface-hover"
                )}
            >
                <div className="min-w-0">
                    <div title={row.source} className="truncate text-[12px] font-semibold text-primary">
                        <InlineMarkdown text={row.source} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] tabular-nums text-muted">
                        <span
                            className={cn("h-1.5 w-1.5 flex-none rounded-full", ROW_DOT[row.kind] ?? "bg-edge-strong")}
                        />
                        {rowKindLabel(row.kind)} · {ageLabel(Math.max(0, now - row.waitingsince))}
                    </div>
                    {/* only kinds whose text is the payload get a detail — see DETAIL_KINDS. An escalation IS
                        its question, so it shows rather than hiding behind a click; a long one is cut by
                        height and opens in place. */}
                    {row.detail != null ? (
                        <ClampedProse
                            text={row.detail}
                            collapsed="max-h-[66px]"
                            className="mt-[5px] text-[11.5px] leading-[1.45] text-ink-mid"
                        />
                    ) : null}
                    {row.answers.length > 0 ? <AnswerButtons model={model} acts={row.answers} /> : null}
                    <ActOutcome acts={acts} className="mt-1.5" />
                </div>
                {row.primary != null ? (
                    <div className="flex flex-none items-center gap-2.5">
                        <ActLinks model={model} acts={row.links} onLeave={onLeave} />
                        <ActButton model={model} act={row.primary} filled={focused} onLeave={onLeave} />
                    </div>
                ) : null}
            </div>
        </div>
    );
}

// The register and age on one mono line. A notification's level keeps its tone; everything else is muted.
function EventMeta({ event, now, className }: { event: PetEvent; now: number; className?: string }) {
    const tone = eventTone(event);
    return (
        <span className={cn("flex items-center gap-1.5 text-[10px] tabular-nums text-muted", className)}>
            {tone.dot != null ? <span className={cn("h-1.5 w-1.5 flex-none rounded-full", tone.dot)} /> : null}
            <span className={event.kind === "notify" ? tone.label : undefined}>{eventLabel(event)}</span>
            <span>· {ageLabel(Math.max(0, now - event.at))}</span>
        </span>
    );
}

// A click on an update peeks what it is about. Its own controls (the Open links, Show all) keep their meaning,
// so a click that lands on one of them is theirs, not the row's.
function peekOnClick(target: PetTarget | null, onPeek: (target: PetTarget) => void) {
    if (target == null) {
        return undefined;
    }
    return (event: MouseEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest("button, a") != null) {
            return;
        }
        onPeek(target);
    };
}

function UpdateRow({
    model,
    event,
    now,
    onLeave,
    onPeek,
}: {
    model: AgentsViewModel;
    event: PetEvent;
    now: number;
    onLeave: () => void;
    onPeek: (target: PetTarget) => void;
}) {
    const acts = actsForEvent(event);
    const onClick = peekOnClick(eventPeekTarget(event), onPeek);
    return (
        <div
            data-pet-update-peekable={onClick != null ? "true" : undefined}
            onClick={onClick}
            className={cn(
                "border-b border-border px-3.5 pb-2.5 pt-2 last:border-b-0",
                onClick != null && "cursor-pointer hover:bg-surface-hover"
            )}
        >
            <div className="text-[11.5px] leading-[1.45] text-secondary [overflow-wrap:anywhere]">
                <InlineMarkdown text={event.text} />
            </div>
            {event.detail != null ? (
                <ClampedProse
                    text={event.detail}
                    collapsed="max-h-[84px]"
                    className="mt-0.5 text-[11px] leading-[1.45] text-ink-mid"
                />
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <EventMeta event={event} now={now} />
                <ActLinks model={model} acts={acts} onLeave={onLeave} />
            </div>
            <ActOutcome acts={acts} className="mt-1" />
        </div>
    );
}

function LatestUpdate({
    model,
    event,
    now,
    onLeave,
    onPeek,
}: {
    model: AgentsViewModel;
    event: PetEvent;
    now: number;
    onLeave: () => void;
    onPeek: (target: PetTarget) => void;
}) {
    const acts = actsForEvent(event);
    const onClick = peekOnClick(eventPeekTarget(event), onPeek);
    return (
        <div
            data-pet-latest-update
            onClick={onClick}
            className={cn("px-3.5 pb-3 pt-2.5", onClick != null && "cursor-pointer hover:bg-surface-hover")}
        >
            <div className="mb-1 flex items-center gap-1.5 text-[9.5px] tabular-nums text-muted">
                <EventLabel event={event} />
                <span>· {ageLabel(Math.max(0, now - event.at))}</span>
            </div>
            <div className="line-clamp-3 text-[12px] leading-[1.45] text-secondary [overflow-wrap:anywhere]">
                <InlineMarkdown text={event.text} />
            </div>
            {/* the message body renders dimmed, under the title the bubble already said */}
            {event.detail != null ? (
                <ClampedProse
                    text={event.detail}
                    collapsed="max-h-[84px]"
                    className="mt-1 text-[11px] leading-[1.45] text-ink-mid"
                />
            ) : null}
            {acts.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-3">
                    <ActLinks model={model} acts={acts} onLeave={onLeave} />
                </div>
            ) : null}
            <ActOutcome acts={acts} className="mt-1" />
        </div>
    );
}

function UpdatesDrawer({
    label,
    updates,
    open,
    onToggle,
    opening,
    children,
}: {
    label: string;
    updates: PetEvent[];
    open: boolean;
    onToggle: () => void;
    opening: boolean;
    children: ReactNode;
}) {
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
        <div data-pet-updates className="flex-none border-t border-border">
            <button
                type="button"
                aria-expanded={open}
                onClick={onToggle}
                className="flex min-h-8 w-full items-center gap-2 pl-3.5 pr-3 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
                <span className="flex-none text-[9.5px] font-semibold uppercase tracking-[0.09em] text-muted">
                    {label}
                </span>
                <span className="flex-none rounded-full border border-edge-mid px-1.5 text-[9.5px] font-semibold leading-[15px] tabular-nums text-ink-mid">
                    {updates.length}
                </span>
                {/* the newest update stands in for the drawer while it is shut. Open, it would be the very
                    next line — the same fact twice, which is the one rule this panel exists to keep. */}
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {open ? null : <InlineMarkdown text={updates[0].text} />}
                </span>
                <Chevron aria-hidden="true" size={12} strokeWidth={2.2} className="flex-none text-muted" />
            </button>
            {/* the scroll container moves to an inner div: paneReveal animates the outer height and needs
                overflow-hidden, which on the same element would fight overflow-y-auto and clip the scrollbar
                mid-tween. */}
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div
                        key="updates"
                        variants={paneReveal}
                        initial={opening ? false : "initial"}
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden border-t border-border"
                    >
                        <div className="max-h-[170px] overflow-y-auto">{children}</div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function KeyHints({ hints }: { hints: { keys: string[]; label: string }[] }) {
    return (
        <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3.5 py-[7px] text-[10.5px] text-muted">
            {hints.map((hint) => (
                <span key={hint.label} className="inline-flex items-center gap-1">
                    {hint.keys.map((key) => (
                        <kbd
                            key={key}
                            className="rounded-[4px] border border-edge-mid bg-surface px-1 font-mono text-[10px] leading-[15px] text-ink-mid"
                        >
                            {key}
                        </kbd>
                    ))}
                    {hint.label}
                </span>
            ))}
        </div>
    );
}

export function PetPeek({
    model,
    anchor,
    corner,
    signals,
}: {
    model: AgentsViewModel;
    anchor: HTMLElement | null;
    corner: PeekCorner;
    signals: PetSignals;
}) {
    const open = useAtomValue(petPeekOpenAtom);
    const peekItem = useAtomValue(peekItemAtom);
    const facts = useAtomValue(peekFactsAtom);
    const said = useAtomValue(petSaidAtom);
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    // an escalation finds the agent it waits in through its card (petpeekmodel.ts)
    const channelMessages = useAtomValue(channelMessagesAtom);
    // one channel per project in the shared list: the reply goes to a project, never a leftover channel
    const projectRows = useAtomValue(projectListAtom);
    const channels = useMemo(() => rowsWithChannel(projectRows).map((r) => r.channel), [projectRows]);
    const activeChannel = useAtomValue(activeChannelAtom);
    const picked = useAtomValue(petPeekDestAtom);
    const now = useAtomValue(model.nowAtom);
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const returnFocusRef = useRef<HTMLElement | null>(anchor);
    const [returnFocusEnabled, setReturnFocusEnabled] = useState(true);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [cursor, setCursor] = useState(0);
    const entranceRef = useRef(initialEntranceState());

    const close = useCallback(() => {
        returnFocusRef.current = anchor;
        setReturnFocusEnabled(true);
        closePeek();
    }, [anchor]);
    const leavePeek = () => {
        setReturnFocusEnabled(false);
    };
    const item = open ? peekItem : null;
    const itemKey = peekTargetKey(item?.target);
    const itemChrome: ItemChrome = {
        close,
        back: () => {
            backToHub();
            panelRef.current?.focus();
        },
        leave: leavePeek,
    };
    const peekAt = (target: PetTarget) => {
        fireAndForget(() => peekAddress(model, target.ref, { anchor: target.anchor }));
    };

    const { refs, floatingStyles, context } = useFloating({
        open,
        placement: PLACEMENT[corner],
        strategy: "fixed",
        middleware: [offset(12), shift({ padding: 8, crossAxis: true })],
        whileElementsMounted: autoUpdate,
    });

    useEffect(() => {
        refs.setPositionReference(anchor);
    }, [anchor, refs]);

    useEffect(() => {
        if (open) {
            returnFocusRef.current = anchor;
            setReturnFocusEnabled(true);
        } else {
            // reset on close, not on open, so a reopened peek never paints the last look's state first. A
            // kept cursor index points at whatever row now sits there, and a kept drawer carries quiet's
            // Earlier into busy's Since you looked.
            setCursor(0);
            setDrawerOpen(false);
        }
    }, [anchor, open]);

    useEffect(() => {
        if (!open) {
            return;
        }
        // FloatingFocusManager's return-focus cleanup can fire while the peek is still
        // open (its effect re-runs on floating-ui-internal state) and yank focus back
        // to the anchor; while open, the dialog must hold focus, so steal it back.
        const onFocusIn = (event: FocusEvent) => {
            if (event.target === anchor && panelRef.current != null) {
                panelRef.current.focus();
            }
        };
        document.addEventListener("focusin", onFocusIn);
        return () => document.removeEventListener("focusin", onFocusIn);
    }, [open, anchor]);

    // the control that asked for the item (an update's Show all, an Open link) unmounts with the hub, which would
    // drop focus out of the dialog and take its keys with it
    useEffect(() => {
        if (open) {
            panelRef.current?.focus();
        }
    }, [itemKey]);

    // only the rows scroll, so j/k has to bring the cursor row into view itself
    useEffect(() => {
        panelRef.current?.querySelector('[data-pet-cursor="true"]')?.scrollIntoView({ block: "nearest" });
    }, [cursor]);

    const conditions = peekConditions(signals);
    const rows = queueRows(items, agents, channelMessages);
    const updates = dedupeUpdates(said, items);
    const quiet = rows.length === 0;
    const focusedRow = rows[Math.min(cursor, Math.max(0, rows.length - 1))];
    // the quiet card's Enter opens what its headline offers, the way a busy row's Enter opens that row
    const latestAct = quiet && updates[0] != null ? (actsForEvent(updates[0])[0] ?? null) : null;
    const enterAct = quiet ? latestAct : peekActForCommand(focusedRow, "open");
    // Space shows what Enter would open, without going there
    const spaceTarget = quiet ? eventPeekTarget(updates[0]) : rowPeekTarget(focusedRow);
    // quiet: the headline is the newest update and Earlier holds the rest. busy: every update is news that
    // arrived since you looked, behind the queue.
    const drawerUpdates = quiet ? updates.slice(1) : updates;
    const entranceIds = rows.map((row) => `row:${row.key}`);
    const entranceKey = open ? "open" : undefined;
    const opening = open && entranceRef.current.key !== entranceKey;
    const { animate: entering } = computeEntrances(entranceRef.current, entranceKey, entranceIds);
    const entranceIdsKey = entranceIds.join(",");
    useLayoutEffect(() => {
        entranceRef.current = computeEntrances(entranceRef.current, entranceKey, entranceIds).state;
    }, [entranceIdsKey, entranceKey]);
    const dest = resolveDestination({ picked, active: activeChannel?.oid ?? null, channels });

    const openJarvis = () => {
        leavePeek();
        globalStore.set(model.surfaceAtom, "jarvis");
        closePeek();
    };

    const runKeyboardAct = (act: PetAct | null | undefined) => {
        if (act == null) {
            return false;
        }
        if (actNavigates(act)) {
            leavePeek();
        }
        fireAndForget(() => runAct(model, act));
        return true;
    };

    // Escape closes from anywhere in the item; its other keys belong to whatever control holds focus, and a
    // modified key (Ctrl+F) is not the bare one
    const onItemKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const command = itemKeyCommand(event.key);
        if (command == null) {
            return;
        }
        const own = event.target === event.currentTarget && !event.repeat;
        const bare = !event.ctrlKey && !event.metaKey && !event.altKey;
        if (command !== "close" && !(own && bare)) {
            return;
        }
        if (runItemCommand(model, item, facts, command, itemChrome)) {
            event.preventDefault();
        }
    };

    const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (item != null) {
            onItemKeyDown(event);
            return;
        }
        // a bare digit sends the focused row's option, as on the Cockpit's answer bar
        const bareKey = !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat;
        const answerAct = bareKey && event.target === event.currentTarget ? peekAnswerAct(focusedRow, event.key) : null;
        if (answerAct != null) {
            event.preventDefault();
            runKeyboardAct(answerAct);
            return;
        }
        const command = peekKeyCommand(event.key);
        if (command === "close") {
            event.preventDefault();
            close();
            return;
        }
        if (command == null || event.target !== event.currentTarget) {
            return;
        }
        if (event.repeat && command !== "next" && command !== "previous") {
            return;
        }
        if (command === "next" || command === "previous") {
            if (rows.length === 0) {
                return;
            }
            event.preventDefault();
            const delta = command === "next" ? 1 : -1;
            setCursor((prior) => (prior + delta + rows.length) % rows.length);
            return;
        }
        if (command === "composer") {
            event.preventDefault();
            panelRef.current?.querySelector<HTMLInputElement>("[data-pet-errand-input]")?.focus();
            return;
        }
        if (command === "peek") {
            if (spaceTarget != null) {
                event.preventDefault();
                peekAt(spaceTarget);
            }
            return;
        }
        if (runKeyboardAct(enterAct)) {
            event.preventDefault();
        }
    };

    const hints =
        item != null
            ? itemHints(item.target.kind)
            : [
                  ...(quiet ? [] : [{ keys: ["j", "k"], label: "move" }]),
                  ...(spaceTarget != null ? [{ keys: ["space"], label: "peek" }] : []),
                  ...(!quiet || latestAct != null ? [{ keys: ["↵"], label: enterHintLabel(enterAct) }] : []),
                  ...(focusedRow != null && focusedRow.answers.length > 0
                      ? [
                            {
                                keys: [focusedRow.answers.length === 1 ? "1" : `1–${focusedRow.answers.length}`],
                                label: "answer",
                            },
                        ]
                      : []),
                  { keys: ["/"], label: "ask" },
                  { keys: ["esc"], label: "close" },
              ];

    // portaled, so a menu a control in here portals (the harness picker) nests in this portal node, which the focus
    // manager counts as inside the dialog: it is not hidden from assistive tech, and focus in it is not outside
    return (
        <FloatingPortal>
            {open ? <div data-pet-peek-backdrop className="fixed inset-0 z-[64]" onClick={close} /> : null}
            <div ref={refs.setFloating} style={floatingStyles} className="z-[65]">
                <FloatingFocusManager
                    context={context}
                    disabled={!open}
                    initialFocus={panelRef}
                    returnFocus={returnFocusEnabled ? returnFocusRef : false}
                    modal
                >
                    <MotionConfig reducedMotion="user">
                        <AnimatePresence>
                            {open ? (
                                <motion.div
                                    layout="size"
                                    variants={popoverReveal}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    transition={{ layout: { duration: MOTION.durMacro, ease: MOTION.easeFluid } }}
                                    style={{ transformOrigin: ORIGIN[corner] }}
                                    className={cn(
                                        "flex max-h-[calc(100vh-16px)] w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[12px] border border-border bg-surface-raised shadow-popover",
                                        item != null ? "max-w-[560px]" : quiet ? "max-w-[300px]" : "max-w-[420px]"
                                    )}
                                >
                                    {/* mark the dialog as the focus-managed element: without it FloatingFocusManager
                                        resolves its focus element to the harness picker's always-mounted
                                        data-floating-ui-focusable wrapper inside this tree, and the tab trap
                                        silently empties (tabbable() of an empty 0x0 div is []) */}
                                    <div
                                        ref={panelRef}
                                        data-pet-peek="1"
                                        data-pet-peek-shape={item != null ? "item" : quiet ? "quiet" : "busy"}
                                        data-pet-peek-item={item?.target.kind}
                                        data-pet-peek-status={item?.status}
                                        data-floating-ui-focusable
                                        role="dialog"
                                        aria-modal="true"
                                        aria-labelledby={titleId}
                                        tabIndex={-1}
                                        onKeyDown={onPanelKeyDown}
                                        className="flex min-h-0 flex-1 flex-col focus:outline-none"
                                    >
                                        {item != null ? (
                                            <PeekItemView
                                                model={model}
                                                item={item}
                                                facts={facts}
                                                titleId={titleId}
                                                onCommand={(command) =>
                                                    runItemCommand(model, item, facts, command, itemChrome)
                                                }
                                            />
                                        ) : (
                                            <>
                                                {/* sections draw their own top border, so an absent one leaves no
                                            doubled line behind */}
                                                <div
                                                    data-pet-peek-header
                                                    className="flex min-h-11 flex-none items-center gap-1 pl-3.5 pr-2"
                                                >
                                                    <h2
                                                        id={titleId}
                                                        className="min-w-0 flex-1 truncate text-[13px] font-bold text-primary"
                                                    >
                                                        {quiet
                                                            ? "Nothing waiting on you"
                                                            : `${rows.length} waiting on you`}
                                                    </h2>
                                                    <button
                                                        type="button"
                                                        aria-label="Open full Jarvis view"
                                                        onClick={openJarvis}
                                                        className={cn(
                                                            "flex h-7 flex-none items-center gap-1 whitespace-nowrap rounded-[7px] px-2 text-[11px] font-medium text-muted hover:bg-surface-hover hover:text-primary",
                                                            FOCUS_RING
                                                        )}
                                                    >
                                                        Full view
                                                        <ArrowUpRight aria-hidden="true" size={11} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-label="Close Jarvis panel"
                                                        onClick={close}
                                                        className={cn(
                                                            "flex h-7 w-7 flex-none items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-primary",
                                                            FOCUS_RING
                                                        )}
                                                    >
                                                        <X aria-hidden="true" size={14} strokeWidth={2} />
                                                    </button>
                                                </div>

                                                {conditions.map((condition) => (
                                                    <div
                                                        key={condition.expr.kind}
                                                        data-pet-condition={condition.expr.kind}
                                                        className="flex flex-none items-start gap-2 border-t border-border px-3.5 py-[9px]"
                                                    >
                                                        <span
                                                            className={cn(
                                                                "mt-[5px] h-1.5 w-1.5 flex-none rounded-full",
                                                                conditionDot(condition.expr)
                                                            )}
                                                        />
                                                        <span className="min-w-0 flex-1 text-[11.5px] leading-[1.4] text-secondary">
                                                            {conditionLine(condition.expr, now)}
                                                        </span>
                                                        {condition.readout ? (
                                                            <span
                                                                title="this condition has no remedy, it is a readout"
                                                                className="mt-px flex-none text-[9.5px] text-muted"
                                                            >
                                                                no action
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                ))}

                                                <div
                                                    data-pet-peek-body
                                                    data-pet-queue
                                                    className={cn(
                                                        "min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
                                                        (!quiet || updates[0] != null) && "border-t border-border"
                                                    )}
                                                >
                                                    {quiet ? (
                                                        updates[0] != null ? (
                                                            <LatestUpdate
                                                                model={model}
                                                                event={updates[0]}
                                                                now={now}
                                                                onLeave={leavePeek}
                                                                onPeek={peekAt}
                                                            />
                                                        ) : null
                                                    ) : (
                                                        <AnimatePresence initial={false}>
                                                            {/* no `layout` on rows: the panel is pinned by its bottom edge, so
                                                        a drawer opening below grows it upward and moves every row on
                                                        screen. layout reads that as a move and drags the rows back
                                                        down. Collapsing height on enter/exit reflows siblings without
                                                        measuring anything. */}
                                                            {rows.map((row, index) => (
                                                                <motion.div
                                                                    key={row.key}
                                                                    variants={paneReveal}
                                                                    initial={
                                                                        entering.has(`row:${row.key}`)
                                                                            ? "initial"
                                                                            : false
                                                                    }
                                                                    animate="animate"
                                                                    exit="exit"
                                                                    className="overflow-hidden"
                                                                >
                                                                    <QueueRow
                                                                        model={model}
                                                                        row={row}
                                                                        now={now}
                                                                        focused={
                                                                            index === Math.min(cursor, rows.length - 1)
                                                                        }
                                                                        onLeave={leavePeek}
                                                                    />
                                                                </motion.div>
                                                            ))}
                                                        </AnimatePresence>
                                                    )}
                                                </div>

                                                {drawerUpdates.length > 0 ? (
                                                    <UpdatesDrawer
                                                        label={quiet ? "Earlier" : "Since you looked"}
                                                        updates={drawerUpdates}
                                                        open={drawerOpen}
                                                        onToggle={() => setDrawerOpen((prior) => !prior)}
                                                        opening={opening}
                                                    >
                                                        {drawerUpdates.map((event) => (
                                                            <UpdateRow
                                                                key={event.id}
                                                                model={model}
                                                                event={event}
                                                                now={now}
                                                                onLeave={leavePeek}
                                                                onPeek={peekAt}
                                                            />
                                                        ))}
                                                    </UpdatesDrawer>
                                                ) : null}

                                                <PetErrand
                                                    dest={dest}
                                                    channels={channels}
                                                    compact={quiet}
                                                    onPick={(oid) => globalStore.set(petPeekDestAtom, oid)}
                                                />
                                            </>
                                        )}

                                        <KeyHints hints={hints} />
                                    </div>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                    </MotionConfig>
                </FloatingFocusManager>
            </div>
        </FloatingPortal>
    );
}
