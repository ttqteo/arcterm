// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The card of Add to an initiative from Chat and its folded rows (docs/superpowers/specs/2026-11-12-chat-add-to-initiative-
// design.md §3, §6; boards A-prefilled-change, A-compact-or-editor and fold-rows in the plan's Prototype). Three exports,
// which the conversation calls: the host that knows the agent (ChatInitiativeHost), a ```arc-initiative block drawn as its
// card or its folded row (InitiativeBlockView), and the cards the person opened from messages (InitiativeMessageCards).
// What the card decides is chatinitiative.ts's (draft, target, phases, wording); what it keeps is chatinitiativestore.ts's.
// This file draws, wires the clicks and keeps the one thing neither holds: where each card stands while it is open.
//
// The card enters and folds on springReveal, as chatbrainstormcard.tsx does: a handled card swaps for its row inside one
// AnimatePresence, so the card closes while the row opens.

import { MOTION, springReveal } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import type { EffortCardModel } from "@/app/view/jarvis/effortmodel";
import { effortDetailAtom, loadEffortDetail } from "@/app/view/jarvis/effortstore";
import { InitiativePicker, useInitiativeCards } from "@/app/view/jarvis/initiativepicker";
import { openAddress } from "@/app/view/jarvis/openref";
import { cn } from "@/util/util";
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
import { atom, useAtomValue } from "jotai";
import { Check, ChevronDown, Flag, Loader2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition, type Variants } from "motion/react";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from "react";
import { getProcExitAtom } from "./agentcontrollerstore";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { procExited } from "./brainstormmodel";
import { ERROR_LINE } from "./brainstormui";
import { FOCUS_RING } from "./chatbrainstormparts";
import {
    addBlocker,
    blockDraftKey,
    blockKey,
    canAdd,
    cardPhase,
    cardStatic,
    chipProgress,
    chunkOptions,
    dismissedRecord,
    draftFromBlock,
    draftFromMessage,
    effortOref,
    foldRowLabel,
    foldRowParts,
    INITIATIVE_LANG,
    isFreshMessageCard,
    kindLabel,
    messageDraftKey,
    parseInitiativeBlock,
    startsInEditor,
    topicsOf,
    verbOf,
    waitingDot,
    withEffort,
    withKind,
    withTopic,
    type CardEvent,
    type CardOrigin,
    type CardPhase,
    type ChunkOption,
    type HandledRecord,
    type InitiativeBlock,
    type InitiativeCtx,
    type InitiativeDraft,
    type InitiativeKind,
    type MessageCard,
} from "./chatinitiative";
import {
    dropDraft,
    markHandled,
    setDraft,
    settleMessageCard,
    useDraft,
    useHandled,
    useMessageCards,
    writeInitiative,
} from "./chatinitiativestore";
import { CodeBlock } from "./codeblock";
import { agentChunk } from "./initiativepopovermodel";

// ---- the host: what a card reads off its agent ----

type Host = {
    agent: AgentVM;
    model: AgentsViewModel;
    /** whether the agent's process has exited (a sleeping agent has not): the card is then static, its Add still works */
    exited: boolean;
    /** the initiative list; null until a card asked for it and it loaded */
    cards: EffortCardModel[] | null;
    /** what the first draft's target is looked up in */
    ctx: InitiativeCtx;
    /** the initiatives' details the app holds, for their chunks and titles */
    details: Map<string, Effort>;
    /** why an initiative's detail could not be read, by oref */
    detailErrors: Record<string, string>;
    /** a live card asks for the list (once is enough: it stays while the host is mounted) */
    want: () => void;
    /** reads an initiative's chunks, fresh the first time this host is asked, so a chunk the agent added with `wsh effort`
     *  a moment ago is there */
    ensureDetail: (oref: string) => void;
};

const HostContext = createContext<Host | null>(null);

const NO_EFFORTS: EffortCardModel[] = [];

/** The chat an initiative card is drawn in: its agent, and what the card reads off it (the initiative list, the agent's
 *  chunk, whether the agent has exited). The list is read only once a card that waits asks for it, so a Chat with no card
 *  reads nothing; a folded row needs none. */
export function ChatInitiativeHost({
    agent,
    model,
    children,
}: {
    agent: AgentVM;
    model: AgentsViewModel;
    children: ReactNode;
}) {
    // read live, never memoised: the card's amber dot and its static state follow the process the moment it exits
    const procExit = useAtomValue(getProcExitAtom(agent.blockId ?? ""));
    const exited = procExited(procExit, agent.sleeping);
    const [wanted, setWanted] = useState(false);
    const want = useCallback(() => setWanted(true), []);
    const { cards } = useInitiativeCards(wanted);
    const details = useAtomValue(effortDetailAtom);
    const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
    const refreshed = useRef(new Set<string>());
    const ensureDetail = useCallback((oref: string) => {
        if (oref === "") {
            return;
        }
        // the cache is only replaced by a write through this app: the first read per initiative is forced
        const force = !refreshed.current.has(oref);
        refreshed.current.add(oref);
        loadEffortDetail(oref, force ? Number.MAX_SAFE_INTEGER : undefined).then(
            () => setDetailErrors((prev) => (oref in prev ? withoutOref(prev, oref) : prev)),
            (e) => setDetailErrors((prev) => ({ ...prev, [oref]: e instanceof Error ? e.message : String(e) }))
        );
    }, []);
    const agentOref = agent.effortId != null ? effortOref(agent.effortId) : "";
    useEffect(() => {
        if (wanted && agentOref !== "") {
            ensureDetail(agentOref);
        }
    }, [wanted, agentOref, ensureDetail]);
    const agentDetail = agentOref !== "" ? details.get(agentOref) : undefined;
    const heldChunk = useMemo(
        () => (agentDetail != null ? (agentChunk(agentDetail, agent.id)?.label ?? null) : null),
        [agentDetail, agent.id]
    );
    const chunksOf = useCallback((oref: string) => details.get(oref)?.chunks?.map((c) => c.label), [details]);
    const ctx = useMemo<InitiativeCtx>(
        () => ({ agentEffortId: agent.effortId, agentChunk: heldChunk, efforts: cards ?? NO_EFFORTS, chunksOf }),
        [agent.effortId, heldChunk, cards, chunksOf]
    );
    const value = useMemo<Host>(
        () => ({ agent, model, exited, cards, ctx, details, detailErrors, want, ensureDetail }),
        [agent, model, exited, cards, ctx, details, detailErrors, want, ensureDetail]
    );
    return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

function withoutOref(map: Record<string, string>, oref: string): Record<string, string> {
    const next = { ...map };
    delete next[oref];
    return next;
}

// ---- where each open card stands ----

// The card's phase (chatinitiative.ts cardPhase) and whether its editor is open, per card key (blockDraftKey /
// messageDraftKey). Module-level, so a card that Chat unmounts (a switch to Terminal) and remounts mid-write is still adding,
// still failed with its reason, and never offers a second Add for a write that is in flight. A handled card keeps its last
// phase: the card on its way out of the screen holds still while the row opens.
type CardEntry = { phase: CardPhase; editor: boolean; error?: string };

const entriesAtom = atom<Record<string, CardEntry>>({});

function stepCard(key: string, base: CardEntry, event: CardEvent, error?: string): void {
    const all = globalStore.get(entriesAtom);
    const cur = Object.prototype.hasOwnProperty.call(all, key) ? all[key] : base;
    const phase = cardPhase(cur.phase, event);
    const editor = event === "edit" ? true : event === "cancel" ? false : cur.editor;
    globalStore.set(entriesAtom, {
        ...all,
        [key]: { phase, editor, ...(phase === "failed" ? { error: error ?? cur.error } : {}) },
    });
}

function useCardEntry(key: string, base: CardEntry): CardEntry {
    const all = useAtomValue(entriesAtom);
    return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : base;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---- the pieces ----

const PRIMARY =
    "flex flex-none cursor-pointer items-center gap-[6px] rounded-full border-0 bg-accent px-[14px] py-[6px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY =
    "flex-none cursor-pointer rounded-full border border-edge-mid bg-transparent px-[12px] py-[6px] text-[12.5px] text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
const CHANGE =
    "flex-none cursor-pointer rounded-full border border-dashed border-edge-strong bg-transparent px-[10px] py-[3px] text-[12px] text-secondary hover:border-secondary hover:text-primary disabled:cursor-default disabled:opacity-50";
const CHIP =
    "inline-flex min-w-0 max-w-full items-center gap-[6px] rounded-full border border-edge-mid bg-surface px-[10px] py-[3px] font-medium text-primary";
const FIELD =
    "w-full min-w-0 resize-y rounded-[10px] border border-edge-strong bg-surface px-[12px] py-[9px] text-[13.5px] leading-[1.5] text-primary placeholder:text-muted disabled:opacity-60";

// the motion wrapper every card and row has: enters and leaves on springReveal
function Reveal({ children }: { children: ReactNode }) {
    return (
        <motion.div
            variants={springReveal}
            initial="initial"
            animate="animate"
            exit="exit"
            className="overflow-hidden rounded-[12px]"
        >
            {children}
        </motion.div>
    );
}

// A body on its way out is the frozen copy of what it last drew: it takes no click while it folds
const BODY_REVEAL: Variants = {
    ...springReveal,
    exit: { ...(springReveal.exit as TargetAndTransition), pointerEvents: "none" },
};

// Edit opens the editor in the open card, and Cancel closes it, on the spring: the two bodies swap inside one AnimatePresence,
// the old one folding to nothing while the new one opens, so the card grows and shrinks rather than jumping to its new height
// (the card's own reveal only runs when it enters and leaves). Under reduced motion the body is swapped at once. The bodies
// are clipped while they move, so each carries 3px of padding and takes it back in its margin: a field's focus ring, which
// is drawn outside the field, would otherwise be cut off at the body's edge.
function BodySwap({ editing, compact, editor }: { editing: boolean; compact: ReactNode; editor: ReactNode }) {
    const reduceMotion = useReducedMotion();
    if (reduceMotion) {
        return <div className="flex flex-col gap-[12px]">{editing ? editor : compact}</div>;
    }
    return (
        <div className="flex flex-col">
            <AnimatePresence initial={false}>
                <motion.div
                    key={editing ? "editor" : "compact"}
                    variants={BODY_REVEAL}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="-m-[3px] flex flex-col gap-[12px] overflow-hidden p-[3px]"
                >
                    {editing ? editor : compact}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}

// An anchor the card keeps for its picker. Both bodies draw the Into / Under row, and while one folds away the other is
// already there: the folding one's ref reports null when it finally unmounts, which must not clear the anchor the new body set.
function useAnchor() {
    const [el, setEl] = useState<HTMLButtonElement | null>(null);
    const ref = useCallback((node: HTMLButtonElement | null) => {
        if (node != null) {
            setEl(node);
        }
    }, []);
    return [el, ref] as const;
}

function Chip({ card, attr, empty }: { card: EffortCardModel | undefined; attr: "into" | "under"; empty: string }) {
    const marks = { [`data-chat-initiative-${attr}`]: "" };
    if (card == null) {
        return (
            <span
                {...marks}
                className="inline-flex items-center rounded-full border border-dashed border-edge-strong px-[10px] py-[3px] text-muted"
            >
                {empty}
            </span>
        );
    }
    return (
        <span {...marks} title={card.title} className={CHIP}>
            <span className="min-w-0 truncate">{card.title}</span>
            <span className="flex-none font-normal tabular-nums text-muted">
                {attr === "under" ? "topic" : chipProgress(card)}
            </span>
        </span>
    );
}

function TargetRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-[8px] text-[12.5px]">
            <span className="w-[44px] flex-none text-muted">{label}</span>
            {children}
        </div>
    );
}

// The `Chunk` dropdown: the initiative's chunks by number and label, the agent's own marked. A list opened from its button
// (portaled, as the picker is: the card clips its own overflow), keys on the list while it is open.
function ChunkSelect({
    options,
    value,
    state,
    disabled,
    onPick,
}: {
    options: ChunkOption[];
    value: string | null;
    // why there is nothing to pick from, when there is not
    state: "loading" | "error" | "ready";
    disabled: boolean;
    onPick: (label: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const current = options.find((o) => o.label === value);
    const close = () => {
        setOpen(false);
        anchor?.focus({ preventScroll: true });
    };
    return (
        <>
            <button
                ref={setAnchor}
                type="button"
                data-chat-initiative-chunk
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled || options.length === 0}
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "inline-flex min-w-0 max-w-[520px] cursor-pointer items-center gap-[8px] rounded-[8px] border border-edge-mid bg-surface px-[10px] py-[4px] text-[12.5px] text-primary hover:border-edge-strong disabled:cursor-default disabled:opacity-60",
                    FOCUS_RING
                )}
            >
                {current != null ? (
                    <>
                        <span className="flex-none font-mono text-[11px] text-muted">{current.n}</span>
                        <span className="min-w-0 truncate">{current.label}</span>
                    </>
                ) : value != null ? (
                    // a chunk the list does not hold (yet): its label as it is, so what Add writes is what is shown
                    <span className="min-w-0 truncate">{value}</span>
                ) : (
                    <span className="text-muted">
                        {state === "loading"
                            ? "Loading chunks…"
                            : state === "error"
                              ? "Couldn't read the chunks"
                              : options.length === 0
                                ? "No chunks yet"
                                : "Pick a chunk"}
                    </span>
                )}
                <ChevronDown size={12} strokeWidth={2.2} aria-hidden className="flex-none text-muted" />
            </button>
            <ChunkList
                open={open}
                anchor={anchor}
                options={options}
                value={value}
                onPick={(label) => {
                    onPick(label);
                    close();
                }}
                onClose={close}
            />
        </>
    );
}

function ChunkList({
    open,
    anchor,
    options,
    value,
    onPick,
    onClose,
}: {
    open: boolean;
    anchor: HTMLElement | null;
    options: ChunkOption[];
    value: string | null;
    onPick: (label: string) => void;
    onClose: () => void;
}) {
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: (next) => {
            if (!next) {
                onClose();
            }
        },
        placement: "bottom-start",
        strategy: "fixed",
        elements: { reference: anchor },
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: open ? autoUpdate : undefined,
    });
    // Escape is the list's own (it stops the key there); this is the press outside, which the button is not
    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: false })]);
    // React events bubble through a portal to what opened it: a click in the list is not the card's
    const contained = {
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
    };
    return (
        <FloatingPortal>
            <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps(contained)} className="z-[80]">
                {/* the panel is the reveal's own element, so its frost is real through the fade (the listbox inside scrolls) */}
                <PopoverReveal
                    open={open}
                    origin="top left"
                    className="w-[420px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[10px] border border-edge-mid frost shadow-popover-xl"
                >
                    <ChunkListBody options={options} value={value} onPick={onPick} onClose={onClose} />
                </PopoverReveal>
            </div>
        </FloatingPortal>
    );
}

function ChunkListBody({
    options,
    value,
    onPick,
    onClose,
}: {
    options: ChunkOption[];
    value: string | null;
    onPick: (label: string) => void;
    onClose: () => void;
}) {
    const [cursor, setCursor] = useState(
        Math.max(
            0,
            options.findIndex((o) => o.label === value)
        )
    );
    const cur = Math.min(cursor, Math.max(0, options.length - 1));
    const ref = useRef<HTMLDivElement>(null);
    const curEl = useRef<HTMLElement | null>(null);
    useEffect(() => {
        ref.current?.focus({ preventScroll: true });
    }, []);
    useEffect(() => {
        curEl.current?.scrollIntoView?.({ block: "nearest" });
    }, [cur]);
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
            setCursor(Math.min(options.length - 1, Math.max(0, cur + (e.key === "ArrowDown" ? 1 : -1))));
        } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (options[cur] != null) {
                onPick(options[cur].label);
            }
        }
    };
    return (
        <div
            ref={ref}
            role="listbox"
            aria-label="Chunk"
            data-chat-initiative-chunk-list
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="flex max-h-[298px] flex-col gap-px overflow-y-auto p-[6px] outline-none"
        >
            {options.map((o, i) => (
                <div
                    key={o.label}
                    role="option"
                    aria-selected={o.label === value}
                    data-chat-initiative-chunk-option={o.label}
                    ref={(el) => {
                        if (i === cur) {
                            curEl.current = el;
                        }
                    }}
                    // a press must not take focus off the list: the keys live there
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => onPick(o.label)}
                    className={cn(
                        "flex min-h-[32px] cursor-pointer items-center gap-[9px] rounded-[6px] px-[8px] text-left text-[12.5px] text-ink-hi",
                        i === cur ? "bg-surface-selected" : "hover:bg-surface-hover"
                    )}
                >
                    <span className="w-[18px] flex-none text-right font-mono text-[11px] text-muted">{o.n}</span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.mine ? <span className="flex-none text-[11px] text-muted">· this agent's</span> : null}
                    {o.label === value ? (
                        <Check size={12} strokeWidth={2.4} aria-hidden className="flex-none text-accent-soft" />
                    ) : null}
                </div>
            ))}
        </div>
    );
}

// ---- the card ----

type LiveProps = {
    host: Host;
    origin: CardOrigin;
    /** blockDraftKey(…) or messageDraftKey(…): the card's draft and its entry are kept under it */
    cardKey: string;
    /** the first draft, derived where the host's list is known */
    initial: InitiativeDraft;
    /** the write succeeded: keep the record (the card folds into its row) */
    onAdded: (rec: HandledRecord) => void;
    /** a proposed card dismissed: keep the record */
    onDismiss: (rec: HandledRecord) => void;
    /** a message card cancelled: remove it */
    onCancel: () => void;
};

function LiveCard({ host, origin, cardKey, initial, onAdded, onDismiss, onCancel }: LiveProps) {
    const { agent, exited, cards, ctx, details, detailErrors, want, ensureDetail } = host;
    const stored = useDraft(cardKey, initial);
    const base = useMemo<CardEntry>(() => {
        const editor = startsInEditor(origin, stored, initial);
        return { phase: editor ? "editing" : "waiting", editor };
    }, [origin, stored, initial]);
    const entry = useCardEntry(cardKey, base);
    const live = entry.phase !== "added" && entry.phase !== "dismissed";
    // a card on its way out holds what it showed: the store drops the draft the moment the card is handled
    const shownLast = useRef(stored);
    if (live) {
        shownLast.current = stored;
    }
    const draft = live ? stored : shownLast.current;
    const busy = entry.phase === "adding";
    const failed = entry.phase === "failed";

    useEffect(() => {
        want();
    }, [want]);
    useEffect(() => {
        if (draft.effort != null) {
            ensureDetail(draft.effort);
        }
    }, [draft.effort, ensureDetail]);

    const [focusEditor, setFocusEditor] = useState(false);
    // a card the person opened a moment ago takes focus; one a reload brought back does not take it from the box
    const [fresh] = useState(
        () => origin === "message" && isFreshMessageCard(cardKey.replace(/^message:/, ""), Date.now())
    );

    const update = (next: InitiativeDraft) => setDraft(cardKey, next);
    const chosen = draft.effort != null ? cards?.find((c) => effortOref(c.oref) === draft.effort) : undefined;
    const topic = draft.parent != null ? cards?.find((c) => effortOref(c.oref) === draft.parent) : undefined;
    const detail = draft.effort != null ? details.get(draft.effort) : undefined;
    const labels = detail?.chunks?.map((c) => c.label);
    const own = draft.effort != null && agent.effortId != null && draft.effort === effortOref(agent.effortId);
    const options = useMemo(
        () => chunkOptions(labels ?? [], own ? (ctx.agentChunk ?? null) : null),
        [labels, own, ctx.agentChunk]
    );
    const chunkState: "loading" | "error" | "ready" =
        labels != null ? "ready" : draft.effort != null && draft.effort in detailErrors ? "error" : "loading";

    const run = () => {
        if (!canAdd(draft) || busy) {
            return;
        }
        stepCard(cardKey, base, failed ? "retry" : "add");
        // the write is the store's, not this component's: a card Chat unmounts meanwhile still folds when it lands
        writeInitiative(draft, agent.project).then(
            (rec) => {
                stepCard(cardKey, base, "added");
                onAdded(rec);
            },
            (e) => stepCard(cardKey, base, "failed", errorText(e))
        );
    };
    const dismiss = () => {
        if (busy) {
            return;
        }
        const rec = dismissedRecord(
            draft,
            { initiative: chosen?.title ?? detail?.title, topic: topic?.title },
            Date.now()
        );
        stepCard(cardKey, base, "dismiss");
        onDismiss(rec);
    };
    // Cancel: a card from a message goes (the agent never proposed it); a proposed card closes its editor and goes back to
    // what the agent proposed
    const cancel = () => {
        if (busy) {
            return;
        }
        if (origin === "message") {
            stepCard(cardKey, base, "dismiss");
            onCancel();
        } else {
            stepCard(cardKey, base, "cancel");
            dropDraft(cardKey);
        }
    };
    const onFieldKey = (e: KeyboardEvent<HTMLElement>) => {
        if (e.nativeEvent.isComposing) {
            return;
        }
        // Ctrl/Cmd+Enter adds; plain Enter stays a line break. There is no Escape: the editor's text is kept in a draft
        // and Cancel (a button) is what discards it, so a stray key never loses what the person trimmed
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            run();
        }
    };

    const [intoAnchor, setIntoAnchor] = useAnchor();
    const [underAnchor, setUnderAnchor] = useAnchor();
    const [picking, setPicking] = useState<"into" | "under" | null>(null);
    const topicOrefs = useMemo(() => new Set(topicsOf(cards ?? NO_EFFORTS).map((t) => t.oref)), [cards]);
    // the topic picker lists only topics: every other initiative is left out
    const notTopics = useMemo(
        () => (cards ?? NO_EFFORTS).filter((c) => !topicOrefs.has(c.oref)).map((c) => c.oref),
        [cards, topicOrefs]
    );
    const closePicker = () => {
        const anchor = picking === "under" ? underAnchor : intoAnchor;
        setPicking(null);
        anchor?.focus({ preventScroll: true });
    };

    const intoLabel = cards == null ? "Loading…" : "No initiative";
    const intoRow = (
        <>
            <Chip card={chosen} attr="into" empty={intoLabel} />
            <button
                ref={setIntoAnchor}
                type="button"
                data-chat-initiative-change="into"
                disabled={busy}
                onClick={() => setPicking("into")}
                className={cn(CHANGE, FOCUS_RING)}
            >
                Change…
            </button>
        </>
    );
    const underRow = (
        <>
            <Chip card={topic} attr="under" empty={cards == null ? "Loading…" : "No topic"} />
            <button
                ref={setUnderAnchor}
                type="button"
                data-chat-initiative-change="under"
                disabled={busy}
                onClick={() => setPicking("under")}
                className={cn(CHANGE, FOCUS_RING)}
            >
                Change…
            </button>
            {draft.parent != null ? (
                <button
                    type="button"
                    data-chat-initiative-under-clear
                    disabled={busy}
                    onClick={() => update(withTopic(draft, null))}
                    className={cn(
                        "cursor-pointer border-0 bg-transparent p-0 text-[12px] text-muted hover:text-primary",
                        FOCUS_RING
                    )}
                >
                    No topic
                </button>
            ) : null}
            {agent.project ? <span className="text-muted">· {agent.project}</span> : null}
        </>
    );
    const chunkSelect = (
        <ChunkSelect
            options={options}
            value={draft.chunk}
            state={chunkState}
            disabled={busy}
            onPick={(label) => update({ ...draft, chunk: label })}
        />
    );

    // ---- bodies ----

    const compact = (
        <>
            <div className="flex flex-wrap items-center gap-[8px] text-[13.5px] text-primary">
                {draft.kind === "initiative" ? (
                    <>
                        <span>
                            Create a <span className="font-semibold">new initiative</span>
                            {draft.title.trim() !== "" ? <> “{draft.title.trim()}”</> : null} under
                        </span>
                        <Chip card={topic} attr="under" empty={cards == null ? "Loading…" : "No topic"} />
                        <button
                            ref={setUnderAnchor}
                            type="button"
                            data-chat-initiative-change="under"
                            disabled={busy}
                            onClick={() => setPicking("under")}
                            className={cn(CHANGE, FOCUS_RING)}
                        >
                            Change…
                        </button>
                    </>
                ) : (
                    <>
                        <span>
                            Add a <span className="font-semibold">{draft.kind === "note" ? "note" : "chunk"}</span> to
                        </span>
                        {intoRow}
                        {draft.kind === "note" ? (
                            <>
                                <span className="text-muted">›</span>
                                {chunkSelect}
                            </>
                        ) : null}
                    </>
                )}
            </div>
            {/* the clamp sits on an unpadded inner box: on a padded one the clipped third line paints into the padding */}
            <blockquote className="m-0 rounded-[8px] bg-surface px-[12px] py-[8px] text-[13px] leading-[1.5] text-secondary">
                <div data-chat-initiative-quote className="line-clamp-2 whitespace-pre-wrap">
                    {draft.text}
                </div>
            </blockquote>
        </>
    );

    const editor = (
        <>
            <div
                role="group"
                aria-label="What to add"
                className="flex w-fit gap-[2px] rounded-full border border-edge-mid bg-surface p-[2px]"
            >
                {(["chunk", "note", "initiative"] as const satisfies readonly InitiativeKind[]).map((k) => (
                    <button
                        key={k}
                        type="button"
                        data-chat-initiative-kind={k}
                        aria-pressed={draft.kind === k}
                        disabled={busy}
                        onClick={() => update(withKind(draft, k))}
                        className={cn(
                            "cursor-pointer rounded-full border-0 px-[12px] py-[4px] text-[12px] disabled:cursor-default",
                            FOCUS_RING,
                            draft.kind === k
                                ? "bg-surface-selected font-semibold text-primary"
                                : "bg-transparent text-muted hover:text-primary"
                        )}
                    >
                        {kindLabel(k)}
                    </button>
                ))}
            </div>
            {draft.kind === "initiative" ? (
                <>
                    <label className="flex flex-col gap-[6px] text-[12px] text-muted">
                        Title
                        <input
                            data-chat-initiative-title
                            autoFocus={focusEditor || fresh}
                            value={draft.title}
                            disabled={busy}
                            onChange={(e) => update({ ...draft, title: e.target.value })}
                            onKeyDown={onFieldKey}
                            className={cn(FIELD, "resize-none", FOCUS_RING)}
                        />
                    </label>
                    <label className="flex flex-col gap-[6px] text-[12px] text-muted">
                        First chunks · one per line
                        <textarea
                            data-chat-initiative-chunks
                            rows={3}
                            value={draft.chunks}
                            disabled={busy}
                            onChange={(e) => update({ ...draft, chunks: e.target.value })}
                            onKeyDown={onFieldKey}
                            className={cn(FIELD, FOCUS_RING)}
                        />
                    </label>
                    <TargetRow label="Under">{underRow}</TargetRow>
                </>
            ) : (
                <>
                    <textarea
                        data-chat-initiative-text
                        aria-label={draft.kind === "note" ? "Note" : "Chunk label"}
                        autoFocus={focusEditor || fresh}
                        rows={4}
                        value={draft.text}
                        disabled={busy}
                        onChange={(e) => update({ ...draft, text: e.target.value })}
                        onKeyDown={onFieldKey}
                        className={cn(FIELD, FOCUS_RING)}
                    />
                    <TargetRow label="Into">{intoRow}</TargetRow>
                    {draft.kind === "note" ? <TargetRow label="Chunk">{chunkSelect}</TargetRow> : null}
                </>
            )}
        </>
    );

    const buttons = (
        <div className="flex flex-wrap items-center gap-[8px]">
            <button
                type="button"
                {...(failed ? { "data-chat-initiative-retry": "" } : { "data-chat-initiative-add": "" })}
                disabled={busy || !canAdd(draft)}
                title={busy ? undefined : (addBlocker(draft) ?? undefined)}
                aria-busy={busy}
                onClick={run}
                className={cn(PRIMARY, FOCUS_RING)}
            >
                {busy ? (
                    <Loader2
                        size={13}
                        strokeWidth={2.4}
                        aria-hidden
                        className="animate-spin motion-reduce:animate-none"
                    />
                ) : null}
                {failed ? "Try again" : verbOf(draft.kind)}
            </button>
            {entry.editor ? (
                <button
                    type="button"
                    data-chat-initiative-cancel
                    disabled={busy}
                    onClick={cancel}
                    className={cn(SECONDARY, FOCUS_RING)}
                >
                    Cancel
                </button>
            ) : (
                <button
                    type="button"
                    data-chat-initiative-edit
                    disabled={busy}
                    onClick={() => {
                        setFocusEditor(true);
                        stepCard(cardKey, base, "edit");
                    }}
                    className={cn(SECONDARY, FOCUS_RING)}
                >
                    Edit
                </button>
            )}
            {origin === "agent" ? (
                <button
                    type="button"
                    data-chat-initiative-dismiss
                    disabled={busy}
                    onClick={dismiss}
                    className={cn(SECONDARY, FOCUS_RING)}
                >
                    Dismiss
                </button>
            ) : null}
        </div>
    );

    return (
        <section
            aria-label="Add to initiative"
            data-chat-initiative={entry.phase}
            data-chat-initiative-origin={origin}
            data-chat-initiative-static={cardStatic(exited) ? "" : undefined}
            className="flex flex-col gap-[12px] rounded-[12px] border border-edge-strong bg-surface-raised px-[16px] py-[14px]"
        >
            <div className="flex items-center gap-[8px] text-[12px] text-muted">
                <Flag size={14} strokeWidth={2} className="flex-none" aria-hidden />
                <span className="min-w-0 truncate">
                    Add to initiative · {origin === "agent" ? "proposed by the agent" : "from your message"}
                </span>
                {waitingDot(entry.phase, exited) ? (
                    <span className="ml-[6px] flex flex-none items-center gap-[6px] text-warning">
                        <span
                            data-chat-initiative-waiting
                            aria-hidden="true"
                            className="h-[6px] w-[6px] flex-none rounded-full bg-asking pulse-dot"
                        />
                        Waiting on you
                    </span>
                ) : cardStatic(exited) ? (
                    <span className="ml-[6px] flex-none text-muted">Agent exited</span>
                ) : null}
            </div>
            <BodySwap editing={entry.editor} compact={compact} editor={editor} />
            {buttons}
            {failed && entry.error != null ? (
                <div role="alert" data-chat-initiative-error className={ERROR_LINE}>
                    {entry.error}
                </div>
            ) : null}
            {!live ? null : draft.kind === "initiative" ? (
                <InitiativePicker
                    open={picking === "under"}
                    anchor={underAnchor}
                    project={agent.project ?? ""}
                    excluding={notTopics}
                    newLabel={null}
                    pickVerb="put under"
                    onPick={(pick) => {
                        update(withTopic(draft, pick));
                        closePicker();
                    }}
                    onClose={closePicker}
                />
            ) : (
                <InitiativePicker
                    open={picking === "into"}
                    anchor={intoAnchor}
                    project={agent.project ?? ""}
                    newLabel={null}
                    pickVerb="add to"
                    onPick={(pick) => {
                        update(withEffort(draft, pick, ctx));
                        closePicker();
                    }}
                    onClose={closePicker}
                />
            )}
        </section>
    );
}

// ---- the folded rows ----

// `✓ Note added · <initiative> › 2 — <text>` with Open ↗, or the faint `✕ Dismissed · note for <initiative>`
function HandledRow({ rec, model }: { rec: HandledRecord; model: AgentsViewModel }) {
    if (rec.outcome === "dismissed") {
        return (
            <div
                data-chat-initiative-row="dismissed"
                className="flex min-w-0 items-center gap-[10px] px-[14px] py-[6px] text-[12px] text-ink-faint"
            >
                <X size={14} strokeWidth={2.2} className="flex-none" aria-hidden />
                <span className="min-w-0 truncate">{foldRowLabel(rec)}</span>
            </div>
        );
    }
    const parts = foldRowParts(rec);
    return (
        <button
            type="button"
            data-chat-initiative-row="added"
            title="Open the initiative"
            disabled={rec.effort == null}
            onClick={() => {
                if (rec.effort != null) {
                    void openAddress(model, effortOref(rec.effort));
                }
            }}
            // the reveal around the row clips what is drawn outside it, so its focus ring is drawn inside
            className="flex w-full min-w-0 cursor-pointer items-center gap-[10px] rounded-[10px] border border-edge-mid bg-surface px-[14px] py-[9px] text-left text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-default"
        >
            <Check size={14} strokeWidth={2.4} className="flex-none text-success" aria-hidden />
            <span className="flex-none text-muted">{parts.lead}</span>
            <span className="min-w-0 max-w-[55%] flex-none truncate font-medium text-primary">{parts.subject}</span>
            {parts.tail != null ? (
                <span className="min-w-0 flex-1 truncate text-muted">{parts.tail}</span>
            ) : (
                <span className="flex-1" />
            )}
            <span data-chat-initiative-open className="flex-none text-muted">
                Open ↗
            </span>
        </button>
    );
}

// ---- the three exports ----

function BlockLive({ host, block, k }: { host: Host; block: InitiativeBlock; k: string }) {
    const initial = useMemo(() => draftFromBlock(block, host.ctx), [block, host.ctx]);
    const keep = (rec: HandledRecord) => markHandled(k, rec, host.agent.id);
    return (
        <LiveCard
            host={host}
            origin="agent"
            cardKey={blockDraftKey(k)}
            initial={initial}
            onAdded={keep}
            onDismiss={keep}
            onCancel={() => {}}
        />
    );
}

function BlockCard({ host, block }: { host: Host; block: InitiativeBlock }) {
    const k = useMemo(() => blockKey(block), [block]);
    const rec = useHandled(k);
    return (
        <AnimatePresence initial={false}>
            {rec != null ? (
                <Reveal key="row">
                    <HandledRow rec={rec} model={host.model} />
                </Reveal>
            ) : (
                <Reveal key="card">
                    <BlockLive host={host} block={block} k={k} />
                </Reveal>
            )}
        </AnimatePresence>
    );
}

/** A ```arc-initiative block: the card an agent proposes, or its folded row once handled. Outside a host (the terminal view,
 *  a transcript) or with a block that does not parse, it is the code block it always was. */
export function InitiativeBlockView({ raw }: { raw: string }) {
    const host = useContext(HostContext);
    const block = useMemo(() => parseInitiativeBlock(raw), [raw]);
    if (host == null || block == null) {
        return <CodeBlock code={raw} lang={INITIATIVE_LANG} />;
    }
    // the margin a visual block takes in prose (chatvisualview.tsx my-2): two blocks in a row otherwise touch
    return (
        <div data-chat-initiative-block className="my-2">
            <BlockCard host={host} block={block} />
        </div>
    );
}

function MessageLive({ host, agentId, card }: { host: Host; agentId: string; card: MessageCard }) {
    const initial = useMemo(() => draftFromMessage(card.text, host.ctx), [card.text, host.ctx]);
    return (
        <LiveCard
            host={host}
            origin="message"
            cardKey={messageDraftKey(card.id)}
            initial={initial}
            onAdded={(rec) => settleMessageCard(agentId, card.id, rec)}
            onDismiss={() => {}}
            onCancel={() => settleMessageCard(agentId, card.id, null)}
        />
    );
}

// The gap of the conversation's item column (chatconversation.tsx ITEM_GAP: gap-4). A message card is a direct child of that
// column, so while it is closed its margin takes the gap back, as the brainstorm card's end row does: a card opening from
// nothing would shove what is above it by the gap, and one closing would hold the gap open.
const ITEM_GAP = 16;

// One message card: it enters when opened and leaves when cancelled (the outer reveal and the gap), and swaps for its row once
// added (the inner reveal)
function MessageSlot({ host, agentId, card }: { host: Host; agentId: string; card: MessageCard }) {
    const reduceMotion = useReducedMotion();
    // a margin is no height or transform, so the app's reduced-motion config would still glide it: it jumps here
    const rowSpring = reduceMotion ? { duration: 0 } : MOTION.spring;
    return (
        <motion.div
            initial={{ marginTop: -ITEM_GAP }}
            animate={{ marginTop: 0, transition: rowSpring }}
            exit={{ marginTop: -ITEM_GAP, transition: rowSpring }}
        >
            <Reveal>
                <AnimatePresence initial={false}>
                    {card.outcome != null ? (
                        <Reveal key="row">
                            <HandledRow rec={card.outcome} model={host.model} />
                        </Reveal>
                    ) : (
                        <Reveal key="card">
                            <MessageLive host={host} agentId={agentId} card={card} />
                        </Reveal>
                    )}
                </AnimatePresence>
            </Reveal>
        </motion.div>
    );
}

/** The cards the person opened from messages that sit after the chat item with this key: the editor while open, its row
 *  once added; a cancelled one is gone. Draws nothing outside a host, and no element at all when there is none. */
export function InitiativeMessageCards({ agentId, anchor }: { agentId: string; anchor: string }) {
    const host = useContext(HostContext);
    const all = useMessageCards(agentId);
    const here = useMemo(() => all.filter((c) => c.anchor === anchor), [all, anchor]);
    if (host == null) {
        return null;
    }
    return (
        <AnimatePresence initial={false}>
            {here.map((c) => (
                <MessageSlot key={c.id} host={host} agentId={agentId} card={c} />
            ))}
        </AnimatePresence>
    );
}
