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
// The agent's brainstorm shows here as well (chatbrainstormcard.tsx and its siblings): the card it ends with (the question it
// waits on, Confirm the design, the builder check, the run) is a row after the last row, which opens and leaves on the
// spring, and each of your messages that is a line Arc sent draws in place of its bubble by what the line was: an answer
// or a step as its ✓ row, an action line (confirm, edit, keep…) as nothing at all (chatbrainstorm.ts pairs them by the
// record of what Arc sent). Chat never switches to the Brainstorm tab for it; the card's button does that.
// Three moments of the agent's reply draw as cards of their own, where they happened (docs/superpowers/specs/2026-11-12-chat-
// verdict-handoff-design.md): a reviewer's verdict (chatverdictcard.tsx: ticks and Fix / Skip while it waits on you), the plan
// handoff (chathandoffcard.tsx: a ✓ row once answered, the card itself lives in the dock while the agent asks), and every run
// the conversation started (chatruncard.tsx: at the `wsh runs start` call that started it, the rest at the end). Each folds in
// place into its ✓ row. Their modes and places are the pure models' (chatverdict.ts, chatruncards.ts); this file reads the
// stores they need and keeps an item's element only while everything its cards draw from is the same (DrawnItem.cards).
// Two more moments draw the same way (docs/superpowers/specs/2026-11-14-chat-council-design.md): a council the agent started
// with `wsh council start` (chatcouncilcard.tsx: a card at the end of the conversation while it is queued, running or waits
// on you, a one-line row at the call once it ended; chatcouncil.ts places it) and a Doc review ask (chatdocreviewcard.tsx:
// the card is the dock's while the agent asks, and the ✓ row it folds into stands in place once answered).

import { CopyButton } from "@/app/element/copybutton";
import { MOTION, springReveal } from "@/app/element/motiontokens";
import { SkeletonLine } from "@/app/element/skeleton";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { cn } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { ArrowUpRight, ChevronDown, ChevronRight, Copy, EyeOff, Flag, GitFork } from "lucide-react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseMarks } from "../../../../claude/skim-mod/hooks/highlight-core";
import { getProcExitAtom } from "./agentcontrollerstore";
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
import { procExited } from "./brainstormmodel";
import type { BrainstormState } from "./brainstormstore";
import { arrivalFrom, tailArrivals } from "./chatarrival";
import { pairAnswers, type ChatCard, type PairedAnswer, type SentAnswer } from "./chatbrainstorm";
import {
    ChatBrainstormAnswered,
    ChatBrainstormBuilderAnswered,
    ChatBrainstormCard,
    ChatBrainstormStepDone,
} from "./chatbrainstormcard";
import { ChatBrainstormRunDone, ChatBrainstormRunRow, useDoneRuns } from "./chatbrainstormrun";
import { brainstormAnswersAtom } from "./chatbrainstormstore";
import { answerMessages, answeredText, pairedHidden } from "./chatbrainstormwire";
import { councilEndedOnce, placeCouncilCards, type CouncilAnchor } from "./chatcouncil";
import { ChatCouncilCard, ChatCouncilRow } from "./chatcouncilcard";
import { useChatCouncils, useCouncilsEndedOnce } from "./chatcouncilstore";
import { ChatDocReviewCard, ChatDocReviewDone } from "./chatdocreviewcard";
import { ChatFileCards } from "./chatfilecards";
import { splitAttachments } from "./chatfiles";
import { canForkInChat, forkPointOfProse, forkPointOfYou, type ForkPoint } from "./chatfork";
import { forkFromChat } from "./chatforkaction";
import { ChatHandoffCard, ChatHandoffDone } from "./chathandoffcard";
import { ChatInitiativeHost, InitiativeMessageCards } from "./chatinitiativecard";
import { openMessageCard, useMessageCards } from "./chatinitiativestore";
import { sameChatItem } from "./chatitemeq";
import { liveTexts, withLiveReply, type LiveReply } from "./chatlive";
import {
    CHAT_RENDER_STEP,
    agentWentOn,
    chatItems,
    shownItems,
    type AgentPart,
    type ChatItem,
    type ChatMarker,
} from "./chatmodel";
import { btwQuestion } from "./chatpending";
import { ChatRunCard } from "./chatruncard";
import { pairRunEnded, placeRunCards, type RunCardSlot, type RunEnded } from "./chatruncards";
import { withMarks } from "./chatskim";
import { useSkimFold } from "./chatskimstore";
import { placeStepLists, stepsPartKey, type AgentNow } from "./chatsteplist";
import { ChatStepsHost, StepsPart } from "./chatsteplistview";
import { ChatSteps } from "./chatstepsview";
import { TaggedPromptText } from "./chattagblock";
import { foldCommandParts, splitTagged, tagHeading, type TagPart } from "./chattagblocks";
import { VERDICT_TOPIC, verdictMode, type VerdictMode } from "./chatverdict";
import { ChatVerdictCard } from "./chatverdictcard";
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
import { useConversationRuns } from "./runoriginstore";
import { runQueueAtom, runQueueStartedAtom, useRunQueueFeed } from "./runqueuestore";
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
// Beside it, Add to initiative… (`onAddInitiative`, given only in a live Claude agent's Chat: opens an initiative card
// from this message, chatinitiativecard.tsx) and Fork from here (`onFork`, given only where the item points at a
// transcript record of a forkable session).
function BubbleCopy({
    text,
    align,
    onFork,
    onAddInitiative,
}: {
    text: string;
    align: "left" | "right";
    onFork?: () => void;
    onAddInitiative?: () => void;
}) {
    return (
        <div
            data-chat-copy
            className={cn(
                "absolute top-full z-10 mt-0 flex items-center rounded-md bg-surface opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none",
                align === "left" ? "left-1" : "right-1"
            )}
        >
            <CopyButton title="Copy" content={text} className="p-1 text-[12px]" />
            {onAddInitiative ? (
                <button
                    type="button"
                    data-chat-add-initiative
                    title="Add to initiative…"
                    aria-label="Add to initiative…"
                    onClick={onAddInitiative}
                    className="cursor-pointer rounded p-1 text-[12px] text-muted hover:bg-hover hover:text-ink-mid"
                >
                    <Flag size={12} strokeWidth={2} aria-hidden />
                </button>
            ) : null}
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

// the context menu of one bubble: Copy text and Copy conversation, with `initiative` (the text an initiative card opens
// with: a prose part's, or your own message's without the files it carried; given only in a live Claude agent's Chat)
// Add to initiative…, and with a fork point, Fork from here
type CopyMenu = (text: string, fork?: ForkPoint | null, initiative?: string | null) => (e: React.MouseEvent) => void;

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
    onAddInitiative,
}: {
    item: Extract<ChatItem, { kind: "you" }>;
    onContextMenu: CopyMenu;
    onOpenTerminal?: () => void;
    // given where this session can fork: starts the fork from the message's own record (forkPointOfYou finds none for a
    // command, or a message with no uuid, and then it offers nothing)
    onFork?: (point: ForkPoint) => void;
    // given in a live Claude agent's Chat: opens an initiative card with the message's text (a command offers none)
    onAddInitiative?: (text: string) => void;
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
    // the card opens with what you wrote, not the paths of the files and pictures that rode with it
    const initiative = onAddInitiative != null && text !== "" ? text : null;
    return (
        <div
            data-chat-you
            data-user-prompt
            onContextMenu={onContextMenu(item.text, fork, initiative)}
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
                            onAddInitiative={initiative != null ? () => onAddInitiative?.(initiative) : undefined}
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
const NO_ENDED: ReadonlyMap<string, { runId: string; ended: RunEnded }> = new Map();
// the run queue is read only by a conversation that has a queued start in it (placeRunCards tells an entry still waiting
// from one that left the queue by it)
const NO_QUEUE: Atom<RunQueueEntry[]> = atom<RunQueueEntry[]>([]);
const NO_STARTED: Atom<Record<string, string>> = atom<Record<string, string>>({});

// Loads the run queue for the conversation's queued starts. A component of its own, because a hook cannot be called only
// when a queued start is there.
function RunQueueFeed(): null {
    useRunQueueFeed();
    return null;
}

// What an item's cards depend on beyond the item itself: whether it is the last item drawn, and whether your message is the
// next one drawn (a verdict card's mode, chatverdict.ts verdictMode)
interface ItemCtx {
    lastDrawn: boolean;
    nextIsYou: boolean;
}

/** The agent's brainstorm as the conversation draws it: `card` is what the conversation ends with now (the question it
 *  waits on, the Confirm the design card, the builder check, or the run), `state` and `model` what its views read (the
 *  brainstorm they were made from, the cockpit for the clock and the launcher); `answers` and `topic` are the lines Arc
 *  sent, which pair with your messages so each draws as its ✓ row in place of your bubble, or draws nothing (an action
 *  line). */
export interface ChatBrainstorm {
    agent: AgentVM;
    topic: string;
    answers: readonly SentAnswer[];
    card: ChatCard | null;
    state: BrainstormState | null;
    model: AgentsViewModel;
}

// the one string a paired row is drawn from, for the item's kept element to be compared by: its kind and everything the
// row of that kind shows (a run's ✓ row shows its run-ended message, when one came: `ended`)
function answerKey(a: PairedAnswer | undefined, ended?: RunEnded): string {
    return a == null
        ? ""
        : [
              a.kind,
              a.n,
              a.part,
              a.text,
              a.decisions,
              a.questions,
              a.calls,
              a.outcome,
              a.runId,
              a.typed,
              ended?.text,
          ].join("\n");
}

// the row a message that Arc sent draws in place of its bubble, by what the line was (a hidden line never gets here)
function PairedRow({ answer, ended }: { answer: PairedAnswer; ended?: RunEnded }) {
    switch (answer.kind) {
        case "answer":
            return (
                <ChatBrainstormAnswered
                    n={answer.n}
                    part={answer.part}
                    text={answeredText(answer.text)}
                    typed={answer.typed}
                />
            );
        case "builder-answer":
            return <ChatBrainstormBuilderAnswered n={answer.n} part={answer.part} text={answer.text} />;
        case "design":
        case "builder":
            return <ChatBrainstormStepDone answer={answer} />;
        case "run":
            return answer.runId != null ? <ChatBrainstormRunDone runId={answer.runId} ended={ended} /> : null;
        case "action":
            return null;
    }
}

// the key the end row's wrapper animates a swap by: one per kind, and per question (n) for the question card
function cardKey(card: Exclude<ChatCard, { kind: "run" }>): string {
    return card.kind === "question" ? `question:${card.n}` : card.kind;
}

// an item's element as last drawn, and what it was drawn from (ChatConversation's drawnItems)
interface DrawnItem {
    item: ChatItem;
    last: boolean;
    active: boolean;
    live: boolean;
    terminal: boolean;
    fork: boolean;
    initiative: boolean;
    folds: string;
    answer: string;
    // what its verdict, handoff, Doc review, run and council cards draw from (ChatConversation's cardsOf)
    cards: string;
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
    // the cards the person opened from messages (Add to initiative…), by the item they were opened after
    const canAddInitiative = !!model && !!agent;
    const messageCards = useMessageCards(canAddInitiative ? agent!.id : "");
    const cardAnchors = useMemo(() => new Set(messageCards.map((card) => card.anchor)), [messageCards]);
    // which of your messages answered a question, by row key: every answered question of the conversation, not only the
    // latest. Nothing to pair, nothing computed
    const sentAnswers = brainstorm?.answers;
    const sentTopic = brainstorm?.topic;
    // The agent's send records, which hold the Fix and Skip lines of verdict cards (under VERDICT_TOPIC, sharing the
    // brainstorm's store): a verdict card finds its record by its key and folds, and the line it sent draws nothing, so
    // those pair with their own messages beside the brainstorm's.
    const records = useAtomValue(brainstormAnswersAtom(agent?.id ?? ""));
    const verdictRecords = useMemo(() => {
        const byKey = new Map<string, SentAnswer>();
        for (const r of records) {
            if (r.topic === VERDICT_TOPIC && r.kind === "verdict" && r.verdictKey != null) {
                byKey.set(r.verdictKey, r);
            }
        }
        return byKey;
    }, [records]);
    const answers = useMemo(() => {
        const brainstormed =
            sentAnswers == null || sentAnswers.length === 0 || sentTopic == null
                ? NO_ANSWERS
                : pairAnswers(sentAnswers, answerMessages(stored), sentTopic);
        if (verdictRecords.size === 0) {
            return brainstormed;
        }
        const verdicts = pairAnswers(records, answerMessages(stored), VERDICT_TOPIC);
        return verdicts.size === 0 ? brainstormed : new Map([...brainstormed, ...verdicts]);
    }, [stored, sentAnswers, sentTopic, records, verdictRecords]);
    // An agent that exited draws every card static (no ticks, no buttons, no amber dot); without an agent there is
    // nothing to answer to, so the same.
    const procExit = useAtomValue(getProcExitAtom(agent?.blockId ?? ""));
    const exited = agent == null || procExited(procExit, agent.sleeping);
    // where each turn's step checklist draws and what it shows (chatsteplist.ts); the blocks read it through the host, so
    // an item kept from an earlier render still redraws its list when a later block of its turn arrives
    const stepsNow: AgentNow = toolsLive ? "working" : active ? "waiting" : "idle";
    const stepLists = useMemo(() => placeStepLists(items, stepsNow), [items, stepsNow]);
    // The runs this conversation started. Each `wsh runs start` call's part is anchored to the run (or queued start) its
    // output names; `placeRunCards` says where every run draws: at its call, else at the end. The brainstorm's run keeps its
    // place at the end (the brainstorm card) and is claimed from the calls. A queued start is told from one that left the
    // queue by the queue itself, which is loaded while any call here queued a start.
    const convRuns = useConversationRuns(agent?.transcriptPath);
    const brainstormCard = brainstorm?.card;
    const brainstormRun = brainstormCard?.kind === "run" ? brainstormCard.runId : null;
    const runAnchors = useMemo(
        () =>
            stored.flatMap((item) =>
                item.kind === "agent"
                    ? item.parts.flatMap((part) =>
                          // `order` is the entry's index: a place in the conversation, far below any run's creation time
                          part.kind === "runstart"
                              ? [{ key: part.key, anchor: part.anchor, order: keyIndex(part.key) }]
                              : []
                      )
                    : []
            ),
        [stored]
    );
    const hasQueuedStart = runAnchors.some((a) => a.anchor.kind === "queued");
    const queue = useAtomValue(hasQueuedStart ? runQueueAtom : NO_QUEUE);
    const queueStarted = useAtomValue(hasQueuedStart ? runQueueStartedAtom : NO_STARTED);
    const placed = useMemo(
        () =>
            placeRunCards({
                anchors: runAnchors,
                runs: convRuns.map((r) => ({ runId: r.oid, createdTs: r.createdts })),
                brainstormRun,
                queued: queue,
                started: queueStarted,
            }),
        [runAnchors, convRuns, brainstormRun, queue, queueStarted]
    );
    // a slot draws a card when it names a run, or a start the queue still holds; a start that left the queue with no run
    // to be found draws nothing (and no empty slot in the column)
    const drawsRunCard = (slot: RunCardSlot): boolean =>
        slot.runId != null || ("entryId" in slot && queue.some((e) => e.id === slot.entryId));
    // The councils this conversation started, found as the runs are: by the `wsh council start` call whose output names
    // them (chatcouncil.ts), so a council the person started from this agent has no card here. Each is read through
    // `useChatCouncils` (loaded once, current on `council:changed`). A council that never ended is a card at the end of the
    // conversation; one that ended once (chatcouncil.ts councilEndedOnce) is a row at its call for good, whatever it does
    // next. A call outside the loaded transcript draws nothing (spec, Builder decision 4): Show earlier brings its row back.
    // The card and the row open the council's room through the cockpit (`model`), so a conversation drawn without one (an
    // ended session's transcript, a subagent's interior) has none: its `wsh council start` call stays the tool line.
    const councilAnchors = useMemo(
        () =>
            model == null
                ? []
                : stored.flatMap((item) =>
                      item.kind === "agent"
                          ? item.parts.flatMap((part) =>
                                part.kind === "councilstart"
                                    ? [{ key: part.key, anchor: part.anchor, order: keyIndex(part.key) }]
                                    : []
                            )
                          : []
                  ),
        [stored, model]
    );
    const councilIds = useMemo(() => [...new Set(councilAnchors.map((a) => a.anchor.councilId))], [councilAnchors]);
    const councils = useChatCouncils(councilIds);
    const seenEnded = useCouncilsEndedOnce();
    const placedCouncils = useMemo(() => {
        const endedOnce = new Set<string>();
        for (const { anchor } of councilAnchors) {
            const id = anchor.councilId;
            if (councilEndedOnce(councils.get(id) ?? null, anchor, seenEnded.has(id))) {
                endedOnce.add(id);
            }
        }
        return placeCouncilCards({ anchors: councilAnchors, councils, endedOnce });
    }, [councilAnchors, councils, seenEnded]);
    // each live council's anchor, for its card (the first call that named it, as placeCouncilCards keeps)
    const councilAnchorOf = useMemo(() => {
        const byId = new Map<string, CouncilAnchor>();
        for (const { anchor } of [...councilAnchors].sort((a, b) => a.order - b.order)) {
            if (!byId.has(anchor.councilId)) {
                byId.set(anchor.councilId, anchor);
            }
        }
        return byId;
    }, [councilAnchors]);
    // The `[arc] Run … landed|held` messages of the runs that draw a card here (the brainstorm's included, and a call's run
    // the store has not listed yet): each draws nothing, its run's card folding into a ✓ row that carries it instead.
    // `runLines` are the runs of the `brainstorm: run` lines (below), whose ✓ row the message makes as well.
    const runLines = useMemo(
        () => [
            ...new Set([...answers.values()].flatMap((a) => (a.kind === "run" && a.runId != null ? [a.runId] : []))),
        ],
        [answers]
    );
    const cardRunIds = useMemo(() => {
        const ids = new Set<string>(convRuns.map((r) => r.oid));
        for (const slot of placed.byAnchor.values()) {
            if (slot.runId != null) {
                ids.add(slot.runId);
            }
        }
        if (brainstormRun != null) {
            ids.add(brainstormRun);
        }
        for (const id of runLines) {
            ids.add(id);
        }
        return [...ids];
    }, [convRuns, placed, brainstormRun, runLines]);
    const endedMessages = useMemo(
        () => (cardRunIds.length === 0 ? NO_ENDED : pairRunEnded(answerMessages(stored), cardRunIds)),
        [stored, cardRunIds]
    );
    // a run that ended more than once (held, then landed) is told by its last message
    const endedByRun = useMemo(() => {
        const byRun = new Map<string, RunEnded>();
        for (const { runId, ended } of endedMessages.values()) {
            byRun.set(runId, ended);
        }
        return byRun;
    }, [endedMessages]);
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
    // A line Arc sent can draw nothing at all (an action line, the Fix or Skip line of a verdict card, a run-ended message,
    // or the line that started a run while the run is live): such an item gets no wrapper, so it leaves no empty slot in
    // the column's gap. `drawnVisible` is what has an element, in order, which is what the place kept and restored below
    // indexes (the drawn elements, not `visible`). A run with a run-ended message is over for the `brainstorm: run` line,
    // held or not: that line draws the ✓ row with the message.
    const storeDoneRuns = useDoneRuns(runLines);
    const doneRuns = useMemo(() => {
        if (endedByRun.size === 0) {
            return storeDoneRuns;
        }
        return new Set([...storeDoneRuns, ...endedByRun.keys()]);
    }, [storeDoneRuns, endedByRun]);
    const pairedOf = (item: ChatItem): PairedAnswer | undefined =>
        item.kind === "you" && !("command" in item) ? answers.get(item.key) : undefined;
    // the run-ended message a paired `brainstorm: run` line's ✓ row carries
    const endedOf = (answer: PairedAnswer | undefined): RunEnded | undefined =>
        answer?.kind === "run" && answer.runId != null ? endedByRun.get(answer.runId) : undefined;
    const hiddenLine = (item: ChatItem): boolean => {
        const answer = pairedOf(item);
        return (answer != null && pairedHidden(answer, doneRuns)) || endedMessages.has(item.key);
    };
    const drawnVisible = visible.filter((item) => !hiddenLine(item));
    // what the last commit drew, to tell what is new now: a row appended at the tail, or a part landing in a row that was
    // already there, opens on the spring (Arriving); a row the first load, Show earlier or a restored place draws does not.
    // Your own message is drawn at once too: its pending twin (chatpane.tsx) stood in the tail until it landed, and a twin
    // swapped for a row that opens from nothing would dip. Under reduced motion nothing opens.
    const reduceMotion = useReducedMotion();
    // the card row's margin is no height or transform, so MotionConfig's reduced motion would still glide it: it jumps here
    const rowSpring = reduceMotion ? { duration: 0 } : MOTION.spring;
    // the end row's gap opens and closes on it (the card brings its own height)
    const endRow = {
        initial: { marginTop: -ITEM_GAP },
        animate: { marginTop: 0, transition: rowSpring },
        exit: { marginTop: -ITEM_GAP, transition: rowSpring },
    };
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
    // answered a brainstorm question draws in its place, nor a run-ended message, which draws nothing), which the bar shows
    // for the pinned index
    const pinned = usePinnedPrompt(rootRef);
    const prompts = visible.flatMap((item) =>
        item.kind === "you" && !("command" in item) && !answers.has(item.key) && !endedMessages.has(item.key)
            ? [pinnedLabel(item.text, item.images?.length ?? 0)]
            : []
    );
    // the scroll before "Show earlier" drew items in front, and the item that was first then
    const heightBeforeGrow = useRef<{ top: number; height: number; first: string | undefined } | null>(null);
    const placedFor = useRef<string | undefined>(undefined); // the placeId whose kept place was looked up
    const live = useRef(drawnVisible);
    live.current = drawnVisible;

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
        // the last drawn item starting at or before the kept entry: a line that draws nothing has no element to scroll to
        const drawnAt = drawnVisible.filter((it) => keyIndex(it.key) <= place.key).length - 1;
        const el =
            drawnAt >= 0
                ? rootRef.current?.querySelectorAll<HTMLElement>(":scope > [data-chat-item]")[drawnAt]
                : undefined;
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
    // Add to initiative… is offered in a live Claude agent's Chat (a caller that passed the cockpit and the agent). It
    // opens a card after the last item as it is when asked, so the item key and the agent go through a ref as well
    const initiativeRef = useRef<{ agentId: string; anchor: string } | null>(null);
    initiativeRef.current = canAddInitiative
        ? { agentId: agent!.id, anchor: items[items.length - 1]?.key ?? "" }
        : null;
    const addToInitiative = useCallback((text: string) => {
        const at = initiativeRef.current;
        if (at != null) {
            openMessageCard(at.agentId, at.anchor, text);
        }
    }, []);
    const copyMenu: CopyMenu = useCallback(
        (text, fork, initiative) => (e) =>
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
                    ...(initiative != null || fork != null ? [{ type: "separator" as const }] : []),
                    ...(initiative != null
                        ? [
                              {
                                  label: "Add to initiative…",
                                  sublabel: "a note, a chunk or a new initiative",
                                  icon: <Flag size={15} />,
                                  click: () => addToInitiative(initiative),
                              },
                          ]
                        : []),
                    ...(fork != null
                        ? [
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
        [addToInitiative]
    );

    // what a verdict card is doing: it is the last thing drawn (in the last item drawn, with the agent having gone on
    // after it no further than the closing words of the same reply: agentWentOn), and the agent works or waits, your
    // message follows it, or you already answered it (chatverdict.ts verdictMode)
    const verdictModeOf = (
        item: Extract<ChatItem, { kind: "agent" }>,
        part: Extract<AgentPart, { kind: "verdict" }>,
        p: number,
        ctx: ItemCtx
    ): VerdictMode =>
        verdictMode({
            last: ctx.lastDrawn && !agentWentOn(entries, item.parts, p),
            live: !exited,
            working: toolsLive,
            nextIsYou: ctx.nextIsYou,
            record: verdictRecords.get(part.key) ?? null,
            v: part.verdict,
        });
    // Everything an item's cards draw from that the item itself does not hold, as one string for the kept element to be
    // compared by: whether the agent exited, the agent fields a card sends and opens through (a kept element would hold a
    // stale one), each verdict's mode, for each run call the place its run draws at and the run-ended message that folds
    // it (the message is an item of its own, so its arrival does not change the item holding the call), for each council
    // call whether its council's row draws there (a council ends after the call, so the item is unchanged), and for a
    // handoff or a Doc review that the dock holds or the exited agent draws static (so `exited` is in the string). "" for
    // an item with no card.
    const cardsOf = (item: ChatItem, ctx: ItemCtx): string => {
        if (item.kind !== "agent") {
            return "";
        }
        const out: string[] = [];
        item.parts.forEach((part, p) => {
            if (part.kind === "verdict") {
                out.push(JSON.stringify(verdictModeOf(item, part, p, ctx)));
            } else if (part.kind === "handoff") {
                out.push("handoff");
            } else if (part.kind === "docreview") {
                out.push("docreview");
            } else if (part.kind === "runstart") {
                const slot = placed.byAnchor.get(part.key);
                const ended = slot?.runId != null ? endedByRun.get(slot.runId) : undefined;
                out.push(JSON.stringify([slot ?? null, slot != null && drawsRunCard(slot), ended?.text ?? null]));
            } else if (part.kind === "councilstart") {
                out.push(`council:${placedCouncils.atCall.get(part.key) ?? ""}`);
            }
        });
        return out.length === 0
            ? ""
            : [
                  exited,
                  agent?.id,
                  agent?.blockId,
                  agent?.sleeping != null,
                  agent?.name,
                  agent?.transcriptPath,
                  ...out,
              ].join("\n");
    };

    const drawPart = (
        item: Extract<ChatItem, { kind: "agent" }>,
        part: AgentPart,
        p: number,
        last: boolean,
        ctx: ItemCtx
    ): ReactNode => {
        const key = `${item.key}#${p}`;
        switch (part.kind) {
            // what the agent said: a document column, no bubble and no avatar (only your messages are bubbles); its tools
            // and files sit between the paragraphs, and the copy button hangs in the gap under the text
            case "prose": {
                // a reply still being written: drawn as the stored one will be, but with no fold, copy or fork yet
                // StepsPart: a ```arc-steps block in it finds its turn's list by this part's key (chatsteplist.ts)
                if (part.live) {
                    return (
                        <div data-chat-prose data-chat-live className="relative mb-3 min-w-0 max-w-full self-stretch">
                            <StepsPart partKey={stepsPartKey(item.key, p)}>
                                <LiveProseText text={part.text} />
                            </StepsPart>
                        </div>
                    );
                }
                const fork = canFork ? forkPointOfProse(part) : null;
                return (
                    <div
                        data-chat-prose
                        onContextMenu={copyMenu(part.text, fork, canAddInitiative ? part.text : null)}
                        className="group relative mb-3 min-w-0 max-w-full self-stretch"
                    >
                        <StepsPart partKey={stepsPartKey(item.key, p)}>
                            <ProseText text={part.text} />
                        </StepsPart>
                        <BubbleCopy
                            text={part.text}
                            align="left"
                            onFork={fork != null ? () => forkRef.current?.(fork) : undefined}
                            onAddInitiative={canAddInitiative ? () => addToInitiative(part.text) : undefined}
                        />
                    </div>
                );
            }
            case "work": {
                // the work the agent is doing now: nothing but its files chip and its cards (a verdict, a handoff, a Doc
                // review, a run or a council it started) after it in the last item. It shows open, so a click on it folds
                // it (a key of its own, which stops counting once the agent is done)
                const autoOpen =
                    !!active &&
                    last &&
                    item.parts
                        .slice(p + 1)
                        .every(
                            (q) =>
                                q.kind === "files" ||
                                q.kind === "verdict" ||
                                q.kind === "handoff" ||
                                q.kind === "docreview" ||
                                q.kind === "runstart" ||
                                q.kind === "councilstart"
                        );
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
            // a reviewer's verdict: a card while it waits on you (or the agent works, or has exited), its ✓ row once it folds
            case "verdict":
                return (
                    <ChatVerdictCard
                        verdictKey={part.key}
                        verdict={part.verdict}
                        mode={verdictModeOf(item, part, p, ctx)}
                        agent={agent}
                        model={model}
                        reviewer={part.reviewer}
                    />
                );
            // the plan handoff: answered, its ✓ row. Unanswered, the live card is the dock's (chatpane.tsx), where the agent
            // waits on it, so a live agent's conversation draws nothing; an agent that exited has the static card here
            case "handoff": {
                const q = part.question;
                if (q.picked.length > 0 || !!q.typed?.trim()) {
                    return <ChatHandoffDone picked={q.picked} typed={q.typed} />;
                }
                return exited ? <ChatHandoffCard question={q} state="static" agent={agent} /> : null;
            }
            // a run the agent started: its card, where the call is. A run another call named first, the brainstorm's, or a
            // start that left the queue with no run to be found has none here
            case "runstart": {
                const slot = placed.byAnchor.get(part.key);
                if (slot == null || !drawsRunCard(slot)) {
                    return null;
                }
                return (
                    <ChatRunCard
                        slot={slot}
                        model={model}
                        live={!exited}
                        ended={slot.runId != null ? endedByRun.get(slot.runId) : undefined}
                    />
                );
            }
            // a council the agent started: its row, where the call is, once it ended once (it updates in place with the
            // council). Its live card sits at the end of the conversation, so a call whose council still draws there, or
            // another call named first, has nothing here
            case "councilstart": {
                const id = placedCouncils.atCall.get(part.key);
                return id != null && model != null ? (
                    <ChatCouncilRow councilId={id} anchor={part.anchor} model={model} />
                ) : null;
            }
            // a Doc review: answered, its row. Unanswered, the live card is the dock's (chatpane.tsx), as the handoff's is,
            // so a live agent's conversation draws nothing; an agent that exited has the static card here
            case "docreview": {
                const q = part.question;
                if (q.picked.length > 0 || !!q.typed?.trim()) {
                    return <ChatDocReviewDone question={q} agent={agent} />;
                }
                return exited ? <ChatDocReviewCard question={q} state="static" agent={agent} model={model} /> : null;
            }
        }
    };

    const drawItem = (item: ChatItem, last: boolean, ctx: ItemCtx): ReactNode => {
        switch (item.kind) {
            case "you": {
                // a message that is a line Arc sent to the brainstorm: its ✓ row in place of its bubble (a question's, a
                // builder question's, a step's), so it is shown once. A line that draws nothing never gets here: `rows`
                // gives it no wrapper (drawnVisible)
                const answer = pairedOf(item);
                if (answer != null) {
                    return (
                        <div className="min-w-0 self-stretch">
                            <PairedRow answer={answer} ended={endedOf(answer)} />
                        </div>
                    );
                }
                return (
                    <YouBubble
                        item={item}
                        onContextMenu={copyMenu}
                        onOpenTerminal={onOpenTerminal != null ? openTerminal : undefined}
                        onFork={canFork ? forkHere : undefined}
                        onAddInitiative={canAddInitiative ? addToInitiative : undefined}
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
                            // a part that draws nothing (a handoff or a Doc review the dock holds, a run another call named,
                            // a council whose card is at the end) gets no wrapper, so it leaves no empty slot in the
                            // item's gap
                            const node = drawPart(item, part, p, last, ctx);
                            if (node == null) {
                                return null;
                            }
                            const key = `${item.key}#${p}`;
                            const arrive =
                                !reduceMotion && drawnBefore.has(item.key) && !lastDrawn.current.parts.has(key);
                            return (
                                <Arriving key={key} gap={PART_GAP} arrive={arrive} className="min-w-0">
                                    {node}
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
    // a terminal to open, whether it can fork (the transcript path arrives after the first rows are drawn), whether it
    // offers Add to initiative…, the brainstorm answer it stands for, if any, and what its cards draw from (cardsOf, below).
    // Everything else it draws from is state of
    // its own components or read through a ref. The initiative cards the person opened from messages are rows of their
    // own after the row of the item they were opened after (InitiativeMessageCards: no data-chat-item, so the place kept
    // and restored never counts them, and no part of the key above); one whose item is not drawn is drawn at the end.
    // The cards of an item (a verdict, a handoff, a Doc review, a run, a council) draw from more than the item: whether it
    // is the last thing drawn, whether your message follows (a verdict's mode), the agent, the run-ended messages (they are
    // items of their own, so an item holding a run's call is unchanged when its message arrives), where each run draws and
    // whether each council's row draws at its call. `cards` is all of that in one string; the element is kept only while it
    // stays the same.
    const drawnIndex = new Map(drawnVisible.map((it, n) => [it.key, n]));
    const drawnItems = useRef(new Map<string, DrawnItem>());
    const drawnNow = new Map<string, DrawnItem>();
    const drawnKeys = new Set<string>();
    const rows = visible.flatMap((item, i) => {
        if (hiddenLine(item)) {
            return [];
        }
        const paired = pairedOf(item);
        const last = i === visible.length - 1;
        const at = drawnIndex.get(item.key) ?? 0;
        const next = drawnVisible[at + 1];
        const ctx: ItemCtx = {
            lastDrawn: at === drawnVisible.length - 1,
            nextIsYou: next?.kind === "you" && pairedOf(next) == null,
        };
        const folds = openedFor(opened, item.key);
        const answer = answerKey(paired, endedOf(paired));
        const cards = cardsOf(item, ctx);
        const kept = drawnItems.current.get(item.key);
        const reuse =
            kept != null &&
            kept.last === last &&
            kept.active === !!active &&
            kept.live === toolsLive &&
            kept.terminal === (onOpenTerminal != null) &&
            kept.fork === canFork &&
            kept.initiative === canAddInitiative &&
            kept.folds === folds &&
            kept.answer === answer &&
            kept.cards === cards &&
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
                  initiative: canAddInitiative,
                  folds,
                  answer,
                  cards,
                  element: drawItem(item, last, ctx),
              };
        drawnNow.set(item.key, drawn);
        drawnKeys.add(item.key);
        const row = (
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
        return cardAnchors.has(item.key) && agent != null
            ? [row, <InitiativeMessageCards key={`${item.key}:initiative`} agentId={agent.id} anchor={item.key} />]
            : [row];
    });
    drawnItems.current = drawnNow;
    // the anchors of cards whose item is not drawn (another transcript epoch, or a window that dropped it): at the end
    const endAnchors = [...cardAnchors].filter((anchor) => !drawnKeys.has(anchor));

    const body = (
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
            {hasQueuedStart ? <RunQueueFeed /> : null}
            {agent != null
                ? endAnchors.map((anchor) => (
                      <InitiativeMessageCards key={`${anchor}:initiative`} agentId={agent.id} anchor={anchor} />
                  ))
                : null}
            {/* The card the brainstorm ends with (the question it waits on, Confirm the design, the builder check, the
                run), after the last row: a row kind of its own, not an item (it is no data-chat-item, so the place kept
                and restored never counts it). The card opens its height on the spring and leaves on it (the card's own
                variants); this wrapper does the same with the column's gap, which a closed row would otherwise hold
                open, so nothing above it shoves. It is keyed by the card's kind (and a question's number), so a swap
                from one card to the next animates. The first render draws it at once. The run card draws its own
                wrapper (ChatBrainstormRunRow), which a run that is over leaves out altogether: no empty row holding
                the column's gap. The runs of the conversation that no call names (placeRunCards) come before it, each
                one a card of its own, or its ✓ row once it is over. After them come the councils the agent started that
                have not ended (placeCouncilCards), oldest call first, each in a wrapper of its own: the card leaves on
                the spring when its council ends, as its row appears at the call that started it. */}
            <AnimatePresence initial={false}>
                {placed.trailing.map((runId) => (
                    <ChatRunCard
                        key={`run:${runId}`}
                        slot={{ runId }}
                        model={model}
                        live={!exited}
                        ended={endedByRun.get(runId)}
                        rowProps={endRow}
                    />
                ))}
                {model != null
                    ? placedCouncils.trailing.flatMap((id) => {
                          const anchor = councilAnchorOf.get(id);
                          return anchor == null
                              ? []
                              : [
                                    <motion.div key={`council:${id}`} data-chat-council-tail {...endRow}>
                                        <ChatCouncilCard councilId={id} anchor={anchor} model={model} live={!exited} />
                                    </motion.div>,
                                ];
                      })
                    : null}
                {brainstorm?.card != null && brainstorm.state != null ? (
                    brainstorm.card.kind === "run" ? (
                        <ChatBrainstormRunRow
                            key="run"
                            agent={brainstorm.agent}
                            model={brainstorm.model}
                            card={brainstorm.card}
                            rowProps={endRow}
                            ended={endedByRun.get(brainstorm.card.runId)}
                        />
                    ) : (
                        <motion.div key={cardKey(brainstorm.card)} data-chat-brainstorm-row {...endRow}>
                            <ChatBrainstormCard
                                agent={brainstorm.agent}
                                card={brainstorm.card}
                                model={brainstorm.model}
                                state={brainstorm.state}
                            />
                        </motion.div>
                    )
                ) : null}
            </AnimatePresence>
        </div>
    );
    // the initiative cards read their agent and the initiative list from a host: only a live Claude agent's Chat has one;
    // every Chat conversation draws its step checklists
    return (
        <ChatStepsHost placed={stepLists}>
            {canAddInitiative ? (
                <ChatInitiativeHost agent={agent!} model={model!}>
                    {body}
                </ChatInitiativeHost>
            ) : (
                body
            )}
        </ChatStepsHost>
    );
}
