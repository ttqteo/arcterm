// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A Claude agent's conversation as chat draws it (the agent-chat document-view board, Main.dc.html): your messages as
// bubbles on the right, a prompt arcterm typed (a run's launch prompt, a wake, a message from another agent) as an
// outlined card naming who sent it, and everything the agent said and did between two of them as a document column: its
// prose as Markdown with no bubble and no avatar, and between the paragraphs a stretch of tools as one plain "Worked for
// 38s · 5 tools" line that opens to the tool lines, and the files that work edited as a chip each that opens its diff.
// Your prompt pins to the top once it scrolls away (pinnedpromptbar.tsx), as in the live feed. The items are
// chatmodel.ts's; the pieces shared with the other transcript views (a tool line, a diff, the compaction and
// interruption markers) are narrationtimeline.tsx's.
// Only the last CHAT_RENDER_STEP items are drawn at first; "Show earlier" draws that many more and, once all are drawn,
// asks the caller for earlier entries. The place the reader left it is kept under `placeId` (transcriptplace.ts).

import { CopyButton } from "@/app/element/copybutton";
import { composerReveal } from "@/app/element/motiontokens";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { cn } from "@/util/util";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    burstRenderMode,
    conversationText,
    isNearBottom,
    type AgentEntry,
    type BtwAnswer,
    type EditFile,
    type ShellResult,
} from "./agentsviewmodel";
import { ChatFileCards } from "./chatfilecards";
import { splitAttachments } from "./chatfiles";
import { CHAT_RENDER_STEP, chatItems, shownItems, type AgentPart, type ChatItem, type ChatMarker } from "./chatmodel";
import { withMarks } from "./chatskim";
import { useSkimMarks } from "./chatskimstore";
import { TaggedPromptText } from "./chattagblock";
import { foldCommandParts, splitTagged, tagHeading, type TagPart } from "./chattagblocks";
import { inFlight, stretchMs, toolCountLabel, workedFor, workingFor, type WorkItem } from "./compacttimeline";
import { CouncilText } from "./councilchat";
import {
    CompactionDivider,
    InterruptedDivider,
    PromptImages,
    TaskNotificationRow,
    ToolDetailBody,
    ToolLine,
    useNow,
} from "./narrationtimeline";
import { PinnedPromptBar, scrollParent, usePinnedPrompt } from "./pinnedpromptbar";
import { firstItemBelow, keepTranscriptPlace, transcriptPlace } from "./transcriptplace";

/** A sent card shows this many of its lines until it is opened. */
const SENT_FOLD_LINES = 3;

// the entry index an item's key starts with ("agent:12" → 12): the key transcriptplace.ts keeps a place under, the same
// number CompactTranscript keeps for the item starting at that entry, so a place survives the switch between the two
function keyIndex(key: string): number {
    return Number(key.slice(key.indexOf(":") + 1));
}

function Caret({ open }: { open: boolean }) {
    const Icon = open ? ChevronDown : ChevronRight;
    return <Icon size={11} strokeWidth={2.2} aria-hidden className="shrink-0" />;
}

// Copy in the gap under a bubble's bottom edge (the bubble keeps a margin that holds it), shown while the bubble is hovered or the button has focus (the bubble is `group`)
function BubbleCopy({ text, align }: { text: string; align: "left" | "right" }) {
    return (
        <div
            data-chat-copy
            className={cn(
                "absolute top-full z-10 mt-0 rounded-md bg-surface opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none",
                align === "left" ? "left-1" : "right-1"
            )}
        >
            <CopyButton title="Copy" content={text} className="p-1 text-[12px]" />
        </div>
    );
}

// What the agent said, as Markdown, with the sentences the skim mod marked highlighted (the terminal's own highlight, found
// by the hash of the stored text: chatskimstore.ts) while Chat's highlighter toggle is on. Its own component so the hook
// runs per part. The copy button and the context menu keep the text as stored, without marks.
function ProseText({ text }: { text: string }) {
    const marks = useSkimMarks(text);
    const shown = useMemo(() => withMarks(text, marks), [text, marks]);
    return <CouncilText text={shown} className="text-[14px] leading-[1.65] text-ink-hi" />;
}

type CopyMenu = (text: string) => (e: React.MouseEvent) => void;

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

// a /btw you asked from Chat: the question, then the side answer the arc mod's fork of the session gave, as Markdown, under
// a label saying it is no part of the conversation (Claude never reads it), or why there is none. Copy takes the answer.
function BtwCard({ command, btw, onContextMenu }: { command: string; btw: BtwAnswer; onContextMenu: CopyMenu }) {
    const copyText = "answer" in btw ? btw.answer : btw.failure;
    return (
        <div
            data-chat-you
            data-chat-command
            data-chat-btw
            onContextMenu={onContextMenu(copyText)}
            className="group relative mb-1 max-w-[75%] min-w-[220px] self-end"
        >
            <div className="flex flex-col overflow-hidden rounded-[12px] border border-edge-mid bg-surface-raised">
                <div className="px-[14px] py-[8px] font-mono text-[12.5px] text-primary [overflow-wrap:anywhere]">
                    {command}
                </div>
                <div className="flex flex-col gap-1 border-t border-edge-faint px-[14px] py-[9px]">
                    <span className="text-[11px] text-muted">side answer · not in the conversation</span>
                    {"answer" in btw ? (
                        <CouncilText text={btw.answer} className="text-[13.5px] leading-[1.6] text-ink-hi" />
                    ) : (
                        <span data-chat-btw-failure className="text-[12.5px] text-muted">
                            No side answer: {btw.failure}
                        </span>
                    )}
                </div>
            </div>
            <BubbleCopy text={copyText} align="right" />
        </div>
    );
}

// your message: a bubble on the right, long ones clamped (PromptText, as userNeedsClamp says), what you pasted under it
function YouBubble({
    item,
    onContextMenu,
    onOpenTerminal,
}: {
    item: Extract<ChatItem, { kind: "you" }>;
    onContextMenu: CopyMenu;
    onOpenTerminal?: () => void;
}) {
    if ("command" in item && item.command.startsWith("! ")) {
        return <CommandCard command={item.command.slice(2)} bash shell={item.shell} onContextMenu={onContextMenu} />;
    }
    if ("command" in item && item.btw != null) {
        return <BtwCard command={item.command} btw={item.btw} onContextMenu={onContextMenu} />;
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
                className="max-w-[75%] self-end rounded-[12px] bg-surface-raised px-[14px] py-[9px] font-mono text-[12.5px] text-primary [overflow-wrap:anywhere]"
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
    return (
        <div
            data-chat-you
            data-user-prompt
            onContextMenu={onContextMenu(item.text)}
            className="flex max-w-[75%] flex-col items-end gap-2 self-end"
        >
            {text !== "" || hasPictures ? (
                <div
                    className={cn(
                        "group relative max-w-full rounded-[12px] bg-surface-raised px-[14px] py-[9px] text-[13.5px] leading-[1.55] text-primary",
                        // the copy button hangs in the gap under the bubble: leave it room above the cards
                        hasFiles ? "mb-3" : "mb-1"
                    )}
                >
                    {text !== "" ? <TaggedPromptText text={text} /> : null}
                    {hasPictures ? <PromptImages images={item.images} paths={said.images} /> : null}
                    {/* the whole message, files and all, as the context menu copies it */}
                    {text !== "" ? <BubbleCopy text={item.text} align="right" /> : null}
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

// "› Worked for 38s · 5 tools": a stretch of tools as one plain line between the agent's bubbles, opening to its tool
// lines, which open in place (never the full-view modal, which is their button). A live session's last one is open
// while the agent works, drawn plain so it never strobes (burstRenderMode)
function WorkPill({
    work,
    open,
    autoOpen,
    live,
    onToggle,
}: {
    work: WorkItem;
    open: boolean;
    autoOpen: boolean;
    // the session is working: a tool with no result is running, and the stretch counts up to now
    live: boolean;
    onToggle: () => void;
}) {
    const mode = burstRenderMode({ userOpened: open, autoOpen });
    const shown = mode !== "collapsed";
    const running = work.actions.some((a) => inFlight(a, live));
    const now = useNow(running);
    const lines = work.actions.map((action, k) => (
        <ToolLine key={work.startIndex + k} action={action} inline running={inFlight(action, live)} settled={!live} />
    ));
    return (
        <div data-chat-work className="flex flex-col">
            <button
                type="button"
                data-fold
                aria-expanded={shown}
                onClick={onToggle}
                className="flex cursor-pointer items-center gap-[6px] self-start py-[2px] text-[12px] text-muted hover:text-secondary"
            >
                <Caret open={shown} />
                <span>
                    {running ? workingFor(stretchMs(work, now, live)) : workedFor(work.durationMs)} ·{" "}
                    {toolCountLabel(work.actions.length)}
                </span>
                {work.failed > 0 ? <span className="tabular-nums text-error">· {work.failed} failed</span> : null}
            </button>
            {mode === "reveal" ? (
                <motion.div
                    data-chat-tools
                    variants={composerReveal}
                    initial="initial"
                    animate="animate"
                    className="overflow-hidden pt-1"
                >
                    {lines}
                </motion.div>
            ) : mode === "open" ? (
                <div data-chat-tools className="pt-1">
                    {lines}
                </div>
            ) : null}
        </div>
    );
}

// the files a stretch of work edited, a chip each ("session.ts +4 −1"), each opening its diff under the row
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
    return (
        <div data-chat-files className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-[6px]">
                {files.map((f) => {
                    const open = openPaths.has(f.path);
                    return (
                        <button
                            key={f.path}
                            type="button"
                            data-chat-file={f.path}
                            aria-expanded={open}
                            title={f.path}
                            onClick={() => onToggle(f.path)}
                            className={cn(
                                "flex cursor-pointer items-center gap-2 rounded-full border bg-surface px-[12px] py-[3px] text-[12px] hover:border-edge-strong",
                                open ? "border-edge-strong" : "border-edge-mid"
                            )}
                        >
                            <span className="max-w-[260px] truncate text-secondary">
                                {f.path.split(/[\\/]/).pop() || f.path}
                            </span>
                            <span className="font-semibold tabular-nums text-diff-added">+{f.adds}</span>
                            <span className="font-semibold tabular-nums text-diff-removed">−{f.dels}</span>
                        </button>
                    );
                })}
            </div>
            <AnimatePresence initial={false}>
                {opened.map((f) => (
                    <motion.div
                        key={f.path}
                        data-chat-diff={f.path}
                        variants={composerReveal}
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
    placeId,
    onLoadEarlier,
    active,
    working,
    onOpenTerminal,
    className,
}: {
    entries: AgentEntry[];
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
    className?: string;
}) {
    const toolsLive = working ?? !!active;
    const items = useMemo(() => chatItems(entries), [entries]);
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
    // a fold is kept by its item's key and its part's place in the item, so it stays with its item as entries arrive
    const [opened, setOpened] = useState<Set<string>>(new Set());
    const rootRef = useRef<HTMLDivElement>(null);
    // your message pins to the top once it scrolls off it; `prompts` is the text of each data-user-prompt bubble, in
    // document order (only YouBubble's prompt branch carries it, not the command bubble), which the bar shows for the
    // pinned index
    const pinned = usePinnedPrompt(rootRef);
    const prompts = visible.flatMap((item) =>
        item.kind === "you" && !("command" in item) ? [pinnedLabel(item.text, item.images?.length ?? 0)] : []
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

    const copyMenu: CopyMenu = (text) => (e) =>
        ContextMenuModel.getInstance().showContextMenu(
            [
                { label: "Copy text", icon: <Copy size={15} />, click: () => void navigator.clipboard.writeText(text) },
                {
                    label: "Copy conversation",
                    icon: <Copy size={15} />,
                    click: () => void navigator.clipboard.writeText(conversationText(entries)),
                },
            ],
            e
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
            case "prose":
                return (
                    <div
                        key={key}
                        data-chat-prose
                        onContextMenu={copyMenu(part.text)}
                        className="group relative mb-3 min-w-0 max-w-full self-stretch"
                    >
                        <ProseText text={part.text} />
                        <BubbleCopy text={part.text} align="left" />
                    </div>
                );
            case "work":
                return (
                    <WorkPill
                        key={key}
                        work={part.work}
                        open={opened.has(key)}
                        // the work the agent is doing now: nothing but its files chip after it in the last item
                        autoOpen={!!active && last && item.parts.slice(p + 1).every((q) => q.kind === "files")}
                        live={toolsLive}
                        onToggle={() => toggle(key)}
                    />
                );
            case "files": {
                const openPaths = new Set(part.files.filter((f) => opened.has(`${key}:${f.path}`)).map((f) => f.path));
                return (
                    <FileChips
                        key={key}
                        files={part.files}
                        openPaths={openPaths}
                        onToggle={(path) => toggle(`${key}:${path}`)}
                    />
                );
            }
        }
    };

    const drawItem = (item: ChatItem, last: boolean): ReactNode => {
        switch (item.kind) {
            case "you":
                return <YouBubble item={item} onContextMenu={copyMenu} onOpenTerminal={onOpenTerminal} />;
            case "sent":
                return <SentCard item={item} />;
            case "agent":
                return (
                    <div data-chat-agent className="flex min-w-0 flex-col gap-2">
                        {item.parts.map((part, p) => drawPart(item, part, p, last))}
                    </div>
                );
            case "marker":
                return <Marker item={item.item} />;
        }
    };

    return (
        <div
            ref={rootRef}
            data-chat-conversation
            className={cn("mx-auto flex w-full max-w-[760px] flex-col gap-4 pb-2 pt-4 leading-relaxed", className)}
        >
            {/* the sticky row is a flex child of a gap-4 column: -mb-4 cancels the gap its zero-height row would add */}
            <PinnedPromptBar
                rootRef={rootRef}
                index={pinned}
                text={prompts[pinned]}
                bg="bg-background"
                className="-mb-4 pr-10"
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
            {visible.map((item, i) => (
                <div
                    key={item.key}
                    data-chat-item={item.key}
                    className={cn(
                        "flex flex-col",
                        item.kind === "you" || item.kind === "sent" ? "items-end" : undefined
                    )}
                >
                    {drawItem(item, i === visible.length - 1)}
                </div>
            ))}
        </div>
    );
}
