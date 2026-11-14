// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Doc review as Chat draws it (docs/superpowers/specs/2026-11-14-chat-council-design.md sections 4 and 5, board
// DocReview.dc.html): a card holding the file, the agent's intro and the passages worth a look, with Review and Approve,
// in place of the plain choices of the AskUserQuestion with header `Doc review`; once answered, one row. The fields, the
// folded row's outcome and its text come from chatdocreview.ts. Review opens the review view as the answer bar's Review
// does; Approve answers with the agent's own Approve option, through the answer path the cockpit's bars share
// (askanswer.ts), which locks the ask against a second click. Request changes is not on the card: each comment sits on a
// passage, so it is made in the review view.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { FileText } from "lucide-react";
import type { AgentsViewModel } from "./agents";
import { askSentKey, type AgentVM, type AskQuestionDetail } from "./agentsviewmodel";
import { answerAgentAsk } from "./askanswer";
import { CardShell, DoneRow, FOCUS_RING, PRIMARY_BTN, SMALL_BTN } from "./chatbrainstormparts";
import { docReviewDoneLine, docReviewFields, docReviewRow, type DocReviewQuestion } from "./chatdocreview";
import { useAgentCwd } from "./chathandoffstore";
import { openReview } from "./docreviewstore";

// Approve is the secondary button of the pair, as tall as Review
const APPROVE_BTN = "px-[14px] py-[7px] text-[12.5px]";

// Review and Approve, which need the cockpit and the agent whose ask this is (a card drawn without them, the static
// card in a conversation, has no buttons). Approve goes dead once its answer is sent.
function DocReviewActions({
    model,
    agent,
    approveIndex,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    approveIndex: number | null;
}) {
    const sent = useAtomValue(model.sentIdsAtom).has(askSentKey(agent) ?? "");
    return (
        <div className="flex flex-wrap items-center gap-[8px]">
            <button
                type="button"
                data-chat-drcard-review
                onClick={() => openReview(model, agent.id)}
                className={cn(PRIMARY_BTN, FOCUS_RING)}
            >
                Review
            </button>
            {approveIndex != null ? (
                <button
                    type="button"
                    data-chat-drcard-approve
                    disabled={sent}
                    onClick={() => {
                        answerAgentAsk(model, agent.id, { 0: new Set([approveIndex]) }, {});
                    }}
                    className={cn(SMALL_BTN, APPROVE_BTN, FOCUS_RING)}
                >
                    Approve
                </button>
            ) : null}
            <span data-chat-drcard-note className="ml-[4px] text-[12px] leading-[1.5] text-muted">
                Request changes from Review: each comment sits on a passage
            </span>
        </div>
    );
}

/** The Doc review card. `waiting` is the live card (the agent is asking), drawn in the dock; `static` is an agent that has
 *  exited, whose card is drawn without buttons. `question` is the ask's one question, the live `AgentAskQuestion` or an
 *  answered ask's `AskQuestionDetail`. The file shows relative to the agent's working directory when it sits under it. The
 *  buttons need `model` and `agent`; without them (or when static) the card is the text alone. Draws nothing for a question
 *  that is not a Doc review of a `.md` or `.tex` file. */
export function ChatDocReviewCard({
    question,
    agent,
    model,
    state,
}: {
    question: DocReviewQuestion;
    agent?: AgentVM;
    model?: AgentsViewModel;
    state: "waiting" | "static";
}) {
    const cwd = useAgentCwd(agent);
    const fields = docReviewFields(question, cwd);
    if (fields == null) {
        return null;
    }
    return (
        <CardShell
            kind="docreview"
            state={state}
            head="Doc review"
            icon={<FileText size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            action={
                fields.pages != null ? (
                    <span data-chat-drcard-pages className="tabular-nums">
                        Pages: {fields.pages}
                    </span>
                ) : undefined
            }
        >
            <div className="flex min-w-0 flex-col gap-[4px]">
                <div
                    data-chat-drcard-path
                    title={fields.fullPath}
                    className="break-all font-mono text-[15px] font-semibold leading-[1.45] text-primary"
                >
                    {fields.path}
                </div>
                {fields.intro.length > 0 ? (
                    <div
                        data-chat-drcard-intro
                        className="whitespace-pre-line break-words text-[12.5px] leading-[1.5] text-muted"
                    >
                        {fields.intro.join("\n")}
                    </div>
                ) : null}
            </div>
            {fields.items.length > 0 ? (
                <ul aria-label="Worth a look" className="m-0 flex list-none flex-col gap-[4px] p-0">
                    {fields.items.map((item, i) => (
                        <li
                            key={i}
                            data-chat-drcard-item
                            className="flex min-w-0 gap-[8px] text-[13px] leading-[1.5] text-secondary"
                        >
                            <span aria-hidden className="flex-none text-ink-faint">
                                –
                            </span>
                            <span className="min-w-0 break-words">
                                {item.where != null ? (
                                    <>
                                        <span className="font-medium text-primary">{item.where}:</span>{" "}
                                    </>
                                ) : null}
                                {item.what}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
            {state === "waiting" && model != null && agent != null ? (
                <DocReviewActions model={model} agent={agent} approveIndex={fields.approveIndex} />
            ) : null}
        </CardShell>
    );
}

/** The row an answered Doc review folds into, in place: `✓ Doc review · approved · <file>`, or
 *  `↺ Doc review · changes requested · 3 comments · <file>`. It reads the answer (`picked` and `typed` of the answered
 *  question), not a send record; the comments themselves stay in the review view, so the row has no detail fold. The
 *  outcome is on the row element as `data-chat-drcard-outcome`. `agent` gives the working directory the file is named
 *  against. Draws nothing for a question that is not a Doc review. */
export function ChatDocReviewDone({ question, agent }: { question: AskQuestionDetail; agent?: AgentVM }) {
    const cwd = useAgentCwd(agent);
    const row = docReviewRow(question, cwd);
    if (row == null) {
        return null;
    }
    return (
        <DoneRow
            kind="docreview"
            head={docReviewDoneLine(row)}
            mark={row.outcome === "changes" ? "↺" : undefined}
            extra={{ "data-chat-drcard-outcome": row.outcome }}
        />
    );
}
