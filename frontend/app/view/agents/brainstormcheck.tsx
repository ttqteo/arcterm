// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The builder check: the main area asks the talk question, then the builder's questions, then reviews what the
// check changed; the rail beside it says what the builder asked, and Approve sits under the main area.

import { cn } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import {
    approveBlocker,
    checkAsk,
    checkMain,
    checkUnder,
    lineBox,
    partTitle,
    runLine,
    type AskModel,
    type BrainstormFile,
    type BrainstormQuestion,
    type TrackSegment,
} from "./brainstormmodel";
import { AnsweredRail, CheckReview, ReviewHints } from "./brainstormreview";
import { approveAndOpenRun, openRunLauncher, sendBrainstorm } from "./brainstormsend";
import { openBrainstormDesign, setReviewCursor, type BrainstormState } from "./brainstormstore";
import {
    AnswerBox,
    CHIP,
    DesignButton,
    DOT,
    ERROR_LINE,
    JudgingMain,
    LineBar,
    LINK,
    MainBody,
    QuestionAnswers,
    QuestionMain,
    SECTION_HEAD,
    SMALL_DOT,
    StaleBanner,
    Toolbar,
    Track,
    useAction,
    useAnswer,
    WORKING_TITLE,
    WorkingMain,
} from "./brainstormui";
import { SWAP_BTN, SWAP_PRIMARY_BTN } from "./swapbar";

type QueueState = AskModel["queue"][number]["state"];

const QUEUE_TRACK: Record<QueueState, TrackSegment> = { answered: "done", now: "now", waiting: "ahead" };
const QUEUE_DOT: Record<QueueState, string> = {
    now: "bg-warning",
    waiting: "border-[1.5px] border-ink-faint",
    answered: "bg-success",
};
const QUEUE_TEXT: Record<QueueState, string> = {
    now: "text-primary",
    waiting: "text-ink-mid",
    answered: "text-muted",
};

export function Check({
    model,
    agent,
    s,
    f,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
}) {
    const linePending = s.sent != null;
    const main = checkMain(f, s.designOpen, linePending);
    // the review opened over a question or the working note: the way back to it
    const under = checkUnder(f, s.designOpen, linePending);
    const openDesign = () => openBrainstormDesign(agent.id, true);
    const goTo = (id: string) => {
        setReviewCursor(agent.id, id);
        openDesign();
    };
    return (
        <>
            <Toolbar topic={s.topic} f={f} progress={false} />
            <StaleBanner s={s} />
            <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col bg-background">
                    {under !== "review" ? (
                        <div className="flex flex-none items-center border-b border-border px-[22px] py-[8px]">
                            <button
                                type="button"
                                data-brainstorm-back
                                onClick={() => openBrainstormDesign(agent.id, false)}
                                className={cn(
                                    CHIP,
                                    "flex items-center gap-[8px]",
                                    under !== "working" && "border-warning/45 bg-warning/12"
                                )}
                            >
                                <span className={cn(SMALL_DOT, under === "working" ? "bg-success" : "bg-warning")} />
                                {under === "working" ? "Back to what the agent is writing" : "Back to the question"}
                            </button>
                        </div>
                    ) : null}
                    {main === "question" ? (
                        <QuestionMain agent={agent} s={s} f={f} goTo={goTo} openDesign={openDesign} skip={false} />
                    ) : main === "builder" ? (
                        <BuilderAsk agent={agent} f={f} goTo={goTo} openDesign={openDesign} />
                    ) : main === "judging" ? (
                        <JudgingMain agent={agent} f={f} goTo={goTo} openDesign={openDesign} skip={false} />
                    ) : main === "working" ? (
                        <WorkingMain f={f} openDesign={openDesign} />
                    ) : (
                        <CheckReview model={model} agent={agent} s={s} f={f} />
                    )}
                    {main === "review" ? <LineBar agent={agent} box={lineBox(f)} /> : null}
                    <ApproveBar model={model} agent={agent} s={s} f={f} />
                </div>
                {main === "review" ? <AnsweredRail f={f} agent={agent} /> : <AskRail f={f} goTo={goTo} />}
            </div>
            {main === "review" ? <ReviewHints /> : null}
        </>
    );
}

// the builder's open question, asked as the talk question is: its answers, a box for your own, or the agent decides
function BuilderAsk({
    agent,
    f,
    goTo,
    openDesign,
}: {
    agent: AgentVM;
    f: BrainstormFile;
    goTo: (id: string) => void;
    openDesign: () => void;
}) {
    const ask = checkAsk(f);
    const ans = useAnswer(agent, "builder-answer");
    const open = ask.open!;
    // drawn with the talk question's answers, which read a question's options
    const asked: BrainstormQuestion = { n: ask.index, text: open.q, part: open.part ?? "", options: open.options };
    return (
        <div data-brainstorm-builder-question className="flex min-h-0 flex-1 flex-col">
            <Track segments={ask.queue.map((y) => QUEUE_TRACK[y.state])} />
            <MainBody>
                <div className="flex flex-col gap-[14px]">
                    <span
                        data-brainstorm-builder-head
                        className="flex items-center gap-[10px] text-[13px] text-warning"
                    >
                        <span className="font-mono font-semibold">
                            Builder {ask.index} of {ask.total}
                        </span>
                        {open.part ? (
                            <>
                                <span className="text-muted">·</span>
                                <span>
                                    for{" "}
                                    <button
                                        type="button"
                                        onClick={() => goTo(open.part!)}
                                        className="cursor-pointer border-0 bg-transparent p-0 text-warning hover:underline"
                                    >
                                        {partTitle(f, open.part)}
                                    </button>
                                </span>
                            </>
                        ) : null}
                    </span>
                    <h1 className="m-0 whitespace-pre-line text-[30px] font-bold leading-[1.3] text-primary">
                        {open.q}
                    </h1>
                    {open.why ? (
                        <p data-brainstorm-why className="m-0 text-[16px] leading-[1.6] text-ink-mid">
                            {open.why}
                        </p>
                    ) : null}
                </div>
                <QuestionAnswers key={ask.index} q={asked} ans={ans} compact={false} />
                <AnswerBox ans={ans} options={open.options != null} />
                <div className="flex flex-col gap-[10px]">
                    <div className="flex items-center gap-[10px]">
                        <button
                            type="button"
                            data-brainstorm-builder-decide
                            disabled={ans.act.busy}
                            onClick={() => void ans.send({ kind: "builder-decide" })}
                            className={CHIP}
                        >
                            Let the agent decide
                        </button>
                        <div className="flex-1" />
                        <DesignButton f={f} onClick={openDesign} />
                    </div>
                    {ans.act.error != null ? <span className={ERROR_LINE}>{ans.act.error}</span> : null}
                </div>
            </MainBody>
        </div>
    );
}

// what the builder asked: the questions only you can answer, the calls the agent made by part, and what was
// already in the design
function AskRail({ f, goTo }: { f: BrainstormFile; goTo: (id: string) => void }) {
    const ask = checkAsk(f);
    return (
        <aside
            data-brainstorm-check-rail
            aria-label="The builder check"
            className="flex w-[460px] flex-none flex-col gap-[20px] overflow-y-auto border-l border-border bg-surface px-[24px] py-[22px] *:flex-none"
        >
            <div className="flex flex-col gap-[8px]">
                <h2 className="m-0 text-[15px] font-semibold text-primary">A builder read the design</h2>
                <p className="m-0 text-[13px] leading-[1.5] text-ink-mid">
                    A fresh agent checked whether it could plan from this without coming back to you. It had{" "}
                    {ask.questions} questions.
                </p>
            </div>
            {ask.total > 0 ? (
                <section aria-label="For you" className="flex flex-col">
                    <RailHead title={`For you · ${ask.total}`} caption="only you can answer" />
                    {ask.queue.map((y, i) => (
                        <div
                            key={i}
                            data-brainstorm-queue={y.state}
                            className={cn(
                                "flex items-start gap-[10px] rounded-[7px] px-[10px] py-[8px]",
                                y.state === "now" && "bg-warning/12"
                            )}
                        >
                            <span className={cn(DOT, "mt-[6px] box-border", QUEUE_DOT[y.state])} />
                            <span className={cn("text-[13px] leading-[1.45]", QUEUE_TEXT[y.state])}>{y.label}</span>
                        </div>
                    ))}
                </section>
            ) : null}
            {ask.calls > 0 ? (
                <section aria-label="The agent decided" className="flex flex-col">
                    <RailHead title={`The agent decided · ${ask.calls}`} caption="you review them with the changes" />
                    {ask.callGroups.map((g) => (
                        <div
                            key={g.part ?? ""}
                            data-brainstorm-call-group={g.part ?? ""}
                            className="flex flex-col gap-[5px] border-t border-edge-faint py-[9px]"
                        >
                            {g.part != null ? (
                                <button
                                    type="button"
                                    onClick={() => goTo(g.part!)}
                                    className={cn(
                                        LINK,
                                        "self-start border-0 bg-transparent p-0 text-left text-[12px] font-semibold"
                                    )}
                                >
                                    {g.title}
                                </button>
                            ) : (
                                <span className="text-[12px] font-semibold text-ink-mid">{g.title}</span>
                            )}
                            {g.calls.map((c, i) => (
                                <span key={i} className="text-[12.5px] leading-[1.5] text-ink-mid">
                                    {c}
                                </span>
                            ))}
                        </div>
                    ))}
                </section>
            ) : null}
            {ask.already.length === 0 ? (
                <span data-brainstorm-already className="text-[12px] text-muted">
                    Nothing the builder asked was already in the design.
                </span>
            ) : (
                <section data-brainstorm-already aria-label="Already in the design" className="flex flex-col">
                    <RailHead title={`Already in the design · ${ask.already.length}`} />
                    {ask.already.map((a, i) => (
                        <div
                            key={i}
                            className="border-t border-edge-faint py-[8px] text-[12.5px] leading-[1.5] text-ink-mid"
                        >
                            {a}
                        </div>
                    ))}
                </section>
            )}
        </aside>
    );
}

function RailHead({ title, caption }: { title: string; caption?: string }) {
    return (
        <div className="flex items-baseline gap-[8px] pb-[6px]">
            <h3 className={SECTION_HEAD}>{title}</h3>
            {caption ? <span className="text-[12px] text-muted">{caption}</span> : null}
        </div>
    );
}

function ApproveBar({
    model,
    agent,
    s,
    f,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
}) {
    const act = useAction();
    const working = f.working != null;
    const blocker = approveBlocker(f);
    // @container: the title column (240 at least), the blocker's reason and the two buttons need ~700px in one line, so
    // a narrower bar (the builder rail takes 460px of the pane) stacks them: the run, the reason, the buttons at the end
    return (
        <div
            data-brainstorm-approve-bar
            className="@container flex-none border-t border-border bg-surface px-[22px] py-[12px]"
        >
            <div className="flex items-center gap-[14px] @max-[700px]:flex-col @max-[700px]:items-stretch @max-[700px]:gap-[10px]">
                <div className="flex min-w-[240px] flex-1 flex-col gap-[3px] @max-[700px]:min-w-0 @max-[700px]:flex-none">
                    <span className="whitespace-nowrap text-[13px] font-semibold text-primary">
                        Approve and start an orchestrator run
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted">
                        {runLine(projectOf(agent))} ·{" "}
                        <button type="button" onClick={() => openRunLauncher(model, agent, s)} className={LINK}>
                            Change
                        </button>
                    </span>
                    {act.error != null ? <span className={ERROR_LINE}>{act.error}</span> : null}
                </div>
                {blocker != null ? (
                    <span
                        data-brainstorm-approve-reason
                        className="min-w-0 text-right text-[12px] leading-[1.45] text-warning @max-[700px]:text-left"
                    >
                        {blocker}
                    </span>
                ) : null}
                <div className="flex flex-none items-center gap-[14px] @max-[700px]:flex-wrap @max-[700px]:justify-end @max-[700px]:gap-[10px]">
                    <button
                        type="button"
                        disabled={working || act.busy}
                        title={working ? WORKING_TITLE : undefined}
                        onClick={() => void act.run(() => sendBrainstorm(agent, { kind: "keep-talking" }))}
                        className={cn(SWAP_BTN, "disabled:cursor-default disabled:opacity-50")}
                    >
                        Keep talking
                    </button>
                    <button
                        type="button"
                        data-brainstorm-approve
                        disabled={blocker != null || act.busy}
                        title={blocker ?? undefined}
                        onClick={() => void act.run(() => approveAndOpenRun(model, agent, s))}
                        className={SWAP_PRIMARY_BTN}
                    >
                        Approve and start run
                    </button>
                </div>
            </div>
        </div>
    );
}
