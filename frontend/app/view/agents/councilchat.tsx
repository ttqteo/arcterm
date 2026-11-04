// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council's discussion as a channel of speech bubbles with threads (boards J-chat-bubbles and J3-seat-filter-panel in
// .superpowers/design/council-report; councilchatmodel.ts derives what it draws). The seat filters sit in the
// discussion's header (councilseats.tsx); here, while one is on, an Only line with Show everyone, and with two or more
// seats failed a Retry all bar with a model pick per seat; then the channel, one column: the person's question on the
// right in their bubble, folded to three lines and two of its limits; a divider for each round; every idea as a bubble
// in its seat's colour with its reply chip; the ideas and replies a seat wrote that wait for the person (amber, Send to the others,
// Edit, Drop); the line where an agent skipped a turn, a failure with Retry, and a typing row for whoever is at work;
// under it the composer, which posts to everyone, and `@` lists the seats (a pick asks that one), the project's files
// (a pick names the file; the seats that answer read it) and the live claude and pi chats no seat holds under Add a live
// chat (a pick puts its mention key in the message; Send seats the chats the text still names and posts the message to
// them); an image pasted or dropped into the box waits above the text as a chip and goes with the message, and the
// person's own message shows its images as thumbnails and each `@file` as a chip. Beside the channel is the Ideas rail
// (boards A-decided-rail and A2-decided-rail-thread in .superpowers/design/council-discussion), shaped like the
// brainstorm's Decided so far: each idea's number, author, title and a quiet line of its replies and stances; a row
// brings its idea to the top of the channel, and the rail folds away (councilIdeasRailFoldedAtom). Its Memory tab holds
// the direction the seats read before the Report (councilmemory.tsx); a Chốt button beside like and dislike on an idea
// and on a seat's message, and the `p` key on the idea under the cursor, pin one into it. A click on an idea's
// reply chip, or Enter on the idea the keyboard cursor is on, opens its thread on the rail's second tab: the idea on
// top, then its replies with their stance pills, the replies held as drafts, and a reply box that names who will answer. j and k move
// the cursor over the ideas, Enter opens the thread and Escape closes it, while focus is inside the channel or the
// thread (buildCouncilBindings reads the cursor councilchatnav.ts publishes). A message's evidence is a link per cited
// file (councilsourcespanel.tsx): a click opens the Sources panel in the rail's place, and Escape or its close button
// goes back to the rail. Every part carries a data-council-* attribute for the CDP scenario
// `council-discussion`. The store's actions answer `{ ok, error }`; a refusal shows in the header (the `acts` the
// discussion shares).

import { useCopyFeedback, type CopyState } from "@/app/element/copyfeedback";
import { MOTION, computeEntrances, initialEntranceState, sentRise, sheetPanel } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { buildCouncilBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import { reloadFileIndex } from "@/app/view/code/codestore";
import { cn } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
    ArrowRight,
    Check,
    ChevronDown,
    ChevronUp,
    ChevronsLeft,
    ChevronsRight,
    CircleAlert,
    Copy,
    CornerDownRight,
    FileText,
    Loader2,
    Pin,
    PinOff,
    Plus,
    Route,
    SendHorizontal,
    ThumbsDown,
    ThumbsUp,
    X,
} from "lucide-react";
import { AnimatePresence, animate, motion } from "motion/react";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ClipboardEvent,
    type DragEvent,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
    type RefObject,
} from "react";
import { flushSync } from "react-dom";
import type { Actions } from "./councilactions";
import {
    DRAFT_WAIT,
    askChips,
    contextLabel,
    councilChannel,
    councilThread,
    foldSettle,
    foldToggle,
    foldView,
    ideaOrder,
    insertAllMention,
    insertChatMention,
    insertFileMention,
    insertMention,
    mentionPicker,
    onlyLine,
    pickedChats,
    pickerRows,
    readsChoice,
    readsFiles,
    readsNote,
    replyReach,
    seatChips,
    seatLink,
    threadAsks,
    toolsOfChoice,
    type AnswerQuote,
    type AskChip,
    type ChannelItem,
    type ChatPick,
    type ChatThread,
    type DraftPost,
    type FailureLine,
    type IdeaOut,
    type IdeaPost,
    type PillTone,
    type QuestionFold,
    type QuestionPost,
    type ReachChips,
    type ReplyPost,
    type SkipLine,
    type ThreadItem,
    type TypingRow,
    type Who,
} from "./councilchatmodel";
import { useCouncilChatNav, type CouncilChatNav } from "./councilchatnav";
import { CouncilDetailsFoot } from "./councildetails";
import { initialOf, isFollowUp, type AvatarTone } from "./councildiscussionmodel";
import { messageMarkdown } from "./councilfinalmodel";
import {
    councilList,
    newestReplyOn,
    railMeta,
    railOrderLabel,
    stanceGroups,
    type IdeaRow,
    type StanceTone,
} from "./councillistmodel";
import { markSpans } from "./councilmarks";
import { MemoryPanel } from "./councilmemory";
import { chotLine, memoryDot, type DirectionSource } from "./councilmemorymodel";
import {
    ANSWERING,
    ROUTER_CHOOSING,
    ROUTER_PICKS_WHO,
    answerers,
    councilProjectName,
    draftsWaitWord,
    followupLabel,
    nextThumb,
    routedLabel,
    routedMessage,
    type CouncilThumb,
    type SeatableAgent,
} from "./councilmodel";
import { councilOpenedAtom, openedAt } from "./councilopened";
import { offersRetryAll, retryAllModels, retryAllSeats } from "./councilretry";
import { RetryModelPick, RetryWithButton } from "./councilretrymenu";
import { councilRevealAtom } from "./councilreveal";
import {
    NO_PILLS,
    followsEnd,
    glideAt,
    glideMs,
    jumpPills,
    keepPlace,
    keptPlace,
    ownPosts,
    placeOf,
    readingRow,
    returnTop,
    revealTop,
    sentSince,
    stillLanded,
    topFor,
    type JumpPills,
    type Landing,
    type ReadingPlace,
    type RevealBlock,
    type RowBox,
    type ScrollPlace,
} from "./councilscroll";
import { sendState, shownItems, type SendState, type SendStatus } from "./councilseen";
import { basename } from "./councilsetupmodel";
import { CouncilSourcesPanel, EvidenceChips } from "./councilsourcespanel";
import {
    addCouncilImages,
    askCouncilSeatToo,
    clearCouncilImages,
    closeCouncilSources,
    councilChatDraftAtom,
    councilIdeasRailFoldedAtom,
    councilOnlyAtom,
    councilOpenProposalAtom,
    councilSourcesAtom,
    councilThreadReadAtom,
    directionCouncil,
    draftCouncil,
    finalPickCouncil,
    openCouncilSources,
    removeCouncilImage,
    replyCouncil,
    retryAllExperts,
    retryExpert,
    thumbCouncil,
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
type AvatarDot = "working" | "waiting" | "failed" | null;

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
                        dot === "working" ? "bg-working pulse-dot" : dot === "waiting" ? "bg-asking" : "bg-error",
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
    out: "border border-edge-strong text-muted",
    revised: "bg-accent/12 text-accent-soft",
    neutral: "bg-pill text-secondary",
};

// a revision's new title, on a line of its own at the top of the reply: the word, then the title
function RetitledLine({ title }: { title: string }) {
    return (
        <div data-council-retitled className="flex min-w-0 items-baseline gap-[6px] text-[13px] leading-[1.45]">
            <span className="flex-none text-muted">New title</span>
            <span className="min-w-0 font-semibold text-primary">{title}</span>
        </div>
    );
}

export function CouncilPill({ word, tone }: { word: string; tone: PillTone }) {
    return <span className={cn("rounded-full px-[7px] py-px text-[10px] font-semibold", PILL_TONE[tone])}>{word}</span>;
}

// an idea out of the running (withdrawn by its author, or cut by the person at the pause): the pill beside its author
function OutPill({ out }: { out: IdeaOut }) {
    return (
        <span data-council-out={out.kind} title={out.title}>
            <CouncilPill word={out.word} tone="out" />
        </span>
    );
}

const primaryButton =
    "h-[26px] cursor-pointer rounded-[6px] border-0 bg-accent px-[10px] text-[13px] font-semibold text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const secondaryButton =
    "h-[26px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[13px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const ghostButton =
    "h-[26px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[10px] text-[13px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

// ---- messages ----

// the live chats a seat's name or avatar can open (CouncilChat's `chats` and `onOpenTerminal`), so a message's byline
// reaches them without each message taking them
const SeatLinks = createContext<{
    chats: readonly SeatableAgent[];
    open: (tab: string) => void;
    reopen: (transcript: string) => void;
} | null>(null);

// where a click on a seat's name, avatar or chip goes (seatLink), with the call that goes there; null when it goes
// nowhere (`who` null: every seat, `@all`)
function useSeatLink(who: Who | null): { title: string; open: () => void } | null {
    const links = useContext(SeatLinks);
    const link = links == null || who == null ? null : seatLink(who, links.chats);
    if (link == null) {
        return null;
    }
    return { title: link.title, open: () => (link.reopen !== "" ? links!.reopen(link.reopen) : links!.open(link.tab)) };
}

// the line over a message: who wrote it, then what the caller adds (a label, the time); a live chat seat's name opens
// its terminal
function Byline({ who, children }: { who: Who; children?: ReactNode }) {
    const link = useSeatLink(who);
    return (
        <div className="relative flex flex-wrap items-center gap-[7px] text-[12.5px]">
            {link == null ? (
                <span className={cn("font-semibold", TONE_TEXT[who.tone])}>{who.name}</span>
            ) : (
                <button
                    type="button"
                    data-council-seat-open={who.tab}
                    title={link.title}
                    onClick={link.open}
                    className={cn(
                        "cursor-pointer rounded-[4px] border-0 bg-transparent p-0 font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent",
                        TONE_TEXT[who.tone]
                    )}
                >
                    {who.name}
                </button>
            )}
            {children}
        </div>
    );
}

// a message's avatar; a live chat seat's opens its terminal, as its name does
function SeatAvatar({ who, large }: { who: Who; large?: boolean }) {
    const link = useSeatLink(who);
    const avatar = <CouncilAvatar tone={who.tone} name={who.name} initials={who.initials} large={large} />;
    if (link == null) {
        return avatar;
    }
    return (
        <button
            type="button"
            data-council-seat-avatar={who.tab}
            title={link.title}
            aria-label={link.title}
            onClick={link.open}
            className="flex-none cursor-pointer self-start rounded-full border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            {avatar}
        </button>
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

// the person's like and dislike on a seat's idea or reply. The two buttons sit at the right end of its byline with its time and
// show while it is hovered or focused (HoverEnd); one that is on also shows as a chip under the message (ThumbChip), which
// stays and takes it back. A press on the one that is on takes it back too. The seats' later prompts and the summary read
// it, so it steers them with no words.
const THUMBS: { thumb: CouncilThumb; Icon: typeof ThumbsUp; word: string; done: string; on: string }[] = [
    { thumb: "like", Icon: ThumbsUp, word: "Like", done: "Liked", on: "bg-success/12 text-success-soft" },
    { thumb: "dislike", Icon: ThumbsDown, word: "Dislike", done: "Disliked", on: "bg-error/12 text-error-soft" },
];

// a byline's right end: its time and the thumbs, seen while the message is hovered or focused. They float over the
// byline's right end instead of taking room in it: in a narrow column (the thread panel) room for them wrapped them onto
// a line of their own, an empty line while nothing is hovered. On hover they cover what is under them, and nothing moves
function HoverEnd({ children }: { children: ReactNode }) {
    return (
        <span
            className={cn("absolute inset-y-0 right-0 flex items-center gap-[7px] bg-background pl-[8px]", HOVER_ONLY)}
        >
            {children}
        </span>
    );
}

function Thumbs({
    councilId,
    item,
    thumb,
    acts,
}: {
    councilId: string;
    item: string;
    thumb: CouncilThumb | "";
    acts: Actions;
}) {
    const key = `thumb:${item}`;
    const busy = acts.busy.has(key);
    return (
        <span
            data-council-thumbs={item}
            data-thumb={thumb === "" ? undefined : thumb}
            className="inline-flex gap-[2px]"
        >
            {THUMBS.map(({ thumb: t, Icon, word, on }) => {
                const pressed = thumb === t;
                return (
                    <button
                        key={t}
                        type="button"
                        data-council-thumb={t}
                        aria-pressed={pressed}
                        aria-label={pressed ? `Take back your ${word.toLowerCase()}` : word}
                        title={pressed ? `Take back your ${word.toLowerCase()}` : `${word}: the council reads it`}
                        disabled={busy}
                        onClick={() =>
                            void acts.run(key, word, () => thumbCouncil(councilId, item, nextThumb(thumb, t)))
                        }
                        className={cn(
                            "flex h-[20px] w-[22px] cursor-pointer items-center justify-center rounded-[6px] border-0 outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default",
                            pressed ? on : "bg-transparent text-muted hover:bg-surface-hover hover:text-secondary"
                        )}
                    >
                        <Icon size={12} strokeWidth={2} aria-hidden />
                    </button>
                );
            })}
        </span>
    );
}

// the like or dislike that is on, as a small tinted chip under the message it is on; a press takes it back, as a press on
// the thumb that is on does. Nothing when neither is on.
function ThumbChip({
    councilId,
    item,
    thumb,
    acts,
}: {
    councilId: string;
    item: string;
    thumb: CouncilThumb | "";
    acts: Actions;
}) {
    const key = `thumb:${item}`;
    const spec = THUMBS.find((t) => t.thumb === thumb);
    if (spec == null) {
        return null;
    }
    const take = `Take back your ${spec.word.toLowerCase()}`;
    return (
        <button
            type="button"
            data-council-thumb-chip={spec.thumb}
            aria-pressed
            title={take}
            disabled={acts.busy.has(key)}
            onClick={() =>
                void acts.run(key, spec.word, () => thumbCouncil(councilId, item, nextThumb(thumb, spec.thumb)))
            }
            className={cn(
                "inline-flex w-fit cursor-pointer items-center gap-[4px] rounded-full border-0 px-[8px] py-px text-[12px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default",
                spec.on
            )}
        >
            <spec.Icon size={11} strokeWidth={2.2} aria-hidden />
            {spec.done}
        </button>
    );
}

// Copy and Pin to Report on a seat's sent idea or reply, at the right end of its byline beside the thumbs (HoverEnd: shown
// while the message is hovered or focused). Copy puts the message's markdown on the clipboard, as a seat wrote it, with no
// name or time (messageMarkdown, the text the Report's Final proposal copies too); the button reads Copied for a moment,
// or Copy failed. Pin to Report makes it the council's Final proposal, in place of the one pinned before with no confirm;
// on the pinned message the same button reads Unpin (and the message wears the PinnedPill). A message with no words (a
// withdrawal with no reason, whose bubble is not drawn) has nothing to copy or pin and gets neither. Never on the
// person's own posts or a held draft: the callers are the ones that draw the thumbs.
const COPY_WORD: Record<CopyState, string> = { idle: "Copy", copied: "Copied", failed: "Copy failed" };
const COPY_TONE: Record<CopyState, string> = {
    idle: "bg-transparent text-muted hover:bg-surface-hover hover:text-secondary",
    copied: "bg-success/12 text-success-soft",
    failed: "bg-error/12 text-error-soft",
};
const TOOL_BUTTON =
    "flex h-[20px] cursor-pointer items-center justify-center gap-[4px] rounded-[6px] border-0 px-[5px] text-[11.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default";
const PIN_WORD = "Pin to Report";
const UNPIN_WORD = "Unpin";

function MessageTools({ c, id, acts }: { c: Council; id: string; acts: Actions }) {
    const { state, copy } = useCopyFeedback();
    const markdown = messageMarkdown(c, id) ?? "";
    if (markdown === "") {
        return null;
    }
    const pinned = c.finalpick === id;
    const key = `finalpick:${id}`;
    const CopyIcon = state === "copied" ? Check : state === "failed" ? X : Copy;
    return (
        <span data-council-tools={id} className="inline-flex gap-[2px]">
            <button
                type="button"
                data-council-copy={id}
                data-copy-state={state}
                aria-label={state === "idle" ? "Copy message" : COPY_WORD[state]}
                title={state === "idle" ? "Copy the message as markdown" : COPY_WORD[state]}
                onClick={() => copy(markdown)}
                className={cn(TOOL_BUTTON, COPY_TONE[state])}
            >
                <CopyIcon size={12} strokeWidth={2} aria-hidden />
                {state !== "idle" && <span>{COPY_WORD[state]}</span>}
            </button>
            <button
                type="button"
                data-council-finalpick={id}
                data-pinned={pinned ? "true" : undefined}
                aria-pressed={pinned}
                aria-label={pinned ? UNPIN_WORD : PIN_WORD}
                title={pinned ? "Unpin: take it off the Report" : "Pin to Report: show it there as the Final proposal"}
                disabled={acts.busy.has(key)}
                onClick={() => void acts.run(key, PIN_WORD, () => finalPickCouncil(c.id, pinned ? "" : id))}
                className={cn(
                    TOOL_BUTTON,
                    "w-[22px] px-0",
                    pinned ? "text-primary" : "bg-transparent text-muted hover:bg-surface-hover hover:text-secondary"
                )}
            >
                {pinned ? (
                    <PinOff size={12} strokeWidth={2} aria-hidden />
                ) : (
                    <Pin size={12} strokeWidth={2} aria-hidden />
                )}
            </button>
        </span>
    );
}

// the pinned message's pill beside its author, always shown (the Pin button is hover-only); a pinned idea that was later
// withdrawn wears it beside its Withdrawn pill
function PinnedPill({ id }: { id: string }) {
    return (
        <span
            data-council-pinned-pill={id}
            title="Pinned to the Report as its Final proposal"
            className={cn(
                "inline-flex items-center gap-[4px] rounded-full px-[7px] py-px text-[10px] font-semibold",
                PILL_TONE.neutral
            )}
        >
            <Pin size={9} strokeWidth={2.4} aria-hidden />
            Pinned to Report
        </span>
    );
}

// Chốt: pins an idea's title, or a seat's message on one line, as the council's direction (the Memory tab). It sits beside
// like and dislike in the same row, and on a reply shows with them while it is hovered or focused. A direction is checked
// before it is set, so the icon turns while the check runs; where it landed (set, or held with a reason) is on the Memory
// tab. An item with no text offers nothing, since the backend refuses an empty direction.
function Chot({ councilId, item, text, acts }: { councilId: string; item: string; text: string; acts: Actions }) {
    const line = chotLine(text);
    if (line === "") {
        return null;
    }
    const key = `direction:pin:${item}`;
    const busy = acts.busy.has(key);
    return (
        <button
            type="button"
            data-council-chot={item}
            aria-label="Chốt: pin it as the council's direction"
            title="Chốt: pin it as the direction the seats read (Memory tab)"
            disabled={busy}
            onClick={() => void acts.run(key, "Chốt", () => directionCouncil(councilId, "pin", line, item))}
            className="inline-flex h-[20px] cursor-pointer items-center gap-[4px] rounded-[6px] border-0 bg-transparent px-[6px] text-[12px] text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
        >
            {busy ? (
                <Loader2 size={11} className="animate-spin" aria-hidden />
            ) : (
                <Pin size={11} strokeWidth={2} aria-hidden />
            )}
            Chốt
        </button>
    );
}

function IdeaMessage({
    c,
    item,
    n,
    open,
    focused,
    fresh,
    onOpen,
    acts,
}: {
    c: Council;
    item: IdeaPost;
    n: number | undefined; // its number on the Ideas rail, so a message and its rail row read as one
    open: boolean;
    focused: boolean;
    fresh: string; // `2 new replies` since the person last read its thread; empty with none
    onOpen: (id: string) => void;
    acts: Actions;
}) {
    const councilId = c.id;
    const t = item.thread;
    return (
        <article
            data-council-item
            data-item-kind="idea"
            data-council-idea={item.id}
            data-item-label={item.label}
            data-open={open ? "true" : undefined}
            data-focused={focused ? "true" : undefined}
            data-fresh={fresh === "" ? undefined : "true"}
            className="group/idea group/reply flex gap-[10px]"
        >
            <SeatAvatar who={item} large />
            <div className="flex min-w-0 max-w-[720px] flex-1 flex-col gap-[6px]">
                <Byline who={item}>
                    {n != null && (
                        <span
                            data-council-idea-n
                            className={cn("tabular-nums", open || focused ? "font-semibold text-accent" : "text-muted")}
                        >
                            Idea {n}
                        </span>
                    )}
                    {item.wild ? (
                        <CouncilPill word={item.label} tone="neutral" />
                    ) : (
                        <span className="text-muted">{item.label}</span>
                    )}
                    {item.out != null && <OutPill out={item.out} />}
                    {c.finalpick === item.id && <PinnedPill id={item.id} />}
                    <PostTime at={item.at} when={item.when} />
                    {item.edited && <span className="text-muted">edited</span>}
                    {/* the idea's thumbs sit under its bubble, always shown; Copy and Pin float at the byline's end */}
                    <HoverEnd>
                        <MessageTools c={c} id={item.id} acts={acts} />
                    </HoverEnd>
                </Byline>
                <div
                    className={cn(
                        "flex min-w-0 flex-col gap-[6px] rounded-[4px_16px_16px_16px] border px-4 py-3 transition-[box-shadow] duration-300 motion-reduce:transition-none",
                        item.out != null && "opacity-60",
                        open ? TONE_BUBBLE_ON[item.tone] : TONE_BUBBLE[item.tone],
                        // the open idea wears a light ring over its tone border, so it stands out from its tinted
                        // neighbours; the idea under the cursor (a rail click, j / k) wears the accent ring its rail
                        // row wears, and a rail click rings it wider for a moment where it lands (FLASH_MS)
                        open ? "ring-2 ring-primary/85" : focused && "ring-2 ring-accent",
                        "group-data-[flash=true]/idea:ring-4 group-data-[flash=true]/idea:ring-accent"
                    )}
                >
                    {/* no title: a chat message has none, and its first sentence says the idea; the title names it where
                        it is quoted (a reply's ↳, the thread's header, the report) */}
                    {/* always whole: a long idea shows all of its text in every round */}
                    <div data-council-idea-body>
                        <CouncilText text={item.text} className="text-[14.5px] leading-[1.6]" />
                    </div>
                    <EvidenceChips {...item.claim} source={{ councilId, owner: item.id, title: item.title }} />
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
                            {fresh !== "" && (
                                <span
                                    data-council-thread-fresh
                                    className="inline-flex items-center gap-[5px] font-semibold text-accent"
                                >
                                    <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-accent" />
                                    {fresh}
                                </span>
                            )}
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
                        <Thumbs councilId={councilId} item={item.id} thumb={item.thumb} acts={acts} />
                        <Chot councilId={councilId} item={item.id} text={item.title} acts={acts} />
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
// a reply's way to its idea's thread, in the channel: `↳` and the idea's title
function ReplyOn({ item, onOpenIdea }: { item: ReplyPost; onOpenIdea?: (id: string) => void }) {
    if (onOpenIdea == null || item.on === "") {
        return null;
    }
    return (
        <button
            type="button"
            data-council-reply-on={item.proposalid}
            onClick={() => onOpenIdea(item.proposalid)}
            className="flex min-w-0 cursor-pointer items-center gap-[5px] rounded-[4px] text-[12px] text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
        >
            <CornerDownRight size={11} aria-hidden className="flex-none" />
            <span className="min-w-0 truncate">{item.on}</span>
        </button>
    );
}

// shown while its reply is hovered or focused: a post's time, which says little at a glance
const HOVER_ONLY = "opacity-0 group-hover/reply:opacity-100 group-focus-within/reply:opacity-100";

// a seat's byline: its name, its stance when it takes one (a plain `replies` says nothing), the Pinned to Report pill when
// it is the Final proposal, and on hover its time, Copy and Pin (`tools`) and the thumbs
function ReplyHeader({
    item,
    onOpenIdea,
    pinned,
    tools,
    thumbs,
}: {
    item: ReplyPost;
    onOpenIdea?: (id: string) => void;
    pinned?: boolean;
    tools?: ReactNode;
    thumbs?: ReactNode;
}) {
    return (
        <Byline who={item}>
            {item.pill !== "neutral" && <CouncilPill word={item.label} tone={item.pill} />}
            {pinned && <PinnedPill id={item.id} />}
            {item.edited && <span className="text-muted">edited</span>}
            <ReplyOn item={item} onOpenIdea={onOpenIdea} />
            <HoverEnd>
                <PostTime at={item.at} when={item.when} />
                {tools}
                {thumbs}
            </HoverEnd>
        </Byline>
    );
}

// under the person's own post, as a messenger has it: `edited`, what it waits on, and on the newest one Sent or Seen;
// nothing at all when none of them applies (whom it reaches is at the top of its bubble, ReachRow)
function MineLine({
    item,
    status,
    onOpenIdea,
}: {
    item: ReplyPost;
    status?: SendStatus;
    onOpenIdea?: (id: string) => void;
}) {
    const waits = item.pending === ANSWERING ? "" : item.pending;
    const on = onOpenIdea != null && item.on !== "";
    if (waits === "" && !item.edited && status == null && !on) {
        return null;
    }
    return (
        <div
            data-council-mine-line
            className="flex flex-wrap items-center justify-end gap-x-[7px] gap-y-[2px] text-[12px] text-muted"
        >
            <ReplyOn item={item} onOpenIdea={onOpenIdea} />
            {item.edited && <span>edited</span>}
            {waits !== "" && <span data-council-waits>{waits}</span>}
            {status != null && <SendLine status={status} />}
        </div>
    );
}

// Sent, then Seen with the small avatars of the seats working on it
function SendLine({ status }: { status: SendStatus }) {
    return (
        <span role="status" data-council-send-status={status.word} className="flex items-center gap-[4px]">
            {status.seen.map((who) => (
                <CouncilAvatar
                    key={who.author}
                    tone={who.tone}
                    name={who.name}
                    initials={who.initials}
                    title={`${who.name} has seen it`}
                    className="h-[14px] w-[14px] text-[6.5px]"
                />
            ))}
            {status.word}
        </span>
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

// a seat, or every seat, as a chip in its colour: one the person named with `@UX` in their text, and one their post
// reaches at the top of its bubble
const SEAT_CHIP = "inline-flex max-w-full items-center rounded-full px-[7px] font-semibold";

// a live chat seat's chip opens its terminal, as its name and avatar on a message do
function SeatChip({ who, text, className }: { who: Who | null; text: string; className?: string }) {
    const link = useSeatLink(who);
    const look = cn(
        SEAT_CHIP,
        who == null ? "bg-pill text-secondary" : cn(TONE_FILL[who.tone], TONE_TEXT[who.tone]),
        className
    );
    if (link == null) {
        return (
            <span data-council-seat-chip={who?.author ?? "all"} className={look}>
                {text}
            </span>
        );
    }
    return (
        <button
            type="button"
            data-council-seat-chip={who?.author ?? "all"}
            title={link.title}
            onClick={link.open}
            className={cn(
                look,
                "cursor-pointer border-0 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
            )}
        >
            {text}
        </button>
    );
}

// the person's own message: Markdown like a seat's, except one that names files or seats, which is cut at them so each
// `@path` and `@UX` is a chip in the line (a chip cannot sit inside a Markdown paragraph)
function PersonText({ councilId, item }: { councilId: string; item: ReplyPost }) {
    if (!item.parts.some((p) => p.kind !== "text")) {
        return <CouncilText text={item.text} className="text-[14px] leading-[1.6]" />;
    }
    return (
        <p className="m-0 min-w-0 whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-ink-hi">
            {item.parts.map((p, i) =>
                p.kind === "text" ? (
                    <span key={i}>{p.text}</span>
                ) : p.kind === "seat" ? (
                    <SeatChip key={i} who={p.who} text={p.text} className="py-px align-baseline text-[13px]" />
                ) : (
                    <FileMentionChip key={i} councilId={councilId} owner={item.id} path={p.path} />
                )
            )}
        </p>
    );
}

// at the top of the person's own bubble: whom it reaches, when that is not the usual ones and its text does not name
// them, as chips in the seats' colours behind the router's mark (or an arrow, for seats the person chose), or that the
// router is still choosing, or failed; the hover is the router's line, its reason with it
function ReachRow({ to }: { to: ReachChips }) {
    const failed = to.by === "failed";
    const Icon = failed ? CircleAlert : to.by === "you" ? ArrowRight : Route;
    return (
        <div
            data-council-reach={to.by}
            title={to.title === "" ? undefined : to.title}
            className={cn(
                "flex min-w-0 flex-wrap items-center gap-[5px] text-[12px] leading-[1.4]",
                failed ? "text-error-soft" : "text-muted"
            )}
        >
            <Icon size={12} aria-hidden className="flex-none" />
            {to.by === "choosing" && <span>{ROUTER_CHOOSING}</span>}
            {failed && <span>Router failed</span>}
            {to.everyone && <SeatChip who={null} text="Everyone" />}
            {to.seats.map((who) => (
                <SeatChip key={who.author} who={who} text={who.name} />
            ))}
        </div>
    );
}

// how long the post an answer's quote jumps to keeps its ring
const FLASH_MS = 2000;

// rings a post for a moment where it landed (FLASH_MS), so it is found at a glance: a quote's press (QuoteRow) and the
// Report's Open in Discussion lay it; a second one before it fades starts the moment again
function flashPost(post: HTMLElement) {
    window.clearTimeout(Number(post.dataset.flashTimer));
    post.dataset.flash = "true";
    post.dataset.flashTimer = String(window.setTimeout(() => delete post.dataset.flash, FLASH_MS));
}

// at the top of a seat's bubble: the person's post it answers, when it is not right under it; a click scrolls to that
// post, which sits in the same list (a seat's own view leaves the person's posts out: the quote is then only a quote)
function QuoteRow({ quote }: { quote: AnswerQuote }) {
    const body = (
        <>
            <CornerDownRight size={11} aria-hidden className="flex-none" />
            <span className="flex-none font-semibold text-secondary">You</span>
            <span className="min-w-0 truncate">{quote.text}</span>
        </>
    );
    const box =
        "-mx-[6px] flex min-w-0 items-center gap-[6px] rounded-[8px] bg-background/55 px-[9px] py-[5px] text-left text-[12.5px] leading-[1.4] text-muted";
    if (!quote.jump) {
        return (
            <div data-council-quote={quote.id} className={box}>
                {body}
            </div>
        );
    }
    const jump = (e: MouseEvent<HTMLButtonElement>) => {
        const at = `[data-council-reply-post="${quote.id}"]`;
        let list = e.currentTarget.parentElement;
        while (list != null && list.querySelector(at) == null) {
            list = list.parentElement;
        }
        const post = list?.querySelector<HTMLElement>(at);
        if (post == null) {
            return;
        }
        // a glide up the channel, so the eye follows it back to the question; a jump with reduced motion
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        revealIn(scrollerOf(post), post, "center", smooth);
        // and the question's bubble rings for a moment where it lands
        flashPost(post);
    };
    return (
        <button
            type="button"
            data-council-quote={quote.id}
            title="Go to your message"
            onClick={jump}
            className={cn(
                box,
                "cursor-pointer border-0 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
            )}
        >
            {body}
        </button>
    );
}

// under the last answer to a message the router took up: one chip per seat that was not asked, `Ask RAM too`. A press
// reopens the person's message for that seat (wavesrv puts it in the message's `to`); the chips stay off until the council
// changes (the list of seats left, which the pressed seat leaves) and a refusal shows under them, as the composer's
// error does
function AskTooChips({
    councilId,
    replyId,
    seats,
}: {
    councilId: string;
    replyId: string;
    seats: { id: string; name: string }[];
}) {
    const left = seats.map((s) => s.id).join(",");
    const [pressed, setPressed] = useState<string | null>(null); // the seats that were left when a press went out
    const [error, setError] = useState<string | null>(null);
    const busy = pressed === left;
    const press = async (seat: { id: string; name: string }) => {
        if (busy) {
            return;
        }
        setError(null);
        setPressed(left);
        const r = await askCouncilSeatToo(councilId, replyId, seat.id);
        // `=== false` because the non-strict tsconfig narrows a union only on a comparison
        if (r.ok === false) {
            setPressed(null);
            setError(`Ask ${seat.name} too failed: ${r.error}`);
        }
    };
    return (
        <div className="flex min-w-0 flex-col gap-[4px]">
            <div role="group" aria-label="Ask another seat too" className="flex flex-wrap items-center gap-[6px]">
                {seats.map((seat) => (
                    <button
                        key={seat.id}
                        type="button"
                        data-council-ask-too={seat.id}
                        disabled={busy}
                        onClick={() => void press(seat)}
                        title={`Ask ${seat.name} to answer this message too`}
                        className="max-w-full cursor-pointer truncate rounded-full border border-edge-mid bg-transparent px-[10px] py-[2px] text-[12px] text-secondary outline-none hover:border-edge-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50 disabled:hover:border-edge-mid disabled:hover:text-secondary"
                    >
                        Ask {seat.name} too
                    </button>
                ))}
            </div>
            {error != null && (
                <span
                    role="alert"
                    data-council-ask-too-error
                    className="min-w-0 break-words text-[12px] text-error-soft"
                >
                    {error}
                </span>
            )}
        </div>
    );
}

// a reply in the thread panel: a seat's on the left under its byline, the person's own on the right
function ReplyMessage({
    c,
    item,
    acts,
    inThread,
    onOpenIdea,
    rise,
    status,
}: {
    c: Council;
    item: ReplyPost;
    acts: Actions;
    inThread?: boolean;
    onOpenIdea?: (id: string) => void;
    rise?: boolean; // the person's post that just arrived: it rises in from the composer (sentRise)
    status?: SendStatus; // the person's newest post: its Sent or Seen (councilseen.ts)
}) {
    const councilId = c.id;
    const openIdea = inThread ? undefined : onOpenIdea;
    // a withdrawal or a revision that gave no reason or title says it all in its pill: no empty bubble under it
    const bare =
        (item.pill === "out" || item.pill === "revised") &&
        item.text.trim() === "" &&
        item.retitled === "" &&
        item.claim.evidence.length === 0;
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
            className={cn("group/reply flex gap-[8px]", item.mine && "flex-row-reverse")}
        >
            {!item.mine && <SeatAvatar who={item} />}
            <div className={cn("flex min-w-0 max-w-[680px] flex-col gap-[5px]", item.mine && "items-end")}>
                {/* the person's own post has no byline, as a messenger draws it: the lines it needs go under it */}
                {!item.mine && (
                    <ReplyHeader
                        item={item}
                        onOpenIdea={openIdea}
                        pinned={c.finalpick === item.id}
                        // at the right end of its byline with the time, shown on hover or focus, so a reply is no taller
                        tools={<MessageTools c={c} id={item.id} acts={acts} />}
                        thumbs={
                            <>
                                <Thumbs councilId={councilId} item={item.id} thumb={item.thumb} acts={acts} />
                                <Chot councilId={councilId} item={item.id} text={item.text} acts={acts} />
                            </>
                        }
                    />
                )}
                <div
                    data-council-bubble
                    hidden={bare}
                    className={cn(
                        "flex min-w-0 flex-col gap-[6px] border px-[14px]",
                        // the ring a quote's press lays on the post it jumps to (QuoteRow), fading out after FLASH_MS
                        "transition-[box-shadow] duration-300 motion-reduce:transition-none group-data-[flash=true]/reply:ring-2 group-data-[flash=true]/reply:ring-accent",
                        item.mine ? "rounded-[14px_14px_4px_14px]" : "rounded-[4px_14px_14px_14px]",
                        item.to != null || item.quote != null ? "pb-[10px] pt-[8px]" : "py-[10px]",
                        TONE_BUBBLE[item.tone]
                    )}
                >
                    {item.to != null && <ReachRow to={item.to} />}
                    {item.quote != null && <QuoteRow quote={item.quote} />}
                    {item.retitled !== "" && <RetitledLine title={item.retitled} />}
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
                        {...item.claim}
                        source={{ councilId, owner: item.id, title: `${item.name}'s reply` }}
                    />
                </div>
                {!item.mine && <ThumbChip councilId={councilId} item={item.id} thumb={item.thumb} acts={acts} />}
                {item.agrees.length > 0 && (
                    <div className="flex flex-wrap items-center gap-[6px]">
                        {item.agrees.map((text, i) => (
                            <Reaction key={i} text={text} />
                        ))}
                    </div>
                )}
                {item.askToo.length > 0 && (
                    <AskTooChips councilId={councilId} replyId={item.routedReply} seats={item.askToo} />
                )}
                {item.mine && <MineLine item={item} status={status} onOpenIdea={openIdea} />}
            </div>
            {item.mine && (
                // the time beside the bubble, on hover
                <span className={cn("flex-none self-center text-[12px]", HOVER_ONLY)}>
                    <PostTime at={item.at} when={item.when} />
                </span>
            )}
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
            <SeatAvatar who={item} />
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
                {item.retitled !== "" && <RetitledLine title={item.retitled} />}
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
                    {...item.claim}
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

// the person's question as their message on the right, on top of the Chat's thread: three lines and two of the limits
// it set until Show more opens the rest, with Show more / Show less under them. line-clamp cannot be transitioned, so the
// fold moves the height of the text's wrapper, and of the limits' row, between two measured values: over the whole text,
// clipped at the wrapper, and the three-line cut comes back once the height is down. The limits past the second fade with
// it. Reduced motion skips all of it.
const QUESTION_FOLD = 280;
const LIMITS_FOLDED = 2;

function QuestionMessage({ item }: { item: QuestionPost }) {
    const [phase, setPhase] = useState<QuestionFold>("folded");
    const textBox = useRef<HTMLDivElement>(null);
    const limitsBox = useRef<HTMLDivElement>(null);
    const moving = useRef<{ stop: () => void } | null>(null);
    const hidden = item.limits.length - LIMITS_FOLDED;
    const foldable = hidden > 0 || item.text.length > QUESTION_FOLD;
    const view = foldView(phase);
    const limits = view.allLimits ? item.limits : item.limits.slice(0, LIMITS_FOLDED);
    useEffect(() => () => moving.current?.stop(), []);
    const toggle = () => {
        const next = foldToggle(phase);
        if (next == null) {
            return;
        }
        const parts = [textBox.current, limitsBox.current].filter((e): e is HTMLDivElement => e != null);
        // read at the click: useReducedMotion keeps the value of the first render, and the setting can change while open
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (parts.length === 0 || reduce) {
            setPhase(foldSettle(next));
            return;
        }
        // each part's height now, and the height it will have, read off the settled layout of the other fold. Closing draws
        // the folded layout for the read and puts the whole one back, both before anything is painted.
        const from = parts.map((e) => e.getBoundingClientRect().height);
        flushSync(() => setPhase(next === "opening" ? "opening" : "folded"));
        const to = parts.map((e) => e.getBoundingClientRect().height);
        flushSync(() => setPhase(next));
        parts.forEach((e, i) => {
            e.style.height = `${from[i]}px`;
            e.style.overflow = "hidden";
        });
        const timing = { duration: MOTION.durMacro, ease: MOTION.easeFluid };
        const extra = [...(limitsBox.current?.querySelectorAll<HTMLElement>("[data-council-limit-extra]") ?? [])];
        const controls = [
            ...parts.map((e, i) => animate(e, { height: [from[i], to[i]] }, timing)),
            ...(extra.length > 0 ? [animate(extra, { opacity: next === "opening" ? [0, 1] : [1, 0] }, timing)] : []),
        ];
        moving.current = { stop: () => controls.forEach((c) => c.stop()) };
        void controls[0].then(() => {
            // the settled phase is drawn before the heights are let go: unpinned while still closing, the whole text would
            // flash back for a frame, and a cut text is what the folded height is measured on
            flushSync(() => setPhase((p) => foldSettle(p)));
            parts.forEach((e) => {
                e.style.height = "";
                e.style.overflow = "";
            });
            extra.forEach((e) => (e.style.opacity = ""));
            moving.current = null;
        });
    };
    return (
        <article data-council-item data-item-kind="question" className="flex justify-end">
            <div
                data-council-question-fold={phase}
                className={cn(
                    "flex min-w-0 max-w-[640px] flex-col gap-[8px] rounded-[16px_16px_4px_16px] border px-4 py-3",
                    TONE_BUBBLE[item.tone]
                )}
            >
                <div className="flex flex-wrap items-center gap-[7px] text-[12.5px]">
                    <span className={cn("font-semibold", TONE_TEXT[item.tone])}>{item.name}</span>
                    <span className="text-muted">{item.label}</span>
                    <PostTime at={item.at} when={item.when} />
                </div>
                {/* the type sits on the wrapper, so its line box and the text's agree and the height it moves is the text's */}
                <div ref={textBox} data-council-question-box className="text-[15px] leading-[1.55] text-primary">
                    <span
                        data-council-question
                        className={cn("whitespace-pre-wrap break-words", view.clamp && "line-clamp-3")}
                    >
                        {item.text}
                    </span>
                </div>
                {item.limits.length > 0 && (
                    <div ref={limitsBox} data-council-limits className="flex flex-wrap items-center gap-[6px]">
                        <span className="mr-[2px] text-[12.5px] font-semibold text-muted">Keep to</span>
                        {limits.map((limit, i) => (
                            <span
                                key={i}
                                data-council-limit
                                data-council-limit-extra={i >= LIMITS_FOLDED ? "" : undefined}
                                className="rounded-[6px] bg-accent/12 px-[8px] py-[2px] text-[13px] leading-[1.45] text-secondary"
                            >
                                {limit}
                            </span>
                        ))}
                        {phase === "folded" && hidden > 0 && (
                            <button
                                type="button"
                                onClick={toggle}
                                className="cursor-pointer rounded-[4px] border-0 bg-transparent px-[4px] text-[13px] text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                +{hidden} more
                            </button>
                        )}
                    </div>
                )}
                {foldable && (
                    <button
                        type="button"
                        data-council-question-toggle
                        aria-expanded={view.expanded}
                        onClick={toggle}
                        className="flex w-fit cursor-pointer items-center gap-[4px] rounded-[4px] border-0 bg-transparent p-0 text-[12.5px] text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        {view.expanded ? "Show less" : "Show more"}
                        {view.expanded ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
                    </button>
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

// a seat at work: its avatar and a bubble of three dots that rise in turn, as a messenger shows someone typing (the
// words stay for a screen reader); a seat waiting on its own agent says what it waits for instead. In a thread the
// idea it replies on goes without saying.
function TypingLine({ item, inThread }: { item: TypingRow; inThread?: boolean }) {
    return (
        <div
            data-council-item
            data-item-kind="typing"
            data-council-typing-row={item.author}
            data-waiting={item.waiting ? "true" : undefined}
            data-item-on={item.proposalid || undefined}
            className="flex items-center gap-[8px]"
        >
            <CouncilAvatar tone={item.tone} name={item.name} initials={item.initials} dashed={item.waiting} />
            {item.waiting ? (
                <span data-council-typing className="text-[13px] text-muted">
                    {item.text}
                </span>
            ) : (
                <span
                    data-council-typing
                    role="status"
                    className={cn(
                        "flex items-center gap-[4px] rounded-[4px_14px_14px_14px] border px-[13px] py-[11px]",
                        TONE_BUBBLE[item.tone],
                        TONE_TEXT[item.tone]
                    )}
                >
                    <span className="sr-only">{item.text}</span>
                    {TYPING_LAGS.map((lag) => (
                        <span
                            key={lag}
                            aria-hidden
                            data-pulse-lag={lag}
                            className="pulse-typing h-[6px] w-[6px] rounded-full bg-current"
                        />
                    ))}
                </span>
            )}
            {!inThread && item.on !== "" && (
                <span className="flex min-w-0 items-center gap-[5px] text-[12px] text-muted">
                    <CornerDownRight size={11} aria-hidden className="flex-none" />
                    <span className="min-w-0 truncate">{item.on}</span>
                </span>
            )}
        </div>
    );
}

// each typing dot's step behind the first, in ms of pulse.ts's 1.2 s pulse-typing
const TYPING_LAGS = [0, 160, 320];

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

// the council message box at its tallest: five lines of 21px (14px at leading 1.5) inside its 4.5px padding
const COMPOSER_MAX_H = 5 * 21 + 9;

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
    // a message to the whole council is taken up by the router, which picks the seat or two that answer it
    const routed = routedMessage(c, proposalId, "", text, joining);
    const reads = readsFiles(drafts.tools, text, attached, routed);
    // Read files on Auto and nothing locking it: the router decides it for a message it takes, and Tools is the guess
    const toolsAuto = drafts.tools == null && !reads.locked;
    const est = useEstimate(
        k > 0
            ? routed
                ? { id: c.id, routed: true, tools: reads.on, toolsauto: toolsAuto || undefined }
                : {
                      id: c.id,
                      followup: experts > 0 ? experts : undefined,
                      agents: chatTabs.length > 0 ? chatTabs : undefined,
                      tools: reads.on,
                  }
            : null
    );
    const hint = routed
        ? followUp
            ? routedLabel(est)
            : ROUTER_PICKS_WHO
        : k > 0
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
            // Auto, and nothing locks it: `tools` is only the guess, and the router decides it for a message it takes
            toolsauto: toolsAuto ? true : undefined,
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
    // All seats puts `@all ` in: the router is skipped and every seat answers
    const chooseAll = () => {
        if (picker != null) {
            put(insertAllMention(text, picker.start, caret));
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
    // the row the keys are on, counted across All seats, the seats, the files and then the chats
    const active = Math.min(pick, Math.max(rowCount - 1, 0));
    const chooseRow = (i: number) => {
        const row = pickRows[i];
        if (row?.kind === "all") {
            chooseAll();
        } else if (row?.kind === "seat") {
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
    // the box grows with what it holds, a line that wraps as much as one after Enter (counting Enter alone kept a long
    // line at one row, its first line cut off above), up to COMPOSER_MAX_H; past it, it scrolls
    useLayoutEffect(() => {
        const el = box.current;
        if (el == null) {
            return;
        }
        el.style.height = "auto";
        const want = el.scrollHeight + el.offsetHeight - el.clientHeight;
        el.style.height = `${Math.min(want, COMPOSER_MAX_H)}px`;
        el.style.overflowY = want > COMPOSER_MAX_H ? "auto" : "hidden";
    }, [text]);
    // the rows count across All seats (one, first), the seats, the files and the chats, as pickerRows lists them
    const allRows = picker?.all ? 1 : 0;
    const seatsEnd = allRows + (picker?.seats.length ?? 0);
    const filesEnd = seatsEnd + (picker?.files.length ?? 0);
    const groups =
        picker == null
            ? 0
            : [allRows + picker.seats.length, picker.files.length, picker.chats.length].filter((n) => n > 0).length;

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
                    {allRows + picker.seats.length > 0 && groups > 1 && (
                        <li role="presentation" className="px-[8px] pb-[2px] pt-[4px] text-[12px] text-muted">
                            Seats
                        </li>
                    )}
                    {picker.all && (
                        <li
                            role="option"
                            aria-selected={active === 0}
                            data-selected={active === 0}
                            data-council-mention-all
                            onMouseDown={(e) => {
                                e.preventDefault();
                                chooseAll();
                            }}
                            className={cn(
                                "flex cursor-pointer items-center gap-[8px] rounded-[6px] px-[8px] py-[5px] text-[13px]",
                                active === 0 ? "bg-surface-hover text-primary" : "text-secondary"
                            )}
                        >
                            <span className="font-semibold">All seats</span>
                            <span className="text-[12px] text-muted">@all · everyone answers</span>
                        </li>
                    )}
                    {picker.seats.map((s, j) => {
                        const i = allRows + j;
                        return (
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
                        );
                    })}
                    {picker.files.length > 0 && (
                        <li
                            role="presentation"
                            data-council-files
                            className={cn(
                                "flex flex-col",
                                allRows + picker.seats.length > 0 && "mt-[4px] border-t border-edge-mid pt-[4px]"
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
                                allRows + picker.seats.length + picker.files.length > 0 &&
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
            {/* 23px: the round send button's 15 plus the 8 around it, so the corners run with it and one line is a pill */}
            <div className="flex flex-col gap-[8px] rounded-[23px] border border-edge-mid bg-surface py-[8px] pl-[14px] pr-[8px] focus-within:border-accent">
                <DraftImages councilId={c.id} boxKey={proposalId} images={images} />
                <div className="flex items-end gap-[8px]">
                    <textarea
                        ref={box}
                        data-council-composer-input
                        rows={1}
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
                            // a line (21px) padded to the send button's 30px, so one line sits level with it and
                            // not at the foot of the row; more lines grow above the button, which stays at the foot
                            "box-border min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent px-0 py-[4.5px] text-[14px] leading-[1.5] text-primary outline-none placeholder:text-muted"
                        )}
                    />
                    {/* a round send button, as a messenger has: the icon alone, its name for a screen reader and the tooltip */}
                    <button
                        type="button"
                        data-council-composer-send
                        disabled={text.trim() === "" || busy || uploading}
                        onClick={() => void send()}
                        aria-label={busy ? "Sending…" : sendLabel}
                        title={uploading ? "Waiting for an image to finish uploading" : `${sendLabel} (Enter)`}
                        className="flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-accent text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
                    >
                        {busy ? (
                            <Loader2 size={15} aria-hidden className="animate-spin motion-reduce:animate-none" />
                        ) : (
                            <SendHorizontal size={15} strokeWidth={2.2} aria-hidden />
                        )}
                    </button>
                </div>
            </div>
            {/* the switch and the cost line share one row under the box; the cost line wraps under the switch when
                the thread panel is too narrow for both */}
            <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[2px]">
                {followUp && (
                    <div
                        role="group"
                        aria-label="Read files"
                        title="Whether the seats that answer read the project's files"
                        data-council-tools
                        // the person's pick (an image or an @file locks it on On); `on` is whether the seats read files
                        // now, and `why` what decided it (a named file, an image, or the router)
                        data-council-tools-state={readsChoice(drafts.tools, reads.locked)}
                        data-council-tools-on={reads.on ? "true" : "false"}
                        data-council-tools-why={reads.why}
                        data-council-tools-locked={reads.locked ? "true" : undefined}
                        className="flex w-fit items-center gap-[7px] text-[12.5px] text-secondary"
                    >
                        <span>Read files</span>
                        <span className="inline-flex overflow-hidden rounded-[6px] border border-edge-mid">
                            {(["auto", "on", "off"] as const).map((option) => {
                                const pressed = readsChoice(drafts.tools, reads.locked) === option;
                                return (
                                    <button
                                        key={option}
                                        type="button"
                                        aria-pressed={pressed}
                                        // an image or an @file is read by the seats that answer it: only On stays
                                        disabled={reads.locked && option !== "on"}
                                        data-council-tools-option={option}
                                        onClick={() => {
                                            if (!reads.locked) {
                                                setDrafts((d) => ({ ...d, tools: toolsOfChoice(option) }));
                                            }
                                        }}
                                        className={cn(
                                            "h-[20px] border-0 px-[8px] text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                            reads.locked ? "cursor-default" : "cursor-pointer",
                                            pressed
                                                ? "bg-surface-hover font-semibold text-primary"
                                                : "bg-transparent text-muted hover:text-secondary"
                                        )}
                                    >
                                        {option === "auto" ? "Auto" : option === "on" ? "On" : "Off"}
                                    </button>
                                );
                            })}
                        </span>
                        {readsNote(reads) !== "" && (
                            <span data-council-tools-note className="text-muted">
                                · {readsNote(reads)}
                            </span>
                        )}
                    </div>
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

// what the newest seat answer in a thread suggests the person send next (threadAsks), over the thread's box: a click
// puts it in the box to edit and send, as Ask next does; sending at once would spend a seat's turn on a guess
function ThreadAsks({ c, proposalId, asks }: { c: Council; proposalId: string; asks: string[] }) {
    const setDrafts = useSetAtom(councilChatDraftAtom(c.id));
    const fill = (t: string) => {
        setDrafts((d) => ({ ...d, texts: { ...d.texts, [proposalId]: t } }));
        requestAnimationFrame(() => {
            const box = document.querySelector<HTMLTextAreaElement>(
                '[data-council-composer="thread"] [data-council-composer-input]'
            );
            box?.focus();
            box?.setSelectionRange(t.length, t.length);
        });
    };
    return (
        <div
            role="group"
            aria-label="Suggested replies"
            data-council-thread-asks
            className="flex flex-none flex-wrap justify-end gap-[6px] px-3 pt-[8px]"
        >
            {asks.map((a, i) => (
                <button
                    key={a}
                    type="button"
                    data-council-thread-ask={i}
                    onClick={() => fill(a)}
                    title="Put it in the box to edit and send"
                    className="max-w-full cursor-pointer truncate rounded-full border border-edge-mid bg-transparent px-[12px] py-[4px] text-left text-[13px] text-secondary outline-none hover:border-edge-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {a}
                </button>
            ))}
        </div>
    );
}

// the person's newest post's Sent / Seen and whether the typing bubbles wait (councilseen.ts), drawn again when either
// changes by itself, a second after the send
function useSendState(items: readonly (ChannelItem | ThreadItem)[]): SendState {
    const [, redraw] = useState(0);
    const state = sendState(items, Date.now());
    useEffect(() => {
        if (state.nextMs <= 0) {
            return;
        }
        const t = setTimeout(() => redraw((n) => n + 1), state.nextMs);
        return () => clearTimeout(t);
    }, [state.nextMs]);
    return state;
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

// the idea on top of its thread: its title and argument as the board draws them, with its time and the person's thumbs at the
// right end of its header on hover or focus, then its evidence, and under it the seats that agreed with it, the like or
// dislike that is on and the seats that picked it
function ThreadIdea({ c, thread, acts }: { c: Council; thread: Extract<ChatThread, { kind: "idea" }>; acts: Actions }) {
    const idea = thread.idea;
    return (
        <article data-council-post={idea.id} className="group/reply flex flex-col gap-[8px]">
            <h2
                className={cn(
                    "m-0 text-[15px] font-semibold leading-[1.4]",
                    idea.out != null ? "text-muted line-through" : "text-primary"
                )}
            >
                {idea.title}
            </h2>
            <div className="relative flex flex-wrap items-center gap-[7px] text-[12px] text-muted">
                <span className="text-secondary">{idea.name}</span>
                {idea.wild ? <CouncilPill word={idea.label} tone="neutral" /> : <span>{idea.label}</span>}
                {idea.out != null && <OutPill out={idea.out} />}
                {c.finalpick === idea.id && <PinnedPill id={idea.id} />}
                {idea.edited && <span>edited</span>}
                <HoverEnd>
                    <PostTime at={idea.at} when={idea.when} />
                    <MessageTools c={c} id={idea.id} acts={acts} />
                    <Thumbs councilId={c.id} item={idea.id} thumb={idea.thumb} acts={acts} />
                    <Chot councilId={c.id} item={idea.id} text={idea.title} acts={acts} />
                </HoverEnd>
            </div>
            <CouncilText text={idea.text} className="text-[13.5px] leading-[1.55]" />
            <EvidenceChips {...idea.claim} source={{ councilId: c.id, owner: idea.id, title: idea.title }} />
            {(idea.agrees.length > 0 || idea.thumb !== "" || idea.picks != null) && (
                <div className="flex flex-wrap items-center gap-[6px]">
                    {idea.agrees.map((text, i) => (
                        <Reaction key={i} text={text} />
                    ))}
                    <ThumbChip councilId={c.id} item={idea.id} thumb={idea.thumb} acts={acts} />
                    {idea.picks != null && (
                        <span
                            data-council-picks
                            title={idea.picks.title}
                            className="rounded-full bg-pill px-[8px] py-px text-[12px] font-semibold text-secondary"
                        >
                            {idea.picks.label}
                        </span>
                    )}
                </div>
            )}
        </article>
    );
}

// what the rail's second tab names: `Idea 2 · 14 replies`, `Idea 2 · draft`, `Chat`
function threadTab(thread: ChatThread, n: number | undefined): string {
    if (thread.kind === "chat") {
        return "Chat";
    }
    const idea = n == null ? "Idea" : `Idea ${n}`;
    return thread.kind === "idea" ? `${idea} · ${thread.idea.thread.label}` : `${idea} · draft`;
}

/** The Ideas rail's second tab, an idea's thread: the idea, its replies with their stance pills, the held reply drafts
 *  with Send / Edit / Drop, and a reply box that names who answers; or a held idea's draft. The rail draws its tab and
 *  its close button. */
function ThreadPanel({
    c,
    thread,
    acts,
    chats,
}: {
    c: Council;
    thread: ChatThread;
    acts: Actions;
    chats: readonly SeatableAgent[];
}) {
    const scroller = useRef<HTMLDivElement>(null);
    const send = useSendState(thread.items);
    const items = useMemo(() => shownItems(thread.items, send.holdTyping), [thread.items, send.holdTyping]);
    // a reply box only on a sent idea: a held one has no thread yet, and the Chat's box is the one under the list
    const replies = thread.kind === "idea";
    // what the newest seat answer suggests sending next: it stays while the person types, and a click replaces the text
    const asks = replies ? threadAsks(items) : [];
    const onScroll = useKeptScroll(scroller, `thread:${c.id}:${thread.id}`, {
        follow: true,
        start: "top",
        count: items.length,
        sent: ownPosts(items),
    });
    const entering = useEntering(
        `${c.id}:${thread.id}`,
        thread.items.map((item) => item.id)
    );
    return (
        <div
            id="council-rail-thread"
            role="tabpanel"
            data-council-thread={thread.id}
            data-thread-kind={thread.kind}
            tabIndex={-1}
            aria-label={thread.kind === "chat" ? "Chat" : "Thread"}
            className="flex min-h-0 flex-1 flex-col outline-none"
        >
            <div
                ref={scroller}
                onScroll={onScroll}
                className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-6 pb-4 pt-[10px]"
            >
                {thread.kind === "idea" && (
                    <>
                        <ThreadIdea c={c} thread={thread} acts={acts} />
                        <div
                            data-council-thread-count
                            className="flex items-center gap-[10px] text-[12.5px] text-muted"
                        >
                            {thread.idea.thread.label}
                            <span aria-hidden className="h-px flex-1 bg-edge-faint" />
                        </div>
                    </>
                )}
                {thread.kind === "held" && <DraftCard key={thread.id} c={c} item={thread.draft} acts={acts} />}
                {thread.kind === "chat" && thread.question != null && <QuestionMessage item={thread.question} />}
                {thread.kind === "chat" && items.length === 0 && (
                    <span className="text-[13px] text-muted">
                        No messages yet. Write to everyone in the box under the list, or @ one seat.
                    </span>
                )}
                {items.map((item: ThreadItem) =>
                    item.kind === "reply" ? (
                        <ReplyMessage
                            key={item.id}
                            c={c}
                            item={item}
                            acts={acts}
                            rise={item.mine && entering.has(item.id)}
                            status={send.status?.postId === item.id ? send.status : undefined}
                        />
                    ) : item.kind === "draft" ? (
                        <DraftCard key={item.id} c={c} item={item} acts={acts} />
                    ) : (
                        <TypingLine key={item.id} item={item} />
                    )
                )}
            </div>
            {asks.length > 0 && <ThreadAsks c={c} proposalId={thread.id} asks={asks} />}
            {replies && (
                <div className="flex-none px-3 pb-4 pt-[10px]">
                    <span id="council-thread-reply-label" className="sr-only">
                        Reply in the thread
                    </span>
                    <Composer
                        c={c}
                        scope="thread"
                        proposalId={thread.id}
                        placeholder="Reply · @ seat or file · paste an image"
                        sendLabel="Reply"
                        labelledBy="council-thread-reply-label"
                        returnTo={() => document.querySelector<HTMLElement>("[data-council-thread]")}
                        chats={chats}
                    />
                </div>
            )}
        </div>
    );
}

// the rail's tabs, in the order they are drawn: the ideas, the council's Memory, and an open idea's thread
type RailTabName = "ideas" | "memory" | "thread";

// one of the Ideas rail's tabs: a word underlined while its tab shows
function RailTab({
    on,
    controls,
    onClick,
    children,
    ...rest
}: {
    on: boolean;
    controls: string;
    onClick: () => void;
    children: ReactNode;
} & Record<`data-${string}`, string>) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={controls}
            onClick={onClick}
            {...rest}
            className={cn(
                "min-w-0 cursor-pointer truncate border-0 border-b-2 bg-transparent px-0 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                on ? "border-primary font-semibold text-primary" : "border-transparent text-muted hover:text-secondary"
            )}
        >
            {children}
        </button>
    );
}

// A group's dot in the header and the bar down its rows, by tone: whole class names, so Tailwind finds them, all from the
// `@theme` tokens. Waiting on you (`muted`) draws no bar; the two quiet groups draw it at 60%.
const GROUP_DOT: Record<StanceTone, string> = {
    muted: "bg-muted ring-muted/35",
    success: "bg-success ring-success/35",
    warning: "bg-warning ring-warning/35",
    error: "bg-error ring-error/35",
    "ink-faint": "bg-ink-faint ring-ink-faint/35",
    "edge-strong": "bg-edge-strong ring-edge-strong/60",
};
const GROUP_BAR: Record<StanceTone, string> = {
    muted: "bg-transparent",
    success: "bg-success",
    warning: "bg-warning",
    error: "bg-error",
    "ink-faint": "bg-ink-faint opacity-60",
    "edge-strong": "bg-edge-strong opacity-60",
};

/** The Ideas rail's first tab, shaped like the brainstorm's Decided so far (board Ideas-by-stance in
 *  .superpowers/design/council-ideas-memory): the ideas in groups by where the seats stand (stanceGroups), each under a
 *  header with a dot in its colour, its name in words and a count; per idea a bar in its group's colour, its number and
 *  author, its title, and a quiet line with its replies and the stances on it. The grouping is derived on every render,
 *  so an idea moves group as a stance changes. A click scrolls the channel to the idea and puts the j / k cursor on it;
 *  the idea's own replies button opens its thread. */
function IdeasList({
    ideas,
    on,
    freshOnly,
    onPick,
    onFreshOnly,
}: {
    ideas: readonly IdeaRow[];
    on: string | null; // the idea under the cursor or with its thread open
    freshOnly: boolean; // only the ideas with new replies (the caption's toggle); all of them once none has any
    onPick: (row: IdeaRow) => void;
    onFreshOnly: (only: boolean) => void;
}) {
    const withFresh = ideas.filter((r) => r.fresh > 0).length;
    const filtering = freshOnly && withFresh > 0;
    const groups = stanceGroups(filtering ? ideas.filter((r) => r.fresh > 0) : ideas);
    return (
        <div
            id="council-rail-ideas"
            role="tabpanel"
            aria-label="Ideas"
            data-council-rail-ideas
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-[22px] pt-[4px] [scrollbar-gutter:stable]"
        >
            <div className="flex items-center gap-2 pb-[2px]">
                <span data-council-rail-caption className="min-w-0 flex-1 truncate text-[12px] text-muted">
                    {railOrderLabel()}
                </span>
                {withFresh > 0 && (
                    <button
                        type="button"
                        data-council-rail-fresh={filtering ? "on" : "off"}
                        aria-pressed={filtering}
                        onClick={() => onFreshOnly(!filtering)}
                        title={filtering ? "Show every idea" : "Show only the ideas with new replies"}
                        className={cn(
                            "inline-flex h-[22px] flex-none cursor-pointer items-center gap-[5px] rounded-full border px-[8px] text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            filtering
                                ? "border-accent bg-accentbg font-semibold text-accent"
                                : "border-edge-mid bg-transparent text-secondary hover:border-edge-strong hover:bg-surface-hover"
                        )}
                    >
                        <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-accent" />
                        {withFresh} with new replies
                    </button>
                )}
            </div>
            {ideas.length === 0 && (
                <p className="m-0 border-t border-border pt-[12px] text-[12.5px] leading-[1.5] text-muted">
                    Each idea lands here as a seat proposes it.
                </p>
            )}
            {groups.map((g) => {
                // the quiet groups read dimmer: what waits on the person, and what is out of the running
                const quiet = g.key === "waiting" || g.key === "withdrawn";
                return (
                    <div
                        key={g.key}
                        role="group"
                        aria-label={`${g.label}, ${g.rows.length}`}
                        data-council-rail-group={g.key}
                        className="flex flex-none flex-col"
                    >
                        <div className="flex items-center gap-2 pb-[6px] pt-[14px] text-[12px] font-semibold text-secondary">
                            <span
                                aria-hidden
                                data-council-rail-dot
                                className={cn("h-[8px] w-[8px] flex-none rounded-full ring-1", GROUP_DOT[g.tone])}
                            />
                            <span data-council-rail-group-name>{g.label}</span>
                            <span data-council-rail-group-count className="font-normal tabular-nums text-muted">
                                {g.rows.length}
                            </span>
                        </div>
                        {g.rows.map((row) => {
                            const meta = railMeta(row);
                            return (
                                <button
                                    key={row.id}
                                    type="button"
                                    data-council-rail-idea={row.id}
                                    data-on={row.id === on ? "true" : undefined}
                                    onClick={() => onPick(row)}
                                    className={cn(
                                        "-mx-2 flex flex-none cursor-pointer gap-[10px] border-0 border-t border-border px-2 py-[10px] text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                                        // the row under the cursor wears the accent ring its message in the channel wears
                                        row.id === on
                                            ? "rounded-[6px] bg-surface-selected ring-2 ring-inset ring-accent"
                                            : "bg-transparent"
                                    )}
                                >
                                    <span
                                        aria-hidden
                                        data-council-rail-bar={g.tone}
                                        className={cn(
                                            "w-[3px] flex-none self-stretch rounded-[2px]",
                                            GROUP_BAR[g.tone]
                                        )}
                                    />
                                    <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
                                        <span data-council-rail-who className="text-[11px] text-muted">
                                            <span className={row.id === on ? "font-semibold text-accent" : undefined}>
                                                Idea {row.n}
                                            </span>{" "}
                                            · {row.name}
                                            {row.isNew && <span className="text-accent-soft"> · new</span>}
                                            {row.freshLabel !== "" && (
                                                <span data-council-rail-fresh-row className="font-semibold text-accent">
                                                    {" "}
                                                    · {row.freshLabel}
                                                </span>
                                            )}
                                        </span>
                                        <span
                                            data-council-rail-title
                                            className={cn(
                                                "text-[12.5px] leading-[1.45]",
                                                quiet ? "text-muted" : "text-secondary",
                                                g.key === "withdrawn" && "line-through"
                                            )}
                                        >
                                            {row.title}
                                        </span>
                                        {meta !== "" && (
                                            <span data-council-rail-meta className="text-[12px] text-muted">
                                                {meta}
                                            </span>
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

/** The rail beside the channel (board A-decided-rail): Ideas on its first tab, the council's Memory on its second (its
 *  chosen direction, councilmemory.tsx; a small dot marks a card that waits), and once an idea's replies are opened its
 *  thread on a third (board A2-decided-rail-thread), so the channel never shares the pane with two columns. The close
 *  button closes the thread; with none open, the rail folds (councilIdeasRailFoldedAtom). */
function CouncilRail({
    c,
    ideas,
    thread,
    n,
    tab,
    on,
    acts,
    chats,
    onTab,
    onPick,
    onClose,
    onFold,
    onShow,
    onOpenSource,
    freshOnly,
    onFreshOnly,
}: {
    c: Council;
    ideas: readonly IdeaRow[];
    thread: ChatThread | null;
    n: number | undefined;
    tab: RailTabName;
    on: string | null;
    acts: Actions;
    chats: readonly SeatableAgent[];
    freshOnly: boolean;
    onFreshOnly: (only: boolean) => void;
    onTab: (tab: RailTabName) => void;
    onPick: (row: IdeaRow) => void;
    onClose: () => void;
    onFold: () => void;
    onShow: (ids: readonly string[]) => boolean;
    onOpenSource: (source: DirectionSource) => void;
}) {
    const shows: RailTabName = tab === "memory" ? "memory" : thread != null && tab === "thread" ? "thread" : "ideas";
    return (
        <aside
            data-council-rail
            data-rail-tab={shows}
            aria-label="Ideas rail"
            className="flex h-full min-h-0 w-[380px] flex-none flex-col border-l border-edge-faint bg-background"
        >
            <div
                role="tablist"
                aria-label="Ideas rail"
                className="flex h-[44px] flex-none items-stretch gap-4 pl-6 pr-3"
            >
                <RailTab
                    on={shows === "ideas"}
                    controls="council-rail-ideas"
                    onClick={() => onTab("ideas")}
                    data-council-rail-tab="ideas"
                >
                    Ideas · {ideas.length}
                </RailTab>
                <RailTab
                    on={shows === "memory"}
                    controls="council-rail-memory"
                    onClick={() => onTab("memory")}
                    data-council-rail-tab="memory"
                >
                    Memory
                    {memoryDot(c) && (
                        <span
                            role="img"
                            aria-label="A suggestion or a held direction waits for you"
                            data-council-memory-dot
                            className="ml-[5px] inline-block h-[6px] w-[6px] rounded-full bg-accent-soft align-middle"
                        />
                    )}
                </RailTab>
                {thread != null && (
                    <RailTab
                        on={shows === "thread"}
                        controls="council-rail-thread"
                        onClick={() => onTab("thread")}
                        data-council-rail-tab="thread"
                    >
                        {threadTab(thread, n)}
                    </RailTab>
                )}
                <span className="flex-1" />
                {thread != null ? (
                    <button
                        type="button"
                        data-council-thread-close
                        aria-label="Close the thread (Esc)"
                        title="Close the thread (Esc)"
                        onClick={onClose}
                        className="flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center self-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <X size={15} strokeWidth={2} aria-hidden />
                    </button>
                ) : (
                    <button
                        type="button"
                        data-council-rail-fold
                        aria-label="Fold the Ideas rail"
                        title="Fold the Ideas rail"
                        onClick={onFold}
                        className="flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center self-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <ChevronsRight size={15} strokeWidth={2} aria-hidden />
                    </button>
                )}
            </div>
            {shows === "thread" && thread != null ? (
                <ThreadPanel c={c} thread={thread} acts={acts} chats={chats} />
            ) : shows === "memory" ? (
                <MemoryPanel key={c.id} c={c} acts={acts} onShow={onShow} onOpenSource={onOpenSource} />
            ) : (
                <IdeasList ideas={ideas} on={on} freshOnly={freshOnly} onPick={onPick} onFreshOnly={onFreshOnly} />
            )}
            <CouncilDetailsFoot c={c} />
        </aside>
    );
}

// ---- the chat ----

/** Keeps a council scroller where the reader left it, under `key` (councilscroll.ts): back there after a remount (another
 *  council, the Summary, another agent) and after the surface comes back from display:none, which drops an element's
 *  offset. With `follow`, a reader at the bottom stays at the bottom as `count` grows. A scroller with nothing kept
 *  starts at `start`: the end by default when it follows, else the top. One more of the person's own posts (`sent`,
 *  councilscroll.ownPosts) brings the end into view wherever the reader was, so what they just sent shows. Returns the
 *  scroller's onScroll. */
export function useKeptScroll(
    ref: RefObject<HTMLElement | null>,
    key: string,
    {
        follow = false,
        count = 0,
        start,
        sent = 0,
    }: { follow?: boolean; count?: number; start?: "top" | "end"; sent?: number } = {}
): () => void {
    const startAtEnd = (start ?? (follow ? "end" : "top")) === "end";
    const place = useRef<ScrollPlace | undefined>(undefined);
    const restore = useCallback(() => {
        const el = ref.current;
        if (el != null && el.clientHeight > 0) {
            el.scrollTop = topFor(place.current, el, startAtEnd);
            // measured where it opened, so one that opens at the top follows new lines only once the reader is at the end
            place.current ??= placeOf(el);
        }
    }, [ref, startAtEnd]);
    useLayoutEffect(() => {
        place.current = keptPlace(key);
        restore();
    }, [key, restore]);
    useLayoutEffect(() => {
        if (followsEnd(place.current, follow)) {
            restore();
        }
    }, [count, follow, restore]);
    const sentWas = useRef({ key, n: sent });
    useLayoutEffect(() => {
        const was = sentWas.current;
        sentWas.current = { key, n: sent };
        const el = ref.current;
        if (sentSince(was, key, sent) && el != null && el.clientHeight > 0) {
            el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
            place.current = placeOf(el);
            keepPlace(key, place.current);
        }
    }, [ref, key, sent]);
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

// Brings `row` into view by moving `box` alone (revealTop): scrollIntoView also scrolls every box around it, up to the
// window, and pushed the whole app up off its frame
function revealIn(
    box: HTMLElement | null | undefined,
    row: Element | null | undefined,
    block: RevealBlock,
    smooth = false
) {
    if (box == null || row == null) {
        return;
    }
    const top = revealTop(contentBox(row, box), box, block);
    if (top != null) {
        box.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    }
}

// where a revealed message lands (revealTarget): the row to find, whether it rings, the idea whose thread to open and the
// idea to put the keyboard cursor on
type RevealLanding = { selector: string; ring: boolean; open: string | null; focus: string | null };

// how many frames the find waits for the row to be drawn (a thread's reply, after the thread opened): about a second
const REVEAL_FRAMES = 60;

// Pure: where to show the idea or reply `id` of `c`, or null for an id it lacks. An idea is in the channel, under the
// cursor; a reply is in its idea's thread (opened first), or in the channel when it has no idea
function revealTarget(c: Council, id: string): RevealLanding | null {
    if ((c.proposals ?? []).some((p) => p.id === id)) {
        return { selector: `[data-council-channel] [data-council-idea="${id}"]`, ring: false, open: null, focus: id };
    }
    const reply = (c.replies ?? []).find((r) => r.id === id);
    if (reply == null) {
        return null;
    }
    const post = `[data-council-reply-post="${id}"]`;
    return reply.proposalid === ""
        ? { selector: `[data-council-channel] ${post}`, ring: true, open: null, focus: null }
        : {
              selector: `[data-council-thread="${reply.proposalid}"] ${post}`,
              ring: true,
              open: reply.proposalid,
              focus: null,
          };
}

// the box a row scrolls in: its nearest ancestor that scrolls up and down
function scrollerOf(row: Element): HTMLElement | null {
    for (let el = row.parentElement; el != null; el = el.parentElement) {
        const y = getComputedStyle(el).overflowY;
        if ((y === "auto" || y === "scroll") && el.scrollHeight > el.clientHeight) {
            return el;
        }
    }
    return null;
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
                className="flex size-[28px] cursor-pointer items-center justify-center rounded-full border border-edge-strong bg-surface-raised text-[14px] leading-none text-secondary shadow-popover-sm outline-none hover:border-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
            >
                <span aria-hidden>{children}</span>
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
    sent,
    boxRef,
}: {
    children: ReactNode;
    councilId: string;
    view: string;
    count: number;
    sent: number; // the person's own posts in it (councilscroll.ownPosts)
    boxRef: RefObject<HTMLDivElement | null>;
}) {
    const rowsRef = useRef<HTMLDivElement>(null);
    const onKeptScroll = useKeptScroll(boxRef, `channel:${councilId}`, { follow: true, count, sent });
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
                    ↑
                </JumpPill>
                <JumpPill
                    show={jumps.pills.back}
                    jump="back"
                    label="Back to the message you were reading"
                    onClick={jumps.back}
                >
                    ↩
                </JumpPill>
                <JumpPill show={jumps.pills.latest} jump="latest" label="Jump to the latest" onClick={jumps.toLatest}>
                    ↓
                </JumpPill>
            </div>
        </div>
    );
}

/** The council's discussion as a channel with threads. `notes` is what the discussion draws above the channel (the failed
 *  summary and its Retry); `onOpenTerminal` takes an agent's tab id, `onReopenSession` a closed chat seat's transcript
 *  (its session opened again, asleep); `chats` are the live claude and pi chats the composers' `@` can add to the council
 *  (the cockpit's roster by the one seat rule, seated ones included: the picker lists the ones no seat holds). */
export function CouncilChat({
    c,
    acts,
    chats,
    notes,
    onOpenTerminal,
    onReopenSession,
    onOpenFile,
}: {
    c: Council;
    acts: Actions;
    chats: readonly SeatableAgent[];
    notes?: ReactNode;
    onOpenTerminal: (tab: string) => void;
    onReopenSession: (transcript: string) => void;
    onOpenFile?: (path: string, line?: number) => void;
}) {
    const [openId, setOpenId] = useAtom(councilOpenProposalAtom(c.id));
    const [sources, setSources] = useAtom(councilSourcesAtom(c.id));
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const seatLinks = useMemo(
        () => ({ chats, open: onOpenTerminal, reopen: onReopenSession }),
        [chats, onOpenTerminal, onReopenSession]
    );
    const channel = useRef<HTMLDivElement>(null);
    // the idea a rail click is gliding to: the cursor's own reveal skips it once, or its instant scroll would cut the glide
    const picked = useRef<string | null>(null);
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
    const all = useMemo(() => councilChannel(c, onlyId ?? undefined), [c, onlyId]);
    // the rail's rows: New is measured against the time the person last left this council (councilopened.ts)
    const since = openedAt(useAtomValue(councilOpenedAtom), c.id);
    // a thread read in this visit clears its idea's fresh replies up to the newest it showed (councillistmodel.readFrom)
    const [read, setRead] = useAtom(councilThreadReadAtom(c.id));
    const list = useMemo(() => councilList(c, since, onlyId ?? undefined, read), [c, since, onlyId, read]);
    // an idea's number and its fresh replies are the same whatever the filter: read from the whole list
    const whole = useMemo(() => councilList(c, since, undefined, read), [c, since, read]);
    const numbers = useMemo(() => new Map(whole.ideas.map((r) => [r.id, r.n])), [whole]);
    const freshOf = useMemo(() => new Map(whole.ideas.map((r) => [r.id, r.freshLabel])), [whole]);
    const [freshOnly, setFreshOnly] = useState(false);
    // the open thread is read up to its newest reply, and stays read as replies land while it is open
    const readUpTo = openId == null || !threadOpen ? 0 : newestReplyOn(c, openId);
    useEffect(() => {
        if (openId != null && readUpTo > 0) {
            setRead((r) => ((r[openId] ?? 0) >= readUpTo ? r : { ...r, [openId]: readUpTo }));
        }
    }, [openId, readUpTo, setRead]);
    const [folded, setFolded] = useAtom(councilIdeasRailFoldedAtom);
    const [railTab, setRailTab] = useState<RailTabName>("thread");
    // a thread opened any way (its replies button, Enter on the cursor, the Summary's link) shows on the rail's second tab
    useEffect(() => {
        if (openId != null) {
            setRailTab("thread");
        }
    }, [openId]);
    const railShown = !folded || threadOpen;
    // the person's newest post's Sent / Seen, and the typing bubbles held a moment after it (councilseen.ts)
    const send = useSendState(all);
    const items = useMemo(() => shownItems(all, send.holdTyping), [all, send.holdTyping]);
    // Ask next stays while the person types: a click replaces what is in the box
    const asks = isFollowUp(c) ? askChips(c) : [];
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
    // a rail row brings its idea, or a held idea's draft, to the top of the channel under the cursor: a glide, so the eye
    // follows the channel to where it lands, or a jump with reduced motion
    const pick = useCallback((row: IdeaRow) => {
        picked.current = row.id;
        setFocusedId(row.id);
        const at = row.held ? `[data-council-draft="${row.id}"]` : `[data-council-idea="${row.id}"]`;
        const post = channel.current?.querySelector<HTMLElement>(at);
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        revealIn(channel.current, post, "start", smooth);
        // the idea rings wider for a moment where it lands, so the eye finds it; a second click restarts the moment
        if (post != null) {
            window.clearTimeout(Number(post.dataset.flashTimer));
            post.dataset.flash = "true";
            post.dataset.flashTimer = String(window.setTimeout(() => delete post.dataset.flash, FLASH_MS));
        }
    }, []);
    // the Memory tab's Show the messages: the channel scrolls to the first of them it draws: the message itself (an idea,
    // or a post of the channel), else, for a reply that lives in an idea's thread, that idea; the cursor goes to an idea.
    // False when none of them is in the channel (a dropped idea, a seat the filter leaves out), which the tab says.
    const showMessages = useCallback(
        (ids: readonly string[]): boolean => {
            for (const id of ids) {
                const parent = c.replies?.find((r) => r.id === id)?.proposalid ?? "";
                const targets = [
                    { at: `[data-council-idea="${id}"]`, idea: id },
                    { at: `[data-council-reply-post="${id}"]`, idea: null },
                    ...(parent === "" ? [] : [{ at: `[data-council-idea="${parent}"]`, idea: parent }]),
                ];
                for (const t of targets) {
                    const el = channel.current?.querySelector(t.at);
                    if (el != null) {
                        if (t.idea != null) {
                            setFocusedId(t.idea);
                        }
                        el.scrollIntoView?.({ block: "center" });
                        return true;
                    }
                }
            }
            return false;
        },
        [c]
    );
    // the chosen direction's source link opens the thread the idea or message lives in (an idea's own, else the Chat's)
    const openSource = useCallback(
        (s: DirectionSource) => {
            setOpenId(s.thread);
            if (s.kind === "idea") {
                setFocusedId(s.id);
            }
        },
        [setOpenId]
    );
    // p, the key for Chốt: pins the idea under the cursor (false for an id that is no idea the channel shows)
    const run = acts.run;
    const chotIdea = useCallback(
        (id: string): boolean => {
            const idea = items.find((i): i is IdeaPost => i.kind === "idea" && i.id === id);
            const text = idea == null ? "" : chotLine(idea.title);
            if (text === "") {
                return false;
            }
            void run(`direction:pin:${id}`, "Chốt", () => directionCouncil(c.id, "pin", text, id));
            return true;
        },
        [items, run, c.id]
    );
    const closeSources = useCallback(() => closeCouncilSources(c.id), [c.id]);
    // Escape closes the sources first, back to the thread they were opened from, then the thread
    const close = useCallback(
        () => (sourcesOpen ? closeSources() : setOpenId(null)),
        [sourcesOpen, closeSources, setOpenId]
    );
    const nav = useMemo<CouncilChatNav>(
        () => ({
            order,
            focusedId,
            openId: threadOpen ? openId : null,
            sourcesOpen,
            focus: setFocusedId,
            open,
            close,
            chot: chotIdea,
        }),
        [order, focusedId, openId, threadOpen, sourcesOpen, open, close, chotIdea]
    );
    useCouncilChatNav(nav);
    const bindings = useMemo(buildCouncilBindings, []);
    useKeybindings(bindings);
    // the cursor stays in view as j and k move it (a rail click already glides its idea in)
    useEffect(() => {
        const fromRail = picked.current === focusedId;
        picked.current = null;
        if (focusedId != null && !fromRail) {
            revealIn(channel.current, channel.current?.querySelector(`[data-council-idea="${focusedId}"]`), "nearest");
        }
    }, [focusedId]);

    // a request to show one message (councilreveal.ts: the Report's Final proposal, Open in Discussion), read once while
    // this council's chat is on screen and set back to null: an idea takes the keyboard cursor, a reply opens the thread
    // it sits in (it stays in the channel when it has no idea). The row is then found, centred in its box and, for a
    // reply, ringed (flashPost); the thread's row exists only after the thread has drawn, so the find waits for it
    const [revealed, setRevealed] = useAtom(councilRevealAtom);
    const [landing, setLanding] = useState<RevealLanding | null>(null);
    const councilNow = useRef(c);
    councilNow.current = c;
    useEffect(() => {
        if (revealed == null || revealed.councilId !== c.id) {
            return;
        }
        setRevealed(null);
        const target = revealTarget(councilNow.current, revealed.messageId);
        if (target == null) {
            return;
        }
        if (target.focus != null) {
            setFocusedId(target.focus);
        }
        if (target.open != null) {
            open(target.open);
        }
        setLanding(target);
    }, [revealed, c.id, setRevealed, open]);
    useEffect(() => {
        if (landing == null) {
            return;
        }
        let frame = 0;
        let tries = 0;
        const land = () => {
            const post = document.querySelector<HTMLElement>(landing.selector);
            if (post == null && ++tries < REVEAL_FRAMES) {
                frame = requestAnimationFrame(land);
                return;
            }
            if (post != null) {
                revealIn(scrollerOf(post), post, "center");
                if (landing.ring) {
                    flashPost(post);
                }
            }
            setLanding(null);
        };
        frame = requestAnimationFrame(land);
        return () => cancelAnimationFrame(frame);
    }, [landing]);

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
        <SeatLinks.Provider value={seatLinks}>
            <div className="flex min-h-0 flex-1">
                <div data-council-main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                    {!railShown && !sourcesOpen && (
                        <button
                            type="button"
                            data-council-rail-unfold
                            title="Show the Ideas rail"
                            onClick={() => setFolded(false)}
                            className="absolute right-6 top-3 z-20 flex h-[28px] cursor-pointer items-center gap-[6px] rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[12px] text-muted outline-none hover:border-edge-strong hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <ChevronsLeft size={13} strokeWidth={2} aria-hidden />
                            Ideas · {list.ideas.length}
                        </button>
                    )}
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
                        sent={ownPosts(items)}
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
                                            c={c}
                                            item={item}
                                            n={numbers.get(item.id)}
                                            acts={acts}
                                            open={threadOpen && item.id === openId}
                                            focused={item.id === focusedId}
                                            fresh={freshOf.get(item.id) ?? ""}
                                            onOpen={open}
                                        />
                                    );
                                case "draft":
                                    return <DraftCard key={item.id} c={c} item={item} acts={acts} />;
                                case "reply":
                                    return (
                                        <ReplyMessage
                                            key={item.id}
                                            c={c}
                                            item={item}
                                            acts={acts}
                                            onOpenIdea={open}
                                            rise={item.mine && entering.has(item.id)}
                                            status={send.status?.postId === item.id ? send.status : undefined}
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
                {/* the right column slides in from its edge and back out (sheetPanel) as the rail folds and unfolds; the
                Sources a citation opens take the rail's place in it without moving */}
                <AnimatePresence initial={false}>
                    {sourcesOpen || railShown ? (
                        <motion.div
                            key="panel"
                            variants={sheetPanel}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="flex min-h-0 flex-none"
                        >
                            {sourcesOpen ? (
                                <CouncilSourcesPanel
                                    c={c}
                                    view={sources}
                                    onClose={closeSources}
                                    onOpenFile={onOpenFile}
                                />
                            ) : (
                                <CouncilRail
                                    c={c}
                                    ideas={list.ideas}
                                    thread={thread}
                                    n={thread == null ? undefined : numbers.get(thread.id)}
                                    tab={railTab}
                                    on={threadOpen ? openId : focusedId}
                                    acts={acts}
                                    chats={chats}
                                    onTab={setRailTab}
                                    onPick={pick}
                                    onClose={() => setOpenId(null)}
                                    onFold={() => setFolded(true)}
                                    onShow={showMessages}
                                    onOpenSource={openSource}
                                    freshOnly={freshOnly}
                                    onFreshOnly={setFreshOnly}
                                />
                            )}
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
        </SeatLinks.Provider>
    );
}
