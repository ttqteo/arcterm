// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { ArrowUpRight, Check, FileText, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { answerHint, nextUnansweredQuestion, type AgentAskQuestion, type AgentVM } from "./agentsviewmodel";
import { activePreview, previewMode } from "./answerbarpreview";
import { DOC_REVIEW_HEADERS, parseDocReview, type DocReview, type DocReviewKind } from "./docreview";
import { openReview } from "./docreviewstore";
import { MarkdownMessage } from "./markdownmessage";

// The answer surface tracks the agent's status, mirroring the handoff (Wave-answer.dc.html: the
// cockpit passes accent = stateColor — asking → amber, else → periwinkle). So an asking agent's
// options/tabs/check read in the same "needs you" amber as its card, not a generic blue prompt.
type Accent = {
    selected: string; // selected option/chip: border + soft fill
    rec: string; // recommended option: dim border only (label stays neutral)
    pill: string; // recommended badge
    numSel: string; // selected number badge fill
    check: string; // selected checkmark
    tab: string; // active multi-question tab
    dot: string; // answered tab dot
};
const ACCENT_ASKING: Accent = {
    selected: "border-warning bg-warning/15",
    rec: "border-warning/50",
    pill: "border border-warning/40 bg-warning/10 text-warning",
    numSel: "bg-warning text-background",
    check: "text-warning",
    tab: "border-warning bg-warning/15 text-primary",
    dot: "bg-warning",
};
const ACCENT_DEFAULT: Accent = {
    selected: "border-accent bg-accent/15",
    rec: "border-accent/50",
    pill: "border border-accent/40 bg-accent/10 text-accent",
    numSel: "bg-accent text-background",
    check: "text-accent",
    tab: "border-accent bg-accent/15 text-primary",
    dot: "bg-accent",
};

// Claude Code's AskUserQuestion payload has no separate "recommended" flag — by convention it appends
// the literal "(Recommended)" marker to the option label, so this substring is the only signal. The
// handoff shows it as a separate pill, so strip the marker from the label and badge it instead.
const isRec = (label: string) => /\(recommended\)/i.test(label);
export const cleanLabel = (label: string) => label.replace(/\s*\(recommended\)\s*/i, " ").trim();

const REVIEW_ITEM_NOUN: Record<DocReviewKind, [string, string]> = {
    spec: ["decision", "decisions"],
    plan: ["finding", "findings"],
    doc: ["point", "points"],
};

// A doc-review ask in a card, in place of its question text: the document's full text belongs in the dialog, or
// for a Doc review in the review view. Review opens it through openReview; with no model (a run's child-ask card,
// whose agent is not in the roster) there is nothing to open, so the button is left out.
export function DocReviewSummary({
    model,
    agentId,
    review,
}: {
    model: AgentsViewModel | undefined;
    agentId: string;
    review: DocReview;
}) {
    const file = review.path.split(/[\\/]/).pop() ?? review.path;
    const n = review.items.length;
    const [one, many] = REVIEW_ITEM_NOUN[review.kind];
    return (
        <div className="flex items-center gap-2.5 rounded-[7px] border border-edge-mid bg-background px-2.5 py-2">
            <FileText size={15} strokeWidth={1.8} aria-hidden className="flex-none text-ink-mid" />
            <div className="min-w-0 flex-1">
                <div className="truncate text-[10.5px] tabular-nums text-muted">
                    <span className="font-bold uppercase tracking-[0.1em] text-warning">
                        {DOC_REVIEW_HEADERS[review.kind]}
                    </span>{" "}
                    · {n} {n === 1 ? one : many}
                </div>
                <div title={review.path} className="truncate text-[12px] font-semibold text-primary">
                    {file}
                </div>
            </div>
            {model != null ? (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        openReview(model, agentId);
                    }}
                    className="inline-flex h-[25px] shrink-0 cursor-pointer items-center gap-[5px] rounded-[6px] border border-accent/45 bg-transparent px-2.5 text-[11.5px] font-semibold text-accent-soft hover:bg-accent/10"
                >
                    Review
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            ) : null}
        </div>
    );
}

function QuestionGroup({
    question,
    accent,
    numbered,
    hideQuestion,
    summary,
    selections,
    onClickOption,
    text,
    onText,
    onTextSubmit,
}: {
    question: AgentAskQuestion;
    accent: Accent;
    numbered?: boolean;
    hideQuestion?: boolean;
    summary?: ReactNode;
    selections: Set<number>;
    onClickOption: (oi: number) => void;
    text?: string;
    onText?: (value: string) => void;
    onTextSubmit?: () => void;
}) {
    const options = question.options ?? [];
    // rich asks (any option has a description) read better as stacked rows; bare label-only asks
    // stay as compact wrapping chips. Number badges (1-9) map to the keyboard shortcut; the parent
    // renders only the keyboard-target question, so badges always belong to the rendered group.
    const stacked = options.some((o) => o.description);
    // preview mode (pi): a single-select question with preview markdown renders side-by-side, the
    // panel showing the hovered/focused option (rpiv's rule: single-select only).
    const withPreview = previewMode(question);
    const [focusIndex, setFocusIndex] = useState(0);
    const preview = withPreview ? activePreview(question, focusIndex) : undefined;
    const optionList = (
        <div className="flex flex-col gap-1.5">
            {options.map((opt, oi) => {
                const isSelected = selections.has(oi);
                const isRecommended = isRec(opt.label);
                const showNum = numbered && oi < 9;
                return (
                    <button
                        key={oi}
                        type="button"
                        onClick={() => onClickOption(oi)}
                        onMouseEnter={() => setFocusIndex(oi)}
                        onFocus={() => setFocusIndex(oi)}
                        className={cn(
                            "flex w-full cursor-pointer items-start gap-2.5 rounded border px-3 py-2 text-left",
                            isSelected
                                ? accent.selected
                                : isRecommended
                                  ? accent.rec
                                  : "border-border hover:bg-white/[0.04]"
                        )}
                    >
                        {showNum ? (
                            <span
                                className={cn(
                                    "mt-px inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] font-mono text-[10.5px]",
                                    isSelected ? accent.numSel : "bg-black/30 text-secondary"
                                )}
                            >
                                {oi + 1}
                            </span>
                        ) : null}
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                                <span className="text-[12.5px] font-semibold text-primary">
                                    {cleanLabel(opt.label)}
                                </span>
                                {isRecommended ? (
                                    <span
                                        className={cn(
                                            "shrink-0 rounded-[5px] px-1.5 text-[10.5px] font-semibold",
                                            accent.pill
                                        )}
                                    >
                                        recommended
                                    </span>
                                ) : null}
                            </span>
                            {opt.description ? (
                                <span
                                    className={cn(
                                        "mt-0.5 block text-[11px] leading-[1.45]",
                                        isSelected ? "text-primary/75" : "text-secondary"
                                    )}
                                >
                                    {opt.description}
                                </span>
                            ) : null}
                        </span>
                        {isSelected ? (
                            <span className={cn("mt-0.5 flex shrink-0 text-[13px]", accent.check)}>
                                {question.multiSelect ? <Check size={13} aria-hidden /> : "●"}
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
    return (
        <div className={hideQuestion ? "" : "mt-3"}>
            {hideQuestion ? null : summary != null ? (
                summary
            ) : (
                <>
                    {question.header ? (
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                            {question.header}
                        </div>
                    ) : null}
                    <div className="whitespace-pre-line text-[13px] font-semibold text-primary">
                        {question.question}
                    </div>
                </>
            )}
            {options.length === 0 ? null : withPreview ? (
                <div className="mt-2.5 flex gap-3">
                    <div className="min-w-0 flex-1">{optionList}</div>
                    <div className="hidden w-[min(46%,340px)] shrink-0 rounded border border-border bg-black/20 p-3 md:block">
                        {preview ? (
                            <MarkdownMessage text={preview} className="text-[11.5px] leading-[1.5]" />
                        ) : (
                            <div className="text-[11px] text-muted">No preview</div>
                        )}
                    </div>
                </div>
            ) : stacked ? (
                <div className="mt-2.5">{optionList}</div>
            ) : (
                <div className="mt-2.5 flex flex-wrap gap-2">
                    {options.map((opt, oi) => {
                        const isSelected = selections.has(oi);
                        const isRecommended = isRec(opt.label);
                        const showNum = numbered && oi < 9;
                        return (
                            <button
                                key={oi}
                                type="button"
                                onClick={() => onClickOption(oi)}
                                className={cn(
                                    "flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-1 text-[12px]",
                                    isSelected
                                        ? cn(accent.selected, "font-semibold text-primary")
                                        : isRecommended
                                          ? cn(accent.rec, "font-semibold text-primary")
                                          : "border-border text-primary hover:bg-white/[0.04]"
                                )}
                            >
                                {showNum ? (
                                    <span
                                        className={cn(
                                            "inline-flex h-[16px] w-[16px] items-center justify-center rounded-[4px] font-mono text-[10.5px]",
                                            isSelected ? accent.numSel : "bg-black/30 text-secondary"
                                        )}
                                    >
                                        {oi + 1}
                                    </span>
                                ) : null}
                                <span>{cleanLabel(opt.label)}</span>
                            </button>
                        );
                    })}
                </div>
            )}
            {onText ? (
                <input
                    type="text"
                    value={text ?? ""}
                    onChange={(e) => onText(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                        // the surface's Enter binding is off while this field has focus, so the field sends its own answer
                        if (
                            e.key !== "Enter" ||
                            e.shiftKey ||
                            e.nativeEvent.isComposing ||
                            (text ?? "").trim() === ""
                        ) {
                            return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        onTextSubmit?.();
                    }}
                    placeholder="or type your own answer…"
                    className={cn(
                        "mt-2 w-full rounded border bg-black/20 px-3 py-2 text-[12.5px] text-primary placeholder:text-muted focus:outline-none",
                        (text ?? "").trim() !== "" ? accent.selected : "border-border focus:border-accent/60"
                    )}
                />
            ) : null}
        </div>
    );
}

// Answer surface for an asking agent. Selection state is owned by the parent (so the keyboard triage
// keymap and mouse clicks write the same place). Mouse: single-select submits on click, multi-select
// waits for the parent's submit (Enter). When `sent`, shows a confirmation in place. `model` lets a
// doc-review summary open its review; a caller whose agent is not in the roster leaves it out.
export function AnswerBar({
    model,
    agent,
    selections,
    texts,
    sent,
    numbered,
    hideQuestion,
    activeQuestion,
    onToggle,
    onText,
    onSubmit,
    onSelectQuestion,
    onDismiss,
    showHint = true,
    className,
}: {
    model?: AgentsViewModel;
    agent: AgentVM;
    selections: Record<number, Set<number>>;
    texts?: Record<number, string>;
    sent?: boolean;
    numbered?: boolean;
    hideQuestion?: boolean;
    activeQuestion?: number;
    onToggle: (qi: number, oi: number) => void;
    onText?: (qi: number, value: string) => void;
    onSubmit: () => void;
    onSelectQuestion?: (qi: number) => void;
    onDismiss?: () => void;
    showHint?: boolean;
    className?: string;
}) {
    const questions = agent.ask?.questions ?? [];
    const accent = agent.state === "asking" ? ACCENT_ASKING : ACCENT_DEFAULT;
    if (questions.length === 0) {
        return null;
    }
    // the question here is a duplicate for a caller that already rendered it above (hideQuestion) — a
    // caller that owns the question is also the one place left to say why it came back.
    const noteLine =
        !hideQuestion && agent.ask?.note ? (
            <div className="mb-1.5 text-[11px] text-warning">{agent.ask.note}</div>
        ) : null;
    // dismiss control: clears the pending ask (pi: cancels the blocked ask tool).
    // Only rendered when the parent wires it (agent row + channel rows).
    const dismissControl = onDismiss ? (
        <div className="mb-1 flex justify-end">
            <button
                type="button"
                onClick={onDismiss}
                title="Dismiss this question (pi: cancels the ask; claude: closes the panel copy)"
                className="flex cursor-pointer rounded-sm px-1.5 py-0.5 text-muted hover:bg-white/[0.04] hover:text-secondary"
            >
                <X size={12} aria-hidden />
            </button>
        </div>
    ) : null;
    if (sent) {
        const chosen = questions
            .flatMap((q, qi) => {
                const t = (texts?.[qi] ?? "").trim();
                if (t) {
                    return [t];
                }
                return Array.from(selections[qi] ?? []).map((oi) => cleanLabel(q.options?.[oi]?.label ?? ""));
            })
            .filter(Boolean);
        return (
            <div className={cn("text-[12px] text-secondary", className)}>
                <Check size={12} aria-hidden className={cn("inline align-[-1px]", accent.check)} /> Answered
                {chosen.length ? `: ${chosen.join(", ")}` : ""}
            </div>
        );
    }
    // after question qi is answered: go to the next unanswered question, or send once none is left
    const advance = (qi: number) => {
        const next = nextUnansweredQuestion(questions, selections, texts ?? {}, qi);
        if (next === -1) {
            onSubmit();
        } else {
            onSelectQuestion?.(next);
        }
    };

    const review = hideQuestion ? null : parseDocReview(agent.ask);
    const renderGroup = (qi: number) => (
        <QuestionGroup
            question={questions[qi]}
            accent={accent}
            numbered={numbered}
            hideQuestion={hideQuestion}
            summary={review ? <DocReviewSummary model={model} agentId={agent.id} review={review} /> : undefined}
            selections={selections[qi] ?? new Set()}
            text={texts?.[qi]}
            onText={onText ? (value: string) => onText(qi, value) : undefined}
            onTextSubmit={() => advance(qi)}
            onClickOption={(oi) => {
                onToggle(qi, oi);
                if (questions[qi].multiSelect) {
                    return;
                }
                advance(qi);
            }}
        />
    );

    // one ask renders inline; multiple asks become tabs so they don't stack into a tall wall
    if (questions.length === 1) {
        const hint = answerHint(questions, selections, !!numbered, texts ?? {});
        return (
            <div className={className}>
                {dismissControl}
                {noteLine}
                {renderGroup(0)}
                {showHint && hint ? <div className="mt-2 text-[11px] text-secondary">{hint}</div> : null}
            </div>
        );
    }

    const idx = Math.max(0, Math.min(activeQuestion ?? 0, questions.length - 1));
    const hint = answerHint(questions, selections, !!numbered, texts ?? {});
    return (
        <div className={className}>
            {dismissControl}
            {noteLine}
            <div className="flex flex-wrap gap-1.5">
                {questions.map((q, qi) => {
                    const answered = (selections[qi]?.size ?? 0) > 0 || (texts?.[qi] ?? "").trim() !== "";
                    const active = qi === idx;
                    return (
                        <button
                            key={qi}
                            type="button"
                            onClick={() => onSelectQuestion?.(qi)}
                            className={cn(
                                "flex cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px]",
                                active ? accent.tab : "border-border text-secondary hover:bg-white/[0.04]"
                            )}
                        >
                            <span className={cn("h-1.5 w-1.5 rounded-full", answered ? accent.dot : "bg-muted/40")} />
                            {q.header || `Q${qi + 1}`}
                        </button>
                    );
                })}
            </div>
            {renderGroup(idx)}
            {showHint && hint ? <div className="mt-2 text-[11px] text-secondary">{hint}</div> : null}
        </div>
    );
}
