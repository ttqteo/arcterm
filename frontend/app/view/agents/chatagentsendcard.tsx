// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A message between two agents as Chat draws it. SentMarkdown is its text, on both sides: the receiver's card
// (chatconversation.tsx SentCard) and the sender's. On the sender's side, a `wsh agents send` call is a card in the
// agent's column after the call (which stays a tool line): "to" and the badge of the agent it went to, what the send
// did, the message as Markdown; and the answer a `--wait` or a `wsh agents read` brought back is a card under it, set in
// a step, naming who answered (chatagentsend.ts reads both from the calls).

import { MOTION } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { AgentAnswer, AgentSend } from "./chatagentsend";
import { RefBadge } from "./chatrefbadge";
import { CouncilText } from "./councilchat";

/** A message folds to this height (about seven lines of its 13px text) until it is opened. */
const SENT_FOLD_PX = 150;

// The text of a message between agents, as Markdown in the reading face (its lists, `code` and paragraphs as the agent
// wrote them), whole, folded by height: past SENT_FOLD_PX it shows that much under a fade and opens on the spring, a press
// mid-motion turning it back from where it is. Its full height is measured, so a message that fits never shows the fold.
export function SentMarkdown({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    const [full, setFull] = useState<number | null>(null);
    const inner = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();
    useLayoutEffect(() => {
        const el = inner.current;
        if (el == null) {
            return;
        }
        const measure = () => setFull(el.offsetHeight);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const folds = full != null && full > SENT_FOLD_PX + 24;
    const height = !folds ? "auto" : open ? full : SENT_FOLD_PX;
    const Caret = open ? ChevronDown : ChevronRight;
    return (
        <>
            <motion.div
                data-chat-sent-text
                initial={false}
                animate={{ height }}
                transition={reduced ? { duration: 0 } : MOTION.spring}
                className={cn(
                    "overflow-hidden",
                    folds && !open && "[mask-image:linear-gradient(to_bottom,black_65%,transparent)]"
                )}
            >
                <div ref={inner}>
                    <CouncilText text={text} className="text-[13px] leading-[1.6] text-ink-mid" refs />
                </div>
            </motion.div>
            {folds ? (
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    className="flex cursor-pointer items-center gap-1 self-start text-[11.5px] text-muted hover:text-secondary"
                >
                    <Caret size={11} strokeWidth={2.2} aria-hidden className="shrink-0" />
                    {open ? "Show less" : "Show more"}
                </button>
            ) : null}
        </>
    );
}

// the badge of the agent at the other end: its name and state when it is open, the id as written when it is not
function Peer({ tab }: { tab: string }) {
    return (
        <RefBadge kind="agent" id={tab} raw={`agent:${tab}`}>
            <span className="font-mono text-[11.5px] text-secondary">{tab}</span>
        </RefBadge>
    );
}

const CARD = "flex min-w-0 max-w-[640px] flex-col gap-[6px] self-start rounded-[12px] border px-[14px] py-[9px]";

function fileName(path: string): string {
    return path.split(/[/\\]/).pop() || path;
}

/** The message this agent sent another: who to, what the send did, the text. */
export function ChatAgentSendCard({ send }: { send: AgentSend }) {
    const status =
        send.failed != null
            ? `not sent: ${send.failed}`
            : send.how === "started"
              ? "started a turn"
              : send.how === "joined"
                ? "joined its turn"
                : "sending…";
    return (
        <div
            data-chat-agent-send
            data-send-state={send.failed != null ? "failed" : (send.how ?? "pending")}
            className={cn(CARD, "mb-3", send.failed != null ? "border-error/50" : "border-edge-mid")}
        >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                <ArrowRight size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" />
                <span className="flex-none text-muted">message to</span>
                <Peer tab={send.tab} />
                <span
                    className={cn(
                        "ml-auto min-w-0 truncate text-[11.5px]",
                        send.failed != null ? "text-error" : "text-muted"
                    )}
                    title={status}
                >
                    {status}
                </span>
            </div>
            {send.text != null && send.text.trim() !== "" ? <SentMarkdown text={send.text} /> : null}
            {send.file != null ? (
                <div className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted" title={send.file}>
                    <FileText size={11} strokeWidth={2} aria-hidden className="flex-none" />
                    <span className="truncate">
                        {send.text != null ? "from " : ""}
                        {fileName(send.file)}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

/** What the other agent answered, set in a step under the message. */
export function ChatAgentAnswerCard({ answer }: { answer: AgentAnswer }) {
    return (
        <div data-chat-agent-answer className={cn(CARD, "mb-3 ml-5 border-edge-mid bg-surface/40")}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                <ArrowLeft size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" />
                <span className="flex-none text-muted">answer from</span>
                <Peer tab={answer.tab} />
            </div>
            <SentMarkdown text={answer.text} />
        </div>
    );
}
