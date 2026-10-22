// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The running council as a group chat (councilfeedmodel.ts holds what it says): the three steps as a bar, the line that
// says there is nothing to do, a chip for each expert with what it is doing, and the feed: the person's question first,
// then each idea and reply as a message (avatar, name, the plain label, the time, a "↳" line naming the idea it is about,
// the references it cites, the experts that agreed as reactions), a line where a step hands over to the next, and a
// typing row for whoever is writing. The person's own messages sit on the grey fill. A Reply on an expert's message opens
// the same composer the thread uses (councilthread.tsx), which the Discussion renders under that message. The Discussion
// (councildiscussion.tsx) shows all of this only while a council runs its argument or its answer.

import { cn } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { Check, CornerDownRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { avatarTone, expertDoing, isLit, type PillTone } from "./councildiscussionmodel";
import { councilFeed, stepOf, type FeedItem } from "./councilfeedmodel";
import { authorName } from "./councilmodel";
import { CouncilAvatar, CouncilPill, TONE_TEXT } from "./councilthread";

/** The idea the feed is narrowed to (a click on it in the ideas column), per council, so it survives a trip to the
 *  Summary and back. */
export const councilFeedFilterAtom = atomFamily(
    (_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>
);

// ---- the steps ----

const STEP_SEGMENT = { done: "bg-success/45", current: "bg-working", next: "bg-edge-mid" } as const;

export function StepBar({ c }: { c: Council }) {
    const { step, words } = stepOf(c);
    return (
        <ol data-council-steps aria-label="Steps" className="m-0 flex list-none gap-[6px] p-0">
            {words.map((word, i) => {
                const n = i + 1;
                const where = n < step ? "done" : n === step ? "current" : "next";
                return (
                    <li
                        key={n}
                        data-council-step={n}
                        data-current={n === step ? "true" : "false"}
                        aria-current={n === step ? "step" : undefined}
                        className="flex min-w-0 flex-1 flex-col gap-[5px]"
                    >
                        <span aria-hidden className={cn("h-[4px] rounded-[2px]", STEP_SEGMENT[where])} />
                        <span
                            className={cn(
                                "truncate text-[11.5px]",
                                where === "current" ? "font-semibold text-primary" : "text-muted"
                            )}
                        >
                            {word}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

export function NothingToDo() {
    return (
        <p data-council-nothing className="m-0 text-[11.5px] text-muted">
            Nothing to do now. The answer opens here when it finishes; you can leave.
        </p>
    );
}

// ---- the experts ----

export function ExpertChips({ c }: { c: Council }) {
    return (
        <div data-council-experts role="list" className="flex flex-wrap gap-[6px]">
            {c.experts.map((e) => {
                const lit = isLit(c, e.id);
                const failed = c.failed?.[e.id] != null;
                const doing = expertDoing(c, e);
                return (
                    <span
                        key={e.id}
                        role="listitem"
                        data-council-expert-chip={e.id}
                        data-lit={lit ? "true" : "false"}
                        title={`${e.name}: ${doing}`}
                        className="flex min-w-0 max-w-[260px] items-center gap-[6px] rounded-full border border-edge-mid bg-surface px-[9px] py-[3px] text-[11px]"
                    >
                        <span
                            aria-hidden
                            className={cn(
                                "h-[6px] w-[6px] flex-none rounded-full",
                                lit ? "bg-working pulse-dot" : failed ? "bg-error" : "bg-ink-faint"
                            )}
                        />
                        <span className="flex-none font-semibold text-primary">{e.name}</span>
                        <span className="min-w-0 truncate text-muted">{doing}</span>
                    </span>
                );
            })}
        </div>
    );
}

// ---- the messages ----

const LABEL_TONE: Record<string, PillTone> = {
    "has doubts": "challenge",
    "is against it": "oppose",
    "builds on it": "accept",
};

const ghostButton =
    "-ml-[8px] h-[22px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[8px] text-[11px] font-semibold text-secondary outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent";

function FeedEvidence({ item }: { item: FeedItem }) {
    if (item.evidence == null && item.weak == null) {
        return null;
    }
    return (
        <div className="flex flex-wrap gap-[6px]">
            {(item.evidence ?? []).map((ref, i) => (
                <span
                    key={i}
                    data-council-evidence
                    className="rounded-[6px] border border-edge-mid bg-surface px-[8px] py-[2px] text-[11px] text-secondary"
                >
                    {ref}
                </span>
            ))}
            {item.weak != null && (
                <span
                    data-council-evidence
                    data-weak="true"
                    className="rounded-[6px] border border-warning/40 bg-surface px-[8px] py-[2px] text-[11px] text-warning-soft"
                >
                    {item.weak}
                </span>
            )}
        </div>
    );
}

function FeedMessage({
    c,
    item,
    renderComposer,
    onReply,
}: {
    c: Council;
    item: FeedItem;
    renderComposer: (proposalId: string, parentId: string) => ReactNode;
    onReply: (proposalId: string, parentId: string) => void;
}) {
    const author = item.author ?? "";
    const tone = avatarTone(c, author);
    const name = authorName(c, author);
    // the person's messages are not answered with a Reply; an expert's are, on the idea (its own message) or on the reply
    const replyTo =
        item.mine || item.id == null || item.proposalid == null
            ? null
            : { proposalId: item.proposalid, parentId: item.proposalid === item.id ? "" : item.id };
    return (
        <article
            data-council-feed-item
            data-feed-kind="message"
            data-feed-id={item.id}
            data-feed-label={item.label}
            data-feed-on={item.on}
            data-feed-mine={item.mine ? "true" : undefined}
            className={cn("flex gap-[9px] rounded-[8px] px-[10px] py-[8px]", item.mine && "bg-surface-raised")}
        >
            <CouncilAvatar tone={tone} name={name} />
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <div className="flex flex-wrap items-center gap-[7px] text-[11.5px]">
                    <span className={cn("font-semibold", TONE_TEXT[tone])}>{name}</span>
                    {item.label != null && <CouncilPill word={item.label} tone={LABEL_TONE[item.label] ?? "neutral"} />}
                    {item.at != null && <span className="tabular-nums text-muted">{item.at}</span>}
                </div>
                {item.on != null && (
                    <span data-feed-on-line className="flex min-w-0 items-center gap-[5px] text-[11px] text-muted">
                        <CornerDownRight size={11} aria-hidden className="flex-none" />
                        <span className="min-w-0 truncate">{item.on}</span>
                    </span>
                )}
                {item.title != null && (
                    <h3 className="m-0 text-[13.5px] font-semibold leading-[1.35] text-primary">{item.title}</h3>
                )}
                <span className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-ink-hi">
                    {item.text}
                </span>
                <FeedEvidence item={item} />
                {item.reactions != null && (
                    <div className="flex flex-wrap gap-[6px]">
                        {item.reactions.map((text, i) => (
                            <span
                                key={i}
                                data-council-reaction
                                className="inline-flex items-center gap-[5px] rounded-full bg-success/12 px-[8px] py-px text-[11px] font-semibold text-success-soft"
                            >
                                <Check size={10} strokeWidth={3} aria-hidden />
                                {text}
                            </span>
                        ))}
                    </div>
                )}
                {replyTo != null && (
                    <div className="flex items-center text-[11px] text-muted">
                        <button
                            type="button"
                            data-council-reply={item.id}
                            aria-label={`Reply to ${name}`}
                            onClick={() => onReply(replyTo.proposalId, replyTo.parentId)}
                            className={ghostButton}
                        >
                            Reply
                        </button>
                    </div>
                )}
                {replyTo != null && renderComposer(replyTo.proposalId, replyTo.parentId)}
            </div>
        </article>
    );
}

function SystemLine({ item }: { item: FeedItem }) {
    return (
        <div
            data-council-feed-item
            data-feed-kind="system"
            className="flex items-center gap-[10px] px-[10px] py-[6px] text-[11.5px] tabular-nums text-muted"
        >
            <span aria-hidden className="h-px flex-1 bg-edge-faint" />
            <span>{item.text}</span>
            <span aria-hidden className="h-px flex-1 bg-edge-faint" />
        </div>
    );
}

function TypingRow({ c, item }: { c: Council; item: FeedItem }) {
    const author = item.author ?? "";
    return (
        <div
            data-council-feed-item
            data-feed-kind="typing"
            data-feed-id={item.id}
            data-feed-on={item.on}
            className="flex items-center gap-[9px] px-[10px] py-[6px]"
        >
            <CouncilAvatar tone={avatarTone(c, author)} name={authorName(c, author)} dashed />
            <span data-council-typing className="text-[12px] text-muted">
                {item.text}
            </span>
            {item.on != null && (
                <span className="flex min-w-0 items-center gap-[5px] text-[11px] text-muted">
                    <CornerDownRight size={11} aria-hidden className="flex-none" />
                    <span className="min-w-0 truncate">{item.on}</span>
                </span>
            )}
        </div>
    );
}

// ---- the feed ----

const NEAR_BOTTOM_PX = 80;

/** The feed of a running council, scrolled to its newest message while the reader is at the bottom of it. With `onProposal`
 *  only that idea's message and what was said on it. `renderComposer` is the Discussion's (it draws the composer under the
 *  message that is being answered). */
export function Feed({
    c,
    onProposal,
    renderComposer,
    onReply,
}: {
    c: Council;
    onProposal?: string;
    renderComposer: (proposalId: string, parentId: string) => ReactNode;
    onReply: (proposalId: string, parentId: string) => void;
}) {
    const items = councilFeed(c, onProposal);
    const box = useRef<HTMLDivElement>(null);
    const atBottom = useRef(true);
    useEffect(() => {
        const el = box.current;
        if (el != null && atBottom.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [items.length, onProposal]);
    return (
        <div
            ref={box}
            data-council-feed
            onScroll={(e) => {
                const el = e.currentTarget;
                atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
            }}
            className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto pr-1"
        >
            {items.map((item, i) => {
                const key = item.id ?? `${item.kind}:${i}`;
                if (item.kind === "system") {
                    return <SystemLine key={key} item={item} />;
                }
                if (item.kind === "typing") {
                    return <TypingRow key={key} c={c} item={item} />;
                }
                return <FeedMessage key={key} c={c} item={item} renderComposer={renderComposer} onReply={onReply} />;
            })}
        </div>
    );
}
