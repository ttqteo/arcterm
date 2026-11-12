// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The brainstorm as Chat draws it (docs/superpowers/specs/2026-11-11-chat-redesign-design.md, section 6, and
// 2026-11-12-chat-brainstorm-review-design.md): the card at the end of the conversation, by its kind (the question the
// agent waits on here; the Confirm the design card, the builder check card and the run card are chatbrainstormconfirm.tsx,
// chatbrainstormcheck.tsx and chatbrainstormrun.tsx), and the ✓ rows a finished question or step folds into. What each
// draws is chatbrainstorm.ts's; the conversation decides where they go (chatconversation.tsx). What the cards share
// (shell, folds, option rows, the ✓ row) is chatbrainstormparts.tsx. Brainstorm stays its own tab: the question card
// shows the question, its why, the options, the read and the decisions made so far, and never the pros, cons or boards.

import { cn } from "@/util/util";
import { Check, Lightbulb, PanelsTopLeft } from "lucide-react";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { pickedLine, sendPickedLabel, togglePick } from "./brainstormmodel";
import { sendBrainstorm } from "./brainstormsend";
import { shownBrainstormFile, type BrainstormState } from "./brainstormstore";
import { ERROR_LINE, useAction } from "./brainstormui";
import {
    builderAnswerText,
    builderDoneLine,
    builderQuestionHead,
    compareLine,
    designDoneLine,
    questionHead,
    weighingLine,
    type ChatCard,
    type PairedAnswer,
    type QuestionCard,
    type RunCard,
} from "./chatbrainstorm";
import { ChatBrainstormCheck } from "./chatbrainstormcheck";
import { ChatBrainstormConfirm } from "./chatbrainstormconfirm";
import {
    CardShell,
    DoneRow,
    FOCUS_RING,
    Fold,
    OptionRows,
    PRIMARY_BTN,
    SMALL_BTN,
    TickBox,
    openBrainstorm,
} from "./chatbrainstormparts";

// Send under the rows of a question that takes several, joining the ticked labels with " + " as the Brainstorm pane does.
// It is always there, off until a row is ticked (then it names them: "Send A + C"), so ticking the first row shoves
// nothing; Clear joins it once any is ticked.
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
        <div className="flex items-center gap-[10px] p-[2px]">
            <button
                type="button"
                data-chat-bscard-send
                disabled={busy || picked.length === 0}
                onClick={onSend}
                className={cn(PRIMARY_BTN, FOCUS_RING)}
            >
                {picked.length > 0 ? sendPickedLabel(picked) : "Send"}
            </button>
            {picked.length > 0 ? (
                <button type="button" disabled={busy} onClick={onClear} className={cn(SMALL_BTN, FOCUS_RING)}>
                    Clear
                </button>
            ) : null}
        </div>
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
        <CardShell
            kind="question"
            state={q.state}
            head={questionHead(q.n, q.part)}
            icon={<Lightbulb size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            agent={agent}
            label={`Brainstorm question ${q.n}`}
            extra={{ "data-chat-bscard": true, "data-chat-bscard-n": q.n }}
        >
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
                <OptionRows
                    options={q.options}
                    pick={q.pick}
                    pickLabel={q.pickLabel}
                    disabled={off}
                    onSend={(t) => void send(t)}
                    tick={
                        q.multi
                            ? (i) => (
                                  <TickBox
                                      i={i}
                                      on={picked.includes(i)}
                                      disabled={off}
                                      onToggle={() => setPicked((p) => togglePick(p, i))}
                                  />
                              )
                            : undefined
                    }
                />
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
            <div className="border-t border-edge-mid pt-[10px]">
                {/* Decided so far opens under the whole footer row, so it shares that row with the link and the hint */}
                <Fold
                    name="decided"
                    label={`Decided ${q.decided.length}`}
                    items={q.decided}
                    beside={
                        <>
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
                        </>
                    }
                />
            </div>
        </CardShell>
    );
}

/** The card the conversation ends with, by its kind: the question it waits on (a click on an option sends exactly the
 *  line the Brainstorm pane sends, through sendBrainstorm, and `onPick` hears the text once it went), the Confirm the
 *  design card, or the builder check card. Each is its own `CardShell`, which enters on springReveal; the conversation
 *  wraps this in an AnimatePresence so it also leaves on it. The run card is `ChatBrainstormRunRow`'s, which draws its own
 *  end row (a done run draws no row at all), so it is not a card this takes. `model` and `state` are the cockpit and the
 *  agent's brainstorm the check and Confirm cards read from (the clock, the launcher, the file they were made from). */
export function ChatBrainstormCard({
    agent,
    card,
    model,
    state,
    onPick,
}: {
    agent: AgentVM;
    card: Exclude<ChatCard, RunCard>;
    model: AgentsViewModel;
    state: BrainstormState;
    onPick?: (text: string) => void;
}) {
    switch (card.kind) {
        case "question":
            return <QuestionBox agent={agent} q={card} onPick={onPick} />;
        case "confirm": {
            const file = shownBrainstormFile(state);
            return file == null ? null : (
                <ChatBrainstormConfirm agent={agent} card={card} path={state.path} file={file} />
            );
        }
        case "check":
            return <ChatBrainstormCheck agent={agent} card={card} model={model} state={state} />;
    }
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

/** A builder question's answer as a ✓ row, "Builder question 2 · Motion — Fade", in place of the user's message that
 *  carried it. `text` is the record's whole line (`brainstorm: builder answer: …`) or the answer alone: the row never
 *  shows the prefix. */
export function ChatBrainstormBuilderAnswered({ n, part, text }: { n: number; part: string; text: string }) {
    return <DoneRow kind="builder-answer" n={n} head={builderQuestionHead(n, part)} text={builderAnswerText(text)} />;
}

/** The ✓ row a design or builder step folds into, drawn in place of the message that ended the step: "Design confirmed ·
 *  9 decisions", "Builder check · 2 questions, 3 calls". A record of another kind draws nothing. */
export function ChatBrainstormStepDone({ answer }: { answer: PairedAnswer }) {
    if (answer.kind === "design") {
        return <DoneRow kind="design" head={designDoneLine(answer.decisions ?? 0)} />;
    }
    if (answer.kind === "builder") {
        return (
            <DoneRow kind="builder" head={builderDoneLine(answer.questions ?? 0, answer.calls ?? 0, answer.outcome)} />
        );
    }
    return null;
}
