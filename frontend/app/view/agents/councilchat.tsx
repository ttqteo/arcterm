// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council's discussion as a channel of speech bubbles with threads (boards J-chat-bubbles and J3-seat-filter-panel in
// .superpowers/design/council-report; councilchatmodel.ts derives what it draws). Under the header the discussion draws
// (councildiscussion.tsx): Everyone and a filter for each seat (its letters, short name and how many messages it wrote;
// a click shows its messages alone; while it works, waits or failed its dot and what it is doing; an agent's terminal
// and a failed seat's Retry beside it), then the channel, one column: the person's question on the right in their
// bubble, folded to three lines and two of its limits; a divider for each round; every idea as a bubble in its seat's
// colour with its reply chip; the ideas and replies a seat wrote that wait for the person (amber, Send to the others,
// Edit, Drop); the line where an agent skipped a turn, a failure with Retry, and a typing row for whoever is at work;
// under it the composer, which posts to everyone, and `@` asks one seat. A click on an idea's reply chip, or Enter on
// the idea the keyboard cursor is on, slides its thread in from the right (sheetPanel): the idea on top, then its
// replies with their stance pills, the replies held as drafts, and a reply box that names who will answer. j and k move
// the cursor over the ideas, Enter opens the thread and Escape closes it, while focus is inside the channel or the
// thread (buildCouncilBindings reads the cursor councilchatnav.ts publishes). A message's evidence is a link per cited
// file (councilsourcespanel.tsx): a click opens the Sources panel in the thread's place, and Escape or its close button
// goes back to the thread it was opened from. Every part carries a data-council-* attribute for the CDP scenario
// `council-discussion`. The store's actions answer `{ ok, error }`; a refusal shows in the header (the `acts` the
// discussion shares).

import { sheetPanel } from "@/app/element/motiontokens";
import { buildCouncilBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import { cn } from "@/util/util";
import { atom, useAtom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { Check, ChevronDown, ChevronUp, CornerDownRight, SquareTerminal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
    type RefObject,
} from "react";
import type { Actions } from "./councilactions";
import {
    DRAFT_WAIT,
    councilChannel,
    councilThread,
    ideaOrder,
    insertMention,
    mentionPicker,
    onlyLine,
    replyReach,
    seatChips,
    type ChannelItem,
    type ChatThread,
    type DraftPost,
    type FailureLine,
    type IdeaPost,
    type PillTone,
    type ReplyPost,
    type SeatChip,
    type SkipLine,
    type ThreadItem,
    type TypingRow,
    type Who,
} from "./councilchatmodel";
import { useCouncilChatNav, type CouncilChatNav } from "./councilchatnav";
import { initialOf, isFollowUp, type AvatarTone } from "./councildiscussionmodel";
import { markSpans } from "./councilmarks";
import { answerers, draftsWaitWord, followupLabel } from "./councilmodel";
import { followsEnd, keepPlace, keptPlace, placeOf, topFor, type ScrollPlace } from "./councilscroll";
import { CouncilSourcesPanel, EvidenceChips } from "./councilsourcespanel";
import {
    closeCouncilSources,
    councilOnlyAtom,
    councilOpenProposalAtom,
    councilSourcesAtom,
    draftCouncil,
    replyCouncil,
    retryExpert,
    useEstimate,
} from "./councilstore";

// ---- shared pieces ----

// the identity colours stay the same in every theme (the conn-* palette); the classes are spelled out so Tailwind sees them
const TONE_BORDER: Record<AvatarTone, string> = {
    you: "border-accent",
    coordinator: "border-primary",
    muted: "border-muted",
    "conn-1": "border-conn-1",
    "conn-2": "border-conn-2",
    "conn-3": "border-conn-3",
    "conn-6": "border-conn-6",
    "conn-7": "border-conn-7",
    "conn-8": "border-conn-8",
};

const TONE_TEXT: Record<AvatarTone, string> = {
    you: "text-accent",
    coordinator: "text-primary",
    muted: "text-muted",
    "conn-1": "text-conn-1",
    "conn-2": "text-conn-2",
    "conn-3": "text-conn-3",
    "conn-6": "text-conn-6",
    "conn-7": "text-conn-7",
    "conn-8": "text-conn-8",
};

// an avatar's disc and a message's bubble: the seat's colour, faint, so who speaks shows without the text losing contrast
const TONE_FILL: Record<AvatarTone, string> = {
    you: "bg-accent/20",
    coordinator: "bg-primary/15",
    muted: "bg-muted/20",
    "conn-1": "bg-conn-1/20",
    "conn-2": "bg-conn-2/20",
    "conn-3": "bg-conn-3/20",
    "conn-6": "bg-conn-6/20",
    "conn-7": "bg-conn-7/20",
    "conn-8": "bg-conn-8/20",
};

const TONE_BUBBLE: Record<AvatarTone, string> = {
    you: "border-accent/30 bg-accent/10",
    coordinator: "border-primary/20 bg-primary/5",
    muted: "border-edge-mid bg-surface",
    "conn-1": "border-conn-1/25 bg-conn-1/8",
    "conn-2": "border-conn-2/25 bg-conn-2/8",
    "conn-3": "border-conn-3/25 bg-conn-3/8",
    "conn-6": "border-conn-6/25 bg-conn-6/8",
    "conn-7": "border-conn-7/25 bg-conn-7/8",
    "conn-8": "border-conn-8/25 bg-conn-8/8",
};

// the bubble of the idea whose thread is open, and a seat's filter while it is on
const TONE_BUBBLE_ON: Record<AvatarTone, string> = {
    you: "border-accent/55 bg-accent/18",
    coordinator: "border-primary/45 bg-primary/12",
    muted: "border-edge-strong bg-surface-selected",
    "conn-1": "border-conn-1/55 bg-conn-1/16",
    "conn-2": "border-conn-2/55 bg-conn-2/16",
    "conn-3": "border-conn-3/55 bg-conn-3/16",
    "conn-6": "border-conn-6/55 bg-conn-6/16",
    "conn-7": "border-conn-7/55 bg-conn-7/16",
    "conn-8": "border-conn-8/55 bg-conn-8/16",
};

/** The dot on an avatar's corner: an expert writing is green, one whose call failed red. Its word is in the avatar's
 *  title, so the colour never stands alone. */
type AvatarDot = "working" | "failed" | null;

export function CouncilAvatar({
    tone,
    name,
    initials,
    small,
    large,
    dashed,
    dim,
    dot,
    title,
    className,
    ...rest
}: {
    tone: AvatarTone;
    name: string;
    initials?: string; // the seat's letters (seatInitials); its name's first letter without
    small?: boolean;
    large?: boolean;
    dashed?: boolean;
    dim?: boolean;
    dot?: AvatarDot;
    title?: string;
    className?: string;
} & Record<`data-${string}`, string | undefined>) {
    return (
        <span
            title={title}
            {...rest}
            className={cn(
                "relative box-border flex flex-none items-center justify-center rounded-full font-bold",
                small
                    ? "h-[18px] w-[18px] text-[8px]"
                    : large
                      ? "h-[30px] w-[30px] text-[11px]"
                      : "h-[22px] w-[22px] text-[9px]",
                dashed ? cn("border-2 border-dashed bg-transparent", TONE_BORDER[tone]) : TONE_FILL[tone],
                TONE_TEXT[tone],
                dim && "opacity-55",
                className
            )}
        >
            {initials ?? initialOf(name)}
            {dot != null && (
                <span
                    className={cn(
                        "absolute -bottom-[2px] -right-[2px] box-border h-[7px] w-[7px] rounded-full border-[1.5px] border-background",
                        dot === "working" ? "bg-working pulse-dot" : "bg-error"
                    )}
                />
            )}
        </span>
    );
}

/** What a seat wrote, its must-read sentence (==…==, councilmarks.ts) highlighted in the accent's tint the terminal
 *  draws a skim highlight in, as markdown.scss draws a <mark>. */
export function MarkedText({ text }: { text: string }) {
    const spans = useMemo(() => markSpans(text), [text]);
    return (
        <>
            {spans.map((span, i) =>
                span.mark ? (
                    <mark key={i} data-council-mark className="rounded-[2px] bg-accent/24 px-px text-inherit">
                        {span.text}
                    </mark>
                ) : (
                    span.text
                )
            )}
        </>
    );
}

const PILL_TONE: Record<PillTone, string> = {
    accept: "bg-success/12 text-success-soft",
    challenge: "bg-askingbg text-warning-soft",
    oppose: "bg-error/12 text-error-soft",
    neutral: "bg-pill text-secondary",
};

export function CouncilPill({ word, tone }: { word: string; tone: PillTone }) {
    return <span className={cn("rounded-full px-[7px] py-px text-[10px] font-semibold", PILL_TONE[tone])}>{word}</span>;
}

const primaryButton =
    "h-[26px] cursor-pointer rounded-[6px] border-0 bg-accent px-[10px] text-[13px] font-semibold text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const secondaryButton =
    "h-[26px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[13px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const ghostButton =
    "h-[26px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[10px] text-[13px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

// ---- state the chat keeps ----

/** What is typed and not sent, per council, so it survives a trip to the Summary: the channel's composer under `""`,
 *  a thread's under its idea's id; and whether a follow-up may read code. */
interface ChatDrafts {
    texts: Record<string, string>;
    tools: boolean;
}

const councilChatDraftAtom = atomFamily(
    (_id: string) => atom<ChatDrafts>({ texts: {}, tools: false }) as PrimitiveAtom<ChatDrafts>
);

// ---- the seats ----

const SEAT_DOT: Record<SeatChip["dot"], string> = {
    working: "bg-working pulse-dot",
    waiting: "bg-asking",
    failed: "bg-error",
    idle: "bg-ink-faint",
};

// A seat as a filter (board J3-seat-filter-panel.dc.html): its letters, short name and how many messages it wrote; a
// click shows its messages alone, again shows everyone. While it works, waits or failed, its dot and what it is doing
// show beside the name; its kind and tooltip are on hover. An agent's terminal and a failed seat's Retry sit beside it.
function SeatFilter({
    c,
    chip,
    on,
    acts,
    onToggle,
    onOpenTerminal,
}: {
    c: Council;
    chip: SeatChip;
    on: boolean;
    acts: Actions;
    onToggle: () => void;
    onOpenTerminal: (tab: string) => void;
}) {
    const key = `retry:${chip.id}`;
    const count = chip.ideas + chip.replies;
    const live = chip.dot !== "idle";
    return (
        <div
            role="listitem"
            data-council-expert-chip={chip.id}
            data-lit={chip.dot === "working" || chip.dot === "waiting" ? "true" : "false"}
            data-dot={chip.dot}
            title={`${chip.name} · ${chip.kind}. ${chip.title}`}
            className="flex max-w-[420px] items-center gap-[4px]"
        >
            <button
                type="button"
                data-council-filter={chip.id}
                aria-pressed={on}
                disabled={count === 0}
                onClick={onToggle}
                className={cn(
                    "flex h-[30px] min-w-0 cursor-pointer items-center gap-[7px] rounded-full border py-0 pl-[4px] pr-[12px] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default",
                    on
                        ? cn(TONE_BUBBLE_ON[chip.tone], "font-semibold")
                        : cn(TONE_BUBBLE[chip.tone], "hover:brightness-125"),
                    TONE_TEXT[chip.tone]
                )}
            >
                <CouncilAvatar tone={chip.tone} name={chip.name} initials={chip.initials} />
                <span className="flex-none">{chip.short}</span>
                {count > 0 && <span className="flex-none font-normal tabular-nums text-muted">{count}</span>}
                {live && (
                    <span aria-hidden className={cn("h-[6px] w-[6px] flex-none rounded-full", SEAT_DOT[chip.dot])} />
                )}
                <span data-council-seat-doing className={live ? "min-w-0 truncate font-normal text-muted" : "sr-only"}>
                    {chip.doing}
                </span>
            </button>
            {chip.agent && (
                <button
                    type="button"
                    data-council-chip-open={chip.tab}
                    aria-label={`Open the terminal of ${chip.name}`}
                    title={`Open the terminal of ${chip.name}`}
                    onClick={() => onOpenTerminal(chip.tab)}
                    className="flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <SquareTerminal size={15} strokeWidth={1.8} aria-hidden />
                </button>
            )}
            {chip.retry && (
                <button
                    type="button"
                    data-council-chip-retry={chip.id}
                    aria-label={`Retry ${chip.name}`}
                    disabled={acts.busy.has(key)}
                    onClick={() => void acts.run(key, "Retry", () => retryExpert(c.id, chip.id))}
                    className={cn(secondaryButton, "h-[24px] px-[8px] text-[12px]")}
                >
                    {acts.busy.has(key) ? "Retrying…" : "Retry"}
                </button>
            )}
        </div>
    );
}

// ---- messages ----

// the line over a message: who wrote it, then what the caller adds (a label, the time)
function Byline({ who, children }: { who: Who; children?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-[7px] text-[12.5px]">
            <span className={cn("font-semibold", TONE_TEXT[who.tone])}>{who.name}</span>
            {children}
        </div>
    );
}

// a post's time of day; the hover says the day and how far into the council it came
const PostTime = ({ at, when }: { at: string; when: string }) =>
    at === "" ? null : (
        <span className="tabular-nums text-muted" title={when}>
            {at}
        </span>
    );

const Reaction = ({ text }: { text: string }) => (
    <span
        data-council-reaction
        className="inline-flex items-center gap-[5px] rounded-full bg-success/12 px-[8px] py-px text-[12px] font-semibold text-success-soft"
    >
        <Check size={10} strokeWidth={3} aria-hidden />
        {text}
    </span>
);

function IdeaMessage({
    councilId,
    item,
    open,
    focused,
    onOpen,
}: {
    councilId: string;
    item: IdeaPost;
    open: boolean;
    focused: boolean;
    onOpen: (id: string) => void;
}) {
    const t = item.thread;
    return (
        <article
            data-council-item
            data-item-kind="idea"
            data-council-idea={item.id}
            data-item-label={item.label}
            data-open={open ? "true" : undefined}
            data-focused={focused ? "true" : undefined}
            className="flex gap-[10px]"
        >
            <CouncilAvatar tone={item.tone} name={item.name} initials={item.initials} large />
            <div className="flex min-w-0 max-w-[720px] flex-1 flex-col gap-[6px]">
                <Byline who={item}>
                    {item.wild ? (
                        <CouncilPill word={item.label} tone="neutral" />
                    ) : (
                        <span className="text-muted">{item.label}</span>
                    )}
                    <PostTime at={item.at} when={item.when} />
                    {item.edited && <span className="text-muted">edited</span>}
                </Byline>
                <div
                    className={cn(
                        "flex min-w-0 flex-col gap-[6px] rounded-[4px_16px_16px_16px] border px-4 py-3",
                        open ? TONE_BUBBLE_ON[item.tone] : TONE_BUBBLE[item.tone],
                        focused && "ring-1 ring-edge-strong"
                    )}
                >
                    <h3 className="m-0 text-[16px] font-semibold leading-[1.4] text-primary">{item.title}</h3>
                    <span className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.6] text-ink-hi">
                        <MarkedText text={item.text} />
                    </span>
                    <EvidenceChips
                        evidence={item.evidence}
                        weak={item.weak}
                        source={{ councilId, owner: item.id, title: item.title }}
                    />
                    <div className="flex flex-wrap items-center gap-[10px]">
                        <button
                            type="button"
                            data-council-thread-open={item.id}
                            data-replies={t.count}
                            aria-label={`Open the thread: ${t.label}`}
                            onClick={() => onOpen(item.id)}
                            className="-ml-[6px] inline-flex h-[26px] cursor-pointer items-center gap-[8px] rounded-[6px] border border-transparent bg-transparent pl-[6px] pr-[8px] text-[12.5px] outline-none hover:border-edge-mid hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            {t.repliers.length > 0 && (
                                <span className="flex">
                                    {t.repliers.map((w, i) => (
                                        <CouncilAvatar
                                            key={w.author}
                                            tone={w.tone}
                                            name={w.name}
                                            initials={w.initials}
                                            small
                                            data-council-replier={w.author}
                                            className={i > 0 ? "-ml-[5px]" : undefined}
                                        />
                                    ))}
                                </span>
                            )}
                            <span className="font-semibold text-accent">{t.label}</span>
                            {t.last !== "" && (
                                <span className="text-muted" title={t.lastWhen}>
                                    {t.last}
                                </span>
                            )}
                            {t.drafts > 0 && <span className="text-warning-soft">{draftsWaitWord(t.drafts)}</span>}
                        </button>
                        {item.agrees.map((text, i) => (
                            <Reaction key={i} text={text} />
                        ))}
                        {item.picks != null && (
                            <span
                                data-council-picks
                                title={item.picks.title}
                                className="rounded-full bg-pill px-[8px] py-px text-[12px] font-semibold text-secondary"
                            >
                                {item.picks.label}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}

// the pill and the time beside a reply's author; a thread's reply drawn in the channel (one seat's messages) also names
// the idea it is on, a click opening that thread
function ReplyHeader({ item, onOpenIdea }: { item: ReplyPost; onOpenIdea?: (id: string) => void }) {
    return (
        <Byline who={item}>
            <CouncilPill word={item.label} tone={item.pill} />
            <PostTime at={item.at} when={item.when} />
            {item.edited && <span className="text-muted">edited</span>}
            {item.reaches !== "" && <span className="text-muted">{item.reaches}</span>}
            {item.pending !== "" && <span className="text-muted">{item.pending}</span>}
            {onOpenIdea != null && item.on !== "" && (
                <button
                    type="button"
                    data-council-reply-on={item.proposalid}
                    onClick={() => onOpenIdea(item.proposalid)}
                    className="flex min-w-0 cursor-pointer items-center gap-[5px] rounded-[4px] text-[12px] text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <CornerDownRight size={11} aria-hidden className="flex-none" />
                    <span className="min-w-0 truncate">{item.on}</span>
                </button>
            )}
        </Byline>
    );
}

function ReplyMessage({
    councilId,
    item,
    inThread,
    onOpenIdea,
}: {
    councilId: string;
    item: ReplyPost;
    inThread?: boolean;
    onOpenIdea?: (id: string) => void;
}) {
    return (
        <article
            data-council-item
            data-item-kind="reply"
            data-council-reply-post={item.id}
            data-item-label={item.label}
            data-item-mine={item.mine ? "true" : undefined}
            data-in-thread={inThread ? "true" : undefined}
            className={cn("flex gap-[8px]", item.mine && "flex-row-reverse")}
        >
            {!item.mine && <CouncilAvatar tone={item.tone} name={item.name} initials={item.initials} />}
            <div className={cn("flex min-w-0 max-w-[680px] flex-col gap-[5px]", item.mine && "items-end")}>
                <ReplyHeader item={item} onOpenIdea={inThread ? undefined : onOpenIdea} />
                <div
                    className={cn(
                        "flex min-w-0 flex-col gap-[6px] border px-[14px] py-[10px]",
                        item.mine ? "rounded-[14px_14px_4px_14px]" : "rounded-[4px_14px_14px_14px]",
                        TONE_BUBBLE[item.tone]
                    )}
                >
                    <span className="whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-ink-hi">
                        <MarkedText text={item.text} />
                    </span>
                    <EvidenceChips
                        evidence={item.evidence}
                        weak={item.weak}
                        source={{ councilId, owner: item.id, title: `${item.name}'s reply` }}
                    />
                </div>
            </div>
        </article>
    );
}

// an idea or a reply that waits for the person: Send to the others, Edit (the text, then send it as edited) or Drop
function DraftCard({ c, item, acts }: { c: Council; item: DraftPost; acts: Actions }) {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(item.text);
    const key = `draft:${item.id}`;
    const busy = acts.busy.has(key);
    const settle = (what: string, action: "send" | "edit" | "drop", body?: string) =>
        void acts.run(key, what, () => draftCouncil(c.id, item.id, action, body));
    const save = () => {
        if (text.trim() !== "") {
            settle("Send", "edit", text.trim());
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setEditing(false);
            setText(item.text);
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            save();
        }
    };
    return (
        <article
            data-council-item
            data-item-kind="draft"
            data-council-draft={item.id}
            data-draft-of={item.of}
            aria-label="Draft waiting for you"
            className="flex gap-[9px] rounded-[12px] border border-asking/30 bg-askingbg px-[12px] py-[10px]"
        >
            <CouncilAvatar tone={item.tone} name={item.name} initials={item.initials} />
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <Byline who={item}>
                    <span className="inline-flex items-center gap-[5px] font-semibold text-warning-soft">
                        <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-asking" />
                        {DRAFT_WAIT}
                    </span>
                    {item.of === "reply" && <CouncilPill word={item.label} tone={item.pill} />}
                    {item.edited && <span className="text-muted">edited</span>}
                    {item.on !== "" && (
                        <span className="flex min-w-0 items-center gap-[5px] text-[12px] text-muted">
                            <CornerDownRight size={11} aria-hidden className="flex-none" />
                            <span className="min-w-0 truncate">{item.on}</span>
                        </span>
                    )}
                </Byline>
                {item.title !== "" && (
                    <h3 className="m-0 text-[15px] font-semibold leading-[1.35] text-primary">{item.title}</h3>
                )}
                {editing ? (
                    <>
                        <textarea
                            autoFocus
                            data-council-draft-input
                            rows={3}
                            value={text}
                            aria-label={item.of === "idea" ? "The idea's argument" : "The reply"}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={onKeyDown}
                            className="box-border w-full resize-none rounded-[6px] border border-edge-strong bg-surface px-[10px] py-[8px] text-[13.5px] leading-[1.5] text-primary outline-none focus:border-accent"
                        />
                        {item.revised && (
                            <span className="text-[12px] text-muted">
                                Edit changes only this line. The new title and argument apply as written.
                            </span>
                        )}
                    </>
                ) : (
                    <span className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.5] text-ink-hi">
                        <MarkedText text={item.text} />
                    </span>
                )}
                <EvidenceChips
                    evidence={item.evidence}
                    weak={item.weak}
                    source={{ councilId: c.id, owner: item.id, title: item.title || `${item.name}'s reply` }}
                />
                <div className="flex flex-wrap gap-[6px]">
                    {editing ? (
                        <>
                            <button
                                type="button"
                                data-council-draft-save
                                disabled={busy || text.trim() === ""}
                                onClick={save}
                                className={primaryButton}
                            >
                                {busy ? "Sending…" : "Send edited"}
                            </button>
                            <button
                                type="button"
                                data-council-draft-cancel
                                onClick={() => {
                                    setEditing(false);
                                    setText(item.text);
                                }}
                                className={ghostButton}
                            >
                                Cancel
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                data-council-draft-send
                                disabled={busy}
                                onClick={() => settle("Send", "send")}
                                className={primaryButton}
                            >
                                {item.actions[0].label}
                            </button>
                            <button
                                type="button"
                                data-council-draft-edit
                                disabled={busy}
                                onClick={() => setEditing(true)}
                                className={secondaryButton}
                            >
                                {item.actions[1].label}
                            </button>
                            <button
                                type="button"
                                data-council-draft-drop
                                disabled={busy}
                                onClick={() => settle("Drop", "drop")}
                                className={ghostButton}
                            >
                                {item.actions[2].label}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </article>
    );
}

function Divider({ text, round }: { text: string; round: number }) {
    return (
        <div
            data-council-item
            data-item-kind="divider"
            data-council-divider={round}
            className="flex items-center gap-[10px] px-[10px] py-[6px] text-[12.5px] text-muted"
        >
            <span aria-hidden className="h-px flex-1 bg-edge-faint" />
            <span>{text}</span>
            <span aria-hidden className="h-px flex-1 bg-edge-faint" />
        </div>
    );
}

// the person's question as their message on the right (boards F-asked-message and J-chat-bubbles): three lines and two
// of the limits it set until Show all opens the rest
const QUESTION_FOLD = 280;
const LIMITS_FOLDED = 2;

function QuestionMessage({ item }: { item: Extract<ChannelItem, { kind: "question" }> }) {
    const [open, setOpen] = useState(false);
    const hidden = item.limits.length - LIMITS_FOLDED;
    const foldable = hidden > 0 || item.text.length > QUESTION_FOLD;
    const limits = open ? item.limits : item.limits.slice(0, LIMITS_FOLDED);
    return (
        <article data-council-item data-item-kind="question" className="flex justify-end">
            <div
                className={cn(
                    "flex min-w-0 max-w-[640px] flex-col gap-[8px] rounded-[16px_16px_4px_16px] border px-4 py-3",
                    TONE_BUBBLE[item.tone]
                )}
            >
                <div className="flex flex-wrap items-center gap-[7px] text-[12.5px]">
                    <span className={cn("font-semibold", TONE_TEXT[item.tone])}>{item.name}</span>
                    <span className="text-muted">{item.label}</span>
                    <PostTime at={item.at} when={item.when} />
                    {foldable && (
                        <button
                            type="button"
                            data-council-question-toggle
                            aria-expanded={open}
                            onClick={() => setOpen(!open)}
                            className="ml-auto flex cursor-pointer items-center gap-[4px] rounded-[4px] border-0 bg-transparent p-0 text-[12.5px] text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            {open ? "Show less" : "Show all"}
                            {open ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
                        </button>
                    )}
                </div>
                <span
                    data-council-question
                    className={cn(
                        "whitespace-pre-wrap break-words text-[15px] leading-[1.55] text-primary",
                        !open && "line-clamp-3"
                    )}
                >
                    {item.text}
                </span>
                {item.limits.length > 0 && (
                    <div data-council-limits className="flex flex-wrap items-center gap-[6px]">
                        <span className="mr-[2px] text-[12.5px] font-semibold text-muted">Keep to</span>
                        {limits.map((limit, i) => (
                            <span
                                key={i}
                                data-council-limit
                                className="rounded-[6px] bg-accent/12 px-[8px] py-[2px] text-[13px] leading-[1.45] text-secondary"
                            >
                                {limit}
                            </span>
                        ))}
                        {!open && hidden > 0 && (
                            <button
                                type="button"
                                onClick={() => setOpen(true)}
                                className="cursor-pointer rounded-[4px] border-0 bg-transparent px-[4px] text-[13px] text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                +{hidden} more
                            </button>
                        )}
                    </div>
                )}
            </div>
        </article>
    );
}

function SkippedLine({ item, onOpenTerminal }: { item: SkipLine; onOpenTerminal: (tab: string) => void }) {
    // the seat's name is the line's lead, drawn heavier
    const rest = item.text.startsWith(item.name) ? item.text.slice(item.name.length) : item.text;
    return (
        <div
            role="status"
            data-council-item
            data-item-kind="skip"
            data-council-skip={item.author}
            className="flex flex-wrap items-center gap-[9px] px-[10px] py-[6px] text-[13px] text-muted"
        >
            <CouncilAvatar tone={item.tone} name={item.name} initials={item.initials} small dim />
            <span>
                {rest === item.text ? null : <span className="font-semibold text-secondary">{item.name}</span>}
                {rest}
            </span>
            {item.tab !== "" && (
                <button
                    type="button"
                    data-council-open-terminal={item.tab}
                    onClick={() => onOpenTerminal(item.tab)}
                    className="h-[22px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[8px] text-[12px] font-semibold text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Open its terminal
                </button>
            )}
        </div>
    );
}

function FailedLine({ c, item, acts }: { c: Council; item: FailureLine; acts: Actions }) {
    const key = `retry:${item.author}`;
    return (
        <div
            role="alert"
            data-council-item
            data-item-kind="failure"
            data-council-failed={item.author}
            className="flex flex-wrap items-center gap-[9px] px-[10px] py-[6px] text-[13px]"
        >
            <CouncilAvatar tone={item.tone} name={item.name} initials={item.initials} small dot="failed" />
            <span className="text-error-soft">{item.text}</span>
            <span data-council-failed-error className="min-w-0 break-words text-muted">
                {item.error}
            </span>
            <button
                type="button"
                data-council-retry={item.author}
                aria-label={`Retry ${item.name}`}
                disabled={acts.busy.has(key)}
                onClick={() => void acts.run(key, "Retry", () => retryExpert(c.id, item.author))}
                className={cn(secondaryButton, "h-[22px] px-[8px] text-[12px]")}
            >
                {acts.busy.has(key) ? "Retrying…" : "Retry"}
            </button>
        </div>
    );
}

function TypingLine({ item }: { item: TypingRow }) {
    return (
        <div
            data-council-item
            data-item-kind="typing"
            data-council-typing-row={item.author}
            data-waiting={item.waiting ? "true" : undefined}
            data-item-on={item.proposalid || undefined}
            className="flex items-center gap-[9px] px-[10px] py-[6px]"
        >
            <CouncilAvatar tone={item.tone} name={item.name} initials={item.initials} dashed />
            <span data-council-typing className="text-[13px] text-muted">
                {item.text}
            </span>
            {item.on !== "" && (
                <span className="flex min-w-0 items-center gap-[5px] text-[12px] text-muted">
                    <CornerDownRight size={11} aria-hidden className="flex-none" />
                    <span className="min-w-0 truncate">{item.on}</span>
                </span>
            )}
        </div>
    );
}

// ---- the composer ----

function Composer({
    c,
    scope,
    proposalId,
    placeholder,
    sendLabel,
    labelledBy,
    returnTo,
}: {
    c: Council;
    scope: "channel" | "thread";
    proposalId: string; // the idea a thread's reply answers; empty for the channel (the whole council)
    placeholder: string;
    sendLabel: string;
    labelledBy: string;
    returnTo: () => HTMLElement | null;
}) {
    const [drafts, setDrafts] = useAtom(councilChatDraftAtom(c.id));
    const text = drafts.texts[proposalId] ?? "";
    const setText = (t: string) => setDrafts((d) => ({ ...d, texts: { ...d.texts, [proposalId]: t } }));
    const box = useRef<HTMLTextAreaElement>(null);
    const [caret, setCaret] = useState(0);
    const [pick, setPick] = useState(0);
    const [dismissed, setDismissed] = useState(-1);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const found = mentionPicker(c, text, caret);
    const picker = found != null && found.start !== dismissed ? found : null;
    const who = answerers(c, proposalId, "", text);
    const followUp = isFollowUp(c);
    const k = followUp ? who.length : 0;
    const est = useEstimate(k > 0 ? { id: c.id, followup: k, tools: drafts.tools } : null);
    const hint = k > 0 ? followupLabel(est, k, drafts.tools) : replyReach(c, proposalId, "", text).label;

    const send = async () => {
        const body = text.trim();
        if (body === "" || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        const r = await replyCouncil({
            id: c.id,
            proposalid: proposalId || undefined,
            text: body,
            tools: followUp && drafts.tools ? true : undefined,
        });
        setBusy(false);
        if (r.ok === false) {
            setError(r.error);
        } else {
            setText("");
        }
    };
    const choose = (seat: CouncilExpert) => {
        if (picker == null) {
            return;
        }
        const next = insertMention(text, picker.start, caret, seat);
        setText(next.text);
        setCaret(next.caret);
        setPick(0);
        requestAnimationFrame(() => {
            box.current?.focus();
            box.current?.setSelectionRange(next.caret, next.caret);
        });
    };
    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) {
            return;
        }
        if (picker != null) {
            const n = picker.seats.length;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (p + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                choose(picker.seats[Math.min(pick, n - 1)]);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDismissed(picker.start);
                return;
            }
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
        } else if (e.key === "Escape") {
            // Escape leaves the box for the channel or the thread it sits in, so the next one closes the thread
            e.preventDefault();
            e.stopPropagation();
            returnTo()?.focus();
        }
    };
    const rows = Math.min(5, Math.max(1, text.split("\n").length));

    return (
        <div data-council-composer={scope} data-composer-for={proposalId} className="relative flex flex-col gap-[6px]">
            {picker != null && (
                <ul
                    role="listbox"
                    data-council-mentions
                    aria-label="Seats"
                    className="absolute bottom-full left-0 z-10 m-0 mb-[4px] flex max-h-[200px] min-w-[220px] list-none flex-col overflow-y-auto rounded-[8px] border border-edge-strong bg-surface-raised p-[4px]"
                >
                    {picker.seats.map((s, i) => (
                        <li
                            key={s.id}
                            role="option"
                            aria-selected={i === pick}
                            data-council-mention={s.id}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                choose(s);
                            }}
                            className={cn(
                                "flex cursor-pointer items-center gap-[8px] rounded-[6px] px-[8px] py-[5px] text-[13px]",
                                i === pick ? "bg-surface-hover text-primary" : "text-secondary"
                            )}
                        >
                            <span className="font-semibold">{s.name}</span>
                            <span className="text-[12px] text-muted">{s.agent ? "agent" : "expert"}</span>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex items-end gap-[8px] rounded-[14px] border border-edge-mid bg-surface py-[8px] pl-[14px] pr-[8px] focus-within:border-accent">
                <textarea
                    ref={box}
                    data-council-composer-input
                    rows={rows}
                    value={text}
                    aria-labelledby={labelledBy}
                    placeholder={placeholder}
                    onChange={(e) => {
                        setText(e.target.value);
                        setCaret(e.target.selectionStart);
                        setPick(0);
                    }}
                    onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                    onKeyDown={onKeyDown}
                    className={cn(
                        "box-border min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-[14px] leading-[1.5] text-primary outline-none placeholder:text-muted",
                        rows < 5 ? "overflow-hidden" : "overflow-y-auto"
                    )}
                />
                <button
                    type="button"
                    data-council-composer-send
                    disabled={text.trim() === "" || busy}
                    onClick={() => void send()}
                    title="Send (Enter)"
                    className={cn(primaryButton, "h-[30px] px-[14px] text-[13.5px]")}
                >
                    {busy ? "Sending…" : sendLabel}
                </button>
            </div>
            {followUp && (
                <button
                    type="button"
                    role="switch"
                    aria-checked={drafts.tools}
                    data-council-tools
                    onClick={() => setDrafts((d) => ({ ...d, tools: !d.tools }))}
                    className="flex w-fit cursor-pointer items-center gap-[7px] rounded-[6px] border-0 bg-transparent py-px text-[12.5px] text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <span
                        className={cn(
                            "relative h-[14px] w-[24px] flex-none rounded-full",
                            drafts.tools ? "bg-accent" : "bg-edge-strong"
                        )}
                    >
                        <span
                            className={cn(
                                "absolute top-[2px] h-[10px] w-[10px] rounded-full bg-background",
                                drafts.tools ? "left-[12px]" : "left-[2px]"
                            )}
                        />
                    </span>
                    Let them read code
                </button>
            )}
            <span data-council-composer-hint className="min-w-0 text-[12px] tabular-nums text-muted">
                {hint}
            </span>
            {error != null && (
                <span role="alert" data-council-composer-error className="text-[12.5px] text-error-soft">
                    {error}
                </span>
            )}
        </div>
    );
}

// ---- the thread ----

function ThreadPanel({
    c,
    thread,
    acts,
    onClose,
}: {
    c: Council;
    thread: ChatThread;
    acts: Actions;
    onClose: () => void;
}) {
    const idea = thread.idea;
    const scroller = useRef<HTMLDivElement>(null);
    const onScroll = useKeptScroll(scroller, `thread:${c.id}:${idea.id}`);
    return (
        <aside
            data-council-thread={idea.id}
            tabIndex={-1}
            aria-label="Thread"
            className="flex h-full min-h-0 w-[420px] flex-none flex-col border-l border-edge-faint bg-surface outline-none"
        >
            <div className="flex flex-none items-center gap-[8px] border-b border-edge-faint px-4 py-[12px]">
                <span className="text-[14px] font-semibold">Thread</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{idea.title}</span>
                <button
                    type="button"
                    data-council-thread-close
                    aria-label="Close the thread (Esc)"
                    title="Close the thread (Esc)"
                    onClick={onClose}
                    className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <X size={14} strokeWidth={2} aria-hidden />
                </button>
            </div>
            <div
                ref={scroller}
                onScroll={onScroll}
                className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-4 py-4"
            >
                <article data-council-post={idea.id} className="flex gap-[8px]">
                    <CouncilAvatar tone={idea.tone} name={idea.name} initials={idea.initials} />
                    <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                        <Byline who={idea}>
                            <span className="text-muted">{idea.label}</span>
                            <PostTime at={idea.at} when={idea.when} />
                            {idea.edited && <span className="text-muted">edited</span>}
                        </Byline>
                        <div
                            className={cn(
                                "flex min-w-0 flex-col gap-[6px] rounded-[4px_14px_14px_14px] border px-[14px] py-[10px]",
                                TONE_BUBBLE[idea.tone]
                            )}
                        >
                            <h2
                                data-council-post-title
                                className="m-0 text-[15px] font-semibold leading-[1.4] text-primary"
                            >
                                {idea.title}
                            </h2>
                            <span className="whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-ink-hi">
                                <MarkedText text={idea.text} />
                            </span>
                            <EvidenceChips
                                evidence={idea.evidence}
                                weak={idea.weak}
                                source={{ councilId: c.id, owner: idea.id, title: idea.title }}
                            />
                            {idea.agrees.length > 0 && (
                                <div className="flex flex-wrap gap-[6px]">
                                    {idea.agrees.map((text, i) => (
                                        <Reaction key={i} text={text} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </article>
                <div data-council-thread-count className="flex items-center gap-[10px] text-[12.5px] text-muted">
                    {idea.thread.label}
                    <span aria-hidden className="h-px flex-1 bg-edge-faint" />
                </div>
                {thread.items.map((item: ThreadItem) =>
                    item.kind === "reply" ? (
                        <ReplyMessage key={item.id} councilId={c.id} item={item} inThread />
                    ) : item.kind === "draft" ? (
                        <DraftCard key={item.id} c={c} item={item} acts={acts} />
                    ) : (
                        <TypingLine key={item.id} item={item} />
                    )
                )}
            </div>
            <div className="flex-none px-3 pb-4 pt-[10px]">
                <span id="council-thread-reply-label" className="sr-only">
                    Reply in the thread
                </span>
                <Composer
                    c={c}
                    scope="thread"
                    proposalId={idea.id}
                    placeholder="Reply in thread · @ to ask one seat"
                    sendLabel="Reply"
                    labelledBy="council-thread-reply-label"
                    returnTo={() => document.querySelector<HTMLElement>("[data-council-thread]")}
                />
            </div>
        </aside>
    );
}

// ---- the chat ----

/** Keeps a council scroller where the reader left it, under `key` (councilscroll.ts): back there after a remount (another
 *  council, the Summary, another agent) and after the surface comes back from display:none, which drops an element's
 *  offset. With `follow`, a reader at the bottom stays at the bottom as `count` grows, and a scroller with nothing kept
 *  starts there; without it, at the top. Returns the scroller's onScroll. */
export function useKeptScroll(
    ref: RefObject<HTMLElement | null>,
    key: string,
    { follow = false, count = 0 }: { follow?: boolean; count?: number } = {}
): () => void {
    const place = useRef<ScrollPlace | undefined>(undefined);
    const restore = useCallback(() => {
        const el = ref.current;
        if (el != null && el.clientHeight > 0) {
            el.scrollTop = topFor(place.current, el, follow);
        }
    }, [ref, follow]);
    useLayoutEffect(() => {
        place.current = keptPlace(key);
        restore();
    }, [key, restore]);
    useLayoutEffect(() => {
        if (followsEnd(place.current, follow)) {
            restore();
        }
    }, [count, follow, restore]);
    // shown again (its offset is gone), or resized while following (the thread opening rewraps the channel)
    useEffect(() => {
        const el = ref.current;
        if (el == null || typeof ResizeObserver === "undefined") {
            return;
        }
        let shown = el.clientHeight > 0;
        const ro = new ResizeObserver(() => {
            const now = el.clientHeight > 0;
            if (now && (!shown || followsEnd(place.current, follow))) {
                restore();
            }
            shown = now;
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref, follow, restore]);
    return useCallback(() => {
        const el = ref.current;
        // a hidden scroller has no height and clamps to the top: not the reader's place
        if (el != null && el.clientHeight > 0) {
            place.current = placeOf(el);
            keepPlace(key, place.current);
        }
    }, [ref, key]);
}

// the channel, scrolled to its newest line while the reader is at the bottom of it, and back where they left it
function Channel({
    children,
    councilId,
    count,
    boxRef,
}: {
    children: ReactNode;
    councilId: string;
    count: number;
    boxRef: RefObject<HTMLDivElement | null>;
}) {
    const onScroll = useKeptScroll(boxRef, `channel:${councilId}`, { follow: true, count });
    return (
        <div
            ref={boxRef}
            data-council-channel
            tabIndex={0}
            role="log"
            aria-label="Council channel"
            onScroll={onScroll}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-edge-strong"
        >
            <div className="mx-auto flex w-full max-w-[860px] flex-col gap-[16px]">{children}</div>
        </div>
    );
}

/** The council's discussion as a channel with threads. `notes` is what the discussion draws above the channel (the failed
 *  summary and its Retry); `onOpenTerminal` takes an agent's tab id. */
export function CouncilChat({
    c,
    acts,
    notes,
    onOpenTerminal,
    onOpenFile,
}: {
    c: Council;
    acts: Actions;
    notes?: ReactNode;
    onOpenTerminal: (tab: string) => void;
    onOpenFile?: (path: string, line?: number) => void;
}) {
    const [openId, setOpenId] = useAtom(councilOpenProposalAtom(c.id));
    const [sources, setSources] = useAtom(councilSourcesAtom(c.id));
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const channel = useRef<HTMLDivElement>(null);
    const thread = openId == null ? null : councilThread(c, openId);
    const threadOpen = thread != null;
    const sourcesOpen = !threadOpen && sources != null;
    // an idea that is gone (the id of another council, a dropped idea) closes the panel
    useEffect(() => {
        if (openId != null && !threadOpen) {
            setOpenId(null);
        }
    }, [openId, threadOpen, setOpenId]);
    // a thread opened another way (Enter on an idea, the Summary's link) takes the right of the chat from the sources
    useEffect(() => {
        if (threadOpen && sources != null) {
            setSources(null);
        }
    }, [threadOpen, sources, setSources]);

    // one seat's messages only, when the Summary's column asked for them (a seat no longer on the panel shows everyone)
    const [only, setOnly] = useAtom(councilOnlyAtom(c.id));
    const onlyId = only != null && c.experts.some((e) => e.id === only) ? only : null;
    const items = useMemo(() => councilChannel(c, onlyId ?? undefined), [c, onlyId]);
    const seats = useMemo(() => seatChips(c), [c]);
    const onlySeat = onlyId == null ? null : (seats.find((chip) => chip.id === onlyId) ?? null);
    const order = useMemo(() => ideaOrder(items), [items]);
    const open = useCallback(
        (id: string) => {
            setOpenId(id);
            setFocusedId(id);
        },
        [setOpenId]
    );
    const closeSources = useCallback(() => closeCouncilSources(c.id), [c.id]);
    // Escape closes the sources first, back to the thread they were opened from, then the thread
    const close = useCallback(
        () => (sourcesOpen ? closeSources() : setOpenId(null)),
        [sourcesOpen, closeSources, setOpenId]
    );
    const nav = useMemo<CouncilChatNav>(
        () => ({ order, focusedId, openId: threadOpen ? openId : null, sourcesOpen, focus: setFocusedId, open, close }),
        [order, focusedId, openId, threadOpen, sourcesOpen, open, close]
    );
    useCouncilChatNav(nav);
    const bindings = useMemo(buildCouncilBindings, []);
    useKeybindings(bindings);
    // the cursor stays in view as j and k move it
    useEffect(() => {
        if (focusedId != null) {
            channel.current
                ?.querySelector(`[data-council-idea="${focusedId}"]`)
                ?.scrollIntoView?.({ block: "nearest" });
        }
    }, [focusedId]);

    const coordinators = new Set(c.experts.filter((e) => e.coordinator).map((e) => e.id));
    return (
        <div className="flex min-h-0 flex-1">
            <div data-council-main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                    data-council-experts
                    role="list"
                    aria-label="Seats: a click shows one seat's messages"
                    className="flex flex-none flex-wrap items-center gap-[6px] border-b border-edge-faint px-6 py-[10px]"
                >
                    <button
                        type="button"
                        data-council-action="show-everyone"
                        aria-pressed={onlyId == null}
                        onClick={() => setOnly(null)}
                        className={cn(
                            "h-[30px] cursor-pointer rounded-full border px-[12px] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            onlyId == null
                                ? "border-edge-strong bg-surface-selected font-semibold text-primary"
                                : "border-edge-mid bg-transparent text-secondary hover:text-primary"
                        )}
                    >
                        Everyone
                    </button>
                    {seats.map((chip) => (
                        <SeatFilter
                            key={chip.id}
                            c={c}
                            chip={chip}
                            on={chip.id === onlyId}
                            acts={acts}
                            onToggle={() => setOnly(chip.id === onlyId ? null : chip.id)}
                            onOpenTerminal={onOpenTerminal}
                        />
                    ))}
                    {onlySeat != null && (
                        <span role="status" data-council-only={onlySeat.id} className="ml-[6px] text-[13px] text-muted">
                            {onlyLine(onlySeat)}
                        </span>
                    )}
                </div>
                {notes}
                <Channel boxRef={channel} councilId={c.id} count={items.length}>
                    {items.map((item) => {
                        switch (item.kind) {
                            case "question":
                                return <QuestionMessage key={item.id} item={item} />;
                            case "divider":
                                return <Divider key={item.id} text={item.text} round={item.round} />;
                            case "idea":
                                return (
                                    <IdeaMessage
                                        key={item.id}
                                        councilId={c.id}
                                        item={item}
                                        open={threadOpen && item.id === openId}
                                        focused={item.id === focusedId}
                                        onOpen={open}
                                    />
                                );
                            case "draft":
                                return <DraftCard key={item.id} c={c} item={item} acts={acts} />;
                            case "reply":
                                return <ReplyMessage key={item.id} councilId={c.id} item={item} onOpenIdea={open} />;
                            case "skip":
                                return <SkippedLine key={item.id} item={item} onOpenTerminal={onOpenTerminal} />;
                            case "failure":
                                // the coordinator's failure has the Summary failed panel, in `notes`
                                return coordinators.has(item.author) ? null : (
                                    <FailedLine key={item.id} c={c} item={item} acts={acts} />
                                );
                            case "typing":
                                return <TypingLine key={item.id} item={item} />;
                        }
                    })}
                </Channel>
                <div className="flex-none px-8 pb-4 pt-[10px]">
                    <span id="council-channel-label" className="sr-only">
                        Message the council
                    </span>
                    <Composer
                        c={c}
                        scope="channel"
                        proposalId=""
                        placeholder="Message everyone · @ to ask one seat"
                        sendLabel="Send"
                        labelledBy="council-channel-label"
                        returnTo={() => channel.current}
                    />
                </div>
            </div>
            {/* the right panel slides in from its edge and back out (sheetPanel); the thread and the Sources it opens
                take each other's place in it without moving */}
            <AnimatePresence initial={false}>
                {thread != null || sources != null ? (
                    <motion.div
                        key="panel"
                        variants={sheetPanel}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="flex min-h-0 flex-none"
                    >
                        {thread != null ? (
                            <ThreadPanel c={c} thread={thread} acts={acts} onClose={close} />
                        ) : sources != null ? (
                            <CouncilSourcesPanel c={c} view={sources} onClose={closeSources} onOpenFile={onOpenFile} />
                        ) : null}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
