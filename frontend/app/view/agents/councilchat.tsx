// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council's discussion as a list of ideas with threads (board Discussion-list.dc.html in
// .superpowers/design/council-ux; councillistmodel.ts derives the list, councilchatmodel.ts the threads). The seat
// filters sit in the discussion's header (councilseats.tsx); here, while one is on, an Only line with Show everyone;
// with two or more seats failed a Retry all bar with a model pick per seat, else one line per failed seat with Retry;
// then the list: a Chat row on top for the person's own messages and the answers to them (its `N new`, its newest line,
// its count), then `N ideas` and one 40px row per idea (its number, its author, its title, New, the counts of Agrees /
// Has doubts / Is against it, its replies), an amber Draft on a row whose idea or reply waits for the person, in an
// order that never moves; past the first screen it scrolls. Under it the composer, which posts to everyone, and `@`
// lists the seats (a pick asks that one), the project's files (a pick names the file; the seats that answer read it)
// and the live claude and pi chats no seat holds under Add a live chat (a pick puts its mention key in the message;
// Send seats the chats the text still names and posts the message to them); an image pasted or dropped into the box
// waits above the text as a chip and goes with the message. A click on a row, or Enter on the row the keyboard cursor
// is on, slides its thread in from the right (sheetPanel): the idea on top, then its replies with their stance pills,
// the replies held as drafts with Send / Edit / Drop, and a reply box that names who will answer; a held idea's thread
// is its draft; the Chat's is the person's question and the messages tied to no idea, the person's own showing their
// images as thumbnails and each `@file` as a chip. j and k move the cursor over the rows, Enter opens the thread and
// Escape closes it, while focus is inside the list or the thread (buildCouncilBindings reads the cursor
// councilchatnav.ts publishes). A message's evidence is a link per cited file (councilsourcespanel.tsx): a click opens
// the Sources panel in the thread's place, and Escape or its close button goes back to the thread it was opened from.
// Every part carries a data-council-* attribute for the CDP scenario `council-discussion`. The store's actions answer
// `{ ok, error }`; a refusal shows in the header (the `acts` the discussion shares).

import { MOTION, computeEntrances, initialEntranceState, sentRise, sheetPanel } from "@/app/element/motiontokens";
import { buildCouncilBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import { reloadFileIndex } from "@/app/view/code/codestore";
import { cn } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
    Check,
    ChevronDown,
    ChevronUp,
    CornerDownRight,
    FileText,
    Loader2,
    MessageSquare,
    Plus,
    SendHorizontal,
    ThumbsDown,
    ThumbsUp,
    X,
} from "lucide-react";
import { AnimatePresence, animate, motion } from "motion/react";
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
import { flushSync } from "react-dom";
import type { Actions } from "./councilactions";
import {
    DRAFT_WAIT,
    askChips,
    contextLabel,
    councilThread,
    failureLines,
    foldSettle,
    foldToggle,
    foldView,
    insertAllMention,
    insertChatMention,
    insertFileMention,
    insertMention,
    mentionPicker,
    messageSegments,
    onlyLine,
    pickedChats,
    pickerRows,
    readsChoice,
    readsFiles,
    readsNote,
    replyReach,
    seatChips,
    threadAsks,
    toolsOfChoice,
    type AskChip,
    type ChatPick,
    type ChatThread,
    type DraftPost,
    type FailureLine,
    type PillTone,
    type QuestionFold,
    type QuestionPost,
    type ReplyPost,
    type ThreadItem,
    type TypingRow,
    type Who,
} from "./councilchatmodel";
import { useCouncilChatNav, type CouncilChatNav } from "./councilchatnav";
import { initialOf, isFollowUp, type AvatarTone } from "./councildiscussionmodel";
import {
    CHAT_THREAD,
    councilList,
    listNavOrder,
    type ChatRow,
    type CouncilList,
    type IdeaRow,
} from "./councillistmodel";
import { markSpans } from "./councilmarks";
import {
    ANSWERING,
    ROUTER_PICKS_WHO,
    answerers,
    councilProjectName,
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
import {
    followsEnd,
    keepPlace,
    keptPlace,
    ownPosts,
    placeOf,
    sentSince,
    topFor,
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
    councilOnlyAtom,
    councilOpenProposalAtom,
    councilSourcesAtom,
    draftCouncil,
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

// the person's like and dislike on a seat's idea or reply. The two buttons sit at the right end of its byline with its time and
// show while it is hovered or focused (HoverEnd); one that is on also shows as a chip under the message (ThumbChip), which
// stays and takes it back. A press on the one that is on takes it back too. The seats' later prompts and the summary read
// it, so it steers them with no words.
const THUMBS: { thumb: CouncilThumb; Icon: typeof ThumbsUp; word: string; done: string; on: string }[] = [
    { thumb: "like", Icon: ThumbsUp, word: "Like", done: "Liked", on: "bg-success/12 text-success-soft" },
    { thumb: "dislike", Icon: ThumbsDown, word: "Dislike", done: "Disliked", on: "bg-error/12 text-error-soft" },
];

// a byline's right end: its time and the thumbs, seen while the message is hovered or focused. They are only dimmed out,
// so they keep their width and nothing moves when the pointer comes
function HoverEnd({ children }: { children: ReactNode }) {
    return <span className={cn("ml-auto flex flex-none items-center gap-[7px]", HOVER_ONLY)}>{children}</span>;
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

// shown while its message is hovered or focused: a post's time, which says little at a glance, and the thumbs
const HOVER_ONLY = "opacity-0 group-hover/reply:opacity-100 group-focus-within/reply:opacity-100";

// a seat's byline: its name, its stance when it takes one (a plain `replies` says nothing), and at the right end, on hover
// or focus, its time and the thumbs
function ReplyHeader({ item, thumbs }: { item: ReplyPost; thumbs?: ReactNode }) {
    return (
        <Byline who={item}>
            {item.pill !== "neutral" && <CouncilPill word={item.label} tone={item.pill} />}
            {item.edited && <span className="text-muted">edited</span>}
            <HoverEnd>
                <PostTime at={item.at} when={item.when} />
                {thumbs}
            </HoverEnd>
        </Byline>
    );
}

// under the person's own post, as a messenger has it: who it reaches when not the usual ones, `edited`, what it waits
// on, and on the newest one Sent or Seen; nothing at all when none of them applies
function MineLine({ item, status }: { item: ReplyPost; status?: SendStatus }) {
    const reach = item.reachIsDefault ? "" : item.reaches;
    const waits = item.pending === ANSWERING ? "" : item.pending;
    if (reach === "" && waits === "" && !item.edited && status == null) {
        return null;
    }
    return (
        <div
            data-council-mine-line
            className="flex flex-wrap items-center justify-end gap-x-[7px] gap-y-[2px] text-[12px] text-muted"
        >
            {reach !== "" && <span data-council-reaches>{reach}</span>}
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
    councilId,
    item,
    acts,
    rise,
    status,
}: {
    councilId: string;
    item: ReplyPost;
    acts: Actions;
    rise?: boolean; // the person's post that just arrived: it rises in from the composer (sentRise)
    status?: SendStatus; // the person's newest post: its Sent or Seen (councilseen.ts)
}) {
    return (
        <motion.article
            data-council-item
            data-item-kind="reply"
            data-council-reply-post={item.id}
            data-item-label={item.label}
            data-item-mine={item.mine ? "true" : undefined}
            data-in-thread="true"
            variants={sentRise}
            initial={rise ? "initial" : false}
            animate="animate"
            style={{ transformOrigin: "bottom right" }}
            className={cn("group/reply flex gap-[8px]", item.mine && "flex-row-reverse")}
        >
            {!item.mine && <CouncilAvatar tone={item.tone} name={item.name} initials={item.initials} />}
            <div className={cn("flex min-w-0 max-w-[680px] flex-col gap-[5px]", item.mine && "items-end")}>
                {/* the person's own post has no byline, as a messenger draws it: the lines it needs go under it */}
                {!item.mine && (
                    <ReplyHeader
                        item={item}
                        thumbs={
                            // at the right end of its byline with the time, shown on hover or focus, so a reply is no taller
                            <Thumbs councilId={councilId} item={item.id} thumb={item.thumb} acts={acts} />
                        }
                    />
                )}
                {item.router !== "" && (
                    // who the router sent the message to and why, above the first answer to it
                    <span data-council-router className="min-w-0 break-words text-[12px] leading-[1.4] text-muted">
                        {item.router}
                    </span>
                )}
                <div
                    data-council-bubble
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
                {item.mine && <MineLine item={item} status={status} />}
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
function TypingLine({ item }: { item: TypingRow }) {
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
    const rows = Math.min(5, Math.max(1, text.split("\n").length));
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
                            // a line (21px) padded to the send button's 30px, so one line sits level with it and
                            // not at the foot of the row; more lines grow above the button, which stays at the foot
                            "box-border min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-[4.5px] text-[14px] leading-[1.5] text-primary outline-none placeholder:text-muted",
                            rows < 5 ? "overflow-hidden" : "overflow-y-auto"
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

// the last line of the list, under the last idea, so it scrolls away with the rest; a click puts the question in the
// box under the list, `@` seat and all, to edit and send
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
function useSendState(items: readonly ThreadItem[]): SendState {
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
            <h2 className="m-0 text-[15px] font-semibold leading-[1.4] text-primary">{idea.title}</h2>
            <div className="flex flex-wrap items-center gap-[7px] text-[12px] text-muted">
                {idea.wild ? <CouncilPill word={idea.label} tone="neutral" /> : <span>{idea.label}</span>}
                {idea.edited && <span>edited</span>}
                <HoverEnd>
                    <PostTime at={idea.at} when={idea.when} />
                    <Thumbs councilId={c.id} item={idea.id} thumb={idea.thumb} acts={acts} />
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

// what the panel's header names: `Idea 2 · by New user`, `Chat`
function threadHeading(thread: ChatThread, n: number | undefined): string {
    if (thread.kind === "chat") {
        return "Chat";
    }
    const who = thread.kind === "idea" ? thread.idea.name : thread.draft.name;
    return n == null ? `Idea · by ${who}` : `Idea ${n} · by ${who}`;
}

/** The panel a row opens on the right of the list: an idea's thread (the idea, its replies with their stance pills, the
 *  held reply drafts with Send / Edit / Drop, a reply box that names who answers), a held idea's draft, or the Chat
 *  (the person's question and the messages tied to no idea; the box under the list writes to it). `n` is the idea's
 *  number in the list. */
function ThreadPanel({
    c,
    thread,
    n,
    acts,
    onClose,
    chats,
}: {
    c: Council;
    thread: ChatThread;
    n: number | undefined;
    acts: Actions;
    onClose: () => void;
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
        <aside
            data-council-thread={thread.id}
            data-thread-kind={thread.kind}
            tabIndex={-1}
            aria-label={thread.kind === "chat" ? "Chat" : "Thread"}
            className="flex h-full min-h-0 w-[420px] flex-none flex-col border-l border-edge-faint bg-surface outline-none"
        >
            <div className="flex h-[44px] flex-none items-center gap-[8px] border-b border-edge-faint pl-[18px] pr-3">
                <span data-council-thread-heading className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                    {threadHeading(thread, n)}
                </span>
                <button
                    type="button"
                    data-council-thread-close
                    aria-label="Close the thread (Esc)"
                    title="Close the thread (Esc)"
                    onClick={onClose}
                    className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <X size={15} strokeWidth={2} aria-hidden />
                </button>
            </div>
            <div
                ref={scroller}
                onScroll={onScroll}
                className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[18px] py-4"
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
                            councilId={c.id}
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
        </aside>
    );
}

// ---- the list ----

// the counts of a row: Agrees (a tick), Has doubts (a ?) and Is against it (a cross); each word is the count's title
// and its label, so the colour never stands alone
function StanceCounts({ row }: { row: IdeaRow }) {
    const parts = [
        {
            key: "agrees",
            n: row.agrees,
            word: "Agrees",
            tone: "text-success",
            mark: <Check size={11} strokeWidth={2.5} />,
        },
        {
            key: "doubts",
            n: row.doubts,
            word: "Has doubts",
            tone: "text-warning",
            mark: <span className="text-[12px] font-bold leading-none">?</span>,
        },
        {
            key: "against",
            n: row.against,
            word: "Is against it",
            tone: "text-error",
            mark: <X size={11} strokeWidth={2.5} />,
        },
    ];
    return (
        <span className="flex w-[132px] flex-none justify-end gap-[10px] text-[12px] tabular-nums text-secondary">
            {parts.map((p) => (
                <span
                    key={p.key}
                    data-council-stance={p.key}
                    data-count={p.n}
                    title={`${p.word}: ${p.n}`}
                    aria-label={`${p.word}: ${p.n}`}
                    className="flex items-center gap-[4px]"
                >
                    <span aria-hidden className={cn("flex items-center", p.tone)}>
                        {p.mark}
                    </span>
                    <span aria-hidden>{p.n}</span>
                </span>
            ))}
        </span>
    );
}

const DraftBadge = () => (
    <span
        data-council-row-draft
        title={DRAFT_WAIT}
        className="flex h-[18px] flex-none items-center rounded-full bg-askingbg px-[7px] text-[10.5px] font-semibold text-warning-soft"
    >
        Draft
    </span>
);

const ROW =
    "flex w-full min-w-0 flex-none cursor-pointer items-center gap-3 rounded-[6px] border-0 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent";

function ChatRowButton({
    row,
    open,
    focused,
    onOpen,
}: {
    row: ChatRow;
    open: boolean;
    focused: boolean;
    onOpen: () => void;
}) {
    return (
        <button
            type="button"
            data-council-row={CHAT_THREAD}
            data-council-chat-row-open
            data-council-thread-open={CHAT_THREAD}
            data-replies={row.count}
            data-open={open ? "true" : undefined}
            data-focused={focused ? "true" : undefined}
            aria-label={`Open the chat: ${row.label}${row.freshLabel === "" ? "" : `, ${row.freshLabel}`}`}
            onClick={onOpen}
            className={cn(
                ROW,
                "h-[44px] rounded-[8px] border border-edge-mid bg-surface text-primary hover:bg-surface-hover",
                (open || focused) && "border-edge-strong bg-surface-selected"
            )}
        >
            <MessageSquare size={15} strokeWidth={2} aria-hidden className="flex-none text-secondary" />
            <span className="flex-none text-[13px] font-semibold">Chat</span>
            {row.freshLabel !== "" && (
                <span
                    data-council-chat-new={row.fresh}
                    className="flex h-[18px] flex-none items-center rounded-full bg-primary px-[7px] text-[10.5px] font-bold text-background"
                >
                    {row.freshLabel}
                </span>
            )}
            {row.draft && <DraftBadge />}
            <span data-council-chat-latest className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                {row.latest}
            </span>
            <span data-council-chat-count className="flex-none text-[12px] tabular-nums text-muted">
                {row.label}
            </span>
        </button>
    );
}

function IdeaRowButton({
    row,
    open,
    focused,
    onOpen,
}: {
    row: IdeaRow;
    open: boolean;
    focused: boolean;
    onOpen: (id: string) => void;
}) {
    const on = open || focused;
    return (
        <button
            type="button"
            data-council-row={row.id}
            data-council-idea={row.id}
            data-council-thread-open={row.id}
            data-replies={row.replies}
            data-item-label={row.label}
            data-new={row.isNew ? "true" : undefined}
            data-draft={row.draft ? "true" : undefined}
            data-open={open ? "true" : undefined}
            data-focused={focused ? "true" : undefined}
            aria-label={`Idea ${row.n} by ${row.name}: ${row.title}`}
            onClick={() => onOpen(row.id)}
            className={cn(ROW, "h-[40px]", on ? "bg-surface-selected" : "bg-transparent hover:bg-surface-hover")}
        >
            <span className="w-[18px] flex-none text-right text-[12px] tabular-nums text-muted">{row.n}</span>
            <CouncilAvatar tone={row.tone} name={row.name} initials={row.initials} title={row.name} />
            <span
                data-council-row-title
                className={cn("min-w-0 flex-1 truncate text-[13px]", on ? "text-primary" : "text-secondary")}
            >
                {row.title}
            </span>
            {row.isNew && (
                <span
                    data-council-row-new
                    className="flex h-[18px] flex-none items-center rounded-full border border-edge-strong px-[7px] text-[10.5px] font-semibold text-primary"
                >
                    New
                </span>
            )}
            {row.draft && <DraftBadge />}
            <StanceCounts row={row} />
            <span data-council-row-replies className="w-[70px] flex-none text-right text-[12px] text-muted">
                {row.repliesLabel}
            </span>
        </button>
    );
}

// the list: the Chat row, `N ideas` with the counts' legend, a row per idea, and Ask next under them. It scrolls past
// the first screen and stays where the reader left it.
function IdeaList({
    c,
    list,
    openId,
    focusedId,
    onOpen,
    asks,
    boxRef,
}: {
    c: Council;
    list: CouncilList;
    openId: string | null;
    focusedId: string | null;
    onOpen: (id: string) => void;
    asks: AskChip[];
    boxRef: RefObject<HTMLDivElement | null>;
}) {
    const onScroll = useKeptScroll(boxRef, `list:${c.id}`);
    return (
        <div
            ref={boxRef}
            data-council-channel
            data-council-list
            tabIndex={-1}
            role="group"
            aria-label="Council discussion"
            onScroll={onScroll}
            // the gutter is kept with or without a scrollbar, so the column lines up with the composer's below it
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pb-2 pt-[18px] outline-none [scrollbar-gutter:stable]"
        >
            <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-[4px]">
                <ChatRowButton
                    row={list.chat}
                    open={openId === CHAT_THREAD}
                    focused={focusedId === CHAT_THREAD}
                    onOpen={() => onOpen(CHAT_THREAD)}
                />
                <div className="flex items-center gap-[10px] px-3 pb-[6px] pt-[14px] text-[11.5px] text-muted">
                    <span data-council-list-count className="font-semibold text-secondary">
                        {list.label}
                    </span>
                    <span className="flex-1" />
                    <span>Agrees · Has doubts · Is against it</span>
                </div>
                {list.ideas.map((row) => (
                    <IdeaRowButton
                        key={row.id}
                        row={row}
                        open={openId === row.id}
                        focused={focusedId === row.id}
                        onOpen={onOpen}
                    />
                ))}
                {asks.length > 0 && (
                    <div className="px-3 pt-3">
                        <AskNext c={c} asks={asks} />
                    </div>
                )}
            </div>
        </div>
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

/** The council's discussion as a list of ideas with threads. `notes` is what the discussion draws above the list (the
 *  failed summary and its Retry); `onOpenFile` opens a cited file in the editor; `chats` are the live claude and pi
 *  chats the composers' `@` can add to the council (the cockpit's roster by the one seat rule, seated ones included:
 *  the picker lists the ones no seat holds). */
export function CouncilChat({
    c,
    acts,
    chats,
    notes,
    onOpenFile,
}: {
    c: Council;
    acts: Actions;
    chats: readonly SeatableAgent[];
    notes?: ReactNode;
    onOpenFile?: (path: string, line?: number) => void;
}) {
    const [openId, setOpenId] = useAtom(councilOpenProposalAtom(c.id));
    const [sources, setSources] = useAtom(councilSourcesAtom(c.id));
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const listBox = useRef<HTMLDivElement>(null);
    const thread = openId == null ? null : councilThread(c, openId);
    const threadOpen = thread != null;
    const sourcesOpen = !threadOpen && sources != null;
    // a thread that is gone (the id of another council, a dropped idea) closes the panel
    useEffect(() => {
        if (openId != null && !threadOpen) {
            setOpenId(null);
        }
    }, [openId, threadOpen, setOpenId]);
    // a thread opened another way (Enter on a row, the Summary's link) takes the right of the list from the sources
    useEffect(() => {
        if (threadOpen && sources != null) {
            setSources(null);
        }
    }, [threadOpen, sources, setSources]);

    // one seat's ideas only, while the Seats chip (or the Summary's column) picks one; a seat no longer on the panel
    // shows everyone
    const [only, setOnly] = useAtom(councilOnlyAtom(c.id));
    const onlyId = only != null && c.experts.some((e) => e.id === only) ? only : null;
    // New is measured against the time the person last left this council (councilopened.ts)
    const since = openedAt(useAtomValue(councilOpenedAtom), c.id);
    const list = useMemo(() => councilList(c, since, onlyId ?? undefined), [c, since, onlyId]);
    // an idea's number is the same whatever the filter: read from the whole list
    const numbers = useMemo(() => new Map(councilList(c, 0).ideas.map((r) => [r.id, r.n])), [c]);
    // Ask next stays while the person types: a click replaces what is in the box
    const asks = isFollowUp(c) ? askChips(c) : [];
    const seats = useMemo(() => seatChips(c), [c]);
    const onlySeat = onlyId == null ? null : (seats.find((chip) => chip.id === onlyId) ?? null);
    const order = useMemo(() => listNavOrder(list), [list]);
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
    // the cursor stays in view as j and k move it, and takes the focus so Enter opens its row
    useEffect(() => {
        if (focusedId == null) {
            return;
        }
        const row = listBox.current?.querySelector<HTMLElement>(`[data-council-row="${focusedId}"]`);
        row?.scrollIntoView?.({ block: "nearest" });
        if (listBox.current?.contains(document.activeElement)) {
            row?.focus({ preventScroll: true });
        }
    }, [focusedId]);

    // two or more failed seats retry together (Retry all), each on the model picked beside it; the picks belong to
    // this council, so another one opened here starts from its seats' own models
    const retryAll = offersRetryAll(c);
    const failures = retryAll ? [] : failureLines(c);
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
                    <div className="flex flex-none items-center gap-2 border-b border-edge-faint px-7 py-2 text-[13px] text-muted">
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
                        className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge-faint px-7 py-2 text-[13px] text-muted"
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
                {failures.length > 0 && (
                    <div className="flex flex-none flex-col border-b border-edge-faint px-[18px] py-1">
                        {failures.map((f) => (
                            <FailedLine key={f.id} c={c} item={f} acts={acts} />
                        ))}
                    </div>
                )}
                <div className="flex-none px-7 pt-3 empty:hidden">{notes}</div>
                <IdeaList
                    c={c}
                    list={list}
                    openId={threadOpen ? openId : null}
                    focusedId={focusedId}
                    onOpen={open}
                    asks={asks}
                    boxRef={listBox}
                />
                {/* the list's column: its px-7, its scrollbar gutter on the right, its 1000px centred */}
                <div className="flex-none pb-[18px] pl-7 pr-[38px] pt-3">
                    <div className="mx-auto w-full max-w-[1000px]">
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
                            returnTo={() => listBox.current}
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
                            <ThreadPanel
                                c={c}
                                thread={thread}
                                n={numbers.get(thread.id)}
                                acts={acts}
                                onClose={close}
                                chats={chats}
                            />
                        ) : sources != null ? (
                            <CouncilSourcesPanel c={c} view={sources} onClose={closeSources} onOpenFile={onOpenFile} />
                        ) : null}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
