// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The builder check as Chat draws it (docs/superpowers/specs/2026-11-12-chat-brainstorm-review-design.md, section 3): one
// card that follows the check through its stages. A builder reading and the agent taking its questions in show the
// tab's clock, a failed check shows its reason and Try again, a question only the user can answer is asked one at a
// time, and once none is open the card lists what still needs the user, with Approve and Keep talking. The agent's own
// calls and what the spec already answered fold under every stage once the file holds a check. What the card is,
// stage by stage, is chatbrainstorm.ts's `brainstormCard`; this draws it.

import * as WOS from "@/app/store/wos";
import { cn } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { ListChecks } from "lucide-react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { useCheckTimes } from "./brainstormchecktimes";
import { checkClock, checkSpan } from "./brainstormmodel";
import { approveAndOpenRun, sendBrainstorm } from "./brainstormsend";
import type { BrainstormState } from "./brainstormstore";
import { ERROR_LINE, SMALL_DOT, useAction, useAnswer } from "./brainstormui";
import { builderQuestionHead, type BuilderQuestionCard, type CheckCard, type Gist } from "./chatbrainstorm";
import { CardShell, DecisionRow, FOCUS_RING, Fold, OptionRows, PRIMARY_BTN, SMALL_BTN } from "./chatbrainstormparts";

const NO_RUN: Atom<Run | undefined> = atom(undefined as Run | undefined);
// the words field of a builder question: the card's field, on one line
const OWN_FIELD =
    "min-w-0 flex-1 rounded-[8px] border border-border bg-background px-[12px] py-[8px] text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted focus:border-edge-strong";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// the card keeps the agent's calls and what the spec answered as bare sentences: a fold line with no title is the sentence
function sentenceGists(texts: readonly string[]): Gist[] {
    return texts.map((gist, i) => ({ id: String(i), title: "", gist }));
}

// the pending check's line, and under it the check's time against how long this machine's past checks took. The clock
// block (the time, its bar) shows only once Arc's record of the check gives it a start, as the tab's does; the note under
// it says what to expect and shows before that too. Only this part follows the 1s clock, so the card's folds do not redraw
function CheckWait({
    agent,
    model,
    pending,
}: {
    agent: AgentVM;
    model: AgentsViewModel;
    pending: NonNullable<CheckCard["pending"]>;
}) {
    const record = agent.builderCheck;
    const run = useAtomValue(record?.runId ? WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", record.runId)) : NO_RUN);
    const now = useAtomValue(model.nowAtom);
    const times = useCheckTimes(record?.runId);
    const clock = checkClock(pending, checkSpan(record, run ?? null), times, now);
    return (
        <div
            aria-live="polite"
            className="flex flex-col gap-[8px] rounded-[8px] border border-edge-mid bg-surface px-[14px] py-[10px]"
        >
            <span data-chat-bscard-check-line className="text-[13.5px] font-semibold text-primary">
                {pending.text}
            </span>
            {clock.elapsed != null ? (
                <div data-chat-bscard-clock={clock.running ? "running" : "stopped"} className="flex flex-col gap-[6px]">
                    <div className="flex items-baseline gap-[12px]">
                        <span
                            className={cn(
                                "text-[13px] font-semibold tabular-nums",
                                clock.running ? "text-secondary" : "text-ink-mid"
                            )}
                        >
                            {clock.elapsed}
                        </span>
                        <div className="flex-1" />
                        {clock.times != null ? (
                            <span className="flex-none whitespace-nowrap text-[10.5px] tabular-nums text-muted">
                                {clock.times}
                            </span>
                        ) : null}
                    </div>
                    {clock.bar != null ? (
                        <div className="relative h-[6px] rounded-[3px] bg-edge-mid">
                            <div
                                className="absolute inset-y-0 left-0 rounded-[3px] bg-working"
                                style={{ width: pct(clock.bar.fill) }}
                            />
                            <div
                                className="absolute top-[-3px] h-[12px] w-[2px] rounded-[1px] bg-ink-mid"
                                style={{ left: pct(clock.bar.usual) }}
                            />
                        </div>
                    ) : null}
                </div>
            ) : null}
            <span className={cn("text-[12px] leading-[1.5]", clock.over ? "text-ink-mid" : "text-muted")}>
                {clock.note}
            </span>
        </div>
    );
}

// a check that did not finish: why, and the one press that starts it again. A retry shares the card's error line, so a
// send that fails (the agent is still working) says so under the button that sent it
function CheckFailed({ agent, reason, disabled }: { agent: AgentVM; reason: string; disabled: boolean }) {
    const act = useAction();
    return (
        <div className="flex flex-col gap-[8px]">
            <div
                data-chat-bscard-check-failed
                className="flex items-center gap-[14px] rounded-[8px] border border-error/40 bg-error/10 px-[14px] py-[10px]"
            >
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="flex items-center gap-[8px] text-[13px] font-semibold text-primary">
                        <span aria-hidden="true" className={cn(SMALL_DOT, "bg-error")} />
                        The builder check did not finish
                    </span>
                    {reason !== "" ? (
                        <span data-chat-bscard-check-reason className="text-[12.5px] leading-[1.5] text-ink-mid">
                            {reason}
                        </span>
                    ) : null}
                </div>
                <button
                    type="button"
                    data-chat-bscard-retry
                    disabled={disabled || act.busy}
                    onClick={() => void act.run(() => sendBrainstorm(agent, { kind: "check" }))}
                    className={cn(SMALL_BTN, FOCUS_RING, "font-semibold text-primary")}
                >
                    Try again
                </button>
            </div>
            {act.error ? (
                <div role="alert" className={ERROR_LINE}>
                    {act.error}
                </div>
            ) : null}
        </div>
    );
}

// the builder's open question, asked as the talk question is: its options (a pick sends its label), a field for the
// user's own words, or the agent decides. The message box would send plain words the agent reads as pushback, so the
// answer in words has its own field here. One question at a time: mounted per question (keyed on its number) so a
// half-typed answer never carries over to the next
function BuilderQuestion({ agent, q, disabled }: { agent: AgentVM; q: BuilderQuestionCard; disabled: boolean }) {
    const ans = useAnswer(agent, "builder-answer");
    const off = disabled || ans.act.busy;
    const sendDraft = () => {
        if (!off) {
            ans.sendDraft();
        }
    };
    return (
        <div data-chat-bscard-builder={q.n} className="flex flex-col gap-[12px]">
            <div className="flex flex-col gap-[4px]">
                <div className="flex items-baseline gap-[8px] text-[12px] text-muted">
                    <span className="min-w-0 truncate font-semibold text-secondary">
                        {builderQuestionHead(q.n, q.part)}
                    </span>
                    {q.total > 1 ? (
                        <span className="ml-auto flex-none tabular-nums">
                            {q.n} of {q.total}
                        </span>
                    ) : null}
                </div>
                <div className="text-[15px] font-semibold leading-[1.45] text-primary">{q.question}</div>
                {q.why ? <div className="text-[12.5px] leading-[1.5] text-muted">{q.why}</div> : null}
            </div>
            {q.options.length > 0 ? (
                <OptionRows
                    options={q.options}
                    pick={q.pick}
                    pickLabel="Agent's pick"
                    disabled={off}
                    onSend={(text) => void ans.sendText(text)}
                />
            ) : null}
            <div data-chat-bscard-own className="flex items-center gap-[8px]">
                <input
                    type="text"
                    aria-label="Answer in your own words"
                    placeholder="Or answer in your own words"
                    value={ans.draft}
                    // only the card's own state locks the field: a send in flight leaves it editable, so the focus stays
                    disabled={disabled}
                    onChange={(e) => ans.setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        // Enter sends; Enter that ends an IME composition stays with the IME
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            e.stopPropagation();
                            sendDraft();
                        }
                    }}
                    className={cn(OWN_FIELD, "disabled:opacity-50")}
                />
                <button
                    type="button"
                    disabled={off || ans.draft.trim() === ""}
                    onClick={sendDraft}
                    className={cn(PRIMARY_BTN, FOCUS_RING)}
                >
                    Send
                </button>
            </div>
            <div className="flex items-center gap-[8px]">
                <button
                    type="button"
                    data-chat-bscard-decide
                    disabled={off}
                    onClick={() => void ans.send({ kind: "builder-decide" })}
                    className={cn(SMALL_BTN, FOCUS_RING)}
                >
                    Decide for me
                </button>
            </div>
            {ans.act.error ? (
                <div role="alert" className={ERROR_LINE}>
                    {ans.act.error}
                </div>
            ) : null}
        </div>
    );
}

// Approve opens the run launcher with the spec attached (the agent hears it is approved first), and stays off with its
// reason beside it until nothing is left for the user: the tab refuses by the same rule, and a reason beats a dead button
function ReviewActions({
    agent,
    card,
    model,
    state,
}: {
    agent: AgentVM;
    card: CheckCard;
    model: AgentsViewModel;
    state: BrainstormState;
}) {
    const act = useAction();
    const waiting = card.state === "waiting";
    const off = !waiting || act.busy;
    const blocker = card.approveBlocker;
    return (
        <div className="flex flex-col gap-[8px]">
            <div className="flex flex-wrap items-center justify-end gap-x-[12px] gap-y-[8px]">
                {blocker != null ? (
                    // amber is the user's turn only: the card at work or an exited agent keeps the reason plain
                    <span
                        data-chat-bscard-approve-reason
                        className={cn(
                            "min-w-0 flex-1 basis-[200px] text-[12px] leading-[1.45]",
                            waiting ? "text-warning" : "text-secondary"
                        )}
                    >
                        {blocker}
                    </span>
                ) : null}
                <button
                    type="button"
                    data-chat-bscard-keep-talking
                    disabled={off}
                    onClick={() => void act.run(() => sendBrainstorm(agent, { kind: "keep-talking" }))}
                    className={cn(SMALL_BTN, FOCUS_RING)}
                >
                    Keep talking
                </button>
                <button
                    type="button"
                    data-chat-bscard-approve
                    disabled={off || blocker != null}
                    title={blocker ?? "Approve the design and open the run launcher"}
                    onClick={() => void act.run(() => approveAndOpenRun(model, agent, state))}
                    className={cn(PRIMARY_BTN, FOCUS_RING)}
                >
                    Approve
                </button>
            </div>
            {act.error ? (
                <div role="alert" className={ERROR_LINE}>
                    {act.error}
                </div>
            ) : null}
        </div>
    );
}

/** The builder check card: `card.stage` picks the body (the clock, the failure, the builder's question, the review), the
 *  agent's calls and the spec's answers fold under every stage, and the review ends in Approve and Keep talking. `model`
 *  carries the clock's ticking time and opens the run launcher; `state` is the brainstorm the launcher is prefilled from.
 *  An agent that has exited (`static`) keeps the card as it was, with every send off. */
export function ChatBrainstormCheck({
    agent,
    card,
    model,
    state,
}: {
    agent: AgentVM;
    card: CheckCard;
    model: AgentsViewModel;
    state: BrainstormState;
}) {
    const disabled = card.state !== "waiting";
    const calls = sentenceGists(card.calls);
    const spec = sentenceGists(card.spec);
    const review = card.stage === "review";
    return (
        <CardShell
            kind="check"
            state={card.state}
            head="Builder check"
            icon={<ListChecks size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            agent={agent}
            stage={card.stage}
        >
            {(card.stage === "reading" || card.stage === "taking-in") && card.pending != null ? (
                <CheckWait agent={agent} model={model} pending={card.pending} />
            ) : null}
            {card.stage === "failed" ? (
                <CheckFailed agent={agent} reason={card.reason ?? ""} disabled={disabled} />
            ) : null}
            {card.stage === "asking" && card.question != null ? (
                <BuilderQuestion key={card.question.n} agent={agent} q={card.question} disabled={disabled} />
            ) : null}
            {review && card.rows.length > 0 ? (
                <div className="flex flex-col gap-[8px]">
                    {card.rows.map((row) => (
                        <DecisionRow key={row.id} agent={agent} row={row} disabled={disabled} />
                    ))}
                </div>
            ) : null}
            {calls.length > 0 || spec.length > 0 || review ? (
                <div className="flex flex-col gap-[10px] border-t border-edge-mid pt-[10px]">
                    <Fold name="calls" label={`Agent's calls ${calls.length}`} items={calls} />
                    <Fold name="spec" label={`Answered by the spec ${spec.length}`} items={spec} />
                    {review ? <ReviewActions agent={agent} card={card} model={model} state={state} /> : null}
                </div>
            ) : null}
        </CardShell>
    );
}
