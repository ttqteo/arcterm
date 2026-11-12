// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A Claude agent's conversation as chat draws it (the agent-chat document-view board, Main.dc.html): your messages as
// bubbles on the right, a prompt arcterm typed (a run's launch prompt, a wake, a message from another agent) as an
// outlined card naming who sent it, and everything the agent said and did between two of them as a document column: its
// prose as Markdown with no bubble and no avatar, and between the paragraphs a stretch of tools as one plain "Worked for
// 38s · 5 tools" line that opens to one step line per call (chatstepsview.tsx), and the files that work edited as a chip
// each that opens its diff. Your prompt pins to the top once it scrolls away (pinnedpromptbar.tsx), as in the live feed.
// The items are chatmodel.ts's; the pieces shared with the other transcript views (a diff body, the compaction and
// interruption markers) are narrationtimeline.tsx's.
// Only the last CHAT_RENDER_STEP items are drawn at first; "Show earlier" draws that many more and, once all are drawn,
// asks the caller for earlier entries. The place the reader left it is kept under `placeId` (transcriptplace.ts).
// A row that arrives at the tail, or a part that lands in a row already there, opens its height on the spring instead of
// shoving what is above it (Arriving, chatarrival.ts); what is drawn at once (the first load, Show earlier, a restored place)
// never animates.
// The agent's brainstorm shows here as well (chatbrainstormcard.tsx): the question it waits on is a card after the last row,
// which opens and leaves on the spring, and each of your messages that answered a question draws as that question's ✓ row in
// place of its bubble (chatbrainstorm.ts pairs them by the record of what Arc sent). Chat never switches to the Brainstorm
// tab for it; the card's button does that.

import { CopyButton } from "@/app/element/copybutton";
import { MOTION, springReveal } from "@/app/element/motiontokens";
import { SkeletonLine } from "@/app/element/skeleton";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { cn } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { ArrowUpRight, ChevronDown, ChevronRight, Copy, EyeOff, GitFork } from "lucide-react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseMarks } from "../../../../claude/skim-mod/hooks/highlight-core";
import type { AgentsViewModel } from "./agents";
import {
    conversationText,
    isNearBottom,
    type AgentEntry,
    type AgentVM,
    type BtwAnswer,
    type EditFile,
    type ShellResult,
} from "./agentsviewmodel";
import { arrivalFrom, tailArrivals } from "./chatarrival";
import { pairAnswers, type OpenQuestion, type PairedAnswer, type SentAnswer } from "./chatbrainstorm";
import { ChatBrainstormAnswered, ChatBrainstormCard } from "./chatbrainstormcard";
import { answerMessages, answeredText } from "./chatbrainstormwire";
import { ChatFileCards } from "./chatfilecards";
import { splitAttachments } from "./chatfiles";
import { canForkInChat, forkPointOfProse, forkPointOfYou, type ForkPoint } from "./chatfork";
import { forkFromChat } from "./chatforkaction";
import { sameChatItem } from "./chatitemeq";
import { liveTexts, withLiveReply, type LiveReply } from "./chatlive";
import { CHAT_RENDER_STEP, chatItems, shownItems, type AgentPart, type ChatItem, type ChatMarker } from "./chatmodel";
import { btwQuestion } from "./chatpending";
import { withMarks } from "./chatskim";
import { useSkimFold } from "./chatskimstore";
import { ChatSteps } from "./chatstepsview";
import { TaggedPromptText } from "./chattagblock";
import { foldCommandParts, splitTagged, tagHeading, type TagPart } from "./chattagblocks";
import { CouncilText } from "./councilchat";
import {
    CompactionDivider,
    InterruptedDivider,
    PromptImages,
    TaskNotificationRow,
    ToolDetailBody,
} from "./narrationtimeline";
import { usePathOpener } from "./pathlinkcontext";
import { PinnedPromptBar, scrollParent, usePinnedPrompt } from "./pinnedpromptbar";
import { firstItemBelow, keepTranscriptPlace, transcriptPlace } from "./transcriptplace";

/** A sent card shows this many of its lines until it is opened. */
const SENT_FOLD_LINES = 3;

// The agent's prose: 14px on a 1.65 line, and its headings 15px at weight 600 (the Markdown sheet sets them at 1em; its rules
// are outside Tailwind's layers, which win over a plain utility, so the size and the line are `!`)
const PROSE = [
    "text-[14px] leading-[1.65] text-ink-hi",
    "[&_h1]:text-[15px]! [&_h2]:text-[15px]! [&_h3]:text-[15px]! [&_h4]:text-[15px]!",
    "[&_h1]:font-semibold! [&_h2]:font-semibold! [&_h3]:font-semibold! [&_h4]:font-semibold!",
    "[&_h1]:leading-[1.4]! [&_h2]:leading-[1.4]! [&_h3]:leading-[1.4]! [&_h4]:leading-[1.4]!",
].join(" ");

// the entry index an item's key starts with ("agent:12" → 12): the key transcriptplace.ts keeps a place under, the same
// number CompactTranscript keeps for the item starting at that entry, so a place survives the switch between the two
function keyIndex(key: string): number {
    return Number(key.slice(key.indexOf(":") + 1));
}

function Caret({ open }: { open: boolean }) {
    const Icon = open ? ChevronDown : ChevronRight;
    return <Icon size={11} strokeWidth={2.2} aria-hidden className="shrink-0" />;
}

// Copy in the gap under a bubble's bottom edge (the bubble keeps a margin that holds it), shown while the bubble is hovered or the button has focus (the bubble is `group`).
// Beside it, Fork from here (`onFork`, given only where the item points at a transcript record of a forkable session).
function BubbleCopy({ text, align, onFork }: { text: string; align: "left" | "right"; onFork?: () => void }) {
    return (
        <div
            data-chat-copy
            className={cn(
                "absolute top-full z-10 mt-0 flex items-center rounded-md bg-surface opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none",
                align === "left" ? "left-1" : "right-1"
            )}
        >
            <CopyButton title="Copy" content={text} className="p-1 text-[12px]" />
            {onFork ? (
                <button
                    type="button"
                    data-chat-fork
                    title="Fork from here: a new session with the conversation up to this point"
                    aria-label="Fork from here"
                    onClick={onFork}
                    className="cursor-pointer rounded p-1 text-[12px] text-muted hover:bg-hover hover:text-ink-mid"
                >
                    <GitFork size={12} strokeWidth={2} aria-hidden />
                </button>
            ) : null}
        </div>
    );
}

// What the agent said, as Markdown, with the sentences the skim mod marked highlighted (the terminal's own highlight, found
// by the hash of the stored text: chatskimstore.ts) while Chat's highlighter toggle is on. Its own component so the hook
// runs per part. The copy button and the context menu keep the text as stored, without marks. With the toggle and
// Settings → Appearance → Chat's fold switch on, a long reply folds as the skim mod folds it in the terminal (chatFold):
// its verdict and marked sentences, then Show more.
// memo: a reply still being written redraws its group on each tick, and the stored replies above it in the group have
// not changed
const ProseText = memo(function ProseText({ text }: { text: string }) {
    const { marks, fold, open, toggle } = useSkimFold(text);
    const full = useMemo(() => withMarks(text, marks), [text, marks]);
    const folded = fold != null && !open;
    return (
        <>
            <CouncilText text={folded ? fold.short : full} className={PROSE} />
            {fold != null ? (
                <button
                    type="button"
                    data-chat-fold={folded ? "folded" : "open"}
                    aria-expanded={!folded}
                    onClick={toggle}
                    className="mt-1 flex cursor-pointer items-center gap-1 text-[12px] text-muted hover:text-primary"
                >
                    <Caret open={!folded} />
                    {folded ? `Show more · ${fold.lines} lines` : "Show less"}
                </button>
            ) : null}
        </>
    );
});

// a reply still being written (chatlive.ts): its marks are still in it, so they are read from it rather than from the
// skim mod's store, which keeps them only once the reply is stored; never folded, since it is still growing
function LiveProseText({ text }: { text: string }) {
    const full = useMemo(() => {
        const { clean, marks } = parseMarks(text);
        return withMarks(clean, marks);
    }, [text]);
    return <CouncilText text={full} className={PROSE} />;
}

// the context menu of one bubble: Copy text and Copy conversation, and with a fork point, Fork from here
type CopyMenu = (text: string, fork?: ForkPoint | null) => (e: React.MouseEvent) => void;

// a command you ran, as one card: the command as you typed it, then what it printed under a rule, stderr in red, scrolling
// past 200 px, as the TUI draws it under its line. A bash-mode one (`! cmd`, `bash`) leads with the `!` in the accent and,
// before its output lands, is the command alone; a slash command has a card only once it printed something, or (`terminal`)
// when its panel showed on Claude Code's own screen, which the card says with a way there (`onOpenTerminal`, when the
// agent is live).
function CommandCard({
    command,
    bash,
    shell,
    terminal,
    onOpenTerminal,
    onContextMenu,
}: {
    command: string;
    bash?: boolean;
    shell?: ShellResult;
    terminal?: boolean;
    onOpenTerminal?: () => void;
    onContextMenu: CopyMenu;
}) {
    const printed = shell != null && (shell.output !== "" || shell.error !== "");
    // what Copy takes: the command and what it printed, as the terminal shows them
    const copyText = [bash ? `! ${command}` : command, shell?.output ?? "", shell?.error ?? ""]
        .filter((s) => s !== "")
        .join("\n");
    return (
        <div
            data-chat-you
            data-chat-command
            data-chat-shell={bash ? "" : undefined}
            onContextMenu={onContextMenu(copyText)}
            className="group relative mb-1 max-w-[75%] min-w-[220px] self-end"
        >
            <div className="flex flex-col overflow-hidden rounded-[12px] border border-edge-mid bg-surface-raised">
                <div className="flex items-baseline gap-2 px-[14px] py-[8px] font-mono text-[12.5px] text-primary [overflow-wrap:anywhere]">
                    {bash ? (
                        <span aria-label="bash" className="flex-none select-none font-semibold text-accent">
                            !
                        </span>
                    ) : null}
                    <span className="min-w-0">{command}</span>
                </div>
                {terminal ? (
                    <div
                        data-chat-command-terminal
                        className="flex items-center justify-between gap-3 border-t border-edge-faint px-[14px] py-[7px] text-[11.5px] text-muted"
                    >
                        <span>Opens in Terminal</span>
                        {onOpenTerminal != null ? (
                            <button
                                type="button"
                                onClick={onOpenTerminal}
                                className="cursor-pointer text-secondary hover:text-primary"
                            >
                                Show Terminal
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {shell != null ? (
                    <div
                        data-chat-shell-output
                        className="max-h-[200px] overflow-auto border-t border-edge-faint bg-surface-code px-[14px] py-[8px] font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere]"
                    >
                        {printed ? (
                            <>
                                {shell.output !== "" ? <div className="text-ink-mid">{shell.output}</div> : null}
                                {shell.error !== "" ? <div className="text-error-soft">{shell.error}</div> : null}
                            </>
                        ) : (
                            <span className="font-sans text-muted">No output</span>
                        )}
                    </div>
                ) : null}
            </div>
            <BubbleCopy text={copyText} align="right" />
        </div>
    );
}

// the arc mod's failure reasons are lowercase clauses (btw-core.ts forkFailure); the card shows one as a sentence
function asSentence(text: string): string {
    const t = text.trim();
    const capped = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

// a /btw you asked from Chat, as one card in Claude's column, since it is mostly an answer: your question as its header,
// the side answer the arc mod's fork of the session gave as Markdown under it, or why there is none, and a footer saying
// Claude never reads it. `btw` null is the card while the fork still asks (chatpane.tsx PendingCommand), so the
// transcript's copy that takes its place changes only the body.
export function BtwCard({
    question,
    btw,
    onContextMenu,
}: {
    question: string;
    btw: BtwAnswer | null;
    onContextMenu?: CopyMenu;
}) {
    const copyText = btw == null ? null : "answer" in btw ? btw.answer : btw.failure;
    return (
        <div
            data-chat-command
            data-chat-btw
            data-chat-btw-state={btw == null ? "asking" : "answer" in btw ? "answered" : "failed"}
            onContextMenu={copyText != null && onContextMenu != null ? onContextMenu(copyText) : undefined}
            className="mb-1 flex min-w-0 flex-col self-stretch overflow-hidden rounded-[12px] border border-edge-mid bg-surface-raised"
        >
            <div className="flex min-h-[38px] items-center gap-2 py-[6px] pr-[10px] pl-[16px]">
                <span className="flex-none rounded-[5px] border border-edge-strong bg-pill px-1.5 text-[11px] leading-[17px] font-medium text-muted">
                    btw
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] font-medium text-primary [overflow-wrap:anywhere]">
                    {question}
                </span>
                {btw != null && "answer" in btw ? (
                    <CopyButton title="Copy the side answer" content={btw.answer} className="p-1 text-[12px]" />
                ) : null}
            </div>
            <div className="flex flex-col gap-3 border-t border-edge-faint px-[16px] pt-[12px] pb-[16px]">
                {btw == null ? (
                    <>
                        <span className="text-[12px] text-muted">Asking on the side…</span>
                        <div className="flex flex-col gap-[9px]">
                            <SkeletonLine className="h-[10px] w-[92%] rounded-[4px]" />
                            <SkeletonLine className="h-[10px] w-[70%] rounded-[4px]" />
                        </div>
                    </>
                ) : "answer" in btw ? (
                    <CouncilText text={btw.answer} className="text-[13.5px] leading-[1.6] text-ink-hi" />
                ) : (
                    <div data-chat-btw-failure className="flex flex-col gap-1">
                        <span className="text-[12.5px] font-medium text-secondary">No side answer</span>
                        <span className="text-[12.5px] leading-[1.55] text-muted">{asSentence(btw.failure)}</span>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-[7px] border-t border-edge-faint px-[16px] py-[8px] text-[11.5px] text-muted">
                <EyeOff size={12} strokeWidth={2} aria-hidden className="flex-none" />
                <span>Not in the conversation: Claude doesn't read side answers</span>
            </div>
        </div>
    );
}

// your bubble's box, shared with the bubble that stands in for a message on its way (chatpane.tsx PendingBubble), so the
// transcript's copy taking its place draws nothing new. The copy button hangs in the gap under the bubble: it leaves that
// button room above the cards
export function youBubbleBox(hasFiles: boolean): string {
    return cn(
        "max-w-full rounded-[16px] bg-surface-raised px-[14px] py-[9px] text-[13.5px] leading-[1.55] text-primary",
        hasFiles ? "mb-3" : "mb-1"
    );
}

// your message: a bubble on the right, long ones clamped (PromptText, as userNeedsClamp says), what you pasted under it
function YouBubble({
    item,
    onContextMenu,
    onOpenTerminal,
    onFork,
}: {
    item: Extract<ChatItem, { kind: "you" }>;
    onContextMenu: CopyMenu;
    onOpenTerminal?: () => void;
    // given where this session can fork: starts the fork from the message's own record (forkPointOfYou finds none for a
    // command, or a message with no uuid, and then it offers nothing)
    onFork?: (point: ForkPoint) => void;
}) {
    if ("command" in item && item.command.startsWith("! ")) {
        return <CommandCard command={item.command.slice(2)} bash shell={item.shell} onContextMenu={onContextMenu} />;
    }
    if ("command" in item && item.btw != null) {
        return (
            <BtwCard
                question={btwQuestion(item.command) ?? item.command}
                btw={item.btw}
                onContextMenu={onContextMenu}
            />
        );
    }
    if ("command" in item && (item.shell != null || item.terminal)) {
        return (
            <CommandCard
                command={item.command}
                shell={item.shell}
                terminal={item.terminal}
                onOpenTerminal={onOpenTerminal}
                onContextMenu={onContextMenu}
            />
        );
    }
    if ("command" in item) {
        return (
            <div
                data-chat-you
                data-chat-command
                onContextMenu={onContextMenu(item.command)}
                className="max-w-[75%] self-end rounded-[16px] bg-surface-raised px-[14px] py-[9px] font-mono text-[12.5px] text-primary [overflow-wrap:anywhere]"
            >
                {item.command}
            </div>
        );
    }
    // the files and images you sent ride the message as trailing blocks of paths (chatfiles.ts); images show as pictures in
    // the bubble and files as cards under it, not as the blocks that name them. The wrapper is the prompt (the pinned bar
    // and the scenarios find it), so a message that is only files still has one, with no empty bubble in it
    const said = splitAttachments(item.text);
    const text = said.text.trim();
    const hasPictures = (item.images?.length ?? 0) > 0 || said.images.length > 0;
    const hasFiles = said.files.length > 0;
    const fork = onFork != null ? forkPointOfYou(item) : null;
    return (
        <div
            data-chat-you
            data-user-prompt
            onContextMenu={onContextMenu(item.text, fork)}
            className="flex max-w-[75%] flex-col items-end gap-2 self-end"
        >
            {text !== "" || hasPictures ? (
                <div className={cn("group relative", youBubbleBox(hasFiles))}>
                    {text !== "" ? <TaggedPromptText text={text} /> : null}
                    {hasPictures ? <PromptImages images={item.images} paths={said.images} /> : null}
                    {/* the whole message, files and all, as the context menu copies it */}
                    {text !== "" ? (
                        <BubbleCopy
                            text={item.text}
                            align="right"
                            onFork={fork != null ? () => onFork?.(fork) : undefined}
                        />
                    ) : null}
                </div>
            ) : null}
            {hasFiles ? <ChatFileCards paths={said.files} /> : null}
        </div>
    );
}

// what the pinned bar says of your message: its text, else the first tagged block it carried named as its card is ("Pasted ·
// 12 lines"), else what it carried (`pasted` is the images pasted into the box). The blocks themselves are not read out:
// a pasted log would fill the bar
function pinnedLabel(text: string, pasted: number): string {
    const said = splitAttachments(text);
    if (said.text.trim() !== "") {
        const parts = foldCommandParts(splitTagged(said.text.trim()));
        const block = parts.find((p): p is TagPart => p.kind === "tag");
        if (block == null) {
            return said.text;
        }
        const prose = parts
            .flatMap((p) => (p.kind === "text" ? [p.text] : []))
            .join("\n")
            .trim();
        return prose !== "" ? prose : tagHeading(block);
    }
    return said.files.length > 0 && said.images.length === 0 && pasted === 0 ? "(file)" : "(picture)";
}

// a prompt arcterm typed: an outlined card on the right naming its sender, its lines in mono, folded past three
function SentCard({ item }: { item: Extract<ChatItem, { kind: "sent" }> }) {
    const [open, setOpen] = useState(false);
    const folds = item.lines.length > SENT_FOLD_LINES;
    const lines = folds && !open ? item.lines.slice(0, SENT_FOLD_LINES) : item.lines;
    return (
        <div
            data-chat-sent
            data-chat-from={item.from}
            className="flex max-w-[75%] flex-col gap-[6px] self-end rounded-[12px] border border-edge-mid px-[14px] py-[9px]"
        >
            <div className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
                <span className="min-w-0 truncate font-medium text-primary">{item.header}</span>
                <span className="flex-none text-[11.5px] text-muted">
                    {item.from === "run" ? "from the run" : "from the cockpit"}
                </span>
            </div>
            {lines.length > 0 ? (
                <div className="flex flex-col font-mono text-[11.5px] leading-[1.55] text-secondary">
                    {lines.map((line, i) => (
                        <div key={i} className="[overflow-wrap:anywhere]">
                            {line}
                        </div>
                    ))}
                </div>
            ) : null}
            {folds ? (
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    className="cursor-pointer self-start text-[11.5px] text-muted hover:text-secondary"
                >
                    {open ? "Show less" : `Show ${item.lines.length - SENT_FOLD_LINES} more`}
                </button>
            ) : null}
        </div>
    );
}

// The gaps of the columns Arriving sits in: gap-4 between the items, gap-2 between an item's parts. A row that opens from
// nothing takes its gap back (a negative margin that opens to 0 with the height) while it is closed, or its first frame
// would shove what is above it by the gap.
const ITEM_GAP = 16;
const PART_GAP = 8;

// A row of the conversation, or a part of an agent's reply. `arrive`: it landed just now at the tail, so it opens its height
// 0 -> its own on the spring (MOTION.spring, as springReveal) and fades in on the micro ease; otherwise it is drawn at once. A
// tall one opens only over its last ARRIVAL_CAP_PX. It is a plain div, never a motion component: a conversation holds
// hundreds of rows and parts, a motion element per one made every block's render pay for all of them (frame timing,
// chat-redesign step 16), and a row that has settled is just a div. Only the one render that mounts it decides, and the
// animation runs imperatively from there: its height is read before the first paint, the styles that close it are set in
// the same layout effect (so no frame shows it open), and all of them are removed when it ends, with the clip, so a copy
// button hanging under a bubble or a focus ring is never cut at rest. `arrive` is false under reduced motion (the caller).
function Arriving({
    arrive,
    gap,
    itemKey,
    className,
    children,
}: {
    arrive: boolean;
    gap: number;
    itemKey?: string;
    className?: string;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const arrivedAtMount = useRef(arrive);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!arrivedAtMount.current || el == null) {
            return;
        }
        const full = el.getBoundingClientRect().height;
        if (full <= 0) {
            return;
        }
        const from = arrivalFrom(full) ?? 0;
        const rest = () => {
            for (const prop of ["height", "margin-top", "opacity", "overflow"]) {
                el.style.removeProperty(prop);
            }
        };
        el.style.overflow = "hidden";
        el.style.height = `${from}px`;
        el.style.marginTop = `${-gap}px`;
        el.style.opacity = "0";
        const runs = [
            animate(el, { height: [from, full] }, MOTION.spring),
            animate(el, { marginTop: [-gap, 0] }, MOTION.spring),
            animate(el, { opacity: [0, 1] }, { duration: MOTION.durMicro, ease: MOTION.easeFluid }),
        ];
        let over = false;
        const end = () => {
            if (!over) {
                over = true;
                rest();
            }
        };
        // all three are over before the styles go: a spring still running would write its value back after them
        void Promise.all(runs.map((run) => run.finished)).then(end, end);
        return () => {
            for (const run of runs) {
                run.stop();
            }
            end();
        };
    }, [gap]);
    return (
        <div ref={ref} data-chat-item={itemKey} className={className}>
            {children}
        </div>
    );
}

const NO_KEYS: ReadonlySet<string> = new Set();
const NO_LIVE_REPLY: Atom<LiveReply | null> = atom<LiveReply | null>(null);
const NO_ANSWERS: ReadonlyMap<string, PairedAnswer> = new Map();

/** The agent's brainstorm as the conversation draws it: `question` is what it waits on now (a card, or the one line that
 *  points to the Brainstorm tab), `answers` and `topic` are what Arc sent to its questions, which pair with your messages
 *  so each answered question draws as one ✓ row in place of your bubble. */
export interface ChatBrainstorm {
    agent: AgentVM;
    topic: string;
    answers: readonly SentAnswer[];
    question: OpenQuestion | null;
}

// the one string an answered row is drawn from, for the item's kept element to be compared by
function answerKey(a: PairedAnswer | undefined): string {
    return a == null ? "" : `${a.n}\n${a.part}\n${a.text}`;
}

// an item's element as last drawn, and what it was drawn from (ChatConversation's drawnItems)
interface DrawnItem {
    item: ChatItem;
    last: boolean;
    active: boolean;
    live: boolean;
    terminal: boolean;
    fork: boolean;
    folds: string;
    answer: string;
    element: ReactNode;
}

// the folds opened inside one item: the keys of `opened` that are its own (`<item key>#<part>…`, drawPart's), as one string
function openedFor(opened: ReadonlySet<string>, itemKey: string): string {
    const prefix = `${itemKey}#`;
    let out = "";
    for (const key of opened) {
        if (key.startsWith(prefix)) {
            out += `${key}\n`;
        }
    }
    return out;
}

// the files a stretch of work edited, a chip each ("session.ts +4 −1"), each opening its diff under the row. The arrow at
// a chip's end opens the file itself where a path link in the terminal would (the agent's File tab, which previews HTML
// and markdown); a transcript with no agent around it has no opener, and its chips only open their diff.
function FileChips({
    files,
    openPaths,
    onToggle,
}: {
    files: EditFile[];
    openPaths: Set<string>;
    onToggle: (path: string) => void;
}) {
    const opened = files.filter((f) => openPaths.has(f.path));
    const opener = usePathOpener();
    return (
        <div data-chat-files className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-[6px]">
                {files.map((f) => {
                    const open = openPaths.has(f.path);
                    const name = f.path.split(/[\\/]/).pop() || f.path;
                    return (
                        <span
                            key={f.path}
                            className={cn(
                                "flex items-center rounded-full border bg-surface text-[12px] hover:border-edge-strong",
                                open ? "border-edge-strong" : "border-edge-mid"
                            )}
                        >
                            <button
                                type="button"
                                data-chat-file={f.path}
                                aria-expanded={open}
                                title={f.path}
                                onClick={() => onToggle(f.path)}
                                className={cn(
                                    "flex cursor-pointer items-center gap-2 py-[3px] pl-[12px]",
                                    opener != null ? "pr-[4px]" : "pr-[12px]"
                                )}
                            >
                                <span className="max-w-[260px] truncate text-secondary">{name}</span>
                                <span className="font-semibold tabular-nums text-diff-added">+{f.adds}</span>
                                <span className="font-semibold tabular-nums text-diff-removed">−{f.dels}</span>
                            </button>
                            {opener != null ? (
                                <button
                                    type="button"
                                    data-chat-file-open={f.path}
                                    title={`Open ${name}`}
                                    aria-label={`Open ${name}`}
                                    onClick={() => opener.open(f.path)}
                                    className="flex cursor-pointer items-center self-stretch rounded-r-full pl-[4px] pr-[10px] text-muted hover:text-primary"
                                >
                                    <ArrowUpRight size={13} strokeWidth={2.2} aria-hidden />
                                </button>
                            ) : null}
                        </span>
                    );
                })}
            </div>
            <AnimatePresence initial={false}>
                {opened.map((f) => (
                    <motion.div
                        key={f.path}
                        data-chat-diff={f.path}
                        variants={springReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden rounded-[8px] border border-edge-mid bg-surface-code"
                    >
                        <div className="max-h-[360px] overflow-auto">
                            <ToolDetailBody detail={{ kind: "edit", files: [f] }} variant="inline" />
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}

function Marker({ item }: { item: ChatMarker }) {
    switch (item.kind) {
        case "compaction":
            return (
                <CompactionDivider
                    trigger={item.trigger}
                    preTokens={item.preTokens}
                    postTokens={item.postTokens}
                    summary={item.summary}
                />
            );
        case "interrupted":
            return <InterruptedDivider />;
        case "notification":
            return <TaskNotificationRow summary={item.summary} status={item.status} result={item.result} />;
    }
}

export function ChatConversation({
    entries,
    liveReply,
    liveNarrates,
    placeId,
    onLoadEarlier,
    active,
    working,
    onOpenTerminal,
    brainstorm,
    model,
    agent,
    className,
}: {
    entries: AgentEntry[];
    // the reply Claude is writing (chatlive.ts, chatlivestore.ts): drawn at the end until the transcript holds its blocks,
    // its thinking blocks too when `liveNarrates`. Read here, not by the caller, so its ticks redraw only the conversation
    liveReply?: Atom<LiveReply | null>;
    liveNarrates?: boolean;
    // keeps where the reader is under this id (transcriptplace.ts) and opens there again; a caller that sticks to the
    // end (useStickToBottom) passes it the same id, so it does not pin over a kept place
    placeId?: string;
    // every item is drawn and the reader asked for earlier ones: the caller may load earlier entries
    onLoadEarlier?: () => void;
    // the session is live: its last stretch of work is open while it is the last thing drawn
    active?: boolean;
    // the session is working, so a tool with no result is running (a spinner, counted in the stretch); one a session
    // that stopped left without a result is drawn neutral. Defaults to `active`; a session waiting on an answer is
    // `active` but not working
    working?: boolean;
    // shows the agent's terminal, for a command whose panel only Claude Code's own screen draws; left out where there is
    // no live terminal to show (an ended session)
    onOpenTerminal?: () => void;
    // the agent's brainstorm: its open question as a card after the last row, and its answered questions as ✓ rows. Left
    // out where there is none (a caller that has no agent to answer to)
    brainstorm?: ChatBrainstorm;
    // the cockpit and the agent this conversation is of, which Fork from here forks (chatforkaction.ts): left out where
    // there is no live agent to fork (an ended session, a subagent's interior), and then no item offers a fork
    model?: AgentsViewModel;
    agent?: AgentVM;
    className?: string;
}) {
    const toolsLive = working ?? !!active;
    const stored = useMemo(() => chatItems(entries), [entries]);
    const reply = useAtomValue(liveReply ?? NO_LIVE_REPLY);
    const items = useMemo(
        () => withLiveReply(stored, liveTexts(reply, !!liveNarrates), entries.length),
        [stored, reply, liveNarrates, entries.length]
    );
    // which of your messages answered a question, by row key: every answered question of the conversation, not only the
    // latest. Nothing to pair, nothing computed
    const sentAnswers = brainstorm?.answers;
    const sentTopic = brainstorm?.topic;
    const answers = useMemo(
        () =>
            sentAnswers == null || sentAnswers.length === 0 || sentTopic == null
                ? NO_ANSWERS
                : pairAnswers(sentAnswers, answerMessages(stored), sentTopic),
        [stored, sentAnswers, sentTopic]
    );
    // how many of the last items are drawn. Entries arriving at the end are drawn on top of it, so the first drawn item
    // stays put while the agent works; entries the caller put in front (onLoadEarlier) are drawn a step of once asked for
    const [win, setWin] = useState({ shown: CHAT_RENDER_STEP, len: items.length, head: entries[0], asked: false });
    if (win.len !== items.length || win.head !== entries[0]) {
        const drawn = Math.min(win.shown, win.len);
        setWin({
            // the first load (nothing drawn before) starts at a step, like a mount with the entries already there
            shown:
                win.len === 0
                    ? CHAT_RENDER_STEP
                    : win.head === entries[0]
                      ? drawn + Math.max(0, items.length - win.len)
                      : drawn + (win.asked ? CHAT_RENDER_STEP : 0),
            len: items.length,
            head: entries[0],
            asked: false,
        });
    }
    const visible = shownItems(items, Math.max(win.shown, Math.min(CHAT_RENDER_STEP, items.length)));
    const hidden = items.length - visible.length;
    // what the last commit drew, to tell what is new now: a row appended at the tail, or a part landing in a row that was
    // already there, opens on the spring (Arriving); a row the first load, Show earlier or a restored place draws does not.
    // Your own message is drawn at once too: its pending twin (chatpane.tsx) stood in the tail until it landed, and a twin
    // swapped for a row that opens from nothing would dip. Under reduced motion nothing opens.
    const reduceMotion = useReducedMotion();
    // the card row's margin is no height or transform, so MotionConfig's reduced motion would still glide it: it jumps here
    const rowSpring = reduceMotion ? { duration: 0 } : MOTION.spring;
    const lastDrawn = useRef<{ items: string[]; parts: Set<string> }>({ items: [], parts: new Set() });
    const visibleKeys = visible.map((item) => item.key);
    const arrived = reduceMotion ? NO_KEYS : tailArrivals(lastDrawn.current.items, visibleKeys);
    const drawnBefore = new Set(lastDrawn.current.items);
    useLayoutEffect(() => {
        lastDrawn.current = {
            items: visibleKeys,
            parts: new Set(
                visible.flatMap((item) => (item.kind === "agent" ? item.parts.map((_, p) => `${item.key}#${p}`) : []))
            ),
        };
    });
    // a fold is kept by its item's key and its part's place in the item, so it stays with its item as entries arrive
    const [opened, setOpened] = useState<Set<string>>(new Set());
    const rootRef = useRef<HTMLDivElement>(null);
    // your message pins to the top once it scrolls off it; `prompts` is the text of each data-user-prompt bubble, in
    // document order (only YouBubble's prompt branch carries it, not the command bubble, nor the ✓ row a message that
    // answered a brainstorm question draws in its place), which the bar shows for the pinned index
    const pinned = usePinnedPrompt(rootRef);
    const prompts = visible.flatMap((item) =>
        item.kind === "you" && !("command" in item) && !answers.has(item.key)
            ? [pinnedLabel(item.text, item.images?.length ?? 0)]
            : []
    );
    // the scroll before "Show earlier" drew items in front, and the item that was first then
    const heightBeforeGrow = useRef<{ top: number; height: number; first: string | undefined } | null>(null);
    const placedFor = useRef<string | undefined>(undefined); // the placeId whose kept place was looked up
    const live = useRef(visible);
    live.current = visible;

    const toggle = (key: string) =>
        setOpened((prev) => {
            const next = new Set(prev);
            if (!next.delete(key)) {
                next.add(key);
            }
            return next;
        });

    const showEarlier = () => {
        const scroller = scrollParent(rootRef.current);
        heightBeforeGrow.current = scroller
            ? { top: scroller.scrollTop, height: scroller.scrollHeight, first: visible[0]?.key }
            : null;
        if (hidden > 0) {
            setWin((w) => ({ ...w, shown: visible.length + CHAT_RENDER_STEP }));
        } else {
            setWin((w) => ({ ...w, asked: true }));
            onLoadEarlier?.();
        }
    };

    // items drawn in front push what the reader is looking at down by their height: scroll by it, so it stays put. Only
    // once the first drawn item changed, so entries arriving at the end after a load that gave nothing move nothing
    const firstKey = visible[0]?.key;
    useLayoutEffect(() => {
        const before = heightBeforeGrow.current;
        const scroller = scrollParent(rootRef.current);
        if (before == null || scroller == null || before.first === firstKey) {
            return;
        }
        heightBeforeGrow.current = null;
        scroller.scrollTop = before.top + (scroller.scrollHeight - before.height);
    }, [firstKey]);

    // opened again under a kept place: draw back to the item holding it and scroll it to the top, at the same depth
    useLayoutEffect(() => {
        if (placeId == null || placedFor.current === placeId || items.length === 0) {
            return;
        }
        const place = transcriptPlace(placeId);
        if (place == null) {
            placedFor.current = placeId;
            return;
        }
        // the last item starting at or before the kept entry holds it
        let at = -1;
        for (let i = 0; i < items.length && keyIndex(items[i].key) <= place.key; i++) {
            at = i;
        }
        if (at < 0) {
            placedFor.current = placeId;
            return;
        }
        const need = items.length - at;
        if (need > visible.length) {
            setWin((w) => ({ ...w, shown: need })); // drawn on the next render, when this runs again
            return;
        }
        placedFor.current = placeId;
        const el = rootRef.current?.querySelectorAll<HTMLElement>(":scope > [data-chat-item]")[at - hidden];
        const scroller = scrollParent(rootRef.current);
        if (el != null && scroller != null) {
            scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + place.offset;
        }
    }, [placeId, items.length, visible.length]);

    // keeps where the reader is, at most once a frame while they scroll: the item at the top of the view and how far
    // into it, or nothing once they are at the end. Not before the kept place was restored, nor while the view has no size
    useLayoutEffect(() => {
        const root = rootRef.current;
        const scroller = scrollParent(root);
        if (placeId == null || root == null || scroller == null) {
            return;
        }
        let frame = 0;
        const keep = () => {
            frame = 0;
            if (placedFor.current !== placeId || scroller.clientHeight === 0) {
                return;
            }
            if (isNearBottom(scroller)) {
                keepTranscriptPlace(placeId, null);
                return;
            }
            const drawn = root.querySelectorAll<HTMLElement>(":scope > [data-chat-item]");
            const viewTop = scroller.getBoundingClientRect().top;
            const at = firstItemBelow(drawn.length, (i) => drawn[i].getBoundingClientRect().bottom, viewTop);
            const item = live.current[at];
            if (at >= drawn.length || item == null) {
                return;
            }
            keepTranscriptPlace(placeId, {
                key: keyIndex(item.key),
                offset: viewTop - drawn[at].getBoundingClientRect().top,
            });
        };
        const onScroll = () => {
            if (frame === 0) {
                frame = requestAnimationFrame(keep);
            }
        };
        scroller.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            scroller.removeEventListener("scroll", onScroll);
            cancelAnimationFrame(frame);
        };
    }, [placeId]);

    // Both read what is current when they are used, never what the render that made them saw: an item's element is kept
    // while the item is unchanged (drawnItems below), so the handlers inside it outlive the render that created them.
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const openTerminalRef = useRef(onOpenTerminal);
    openTerminalRef.current = onOpenTerminal;
    const openTerminal = useCallback(() => openTerminalRef.current?.(), []);
    // Fork from here is offered while the agent can fork (a Claude agent with a .jsonl transcript, which can arrive after
    // the first items were drawn: DrawnItem.fork), and runs through a ref for the same reason as the two above
    const canFork = !!model && !!agent && canForkInChat(agent);
    const forkRef = useRef<((p: ForkPoint) => void) | null>(null);
    forkRef.current = canFork ? (p) => forkFromChat(model!, agent!, p) : null;
    const forkHere = useCallback((p: ForkPoint) => forkRef.current?.(p), []);
    const copyMenu: CopyMenu = useCallback(
        (text, fork) => (e) =>
            ContextMenuModel.getInstance().showContextMenu(
                [
                    {
                        label: "Copy text",
                        icon: <Copy size={15} />,
                        click: () => void navigator.clipboard.writeText(text),
                    },
                    {
                        label: "Copy conversation",
                        icon: <Copy size={15} />,
                        click: () => void navigator.clipboard.writeText(conversationText(entriesRef.current)),
                    },
                    ...(fork != null
                        ? [
                              { type: "separator" as const },
                              {
                                  label: "Fork from here",
                                  sublabel: "a new session up to this point",
                                  icon: <GitFork size={15} />,
                                  click: () => forkRef.current?.(fork),
                              },
                          ]
                        : []),
                ],
                e
            ),
        []
    );

    const drawPart = (
        item: Extract<ChatItem, { kind: "agent" }>,
        part: AgentPart,
        p: number,
        last: boolean
    ): ReactNode => {
        const key = `${item.key}#${p}`;
        switch (part.kind) {
            // what the agent said: a document column, no bubble and no avatar (only your messages are bubbles); its tools
            // and files sit between the paragraphs, and the copy button hangs in the gap under the text
            case "prose": {
                // a reply still being written: drawn as the stored one will be, but with no fold, copy or fork yet
                if (part.live) {
                    return (
                        <div data-chat-prose data-chat-live className="relative mb-3 min-w-0 max-w-full self-stretch">
                            <LiveProseText text={part.text} />
                        </div>
                    );
                }
                const fork = canFork ? forkPointOfProse(part) : null;
                return (
                    <div
                        data-chat-prose
                        onContextMenu={copyMenu(part.text, fork)}
                        className="group relative mb-3 min-w-0 max-w-full self-stretch"
                    >
                        <ProseText text={part.text} />
                        <BubbleCopy
                            text={part.text}
                            align="left"
                            onFork={fork != null ? () => forkRef.current?.(fork) : undefined}
                        />
                    </div>
                );
            }
            case "work": {
                // the work the agent is doing now: nothing but its files chip after it in the last item. It shows open,
                // so a click on it folds it (a key of its own, which stops counting once the agent is done)
                const autoOpen = !!active && last && item.parts.slice(p + 1).every((q) => q.kind === "files");
                return (
                    <ChatSteps
                        work={part.work}
                        open={opened.has(key)}
                        closed={opened.has(`${key}^closed`)}
                        autoOpen={autoOpen}
                        live={toolsLive}
                        onToggle={() => toggle(autoOpen ? `${key}^closed` : key)}
                    />
                );
            }
            case "files": {
                const openPaths = new Set(part.files.filter((f) => opened.has(`${key}:${f.path}`)).map((f) => f.path));
                return (
                    <FileChips files={part.files} openPaths={openPaths} onToggle={(path) => toggle(`${key}:${path}`)} />
                );
            }
        }
    };

    const drawItem = (item: ChatItem, last: boolean): ReactNode => {
        switch (item.kind) {
            case "you": {
                // a message that answered a brainstorm question: the question's ✓ row in place of its bubble, so the
                // answer is shown once
                const answer = "command" in item ? undefined : answers.get(item.key);
                if (answer != null) {
                    return (
                        <div className="min-w-0 self-stretch">
                            <ChatBrainstormAnswered n={answer.n} part={answer.part} text={answeredText(answer.text)} />
                        </div>
                    );
                }
                return (
                    <YouBubble
                        item={item}
                        onContextMenu={copyMenu}
                        onOpenTerminal={onOpenTerminal != null ? openTerminal : undefined}
                        onFork={canFork ? forkHere : undefined}
                    />
                );
            }
            case "sent":
                return <SentCard item={item} />;
            case "agent":
                return (
                    <div data-chat-agent className="flex min-w-0 flex-col gap-2">
                        {/* a part landing in a row that was already there opens on the spring; one of a row that arrives
                            now, or of a row drawn at once, is part of it */}
                        {item.parts.map((part, p) => {
                            const key = `${item.key}#${p}`;
                            const arrive =
                                !reduceMotion && drawnBefore.has(item.key) && !lastDrawn.current.parts.has(key);
                            return (
                                <Arriving key={key} gap={PART_GAP} arrive={arrive} className="min-w-0">
                                    {drawPart(item, part, p, last)}
                                </Arriving>
                            );
                        })}
                    </div>
                );
            case "marker":
                return <Marker item={item.item} />;
        }
    };

    // An item that is the same as the one drawn for its key last time keeps that element: React skips an element it has
    // already seen, so a block landing at the end of a long conversation renders the last item and not every one before it
    // (chat-redesign step 16 reads that cost as frame time). The keep is by what the item draws from: its content
    // (sameChatItem), whether it is the last, whether the session is live, the folds opened inside it, whether there is
    // a terminal to open, whether it can fork (the transcript path arrives after the first rows are drawn) and the
    // brainstorm answer it stands for, if any. Everything else it draws from is state of its
    // own components or read through a ref.
    const drawnItems = useRef(new Map<string, DrawnItem>());
    const drawnNow = new Map<string, DrawnItem>();
    const rows = visible.map((item, i) => {
        const last = i === visible.length - 1;
        const folds = openedFor(opened, item.key);
        const answer = answerKey(answers.get(item.key));
        const kept = drawnItems.current.get(item.key);
        const reuse =
            kept != null &&
            kept.last === last &&
            kept.active === !!active &&
            kept.live === toolsLive &&
            kept.terminal === (onOpenTerminal != null) &&
            kept.fork === canFork &&
            kept.folds === folds &&
            kept.answer === answer &&
            sameChatItem(kept.item, item);
        const drawn: DrawnItem = reuse
            ? kept
            : {
                  item,
                  last,
                  active: !!active,
                  live: toolsLive,
                  terminal: onOpenTerminal != null,
                  fork: canFork,
                  folds,
                  answer,
                  element: drawItem(item, last),
              };
        drawnNow.set(item.key, drawn);
        return (
            <Arriving
                key={item.key}
                itemKey={item.key}
                gap={ITEM_GAP}
                arrive={item.kind !== "you" && arrived.has(item.key)}
                className={cn("flex flex-col", item.kind === "you" || item.kind === "sent" ? "items-end" : undefined)}
            >
                {drawn.element}
            </Arriving>
        );
    });
    drawnItems.current = drawnNow;

    return (
        <div
            ref={rootRef}
            data-chat-conversation
            className={cn(
                "mx-auto flex w-full max-w-[760px] flex-col gap-4 pb-2 pt-4 leading-relaxed tracking-[-0.01em]",
                className
            )}
        >
            {/* the sticky row is a flex child of a gap-4 column: -mb-4 cancels the gap its zero-height row would add. The
                card keeps clear of the Skim toggle in the pane's corner (mr-10), while the band under it spans the
                column, so a reply scrolling beneath never shows beside the card */}
            <PinnedPromptBar
                rootRef={rootRef}
                index={pinned}
                text={prompts[pinned]}
                bg="bg-background"
                className="-mb-4"
                cardClassName="mr-10"
            />
            {hidden > 0 || onLoadEarlier != null ? (
                <button
                    type="button"
                    data-chat-earlier
                    onClick={showEarlier}
                    className="cursor-pointer self-center rounded-full px-[10px] py-[3px] text-[12px] text-muted hover:bg-surface-hover hover:text-secondary"
                >
                    Show earlier
                </button>
            ) : null}
            {/* one wrapper per item, keyed by its first entry: the place kept and restored is found by it */}
            {rows}
            {/* The question the brainstorm waits on, after the last row: a row kind of its own, not an item (it is no
                data-chat-item, so the place kept and restored never counts it). The card opens its height on the spring
                and leaves on it (the card's own variants); this wrapper does the same with the column's gap, which a
                closed row would otherwise hold open, so nothing above it shoves. The first render draws it at once. */}
            <AnimatePresence initial={false}>
                {brainstorm?.question != null ? (
                    <motion.div
                        key={brainstorm.question.state === "pointer" ? "pointer" : `question:${brainstorm.question.n}`}
                        data-chat-brainstorm-row
                        initial={{ marginTop: -ITEM_GAP }}
                        animate={{ marginTop: 0, transition: rowSpring }}
                        exit={{ marginTop: -ITEM_GAP, transition: rowSpring }}
                    >
                        <ChatBrainstormCard agent={brainstorm.agent} question={brainstorm.question} />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
