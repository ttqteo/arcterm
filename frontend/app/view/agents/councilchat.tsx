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
// under it the composer, which posts to everyone, and `@` lists the seats (a pick asks that one), the project's files
// (a pick names the file; the seats that answer read it) and the live claude and pi chats no seat holds under Add a live
// chat (a pick puts its mention key in the message; Send seats the chats the text still names and posts the message to
// them); an image pasted or dropped into the box waits above the text as a chip and goes with the message, and the
// person's own message shows its images as thumbnails and each `@file` as a chip. A click on an idea's reply chip, or Enter on
// the idea the keyboard cursor is on, slides its thread in from the right (sheetPanel): the idea on top, then its
// replies with their stance pills, the replies held as drafts, and a reply box that names who will answer. j and k move
// the cursor over the ideas, Enter opens the thread and Escape closes it, while focus is inside the channel or the
// thread (buildCouncilBindings reads the cursor councilchatnav.ts publishes). A message's evidence is a link per cited
// file (councilsourcespanel.tsx): a click opens the Sources panel in the thread's place, and Escape or its close button
// goes back to the thread it was opened from. Every part carries a data-council-* attribute for the CDP scenario
// `council-discussion`. The store's actions answer `{ ok, error }`; a refusal shows in the header (the `acts` the
// discussion shares).

import { computeEntrances, initialEntranceState, sentRise, sheetPanel } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { buildCouncilBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import { reloadFileIndex } from "@/app/view/code/codestore";
import { cn } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Check, ChevronDown, ChevronUp, CornerDownRight, FileText, Loader2, Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ClipboardEvent,
    type DragEvent,
    type KeyboardEvent,
    type ReactNode,
    type RefObject,
} from "react";
import type { Actions } from "./councilactions";
import {
    DRAFT_WAIT,
    askChips,
    contextLabel,
    councilChannel,
    councilThread,
    ideaOrder,
    insertChatMention,
    insertFileMention,
    insertMention,
    mentionPicker,
    messageSegments,
    onlyLine,
    pickedChats,
    pickerRows,
    readsFiles,
    replyReach,
    seatChips,
    type AskChip,
    type ChannelItem,
    type ChatPick,
    type ChatThread,
    type DraftPost,
    type FailureLine,
    type IdeaPost,
    type PillTone,
    type ReplyPost,
    type SkipLine,
    type ThreadItem,
    type TypingRow,
    type Who,
} from "./councilchatmodel";
import { useCouncilChatNav, type CouncilChatNav } from "./councilchatnav";
import { initialOf, isFollowUp, type AvatarTone } from "./councildiscussionmodel";
import { markSpans } from "./councilmarks";
import { answerers, councilProjectName, draftsWaitWord, followupLabel, type SeatableAgent } from "./councilmodel";
import { offersRetryAll, retryAllModels, retryAllSeats } from "./councilretry";
import { RetryModelPick, RetryWithButton } from "./councilretrymenu";
import {
    NO_PILLS,
    followsEnd,
    glideAt,
    glideMs,
    jumpPills,
    keepPlace,
    keptPlace,
    placeOf,
    readingRow,
    returnTop,
    stillLanded,
    topFor,
    type JumpPills,
    type Landing,
    type ReadingPlace,
    type RowBox,
    type ScrollPlace,
} from "./councilscroll";
import { basename } from "./councilsetupmodel";
import { CouncilSourcesPanel, EvidenceChips } from "./councilsourcespanel";
import {
    addCouncilImages,
    clearCouncilImages,
    closeCouncilSources,
    councilChatDraftAtom,
    councilOnlyAtom,
    councilOpenProposalAtom,
    councilSourcesAtom,
    draftCouncil,
    openCouncilSources,
    removeCouncilImage,
    replyCouncil,
    retryAllExperts,
    retryExpert,
    useEstimate,
} from "./councilstore";
import { imageFilesOf, imagesPending, type TaskImage } from "./launcherimages";
import { MarkdownMessage } from "./markdownmessage";
import { PromptImages } from "./narrationtimeline";
import { projectsAtom } from "./projectsstore";

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
    dotClassName,
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
    /** the dot's ring when the avatar sits on another ground than the page's (a tree row's fill) */
    dotClassName?: string;
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
                        dot === "working" ? "bg-working pulse-dot" : "bg-error",
                        dotClassName
                    )}
                />
            )}
        </span>
    );
}

/** What a seat wrote, as a message: Markdown, so the table, list or ```mermaid diagram the prompts ask for when one
 *  reads better than prose (visualRule in pkg/council/prompts.go) draws as one, its must-read sentence (==…==)
 *  highlighted. A line break stays a line break, as the plain text it replaces kept it. `className` sets its size. */
export function CouncilText({ text, className }: { text: string; className?: string }) {
    return (
        <MarkdownMessage
            text={text}
            marks
            diagrams
            className={cn(
                "min-w-0 break-words text-ink-hi [&_p]:whitespace-pre-wrap [&_.mermaid]:my-2 [&_.mermaid_svg]:max-w-full",
                className
            )}
        />
    );
}

/** What a seat wrote as plain text, for a place too small for a table or a diagram (a cell of the Summary's matrix),
 *  its must-read sentence (==…==, councilmarks.ts) highlighted as CouncilText draws it. */
export function MarkedText({ text }: { text: string }) {
    const spans = useMemo(() => markSpans(text), [text]);
    return (
        <>
            {spans.map((span, i) =>
                span.mark ? (
                    <mark key={i} data-council-mark className="rounded-[2px] bg-warning/25 px-px text-inherit">
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
                    {/* no title: a chat message has none, and its first sentence says the idea; the title names it where
                        it is quoted (a reply's ↳, the thread's header, the report) */}
                    <CouncilText text={item.text} className="text-[14.5px] leading-[1.6]" />
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

// a file the person named with `@path`, in place of the `@path`: a click opens it in the Sources panel, as a link under a
// seat's message opens a file it cites
const FILE_CHIP =
    "mx-[1px] inline-flex h-[22px] max-w-full cursor-pointer items-center gap-[4px] rounded-[6px] border border-edge-mid bg-surface px-[6px] align-middle text-[12.5px] outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent";

function FileMentionChip({ councilId, owner, path }: { councilId: string; owner: string; path: string }) {
    const name =
        path
            .split("/")
            .filter((s) => s !== "")
            .pop() ?? path;
    return (
        <button
            type="button"
            data-council-file-chip={path}
            title={path}
            onClick={() => openCouncilSources(councilId, { owner, title: "Your message", refs: [path], pick: 0 })}
            className={cn(FILE_CHIP, "group")}
        >
            <FileText size={12} className="flex-none text-muted" aria-hidden />
            <span className="min-w-0 truncate font-medium text-link underline-offset-2 group-hover:underline">
                {name}
            </span>
        </button>
    );
}

// the person's own message: Markdown like a seat's, except one that names files, which is cut at them so each `@path` is
// a chip in the line (a chip cannot sit inside a Markdown paragraph)
function PersonText({ councilId, item }: { councilId: string; item: ReplyPost }) {
    const parts = useMemo(() => messageSegments(item.text), [item.text]);
    if (!parts.some((p) => p.kind === "file")) {
        return <CouncilText text={item.text} className="text-[14px] leading-[1.6]" />;
    }
    return (
        <p className="m-0 min-w-0 whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-ink-hi">
            {parts.map((p, i) =>
                p.kind === "text" ? (
                    <span key={i}>{p.text}</span>
                ) : (
                    <FileMentionChip key={i} councilId={councilId} owner={item.id} path={p.path} />
                )
            )}
        </p>
    );
}

function ReplyMessage({
    councilId,
    item,
    inThread,
    onOpenIdea,
    rise,
}: {
    councilId: string;
    item: ReplyPost;
    inThread?: boolean;
    onOpenIdea?: (id: string) => void;
    rise?: boolean; // the person's post that just arrived: it rises in from the composer (sentRise)
}) {
    return (
        <motion.article
            data-council-item
            data-item-kind="reply"
            data-council-reply-post={item.id}
            data-item-label={item.label}
            data-item-mine={item.mine ? "true" : undefined}
            data-in-thread={inThread ? "true" : undefined}
            variants={sentRise}
            initial={rise ? "initial" : false}
            animate="animate"
            style={{ transformOrigin: "bottom right" }}
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
                    {item.mine ? (
                        <PersonText councilId={councilId} item={item} />
                    ) : (
                        <CouncilText text={item.text} className="text-[14px] leading-[1.6]" />
                    )}
                    {item.attachments.length > 0 && (
                        // the paths stay out of the text: the images show as thumbnails, a click opens one full size
                        <PromptImages paths={item.attachments} />
                    )}
                    <EvidenceChips
                        evidence={item.evidence}
                        weak={item.weak}
                        source={{ councilId, owner: item.id, title: `${item.name}'s reply` }}
                    />
                </div>
                {item.agrees.length > 0 && (
                    <div className="flex flex-wrap items-center gap-[6px]">
                        {item.agrees.map((text, i) => (
                            <Reaction key={i} text={text} />
                        ))}
                    </div>
                )}
            </div>
        </motion.article>
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
                    <CouncilText text={item.text} className="text-[13.5px] leading-[1.5]" />
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
    const running = c.state === "running"; // a retry while it runs is refused: one job at a time
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
                disabled={running || acts.busy.has(key)}
                title={running ? "The council is running: retry once it is done" : undefined}
                onClick={() => void acts.run(key, "Retry", () => retryExpert(c.id, item.author))}
                className={cn(secondaryButton, "h-[22px] px-[8px] text-[12px]")}
            >
                {acts.busy.has(key) ? "Retrying…" : "Retry"}
            </button>
            <RetryWithButton
                expert={c.experts.find((e) => e.id === item.author)}
                error={c.failed?.[item.author]?.error}
                disabled={running || acts.busy.has(key)}
                onPick={(model) => void acts.run(key, "Retry", () => retryExpert(c.id, item.author, model))}
                className={cn(secondaryButton, "h-[22px] px-[6px] text-[12px]")}
            />
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

// an OS file drag; the webview's own drag-drop is off, so a file dropped unhandled would navigate it to the file
const dragHasFiles = (dt: DataTransfer | null) => Array.from(dt?.types ?? []).includes("Files");

// whether the caret sits right after an `@` that is not inside a word (councilchatmodel.ts's MENTION), the moment the
// project's files are worth listing
const AT_OPEN = /(^|[^\p{L}\p{N}_])@[^@\n]{0,200}$/u;
const mentionOpen = (text: string, caret: number) => AT_OPEN.test(text.slice(0, caret));

const NO_FILES: readonly string[] = [];

// The project's files for the `@` list, read when the first `@` opens in this box (and again for another project): there
// is no watcher, and an agent creates files while the council runs. A failed listing leaves the Files group empty, logged.
function useProjectFiles(project: string, wanted: boolean): readonly string[] {
    const [listing, setListing] = useState<{ project: string; paths: string[] } | null>(null);
    const asked = useRef<string | null>(null);
    useEffect(() => {
        if (!wanted || project === "" || asked.current === project) {
            return;
        }
        asked.current = project;
        reloadFileIndex(project).then(
            (idx) => setListing({ project, paths: idx.paths }),
            (err) => {
                console.error(`listing the files of ${project} for the council's @ failed`, err);
                setListing({ project, paths: [] });
            }
        );
    }, [wanted, project]);
    return listing?.project === project ? listing.paths : NO_FILES;
}

// the images waiting in a box, above its text: a thumbnail each with an x, a spinner while the file is written and the
// reason under the row when it failed
function DraftImages({ councilId, boxKey, images }: { councilId: string; boxKey: string; images: TaskImage[] }) {
    if (images.length === 0) {
        return null;
    }
    return (
        <div data-council-images className="flex flex-col gap-[4px] pt-[2px]">
            <div className="flex flex-wrap gap-[8px]">
                {images.map((img) => {
                    const state = img.error != null ? "error" : img.path != null ? "ready" : "pending";
                    return (
                        <div
                            key={img.id}
                            data-council-image
                            data-council-image-state={state}
                            className="relative h-[48px] w-[48px] shrink-0"
                        >
                            <img
                                src={img.previewUrl}
                                alt=""
                                className={cn(
                                    "h-full w-full rounded-[8px] border object-cover",
                                    state === "error" ? "border-warning" : "border-edge-mid"
                                )}
                            />
                            {state === "pending" && (
                                <span
                                    data-council-image-spinner
                                    className="absolute inset-0 flex items-center justify-center rounded-[8px] bg-background/60"
                                >
                                    <Loader2
                                        size={14}
                                        className="animate-spin text-primary motion-reduce:animate-none"
                                    />
                                </span>
                            )}
                            <button
                                type="button"
                                data-council-image-remove
                                tabIndex={-1}
                                aria-label="Remove image"
                                onClick={() => removeCouncilImage(councilId, boxKey, img.id)}
                                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-edge-mid bg-surface text-muted hover:text-primary"
                            >
                                <X size={10} strokeWidth={2.4} />
                            </button>
                        </div>
                    );
                })}
            </div>
            {images.map((img) =>
                img.error != null ? (
                    <span key={img.id} role="alert" data-council-image-error className="text-[12px] text-warning">
                        {img.error}
                    </span>
                ) : null
            )}
        </div>
    );
}

function Composer({
    c,
    scope,
    proposalId,
    placeholder,
    sendLabel,
    labelledBy,
    returnTo,
    chats,
}: {
    c: Council;
    scope: "channel" | "thread";
    proposalId: string; // the idea a thread's reply answers; empty for the channel (the whole council)
    placeholder: string;
    sendLabel: string;
    labelledBy: string;
    returnTo: () => HTMLElement | null;
    chats: readonly SeatableAgent[]; // the live chats `@` lists under Add a live chat (the ones no seat holds)
}) {
    const [drafts, setDrafts] = useAtom(councilChatDraftAtom(c.id));
    const text = drafts.texts[proposalId] ?? "";
    const setText = (t: string) => setDrafts((d) => ({ ...d, texts: { ...d.texts, [proposalId]: t } }));
    const box = useRef<HTMLTextAreaElement>(null);
    const list = useRef<HTMLUListElement>(null);
    const projects = useAtomValue(projectsAtom);
    const [caret, setCaret] = useState(0);
    const [pick, setPick] = useState(0);
    const [dismissed, setDismissed] = useState(-1);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // the images pasted or dropped into this box: a chip each, its file written to ~/.arc/attachments
    const images = drafts.images[proposalId] ?? [];
    const readyPaths = images.flatMap((i) => (i.path != null && i.error == null ? [i.path] : []));
    // a failed image is not attached, so it does not lock the switch; one still uploading is, and holds Send
    const attached = images.filter((i) => i.error == null).length;
    const uploading = imagesPending(images);
    const files = useProjectFiles(c.project, mentionOpen(text, caret));

    const found = mentionPicker(c, text, caret, chats, files);
    const picker = found != null && found.start !== dismissed ? found : null;
    // the chats this message adds: the ones whose `@<key>` is still in the text, so deleting it drops the pick
    const joining = pickedChats(c, text, chats);
    const who = answerers(c, proposalId, "", text, joining);
    const followUp = isFollowUp(c);
    const k = followUp ? who.length : 0;
    // a chat answerer (seated, or joining) is priced at its context, a role expert at the flat price
    const chatTabs = who.flatMap((e) => (e.agent ? [e.agent] : []));
    const experts = who.length - chatTabs.length;
    const reads = readsFiles(drafts.tools, text, attached);
    const est = useEstimate(
        k > 0
            ? {
                  id: c.id,
                  followup: experts > 0 ? experts : undefined,
                  agents: chatTabs.length > 0 ? chatTabs : undefined,
                  tools: reads.on,
              }
            : null
    );
    const hint =
        k > 0
            ? followupLabel(est, experts, reads.on, chatTabs.length)
            : replyReach(c, proposalId, "", text, joining).label;
    // the picker's rows are one list for the arrow keys: the seats, the files, then the chats
    const pickRows = picker == null ? [] : pickerRows(picker);
    const rowCount = pickRows.length;

    // the row the arrow keys moved to stays in view of a list that scrolls
    useEffect(() => {
        list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
    }, [pick, rowCount]);

    const send = async () => {
        const body = text.trim();
        if (body === "" || busy || uploading) {
            return;
        }
        setBusy(true);
        setError(null);
        const r = await replyCouncil({
            id: c.id,
            proposalid: proposalId || undefined,
            text: body,
            // an image or an @file is read by the seats that answer it, in a round as in a follow-up
            tools: reads.on ? true : undefined,
            attachments: readyPaths.length > 0 ? readyPaths : undefined,
            agents: joining.length > 0 ? joining.map((a) => a.id) : undefined,
        });
        setBusy(false);
        if (r.ok === false) {
            setError(r.error);
        } else {
            // the next question decides for itself whether the seats read files
            setDrafts((d) => ({ ...d, texts: { ...d.texts, [proposalId]: "" }, tools: null }));
            clearCouncilImages(c.id, proposalId);
        }
    };
    // a seat is put in by its name, a chat by its mention key (`@82faafca`), the word wavesrv reaches its seat by
    const put = (next: { text: string; caret: number }) => {
        setText(next.text);
        setCaret(next.caret);
        setPick(0);
        requestAnimationFrame(() => {
            box.current?.focus();
            box.current?.setSelectionRange(next.caret, next.caret);
        });
    };
    const chooseSeat = (seat: CouncilExpert) => {
        if (picker != null) {
            put(insertMention(text, picker.start, caret, seat));
        }
    };
    const chooseChat = (chat: ChatPick) => {
        if (picker != null) {
            put(insertChatMention(text, picker.start, caret, chat.key));
        }
    };
    // a file is put in by its path relative to the project: `@src/a.ts `
    const chooseFile = (path: string) => {
        if (picker != null) {
            put(insertFileMention(text, picker.start, caret, path));
        }
    };
    // the row the keys are on, counted across the seats, the files and then the chats
    const active = Math.min(pick, Math.max(rowCount - 1, 0));
    const chooseRow = (i: number) => {
        const row = pickRows[i];
        if (row?.kind === "seat") {
            chooseSeat(row.seat);
        } else if (row?.kind === "file") {
            chooseFile(row.path);
        } else if (row?.kind === "chat") {
            chooseChat(row.chat);
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) {
            return;
        }
        if (picker != null) {
            const n = rowCount;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (Math.min(p, n - 1) + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                chooseRow(active);
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
    // a paste that carries images takes them (and inserts any text beside them); a paste of text is the browser's
    const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
        const pasted = imageFilesOf(e.clipboardData?.files);
        if (pasted.length === 0) {
            return;
        }
        e.preventDefault();
        addCouncilImages(c.id, proposalId, pasted, "paste");
        const beside = e.clipboardData.getData("text/plain");
        if (beside !== "") {
            const el = e.currentTarget;
            el.setRangeText(beside, el.selectionStart, el.selectionEnd, "end");
            setText(el.value);
            setCaret(el.selectionStart);
        }
    };
    // the webview's own drag-drop is off, so a file dropped unhandled would navigate it to the file: any drag that holds
    // files is taken here, and only its images are kept
    const onDragOver = (e: DragEvent<HTMLElement>) => {
        if (dragHasFiles(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        }
    };
    const onDrop = (e: DragEvent<HTMLElement>) => {
        if (!dragHasFiles(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        const dropped = imageFilesOf(e.dataTransfer.files);
        if (dropped.length > 0) {
            addCouncilImages(c.id, proposalId, dropped, "drop");
        }
    };
    const rows = Math.min(5, Math.max(1, text.split("\n").length));
    const seatsEnd = picker?.seats.length ?? 0;
    const filesEnd = seatsEnd + (picker?.files.length ?? 0);
    const groups = picker == null ? 0 : [picker.seats, picker.files, picker.chats].filter((g) => g.length > 0).length;

    return (
        <div
            data-council-composer={scope}
            data-composer-for={proposalId}
            onDragOver={onDragOver}
            onDrop={onDrop}
            className="relative flex flex-col gap-[6px]"
        >
            {picker != null && (
                <ul
                    ref={list}
                    role="listbox"
                    data-council-mentions
                    aria-label={
                        groups > 1
                            ? "Ask a seat, name a file or add a chat"
                            : picker.files.length > 0
                              ? "Files"
                              : "Seats"
                    }
                    className={cn(
                        "absolute bottom-full left-0 z-10 m-0 mb-[4px] flex max-h-[280px] min-w-[220px] list-none flex-col overflow-y-auto rounded-[8px] border border-edge-strong bg-surface-raised p-[4px]",
                        (picker.chats.length > 0 || picker.files.length > 0) && "w-[460px] max-w-full"
                    )}
                >
                    {picker.seats.length > 0 && groups > 1 && (
                        <li role="presentation" className="px-[8px] pb-[2px] pt-[4px] text-[12px] text-muted">
                            Seats
                        </li>
                    )}
                    {picker.seats.map((s, i) => (
                        <li
                            key={s.id}
                            role="option"
                            aria-selected={i === active}
                            data-selected={i === active}
                            data-council-mention={s.id}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                chooseSeat(s);
                            }}
                            className={cn(
                                "flex cursor-pointer items-center gap-[8px] rounded-[6px] px-[8px] py-[5px] text-[13px]",
                                i === active ? "bg-surface-hover text-primary" : "text-secondary"
                            )}
                        >
                            <span className="font-semibold">{s.name}</span>
                            <span className="text-[12px] text-muted">{s.agent ? "agent" : "expert"}</span>
                        </li>
                    ))}
                    {picker.files.length > 0 && (
                        <li
                            role="presentation"
                            data-council-files
                            className={cn(
                                "flex flex-col",
                                picker.seats.length > 0 && "mt-[4px] border-t border-edge-mid pt-[4px]"
                            )}
                        >
                            <span
                                data-council-files-heading
                                className="px-[8px] pb-[2px] pt-[2px] text-[12px] text-muted"
                            >
                                Files
                            </span>
                            <ul role="group" aria-label="Files" className="m-0 flex list-none flex-col p-0">
                                {picker.files.map((path, j) => {
                                    const i = seatsEnd + j;
                                    const slash = path.lastIndexOf("/");
                                    return (
                                        <li
                                            key={path}
                                            role="option"
                                            aria-selected={i === active}
                                            data-selected={i === active}
                                            data-council-file-row={path}
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                chooseFile(path);
                                            }}
                                            className={cn(
                                                "flex cursor-pointer items-center gap-[8px] rounded-[6px] px-[8px] py-[5px] text-[13px]",
                                                i === active ? "bg-surface-hover text-primary" : "text-secondary"
                                            )}
                                        >
                                            <FileText size={14} aria-hidden className="flex-none text-muted" />
                                            <span className="min-w-0 truncate">
                                                <span className="font-semibold">{path.slice(slash + 1)}</span>
                                                {slash >= 0 && (
                                                    <span className="text-[12px] text-muted">
                                                        {" "}
                                                        {path.slice(0, slash)}
                                                    </span>
                                                )}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </li>
                    )}
                    {picker.chats.length > 0 && (
                        <li
                            role="presentation"
                            data-council-add-chat
                            className={cn(
                                "flex flex-col",
                                picker.seats.length + picker.files.length > 0 &&
                                    "mt-[4px] border-t border-edge-mid pt-[4px]"
                            )}
                        >
                            <span className="px-[8px] pb-[2px] pt-[2px] text-[12px] text-muted">
                                Add a live chat · it joins and answers this message
                            </span>
                            <ul role="group" aria-label="Add a live chat" className="m-0 flex list-none flex-col p-0">
                                {picker.chats.map((p, j) => {
                                    const i = filesEnd + j;
                                    const meta = [
                                        p.chat.harness,
                                        councilProjectName(projects, p.chat.project) ?? basename(p.chat.project),
                                        p.chat.context > 0 ? contextLabel(p.chat.context) : "",
                                    ].filter((part) => part !== "");
                                    return (
                                        <li
                                            key={p.chat.id}
                                            role="option"
                                            aria-selected={i === active}
                                            data-selected={i === active}
                                            data-council-chat-row={p.chat.id}
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                chooseChat(p);
                                            }}
                                            className={cn(
                                                "flex cursor-pointer items-center gap-[10px] rounded-[6px] px-[8px] py-[6px] text-[13px]",
                                                i === active ? "bg-surface-hover text-primary" : "text-secondary"
                                            )}
                                        >
                                            <Plus
                                                size={14}
                                                strokeWidth={1.8}
                                                aria-hidden
                                                className="flex-none text-muted"
                                            />
                                            <span
                                                data-council-chat-key
                                                className="min-w-[70px] flex-none font-mono text-[12px] text-secondary"
                                            >
                                                {p.key}
                                            </span>
                                            <span data-council-chat-name className="min-w-0 flex-1 truncate">
                                                {p.chat.name}
                                            </span>
                                            <span data-council-chat-meta className="flex-none text-[12px] text-muted">
                                                {meta.join(" · ")}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </li>
                    )}
                </ul>
            )}
            <div className="flex flex-col gap-[8px] rounded-[14px] border border-edge-mid bg-surface py-[8px] pl-[14px] pr-[8px] focus-within:border-accent">
                <DraftImages councilId={c.id} boxKey={proposalId} images={images} />
                <div className="flex items-end gap-[8px]">
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
                        onPaste={onPaste}
                        className={cn(
                            // a line (21px) padded to the Send button's 30px, so one line sits level with its label
                            // and not at the foot of the row; more lines grow above the button, which stays at the foot
                            "box-border min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-[4.5px] text-[14px] leading-[1.5] text-primary outline-none placeholder:text-muted",
                            rows < 5 ? "overflow-hidden" : "overflow-y-auto"
                        )}
                    />
                    <button
                        type="button"
                        data-council-composer-send
                        disabled={text.trim() === "" || busy || uploading}
                        onClick={() => void send()}
                        title={uploading ? "Waiting for an image to finish uploading" : "Send (Enter)"}
                        className={cn(primaryButton, "h-[30px] px-[14px] text-[13.5px]")}
                    >
                        {busy ? "Sending…" : sendLabel}
                    </button>
                </div>
            </div>
            {/* the switch and the cost line share one row under the box; the cost line wraps under the switch when
                the thread panel is too narrow for both */}
            <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[2px]">
                {followUp && (
                    <button
                        type="button"
                        role="switch"
                        aria-checked={reads.on}
                        // an image or an @file is read by the seats that answer it: the switch cannot go off while one is in
                        disabled={reads.locked}
                        data-council-tools
                        data-council-tools-why={reads.why}
                        data-council-tools-locked={reads.locked ? "true" : undefined}
                        onClick={() => setDrafts((d) => ({ ...d, tools: !reads.on }))}
                        className={cn(
                            "flex w-fit items-center gap-[7px] rounded-[6px] border-0 bg-transparent py-px text-[12.5px] text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            reads.locked ? "cursor-default" : "cursor-pointer"
                        )}
                    >
                        <span
                            className={cn(
                                "relative h-[14px] w-[24px] flex-none rounded-full",
                                reads.on ? "bg-accent" : "bg-edge-strong"
                            )}
                        >
                            <span
                                className={cn(
                                    "absolute top-[2px] h-[10px] w-[10px] rounded-full bg-background",
                                    reads.on ? "left-[12px]" : "left-[2px]"
                                )}
                            />
                        </span>
                        Let them read files
                        {reads.why !== "" && <span className="text-muted">· it names {reads.why}</span>}
                    </button>
                )}
                <span data-council-composer-hint className="ml-auto min-w-0 text-[12px] tabular-nums text-muted">
                    {hint}
                </span>
            </div>
            {error != null && (
                // a refusal that lists the live chats runs over several lines: each stays a line of its own
                <span
                    role="alert"
                    data-council-composer-error
                    className="min-w-0 whitespace-pre-line break-words text-[12.5px] text-error-soft"
                >
                    {error}
                </span>
            )}
        </div>
    );
}

// ---- the report's questions to ask next ----

// the last line of the channel, under the newest message, so it shows to a reader at the latest and scrolls away with
// the rest; a click puts the question in the channel's box, `@` seat and all, to edit and send
function AskNext({ c, asks }: { c: Council; asks: AskChip[] }) {
    const setDrafts = useSetAtom(councilChatDraftAtom(c.id));
    const fill = (t: string) => {
        setDrafts((d) => ({ ...d, texts: { ...d.texts, [""]: t } }));
        requestAnimationFrame(() => {
            const box = document.querySelector<HTMLTextAreaElement>(
                '[data-council-composer="channel"] [data-council-composer-input]'
            );
            box?.focus();
            box?.setSelectionRange(t.length, t.length);
        });
    };
    return (
        <div role="group" aria-label="Ask next" data-council-asks className="flex flex-wrap items-center gap-[6px]">
            <span className="text-[12px] text-muted">Ask next</span>
            {asks.map((a, i) => (
                <button
                    key={a.text}
                    type="button"
                    data-council-ask={i}
                    onClick={() => fill(a.fill)}
                    title="Put it in the box to edit and send"
                    className="max-w-full cursor-pointer truncate rounded-full border border-edge-mid bg-transparent px-[12px] py-[4px] text-left text-[13px] text-secondary outline-none hover:border-edge-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {a.fill}
                </button>
            ))}
        </div>
    );
}

// ---- the thread ----

// the ids that arrived while `key` (the council and its view) stayed put. no-cascade guard: opening a council, a seat's
// view or a thread seeds silently, so only a post sent meanwhile rises in (motiontokens' computeEntrances)
function useEntering(key: string, ids: string[]): Set<string> {
    const ref = useRef(initialEntranceState());
    const { animate } = computeEntrances(ref.current, key, ids);
    const idsKey = ids.join(",");
    useLayoutEffect(() => {
        ref.current = computeEntrances(ref.current, key, ids).state;
    }, [key, idsKey]);
    return animate;
}

function ThreadPanel({
    c,
    thread,
    acts,
    onClose,
    chats,
}: {
    c: Council;
    thread: ChatThread;
    acts: Actions;
    onClose: () => void;
    chats: readonly SeatableAgent[];
}) {
    const idea = thread.idea;
    const scroller = useRef<HTMLDivElement>(null);
    const onScroll = useKeptScroll(scroller, `thread:${c.id}:${idea.id}`);
    const entering = useEntering(
        `${c.id}:${idea.id}`,
        thread.items.map((item) => item.id)
    );
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
                            {/* the thread's header names the idea; the bubble is its message alone */}
                            <CouncilText text={idea.text} className="text-[14px] leading-[1.6]" />
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
                        <ReplyMessage
                            key={item.id}
                            councilId={c.id}
                            item={item}
                            inThread
                            rise={item.mine && entering.has(item.id)}
                        />
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
                    placeholder="Reply · @ seat or file · paste an image"
                    sendLabel="Reply"
                    labelledBy="council-thread-reply-label"
                    returnTo={() => document.querySelector<HTMLElement>("[data-council-thread]")}
                    chats={chats}
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

// where a row of the channel sits in its scroller's content, as scrollTop counts
function contentBox(row: Element, el: HTMLElement): RowBox {
    const base = el.getBoundingClientRect().top - el.scrollTop;
    const r = row.getBoundingClientRect();
    return { top: r.top - base, bottom: r.bottom - base };
}

// the place a jump saved: the row the reader was on (kept by node, so rows that grew above it do not move the way back)
type SavedPlace = ReadingPlace & { row: Element | null };

/** The channel's jumps (councilscroll.ts): Top and Latest, and after either, Back to the message the reader was on.
 *  `reset` drops the saved place (another council, another seat filter); `onKeptScroll` is useKeptScroll's, called at
 *  once on a jump so a line that lands before the scroll event does not pull the reader back to the end. Returns the
 *  pills to show, the scroller's onScroll, and the three jumps. */
function useChannelJumps(
    boxRef: RefObject<HTMLDivElement | null>,
    rowsRef: RefObject<HTMLDivElement | null>,
    reset: string,
    count: number,
    onKeptScroll: () => void
) {
    const saved = useRef<SavedPlace | null>(null);
    const landing = useRef<Landing | null>(null);
    // the glide in flight: its frame, and the scrollTop it last set (a scroll the reader makes moves off it, and stops it)
    const flight = useRef<{ frame: number; at: number } | null>(null);
    const [pills, setPills] = useState<JumpPills>(NO_PILLS);
    const backTop = useCallback((el: HTMLElement): number | null => {
        const p = saved.current;
        if (p == null) {
            return null;
        }
        return returnTop(p, p.row?.isConnected ? contentBox(p.row, el).top : null, el);
    }, []);
    const sync = useCallback(() => {
        const el = boxRef.current;
        // a hidden scroller has no height: its pills wait until it shows
        if (el == null || el.clientHeight === 0) {
            return;
        }
        const next = jumpPills(el, backTop(el));
        // the reader came back to the saved place by hand: nothing left to go back to (a glide leaving it is not that)
        if (saved.current != null && !next.back && flight.current == null) {
            saved.current = null;
            landing.current = null;
        }
        setPills((prev) =>
            prev.top === next.top && prev.latest === next.latest && prev.back === next.back ? prev : next
        );
    }, [boxRef, backTop]);
    const land = useCallback(() => {
        if (flight.current != null) {
            cancelAnimationFrame(flight.current.frame);
            flight.current = null;
        }
    }, []);
    /** Scrolls the channel to `target()` (read each frame, so Latest follows a line that lands meanwhile) with a short
     *  ease-out glide, or at once under reduced motion; a scroll the reader makes stops it where it is. */
    const glide = useCallback(
        (el: HTMLElement, target: () => number) => {
            land();
            const from = el.scrollTop;
            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
            const ms = glideMs(target() - from);
            if (reduce || Math.abs(target() - from) < 2) {
                el.scrollTop = target();
                onKeptScroll();
                sync();
                return;
            }
            const start = performance.now();
            const step = (now: number) => {
                const f = flight.current;
                // the reader scrolled meanwhile: theirs wins
                if (f == null || Math.abs(el.scrollTop - f.at) > 2) {
                    flight.current = null;
                    sync();
                    return;
                }
                const t = (now - start) / ms;
                el.scrollTop = glideAt(from, target(), t);
                f.at = el.scrollTop;
                if (t >= 1) {
                    flight.current = null;
                    onKeptScroll();
                    sync();
                    return;
                }
                f.frame = requestAnimationFrame(step);
            };
            flight.current = { frame: requestAnimationFrame(step), at: from };
        },
        [land, onKeptScroll, sync]
    );
    useEffect(() => land, [land]);
    useEffect(() => {
        land();
        saved.current = null;
        landing.current = null;
        sync();
    }, [reset, sync, land]);
    // a new line can take the reader off the end without a scroll
    useEffect(sync, [count, sync]);
    const jump = useCallback(
        (to: Landing) => {
            const el = boxRef.current;
            if (el == null) {
                return;
            }
            // mid-glide the place the first jump saved still stands (Top then Latest at once goes back to it)
            if (saved.current == null || (flight.current == null && !stillLanded(landing.current, el))) {
                const rows = Array.from(rowsRef.current?.children ?? []);
                const i = readingRow(
                    rows.map((row) => contentBox(row, el)),
                    el.scrollTop
                );
                saved.current = {
                    row: i < 0 ? null : rows[i],
                    offset: i < 0 ? 0 : contentBox(rows[i], el).top - el.scrollTop,
                    top: el.scrollTop,
                };
            }
            landing.current = to;
            // the pill clicked may go away: the channel keeps focus, and with it j and k
            el.focus({ preventScroll: true });
            glide(el, () => (to === "top" ? 0 : Math.max(0, el.scrollHeight - el.clientHeight)));
        },
        [boxRef, rowsRef, glide]
    );
    const back = useCallback(() => {
        const el = boxRef.current;
        const p = saved.current;
        if (el == null || p == null || backTop(el) == null) {
            return;
        }
        saved.current = null;
        landing.current = null;
        el.focus({ preventScroll: true });
        // the row is read again each frame, so lines landing above it meanwhile do not throw the glide off
        glide(el, () => returnTop(p, p.row?.isConnected ? contentBox(p.row, el).top : null, el));
    }, [boxRef, backTop, glide]);
    const onScroll = useCallback(() => {
        onKeptScroll();
        sync();
    }, [onKeptScroll, sync]);
    return { pills, onScroll, toTop: () => jump("top"), toLatest: () => jump("latest"), back };
}

function JumpPill({
    show,
    jump,
    label,
    onClick,
    children,
}: {
    show: boolean;
    jump: string;
    label: string;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <PopoverReveal open={show} origin="bottom right" className="pointer-events-auto">
            <button
                type="button"
                data-council-jump={jump}
                title={label}
                aria-label={label}
                onClick={onClick}
                className="flex cursor-pointer items-center gap-[5px] rounded-full border border-edge-strong bg-surface-raised px-[12px] py-[5px] text-[12.5px] font-medium text-secondary shadow-popover-sm outline-none hover:border-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
            >
                {children}
            </button>
        </PopoverReveal>
    );
}

// the channel, scrolled to its newest line while the reader is at the bottom of it, and back where they left it; Top,
// Back and Latest float in its bottom right corner
function Channel({
    children,
    councilId,
    view,
    count,
    boxRef,
}: {
    children: ReactNode;
    councilId: string;
    view: string;
    count: number;
    boxRef: RefObject<HTMLDivElement | null>;
}) {
    const rowsRef = useRef<HTMLDivElement>(null);
    const onKeptScroll = useKeptScroll(boxRef, `channel:${councilId}`, { follow: true, count });
    const jumps = useChannelJumps(boxRef, rowsRef, `${councilId}:${view}`, count, onKeptScroll);
    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div
                ref={boxRef}
                data-council-channel
                tabIndex={0}
                role="log"
                aria-label="Council channel"
                onScroll={jumps.onScroll}
                // the gutter is kept with or without a scrollbar, so the column lines up with the composer's below it
                className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5 outline-none [scrollbar-gutter:stable] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-edge-strong"
            >
                <div ref={rowsRef} className="mx-auto flex w-full max-w-[860px] flex-col gap-[16px]">
                    {children}
                </div>
            </div>
            <div className="pointer-events-none absolute bottom-3 right-4 z-20 flex items-center gap-[6px]">
                <JumpPill show={jumps.pills.top} jump="top" label="Jump to the top" onClick={jumps.toTop}>
                    <span aria-hidden>↑</span> Top
                </JumpPill>
                <JumpPill
                    show={jumps.pills.back}
                    jump="back"
                    label="Back to the message you were reading"
                    onClick={jumps.back}
                >
                    <span aria-hidden>↩</span> Back
                </JumpPill>
                <JumpPill show={jumps.pills.latest} jump="latest" label="Jump to the latest" onClick={jumps.toLatest}>
                    <span aria-hidden>↓</span> Latest
                </JumpPill>
            </div>
        </div>
    );
}

/** The council's discussion as a channel with threads. `notes` is what the discussion draws above the channel (the failed
 *  summary and its Retry); `onOpenTerminal` takes an agent's tab id; `chats` are the live claude and pi chats the
 *  composers' `@` can add to the council (the cockpit's roster by the one seat rule, seated ones included: the picker
 *  lists the ones no seat holds). */
export function CouncilChat({
    c,
    acts,
    chats,
    notes,
    onOpenTerminal,
    onOpenFile,
}: {
    c: Council;
    acts: Actions;
    chats: readonly SeatableAgent[];
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
    const channelDraft = useAtomValue(councilChatDraftAtom(c.id)).texts[""] ?? "";
    const asks = isFollowUp(c) && channelDraft === "" ? askChips(c) : [];
    const seats = useMemo(() => seatChips(c), [c]);
    const onlySeat = onlyId == null ? null : (seats.find((chip) => chip.id === onlyId) ?? null);
    const order = useMemo(() => ideaOrder(items), [items]);
    const entering = useEntering(
        `${c.id}:${onlyId ?? ""}`,
        items.map((item) => item.id)
    );
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
    // two or more failed seats retry together (Retry all), each on the model picked beside it; the picks belong to
    // this council, so another one opened here starts from its seats' own models
    const retryAll = offersRetryAll(c);
    const [pickState, setPickState] = useState<{ id: string; picks: Record<string, string> }>({ id: c.id, picks: {} });
    const picks = pickState.id === c.id ? pickState.picks : {};
    const setPick = (seat: string, model: string | undefined) =>
        setPickState((s) => {
            const next = { ...(s.id === c.id ? s.picks : {}) };
            if (model == null) {
                delete next[seat];
            } else {
                next[seat] = model;
            }
            return { id: c.id, picks: next };
        });
    return (
        <div className="flex min-h-0 flex-1">
            <div data-council-main className="flex min-h-0 min-w-0 flex-1 flex-col">
                {onlySeat != null && (
                    <div className="flex flex-none items-center gap-2 border-b border-edge-faint px-6 py-2 text-[13px] text-muted">
                        <span role="status" data-council-only={onlySeat.id}>
                            {onlyLine(onlySeat)}
                        </span>
                        <button
                            type="button"
                            data-council-action="show-everyone"
                            onClick={() => setOnly(null)}
                            className="h-[24px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[8px] text-[13px] text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            Show everyone
                        </button>
                    </div>
                )}
                {retryAll && (
                    <div
                        data-council-retry-all-bar
                        className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge-faint px-6 py-2 text-[13px] text-muted"
                    >
                        <span>{retryAllSeats(c).length} seats failed</span>
                        {retryAllSeats(c).map((e) => (
                            <span key={e.id} className="flex items-center gap-[6px]">
                                <span className="text-secondary">{e.name}</span>
                                <RetryModelPick
                                    expert={e}
                                    error={c.failed?.[e.id]?.error}
                                    picked={picks[e.id]}
                                    onPick={(m) => setPick(e.id, m)}
                                    disabled={c.state === "running"}
                                    className={cn(secondaryButton, "h-[24px] px-[6px] text-[12px]")}
                                />
                            </span>
                        ))}
                        <button
                            type="button"
                            data-council-action="retry-all"
                            disabled={c.state === "running" || acts.busy.has("retry:all")}
                            title={
                                c.state === "running"
                                    ? "The council is running: retry once it is done"
                                    : "Run every failed seat again at once, each on the model picked beside it"
                            }
                            onClick={() =>
                                void acts.run("retry:all", "Retry all", () =>
                                    retryAllExperts(c.id, retryAllModels(c, picks))
                                )
                            }
                            className={cn(secondaryButton, "h-[24px] px-[8px] text-[12px]")}
                        >
                            {acts.busy.has("retry:all") ? "Retrying…" : `Retry all ${retryAllSeats(c).length}`}
                        </button>
                    </div>
                )}
                {notes}
                <Channel
                    boxRef={channel}
                    councilId={c.id}
                    view={onlyId ?? ""}
                    count={items.length + (asks.length > 0 ? 1 : 0)}
                >
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
                                return (
                                    <ReplyMessage
                                        key={item.id}
                                        councilId={c.id}
                                        item={item}
                                        onOpenIdea={open}
                                        rise={item.mine && entering.has(item.id)}
                                    />
                                );
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
                    {asks.length > 0 && <AskNext c={c} asks={asks} />}
                </Channel>
                {/* the channel's column: its px-6, its 10px scrollbar gutter on the right, its 860px centred */}
                <div className="flex-none pb-4 pl-6 pr-[34px] pt-[10px]">
                    <div className="mx-auto w-full max-w-[860px]">
                        <span id="council-channel-label" className="sr-only">
                            Message the council
                        </span>
                        <Composer
                            c={c}
                            scope="channel"
                            proposalId=""
                            placeholder="Message everyone · @ to ask one seat · paste an image · @ for a file"
                            sendLabel="Send"
                            labelledBy="council-channel-label"
                            returnTo={() => channel.current}
                            chats={chats}
                        />
                    </div>
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
                            <ThreadPanel c={c} thread={thread} acts={acts} onClose={close} chats={chats} />
                        ) : sources != null ? (
                            <CouncilSourcesPanel c={c} view={sources} onClose={closeSources} onOpenFile={onOpenFile} />
                        ) : null}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
