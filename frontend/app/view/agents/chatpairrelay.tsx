// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A pair's relayed prompt in Chat (docs/superpowers/specs/2026-11-26-chat-pair-relay-design.md; boards F and G of
// .superpowers/design/chat-pair-relay): each message the pair relayed is its sender's turn, a card on the right naming
// the sender (a press opens its conversation), its time, the line it answers and its text whole, its arc-judge or
// arc-pair fence drawn as Chat's card; your own words relayed are your bubble; arcterm's brief is one folded line and the
// end notice one line. What the prompt holds is the pure parser's (pairrelay.ts).

import { springReveal, turnTransition } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { ArrowLeftRight, ArrowUpRight, ChevronRight, CornerDownRight, Hammer, Scale } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { FOCUS_RING } from "./chatbrainstormparts";
import { StepsPart } from "./chatsteplistview";
import { CodeBlock } from "./codeblock";
import { CouncilText } from "./councilchat";
import { MarkdownMessage } from "./markdownmessage";
import { briefJudges, relayPartKey, relaySenderTab, type PairRelay, type RelayMessage } from "./pairrelay";
import { usePairOf } from "./pairstore";

export function PairRelayView({
    relay,
    itemKey,
    model,
    agentTabId,
    proseClass,
}: {
    relay: PairRelay;
    itemKey: string;
    model?: AgentsViewModel;
    agentTabId: string | null;
    proseClass: string;
}) {
    const pair = usePairOf(agentTabId)?.pair ?? null;
    if (relay.kind === "ended") {
        return <EndedLine commands={relay.commands} />;
    }
    if (relay.kind === "judgeBrief") {
        return (
            <div data-chat-relay="judgeBrief" className="flex w-full flex-col items-end gap-[14px]">
                <BriefLine text={relay.brief} what={`arcterm made this agent the judge of ${relay.workerName}`} />
                {relay.reply != null ? (
                    <ReplyCard
                        msg={relay.reply}
                        partKey={relayPartKey(itemKey, 0)}
                        tabId={relay.workerTab}
                        model={model}
                        proseClass={proseClass}
                    />
                ) : null}
            </div>
        );
    }
    const first = relay.messages[0]?.time;
    return (
        <div data-chat-relay="relay" className="flex w-full flex-col items-end gap-[14px]">
            {relay.brief != null ? (
                <BriefLine
                    text={relay.brief}
                    what={`arcterm paired this agent with ${briefJudges(relay.brief).join(", ")}${first != null ? ` · ${first}` : ""}`}
                />
            ) : null}
            {relay.messages.map((msg, n) =>
                msg.from === "person" ? (
                    <YouRow key={n} msg={msg} />
                ) : msg.from === "arcterm" ? (
                    <ArctermRow key={n} msg={msg} proseClass={proseClass} />
                ) : (
                    <ReplyCard
                        key={n}
                        msg={msg}
                        partKey={relayPartKey(itemKey, n)}
                        tabId={relaySenderTab(pair, msg)}
                        model={model}
                        proseClass={proseClass}
                    />
                )
            )}
        </div>
    );
}

function useFold(): [boolean, () => void] {
    const [open, setOpen] = useState(false);
    return [open, () => setOpen((o) => !o)];
}

// opens and folds on the no-bounce spring, as every Chat part that changes shape
function Reveal({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
    const reveal = usePartMotion(springReveal);
    return (
        <AnimatePresence initial={false}>
            {open ? (
                <motion.div key="open" {...reveal} className={cn("overflow-hidden", className)}>
                    {children}
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

function Chevron({ open }: { open: boolean }) {
    return (
        <ChevronRight
            size={12}
            strokeWidth={2}
            aria-hidden
            style={turnTransition}
            className={cn("flex-none transition-transform motion-reduce:transition-none", open && "rotate-90")}
        />
    );
}

function QuoteRow({ text }: { text: string }) {
    return (
        <div
            data-chat-relay-quote
            className="flex min-w-0 items-start gap-[6px] text-[12.5px] leading-[1.45] text-muted"
        >
            <CornerDownRight size={12} strokeWidth={2} aria-hidden className="mt-[3px] flex-none" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
        </div>
    );
}

// a judge's or the working agent's reply: its turn, on the right since it comes in, wide enough for its fence card
function ReplyCard({
    msg,
    partKey,
    tabId,
    model,
    proseClass,
}: {
    msg: RelayMessage;
    partKey: string;
    tabId: string | null;
    model?: AgentsViewModel;
    proseClass: string;
}) {
    const [raw, toggleRaw] = useFold();
    const role = msg.from === "judge" ? "judge" : "working agent";
    const Icon = msg.from === "judge" ? Scale : Hammer;
    const name = (
        <span data-chat-relay-name title={msg.name} className="min-w-0 truncate font-medium text-primary">
            {msg.name}
        </span>
    );
    return (
        <section
            data-chat-relay-msg={msg.from}
            aria-label={`Reply from the ${role} ${msg.name}`}
            className="flex w-[88%] min-w-0 flex-col gap-[10px] rounded-[12px] border border-edge-mid px-[14px] pb-[14px] pt-[10px]"
        >
            <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
                <span
                    aria-hidden
                    className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] bg-surface-raised text-secondary"
                >
                    <Icon size={13} strokeWidth={1.8} />
                </span>
                {tabId != null && model != null ? (
                    <button
                        type="button"
                        data-chat-relay-open
                        title={`Open ${msg.name}'s conversation`}
                        onClick={(e) => fireAndForget(() => openOrPeek(model, { kind: "agent", tabId }, e))}
                        className={cn(
                            FOCUS_RING,
                            "group flex min-w-0 cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent p-0 text-left"
                        )}
                    >
                        {name}
                        <ArrowUpRight
                            size={12}
                            strokeWidth={2}
                            aria-hidden
                            className="flex-none text-muted group-hover:text-primary"
                        />
                    </button>
                ) : (
                    name
                )}
                <span className="flex-none text-[11.5px] text-muted">{role} · replied</span>
                {msg.time != null ? (
                    <span className="ml-auto flex-none text-[11.5px] tabular-nums text-muted">{msg.time}</span>
                ) : null}
            </div>
            {msg.quote != null ? <QuoteRow text={msg.quote} /> : null}
            {msg.text !== "" ? (
                // the prose part a fence card in it finds its place by (placePairLists keys it the same)
                <StepsPart partKey={partKey}>
                    <CouncilText text={msg.text} className={proseClass} refs commands />
                </StepsPart>
            ) : null}
            <div className="flex flex-col">
                <button
                    type="button"
                    data-chat-relay-raw-toggle
                    aria-expanded={raw}
                    onClick={toggleRaw}
                    className="flex cursor-pointer items-center gap-[4px] self-start rounded-[4px] border-0 bg-transparent p-0 text-[11.5px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <Chevron open={raw} />
                    <span>Text as relayed</span>
                </button>
                <Reveal open={raw}>
                    <div data-chat-relay-raw className="pt-[8px]">
                        <CodeBlock code={msg.raw} lang="text" />
                    </div>
                </Reveal>
            </div>
        </section>
    );
}

// your own words the pair relayed: your bubble, saying where they went
function YouRow({ msg }: { msg: RelayMessage }) {
    const where = msg.answers != null ? `answered A${msg.answers} in the pair` : "in the pair";
    return (
        <div data-chat-relay-msg="person" className="flex max-w-[75%] flex-col items-end gap-[4px]">
            {msg.quote != null ? <QuoteRow text={msg.quote} /> : null}
            <div className="rounded-[16px] bg-surface-raised px-[14px] py-[9px] text-[13.5px] leading-[1.55] text-primary [overflow-wrap:anywhere]">
                {msg.text}
            </div>
            <div className="text-[11.5px] tabular-nums text-muted">
                You, {where}
                {msg.time != null ? ` · ${msg.time}` : ""}
            </div>
        </div>
    );
}

// a part arcterm itself relayed: its text whole, as a sent card draws one
function ArctermRow({ msg, proseClass }: { msg: RelayMessage; proseClass: string }) {
    return (
        <div
            data-chat-relay-msg="arcterm"
            className="flex max-w-[75%] flex-col gap-[6px] rounded-[12px] border border-edge-mid px-[14px] py-[9px]"
        >
            <span className="text-[12.5px] font-medium text-primary">arcterm</span>
            <CouncilText text={msg.text} className={proseClass} />
        </div>
    );
}

// a brief arcterm wrote for the agent, not a message: one line, the brief behind it. Drawn without the fence cards, so
// its arc-pair or arc-judge example stays an example
function BriefLine({ text, what }: { text: string; what: string }) {
    const [open, toggle] = useFold();
    return (
        <div
            data-chat-relay-brief
            data-chat-relay-brief-open={open ? "" : undefined}
            className="flex w-full flex-col items-end"
        >
            <button
                type="button"
                data-chat-relay-brief-toggle
                aria-expanded={open}
                onClick={toggle}
                className="flex max-w-full cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent p-0 text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ArrowLeftRight size={12} strokeWidth={2} aria-hidden className="flex-none" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{what} ·</span>
                <span className="text-secondary">{open ? "Hide the brief" : "Brief"}</span>
                <Chevron open={open} />
            </button>
            <Reveal open={open} className="w-full">
                <div
                    data-chat-relay-brief-text
                    className="ml-auto mt-[8px] max-w-[88%] rounded-[10px] bg-surface px-[14px] py-[12px]"
                >
                    <MarkdownMessage
                        text={text}
                        className="min-w-0 break-words text-[13px] leading-[1.6] text-ink-mid"
                    />
                </div>
            </Reveal>
        </div>
    );
}

function EndedLine({ commands }: { commands: string[] }) {
    return (
        <div data-chat-relay="ended" className="flex flex-col items-end gap-[4px] text-[12px] text-muted">
            <span className="flex items-center gap-[6px]">
                <ArrowLeftRight size={12} strokeWidth={2} aria-hidden className="flex-none" />
                The pair ended
            </span>
            {commands.map((c) => (
                <span key={c} className="[overflow-wrap:anywhere]">
                    <code className="font-mono text-[11.5px] text-code-inline">{c}</code> may run now
                </span>
            ))}
        </div>
    );
}
