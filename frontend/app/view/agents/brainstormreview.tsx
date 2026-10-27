// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The builder check's review of what it changed, the rail of the builder's answered questions beside it, and the
// review's key hints.

import { cn } from "@/util/util";
import { Fragment, useEffect, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import {
    checkReview,
    handoffView,
    hasMockups,
    partAnswer,
    partGist,
    type BrainstormAction,
    type BrainstormFile,
    type BrainstormPart,
    type PartView,
    type ReviewRow,
} from "./brainstormmodel";
import { sendBrainstorm } from "./brainstormsend";
import { openBrainstormDesign, setReviewCursor, toggleReviewRow, type BrainstormState } from "./brainstormstore";
import {
    ChangeDiff,
    CheckMark,
    DOT,
    DOT_ASKED,
    DOT_GUESS,
    DOT_OPEN,
    DOT_YOURS,
    ERROR_LINE,
    FIELD,
    LINK,
    onEnter,
    PART_BTN,
    PartMockups,
    SaidLine,
    SECTION_HEAD,
    useAction,
    WORKING_TITLE,
} from "./brainstormui";

const ROW_GRID =
    "grid grid-cols-[7px_minmax(120px,190px)_minmax(0,1fr)_max-content_12px] items-start gap-x-[12px] gap-y-[6px] border-t border-edge-faint px-[14px] py-[9px]";
const ROW_CURSOR = "rounded-[8px] bg-surface-selected outline outline-1 -outline-offset-1 outline-accent";
// a decision the check rewrote waits on keep or put back: an accent ring until it is yours again
const REVIEW_DOT: Record<PartView, string> = {
    changed: cn(DOT, "box-border border-[1.5px] border-accent"),
    yours: DOT_YOURS,
    guess: cn(DOT_GUESS, "box-border"),
    asked: DOT_ASKED,
    writing: DOT_YOURS,
    open: cn(DOT_OPEN, "box-border"),
};
const QUIET_BTN =
    "cursor-pointer whitespace-nowrap border-0 bg-transparent px-[2px] py-[4px] text-[12px] text-ink-mid hover:text-secondary disabled:cursor-default disabled:opacity-50";
const UNDER_ROW = "col-[3/-1] flex flex-col gap-[4px]";
const REVIEW_KEYS: [string, string][] = [
    ["j k", "Next or previous decision"],
    ["Enter", "Show what it was"],
    ["y", "Keep the change"],
    ["u", "Put mine back"],
    ["b", "Back to the terminal"],
];

export function CheckReview({
    agent,
    s,
    f,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const r = checkReview(f);
    const cursor = s.review.cursor;
    // j and k move the cursor from outside the review, so the row it lands on is brought into view here
    useEffect(() => {
        if (cursor != null) {
            scrollRef.current
                ?.querySelector(`[data-brainstorm-review-row="${CSS.escape(cursor)}"]`)
                ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, [cursor]);
    const row = (x: ReviewRow) => (
        <ReviewRowView
            key={x.id}
            agent={agent}
            s={s}
            f={f}
            row={x}
            cursor={x.id === cursor}
            open={s.review.open[x.id] === true}
        />
    );
    return (
        <div ref={scrollRef} data-brainstorm-review className="min-h-0 flex-1 overflow-y-auto bg-background">
            <div className="flex flex-col gap-[16px] px-[22px] pb-[30px] pt-[22px]">
                <div className="flex flex-col gap-[3px] px-[14px]">
                    <h1 className="m-0 text-[18px] font-bold text-primary">Review what the check changed</h1>
                    {r.summary ? (
                        <span data-brainstorm-review-summary className="text-[13px] leading-[1.5] text-ink-mid">
                            {r.summary}
                        </span>
                    ) : null}
                </div>
                {r.changed.length > 0 ? (
                    <section aria-label="Changed" data-brainstorm-review-section="changed" className="flex flex-col">
                        <div className="flex items-baseline gap-[8px] px-[14px] pb-[6px]">
                            <h2 className={SECTION_HEAD}>Changed since you confirmed · {r.changed.length}</h2>
                            <span className="text-[12px] text-muted">open one to see what it was</span>
                            {r.pending > 1 ? <KeepAll agent={agent} f={f} pending={r.pending} /> : null}
                        </div>
                        {r.changed.map(row)}
                    </section>
                ) : null}
                {r.fresh.length > 0 ? (
                    <section aria-label="New" data-brainstorm-review-section="fresh" className="flex flex-col">
                        <div className="flex items-baseline gap-[8px] px-[14px] py-[6px]">
                            <h2 className={SECTION_HEAD}>New since the check · {r.fresh.length}</h2>
                        </div>
                        {r.fresh.map(row)}
                    </section>
                ) : null}
                <PartLinks kind="unchanged" label="Yours, unchanged" agent={agent} s={s} f={f} parts={r.unchanged} />
                <PartLinks kind="notes" label="What the agent found" agent={agent} s={s} f={f} parts={r.notes} />
            </div>
        </div>
    );
}

// one press for every change still waiting, so a check that rewrote many decisions is not one agent turn each
function KeepAll({ agent, f, pending }: { agent: AgentVM; f: BrainstormFile; pending: number }) {
    const act = useAction();
    const working = f.working != null;
    return (
        <span className="ml-auto flex flex-none flex-col items-end gap-[4px] self-center">
            <button
                type="button"
                data-brainstorm-keep-all
                disabled={working || act.busy}
                title={working ? WORKING_TITLE : undefined}
                onClick={() => void act.run(() => sendBrainstorm(agent, { kind: "keep-all" }))}
                className={cn(PART_BTN, "whitespace-nowrap")}
            >
                Keep all {pending} changes
            </button>
            {act.error != null ? <span className={ERROR_LINE}>{act.error}</span> : null}
        </span>
    );
}

// one decision on one grid line: dot, title, what it says now with its cause, the one action it asks for, and the
// arrow that opens what it was
function ReviewRowView({
    agent,
    s,
    f,
    row,
    cursor,
    open,
}: {
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
    row: ReviewRow;
    cursor: boolean;
    open: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const act = useAction();
    const working = f.working != null;
    const locked = working || act.busy;
    const lockTitle = working ? WORKING_TITLE : undefined;
    const part = f.parts.find((p) => p.id === row.id);
    // only a decision that was yours has something it was: what is new since the check opens only for its mockups
    const expandable = row.action === "keep-restore" || row.view === "yours" || hasMockups(f, part, s.base);
    const send = (action: BrainstormAction) => act.run(() => sendBrainstorm(agent, action));
    const toggle = () => toggleReviewRow(agent.id, row.id);
    const startEdit = () => {
        setDraft(row.body);
        setEditing(true);
    };
    let right = null;
    if (row.action === "keep-restore") {
        right = (
            <span className="-mt-[3px] flex items-center justify-end gap-[12px]">
                <button
                    type="button"
                    disabled={locked}
                    title={lockTitle}
                    onClick={() => void send({ kind: "keep", part: row.id })}
                    className={cn(PART_BTN, "whitespace-nowrap")}
                >
                    Keep the change
                </button>
                <button
                    type="button"
                    disabled={locked}
                    title={lockTitle}
                    onClick={() => void send({ kind: "restore", part: row.id })}
                    className={QUIET_BTN}
                >
                    Put mine back
                </button>
            </span>
        );
    } else if (row.action === "confirm") {
        right = editing ? (
            <span />
        ) : (
            <span className="-mt-[3px] flex items-center justify-end gap-[12px]">
                <button
                    type="button"
                    disabled={locked}
                    title={lockTitle}
                    onClick={() => void send({ kind: "confirm", part: row.id })}
                    className={cn(PART_BTN, "whitespace-nowrap")}
                >
                    That’s right
                </button>
                <button type="button" disabled={locked} title={lockTitle} onClick={startEdit} className={QUIET_BTN}>
                    Edit
                </button>
            </span>
        );
    } else if (row.action === "answer") {
        right = (
            <span className="-mt-[3px] flex justify-end">
                <button
                    type="button"
                    onClick={() => openBrainstormDesign(agent.id, false)}
                    className={cn(PART_BTN, "whitespace-nowrap border-warning/45 bg-warning/12")}
                >
                    Answer question {row.question}
                </button>
            </span>
        );
    } else if (row.view === "yours") {
        right = <span className="mt-[2px] text-right text-[11.5px] text-success">Yours</span>;
    } else {
        right = <span />;
    }
    return (
        <div
            data-brainstorm-review-row={row.id}
            data-cursor={cursor ? "" : undefined}
            data-state={row.view}
            onClick={() => setReviewCursor(agent.id, row.id)}
            className={cn(ROW_GRID, "scroll-mt-[20px]", cursor && ROW_CURSOR)}
        >
            <span className={cn(REVIEW_DOT[row.view], "mt-[6px]")} />
            {expandable ? (
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={toggle}
                    className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13.5px] font-semibold leading-[1.45] text-primary"
                >
                    {row.title}
                </button>
            ) : (
                <span className="text-[13.5px] font-semibold leading-[1.45] text-primary">{row.title}</span>
            )}
            <span className="flex min-w-0 flex-col gap-[2px]">
                <span
                    data-brainstorm-gist
                    className={cn(
                        "text-[13.5px] leading-[1.45]",
                        row.action === "answer" ? "text-ink-mid" : "text-secondary"
                    )}
                >
                    {row.gist}
                </span>
                {row.cause ? (
                    <span data-brainstorm-review-cause className="font-mono text-[10.5px] text-muted">
                        {row.cause}
                    </span>
                ) : null}
                {row.said != null ? <SaidLine said={row.said} open={open && expandable} /> : null}
            </span>
            {right}
            {expandable ? (
                <button
                    type="button"
                    data-brainstorm-review-toggle
                    aria-label={open ? "Hide what it was" : "Show what it was"}
                    aria-expanded={open}
                    onClick={toggle}
                    className={cn(
                        "mt-[4px] flex w-[12px] cursor-pointer border-0 bg-transparent p-0 text-muted",
                        open && "rotate-180"
                    )}
                >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 4.5l3 3 3-3" />
                    </svg>
                </button>
            ) : (
                <span />
            )}
            {open && expandable ? (
                <div data-brainstorm-review-diff className={UNDER_ROW}>
                    {/* the cause is already under the title, so the diff leaves out its why */}
                    {row.was != null && part != null ? (
                        <ChangeDiff part={{ ...part, why: undefined }} />
                    ) : (
                        <div className="whitespace-pre-line rounded-[6px] bg-surface px-[10px] py-[6px] text-[13px] leading-[1.5] text-secondary">
                            {row.body}
                        </div>
                    )}
                    {part != null ? <PartMockups agentId={agent.id} s={s} f={f} part={part} /> : null}
                </div>
            ) : null}
            {editing ? (
                <div className={UNDER_ROW}>
                    <textarea
                        data-brainstorm-edit
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
                            onEnter(e, () => {
                                if (draft.trim() === "" || locked) {
                                    return;
                                }
                                void send({ kind: "edit", part: row.id, text: draft }).then((ok) => {
                                    if (ok) {
                                        setEditing(false);
                                    }
                                });
                            });
                        }}
                        className={FIELD}
                    />
                    <span className="text-[11.5px] text-muted">Enter sends · Esc cancels</span>
                </div>
            ) : null}
            {row.calls.map((c, i) => (
                <div
                    key={i}
                    data-brainstorm-review-call
                    className="col-[3/-1] flex items-baseline gap-[8px] rounded-[6px] bg-accentbg px-[10px] py-[5px] text-[12.5px] leading-[1.5] text-secondary"
                >
                    <span className="flex-none text-[11px] font-semibold text-accent-soft">Agent’s call</span>
                    {c}
                </div>
            ))}
            {act.error != null ? <span className={cn(ERROR_LINE, "col-[3/-1]")}>{act.error}</span> : null}
        </div>
    );
}

// the parts the review has nothing to ask about, as one line of titles; a title opens that part under the line
function PartLinks({
    kind,
    label,
    agent,
    s,
    f,
    parts,
}: {
    kind: string;
    label: string;
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
    parts: BrainstormPart[];
}) {
    const [shown, setShown] = useState<string | null>(null);
    if (parts.length === 0) {
        return null;
    }
    const part = parts.find((p) => p.id === shown);
    const said = part != null ? partAnswer(f, part) : null;
    return (
        <section
            aria-label={label}
            data-brainstorm-review-links={kind}
            className="flex flex-col gap-[8px] border-t border-edge-faint px-[14px] py-[10px]"
        >
            <div className="flex flex-wrap items-baseline gap-x-[14px] gap-y-[6px]">
                <h2 className="m-0 text-[13px] font-semibold text-ink-mid">
                    {label} · {parts.length}
                </h2>
                {parts.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        data-brainstorm-review-link={p.id}
                        aria-expanded={p.id === shown}
                        onClick={() => setShown(p.id === shown ? null : p.id)}
                        className={cn(
                            "cursor-pointer border-0 bg-transparent p-0 text-[12.5px] hover:underline",
                            p.id === shown ? "text-accent-soft" : "text-ink-mid"
                        )}
                    >
                        {p.title}
                    </button>
                ))}
            </div>
            {part != null ? (
                <div
                    data-brainstorm-review-body={part.id}
                    className="whitespace-pre-line rounded-[8px] bg-surface px-[14px] py-[10px] text-[13px] leading-[1.6] text-secondary"
                >
                    {part.body || partGist(f, part)}
                </div>
            ) : null}
            {said != null ? <SaidLine said={said} open /> : null}
            {part != null ? <PartMockups agentId={agent.id} s={s} f={f} part={part} /> : null}
        </section>
    );
}

// the builder's questions the user answered, each with the decisions its answer changed. Without the agent the
// decisions read as plain titles, since a link moves that agent's review cursor
export function AnsweredRail({ f, agent }: { f: BrainstormFile; agent?: AgentVM }) {
    const r = checkReview(f);
    const hv = handoffView(f);
    return (
        <aside
            aria-label="The builder check"
            className="flex w-[460px] flex-none flex-col gap-[18px] overflow-y-auto border-l border-border bg-surface px-[24px] py-[22px] *:flex-none"
        >
            <div className="flex flex-col gap-[8px]">
                <h2 className="m-0 text-[15px] font-semibold text-primary">A builder read the design</h2>
                <p data-brainstorm-answered-line className="m-0 text-[13px] leading-[1.5] text-ink-mid">
                    {answeredLine(hv.questions, hv.forYou, r.answered.length, hv.calls.length)}
                </p>
            </div>
            {r.answered.length > 0 ? (
                <section aria-label="You answered" className="flex flex-col">
                    {r.answered.map((y, i) => (
                        <div
                            key={i}
                            data-brainstorm-answered
                            className="flex flex-col gap-[6px] border-t border-edge-faint py-[10px]"
                        >
                            <span className="text-[12.5px] leading-[1.45] text-ink-mid">{y.q}</span>
                            <div className="flex items-start gap-[8px]">
                                <CheckMark />
                                <span className="text-[13.5px] font-semibold leading-[1.45] text-primary">{y.a}</span>
                            </div>
                            {y.changed.length > 0 ? (
                                <span className="pl-[21px] text-[11.5px] text-muted">
                                    Changed{" "}
                                    {y.changed.map((c, j) => (
                                        <Fragment key={c.id}>
                                            {j > 0 ? ", " : null}
                                            {agent != null ? (
                                                <button
                                                    type="button"
                                                    data-brainstorm-answered-link={c.id}
                                                    onClick={() => setReviewCursor(agent.id, c.id)}
                                                    className={cn(LINK, "border-0 bg-transparent p-0 text-[11.5px]")}
                                                >
                                                    {c.title}
                                                </button>
                                            ) : (
                                                c.title
                                            )}
                                        </Fragment>
                                    ))}
                                </span>
                            ) : null}
                        </div>
                    ))}
                </section>
            ) : null}
        </aside>
    );
}

function answeredLine(questions: number, forYou: number, answered: number, calls: number): string {
    const yours = answered === forYou ? `${forYou} for you, all answered` : `${forYou} for you, ${answered} answered`;
    const decided = calls > 0 ? `; the agent decided ${calls}, shown under their decisions` : "";
    return `It had ${questions} questions: ${yours}${decided}.`;
}

// the review's own keys, in the hints footer's style (hints-footer.tsx), under the main area and the rail
export function ReviewHints() {
    return (
        <div
            data-brainstorm-review-hints
            aria-label="Keys"
            className="flex h-7 flex-none items-center gap-4 border-t border-edge-strong bg-modalbg px-4"
        >
            {REVIEW_KEYS.map(([glyph, label]) => (
                <span key={glyph} className="flex items-center gap-1.5 text-[12px] text-secondary">
                    <span className="rounded-[5px] border border-edge-mid px-[6px] py-0.5 font-mono text-[10.5px] text-primary">
                        {glyph}
                    </span>
                    {label}
                </span>
            ))}
        </div>
    );
}
