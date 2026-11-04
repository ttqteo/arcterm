// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pieces every brainstorm view shares: the class constants, the toolbar, the question and its answers, the
// working view and the was/now diff.

import { foldReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AgentVM } from "./agentsviewmodel";
import {
    answerLine,
    designLabel,
    hasProsCons,
    judgeWork,
    optionLetter,
    partTitle,
    phaseSteps,
    pickedLine,
    plural,
    progressView,
    questionBoards,
    questionTrack,
    sendPickedLabel,
    sentenceDiff,
    togglePick,
    type AnswerOption,
    type Approach,
    type BrainstormAction,
    type BrainstormFile,
    type BrainstormPart,
    type BrainstormQuestion,
    type EditLock,
    type JudgeWork,
    type LineBox,
    type PartAnswer,
    type PartState,
    type TrackSegment,
} from "./brainstormmodel";
import { optionHoverAtom } from "./brainstormrail";
import { sendBrainstorm } from "./brainstormsend";
import type { BrainstormState } from "./brainstormstore";

export const WORKING_TITLE = "The agent is writing; this opens when it asks again";
const CHECK_LOCK_TITLE = "Locked while the builder check runs; this opens when the agent has taken in its questions";

// what a locked control says on hover
export function lockTitle(lock: EditLock): string | undefined {
    return lock === "working" ? WORKING_TITLE : lock === "check" ? CHECK_LOCK_TITLE : undefined;
}

export const DOT = "h-[7px] w-[7px] flex-none rounded-full";
export const DOT_YOURS = cn(DOT, "bg-success");
export const DOT_GUESS = cn(DOT, "border-[1.5px] border-dashed border-ink-mid");
export const DOT_OPEN = cn(DOT, "border-[1.5px] border-ink-faint");
export const DOT_ASKED = cn(DOT, "bg-warning");
export const SMALL_DOT = "h-[6px] w-[6px] flex-none rounded-full";
export const PART_BTN =
    "cursor-pointer rounded-[7px] border border-edge-mid bg-surface-raised px-[10px] py-[4px] text-[12px] font-semibold text-primary hover:border-edge-strong disabled:cursor-default disabled:opacity-50";
export const CHIP =
    "cursor-pointer rounded-[6px] border border-edge-mid bg-transparent px-[12px] py-[5px] text-[12px] text-primary hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
export const FIELD =
    "resize-none rounded-[8px] border border-border bg-background px-[12px] py-[9px] text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted focus:border-warning/60";
export const LINK = "cursor-pointer text-accent-soft hover:underline";
const PRIMARY_BTN =
    "flex-none cursor-pointer rounded-[7px] bg-accent px-[14px] py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
export const ERROR_LINE = "text-[12px] text-error";
export const SECTION_HEAD = "m-0 text-[13px] font-semibold text-secondary";
// an answer row, and the approach rows the judge weighs, which answer the same way; on a question that takes more
// than one option, a tick box sits before the row's button
const OPTION_ROW =
    "overflow-hidden rounded-[10px] border has-[button:disabled]:opacity-50 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-accent";
const OPTION_ROW_PLAIN = "border-edge-mid bg-surface has-[button:enabled:hover]:border-edge-strong";
const OPTION_BTN =
    "flex w-full cursor-pointer items-center border-0 bg-transparent text-left outline-none disabled:cursor-default";
const OPTION_LETTER =
    "flex flex-none items-center justify-center rounded-[6px] border border-edge-strong font-mono font-semibold text-secondary";
const SEGMENT = "box-border h-[6px] w-[22px] flex-none rounded-[3px]";
const SEGMENT_STATE: Record<PartState, string> = {
    yours: "bg-success",
    guess: "border-[1.5px] border-dashed border-ink-mid",
    asked: "bg-warning",
    open: "border-[1.5px] border-edge-strong",
};
const TRACK_STATE: Record<TrackSegment, string> = {
    done: "bg-success",
    now: "bg-warning",
    ahead: "bg-edge-mid",
};
const STATE_NAME: Record<PartState, string> = {
    yours: "yours",
    guess: "the agent’s guess",
    asked: "asked now",
    open: "open",
};

export function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// one per control group, so a failure shows under the control that sent it
export function useAction() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = async (fn: () => Promise<void>): Promise<boolean> => {
        setBusy(true);
        setError(null);
        try {
            await fn();
            return true;
        } catch (e) {
            setError(errText(e));
            return false;
        } finally {
            setBusy(false);
        }
    };
    return { busy, error, run };
}

// Enter sends, Shift+Enter is a newline, and Enter that ends an IME composition stays with the IME
export function onEnter(e: KeyboardEvent<HTMLTextAreaElement>, send: () => void): void {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) {
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    send();
}

// progress false leaves out the parts' segments, which only the talk view draws
export function Toolbar({
    topic,
    f,
    progress = true,
    merged = false,
}: {
    topic: string;
    f?: BrainstormFile;
    progress?: boolean;
    merged?: boolean;
}) {
    return (
        <div className="flex flex-none items-center gap-[14px] border-b border-edge-faint bg-surface px-[22px] py-[8px]">
            <span className="min-w-0 truncate text-[12px] font-semibold text-secondary">{topic}</span>
            <div className="flex-1" />
            {f != null ? (
                <>
                    <Phases f={f} merged={merged} />
                    {progress ? (
                        <>
                            <div className="h-[16px] w-px flex-none bg-border" />
                            <Progress f={f} />
                        </>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}

function Phases({ f, merged }: { f: BrainstormFile; merged: boolean }) {
    return (
        <ol
            data-brainstorm-phase
            aria-label="Where the brainstorm is"
            className="m-0 flex flex-none list-none items-center gap-[8px] p-0 text-[12px]"
        >
            {phaseSteps(f, merged).map((s, i) => (
                <Fragment key={s.phase}>
                    {i > 0 ? (
                        <li aria-hidden="true" className="flex text-ink-faint">
                            <svg
                                width="10"
                                height="10"
                                viewBox="0 0 10 10"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                            >
                                <path d="M3.5 2l3 3-3 3" />
                            </svg>
                        </li>
                    ) : null}
                    <li
                        aria-current={s.status === "current" ? "step" : undefined}
                        className={cn(
                            "flex items-center gap-[6px]",
                            s.status === "current" && "font-semibold text-primary",
                            s.status === "done" && "text-ink-mid",
                            s.status === "todo" && "text-muted"
                        )}
                    >
                        {s.status === "current" ? <span className={cn(SMALL_DOT, "bg-accent")} /> : null}
                        {s.status === "done" ? (
                            <svg
                                width="11"
                                height="11"
                                viewBox="0 0 12 12"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                className="text-success"
                            >
                                <path d="M2.5 6.5l2.5 2.5 4.5-6" />
                            </svg>
                        ) : null}
                        {s.label}
                    </li>
                </Fragment>
            ))}
        </ol>
    );
}

function Progress({ f }: { f: BrainstormFile }) {
    const p = progressView(f);
    return (
        <div data-brainstorm-progress className="flex flex-none items-center gap-[8px]">
            <div className="flex gap-[3px]">
                {p.segments.map((s) => (
                    <span
                        key={s.id}
                        aria-hidden="true"
                        data-state={s.state}
                        title={`${s.title}: ${STATE_NAME[s.state]}`}
                        className={cn(SEGMENT, SEGMENT_STATE[s.state])}
                    />
                ))}
            </div>
            <span className="text-[11.5px] text-ink-mid">
                <span className="font-semibold text-primary">{p.lead}</span> {p.rest}
            </span>
        </div>
    );
}

// the last good contents stay on screen; this says they may be behind the file
export function StaleBanner({ s }: { s: BrainstormState }) {
    if (s.error == null) {
        return null;
    }
    return (
        <div
            data-brainstorm-stale
            className="flex flex-none items-center gap-[8px] border-b border-edge-faint bg-surface px-[22px] py-[6px] text-[12px] text-ink-mid"
        >
            <span className={cn(SMALL_DOT, "bg-error")} />
            <span className="min-w-0 truncate" title={`${s.error}\n${s.path}`}>
                Arc could not read the latest brainstorm.json; this is the last version it read. {s.error}
            </span>
        </div>
    );
}

// one segment per question answered, the one asked now, and one per question still to come
export function Track({ segments }: { segments: TrackSegment[] }) {
    return (
        <div data-brainstorm-track aria-hidden="true" className="flex flex-none gap-[4px] px-[36px] pt-[14px]">
            {segments.map((t, i) => (
                <span key={i} data-state={t} className={cn("h-[4px] flex-1 rounded-[2px]", TRACK_STATE[t])} />
            ))}
        </div>
    );
}

// a third of the way down while it fits, where the eye lands rather than mid-pane; scrolled from its top once it does
// not, when the spacers have nothing left to take
export function MainBody({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[7%] py-[24px]">
            <div aria-hidden="true" className="flex-[1]" />
            <div className="flex flex-none flex-col gap-[26px]">{children}</div>
            <div aria-hidden="true" className="flex-[2]" />
        </div>
    );
}

export function DesignButton({ f, onClick }: { f: BrainstormFile; onClick: () => void }) {
    return (
        <button type="button" data-brainstorm-design-btn onClick={onClick} className={CHIP}>
            {designLabel(f)}
        </button>
    );
}

// the answer controls a question shares: what is typed, and the one send for it and for a picked option, both sent
// as kind
export function useAnswer(agent: AgentVM, kind: "answer" | "builder-answer" = "answer") {
    const [draft, setDraft] = useState("");
    const act = useAction();
    const send = async (action: BrainstormAction) => {
        if ((await act.run(() => sendBrainstorm(agent, action))) && action.kind === kind) {
            setDraft("");
        }
    };
    const sendText = (text: string) => send({ kind, text });
    const sendDraft = () => {
        if (draft.trim() !== "" && !act.busy) {
            void sendText(draft);
        }
    };
    return { draft, setDraft, act, send, sendText, sendDraft };
}

export type Answer = ReturnType<typeof useAnswer>;

// the read over the answers, with the one toggle for every answer's pros and cons, shown until hidden (folded until
// shown when foldReasons: the question's boards sit in the rail, so the column stays short). On a question the judge
// weighed, the read and pick are the judge's; the judge's work goes under the answers. With an agentId a row is tied to
// its board in the rail (optionHoverAtom)
export function QuestionAnswers({
    q,
    ans,
    compact,
    agentId,
    foldReasons = false,
}: {
    q: BrainstormQuestion;
    ans: Answer;
    compact: boolean;
    agentId?: string;
    foldReasons?: boolean;
}) {
    // null until the toggle is used, so the boards arriving after the question still fold what the user left alone
    const [toggled, setToggled] = useState<boolean | null>(null);
    if (q.options == null) {
        return null;
    }
    const shown = toggled ?? !foldReasons;
    const reasons = hasProsCons(q);
    const work = judgeWork(q);
    const who = work?.judged ? "Judge’s" : "Agent’s";
    const options = (
        <Options
            options={q.options}
            ans={ans}
            compact={compact}
            reasons={reasons && shown}
            pickLabel={`${who} pick`}
            multi={q.multi === true}
            agentId={agentId}
        />
    );
    if (!q.read && !reasons && work == null) {
        return options;
    }
    const lineText = compact ? "text-[12.5px] leading-[1.5]" : "text-[15px] leading-[1.55]";
    return (
        <div className={cn("flex flex-col", compact ? "gap-[8px]" : "gap-[12px]")}>
            {q.read || reasons ? (
                <div className="flex items-baseline gap-[12px]">
                    <span data-brainstorm-read className={cn("min-w-0 flex-1 text-secondary", lineText)}>
                        {q.read ? (
                            <>
                                <span className="font-semibold text-accent-soft">{who} read: </span>
                                {q.read}
                            </>
                        ) : null}
                    </span>
                    {reasons ? (
                        <button
                            type="button"
                            data-brainstorm-proscons-toggle
                            aria-expanded={shown}
                            onClick={() => setToggled(!shown)}
                            className={cn(CHIP, "flex-none")}
                        >
                            {shown ? "Hide pros and cons" : "Show pros and cons"}
                        </button>
                    ) : null}
                </div>
            ) : null}
            {options}
            {work != null ? <JudgeWorkLine work={work} compact={compact} lineText={lineText} /> : null}
        </div>
    );
}

// how the judge got to its options, or why it did not; what it dropped stays behind a toggle, closed until opened
function JudgeWorkLine({ work, compact, lineText }: { work: JudgeWork; compact: boolean; lineText: string }) {
    const [open, setOpen] = useState(false);
    const n = work.dropped.length;
    return (
        <div className={cn("flex flex-col", compact ? "mt-[8px] gap-[6px]" : "mt-[14px] gap-[10px]")}>
            <div className="flex items-baseline gap-[12px]">
                <span data-brainstorm-judge-work className={cn("min-w-0 flex-1 text-secondary", lineText)}>
                    <span className="font-semibold text-accent-soft">Judge’s work: </span>
                    {work.line}
                </span>
                {n > 0 ? (
                    <button
                        type="button"
                        data-brainstorm-judge-dropped-toggle
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                        className={cn(CHIP, "flex-none")}
                    >
                        {open ? `Hide the ${n} dropped` : `Show the ${n} dropped`}
                    </button>
                ) : null}
            </div>
            {open && n > 0 ? (
                <ul
                    data-brainstorm-judge-dropped
                    aria-label="Dropped by the judge"
                    className="m-0 flex list-none flex-col rounded-[10px] border border-edge-faint bg-surface p-0"
                >
                    {work.dropped.map((d, i) => (
                        <li
                            key={i}
                            className={cn(
                                "flex flex-col gap-[3px] border-t border-edge-faint first:border-t-transparent",
                                compact ? "py-[9px] pl-[48px] pr-[12px]" : "py-[12px] pl-[68px] pr-[20px]"
                            )}
                        >
                            <span
                                className={cn(
                                    "font-semibold leading-[1.4] text-secondary",
                                    compact ? "text-[13px]" : "text-[14.5px]"
                                )}
                            >
                                {d.name}
                            </span>
                            <span
                                className={cn(
                                    "leading-[1.5] text-ink-mid",
                                    compact ? "text-[12.5px]" : "text-[13.5px]"
                                )}
                            >
                                Dropped: {d.reason}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

// the rows ticked on a question that takes more than one option, sent together as one answer
function usePicks(ans: Answer, labels: string[]) {
    const [picked, setPicked] = useState<number[]>([]);
    return {
        picked,
        toggle: (i: number) => setPicked((p) => togglePick(p, i)),
        clear: () => setPicked([]),
        send: () => {
            if (picked.length > 0 && !ans.act.busy) {
                void ans.sendText(pickedLine(picked.map((i) => labels[i])));
            }
        },
    };
}

type Picks = ReturnType<typeof usePicks>;

// says whether the question takes one option or several, so a row's click is never a guess
function PickHint({ multi }: { multi: boolean }) {
    return (
        <span data-brainstorm-pick-hint={multi ? "multi" : "one"} className="text-[12px] text-muted">
            {multi ? "Pick one or more: click a row to send it alone, or tick rows to send them together" : "Pick one"}
        </span>
    );
}

// the box before a row's button; ticking only collects the row, the send under the rows sends
function TickBox({ i, picks, ans, compact }: { i: number; picks: Picks; ans: Answer; compact: boolean }) {
    const on = picks.picked.includes(i);
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={`Combine ${optionLetter(i)}`}
            data-brainstorm-tick={i}
            disabled={ans.act.busy}
            onClick={() => picks.toggle(i)}
            className={cn(
                "flex flex-none cursor-pointer items-center border-0 bg-transparent outline-none disabled:cursor-default",
                compact ? "pl-[12px]" : "pl-[20px]"
            )}
        >
            <span
                className={cn(
                    "flex h-[16px] w-[16px] items-center justify-center rounded-[4px] border",
                    on ? "border-accent bg-accent text-background" : "border-edge-strong text-transparent"
                )}
            >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2.5 6.5l2.5 2.5 4.5-6" />
                </svg>
            </span>
        </button>
    );
}

// under the rows once any is ticked: the one send for them, and a way to untick them all
function SendPicked({ picks, ans }: { picks: Picks; ans: Answer }) {
    if (picks.picked.length === 0) {
        return null;
    }
    return (
        <div className="flex items-center gap-[10px]">
            <button
                type="button"
                data-brainstorm-send-picked
                disabled={ans.act.busy}
                onClick={picks.send}
                className={PRIMARY_BTN}
            >
                {sendPickedLabel(picks.picked)}
            </button>
            <button type="button" disabled={ans.act.busy} onClick={picks.clear} className={CHIP}>
                Clear
            </button>
        </div>
    );
}

// a letter key focuses its row (bindings.ts), so Enter, the row's own key, sends it; a question that takes more than
// one option adds a tick box per row
export function Options({
    options,
    ans,
    compact,
    reasons,
    pickLabel,
    multi,
    agentId,
}: {
    options: AnswerOption[];
    ans: Answer;
    compact: boolean;
    reasons: boolean;
    pickLabel: string;
    multi: boolean;
    // the agent whose rail holds this question's boards: with it a row is tied to its board there
    agentId?: string;
}) {
    const picks = usePicks(
        ans,
        options.map((o) => o.label)
    );
    return (
        <div className={cn("flex flex-col", compact ? "gap-[6px]" : "gap-[10px]")}>
            <PickHint multi={multi} />
            <div
                role="group"
                aria-label="Answers"
                className={cn("flex flex-col", compact ? "gap-[6px]" : "gap-[10px]")}
            >
                {options.map((o, i) => (
                    <OptionRow
                        key={i}
                        o={o}
                        i={i}
                        ans={ans}
                        compact={compact}
                        reasons={reasons}
                        pickLabel={pickLabel}
                        agentId={agentId}
                    >
                        {multi ? <TickBox i={i} picks={picks} ans={ans} compact={compact} /> : null}
                    </OptionRow>
                ))}
            </div>
            {multi ? <SendPicked picks={picks} ans={ans} /> : null}
        </div>
    );
}

// A row tied to a board in the rail: hovering or focusing it sets the agent's hover atom (the rail outlines the board and
// scrolls to it), leaving or blurring clears it, and the row reads the atom back to light up while the board under the
// pointer is its own. A row with no agent (the builder check's own question has no board) is tied to nothing
function useOptionLink(agentId: string | undefined, i: number) {
    // the "" atom is nobody's: it is never set, so a row with no agent still calls the same hooks
    const hover = optionHoverAtom(agentId ?? "");
    const lit = useAtomValue(hover) === i;
    const setHover = useSetAtom(hover);
    if (agentId == null) {
        return { linked: false, handlers: {} };
    }
    const on = () => setHover(i);
    const off = () => setHover((h) => (h === i ? null : h));
    return { linked: lit, handlers: { onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off } };
}

// one answer row: its tick box (children) before the button that sends it alone, and its pros and cons under both
function OptionRow({
    o,
    i,
    ans,
    compact,
    reasons,
    pickLabel,
    agentId,
    children,
}: {
    o: AnswerOption;
    i: number;
    ans: Answer;
    compact: boolean;
    reasons: boolean;
    pickLabel: string;
    agentId?: string;
    children?: ReactNode;
}) {
    const link = useOptionLink(agentId, i);
    return (
        <div
            data-brainstorm-option-row={i}
            data-linked={link.linked ? "" : undefined}
            {...link.handlers}
            className={cn(
                OPTION_ROW,
                // the board under the pointer lights its row's border, which replaces the hover border it would share
                // with it
                o.pick
                    ? cn(
                          "bg-accent/8 has-[button:enabled:hover]:bg-accentbg",
                          link.linked ? "border-accent" : "border-accent/55"
                      )
                    : link.linked
                      ? "border-accent bg-surface"
                      : OPTION_ROW_PLAIN
            )}
        >
            <div className="flex">
                {children}
                <button
                    type="button"
                    data-brainstorm-option={i}
                    data-pick={o.pick ? "" : undefined}
                    disabled={ans.act.busy}
                    onClick={() => void ans.sendText(o.label)}
                    className={cn(
                        OPTION_BTN,
                        compact ? "gap-[12px] px-[12px] py-[9px]" : "gap-[18px] px-[20px] py-[16px]"
                    )}
                >
                    <span
                        className={cn(
                            OPTION_LETTER,
                            compact ? "h-[24px] w-[24px] text-[11.5px]" : "h-[30px] w-[30px] text-[13px]"
                        )}
                    >
                        {optionLetter(i)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <span
                            className={cn(
                                "font-semibold text-primary",
                                compact ? "text-[13.5px] leading-[1.4]" : "text-[17px] leading-[1.35]"
                            )}
                        >
                            {o.label}
                        </span>
                        {o.detail ? (
                            <span
                                className={cn("text-ink-mid", compact ? "text-[12.5px] leading-[1.45]" : "text-[14px]")}
                            >
                                {o.detail}
                            </span>
                        ) : null}
                    </span>
                    {o.pick ? (
                        <span className="flex-none text-[12px] font-semibold text-accent-soft">{pickLabel}</span>
                    ) : null}
                </button>
            </div>
            {reasons && (o.pros != null || o.cons != null) ? (
                <ProsCons o={o} compact={compact} ticked={children != null} />
            ) : null}
        </div>
    );
}

// indented to the label, under the letter, and past the tick box when the row has one; a narrow column stacks the two
// lists
function ProsCons({ o, compact, ticked }: { o: AnswerOption; compact: boolean; ticked: boolean }) {
    return (
        <div
            data-brainstorm-proscons
            className={cn(
                "grid",
                compact
                    ? "grid-cols-1 gap-[6px] pb-[10px] pr-[12px]"
                    : "grid-cols-2 gap-[24px] pb-[16px] pr-[20px] pt-[2px]",
                compact ? (ticked ? "pl-[76px]" : "pl-[48px]") : ticked ? "pl-[104px]" : "pl-[68px]"
            )}
        >
            <ReasonList label={`${o.label}: for`} mark="+" tone="text-success" items={o.pros} compact={compact} />
            <ReasonList label={`${o.label}: against`} mark="−" tone="text-error" items={o.cons} compact={compact} />
        </div>
    );
}

function ReasonList({
    label,
    mark,
    tone,
    items,
    compact,
}: {
    label: string;
    mark: string;
    tone: string;
    items: string[] | undefined;
    compact: boolean;
}) {
    return (
        <ul aria-label={label} className="m-0 flex list-none flex-col gap-[7px] p-0">
            {(items ?? []).map((t, i) => (
                <li
                    key={i}
                    className={cn(
                        "flex gap-[8px] leading-[1.5] text-secondary",
                        compact ? "text-[12.5px]" : "text-[13.5px]"
                    )}
                >
                    <span aria-hidden="true" className={cn("w-[10px] flex-none font-mono", tone)}>
                        {mark}
                    </span>
                    <span>{t}</span>
                </li>
            ))}
        </ul>
    );
}

// locked while the agent writes, or for why lockedBy says; placeholder replaces the answer's, for a line that answers
// no question
export function AnswerBox({
    ans,
    options,
    locked = false,
    lockedBy = "working",
    placeholder,
}: {
    ans: Answer;
    options: boolean;
    locked?: boolean;
    lockedBy?: EditLock;
    placeholder?: string;
}) {
    return (
        <div className="flex items-center gap-[12px]" title={locked ? lockTitle(lockedBy) : undefined}>
            <textarea
                data-brainstorm-answer
                aria-label="Your answer"
                rows={options ? 1 : 3}
                value={ans.draft}
                disabled={locked}
                placeholder={placeholder ?? (options ? "Or type your own answer…" : "Answer in your own words…")}
                onChange={(e) => ans.setDraft(e.target.value)}
                onKeyDown={(e) => onEnter(e, ans.sendDraft)}
                className={cn(FIELD, "min-w-0 flex-1 disabled:opacity-50")}
            />
            <button
                type="button"
                data-brainstorm-ok
                disabled={ans.draft.trim() === "" || ans.act.busy || locked}
                onClick={ans.sendDraft}
                className={PRIMARY_BTN}
            >
                OK
            </button>
            <span className="flex-none text-[12px] text-muted">press Enter</span>
        </div>
    );
}

// a line of the user's own while no question is open, sent as the question's typed answer is: the agent reads it as
// pushback or a question back, and answers with a question
export function LineBar({ agent, box, lock = "working" }: { agent: AgentVM; box: LineBox; lock?: EditLock }) {
    const ans = useAnswer(agent);
    if (box === "none") {
        return null;
    }
    return (
        <div
            data-brainstorm-line-box={box}
            className="flex flex-none flex-col gap-[6px] border-t border-border px-[22px] py-[12px]"
        >
            <AnswerBox
                ans={ans}
                options={true}
                locked={box === "locked"}
                lockedBy={lock}
                placeholder="Push back, or ask the agent something…"
            />
            {ans.act.error != null ? <span className={ERROR_LINE}>{ans.act.error}</span> : null}
        </div>
    );
}

export function QuestionMain({
    agent,
    s,
    f,
    goTo,
    openDesign,
    skip = true,
    findings,
}: {
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
    goTo: (id: string) => void;
    openDesign: () => void;
    // false in the builder check, where every part is already written
    skip?: boolean;
    // notes the agent wrote since the user last saw the design, and the way to them: they sit behind the question
    findings?: { count: number; open: () => void };
}) {
    const q = f.question!;
    const fresh = f.history.length === 0;
    // guessing or skipping means something only for a question about a part of the design
    const chips = q.part !== "";
    const ans = useAnswer(agent);
    // the question's boards sit in the rail, each tied to its option, so the options carry less here: their pros and
    // cons start folded
    const hasBoards = questionBoards(f, s.base) != null;
    const answers = (
        <QuestionAnswers key={q.n} q={q} ans={ans} compact={false} agentId={agent.id} foldReasons={hasBoards} />
    );
    return (
        <div data-brainstorm-question className="flex min-h-0 flex-1 flex-col">
            <Track segments={questionTrack(f)} />
            <MainBody>
                <QuestionHead f={f} goTo={goTo}>
                    {findings != null ? (
                        <button
                            type="button"
                            data-brainstorm-new-findings
                            onClick={findings.open}
                            className={cn(CHIP, "flex items-center gap-[8px] self-start border-accent/45 bg-accent/12")}
                        >
                            <span className={cn(SMALL_DOT, "bg-accent")} />
                            New findings · {findings.count}
                        </button>
                    ) : null}
                </QuestionHead>
                {answers}
                <AnswerBox ans={ans} options={q.options != null} />
                <div className="flex flex-col gap-[10px]">
                    <div className="flex items-center gap-[10px]">
                        {chips && !fresh ? (
                            <button
                                type="button"
                                disabled={ans.act.busy}
                                onClick={() => void ans.send({ kind: "guess" })}
                                className={CHIP}
                            >
                                Guess for me
                            </button>
                        ) : null}
                        {chips && skip ? (
                            <button
                                type="button"
                                disabled={ans.act.busy}
                                onClick={() => void ans.send({ kind: "skip" })}
                                className={CHIP}
                            >
                                Skip the questions
                            </button>
                        ) : null}
                        <div className="flex-1" />
                        <DesignButton f={f} onClick={openDesign} />
                    </div>
                    {ans.act.error != null ? <span className={ERROR_LINE}>{ans.act.error}</span> : null}
                    {fresh && chips && skip ? (
                        <p data-brainstorm-skip-note className="m-0 text-[12.5px] leading-[1.5] text-ink-mid">
                            Skipping has the agent write every part as its guess. You confirm or edit each one after,
                            before the builder check.
                        </p>
                    ) : null}
                </div>
            </MainBody>
        </div>
    );
}

// the asked question's part link and number, its text and its why; children go under them
function QuestionHead({ f, goTo, children }: { f: BrainstormFile; goTo: (id: string) => void; children?: ReactNode }) {
    const q = f.question!;
    return (
        <div className="flex flex-col gap-[14px]">
            <span className="flex items-center gap-[10px] text-[13px] text-warning">
                {q.part ? (
                    <>
                        <span className="font-semibold">{q.n} →</span>
                        <button
                            type="button"
                            onClick={() => goTo(q.part)}
                            className="cursor-pointer border-0 bg-transparent p-0 text-warning hover:underline"
                        >
                            {partTitle(f, q.part)}
                        </button>
                    </>
                ) : (
                    <span className="font-semibold">Question {q.n}</span>
                )}
            </span>
            <h1 className="m-0 whitespace-pre-line text-[30px] font-bold leading-[1.3] text-primary">{q.text}</h1>
            {q.why ? (
                <p data-brainstorm-why className="m-0 text-[16px] leading-[1.6] text-ink-mid">
                    {q.why}
                </p>
            ) : null}
            {children}
        </div>
    );
}

// wide enough for "Hide facts ▴" and "12 facts ▾" alike, margins included
const FACTS_SLOT = "mx-[10px] w-[104px]";

// one approach the judge is weighing: the row sends it as the answer; its facts stay behind their own button, closed
// until opened, so reading them never answers. The row's border lights only over the part that answers, so the facts
// button never reads as part of it
function ApproachRow({
    a,
    i,
    multi,
    picks,
    ans,
    open,
    onToggle,
}: {
    a: Approach;
    i: number;
    multi: boolean;
    picks: ReturnType<typeof usePicks>;
    ans: Answer;
    open: boolean;
    onToggle: () => void;
}) {
    const n = a.facts.length;
    return (
        <div
            className={cn(
                OPTION_ROW,
                "flex flex-col border-edge-mid bg-surface has-[[data-brainstorm-approach]:enabled:hover]:border-edge-strong"
            )}
        >
            <div className="flex items-center">
                {multi ? <TickBox i={i} picks={picks} ans={ans} compact /> : null}
                <button
                    type="button"
                    data-brainstorm-approach
                    data-brainstorm-option={i}
                    disabled={ans.act.busy}
                    onClick={() => void ans.sendText(a.name)}
                    className={cn(OPTION_BTN, "gap-[14px] px-[12px] py-[9px]")}
                >
                    <span className={cn(OPTION_LETTER, "h-[24px] w-[24px] text-[11.5px]")}>{optionLetter(i)}</span>
                    <span className="w-[190px] flex-none text-[13.5px] font-semibold leading-[1.4] text-primary">
                        {a.name}
                    </span>
                    <span className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-ink-mid">{a.description}</span>
                </button>
                {/* one fixed-width slot on every row, facts or not, so the label swap and a row without facts
                    never change the description's measure */}
                <div className={cn(FACTS_SLOT, "flex-none")}>
                    {n > 0 ? (
                        <button
                            type="button"
                            data-brainstorm-facts-toggle={i}
                            aria-expanded={open}
                            aria-label={`${open ? "Hide" : "Show"} facts for ${a.name}`}
                            onClick={onToggle}
                            className={cn(
                                "flex w-full cursor-pointer items-center justify-center gap-[6px] rounded-[6px] border px-[8px] py-[5px] text-[12px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                open
                                    ? "border-accent/45 bg-accent/12 text-primary hover:bg-accent/20"
                                    : "border-edge-mid bg-surface-raised text-secondary hover:border-edge-strong hover:text-primary"
                            )}
                        >
                            {open ? "Hide facts" : plural(n, "fact", "facts")}
                            <span aria-hidden className="text-[10px] text-muted">
                                {open ? "▴" : "▾"}
                            </span>
                        </button>
                    ) : null}
                </div>
            </div>
            <AnimatePresence initial={false}>
                {open && n > 0 ? (
                    <motion.div key="facts" variants={foldReveal} initial="initial" animate="animate" exit="exit">
                        <ul
                            data-brainstorm-facts={i}
                            aria-label={`Facts for ${a.name}`}
                            className="m-0 flex list-disc flex-col gap-[4px] border-t border-edge-faint py-[10px] pl-[70px] pr-[16px] text-[12.5px] leading-[1.5] text-secondary"
                        >
                            {a.facts.map((fact, k) => (
                                <li key={k}>{fact}</li>
                            ))}
                        </ul>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

// the judge weighing the question's approaches: its status where the options will go, and the approaches as the
// answers, any one sent as typed. Guess for me is left out, since the judge's pick is coming; a rerun's earlier
// options, read and judge are left out too
export function JudgingMain({
    agent,
    f,
    goTo,
    openDesign,
    skip = true,
}: {
    agent: AgentVM;
    f: BrainstormFile;
    goTo: (id: string) => void;
    openDesign: () => void;
    // false in the builder check, where every part is already written
    skip?: boolean;
}) {
    const q = f.question!;
    const approaches = q.approaches!;
    const multi = q.multi === true;
    const ans = useAnswer(agent);
    const picks = usePicks(
        ans,
        approaches.map((a) => a.name)
    );
    // which rows have their facts open, by index; Show all facts opens every row that has any
    const [openFacts, setOpenFacts] = useState<ReadonlySet<number>>(() => new Set());
    const withFacts = approaches.flatMap((a, i) => (a.facts.length > 0 ? [i] : []));
    const allOpen = withFacts.length > 0 && withFacts.every((i) => openFacts.has(i));
    const toggleFacts = (i: number) =>
        setOpenFacts((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
        });
    return (
        <div data-brainstorm-question data-brainstorm-judging className="flex min-h-0 flex-1 flex-col">
            <Track segments={questionTrack(f)} />
            <MainBody>
                <QuestionHead f={f} goTo={goTo} />
                <div
                    data-brainstorm-judge-status
                    aria-live="polite"
                    className="flex items-center gap-[12px] rounded-[10px] border border-edge-faint bg-surface px-[16px] py-[11px] text-[13px] font-semibold text-success"
                >
                    <span className={cn(SMALL_DOT, "pulse-dot bg-success")} />
                    {f.working}
                </div>
                <div className="flex flex-col gap-[8px]">
                    <div className="flex items-baseline gap-[8px]">
                        <h2 data-brainstorm-judge-list className={SECTION_HEAD}>
                            What the judge is weighing · {approaches.length}
                        </h2>
                        <span data-brainstorm-pick-hint={multi ? "multi" : "one"} className="text-[12px] text-muted">
                            {multi
                                ? "the agent’s list, unranked; pick one or more: click a row to send it alone, tick rows to send them together, or wait for the judge’s options"
                                : "the agent’s list, unranked; pick one: click it to answer now, or wait for the judge’s options and pick"}
                        </span>
                        {withFacts.length > 0 ? (
                            <button
                                type="button"
                                data-brainstorm-facts-all
                                aria-pressed={allOpen}
                                onClick={() => setOpenFacts(allOpen ? new Set() : new Set(withFacts))}
                                className={cn(CHIP, "ml-auto flex-none self-center")}
                            >
                                {allOpen ? "Hide all facts" : "Show all facts"}
                            </button>
                        ) : null}
                    </div>
                    <div role="group" aria-label="Approaches" className="flex flex-col gap-[6px]">
                        {approaches.map((a, i) => (
                            <ApproachRow
                                key={i}
                                a={a}
                                i={i}
                                multi={multi}
                                picks={picks}
                                ans={ans}
                                open={openFacts.has(i)}
                                onToggle={() => toggleFacts(i)}
                            />
                        ))}
                    </div>
                    {multi ? <SendPicked picks={picks} ans={ans} /> : null}
                </div>
                <AnswerBox ans={ans} options={true} placeholder="Or answer now in your own words…" />
                <div className="flex flex-col gap-[10px]">
                    <div className="flex items-center gap-[10px]">
                        {q.part !== "" && skip ? (
                            <button
                                type="button"
                                disabled={ans.act.busy}
                                onClick={() => void ans.send({ kind: "skip" })}
                                className={CHIP}
                            >
                                Skip the questions
                            </button>
                        ) : null}
                        <div className="flex-1" />
                        <DesignButton f={f} onClick={openDesign} />
                    </div>
                    {ans.act.error != null ? <span className={ERROR_LINE}>{ans.act.error}</span> : null}
                </div>
            </MainBody>
        </div>
    );
}

export function WorkingMain({ f, openDesign }: { f: BrainstormFile; openDesign: () => void }) {
    return (
        <div data-brainstorm-working aria-live="polite" className="flex min-h-0 flex-1 flex-col">
            <Track segments={questionTrack(f)} />
            <MainBody>
                <div className="flex flex-col gap-[14px]">
                    <span className="flex items-center gap-[8px] text-[13px] font-semibold text-success">
                        <span className={cn(SMALL_DOT, "pulse-dot bg-success")} />
                        Working
                    </span>
                    <p className="m-0 text-[22px] font-semibold leading-[1.4] text-primary">{f.working}</p>
                    <p className="m-0 text-[15px] leading-[1.6] text-ink-mid">The next question comes after.</p>
                </div>
                <div className="flex">
                    <DesignButton f={f} onClick={openDesign} />
                </div>
            </MainBody>
        </div>
    );
}

// the design's title and spec path, at the top of the design column in both the design and the check
export function DesignHead({ f }: { f: BrainstormFile }) {
    return (
        <div className="flex flex-col gap-[4px] border-b border-border px-[14px] pb-[6px]">
            <h1 className="m-0 text-[16px] font-bold text-primary">{f.title}</h1>
            {f.spec ? (
                <span title={f.spec} className="truncate text-[10.5px] text-muted">
                    {f.spec}
                </span>
            ) : null}
        </div>
    );
}

export function CheckMark() {
    return (
        <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="mt-[3px] flex-none text-success"
        >
            <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

// the user's own answer beside a part it made theirs, so a part that says more than they did shows it: one line until
// the row opens
export function SaidLine({ said, open }: { said: PartAnswer; open: boolean }) {
    const line = answerLine(said);
    return (
        <span
            data-brainstorm-said
            title={line}
            className={cn("text-[11.5px] leading-[1.45] text-muted", open ? "whitespace-pre-line" : "truncate")}
        >
            {line}
        </span>
    );
}

export function ChangeDiff({ part }: { part: BrainstormPart }) {
    const diff = sentenceDiff(part.was ?? "", part.body).filter((d) => d.kind !== "same");
    return (
        <>
            {diff.map((d, i) => (
                <div
                    key={i}
                    className={cn(
                        "rounded-[6px] px-[10px] py-[6px] text-[13px] leading-[1.5] text-secondary",
                        d.kind === "added" ? "bg-diff-added/10" : "bg-diff-removed/10"
                    )}
                >
                    <span className={cn("font-mono", d.kind === "added" ? "text-diff-added" : "text-diff-removed")}>
                        {d.kind === "added" ? "+ " : "− "}
                    </span>
                    {d.text}
                </div>
            ))}
            {part.why ? <div className="text-[12px] text-muted">Why: {part.why}</div> : null}
        </>
    );
}
