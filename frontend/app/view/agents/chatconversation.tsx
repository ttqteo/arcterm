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
// the conversation started (chatruncard.tsx: at the `wsh runs start` call that started it, the rest at the end while they go
// on and at their run-ended message once over). Each folds in place into its ✓ row. Their modes and places are the pure models' (chatverdict.ts, chatruncards.ts); this file reads the
// stores they need and keeps an item's element only while everything its cards draw from is the same (DrawnItem.cards).
// Two more moments draw the same way (docs/superpowers/specs/2026-11-14-chat-council-design.md): a council the agent started
// with `wsh council start` (chatcouncilcard.tsx: a card at the end of the conversation, after the runs, live while it is
// queued, running or waits on you, and its ended card where it ended once it is over; chatcouncil.ts places it; the
// agent's summary of its report draws in a council panel, chatcouncil.ts councilReports) and a Doc review ask (chatdocreviewcard.tsx:
// the card is the dock's while the agent asks, and the ✓ row it folds into stands in place once answered).
// Boards draw here as well (docs/superpowers/specs/2026-11-19-kael-boards-design.md): a turn that ran `wsh board draw` ends in
// a card for each board it drew on (chatboardcard.tsx: the board's name, its shapes, `drawing…` while the drawer works, Open),
// and a message of yours that a board forwarded (boardforwardmarker.ts) draws a `from <board> · on <shapes>` chip over its
// bubble, the marker line hidden (chatboard.ts).

import { CopyButton } from "@/app/element/copybutton";
import { MOTION } from "@/app/element/motiontokens";
import { SkeletonLine } from "@/app/element/skeleton";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { parseBoardForward } from "@/app/view/boards/boardforwardmarker";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { isWindows } from "@/util/platformutil";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import {
    ArrowRight,
    ArrowUpRight,
    ChevronDown,
    ChevronRight,
    Copy,
    Diamond,
    EyeOff,
    Flag,
    GitFork,
    Link,
} from "lucide-react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseMarks } from "../../../../claude/skim-mod/hooks/highlight-core";
import { getProcExitAtom } from "./agentcontrollerstore";
import { agentDiffScope, openDiff } from "./agentdiffnav";
import { openFileInPanel, railPanelsAtom, toggleRailSummary } from "./agentrailstore";
import { railSummaryShown } from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import {
    conversationText,
    isNearBottom,
    type AgentEntry,
    type AgentVM,
    type BtwAnswer,
    type ShellResult,
} from "./agentsviewmodel";
import { plainText } from "./ansitext";
import { procExited } from "./brainstormmodel";
import type { BrainstormState } from "./brainstormstore";
import { ChatAgentAnswerCard, ChatAgentSendCard, SentMarkdown } from "./chatagentsendcard";
import { arrivalFrom, tailArrivals } from "./chatarrival";
import { boardsDrawn, wordsOf } from "./chatboard";
import { ChatBoardCard, ChatBoardChip } from "./chatboardcard";
import { pairAnswers, type ChatCard, type PairedAnswer, type SentAnswer } from "./chatbrainstorm";
import {
    ChatBrainstormAnswered,
    ChatBrainstormBuilderAnswered,
    ChatBrainstormCard,
    ChatBrainstormStepDone,
} from "./chatbrainstormcard";
import { CardSlot, FOCUS_RING } from "./chatbrainstormparts";
import { ChatBrainstormRunDone, ChatBrainstormRunRow, useDoneRuns } from "./chatbrainstormrun";
import { brainstormAnswersAtom } from "./chatbrainstormstore";
import { answerMessages, answeredText, pairedHidden } from "./chatbrainstormwire";
import { councilEndedOnce, councilReports, placeCouncilCards } from "./chatcouncil";
import { ChatCouncilCard, ChatCouncilEnded, ChatCouncilSummary } from "./chatcouncilcard";
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
import { judgeKeysByItem } from "./chatjudge";
import { ChatJudgeLine } from "./chatjudgeline";
import { linkAt } from "./chatlink";
import { ChatQuoteMenu } from "./chatquotemenu";
import { liveTexts, withLiveReply, type LiveReply } from "./chatlive";
import { withLostBash, type LostBash } from "./chatlostbash";
import {
    CHAT_RENDER_STEP,
    agentWentOn,
    chatItems,
    shownItems,
    type AgentPart,
    type ChatItem,
    type ChatMarker,
} from "./chatmodel";
import { ChatPairHost } from "./chatpairblock";
import { btwQuestion } from "./chatpending";
import { ChatRunCard } from "./chatruncard";
import {
    itemTimes,
    pairRunEnded,
    placeRunCards,
    placeTrailingRuns,
    type RunCardSlot,
    type RunEnded,
} from "./chatruncards";
import { withMarks } from "./chatskim";
import { useSkimFold } from "./chatskimstore";
import { placeStepLists, stepsPartKey, type AgentNow } from "./chatsteplist";
import { ChatStepsHost, StepsPart } from "./chatsteplistview";
import { foreignPathGuesses, turnFileAbs, turnFileDiff, turnFiles } from "./chatsteps";
import { ChatSteps } from "./chatstepsview";
import { chatJudgeAtom } from "./chatsuggeststore";
import { TaggedPromptText } from "./chattagblock";
import { ChatTurnFiles } from "./chatturnfiles";
import { turnCanvas } from "./chatcanvaspeek";
import { ChatCanvasPeekCard } from "./chatcanvaspeekcard";
import { VERDICT_TOPIC, verdictMode, type VerdictMode } from "./chatverdict";
import { ChatVerdictCard } from "./chatverdictcard";
import { CommandOutput, ShellCommand } from "./commandtext";
import { CouncilText } from "./councilchat";
import { firstExistingFile } from "./filetabload";
import { CompactionDivider, InterruptedDivider, PromptImages, TaskNotificationRow } from "./narrationtimeline";
import { placePairLists } from "./pairblocks";
import { pinnedLabel } from "./pinnedlabel";
import { PinnedPromptBar, scrollParent, usePinnedPrompt } from "./pinnedpromptbar";
import { opensRailSummary } from "./railcompaction";
import { railVisibleAtom } from "./railstore";
import { useConversationRuns } from "./runoriginstore";
import { runQueueAtom, runQueueStartedAtom, useRunQueueFeed } from "./runqueuestore";
import { compactionsByIdAtom } from "./subagentsstore";
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
            <CouncilText text={folded ? fold.short : full} className={PROSE} refs commands />
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
    return <CouncilText text={full} className={PROSE} refs commands />;
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
// `note` is a muted line under it, as the status of a `!` run made while the agent slept ("Ran while asleep · exit 1"),
// and `actions` sit at that line's end (chatpane.tsx's asleep runs: Ask agent to fix, ×).
export function CommandCard({
    command,
    bash,
    shell,
    terminal,
    onOpenTerminal,
    note,
    noteTone,
    actions,
    onContextMenu,
}: {
    command: string;
    bash?: boolean;
    shell?: ShellResult;
    terminal?: boolean;
    onOpenTerminal?: () => void;
    note?: ReactNode;
    noteTone?: "error";
    actions?: ReactNode;
    onContextMenu?: CopyMenu;
}) {
    const printed = shell != null && (shell.output !== "" || shell.error !== "");
    // what Copy takes: the command and what it printed, as the terminal shows them (its colours left out)
    const copyText = [bash ? `! ${command}` : command, plainText(shell?.output ?? ""), plainText(shell?.error ?? "")]
        .filter((s) => s !== "")
        .join("\n");
    return (
        <div
            data-chat-you
            data-chat-command
            data-chat-shell={bash ? "" : undefined}
            onContextMenu={onContextMenu?.(copyText)}
            className="group relative mb-1 max-w-[75%] min-w-[220px] self-end"
        >
            <div className="flex flex-col overflow-hidden rounded-[12px] border border-edge-mid bg-surface-raised">
                <div className="flex items-baseline gap-2 px-[14px] py-[8px] font-mono text-[12.5px] text-primary [overflow-wrap:anywhere]">
                    {bash ? (
                        <span aria-label="bash" className="flex-none select-none font-semibold text-accent">
                            !
                        </span>
                    ) : null}
                    {/* a `!` command in the shell's colours, as the box drew it while you typed it */}
                    <span className="min-w-0">{bash ? <ShellCommand command={command} /> : command}</span>
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
                                {/* in colour, as an agent's command output is: its ANSI, its tones, Task's echoes */}
                                {shell.output !== "" ? (
                                    <div className="text-ink-mid">
                                        <CommandOutput command={command} output={shell.output} />
                                    </div>
                                ) : null}
                                {shell.error !== "" ? (
                                    <div className="text-error-soft">
                                        <CommandOutput command={command} output={shell.error} />
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <span className="font-sans text-muted">No output</span>
                        )}
                    </div>
                ) : null}
                {note != null || actions != null ? (
                    <div
                        data-chat-command-note
                        className="flex items-center justify-between gap-3 border-t border-edge-faint px-[14px] py-[6px] text-[11.5px]"
                    >
                        <span className={cn("min-w-0 truncate", noteTone === "error" ? "text-error" : "text-muted")}>
                            {note}
                        </span>
                        {actions != null ? <span className="flex flex-none items-center gap-3">{actions}</span> : null}
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
        return (
            <CommandCard
                command={item.command.slice(2)}
                bash
                shell={item.shell}
                note={item.asleep ?? item.lost}
                onContextMenu={onContextMenu}
            />
        );
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
    // a question forwarded from a board is your words under a marker line (boardforwardmarker.ts): the line is not shown,
    // a chip over the bubble says where the question came from
    const forward = parseBoardForward(item.text);
    const words = forward != null ? forward.question : item.text;
    // the files and images you sent ride the message as trailing blocks of paths (chatfiles.ts); images show as pictures in
    // the bubble and files as cards under it, not as the blocks that name them. The wrapper is the prompt the pinned bar and
    // the scenarios find, when the message says something (pinnedLabel): one of only pictures or files is no pin, so the
    // bar keeps the message before it rather than a "(picture)"
    const said = splitAttachments(words);
    const text = said.text.trim();
    const hasPictures = (item.images?.length ?? 0) > 0 || said.images.length > 0;
    const hasFiles = said.files.length > 0;
    const fork = onFork != null ? forkPointOfYou(item) : null;
    // the card opens with what you wrote, not the paths of the files and pictures that rode with it
    const initiative = onAddInitiative != null && text !== "" ? text : null;
    const bubble = (
        <div
            data-chat-you
            data-user-prompt={text !== "" ? "" : undefined}
            onContextMenu={onContextMenu(words, fork, initiative)}
            className="flex max-w-[75%] flex-col items-end gap-2 self-end"
        >
            {text !== "" || hasPictures ? (
                <div className={cn("group relative", youBubbleBox(hasFiles))}>
                    {text !== "" ? <TaggedPromptText text={text} /> : null}
                    {hasPictures ? <PromptImages images={item.images} paths={said.images} /> : null}
                    {/* the whole message, files and all, as the context menu copies it */}
                    {text !== "" ? (
                        <BubbleCopy
                            text={words}
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
    return forward != null ? (
        <>
            <ChatBoardChip forward={forward} />
            {bubble}
        </>
    ) : (
        bubble
    );
}

// a prompt arcterm typed: an outlined card on the right naming its sender, its lines in mono, folded past three. A message
// another agent sent heads with a link to that agent's conversation (ctrl-click peeks it)
function SentCard({ item, model }: { item: Extract<ChatItem, { kind: "sent" }>; model?: AgentsViewModel }) {
    const [open, setOpen] = useState(false);
    const folds = item.lines.length > SENT_FOLD_LINES;
    const lines = folds && !open ? item.lines.slice(0, SENT_FOLD_LINES) : item.lines;
    const tabId = item.tabId;
    const head = (
        <>
            <span className="min-w-0 truncate font-medium text-primary">{item.header}</span>
            {/* the sender's tab, short: part of the head, so a click opens it too; the whole id on hover */}
            {tabId != null ? (
                <span
                    data-chat-sent-tab
                    title={`tab ${tabId}`}
                    className="flex-none self-center rounded-[4px] bg-surface-raised px-[5px] py-px font-mono text-[10.5px] leading-[1.4] text-muted group-hover:text-secondary"
                >
                    {tabId.slice(0, 8)}
                </span>
            ) : null}
            <span className="flex-none text-[11.5px] text-muted">
                {item.from === "run" ? "from the run" : "from the cockpit"}
            </span>
        </>
    );
    return (
        <div
            data-chat-sent
            data-chat-from={item.from}
            className="flex max-w-[75%] flex-col gap-[6px] self-end rounded-[12px] border border-edge-mid px-[14px] py-[9px]"
        >
            {tabId != null && model != null ? (
                <button
                    type="button"
                    data-chat-sent-open
                    title="Open the conversation that sent this"
                    onClick={(e) => fireAndForget(() => openOrPeek(model, { kind: "agent", tabId }, e))}
                    className={cn(
                        FOCUS_RING,
                        "group flex min-w-0 cursor-pointer items-baseline gap-2 self-start rounded-[4px] border-0 bg-transparent p-0 text-left text-[12.5px]"
                    )}
                >
                    {head}
                    <ArrowUpRight
                        size={12}
                        strokeWidth={2}
                        aria-hidden
                        className="flex-none self-center text-muted group-hover:text-primary"
                    />
                </button>
            ) : (
                <div className="flex min-w-0 items-baseline gap-2 text-[12.5px]">{head}</div>
            )}
            {item.markdown != null ? (
                <SentMarkdown text={item.markdown} />
            ) : lines.length > 0 ? (
                <div className="flex flex-col font-mono text-[11.5px] leading-[1.55] text-secondary">
                    {lines.map((line, i) => (
                        <div key={i} className="[overflow-wrap:anywhere]">
                            {line}
                        </div>
                    ))}
                </div>
            ) : null}
            {folds && item.markdown == null ? (
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
const NO_LOST: readonly LostBash[] = [];
const NO_ANSWERS: ReadonlyMap<string, PairedAnswer> = new Map();
const NO_JUDGE_KEYS: ReadonlyMap<string, string> = new Map();
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

// where a chunk's work begins: the message that moved the agent to it (the Initiative tab's Work on this) carries the
// chunk, and the rule across the column says which one the turns below are for
function ChunkDivider({ n, label }: { n: number; label: string }) {
    return (
        <div data-chat-chunk-divider={n} className="mb-1 flex items-center gap-2.5 self-stretch">
            <span className="h-px flex-1 bg-edge-mid" />
            <span
                title={`Chunk ${n} · ${label}`}
                className="inline-flex min-w-0 max-w-[75%] items-center gap-1.5 rounded-full border border-edge-strong bg-surface px-2.5 py-0.5 text-[11.5px] leading-[1.6] text-secondary"
            >
                <Diamond size={11} strokeWidth={1.8} aria-hidden className="flex-none text-accent-soft" />
                <span className="flex-none font-mono text-[10.5px] text-muted">Chunk {n}</span>
                <span className="min-w-0 truncate text-ink-hi">{label}</span>
            </span>
            <span className="h-px flex-1 bg-edge-mid" />
        </div>
    );
}

// what stands for the message the Initiative tab sent to tell the agent of a switch: arcterm's words, on your side of the column
function SwitchNoteRow({ n }: { n: number }) {
    return (
        <div data-chat-switch-note={n} className="flex items-center gap-1.5 text-[12px] text-muted">
            <ArrowRight size={12} strokeWidth={1.8} aria-hidden className="flex-none" />
            Moved to chunk {n} · sent by arcterm
        </div>
    );
}

// Chat's Compacted divider: the last compaction's opens and closes the rail's Summary tab, which draws its summary
function ChatCompactionDivider({
    item,
    agentId,
}: {
    item: Extract<ChatMarker, { kind: "compaction" }>;
    agentId?: string;
}) {
    const list = useAtomValue(compactionsByIdAtom)[agentId ?? ""];
    const panel = useAtomValue(railPanelsAtom)[agentId ?? ""];
    const railVisible = useAtomValue(railVisibleAtom);
    const canToggle = agentId != null && opensRailSummary(list, item.preTokens, item.postTokens);
    return (
        <CompactionDivider
            trigger={item.trigger}
            preTokens={item.preTokens}
            postTokens={item.postTokens}
            onToggle={canToggle ? () => toggleRailSummary(agentId) : undefined}
            open={canToggle && railSummaryShown(panel, railVisible)}
        />
    );
}

function Marker({ item, agentId }: { item: ChatMarker; agentId?: string }) {
    switch (item.kind) {
        case "compaction":
            return <ChatCompactionDivider item={item} agentId={agentId} />;
        case "interrupted":
            return <InterruptedDivider dropped={item.dropped} />;
        case "notification":
            return <TaskNotificationRow summary={item.summary} status={item.status} result={item.result} />;
    }
}

export function ChatConversation({
    entries,
    lostBash,
    liveReply,
    liveNarrates,
    placeId,
    keyOffset = 0,
    catchingUp,
    onLoadEarlier,
    active,
    working,
    ownArrives,
    onOpenTerminal,
    brainstorm,
    model,
    agent,
    cwd,
    liveJudgeKey,
    className,
}: {
    entries: AgentEntry[];
    // the `!` commands arcterm's restart cut short, drawn as their rows where they were sent (chatlostbash.ts); left out
    // where there are none to draw (an ended session, a subagent's interior)
    lostBash?: readonly LostBash[];
    // the reply Claude is writing (chatlive.ts, chatlivestore.ts): drawn at the end until the transcript holds its blocks,
    // its thinking blocks too when `liveNarrates`. Read here, not by the caller, so its ticks redraw only the conversation
    liveReply?: Atom<LiveReply | null>;
    liveNarrates?: boolean;
    // keeps where the reader is under this id (transcriptplace.ts) and opens there again; a caller that sticks to the
    // end (useStickToBottom) passes it the same id, so it does not pin over a kept place
    placeId?: string;
    // what the caller's window counts in front of these entries (railtranscript.tsx View.keyOffset): the place is kept as
    // an entry index less it, so it still names the same message after the window loaded earlier lines or was cut to its
    // tail while the conversation was not shown
    keyOffset?: number;
    // a kept window shown again while it reads what the agent wrote meanwhile (railtranscript.tsx catchingUp): the rows
    // that read brings are drawn at once, as the first load's are, not opened one by one on the spring
    catchingUp?: boolean;
    // every item is drawn and the reader asked for earlier ones: the caller may load earlier entries
    onLoadEarlier?: () => void;
    // the session is live: its last stretch of work is open while it is the last thing drawn
    active?: boolean;
    // the session is working, so a tool with no result is running (a spinner, counted in the stretch); one a session
    // that stopped left without a result is drawn neutral. Defaults to `active`; a session waiting on an answer is
    // `active` but not working
    working?: boolean;
    // a message of yours landing now opens on the spring as any row does: no pending bubble stood in for it (one typed in
    // the terminal, or one whose bubble went before its record landed). Left out, your rows are drawn at once, as a
    // bubble's twin must be: a row that opens from nothing in the bubble's place would dip
    ownArrives?: boolean;
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
    // the agent's working directory: the card of a finished turn's files names each one's folder relative to it
    cwd?: string | null;
    // the key (chatsuggest.ts suggestKey) of the pane's current turn while its suggested replies show, else null: the
    // judge's line under that turn's message is the live one, which offers Read the code and pick, Stop and Retry
    // (chatjudgeline.tsx). Every other line shows what was judged and nothing to press
    liveJudgeKey?: string | null;
    className?: string;
}) {
    const toolsLive = working ?? !!active;
    const stored = useMemo(() => withLostBash(chatItems(entries), lostBash ?? NO_LOST), [entries, lostBash]);
    const reply = useAtomValue(liveReply ?? NO_LIVE_REPLY);
    const items = useMemo(
        () => withLiveReply(stored, liveTexts(reply, !!liveNarrates), entries.length),
        [stored, reply, liveNarrates, entries.length]
    );
    // The judge records of the agent's choice turns (chatjudge.ts) and the item each is drawn under: a line after its row,
    // like the run and council cards (endedAfter), never inside the item's cached element, so a record arriving or the live
    // key changing redraws the line and leaves the item's cache keys as they are
    const judges = useAtomValue(chatJudgeAtom);
    const agentId = agent?.id;
    const judgeKeys = useMemo(
        () => (agentId != null ? judgeKeysByItem(agentId, items, judges) : NO_JUDGE_KEYS),
        [agentId, items, judges]
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
    // which ```arc-pair list is the newest, drawn in full, and the list before each (pairblocks.ts); the blocks read it
    // and the agent's pair through the host
    const pairLists = useMemo(() => placePairLists(items), [items]);
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
    // `useChatCouncils` (loaded once, current on `council:changed`). One still going is a card at the end of the
    // conversation, after its runs; once it ended, its ended card (chatcouncil.ts councilEndedOnce) stays where it ended:
    // after the item its report reached the agent in, else after its call (placeCouncilCards `at`). Its
    // `wsh council start` call stays the tool line in the work, and the agent's summary of its report (councilReports)
    // draws in a council panel where it was written. The cards and the panel open the council's room
    // through the cockpit (`model`), so a conversation drawn without one (an ended session's transcript, a subagent's
    // interior) has none.
    const councilAnchors = useMemo(
        () =>
            model == null
                ? []
                : stored.flatMap((item) =>
                      item.kind === "agent"
                          ? item.parts.flatMap((part) =>
                                part.kind === "councilstart"
                                    ? [
                                          {
                                              key: part.key,
                                              item: item.key,
                                              anchor: part.anchor,
                                              order: keyIndex(part.key),
                                          },
                                      ]
                                    : []
                            )
                          : []
                  ),
        [stored, model]
    );
    // the prose that sums a council's report up, by part key (`<item key>#<part index>`), live reply included, and the
    // item where each council's report reached the agent, where its ended card stays
    const reports = useMemo(
        () =>
            model == null
                ? { summaries: new Map<string, string>(), reachedAt: new Map<string, string>() }
                : councilReports(items),
        [items, model]
    );
    const summaryOf = reports.summaries;
    const councilIds = useMemo(
        () => [...new Set([...councilAnchors.map((a) => a.anchor.councilId), ...summaryOf.values()])],
        [councilAnchors, summaryOf]
    );
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
        return placeCouncilCards({ anchors: councilAnchors, councils, endedOnce, reportAt: reports.reachedAt });
    }, [councilAnchors, councils, seenEnded, reports]);
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
    // a run no call names stays at the end while it goes on; its ✓ row stays where its run-ended message came, or, for
    // one over with no message (a quick run), after the last item that ran a tool before it ended
    const trailingRuns = useMemo(() => {
        const endOf = new Map<string, number>();
        for (const r of convRuns) {
            const endMs = r.completedts || r.cancelledts;
            if (endMs) {
                endOf.set(r.oid, endMs);
            }
        }
        return placeTrailingRuns(placed.trailing, endedMessages, { endOf, times: itemTimes(stored) });
    }, [placed, endedMessages, convRuns, stored]);
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
    const lastDrawn = useRef<{ items: string[]; parts: Set<string>; judges: Set<string> }>({
        items: [],
        parts: new Set(),
        judges: new Set(),
    });
    // nothing opens while a kept window catches up, nor in the render where it stops: the caught-up rows and the end of
    // catching up can land in one batched render
    const wasCatchingUp = useRef(false);
    const still = reduceMotion || !!catchingUp || wasCatchingUp.current;
    useLayoutEffect(() => {
        wasCatchingUp.current = !!catchingUp;
    });
    const visibleKeys = visible.map((item) => item.key);
    const arrived = still ? NO_KEYS : tailArrivals(lastDrawn.current.items, visibleKeys);
    const drawnBefore = new Set(lastDrawn.current.items);
    useLayoutEffect(() => {
        lastDrawn.current = {
            items: visibleKeys,
            parts: new Set(
                visible.flatMap((item) => (item.kind === "agent" ? item.parts.map((_, p) => `${item.key}#${p}`) : []))
            ),
            judges: new Set(visible.flatMap((item) => judgeKeys.get(item.key) ?? [])),
        };
    });
    // a fold is kept by its item's key and its part's place in the item, so it stays with its item as entries arrive
    const [opened, setOpened] = useState<Set<string>>(new Set());
    const rootRef = useRef<HTMLDivElement>(null);
    // your message pins to the top once it scrolls off it; `prompts` is the text of each data-user-prompt bubble, in
    // document order (only YouBubble's prompt branch carries it, not the command bubble, nor the ✓ row a message that
    // answered a brainstorm question draws in its place, nor a run-ended message, which draws nothing, nor a message of only
    // pictures or files, which carries it only when it says something: pinnedLabel), which the bar shows for the pinned index
    // at the end of the conversation the band hides: the newest reply gets the room, and its prompt is just above it
    const pinned = usePinnedPrompt(rootRef, true);
    const prompts = visible.flatMap((item) => {
        if (item.kind !== "you" || "command" in item || answers.has(item.key) || endedMessages.has(item.key)) {
            return [];
        }
        // a question forwarded from a board pins by your words, as its bubble shows them (not the marker line)
        const label = pinnedLabel(wordsOf(item.text));
        return label != null ? [label] : [];
    });
    // the scroll before "Show earlier" drew items in front, and the item that was first then
    const heightBeforeGrow = useRef<{ top: number; height: number; first: string | undefined } | null>(null);
    const placedFor = useRef<string | undefined>(undefined); // the placeId whose kept place was looked up
    const live = useRef(drawnVisible);
    live.current = drawnVisible;
    const offsetRef = useRef(keyOffset);
    offsetRef.current = keyOffset;

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
        const kept = transcriptPlace(placeId);
        if (kept == null) {
            placedFor.current = placeId;
            return;
        }
        // the kept entry's index in these entries (it was kept less the window's offset then)
        const place = { ...kept, key: kept.key + keyOffset };
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
    }, [placeId, items.length, visible.length, keyOffset]);

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
                key: keyIndex(item.key) - offsetRef.current,
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
    // the card of a finished turn's files opens a file in the rail, in a tab of its own beside the terminal, and See all
    // the Diff on the agent's working tree (a relative path with no cwd to read it against falls back to the Diff on it);
    // only with the cockpit and the agent around (a transcript of an ended session has nothing to open them in), through
    // a ref as above
    const canOpenDiff = !!model && !!agent;
    const diffRef = useRef<((path?: string) => void) | null>(null);
    diffRef.current = canOpenDiff
        ? (path) => {
              const abs = path == null ? null : turnFileAbs(path, cwd);
              if (abs == null) {
                  openDiff(model!, agentDiffScope(agent!.id, agent!.name, agent!.agent), path);
                  return;
              }
              // reread: the agent may have changed it since its tab was last open; it opens on its Diff against the
              // last commit, read from the file's own folder (it may sit in a worktree under the agent's directory)
              const open = (at: string) =>
                  openFileInPanel(model!, agent!.id, {
                      abs: at,
                      root: cwd || null,
                      reread: Date.now(),
                      diff: turnFileDiff(at) ?? undefined,
                  });
              // a path the session wrote on the other machine (Windows `d:\…` read on a Mac) is looked for under the
              // agent's directory here; found nowhere, it opens as written and the tab says the file is gone
              const guesses = foreignPathGuesses(abs, cwd, isWindows());
              if (guesses.length === 0) {
                  open(abs);
                  return;
              }
              fireAndForget(async () => open((await firstExistingFile(guesses)) ?? abs));
          }
        : null;
    const openTurnDiff = useCallback((path?: string) => diffRef.current?.(path), []);
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
        (text, fork, initiative) => (e) => {
            const link = linkAt(e.target);
            ContextMenuModel.getInstance().showContextMenu(
                [
                    ...(link != null
                        ? [
                              {
                                  label: "Copy link",
                                  icon: <Link size={15} />,
                                  click: () => void navigator.clipboard.writeText(link),
                              },
                          ]
                        : []),
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
            );
        },
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
    // it (the message is an item of its own, so its arrival does not change the item holding the call), for each prose
    // part the council whose summary it is (the report's arrival can be a marker before the item), and for a
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
            } else if (part.kind === "boarddraw") {
                // the end-of-turn card reads the agent's project and the cockpit it opens the board in
                out.push(`board:${model != null}`);
            } else if (part.kind === "agentsend" || part.kind === "agentanswer") {
                // the badge of the agent at the other end opens through the chat's links
                out.push(`peer:${model != null}`);
            } else if (part.kind === "runstart") {
                const slot = placed.byAnchor.get(part.key);
                const ended = slot?.runId != null ? endedByRun.get(slot.runId) : undefined;
                out.push(JSON.stringify([slot ?? null, slot != null && drawsRunCard(slot), ended?.text ?? null]));
            } else if (part.kind === "prose") {
                const id = summaryOf.get(`${item.key}#${p}`);
                if (id != null) {
                    out.push(`summary:${id}`);
                }
            }
        });
        // the card of the turn's files: its folders read against the cwd, its rows open (the rail, the Diff) only with an agent
        if (item.parts.some((part) => part.kind === "work")) {
            out.push(`files:${cwd ?? ""}:${canOpenDiff}`);
        }
        return out.length === 0
            ? ""
            : [
                  exited,
                  agent?.id,
                  agent?.blockId,
                  agent?.sleeping != null,
                  agent?.name,
                  agent?.project,
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
                // A reply that sums a council up (summaryOf) draws inside that council's panel, live or stored
                const summaryId = summaryOf.get(`${item.key}#${p}`);
                const inPanel = (node: ReactNode) =>
                    summaryId != null && model != null ? (
                        <ChatCouncilSummary councilId={summaryId} model={model}>
                            {node}
                        </ChatCouncilSummary>
                    ) : (
                        node
                    );
                if (part.live) {
                    return (
                        <div data-chat-prose data-chat-live className="relative mb-3 min-w-0 max-w-full self-stretch">
                            {inPanel(
                                <StepsPart partKey={stepsPartKey(item.key, p)}>
                                    <LiveProseText text={part.text} />
                                </StepsPart>
                            )}
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
                        {inPanel(
                            <StepsPart partKey={stepsPartKey(item.key, p)}>
                                <ProseText text={part.text} />
                            </StepsPart>
                        )}
                        <BubbleCopy
                            text={part.text}
                            align="left"
                            onFork={fork != null ? () => forkRef.current?.(fork) : undefined}
                            onAddInitiative={canAddInitiative ? () => addToInitiative(part.text) : undefined}
                        />
                    </div>
                );
            }
            // a stretch of tools: folded, running or not, until the person opens it
            case "work":
                return (
                    <ChatSteps
                        work={part.work}
                        open={opened.has(key)}
                        live={toolsLive}
                        growing={toolsLive && last && p === item.parts.length - 1}
                        onToggle={() => toggle(key)}
                    />
                );
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
            // a council the agent started: its card, live or ended, sits at the end of the conversation, and the call
            // stays the tool line in the work before it, so nothing draws here
            case "councilstart":
                return null;
            // a `wsh board draw` call: its board's card is at the end of the turn (below the parts), once per board
            case "boarddraw":
                return null;
            // a message the agent sent another, and the answer it brought back (chatagentsendcard.tsx)
            case "agentsend":
                return <ChatAgentSendCard send={part.send} />;
            case "agentanswer":
                return <ChatAgentAnswerCard answer={part.answer} />;
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
                const bubble = (
                    <YouBubble
                        item={item}
                        onContextMenu={copyMenu}
                        onOpenTerminal={onOpenTerminal != null ? openTerminal : undefined}
                        onFork={canFork ? forkHere : undefined}
                        onAddInitiative={canAddInitiative ? addToInitiative : undefined}
                    />
                );
                // a message that moved the agent to another chunk opens that chunk's stretch of the conversation; the tab's
                // own message (Work on this with an empty box) is a muted row of arcterm's, not a bubble of yours
                return "command" in item || item.chunk == null ? (
                    bubble
                ) : (
                    <>
                        <ChunkDivider n={item.chunk.n} label={item.chunk.label} />
                        {item.switchNote ? <SwitchNoteRow n={item.chunk.n} /> : bubble}
                    </>
                );
            }
            case "sent":
                return <SentCard item={item} model={model} />;
            case "agent": {
                // a finished turn (not the live last one) ends in a card of the files its edits changed (chatturnfiles.tsx)
                const files = active && last ? [] : turnFiles(item.parts);
                // and one that wrote design boards, over that card, in a card of the boards (chatcanvaspeekcard.tsx),
                // where there is an agent to open them for
                const drew = agent != null ? turnCanvas(files, cwd) : null;
                // the boards the turn drew on with `wsh board draw`: a card each, where there is an agent whose project holds
                // them and a cockpit to open them in (a conversation drawn without them, an ended session's, has none)
                const boardsOf =
                    agent != null && model != null && agent.project ? { agent, model, project: agent.project } : null;
                const boardNames = boardsOf != null ? boardsDrawn(item.parts) : [];
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
                            const arrive = !still && drawnBefore.has(item.key) && !lastDrawn.current.parts.has(key);
                            return (
                                <Arriving key={key} gap={PART_GAP} arrive={arrive} className="min-w-0">
                                    {node}
                                </Arriving>
                            );
                        })}
                        {/* a card for each board the turn drew on, live or not: the drawer works while the call runs, and
                            the card says so. They open on the spring when the turn they close arrives */}
                        {boardsOf != null
                            ? boardNames.map((board) => (
                                  <Arriving
                                      key={`board:${board.trim().toLowerCase()}`}
                                      gap={PART_GAP}
                                      arrive={!still && drawnBefore.has(item.key)}
                                      // a board the list does not hold draws nothing, and its empty wrapper no gap
                                      className="min-w-0 empty:hidden"
                                  >
                                      <ChatBoardCard
                                          board={board}
                                          project={boardsOf.project}
                                          agent={boardsOf.agent}
                                          model={boardsOf.model}
                                      />
                                  </Arriving>
                              ))
                            : null}
                        {/* they open on the spring when the turn they close ends in view */}
                        {drew != null ? (
                            <Arriving
                                key="canvas"
                                gap={PART_GAP}
                                arrive={!still && drawnBefore.has(item.key)}
                                className="min-w-0"
                            >
                                <ChatCanvasPeekCard agent={agent!} canvas={drew} />
                            </Arriving>
                        ) : null}
                        {files.length > 0 ? (
                            <Arriving
                                key="files"
                                gap={PART_GAP}
                                arrive={!still && drawnBefore.has(item.key)}
                                className="min-w-0"
                            >
                                <ChatTurnFiles
                                    files={files}
                                    cwd={cwd}
                                    onOpen={canOpenDiff ? openTurnDiff : undefined}
                                />
                            </Arriving>
                        ) : null}
                    </div>
                );
            }
            case "marker":
                return <Marker item={item.item} agentId={agent?.id} />;
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
    // which prose sums a council up. `cards` is all of that in one string; the element is kept only while it
    // stays the same.
    const drawnIndex = new Map(drawnVisible.map((it, n) => [it.key, n]));
    const drawnItems = useRef(new Map<string, DrawnItem>());
    const drawnNow = new Map<string, DrawnItem>();
    const drawnKeys = new Set<string>();
    // The ended cards that stay where they ended, after the item they follow: a run no call names after its run-ended
    // message (which draws nothing itself), a council after the item its report reached the agent in, or its call
    // (placeTrailingRuns, placeCouncilCards `at`). One whose item is not among the items draws at the end; one whose item
    // is above the drawn window draws with it, once Show earlier draws it.
    const itemKeys = new Set(items.map((it) => it.key));
    const tailRuns = [
        ...[...trailingRuns.at].flatMap(([key, ids]) => (itemKeys.has(key) ? [] : ids)),
        ...trailingRuns.end,
    ];
    const tailCouncils = placedCouncils.filter((c) => c.at == null || !itemKeys.has(c.at));
    const endedAfter = (key: string): ReactNode[] => [
        ...(trailingRuns.at.get(key) ?? []).map((runId) => (
            <div key={`run:${runId}`} data-chat-run-in-place className="flex flex-col">
                <ChatRunCard slot={{ runId }} model={model} live={!exited} ended={endedByRun.get(runId)} />
            </div>
        )),
        ...(model != null
            ? placedCouncils
                  .filter((c) => c.at === key)
                  .map(({ id, anchor }) => (
                      <div key={`council:${id}`} data-chat-council-in-place className="flex flex-col">
                          <ChatCouncilEnded councilId={id} anchor={anchor} model={model} />
                      </div>
                  ))
            : []),
    ];
    // the last of the agent's messages: a judge line under it writes its reason out rather than leaving it to the hover
    // (a marker such as a compaction may come after it)
    let lastAgentKey: string | null = null;
    for (const item of visible) {
        if (item.kind === "agent") {
            lastAgentKey = item.key;
        }
    }
    const rows = visible.flatMap((item, i) => {
        if (hiddenLine(item)) {
            return endedAfter(item.key);
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
                arrive={(item.kind !== "you" || ownArrives === true) && arrived.has(item.key)}
                className={cn("flex flex-col", item.kind === "you" || item.kind === "sent" ? "items-end" : undefined)}
            >
                {drawn.element}
            </Arriving>
        );
        // the judge's line for the question this message ends in: its own row after the item's, so a change to the record
        // redraws the line only. It opens on the spring when it lands under a message that was already drawn
        const judgeKey = judgeKeys.get(item.key);
        return [
            row,
            ...(judgeKey != null && agent != null
                ? [
                      <ChatJudgeLine
                          key={`judge:${item.key}`}
                          agentId={agent.id}
                          recKey={judgeKey}
                          live={judgeKey === liveJudgeKey}
                          inline={item.key === lastAgentKey}
                          cwd={cwd ?? null}
                          gap={ITEM_GAP}
                          arrive={!still && drawnBefore.has(item.key) && !lastDrawn.current.judges.has(judgeKey)}
                      />,
                  ]
                : []),
            ...(cardAnchors.has(item.key) && agent != null
                ? [<InitiativeMessageCards key={`${item.key}:initiative`} agentId={agent.id} anchor={item.key} />]
                : []),
            ...endedAfter(item.key),
        ];
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
                card spans the column, which Chat's scroller already keeps clear of the Focus read and Skim toggles in the
                pane's corner (its right padding, chatpane.tsx), so a reply scrolling beneath
                never shows beside the card */}
            <PinnedPromptBar
                rootRef={rootRef}
                index={pinned}
                text={prompts[pinned]}
                prompts={prompts}
                bg="bg-background"
                className="-mb-4"
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
            {/* Reply on the right-click menu of selected text: only a live agent has a box to quote it into */}
            {agent != null ? <ChatQuoteMenu agentId={agent.id} rootRef={rootRef} /> : null}
            {hasQueuedStart ? <RunQueueFeed /> : null}
            {agent != null
                ? endAnchors.map((anchor) => (
                      <InitiativeMessageCards key={`${anchor}:initiative`} agentId={agent.id} anchor={anchor} />
                  ))
                : null}
            {/* The card the brainstorm ends with (the question it waits on, Confirm the design, the builder check, the
                run), after the last row: a row kind of its own, not an item (it is no data-chat-item, so the place kept
                and restored never counts it). The first card opens its height on the spring and the last leaves on it
                (the card's own variants); this wrapper does the same with the column's gap, which a closed row would
                otherwise hold open, so nothing above it shoves. The wrapper has one key for the whole brainstorm and
                holds a CardSlot: the next card takes the old one's place and the slot springs between their heights,
                never one card leaving and another coming in. The first render draws it at once. The run card draws its own
                wrapper (ChatBrainstormRunRow), which a run that is over leaves out altogether: no empty row holding
                the column's gap. The runs of the conversation that no call names (placeRunCards) come before it while
                they go on, each one a card of its own; once its run-ended message came, its ✓ row stays at the message
                instead (endedAfter). After them come the councils the agent started that are still going
                (placeCouncilCards), oldest call first, each in a wrapper of its own: the live card, or the ended card of
                one running again; a council that is over stays where it ended (endedAfter). */}
            <AnimatePresence initial={false}>
                {tailRuns.map((runId) => (
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
                    ? tailCouncils.map(({ id, anchor, ended }) => (
                          <motion.div key={`council:${id}`} data-chat-council-tail {...endRow}>
                              {ended ? (
                                  <ChatCouncilEnded councilId={id} anchor={anchor} model={model} />
                              ) : (
                                  <ChatCouncilCard councilId={id} anchor={anchor} model={model} live={!exited} />
                              )}
                          </motion.div>
                      ))
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
                        <motion.div key="brainstorm" data-chat-brainstorm-row {...endRow}>
                            <CardSlot swap={cardKey(brainstorm.card)}>
                                <ChatBrainstormCard
                                    agent={brainstorm.agent}
                                    card={brainstorm.card}
                                    model={brainstorm.model}
                                    state={brainstorm.state}
                                />
                            </CardSlot>
                        </motion.div>
                    )
                ) : null}
            </AnimatePresence>
        </div>
    );
    // the initiative cards read their agent and the initiative list from a host: only a live Claude agent's Chat has one;
    // every Chat conversation draws its step checklists and its pair cards
    return (
        <ChatStepsHost placed={stepLists}>
            <ChatPairHost placed={pairLists} tabId={agent?.id ?? null}>
                {canAddInitiative ? (
                    <ChatInitiativeHost agent={agent!} model={model!}>
                        {body}
                    </ChatInitiativeHost>
                ) : (
                    body
                )}
            </ChatPairHost>
        </ChatStepsHost>
    );
}
