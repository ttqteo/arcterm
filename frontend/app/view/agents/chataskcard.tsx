// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An AskUserQuestion in the conversation, on its own rather than folded into the tools around it: each question in full,
// then what you decided under it, the options you passed over in one muted line. The words come from chatask.ts.

import { cn } from "@/util/util";
import { Check, MessageCircleQuestion, Minus } from "lucide-react";
import type { AskQuestionDetail } from "./agentsviewmodel";
import { askAnswered, askHead, askView, type AskAnswer } from "./chatask";

function AnswerRow({ answer }: { answer: AskAnswer }) {
    return (
        <div
            data-chat-askcard-answer={answer.typed ? "typed" : "picked"}
            className="flex min-w-0 items-start gap-[9px] rounded-[8px] border border-edge-mid bg-surface-raised px-[11px] py-[8px]"
        >
            <Check size={13} strokeWidth={2.6} aria-hidden className="mt-[3px] flex-none text-accent-soft" />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px] [overflow-wrap:anywhere]">
                <span className="whitespace-pre-wrap text-[13px] font-semibold leading-[1.5] text-primary">
                    {answer.label}
                </span>
                {answer.description ? (
                    <span className="text-[12px] leading-[1.45] text-muted">{answer.description}</span>
                ) : null}
            </div>
            {answer.typed ? <span className="mt-[2px] flex-none text-[11.5px] text-muted">Your words</span> : null}
        </div>
    );
}

/** The ask's card: its questions and your answers. `questions` are the call's own, `picked` / `typed` filled once
 *  answered; an ask that ended unanswered (turned down, or the agent exited while it waited) says so under each. */
export function ChatAskCard({ questions }: { questions: AskQuestionDetail[] }) {
    const answered = askAnswered(questions);
    const several = questions.length > 1;
    const head = askHead(questions);
    return (
        <section
            data-chat-askcard={answered ? "answered" : "unanswered"}
            aria-label={`Asked: ${head}`}
            className="flex min-w-0 flex-col gap-[10px] rounded-[12px] border border-edge-mid bg-surface px-[14px] py-[12px]"
        >
            <div className="flex min-w-0 items-center gap-[7px] text-[12px] text-muted">
                <MessageCircleQuestion size={13} strokeWidth={2} aria-hidden className="flex-none" />
                <span title={head} className="min-w-0 truncate">
                    Asked · <span className="text-secondary">{head}</span>
                </span>
            </div>
            {questions.map((q, i) => {
                const v = askView(q);
                return (
                    <div
                        key={i}
                        className={cn(
                            "flex min-w-0 flex-col gap-[7px]",
                            i > 0 && "border-t border-edge-faint pt-[10px]"
                        )}
                    >
                        {several && v.header ? <span className="text-[11.5px] text-muted">{v.header}</span> : null}
                        <div className="whitespace-pre-wrap text-[13.5px] leading-[1.55] text-primary [overflow-wrap:anywhere]">
                            {v.question}
                        </div>
                        {v.answers.length > 0 ? (
                            v.answers.map((a, k) => <AnswerRow key={k} answer={a} />)
                        ) : (
                            <div
                                data-chat-askcard-answer="none"
                                className="flex items-center gap-[9px] px-[11px] text-[12.5px] text-muted"
                            >
                                <Minus size={13} strokeWidth={2.2} aria-hidden className="flex-none" />
                                No answer
                            </div>
                        )}
                        {v.passed.length > 0 ? (
                            <div className="px-[11px] text-[12px] leading-[1.5] text-muted [overflow-wrap:anywhere]">
                                {v.answers.length > 0 ? "Not picked: " : "Offered: "}
                                {v.passed.join(" · ")}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </section>
    );
}
