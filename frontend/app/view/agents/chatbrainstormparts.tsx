// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the brainstorm cards in Chat share (docs/superpowers/specs/2026-11-12-chat-brainstorm-review-design.md): the
// button and row classes, the card shell with its header, the `›` folds, a decision row, the lettered option rows and
// the ✓ row. Each card's own body is in its file (chatbrainstormcard.tsx, chatbrainstormconfirm.tsx,
// chatbrainstormcheck.tsx, chatbrainstormrun.tsx); the strings come from chatbrainstorm.ts.

import { springReveal, turnTransition } from "@/app/element/motiontokens";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { ArrowUpRight, Check, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import { optionLetter, type AnswerOption } from "./brainstormmodel";
import { sendBrainstorm } from "./brainstormsend";
import { ERROR_LINE, onEnter, SaidLine, SentenceDiffLines, useAction } from "./brainstormui";
import type { DecisionRowModel, Gist } from "./chatbrainstorm";

// the agent:view-cycle chord; labelled when drawn, as the platform is only known after boot (keysym.ts)
const OPEN_KEY = "Alt:c";

export const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-accent";
// a hover eases its colours in at MOTION.durMicro instead of snapping (DESIGN.md "Motion": micro ~140ms)
const HOVER_EASE = "transition-colors duration-[140ms] motion-reduce:transition-none";
export const SMALL_BTN = `flex flex-none cursor-pointer items-center gap-[6px] rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[4px] text-[12px] text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50 ${HOVER_EASE}`;
export const PRIMARY_BTN = `flex-none cursor-pointer rounded-[7px] bg-accent px-[14px] py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50 ${HOVER_EASE}`;
export const ROW = `flex min-w-0 items-stretch overflow-hidden rounded-[10px] border has-[button:disabled]:opacity-60 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-accent ${HOVER_EASE}`;
export const ROW_PICK = "border-accent/55 bg-accent/8 has-[button:enabled:hover]:bg-accentbg";
export const ROW_PLAIN = "border-edge-mid bg-surface has-[button:enabled:hover]:border-edge-strong";
export const LETTER =
    "flex h-[24px] w-[24px] flex-none items-center justify-center rounded-[6px] border border-edge-strong font-mono text-[11.5px] font-semibold text-secondary";
const FIELD =
    "min-w-0 flex-1 resize-none rounded-[8px] border border-border bg-background px-[12px] py-[9px] text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted focus:border-edge-strong";
// the one-line row of a ✓ step: what the question's ✓ row has been since the chat redesign
const DONE_ROW =
    "flex min-w-0 items-center gap-[10px] rounded-[10px] border border-edge-mid bg-surface px-[14px] py-[9px] text-[12.5px]";

/** Where a card stands: `waiting` is the user's turn, `weighing` the judge at work, `working` the agent or a builder at
 *  work, `static` an agent that has exited. */
export type CardState = "waiting" | "weighing" | "working" | "static";

// the Brainstorm tab replaces what Chat shows, as the header's control does, so it stays one place with the other views
export function openBrainstorm(agent: AgentVM): void {
    setAgentView(agent.id, "brainstorm", Date.now());
}

export function OpenButton({ agent }: { agent: AgentVM }) {
    return (
        <button
            type="button"
            data-chat-bscard-open
            title={`Open the brainstorm (${formatChordString(OPEN_KEY)})`}
            onClick={() => openBrainstorm(agent)}
            className={cn(SMALL_BTN, FOCUS_RING)}
        >
            Open in Brainstorm
            <kbd className="font-mono text-[11px] text-muted">{formatChordString(OPEN_KEY)}</kbd>
            <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
        </button>
    );
}

// the dot before a state word: amber while it waits on you, the working green otherwise. A card's own `tag` (CardShell)
// takes it when its word is one that is at work, and leaves it out when it is not (a queued council)
export function StateDot({ state }: { state: CardState }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "h-[6px] w-[6px] flex-none rounded-full pulse-dot",
                state === "waiting" ? "bg-asking" : "bg-working"
            )}
        />
    );
}

// one dot and one word say where the card stands, never the colour alone. Only `waiting` is amber: the judge weighing
// and a builder or the agent at work are the working green
export function StateTag({ state }: { state: CardState }) {
    if (state === "static") {
        return <span className="ml-[6px] text-muted">Agent exited</span>;
    }
    const waiting = state === "waiting";
    return (
        <span className={cn("ml-[6px] flex items-center gap-[6px]", waiting ? "text-warning" : "text-secondary")}>
            <StateDot state={state} />
            {waiting ? "Waiting on you" : state === "working" ? "Working" : "Judge weighing"}
        </span>
    );
}

export type CardKind = "question" | "confirm" | "check" | "run" | "verdict" | "handoff" | "council" | "docreview";

/** The section every card is: its motion wrapper (enters and leaves on springReveal), the kind and state attributes the
 *  scenarios read, and the header row (icon, head, the state tag, then the header's right end). `label` is the section's
 *  aria-label (the head when left out); `extra` carries the attributes only one card has (the question card's
 *  `data-chat-bscard` and `data-chat-bscard-n`, the verdict card's `data-chat-vcard`); `chip` is a card's pill between
 *  the head and the state tag (the verdict card's Changes requested / Approved). `tag` is a card's own word for where it
 *  stands (the council's step, `Queued after …`): it takes the state tag's place in a span carrying `data-chat-bscard-tag`,
 *  coloured by `state` (amber while it waits on you, muted once the agent exited, else secondary) and with no dot of its
 *  own, since a queued council is not at work: put a `StateDot` in it when it is, and a long word in a `truncate` span.
 *  `state` still gives the shell's `data-chat-bscard-state`. The right end holds `action`, a card's
 *  own link (Open the review, Open the plan, Open run), and Open in Brainstorm beside it when an `agent` is passed: a
 *  brainstorm card passes the agent and no action, a verdict, handoff or generic run card passes an action and no agent. */
export function CardShell({
    kind,
    state,
    head,
    icon,
    agent,
    action,
    label,
    extra,
    stage,
    chip,
    tag,
    children,
}: {
    kind: CardKind;
    state: CardState;
    head: string;
    icon?: ReactNode;
    agent?: AgentVM;
    action?: ReactNode;
    label?: string;
    extra?: Record<`data-${string}`, string | number | boolean | undefined>;
    stage?: string;
    chip?: ReactNode;
    tag?: ReactNode;
    children: ReactNode;
}) {
    return (
        <motion.div
            variants={springReveal}
            initial="initial"
            animate="animate"
            exit="exit"
            className="overflow-hidden rounded-[12px]"
        >
            <section
                {...extra}
                data-chat-bscard-kind={kind}
                data-chat-bscard-state={state}
                data-chat-bscard-stage={stage}
                aria-label={label ?? head}
                className="flex flex-col gap-[12px] rounded-[12px] border border-edge-strong bg-surface-raised px-[16px] py-[14px]"
            >
                <div className="flex items-center gap-[8px] text-[12px] text-muted">
                    {icon}
                    <span data-chat-bscard-head className="min-w-0 truncate">
                        {head}
                    </span>
                    {chip}
                    {tag != null ? (
                        <span
                            data-chat-bscard-tag
                            className={cn(
                                "ml-[6px] flex min-w-0 items-center gap-[6px]",
                                state === "waiting"
                                    ? "text-warning"
                                    : state === "static"
                                      ? "text-muted"
                                      : "text-secondary"
                            )}
                        >
                            {tag}
                        </span>
                    ) : (
                        <StateTag state={state} />
                    )}
                    {action != null || agent != null ? (
                        <span className="ml-auto flex flex-none items-center gap-[8px]">
                            {action}
                            {agent != null ? <OpenButton agent={agent} /> : null}
                        </span>
                    ) : null}
                </div>
                {children}
            </section>
        </motion.div>
    );
}

/** The `›` toggle that opens in place into one line per item: a ✓, the title in a fixed column and the gist after it.
 *  The list is drawn only while open, closed by default; the open state is local, since a fold is a glance. With no items
 *  the toggle is left out, and so is the whole fold unless `beside` holds something: `beside` shares the toggle's row
 *  (the question card's footer keeps its boards link and hint there, so the list opens under all of them). */
export function Fold({
    name,
    label,
    items,
    beside,
}: {
    name: string;
    label: string;
    items: readonly Gist[];
    beside?: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    if (items.length === 0 && beside == null) {
        return null;
    }
    const shown = open && items.length > 0;
    return (
        <div className="@container flex min-w-0 flex-col">
            <div className="flex items-center gap-[12px] text-[12px] text-muted">
                {items.length > 0 ? (
                    <button
                        type="button"
                        data-chat-bscard-fold={name}
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                        className={cn(
                            "flex w-fit flex-none cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent p-0 text-[12px] font-semibold text-secondary hover:text-primary",
                            HOVER_EASE,
                            FOCUS_RING
                        )}
                    >
                        <ChevronRight
                            size={12}
                            strokeWidth={2.2}
                            aria-hidden
                            style={turnTransition}
                            className={cn(
                                "flex-none transition-transform motion-reduce:transition-none",
                                open && "rotate-90"
                            )}
                        />
                        {label}
                    </button>
                ) : null}
                {beside}
            </div>
            {/* the list opens and folds on the spring; the gap above it is its own top padding, so it folds with it */}
            <AnimatePresence initial={false}>
                {shown ? (
                    <motion.div
                        key="list"
                        variants={springReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden"
                    >
                        <ul
                            data-chat-bscard-fold-list={name}
                            className="m-0 flex list-none flex-col gap-[6px] p-0 pl-[18px] pt-[8px] text-[12.5px] leading-[1.5]"
                        >
                            {items.map((it) => (
                                <li key={it.id} className="flex min-w-0 gap-[10px]">
                                    <Check
                                        size={13}
                                        strokeWidth={2.4}
                                        className="mt-[3px] flex-none text-success"
                                        aria-hidden
                                    />
                                    {it.title !== "" ? (
                                        <span className="w-[196px] flex-none font-medium text-primary @max-[520px]:w-[120px]">
                                            {it.title}
                                        </span>
                                    ) : null}
                                    <span
                                        className={cn(
                                            "min-w-0 flex-1",
                                            it.title !== "" ? "text-muted" : "text-secondary"
                                        )}
                                    >
                                        {it.gist}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

/** A decision the Confirm card or the builder check's review asks the user about: a guess is confirmed or edited, a
 *  decision the agent changed is kept or put back. A send that fails shows its error on the row. */
export function DecisionRow({ agent, row, disabled }: { agent: AgentVM; row: DecisionRowModel; disabled: boolean }) {
    const act = useAction();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const off = disabled || act.busy;
    const startEdit = () => {
        setDraft(row.gist);
        setEditing(true);
    };
    const sendEdit = async () => {
        if (off || draft.trim() === "") {
            return;
        }
        if (await act.run(() => sendBrainstorm(agent, { kind: "edit", part: row.id, text: draft }))) {
            setEditing(false);
        }
    };
    return (
        <div
            data-chat-bscard-decision={row.id}
            data-view={row.view}
            className="flex min-w-0 flex-col gap-[8px] rounded-[10px] border border-edge-mid bg-surface px-[14px] py-[10px]"
        >
            <div className="flex min-w-0 items-baseline gap-[8px]">
                <span className="text-[13.5px] font-semibold leading-[1.4] text-primary">{row.title}</span>
                {row.isNew ? (
                    <span data-chat-bscard-new className="flex-none text-[11px] font-semibold text-accent-soft">
                        New
                    </span>
                ) : null}
                {row.view === "changed" ? (
                    <span className="flex-none text-[11.5px] text-accent-soft">Changed since you confirmed it</span>
                ) : null}
            </div>
            <div className="text-[13px] leading-[1.5] text-secondary">{row.gist}</div>
            {row.view === "changed" && (row.said != null || row.diff.length > 0 || row.why != null) ? (
                // what changed, as the Brainstorm tab's review draws it: the answer it came from, the sentences that
                // left and came in, then the cause
                <div data-chat-bscard-change className="flex min-w-0 flex-col gap-[4px]">
                    {row.said != null ? <SaidLine said={row.said} open={false} /> : null}
                    <SentenceDiffLines lines={row.diff} />
                    {row.why != null ? (
                        <span data-chat-bscard-why className="text-[12px] leading-[1.5] text-muted">
                            Why: {row.why}
                        </span>
                    ) : null}
                </div>
            ) : null}
            {editing ? (
                <div data-chat-bscard-editor className="flex flex-col gap-[8px]">
                    <textarea
                        aria-label={`Edit ${row.title}`}
                        autoFocus
                        rows={3}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditing(false);
                                return;
                            }
                            onEnter(e, () => void sendEdit());
                        }}
                        className={FIELD}
                    />
                    <div className="flex items-center gap-[8px]">
                        <button
                            type="button"
                            disabled={off || draft.trim() === ""}
                            onClick={() => void sendEdit()}
                            className={cn(PRIMARY_BTN, FOCUS_RING)}
                        >
                            Send
                        </button>
                        <button type="button" onClick={() => setEditing(false)} className={cn(SMALL_BTN, FOCUS_RING)}>
                            Cancel
                        </button>
                        <span className="text-[11.5px] text-muted">Enter sends · Esc cancels</span>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-[8px]">
                    {row.view === "guess" ? (
                        <>
                            <button
                                type="button"
                                data-chat-bscard-right
                                disabled={off}
                                onClick={() =>
                                    void act.run(() => sendBrainstorm(agent, { kind: "confirm", part: row.id }))
                                }
                                className={cn(SMALL_BTN, FOCUS_RING, "font-semibold text-primary")}
                            >
                                That's right
                            </button>
                            <button
                                type="button"
                                data-chat-bscard-edit
                                disabled={off}
                                onClick={startEdit}
                                className={cn(SMALL_BTN, FOCUS_RING)}
                            >
                                Edit
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                data-chat-bscard-keep
                                disabled={off}
                                onClick={() =>
                                    void act.run(() => sendBrainstorm(agent, { kind: "keep", part: row.id }))
                                }
                                className={cn(SMALL_BTN, FOCUS_RING, "font-semibold text-primary")}
                            >
                                Keep the change
                            </button>
                            <button
                                type="button"
                                data-chat-bscard-restore
                                disabled={off}
                                onClick={() =>
                                    void act.run(() => sendBrainstorm(agent, { kind: "restore", part: row.id }))
                                }
                                className={cn(SMALL_BTN, FOCUS_RING)}
                            >
                                Put mine back
                            </button>
                        </>
                    )}
                </div>
            )}
            {act.error ? (
                <div role="alert" className={ERROR_LINE}>
                    {act.error}
                </div>
            ) : null}
        </div>
    );
}

// the box before a row's button on a question that takes more than one option: ticking only collects the row. The verdict
// card's finding rows use it too, with `attrs` in place of the brainstorm card's `data-chat-bscard-tick` and their own
// `label`
export function TickBox({
    i,
    on,
    disabled,
    onToggle,
    attrs,
    label,
}: {
    i: number;
    on: boolean;
    disabled: boolean;
    onToggle: () => void;
    attrs?: Record<`data-${string}`, string | number | boolean>;
    label?: string;
}) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={label ?? `Combine ${optionLetter(i)}`}
            {...(attrs ?? { "data-chat-bscard-tick": i })}
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

/** The lettered option rows of a question (the talk question's and the builder's): one button per option that sends its
 *  label through `onSend`, the `pick` row marked with `pickLabel`. `tick` puts a box before a row, for a question that
 *  takes more than one option. */
export function OptionRows({
    options,
    pick,
    pickLabel,
    disabled,
    onSend,
    tick,
}: {
    options: readonly AnswerOption[];
    pick: number | null;
    pickLabel: string;
    disabled: boolean;
    onSend: (text: string) => void;
    tick?: (i: number) => ReactNode;
}) {
    return (
        <div role="group" aria-label="Answers" className="flex flex-col gap-[6px]">
            {options.map((o, i) => {
                const picked = i === pick;
                return (
                    <div key={i} className={cn(ROW, picked ? ROW_PICK : ROW_PLAIN)}>
                        {tick?.(i)}
                        <button
                            type="button"
                            data-chat-bscard-option={i}
                            data-pick={picked ? "" : undefined}
                            disabled={disabled}
                            onClick={() => onSend(o.label)}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-[12px] border-0 bg-transparent px-[12px] py-[9px] text-left outline-none disabled:cursor-default"
                        >
                            <span className={LETTER}>{optionLetter(i)}</span>
                            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                                <span className="text-[13.5px] font-semibold leading-[1.4] text-primary">
                                    {o.label}
                                </span>
                                {o.detail ? (
                                    <span className="text-[12.5px] leading-[1.45] text-ink-mid">{o.detail}</span>
                                ) : null}
                            </span>
                            {picked ? (
                                <span className="flex-none text-[12px] font-semibold text-accent-soft">
                                    {pickLabel}
                                </span>
                            ) : null}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

/** The ✓ row a finished step folds into: `head` in the muted start, `text` the bold part that may be cut short, and
 *  `trailing` the muted end. `dimText` turns that round for a row whose head is the strong part (the council's): the head
 *  in the primary ink, as a node so a caller can set one word heavier, and `text` muted and cut short. The two spans are
 *  `data-chat-bscard-head` and `data-chat-bscard-text`. A builder answer is `data-chat-bscard-answered` with `data-kind="builder"`, a step
 *  `data-chat-bscard-done="<design|builder|run|verdict|handoff|council|docreview>"`; a question's answer is
 *  ChatBrainstormAnswered's. `extra` adds `data-*` attributes to that row element, beside the one above.
 *  `mark` is the glyph drawn in place of the ✓ (the council row's ■, !, –, ↺), in the ✓'s 14px box and muted unless it
 *  brings a colour of its own. `action` is a button at the row's right end (Open report), drawn only on a row without a
 *  `detail`: a row with a detail is itself a button, and a button never nests in a button.
 *  With a `detail` the row is a button with a caret (`aria-expanded`) that opens the detail text under it, pre-wrapped
 *  and muted, closed by default and local to the row, since a fold is a glance; a run row's button is
 *  `data-chat-run-ended` and its text `data-chat-run-ended-text` (the `[arc] Run` message, as written). */
export function DoneRow({
    kind,
    head,
    text,
    trailing,
    n,
    detail,
    mark,
    action,
    extra,
    dimText,
}: {
    kind: "builder-answer" | "design" | "builder" | "run" | "verdict" | "handoff" | "council" | "docreview";
    head: ReactNode;
    text?: string;
    trailing?: string;
    n?: number;
    detail?: string;
    mark?: ReactNode;
    action?: ReactNode;
    extra?: Record<`data-${string}`, string | number | boolean | undefined>;
    dimText?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const marks = {
        ...(kind === "builder-answer"
            ? { "data-chat-bscard-answered": "", "data-kind": "builder", "data-chat-bscard-n": n }
            : { "data-chat-bscard-done": kind }),
        ...extra,
    };
    const inner = (
        <>
            {mark != null ? (
                <span
                    data-chat-bscard-mark
                    aria-hidden
                    className="flex h-[14px] w-[14px] flex-none items-center justify-center text-[12px] leading-none text-muted"
                >
                    {mark}
                </span>
            ) : (
                <Check size={14} strokeWidth={2.2} className="flex-none text-muted" aria-hidden />
            )}
            <span
                data-chat-bscard-head
                className={cn(
                    "min-w-0 truncate",
                    dimText
                        ? "flex-none text-primary"
                        : text != null
                          ? "flex-none text-muted"
                          : "font-medium text-primary"
                )}
            >
                {head}
            </span>
            {text != null ? (
                <>
                    {/* a builder answer reads "head — answer" in the row's text, the spec's wording */}
                    {kind === "builder-answer" ? <span className="flex-none text-muted">{" — "}</span> : null}
                    <span
                        data-chat-bscard-text
                        className={cn("min-w-0 truncate", dimText ? "text-muted" : "font-medium text-primary")}
                        title={text}
                    >
                        {text}
                    </span>
                </>
            ) : null}
            {trailing != null ? <span className="ml-auto flex-none text-muted">{trailing}</span> : null}
            {detail != null ? (
                <ChevronRight
                    size={12}
                    strokeWidth={2.2}
                    aria-hidden
                    style={turnTransition}
                    className={cn(
                        "flex-none text-muted transition-transform motion-reduce:transition-none",
                        trailing == null && "ml-auto",
                        open && "rotate-90"
                    )}
                />
            ) : null}
        </>
    );
    if (detail == null) {
        return (
            <div {...marks} className={DONE_ROW}>
                {inner}
                {action != null ? (
                    <span className={cn("flex flex-none items-center", trailing == null && "ml-auto")}>{action}</span>
                ) : null}
            </div>
        );
    }
    return (
        <div className="flex min-w-0 flex-col">
            <button
                type="button"
                {...marks}
                {...(kind === "run" ? { "data-chat-run-ended": "" } : null)}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className={cn(
                    DONE_ROW,
                    "w-full cursor-pointer text-left hover:border-edge-strong hover:bg-surface-hover",
                    HOVER_EASE,
                    FOCUS_RING
                )}
            >
                {inner}
            </button>
            {/* the detail opens and folds on the spring; the gap above it is its own top padding, so it folds with it */}
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div
                        key="detail"
                        variants={springReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden"
                    >
                        <div className="pt-[6px]">
                            <div
                                {...(kind === "run" ? { "data-chat-run-ended-text": "" } : null)}
                                className="whitespace-pre-wrap break-words rounded-[10px] border border-edge-mid bg-surface px-[14px] py-[9px] text-[12px] leading-[1.5] text-muted"
                            >
                                {detail}
                            </div>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
