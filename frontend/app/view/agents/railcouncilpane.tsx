// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's Council tab (canvas rail-council-chat, board B): the chat of the council the agent started, in the
// panel beside its terminal. The head says what it is about and where it stands, with Open for the full Discussion; the
// messages are the Discussion's channel with every reply in it (railcouncil.ts), each cut to four lines until clicked;
// the row under them says whose move it is; and the box at the bottom is the Discussion's own (Composer), which shares
// its draft. Held drafts are sent from here; the pause's choices, Edit and Retry stay in the Discussion.

import { openCouncil } from "@/app/view/library/librarystore";
import { cn } from "@/util/util";
import { CornerDownRight, ExternalLink } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { useActions } from "./councilactions";
import { Composer, CouncilAvatar, CouncilPill, CouncilText, TONE_BUBBLE, TONE_TEXT, TYPING_LAGS } from "./councilchat";
import type { ChannelItem, Who } from "./councilchatmodel";
import { useLiveChats } from "./councildiscussion";
import { draftCouncil, useCouncil } from "./councilstore";
import {
    feedWindow,
    RAIL_FEED_STEP,
    railCouncilFeed,
    railCouncilHead,
    railCouncilMove,
    type RailCouncilDot,
    type RailCouncilMove,
} from "./railcouncil";

const DOT: Record<RailCouncilDot, string> = { working: "bg-working", asking: "bg-asking", error: "bg-error" };

// how close to the end the list counts as read to the end, so a new message scrolls it on
const NEAR_END_PX = 48;

export function RailCouncilPane({ model, council }: { model: AgentsViewModel; council: Council }) {
    // the list holds every council; its own atom is the one the Discussion reads, kept as fresh
    const c = useCouncil(council.id) ?? council;
    const head = railCouncilHead(c);
    const feed = useMemo(() => railCouncilFeed(c), [c]);
    const [shown, setShown] = useState(RAIL_FEED_STEP);
    const items = feedWindow(feed, shown);
    const chats = useLiveChats(model, c.project);
    const scroller = useRef<HTMLDivElement>(null);
    const atEnd = useRef(true);
    const last = feed[feed.length - 1];
    // opens at the newest message, and follows new ones while the reader is at the end
    useLayoutEffect(() => {
        const el = scroller.current;
        if (el != null && atEnd.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [c.id, feed.length, last?.id, last?.kind]);
    const open = (view: "discussion" | "summary") => openCouncil(model, c.id, view);
    return (
        <div data-rail-council={c.id} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-none flex-col gap-[3px] border-b border-edge-faint px-[12px] pb-[8px] pt-[10px]">
                <div className="flex min-w-0 items-center gap-[6px]">
                    <span
                        id="rail-council-title"
                        title={head.title}
                        className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary"
                    >
                        {head.title}
                    </span>
                    <button
                        type="button"
                        data-rail-council-open
                        title="Open the full Discussion"
                        onClick={() => open("discussion")}
                        className="flex flex-none cursor-pointer items-center gap-[3px] rounded-[4px] border-0 bg-transparent px-[2px] text-[11.5px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Open
                        <ExternalLink size={12} strokeWidth={2} aria-hidden />
                    </button>
                </div>
                <div className="flex min-w-0 items-center gap-[6px] text-[11.5px] text-muted">
                    {head.dot != null && (
                        <span aria-hidden className={cn("h-[6px] w-[6px] flex-none rounded-full", DOT[head.dot])} />
                    )}
                    <span className="min-w-0 truncate">{head.line}</span>
                </div>
            </div>
            <div
                ref={scroller}
                data-rail-council-feed
                onScroll={(e) => {
                    const el = e.currentTarget;
                    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END_PX;
                }}
                className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[10px] pb-[10px] pt-[10px] [scrollbar-gutter:stable]"
            >
                {feed.length > items.length && (
                    <button
                        type="button"
                        onClick={() => setShown((n) => n + RAIL_FEED_STEP)}
                        className="cursor-pointer self-center rounded-full border border-edge-mid bg-transparent px-[10px] py-[2px] text-[11.5px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Show earlier · {feed.length - items.length}
                    </button>
                )}
                {items.map((item) => (
                    <FeedItem key={`${item.kind}:${item.id}`} item={item} />
                ))}
                <MoveRow c={c} move={railCouncilMove(c)} onOpen={open} />
            </div>
            <div className="flex-none border-t border-edge-faint px-[10px] pb-[10px] pt-[8px]">
                <Composer
                    c={c}
                    scope="channel"
                    proposalId=""
                    placeholder="Message the council · @ a seat"
                    sendLabel="Send"
                    labelledBy="rail-council-title"
                    returnTo={() => scroller.current}
                    chats={chats}
                />
            </div>
        </div>
    );
}

function FeedItem({ item }: { item: ChannelItem }) {
    switch (item.kind) {
        case "question":
            return <Mine text={item.text} />;
        case "divider":
            return (
                <div
                    data-rail-council-divider={item.round}
                    className="flex items-center gap-[8px] text-[10.5px] text-muted"
                >
                    <span aria-hidden className="h-px flex-1 bg-edge-faint" />
                    {item.text}
                    <span aria-hidden className="h-px flex-1 bg-edge-faint" />
                </div>
            );
        case "idea":
            return (
                <Post who={item} label={item.label} at={item.at} when={item.when} dim={item.out != null}>
                    <div className="font-semibold text-primary">{item.title}</div>
                    <Clamped text={item.text} />
                </Post>
            );
        case "reply":
            return item.mine ? (
                <Mine text={item.text} />
            ) : (
                <Post who={item} label={item.label} at={item.at} when={item.when} on={item.on}>
                    {item.retitled !== "" && <div className="font-semibold text-primary">{item.retitled}</div>}
                    <Clamped text={item.text} />
                </Post>
            );
        case "draft":
            return (
                <Post who={item} label={item.label} at={item.at} when={item.when} on={item.on} held>
                    {item.title !== "" && <div className="font-semibold text-primary">{item.title}</div>}
                    <Clamped text={item.text} />
                </Post>
            );
        case "skip":
            return (
                <div className="flex items-start gap-[7px] text-[11.5px] leading-[16px] text-muted">
                    <CouncilAvatar small dim tone={item.tone} name={item.name} initials={item.initials} />
                    <span className="min-w-0">{item.text}</span>
                </div>
            );
        case "failure":
            return (
                <div className="flex items-start gap-[7px] text-[11.5px] leading-[16px] text-error-soft">
                    <CouncilAvatar small tone={item.tone} name={item.name} initials={item.initials} dot="failed" />
                    <span className="min-w-0" title={item.error}>
                        {item.text}
                    </span>
                </div>
            );
        case "typing":
            return (
                <div
                    data-rail-council-typing={item.author}
                    className="flex min-w-0 items-center gap-[7px] text-[11.5px] text-muted"
                >
                    <CouncilAvatar
                        small
                        dashed={item.waiting}
                        tone={item.tone}
                        name={item.name}
                        initials={item.initials}
                    />
                    <span className="min-w-0 truncate" role="status">
                        {item.text}
                    </span>
                    {!item.waiting && (
                        <span aria-hidden className={cn("flex flex-none items-center gap-[3px]", TONE_TEXT[item.tone])}>
                            {TYPING_LAGS.map((lag) => (
                                <span
                                    key={lag}
                                    data-pulse-lag={lag}
                                    className="pulse-typing h-[4px] w-[4px] rounded-full bg-current"
                                />
                            ))}
                        </span>
                    )}
                </div>
            );
    }
}

// a seat's message: its avatar, its name with what it does and when, the idea a reply is on, and its words in a bubble
function Post({
    who,
    label,
    at,
    when,
    on,
    held,
    dim,
    children,
}: {
    who: Who;
    label: string;
    at: string;
    when: string;
    on?: string;
    held?: boolean;
    dim?: boolean;
    children: ReactNode;
}) {
    return (
        <div data-rail-council-post={who.author} className={cn("flex items-start gap-[7px]", dim && "opacity-60")}>
            <CouncilAvatar small tone={who.tone} name={who.name} initials={who.initials} />
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-[6px] text-[11.5px]">
                    <span className={cn("font-semibold", TONE_TEXT[who.tone])}>{who.name}</span>
                    {held ? (
                        <CouncilPill word="Waiting for you" tone="challenge" />
                    ) : (
                        <span className="text-muted" title={when}>
                            {at === "" ? label : `${label} · ${at}`}
                        </span>
                    )}
                </div>
                {on != null && on !== "" && (
                    <div className="flex min-w-0 items-center gap-[4px] text-[11px] text-muted">
                        <CornerDownRight size={11} aria-hidden className="flex-none" />
                        <span className="min-w-0 truncate">{on}</span>
                    </div>
                )}
                <div
                    className={cn(
                        "min-w-0 rounded-[4px_12px_12px_12px] border px-[9px] py-[7px] text-[12.5px] leading-[18px]",
                        held ? "border-asking/30 bg-askingbg" : TONE_BUBBLE[who.tone]
                    )}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}

// the person's own message (their question, a post to the council), on the right
function Mine({ text }: { text: string }) {
    return (
        <div
            data-rail-council-mine
            className="max-w-[88%] self-end rounded-[12px_4px_12px_12px] border border-accent/30 bg-accent/10 px-[10px] py-[7px] text-[12.5px] leading-[18px]"
        >
            <Clamped text={text} />
        </div>
    );
}

// four lines of a message until a click opens the rest; a message that fits has no control
const CLAMP_PX = 72;

function Clamped({ text }: { text: string }) {
    const box = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [long, setLong] = useState(false);
    useLayoutEffect(() => {
        const el = box.current;
        if (el != null) {
            setLong(el.scrollHeight > CLAMP_PX + 2);
        }
    }, [text]);
    return (
        <div className="flex min-w-0 flex-col">
            <div
                ref={box}
                className={cn(
                    "min-w-0 overflow-hidden",
                    !open && long && "[mask-image:linear-gradient(#000_70%,transparent)]"
                )}
                style={open ? undefined : { maxHeight: CLAMP_PX }}
            >
                <CouncilText text={text} className="text-[12.5px] leading-[18px]" />
            </div>
            {long && (
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((o) => !o)}
                    className="cursor-pointer self-start rounded-[4px] border-0 bg-transparent p-0 pt-[2px] text-[11px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {open ? "Show less" : "Show more"}
                </button>
            )}
        </div>
    );
}

const rowButton =
    "h-[24px] cursor-pointer rounded-[6px] px-[9px] text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

// whose move it is, under the messages: held drafts to send on, the pause, the report, a failure
function MoveRow({
    c,
    move,
    onOpen,
}: {
    c: Council;
    move: RailCouncilMove | null;
    onOpen: (view: "discussion" | "summary") => void;
}) {
    const acts = useActions();
    if (move == null) {
        return null;
    }
    const review = (
        <button
            type="button"
            onClick={() => onOpen("discussion")}
            className={cn(rowButton, "border border-edge-mid bg-transparent text-secondary hover:bg-surface-hover")}
        >
            Review in full
        </button>
    );
    if (move.kind === "done") {
        return (
            <div
                data-rail-council-move="done"
                className="flex items-center gap-[8px] rounded-[10px] border border-edge-mid bg-surface px-[10px] py-[8px] text-[12px] text-secondary"
            >
                <span className="min-w-0 flex-1">{move.text}</span>
                <button
                    type="button"
                    onClick={() => onOpen("summary")}
                    className={cn(
                        rowButton,
                        "border border-edge-mid bg-transparent text-primary hover:bg-surface-hover"
                    )}
                >
                    Read the report
                </button>
            </div>
        );
    }
    const failed = move.kind === "failed";
    const sending = acts.busy.size > 0;
    const sendAll = async () => {
        if (move.kind !== "drafts") {
            return;
        }
        for (const id of move.drafts) {
            if (!(await acts.run(`draft:${id}`, "Send", () => draftCouncil(c.id, id, "send")))) {
                return;
            }
        }
    };
    return (
        <div
            data-rail-council-move={move.kind}
            className={cn(
                "flex flex-col gap-[6px] rounded-[10px] border px-[10px] py-[8px]",
                failed ? "border-error/40 bg-error/10" : "border-asking/45 bg-askingbg"
            )}
        >
            <div className={cn("text-[12px] font-medium", failed ? "text-error-soft" : "text-warning-soft")}>
                {move.text}
            </div>
            <div className="flex flex-wrap gap-[6px]">
                {move.kind === "drafts" && (
                    <button
                        type="button"
                        disabled={sending}
                        onClick={() => void sendAll()}
                        className={cn(rowButton, "border-0 bg-asking font-semibold text-background hover:opacity-90")}
                    >
                        Send to the others
                    </button>
                )}
                {review}
            </div>
            {acts.error != null && <div className="text-[11.5px] text-error-soft">{acts.error}</div>}
        </div>
    );
}
