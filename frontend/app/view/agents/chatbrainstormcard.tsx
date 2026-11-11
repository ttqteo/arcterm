// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The brainstorm question as Chat draws it (docs/superpowers/specs/2026-11-11-chat-redesign-design.md, section 6): a card
// at the end of the conversation while the agent waits on an answer, a one-line pointer once the brainstorm moved on to
// its builder check or run (both stay in the Brainstorm tab), and the ✓ row an answered question folds into. What each
// draws is chatbrainstorm.ts's; the conversation decides where they go (chatconversation.tsx). Brainstorm stays its own
// tab: the card shows the question, its why, the options and the read, and never the pros, cons or boards.

import { springReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { ArrowUpRight, Check, Lightbulb, PanelsTopLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import { optionLetter, pickedLine, sendPickedLabel, togglePick } from "./brainstormmodel";
import { sendBrainstorm } from "./brainstormsend";
import { ERROR_LINE, useAction } from "./brainstormui";
import {
    compareLine,
    questionHead,
    weighingLine,
    type OpenQuestion,
    type PointerCard,
    type QuestionCard,
} from "./chatbrainstorm";

const OPEN_KEY = "Alt+C";

const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SMALL_BTN =
    "flex flex-none cursor-pointer items-center gap-[6px] rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[4px] text-[12px] text-secondary hover:border-edge-strong hover:bg-surface-hover";
const PRIMARY_BTN =
    "flex-none cursor-pointer rounded-[7px] bg-accent px-[14px] py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const ROW =
    "flex min-w-0 items-stretch overflow-hidden rounded-[10px] border has-[button:disabled]:opacity-60 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-accent";
const ROW_PICK = "border-accent/55 bg-accent/8 has-[button:enabled:hover]:bg-accentbg";
const ROW_PLAIN = "border-edge-mid bg-surface has-[button:enabled:hover]:border-edge-strong";
const LETTER =
    "flex h-[24px] w-[24px] flex-none items-center justify-center rounded-[6px] border border-edge-strong font-mono text-[11.5px] font-semibold text-secondary";

// the Brainstorm tab replaces what Chat shows, as the header's control does, so it stays one place with the other views
function openBrainstorm(agent: AgentVM): void {
    setAgentView(agent.id, "brainstorm", Date.now());
}

function OpenButton({ agent }: { agent: AgentVM }) {
    return (
        <button
            type="button"
            data-chat-bscard-open
            title={`Open the brainstorm (${OPEN_KEY})`}
            onClick={() => openBrainstorm(agent)}
            className={cn(SMALL_BTN, FOCUS_RING)}
        >
            Open in Brainstorm
            <kbd className="font-mono text-[11px] text-muted">{OPEN_KEY}</kbd>
            <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
        </button>
    );
}

// one dot and one word say where the question stands, never the colour alone
function StateTag({ state }: { state: QuestionCard["state"] }) {
    if (state === "static") {
        return <span className="ml-[6px] text-muted">Agent exited</span>;
    }
    const waiting = state === "waiting";
    return (
        <span className={cn("ml-[6px] flex items-center gap-[6px]", waiting ? "text-warning" : "text-secondary")}>
            <span
                aria-hidden="true"
                className={cn("h-[6px] w-[6px] flex-none rounded-full pulse-dot", waiting ? "bg-asking" : "bg-working")}
            />
            {waiting ? "Waiting on you" : "Judge weighing"}
        </span>
    );
}

// the box before a row's button on a question that takes more than one option: ticking only collects the row
function TickBox({ i, on, disabled, onToggle }: { i: number; on: boolean; disabled: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={`Combine ${optionLetter(i)}`}
            data-chat-bscard-tick={i}
            disabled={disabled}
            onClick={onToggle}
            className="flex flex-none cursor-pointer items-center border-0 bg-transparent pl-[12px] outline-none disabled:cursor-default"
        >
            <span
                className={cn(
                    "flex h-[16px] w-[16px] items-center justify-center rounded-[4px] border",
                    on ? "border-accent bg-accent text-background" : "border-edge-strong text-transparent"
                )}
            >
                <Check size={10} strokeWidth={3} aria-hidden />
            </span>
        </button>
    );
}

function OptionRow({
    q,
    i,
    disabled,
    onSend,
    children,
}: {
    q: QuestionCard;
    i: number;
    disabled: boolean;
    onSend: (text: string) => void;
    children?: ReactNode;
}) {
    const o = q.options[i];
    const pick = i === q.pick;
    return (
        <div className={cn(ROW, pick ? ROW_PICK : ROW_PLAIN)}>
            {children}
            <button
                type="button"
                data-chat-bscard-option={i}
                data-pick={pick ? "" : undefined}
                disabled={disabled}
                onClick={() => onSend(o.label)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-[12px] border-0 bg-transparent px-[12px] py-[9px] text-left outline-none disabled:cursor-default"
            >
                <span className={LETTER}>{optionLetter(i)}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="text-[13.5px] font-semibold leading-[1.4] text-primary">{o.label}</span>
                    {o.detail ? <span className="text-[12.5px] leading-[1.45] text-ink-mid">{o.detail}</span> : null}
                </span>
                {pick ? (
                    <span className="flex-none text-[12px] font-semibold text-accent-soft">{q.pickLabel}</span>
                ) : null}
            </button>
        </div>
    );
}

// Send under the ticked rows, joining their labels with " + " as the Brainstorm pane does; it opens and closes on the
// spring, so ticking the first row does not shove the feed
function SendTicked({
    picked,
    busy,
    onSend,
    onClear,
}: {
    picked: number[];
    busy: boolean;
    onSend: () => void;
    onClear: () => void;
}) {
    return (
        <AnimatePresence initial={false}>
            {picked.length > 0 ? (
                <motion.div
                    key="send"
                    variants={springReveal}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="overflow-hidden"
                >
                    <div className="flex items-center gap-[10px] p-[2px]">
                        <button
                            type="button"
                            data-chat-bscard-send
                            disabled={busy}
                            onClick={onSend}
                            className={cn(PRIMARY_BTN, FOCUS_RING)}
                        >
                            {sendPickedLabel(picked)}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={onClear}
                            className={cn(SMALL_BTN, FOCUS_RING, "disabled:opacity-50")}
                        >
                            Clear
                        </button>
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

function QuestionBox({ agent, q, onPick }: { agent: AgentVM; q: QuestionCard; onPick?: (text: string) => void }) {
    const act = useAction();
    const [picked, setPicked] = useState<number[]>([]);
    // an exited agent has nothing to send to: the card stays as the record of what it asked
    const off = act.busy || q.state === "static";
    const send = async (text: string) => {
        if (off) {
            return;
        }
        if (await act.run(() => sendBrainstorm(agent, { kind: "answer", text }))) {
            setPicked([]);
            onPick?.(text);
        }
    };
    const sendTicked = () => {
        if (picked.length > 0) {
            void send(pickedLine(picked.map((i) => q.options[i].label)));
        }
    };
    return (
        <motion.div
            variants={springReveal}
            initial="initial"
            animate="animate"
            exit="exit"
            className="overflow-hidden rounded-[12px]"
        >
            <section
                data-chat-bscard
                data-chat-bscard-state={q.state}
                data-chat-bscard-n={q.n}
                aria-label={`Brainstorm question ${q.n}`}
                className="flex flex-col gap-[12px] rounded-[12px] border border-edge-strong bg-surface-raised px-[16px] py-[14px]"
            >
                <div className="flex items-center gap-[8px] text-[12px] text-muted">
                    <Lightbulb size={14} strokeWidth={2} className="flex-none" aria-hidden />
                    <span data-chat-bscard-head className="min-w-0 truncate">
                        {questionHead(q.n, q.part)}
                    </span>
                    <StateTag state={q.state} />
                    <span className="ml-auto flex-none">
                        <OpenButton agent={agent} />
                    </span>
                </div>
                <div className="flex flex-col gap-[4px]">
                    <div className="text-[15px] font-semibold leading-[1.45] text-primary">{q.question}</div>
                    {q.why ? <div className="text-[12.5px] leading-[1.5] text-muted">{q.why}</div> : null}
                </div>
                {q.state === "weighing" && q.weighing != null ? (
                    <div data-chat-bscard-weighing className="text-[12.5px] leading-[1.5] text-secondary">
                        {weighingLine(q.weighing)}
                    </div>
                ) : null}
                {q.options.length > 0 ? (
                    <div role="group" aria-label="Answers" className="flex flex-col gap-[6px]">
                        {q.options.map((_, i) => (
                            <OptionRow key={i} q={q} i={i} disabled={off} onSend={(t) => void send(t)}>
                                {q.multi ? (
                                    <TickBox
                                        i={i}
                                        on={picked.includes(i)}
                                        disabled={off}
                                        onToggle={() => setPicked((p) => togglePick(p, i))}
                                    />
                                ) : null}
                            </OptionRow>
                        ))}
                    </div>
                ) : null}
                {q.multi && q.options.length > 0 ? (
                    <SendTicked picked={picked} busy={off} onSend={sendTicked} onClear={() => setPicked([])} />
                ) : null}
                {act.error ? (
                    <div role="alert" className={ERROR_LINE}>
                        {act.error}
                    </div>
                ) : null}
                {q.read ? (
                    <div data-chat-bscard-read className="text-[12.5px] leading-[1.5] text-secondary">
                        <span className="text-muted">Read · </span>
                        {q.read}
                    </div>
                ) : null}
                <div className="flex items-center gap-[12px] border-t border-edge-mid pt-[10px] text-[12px] text-muted">
                    {q.boards > 0 ? (
                        <button
                            type="button"
                            data-chat-bscard-boards
                            onClick={() => openBrainstorm(agent)}
                            className={cn(
                                "flex cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent p-0 text-accent-soft hover:underline",
                                FOCUS_RING
                            )}
                        >
                            <PanelsTopLeft size={13} strokeWidth={2} aria-hidden />
                            {compareLine(q.boards)}
                        </button>
                    ) : null}
                    {q.reasons ? <span>Pros and cons are there too</span> : null}
                    {q.state !== "static" ? (
                        <span className="ml-auto text-right">Type below to answer in your own words</span>
                    ) : null}
                </div>
            </section>
        </motion.div>
    );
}

// the builder check and the run stay in the Brainstorm tab: one line says so, and opens it
function PointerLine({ agent, card }: { agent: AgentVM; card: PointerCard }) {
    return (
        <motion.div
            variants={springReveal}
            initial="initial"
            animate="animate"
            exit="exit"
            className="overflow-hidden rounded-[10px]"
        >
            <div
                data-chat-bscard-pointer
                data-chat-bscard-phase={card.phase}
                className="flex min-w-0 items-center gap-[10px] rounded-[10px] border border-edge-mid bg-surface px-[14px] py-[9px] text-[12.5px]"
            >
                <Lightbulb size={14} strokeWidth={2} className="flex-none text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-secondary" title={card.line}>
                    {card.line}
                </span>
                <OpenButton agent={agent} />
            </div>
        </motion.div>
    );
}

/** The question the brainstorm asks now, drawn in the conversation: the card while it waits (a click on an option sends
 *  exactly the line the Brainstorm pane sends, through sendBrainstorm, and `onPick` hears the text once it went), the
 *  one-line pointer once the brainstorm is past its questions. Enters on springReveal; the conversation wraps it in an
 *  AnimatePresence so it also leaves on it. */
export function ChatBrainstormCard({
    agent,
    question,
    onPick,
}: {
    agent: AgentVM;
    question: OpenQuestion;
    onPick?: (text: string) => void;
}) {
    return question.state === "pointer" ? (
        <PointerLine agent={agent} card={question} />
    ) : (
        <QuestionBox agent={agent} q={question} onPick={onPick} />
    );
}

/** An answered question as one ✓ row, drawn in place of the user's message that carried the answer, so it is never
 *  shown twice. */
export function ChatBrainstormAnswered({ n, part, text }: { n: number; part: string; text: string }) {
    return (
        <div
            data-chat-bscard-answered
            data-chat-bscard-n={n}
            className="flex min-w-0 items-center gap-[10px] rounded-[10px] border border-edge-mid bg-surface px-[14px] py-[9px] text-[12.5px]"
        >
            <Check size={14} strokeWidth={2.2} className="flex-none text-muted" aria-hidden />
            <span className="flex-none text-muted">{questionHead(n, part)}</span>
            <span className="min-w-0 truncate font-medium text-primary" title={text}>
                {text}
            </span>
            <span className="ml-auto flex-none text-muted">You picked</span>
        </div>
    );
}
