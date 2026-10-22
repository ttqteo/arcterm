// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council Discussion's thread (Main.dc.html): the open proposal as a post with its picks, and the replies under it,
// nested with thread lines, each with its stance and a Reply button; an expert writing a reply shows as a dashed row; the
// person's own replies are tinted and labelled until they are answered. The composer is here too: it says who answers a
// reply (and on a council that is over, what the follow-up costs, with the Let them read code toggle), so a post, a reply
// and Ask the whole council share it. An expert's agreement with nothing to add is a green reaction under the post, not
// a reply row. Every part carries a data-council-* attribute for the CDP scenario `council-discussion`. The rules are in councildiscussionmodel.ts and councilmodel.ts.

import { cn } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { ArrowBigDown, ArrowBigUp, Check } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
    avatarTone,
    composerHint,
    evidenceChip,
    initialOf,
    isFollowUp,
    postFoot,
    reactions,
    replyAddressees,
    replyPills,
    scoreSummary,
    sinceStart,
    unreviewed,
    type AvatarTone,
    type PillTone,
} from "./councildiscussionmodel";
import {
    answerers,
    authorName,
    flattenThread,
    followupLabel,
    pickCount,
    score,
    threadTree,
    type ThreadNode,
} from "./councilmodel";
import { estimateCouncil, replyCouncil } from "./councilstore";

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

/** The dot on an avatar's corner: an expert writing is green, one whose call failed red. Its word is in the avatar's
 *  title, so the colour never stands alone. */
export type AvatarDot = "working" | "failed" | null;

export function CouncilAvatar({
    tone,
    name,
    small,
    dashed,
    dim,
    dot,
    title,
    className,
    ...rest
}: {
    tone: AvatarTone;
    name: string;
    small?: boolean;
    dashed?: boolean;
    dim?: boolean;
    dot?: AvatarDot;
    title?: string;
    className?: string;
} & Record<`data-${string}`, string | undefined>) {
    return (
        <span
            title={title}
            {...rest}
            className={cn(
                "relative box-border flex flex-none items-center justify-center rounded-full border-2 bg-background font-bold",
                small ? "h-[18px] w-[18px] text-[9px]" : "h-[22px] w-[22px] text-[10px]",
                dashed ? "border-dashed" : "border-solid",
                TONE_BORDER[tone],
                TONE_TEXT[tone],
                dim && "opacity-55",
                className
            )}
        >
            {initialOf(name)}
            {dot != null && (
                <span
                    className={cn(
                        "absolute -bottom-[2px] -right-[2px] box-border h-[7px] w-[7px] rounded-full border-[1.5px] border-background",
                        dot === "working" ? "bg-working pulse-dot" : "bg-error"
                    )}
                />
            )}
        </span>
    );
}

const PILL_TONE: Record<PillTone, string> = {
    accept: "bg-success/12 text-success-soft",
    challenge: "bg-askingbg text-warning-soft",
    oppose: "bg-error/12 text-error-soft",
    neutral: "bg-pill text-secondary",
    live: "bg-success/12 text-success-soft",
};

export function CouncilPill({ word, tone }: { word: string; tone: PillTone }) {
    return <span className={cn("rounded-full px-[7px] py-px text-[10px] font-semibold", PILL_TONE[tone])}>{word}</span>;
}

export function EvidenceChips({ evidence }: { evidence?: CouncilEvidence[] }) {
    const chips = (evidence ?? []).map(evidenceChip);
    if (chips.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-wrap gap-[6px]">
            {chips.map((chip, i) => (
                <span
                    key={i}
                    data-council-evidence
                    data-weak={chip.weak ? "true" : undefined}
                    className={cn(
                        "rounded-[6px] border bg-surface px-[8px] py-[2px] text-[11px]",
                        chip.weak ? "border-warning/40 text-warning-soft" : "border-edge-mid text-secondary"
                    )}
                >
                    {chip.text}
                </span>
            ))}
        </div>
    );
}

// ---- the estimate a composer or the pause shows ----

/** One estimate over wshrpc, or null while it is on its way (a stale one for other inputs is never shown). Free: it
 *  prices, it calls no model. */
export function useEstimate(data: CommandCouncilEstimateData | null): CouncilEstimateRtnData | null {
    const key = data == null ? "" : JSON.stringify(data);
    const [got, setGot] = useState<{ key: string; value: CouncilEstimateRtnData } | null>(null);
    useEffect(() => {
        if (key === "") {
            return;
        }
        let live = true;
        void estimateCouncil(JSON.parse(key) as CommandCouncilEstimateData).then((r) => {
            if (live && r.ok) {
                setGot({ key, value: r.value });
            }
        });
        return () => {
            live = false;
        };
    }, [key]);
    return got?.key === key ? got.value : null;
}

// ---- the composer ----

/** A reply being written: which proposal and reply it answers (both empty: the whole council), its text, and whether the
 *  follow-up may read code. One per council, in an atom so it survives a trip to the Summary and back. */
export interface ComposerDraft {
    proposalId: string;
    parentId: string;
    text: string;
    tools: boolean;
}

export const councilComposerAtom = atomFamily(
    (_id: string) => atom<ComposerDraft | null>(null) as PrimitiveAtom<ComposerDraft | null>
);

export function CouncilComposer({
    c,
    draft,
    onChange,
    onClose,
}: {
    c: Council;
    draft: ComposerDraft;
    onChange: (d: ComposerDraft) => void;
    onClose: () => void;
}) {
    const box = useRef<HTMLTextAreaElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        box.current?.focus();
    }, []);

    const who = answerers(c, draft.proposalId, draft.parentId, draft.text);
    const followUp = isFollowUp(c);
    const k = followUp ? who.length : 0;
    const est = useEstimate(k > 0 ? { id: c.id, followup: k, tools: draft.tools } : null);
    const hint = k > 0 ? followupLabel(est, k, draft.tools) : composerHint(c, who);
    const text = draft.text.trim();

    const send = async () => {
        if (text === "" || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        const r = await replyCouncil({
            id: c.id,
            proposalid: draft.proposalId || undefined,
            parentid: draft.parentId || undefined,
            text,
            tools: followUp && draft.tools ? true : undefined,
        });
        setBusy(false);
        if (r.ok === false) {
            setError(r.error);
        } else {
            onClose();
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            void send();
        }
    };
    const target =
        draft.parentId !== "" ? "this reply" : draft.proposalId !== "" ? "this proposal" : "the whole council";

    return (
        <div
            data-council-composer
            data-composer-for={`${draft.proposalId}:${draft.parentId}`}
            onKeyDown={onKeyDown}
            className="mt-[4px] flex flex-col gap-[6px]"
        >
            <textarea
                ref={box}
                data-council-composer-input
                rows={2}
                value={draft.text}
                aria-label={`Your reply to ${target}`}
                placeholder="Reply… @RAM asks one expert"
                onChange={(e) => onChange({ ...draft, text: e.target.value })}
                className="box-border min-h-[52px] w-full resize-none rounded-[8px] border border-edge-strong bg-surface px-[10px] py-[8px] text-[12.5px] leading-[1.5] text-primary outline-none focus:border-accent"
            />
            {followUp && (
                <button
                    type="button"
                    role="switch"
                    aria-checked={draft.tools}
                    data-council-tools
                    onClick={() => onChange({ ...draft, tools: !draft.tools })}
                    className="flex w-fit cursor-pointer items-center gap-[7px] rounded-[6px] border-0 bg-transparent py-px text-[11.5px] text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <span
                        className={cn(
                            "relative h-[14px] w-[24px] flex-none rounded-full",
                            draft.tools ? "bg-accent" : "bg-edge-strong"
                        )}
                    >
                        <span
                            className={cn(
                                "absolute top-[2px] h-[10px] w-[10px] rounded-full bg-background",
                                draft.tools ? "left-[12px]" : "left-[2px]"
                            )}
                        />
                    </span>
                    Let them read code
                </button>
            )}
            <div className="flex flex-wrap items-center gap-[8px]">
                <button
                    type="button"
                    data-council-composer-send
                    disabled={text === "" || busy}
                    onClick={() => void send()}
                    title="Send (Ctrl Enter)"
                    className="h-[26px] cursor-pointer rounded-[6px] border-0 bg-accent px-[12px] text-[11.5px] font-semibold text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
                >
                    {busy ? "Sending…" : "Reply"}
                </button>
                <button
                    type="button"
                    data-council-composer-cancel
                    onClick={onClose}
                    className="h-[26px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[10px] text-[11.5px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Cancel
                </button>
                <span data-council-composer-hint className="min-w-0 text-[11px] tabular-nums text-muted">
                    {hint}
                </span>
            </div>
            {error != null && (
                <span role="alert" data-council-composer-error className="text-[11.5px] text-error-soft">
                    {error}
                </span>
            )}
        </div>
    );
}

// ---- the post ----

const ghostButton =
    "h-[24px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[8px] text-[11.5px] font-semibold text-secondary outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent";

/** The open proposal as a post: its ↑ (the experts that picked it; an old council with no picks, its score), author and
 *  time, argument, evidence and reactions, with a Reply. */
export function ProposalPost({
    c,
    proposal,
    onReply,
    composer,
}: {
    c: Council;
    proposal: CouncilProposal;
    onReply: () => void;
    composer: ReactNode;
}) {
    const author = c.experts.find((e) => e.id === proposal.author);
    const tone = avatarTone(c, proposal.author);
    const picked = pickCount(c, proposal.id);
    const net = picked ?? score(c, proposal.id);
    const out = proposal.withdrawn || proposal.cut;
    const agrees = reactions(c, proposal.id);
    return (
        <article
            data-council-post={proposal.id}
            className={cn(
                "flex gap-3 rounded-[10px] border border-edge-mid bg-surface-raised py-3 pl-2 pr-[14px]",
                out && "opacity-80"
            )}
        >
            <div
                role="img"
                aria-label={scoreSummary(c, proposal.id)}
                title={scoreSummary(c, proposal.id)}
                className="flex w-[34px] flex-none flex-col items-center gap-[2px]"
            >
                <ArrowBigUp size={16} strokeWidth={2.2} className={net > 0 ? "text-success-soft" : "text-muted"} />
                <span
                    data-council-score
                    className={cn("text-[13px] font-bold tabular-nums", net < 0 ? "text-error-soft" : "text-primary")}
                >
                    {net}
                </span>
                {picked == null && (
                    <ArrowBigDown size={16} strokeWidth={2.2} className={net < 0 ? "text-error-soft" : "text-muted"} />
                )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
                <div className="flex flex-wrap items-center gap-[7px] text-[11.5px] text-muted">
                    <CouncilAvatar tone={tone} name={authorName(c, proposal.author)} small />
                    <span className={cn("font-semibold", TONE_TEXT[tone])}>{authorName(c, proposal.author)}</span>
                    <span className="tabular-nums">
                        {[author?.model, sinceStart(c, proposal.ts)].filter(Boolean).join(" · ")}
                    </span>
                    {proposal.withdrawn && (
                        <span className="rounded-full bg-askingbg px-[7px] py-px font-semibold text-warning-soft">
                            Withdrawn
                        </span>
                    )}
                    {proposal.cut && (
                        <span className="rounded-full bg-pill px-[7px] py-px font-semibold text-secondary">
                            Cut at the pause
                        </span>
                    )}
                </div>
                <h2 data-council-post-title className="m-0 text-[16px] font-semibold leading-[1.35] text-primary">
                    {proposal.title}
                </h2>
                <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-ink-hi">
                    {proposal.argument}
                </p>
                <EvidenceChips evidence={proposal.evidence} />
                {agrees.length > 0 && (
                    <div className="flex flex-wrap gap-[6px]">
                        {agrees.map((text, i) => (
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
                <div className="flex items-center gap-[14px] pt-[2px] text-[11.5px] text-muted">
                    <button
                        type="button"
                        data-council-reply="post"
                        onClick={onReply}
                        className={cn(ghostButton, "-ml-[8px]")}
                    >
                        Reply
                    </button>
                    <span data-council-post-foot>{postFoot(c, proposal.id)}</span>
                </div>
                {unreviewed(c, proposal.id) && (
                    <span data-council-unreviewed className="text-[11.5px] text-muted">
                        No expert has reviewed this one. Reply to ask, or Summarize to rank it with the rest.
                    </span>
                )}
                {composer}
            </div>
        </article>
    );
}

// ---- the replies ----

function ThreadRow({
    c,
    node,
    onReply,
    composer,
}: {
    c: Council;
    node: ThreadNode;
    onReply: (replyId: string) => void;
    composer: ReactNode;
}) {
    const tone = avatarTone(c, node.author);
    const name = authorName(c, node.author);
    const reply = node.reply;
    const mine = reply?.author === "you";
    const typing = node.kind === "typing";
    return (
        <div
            data-council-node={node.key}
            data-node-kind={node.kind}
            data-node-depth={node.depth}
            data-node-mine={mine ? "true" : undefined}
            className="flex"
        >
            {Array.from({ length: node.depth }, (_, i) => (
                <span key={i} aria-hidden className="flex w-[22px] flex-none justify-center">
                    <span className="w-[2px] bg-edge-mid" />
                </span>
            ))}
            <div
                className={cn(
                    "-ml-[8px] flex min-w-0 flex-1 gap-[9px] rounded-[8px] px-[8px] py-[7px]",
                    mine && "bg-accentbg"
                )}
            >
                <div className="flex w-[22px] flex-none flex-col items-center gap-[4px]">
                    <CouncilAvatar tone={tone} name={name} dashed={typing} />
                    <span
                        aria-hidden
                        className={cn("w-[2px] flex-1", node.children.length > 0 ? "bg-edge-mid" : "bg-transparent")}
                    />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                    <div className="flex flex-wrap items-center gap-[7px] text-[11.5px]">
                        <span className={cn("font-semibold", TONE_TEXT[tone])}>{name}</span>
                        {reply != null && <span className="tabular-nums text-muted">{sinceStart(c, reply.ts)}</span>}
                        {typing ? (
                            <CouncilPill word="Replying…" tone="live" />
                        ) : (
                            reply != null &&
                            replyPills(c, reply).map((p) => <CouncilPill key={p.word} word={p.word} tone={p.tone} />)
                        )}
                    </div>
                    {typing ? (
                        <span data-council-typing className="text-[12.5px] leading-[1.5] text-muted">
                            {node.text}
                        </span>
                    ) : (
                        <>
                            <span className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-ink-hi">
                                {reply?.text}
                            </span>
                            <EvidenceChips evidence={reply?.evidence} />
                            <div className="flex items-center gap-[12px] text-[11px] text-muted">
                                <button
                                    type="button"
                                    data-council-reply={reply?.id}
                                    aria-label={`Reply to ${name}`}
                                    onClick={() => reply != null && onReply(reply.id)}
                                    className={cn(ghostButton, "-ml-[8px] h-[22px] text-[11px]")}
                                >
                                    Reply
                                </button>
                                {mine && reply != null && <span>{replyAddressees(c, reply)}</span>}
                            </div>
                        </>
                    )}
                    {composer}
                </div>
            </div>
        </div>
    );
}

/** One proposal's replies, nested in reading order, with the composer open under the reply it answers. */
export function ThreadView({
    c,
    proposalId,
    renderComposer,
    onReply,
}: {
    c: Council;
    proposalId: string;
    renderComposer: (proposalId: string, parentId: string) => ReactNode;
    onReply: (replyId: string) => void;
}) {
    const nodes = flattenThread(threadTree(c, proposalId));
    return (
        <div data-council-thread className="flex flex-col">
            {nodes.map((n) => (
                <ThreadRow
                    key={n.key}
                    c={c}
                    node={n}
                    onReply={onReply}
                    composer={n.reply != null ? renderComposer(proposalId, n.reply.id) : null}
                />
            ))}
        </div>
    );
}
