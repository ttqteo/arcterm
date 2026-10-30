// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council's discussion as a Slack-style channel with threads (Main.dc.html in the council-live-agents prototype;
// councilchatmodel.ts derives what it draws). Under the header the discussion draws (councildiscussion.tsx): a chip for
// each seat (a click on an agent's opens its terminal), then the channel: the person's question, a divider for each
// round, every idea as a message with its reply chip, the ideas and replies a seat wrote that wait for the person (amber,
// Send to the others, Edit, Drop), the line where an agent skipped a turn, a failure with Retry, and a typing row for
// whoever is at work; under it the composer, which posts to everyone, and `@` asks one seat. A click on an idea's reply
// chip, or Enter on the idea the keyboard cursor is on, opens its thread in a 400px panel on the right: the idea on top,
// then its replies with their stance pills, the replies held as drafts, and a reply box that names who will answer. j and
// k move the cursor over the ideas, Enter opens the thread and Escape closes it, while focus is inside the channel or the
// thread (buildCouncilBindings reads the cursor councilchatnav.ts publishes). Every part carries a data-council-*
// attribute for the CDP scenario `council-discussion`. The store's actions answer `{ ok, error }`; a refusal shows in the
// header (the `acts` the discussion shares).

import { buildCouncilBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import { cn } from "@/util/util";
import { atom, useAtom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { Check, CornerDownRight, X } from "lucide-react";
import {
    useCallback,
    useEffect,
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
import { answerers, draftsWaitWord, followupLabel } from "./councilmodel";
import { councilOpenProposalAtom, draftCouncil, replyCouncil, retryExpert, useEstimate } from "./councilstore";

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

/** The dot on an avatar's corner: an expert writing is green, one whose call failed red. Its word is in the avatar's
 *  title, so the colour never stands alone. */
type AvatarDot = "working" | "failed" | null;

export function CouncilAvatar({
    tone,
    name,
    small,
    dashed,
    dim,
    dot,
    title,
    className,
    ...rest
}: {
    tone: AvatarTone;
    name: string;
    small?: boolean;
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
                "relative box-border flex flex-none items-center justify-center rounded-full border-2 bg-background font-bold",
                small ? "h-[18px] w-[18px] text-[9px]" : "h-[22px] w-[22px] text-[10px]",
                dashed ? "border-dashed" : "border-solid",
                TONE_BORDER[tone],
                TONE_TEXT[tone],
                dim && "opacity-55",
                className
            )}
        >
            {initialOf(name)}
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

const PILL_TONE: Record<PillTone, string> = {
    accept: "bg-success/12 text-success-soft",
    challenge: "bg-askingbg text-warning-soft",
    oppose: "bg-error/12 text-error-soft",
    neutral: "bg-pill text-secondary",
};

export function CouncilPill({ word, tone }: { word: string; tone: PillTone }) {
    return <span className={cn("rounded-full px-[7px] py-px text-[10px] font-semibold", PILL_TONE[tone])}>{word}</span>;
}

/** The references a message cites, and a claim marked weak as its own amber chip. */
export function EvidenceChips({ evidence = [], weak = "" }: { evidence?: string[]; weak?: string }) {
    if (evidence.length === 0 && weak === "") {
        return null;
    }
    return (
        <div className="flex flex-wrap gap-[6px]">
            {evidence.map((ref, i) => (
                <span
                    key={i}
                    data-council-evidence
                    className="rounded-[6px] border border-edge-mid bg-surface px-[8px] py-[2px] text-[11px] text-secondary"
                >
                    {ref}
                </span>
            ))}
            {weak !== "" && (
                <span
                    data-council-evidence
                    data-weak="true"
                    className="rounded-[6px] border border-warning/40 bg-surface px-[8px] py-[2px] text-[11px] text-warning-soft"
                >
                    {weak}
                </span>
            )}
        </div>
    );
}

// `agent` or `expert`, beside a name; empty for the person
function KindTag({ tag }: { tag: Who["tag"] }) {
    return tag === "" ? null : (
        <span className="rounded-full bg-pill px-[6px] text-[10px] font-semibold text-secondary">{tag}</span>
    );
}

const primaryButton =
    "h-[26px] cursor-pointer rounded-[6px] border-0 bg-accent px-[10px] text-[12px] font-semibold text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const secondaryButton =
    "h-[26px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[12px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const ghostButton =
    "h-[26px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[10px] text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

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

function SeatChipView({
    c,
    chip,
    acts,
    onOpenTerminal,
}: {
    c: Council;
    chip: SeatChip;
    acts: Actions;
    onOpenTerminal: (tab: string) => void;
}) {
    const key = `retry:${chip.id}`;
    const body = (
        <>
            <CouncilAvatar tone={chip.tone} name={chip.name} small />
            <span className="flex-none font-semibold text-primary">{chip.name}</span>
            <span className="flex-none rounded-full bg-pill px-[6px] text-[10px] font-semibold text-secondary">
                {chip.kind}
            </span>
            <span aria-hidden className={cn("h-[6px] w-[6px] flex-none rounded-full", SEAT_DOT[chip.dot])} />
            <span data-council-seat-doing className="min-w-0 truncate text-muted">
                {chip.doing}
            </span>
        </>
    );
    const box =
        "flex min-w-0 items-center gap-[6px] rounded-full border border-edge-mid bg-surface py-[3px] pl-[4px] pr-[9px] text-[11px]";
    return (
        <div
            role="listitem"
            data-council-expert-chip={chip.id}
            data-lit={chip.dot === "working" || chip.dot === "waiting" ? "true" : "false"}
            data-dot={chip.dot}
            title={chip.title}
            className="flex max-w-[360px] items-center gap-[4px]"
        >
            {chip.agent ? (
                <button
                    type="button"
                    data-council-chip-open={chip.tab}
                    aria-label={`Open the terminal of ${chip.name}`}
                    onClick={() => onOpenTerminal(chip.tab)}
                    className={cn(
                        box,
                        "cursor-pointer text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                    )}
                >
                    {body}
                </button>
            ) : (
                <span className={box}>{body}</span>
            )}
            {chip.retry && (
                <button
                    type="button"
                    data-council-chip-retry={chip.id}
                    aria-label={`Retry ${chip.name}`}
                    disabled={acts.busy.has(key)}
                    onClick={() => void acts.run(key, "Retry", () => retryExpert(c.id, chip.id))}
                    className={cn(secondaryButton, "h-[22px] px-[8px] text-[11px]")}
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
        <div className="flex flex-wrap items-center gap-[7px] text-[11.5px]">
            <span className={cn("font-semibold", TONE_TEXT[who.tone])}>{who.name}</span>
            <KindTag tag={who.tag} />
            {children}
        </div>
    );
}

const Reaction = ({ text }: { text: string }) => (
    <span
        data-council-reaction
        className="inline-flex items-center gap-[5px] rounded-full bg-success/12 px-[8px] py-px text-[11px] font-semibold text-success-soft"
    >
        <Check size={10} strokeWidth={3} aria-hidden />
        {text}
    </span>
);

function IdeaMessage({
    item,
    open,
    focused,
    onOpen,
}: {
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
            className={cn(
                "flex gap-[9px] rounded-[8px] px-[10px] py-[8px]",
                open && "bg-surface-selected",
                focused && "ring-1 ring-edge-strong"
            )}
        >
            <CouncilAvatar tone={item.tone} name={item.name} />
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <Byline who={item}>
                    {item.wild ? (
                        <CouncilPill word={item.label} tone="neutral" />
                    ) : (
                        <span className="text-muted">{item.label}</span>
                    )}
                    <span className="tabular-nums text-muted">{item.at}</span>
                    {item.edited && <span className="text-muted">edited</span>}
                </Byline>
                <h3 className="m-0 text-[13.5px] font-semibold leading-[1.35] text-primary">{item.title}</h3>
                <span className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-ink-hi">
                    {item.text}
                </span>
                <EvidenceChips evidence={item.evidence} weak={item.weak} />
                <div className="flex flex-wrap items-center gap-[10px]">
                    <button
                        type="button"
                        data-council-thread-open={item.id}
                        data-replies={t.count}
                        aria-label={`Open the thread: ${t.label}`}
                        onClick={() => onOpen(item.id)}
                        className="-ml-[6px] inline-flex h-[26px] cursor-pointer items-center gap-[8px] rounded-[6px] border border-transparent bg-transparent pl-[6px] pr-[8px] text-[11.5px] outline-none hover:border-edge-mid hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        {t.repliers.length > 0 && (
                            <span className="flex">
                                {t.repliers.map((w, i) => (
                                    <CouncilAvatar
                                        key={w.author}
                                        tone={w.tone}
                                        name={w.name}
                                        small
                                        data-council-replier={w.author}
                                        className={i > 0 ? "-ml-[5px]" : undefined}
                                    />
                                ))}
                            </span>
                        )}
                        <span className="font-semibold text-accent">{t.label}</span>
                        {t.last !== "" && <span className="text-muted">{t.last}</span>}
                        {t.drafts > 0 && <span className="text-warning-soft">{draftsWaitWord(t.drafts)}</span>}
                    </button>
                    {item.agrees.map((text, i) => (
                        <Reaction key={i} text={text} />
                    ))}
                    {item.picks != null && (
                        <span
                            data-council-picks
                            title={item.picks.title}
                            className="rounded-full bg-pill px-[8px] py-px text-[11px] font-semibold text-secondary"
                        >
                            {item.picks.label}
                        </span>
                    )}
                </div>
            </div>
        </article>
    );
}

// the pill and the time beside a reply's author
function ReplyHeader({ item }: { item: ReplyPost }) {
    return (
        <Byline who={item}>
            <CouncilPill word={item.label} tone={item.pill} />
            <span className="tabular-nums text-muted">{item.at}</span>
            {item.edited && <span className="text-muted">edited</span>}
            {item.reaches !== "" && <span className="text-muted">{item.reaches}</span>}
            {item.pending !== "" && <span className="text-muted">{item.pending}</span>}
        </Byline>
    );
}

function ReplyMessage({ item, inThread }: { item: ReplyPost; inThread?: boolean }) {
    return (
        <article
            data-council-item
            data-item-kind="reply"
            data-council-reply-post={item.id}
            data-item-label={item.label}
            data-item-mine={item.mine ? "true" : undefined}
            data-in-thread={inThread ? "true" : undefined}
            className={cn("flex gap-[9px] rounded-[8px] px-[10px] py-[8px]", item.mine && "bg-surface-raised")}
        >
            <CouncilAvatar tone={item.tone} name={item.name} />
            <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                <ReplyHeader item={item} />
                <span className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-ink-hi">
                    {item.text}
                </span>
                <EvidenceChips evidence={item.evidence} weak={item.weak} />
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
            className="flex gap-[9px] rounded-[8px] bg-askingbg px-[10px] py-[8px]"
        >
            <CouncilAvatar tone={item.tone} name={item.name} />
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <Byline who={item}>
                    <span className="inline-flex items-center gap-[5px] font-semibold text-warning-soft">
                        <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-asking" />
                        {DRAFT_WAIT}
                    </span>
                    {item.of === "reply" && <CouncilPill word={item.label} tone={item.pill} />}
                    {item.edited && <span className="text-muted">edited</span>}
                    {item.on !== "" && (
                        <span className="flex min-w-0 items-center gap-[5px] text-[11px] text-muted">
                            <CornerDownRight size={11} aria-hidden className="flex-none" />
                            <span className="min-w-0 truncate">{item.on}</span>
                        </span>
                    )}
                </Byline>
                {item.title !== "" && (
                    <h3 className="m-0 text-[13.5px] font-semibold leading-[1.35] text-primary">{item.title}</h3>
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
                            className="box-border w-full resize-none rounded-[6px] border border-edge-strong bg-surface px-[10px] py-[8px] text-[12.5px] leading-[1.5] text-primary outline-none focus:border-accent"
                        />
                        {item.revised && (
                            <span className="text-[11px] text-muted">
                                Edit changes only this line. The new title and argument apply as written.
                            </span>
                        )}
                    </>
                ) : (
                    <span className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-ink-hi">
                        {item.text}
                    </span>
                )}
                <EvidenceChips evidence={item.evidence} weak={item.weak} />
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
            className="flex items-center gap-[10px] px-[10px] py-[6px] text-[11.5px] text-muted"
        >
            <span aria-hidden className="h-px flex-1 bg-edge-faint" />
            <span>{text}</span>
            <span aria-hidden className="h-px flex-1 bg-edge-faint" />
        </div>
    );
}

function QuestionMessage({ item }: { item: Extract<ChannelItem, { kind: "question" }> }) {
    return (
        <article
            data-council-item
            data-item-kind="question"
            className="flex gap-[9px] rounded-[8px] bg-surface-raised px-[10px] py-[8px]"
        >
            <CouncilAvatar tone={item.tone} name={item.name} />
            <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                <Byline who={item}>
                    <span className="text-muted">{item.label}</span>
                    {item.at !== "" && <span className="tabular-nums text-muted">{item.at}</span>}
                </Byline>
                <span className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-ink-hi">
                    {item.text}
                </span>
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
            className="flex flex-wrap items-center gap-[9px] px-[10px] py-[6px] text-[12px] text-muted"
        >
            <CouncilAvatar tone={item.tone} name={item.name} small dim />
            <span>
                {rest === item.text ? null : <span className="font-semibold text-secondary">{item.name}</span>}
                {rest}
            </span>
            {item.tab !== "" && (
                <button
                    type="button"
                    data-council-open-terminal={item.tab}
                    onClick={() => onOpenTerminal(item.tab)}
                    className="h-[22px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[8px] text-[11px] font-semibold text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
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
            className="flex flex-wrap items-center gap-[9px] px-[10px] py-[6px] text-[12px]"
        >
            <CouncilAvatar tone={item.tone} name={item.name} small dot="failed" />
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
                className={cn(secondaryButton, "h-[22px] px-[8px] text-[11px]")}
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
            <CouncilAvatar tone={item.tone} name={item.name} dashed />
            <span data-council-typing className="text-[12px] text-muted">
                {item.text}
            </span>
            {item.on !== "" && (
                <span className="flex min-w-0 items-center gap-[5px] text-[11px] text-muted">
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
                                "flex cursor-pointer items-center gap-[8px] rounded-[6px] px-[8px] py-[5px] text-[12px]",
                                i === pick ? "bg-surface-hover text-primary" : "text-secondary"
                            )}
                        >
                            <span className="font-semibold">{s.name}</span>
                            <span className="text-[11px] text-muted">{s.agent ? "agent" : "expert"}</span>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex items-end gap-[8px] rounded-[10px] border border-edge-mid bg-surface py-[8px] pl-[12px] pr-[8px] focus-within:border-accent">
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
                    className="box-border min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted"
                />
                <button
                    type="button"
                    data-council-composer-send
                    disabled={text.trim() === "" || busy}
                    onClick={() => void send()}
                    title="Send (Enter)"
                    className={cn(primaryButton, "h-[30px] px-[14px] text-[12.5px]")}
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
                    className="flex w-fit cursor-pointer items-center gap-[7px] rounded-[6px] border-0 bg-transparent py-px text-[11.5px] text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            <span data-council-composer-hint className="min-w-0 text-[11px] tabular-nums text-muted">
                {hint}
            </span>
            {error != null && (
                <span role="alert" data-council-composer-error className="text-[11.5px] text-error-soft">
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
    return (
        <aside
            data-council-thread={idea.id}
            tabIndex={-1}
            aria-label="Thread"
            className="flex min-h-0 w-[400px] flex-none flex-col border-l border-edge-faint bg-surface outline-none"
        >
            <div className="flex flex-none items-center gap-[8px] border-b border-edge-faint px-4 py-[12px]">
                <span className="text-[13px] font-semibold">Thread</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{idea.title}</span>
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
            <div className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2 py-[10px]">
                <article
                    data-council-post={idea.id}
                    className="flex gap-[9px] border-b border-edge-faint px-[8px] pb-[12px] pt-[8px]"
                >
                    <CouncilAvatar tone={idea.tone} name={idea.name} />
                    <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                        <Byline who={idea}>
                            <span className="tabular-nums text-muted">{idea.at}</span>
                            {idea.edited && <span className="text-muted">edited</span>}
                        </Byline>
                        <h2
                            data-council-post-title
                            className="m-0 text-[13px] font-semibold leading-[1.35] text-primary"
                        >
                            {idea.title}
                        </h2>
                        <span className="whitespace-pre-wrap break-words text-[12px] leading-[1.5] text-ink-hi">
                            {idea.text}
                        </span>
                        <EvidenceChips evidence={idea.evidence} weak={idea.weak} />
                        {idea.agrees.length > 0 && (
                            <div className="flex flex-wrap gap-[6px]">
                                {idea.agrees.map((text, i) => (
                                    <Reaction key={i} text={text} />
                                ))}
                            </div>
                        )}
                    </div>
                </article>
                <div data-council-thread-count className="px-[8px] py-[6px] text-[11.5px] text-muted">
                    {idea.thread.label}
                </div>
                {thread.items.map((item: ThreadItem) =>
                    item.kind === "reply" ? (
                        <ReplyMessage key={item.id} item={item} inThread />
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

const NEAR_BOTTOM_PX = 80;

// the channel, scrolled to its newest line while the reader is at the bottom of it
function Channel({
    children,
    count,
    boxRef,
}: {
    children: ReactNode;
    count: number;
    boxRef: RefObject<HTMLDivElement | null>;
}) {
    const atBottom = useRef(true);
    useEffect(() => {
        const el = boxRef.current;
        if (el != null && atBottom.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [count, boxRef]);
    return (
        <div
            ref={boxRef}
            data-council-channel
            tabIndex={0}
            role="log"
            aria-label="Council channel"
            onScroll={(e) => {
                const el = e.currentTarget;
                atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
            }}
            className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-[22px] py-[10px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-edge-strong"
        >
            {children}
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
}: {
    c: Council;
    acts: Actions;
    notes?: ReactNode;
    onOpenTerminal: (tab: string) => void;
}) {
    const [openId, setOpenId] = useAtom(councilOpenProposalAtom(c.id));
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const channel = useRef<HTMLDivElement>(null);
    const thread = openId == null ? null : councilThread(c, openId);
    const threadOpen = thread != null;
    // an idea that is gone (the id of another council, a dropped idea) closes the panel
    useEffect(() => {
        if (openId != null && !threadOpen) {
            setOpenId(null);
        }
    }, [openId, threadOpen, setOpenId]);

    const items = useMemo(() => councilChannel(c), [c]);
    const seats = useMemo(() => seatChips(c), [c]);
    const order = useMemo(() => ideaOrder(c), [c]);
    const open = useCallback(
        (id: string) => {
            setOpenId(id);
            setFocusedId(id);
        },
        [setOpenId]
    );
    const close = useCallback(() => setOpenId(null), [setOpenId]);
    const nav = useMemo<CouncilChatNav>(
        () => ({ order, focusedId, openId: threadOpen ? openId : null, focus: setFocusedId, open, close }),
        [order, focusedId, openId, threadOpen, open, close]
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
                    aria-label="Seats"
                    className="flex flex-none flex-wrap gap-[6px] border-b border-edge-faint px-8 py-[10px]"
                >
                    {seats.map((chip) => (
                        <SeatChipView key={chip.id} c={c} chip={chip} acts={acts} onOpenTerminal={onOpenTerminal} />
                    ))}
                </div>
                {notes}
                <Channel boxRef={channel} count={items.length}>
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
                                        item={item}
                                        open={threadOpen && item.id === openId}
                                        focused={item.id === focusedId}
                                        onOpen={open}
                                    />
                                );
                            case "draft":
                                return <DraftCard key={item.id} c={c} item={item} acts={acts} />;
                            case "reply":
                                return <ReplyMessage key={item.id} item={item} />;
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
            {thread != null && <ThreadPanel c={c} thread={thread} acts={acts} onClose={close} />}
        </div>
    );
}
