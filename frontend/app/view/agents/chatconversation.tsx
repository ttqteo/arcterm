// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A Claude agent's conversation as chat draws it (the agent-chat board, B-bubbles.dc.html): your messages as bubbles on
// the right, a prompt arcterm typed (a run's launch prompt, a wake, a message from another agent) as an outlined card
// naming who sent it, and everything the agent said and did between two of them behind one avatar: its prose as
// Markdown in a bubble on the left, and outside the bubbles a stretch of tools as one plain "Worked for 38s · 5 tools"
// line that opens to the tool lines, and the files that work edited as a chip each that opens its diff. The items are chatmodel.ts's; the pieces shared with the other
// transcript views (a tool line, a diff, the compaction and interruption markers) are narrationtimeline.tsx's.
// Only the last CHAT_RENDER_STEP items are drawn at first; "Show earlier" draws that many more and, once all are drawn,
// asks the caller for earlier entries. The place the reader left it is kept under `placeId` (transcriptplace.ts).

import { composerReveal } from "@/app/element/motiontokens";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { cn } from "@/util/util";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { burstRenderMode, conversationText, isNearBottom, type AgentEntry, type EditFile } from "./agentsviewmodel";
import { CHAT_RENDER_STEP, chatItems, shownItems, type AgentPart, type ChatItem, type ChatMarker } from "./chatmodel";
import { toolCountLabel, workedFor, type WorkItem } from "./compacttimeline";
import { CouncilAvatar, CouncilText } from "./councilchat";
import { splitAttachedImages } from "./launcherimages";
import {
    CompactionDivider,
    InterruptedDivider,
    PromptImages,
    PromptText,
    TaskNotificationRow,
    ToolDetailBody,
    ToolLine,
} from "./narrationtimeline";
import { scrollParent } from "./pinnedpromptbar";
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

type CopyMenu = (text: string) => (e: React.MouseEvent) => void;

// your message: a bubble on the right, long ones clamped (PromptText, as userNeedsClamp says), what you pasted under it
function YouBubble({ item, onContextMenu }: { item: Extract<ChatItem, { kind: "you" }>; onContextMenu: CopyMenu }) {
    if ("command" in item) {
        return (
            <div
                data-chat-you
                data-chat-command
                onContextMenu={onContextMenu(item.command)}
                className="max-w-[70%] self-end rounded-lg bg-surface-raised px-[14px] py-[9px] font-mono text-[12.5px] text-primary [overflow-wrap:anywhere]"
            >
                {item.command}
            </div>
        );
    }
    // a launch's attached images ride the prompt as paths; they show as pictures, not as the block that names them
    const said = splitAttachedImages(item.text);
    return (
        <div
            data-chat-you
            data-user-prompt
            onContextMenu={onContextMenu(item.text)}
            className="max-w-[70%] self-end rounded-lg bg-surface-raised px-[14px] py-[9px] text-[13px] leading-[1.55] text-primary"
        >
            {said.text ? <PromptText text={said.text} /> : null}
            {item.images || said.paths.length > 0 ? <PromptImages images={item.images} paths={said.paths} /> : null}
        </div>
    );
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
            className="flex max-w-[70%] flex-col gap-[6px] self-end rounded-lg border border-edge-mid px-[14px] py-[9px]"
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
    onToggle,
}: {
    work: WorkItem;
    open: boolean;
    autoOpen: boolean;
    onToggle: () => void;
}) {
    const mode = burstRenderMode({ userOpened: open, autoOpen });
    const shown = mode !== "collapsed";
    const lines = work.actions.map((action, k) => <ToolLine key={work.startIndex + k} action={action} inline />);
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
                    {workedFor(work.durationMs)} · {toolCountLabel(work.actions.length)}
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
    className?: string;
}) {
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
            // what the agent said: a bubble on the left, as yours is on the right; its tools and files sit outside it
            case "prose":
                return (
                    <div
                        key={key}
                        data-chat-prose
                        onContextMenu={copyMenu(part.text)}
                        className="min-w-0 max-w-full self-start rounded-lg bg-surface-raised px-[14px] py-[9px]"
                    >
                        <CouncilText text={part.text} className="text-[13px] leading-[1.6] text-primary" />
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
                return <YouBubble item={item} onContextMenu={copyMenu} />;
            case "sent":
                return <SentCard item={item} />;
            case "agent":
                return (
                    <div data-chat-agent className="flex items-start gap-[10px]">
                        <CouncilAvatar
                            tone="muted"
                            name="Claude"
                            initials="C"
                            aria-hidden="true"
                            className="h-[26px] w-[26px] border border-edge-mid bg-surface-raised text-[11px] font-semibold text-ink-hi"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-[3px]">
                            {item.parts.map((part, p) => drawPart(item, part, p, last))}
                        </div>
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
