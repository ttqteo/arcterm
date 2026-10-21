// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council Discussion (Main.dc.html, Running.dc.html, Paused.dc.html): a header in one line (the feature, the round
// chip, the experts' avatars, the cost line, Summarize, Stop council), and a body that depends on where the council is.
// From round 2 on it is one proposal as a Reddit-style thread beside the proposals ranked by score (councilthread.tsx);
// while round 1 runs it is each expert's card with what it is reading and the proposals as they arrive; at the pause it
// is the ticks and the question for round 2; a council the token gate did not run offers Start council. A failed expert
// shows its error with Retry, a failed coordinator a Summary failed panel. Status is a dot and a word, never colour
// alone. Every control carries a data-council-* attribute for the CDP scenario `council-discussion`. The rules are in
// councildiscussionmodel.ts and councilmodel.ts; the store's actions answer `{ ok, error }`, and a refusal shows in place.

import { cn } from "@/util/util";
import { atom, useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { ArrowBigUp, Check, ListChecks, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { showCouncil } from "./agentcenter";
import {
    avatarStackLabel,
    avatarTone,
    callBarLabel,
    canContinue,
    coordinatorFailure,
    discussionBody,
    expertCard,
    expertDoing,
    failedExperts,
    headerCost,
    isLit,
    keptProposals,
    proposalLine,
    retriedOut,
    summarizeAction,
    toggleCut,
    type CardDot,
    type FailedExpert,
} from "./councildiscussionmodel";
import {
    callSegments,
    canSummarize,
    estimateLabel,
    expertStat,
    headerChip,
    panel,
    rankedProposals,
    type RankedProposal,
    type SegmentState,
} from "./councilmodel";
import {
    continueCouncil,
    councilOpenProposalAtom,
    councilSelAtom,
    retryExpert,
    startSavedCouncil,
    stopCouncil,
    summarizeCouncil,
    useCouncil,
    type CouncilCall,
} from "./councilstore";
import {
    CouncilAvatar,
    CouncilComposer,
    EvidenceChips,
    ProposalPost,
    ThreadView,
    councilComposerAtom,
    useEstimate,
} from "./councilthread";

const ROOT = "flex min-h-0 min-w-0 flex-1 flex-col bg-background text-[13px] text-primary";

const SECTION_LABEL = "text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted";

const secondaryButton =
    "h-[30px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[12px] text-[12.5px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

const primaryButton =
    "h-[30px] cursor-pointer rounded-[6px] border-0 bg-accent px-[14px] text-[12.5px] font-semibold text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

// ---- state the view keeps ----

/** The pause's ticks and question, per council, so they survive a trip to another view. */
interface PauseDraft {
    cut: string[]; // the proposals the person unticked
    question: string;
}

const councilPauseAtom = atomFamily(
    (_id: string) => atom<PauseDraft>({ cut: [], question: "" }) as PrimitiveAtom<PauseDraft>
);

// the clock in the header ticks while the council runs
function useClock(on: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!on) {
            return;
        }
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [on]);
    return now;
}

/** The clicks that call wavesrv: one at a time per key, the refusal kept to show where it was clicked. */
interface Actions {
    error: string | null;
    busy: ReadonlySet<string>;
    run: (key: string, what: string, fn: () => Promise<CouncilCall<unknown>>) => Promise<boolean>;
}

function useActions(): Actions {
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
    const live = useRef(new Set<string>());
    const run = useCallback(async (key: string, what: string, fn: () => Promise<CouncilCall<unknown>>) => {
        if (live.current.has(key)) {
            return false;
        }
        live.current.add(key);
        setBusy(new Set(live.current));
        setError(null);
        const r = await fn();
        live.current.delete(key);
        setBusy(new Set(live.current));
        // `=== false` because the non-strict tsconfig narrows a union only on a comparison
        if (r.ok === false) {
            setError(`${what} failed: ${r.error}`);
        }
        return r.ok;
    }, []);
    return { error, busy, run };
}

// ---- the view ----

export function CouncilDiscussion() {
    const id = useAtomValue(councilSelAtom);
    const c = useCouncil(id);
    if (c == null) {
        return (
            <div data-council-discussion className={cn(ROOT, "items-center justify-center text-muted")}>
                {id == null ? "No council is open." : "Loading the council…"}
            </div>
        );
    }
    return <Discussion key={c.id} c={c} />;
}

function Discussion({ c }: { c: Council }) {
    const now = useClock(c.state === "running");
    const acts = useActions();
    const body = discussionBody(c);
    return (
        <div data-council-discussion={c.id} data-council-id={c.id} data-council-state={c.state} className={ROOT}>
            <Header c={c} now={now} acts={acts} />
            {body === "not-run" ? (
                <NotRunBody c={c} acts={acts} />
            ) : body === "pause" ? (
                <PauseBody c={c} acts={acts} />
            ) : body === "experts" ? (
                <ExpertsBody c={c} acts={acts} />
            ) : (
                <ThreadBody c={c} acts={acts} />
            )}
        </div>
    );
}

// ---- the header ----

const CHIP_TONE: Record<string, { box: string; dot: string }> = {
    running: { box: "bg-pill text-secondary", dot: "bg-working pulse-dot" },
    "awaiting-you": { box: "bg-askingbg text-warning-soft", dot: "bg-asking" },
    failed: { box: "bg-error/12 text-error-soft", dot: "bg-error" },
};
const CHIP_QUIET = { box: "bg-pill text-secondary", dot: "bg-ink-faint" };

function StatusChip({ c }: { c: Council }) {
    const tone = CHIP_TONE[c.state] ?? CHIP_QUIET;
    return (
        <span
            data-council-chip
            aria-live="polite"
            className={cn(
                "inline-flex items-center gap-[6px] whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10.5px] tabular-nums",
                tone.box
            )}
        >
            <span aria-hidden className={cn("h-[6px] w-[6px] rounded-full", tone.dot)} />
            {headerChip(c)}
        </span>
    );
}

function AvatarStack({ c }: { c: Council }) {
    const running = c.state === "running";
    return (
        <div data-council-avatars role="group" aria-label={avatarStackLabel(c)} className="flex items-center pl-[4px]">
            {c.experts.map((e) => {
                const lit = isLit(c, e.id);
                const failed = c.failed?.[e.id] != null;
                return (
                    <CouncilAvatar
                        key={e.id}
                        tone={avatarTone(c, e.id)}
                        name={e.name}
                        dim={running && !lit}
                        dot={lit ? "working" : failed ? "failed" : null}
                        title={`${e.name}: ${expertDoing(c, e)}`}
                        className="-ml-[5px]"
                        data-council-avatar={e.id}
                        data-lit={lit ? "true" : "false"}
                    />
                );
            })}
        </div>
    );
}

const SEGMENT: Record<SegmentState, string> = {
    done: "bg-success/45",
    running: "bg-working",
    failed: "bg-error",
    pending: "bg-edge-mid",
};

function CallBar({ c }: { c: Council }) {
    return (
        <div data-council-calls role="img" aria-label={callBarLabel(c)} className="flex gap-[3px]">
            {callSegments(c).map((s, i) => (
                <span key={i} data-segment={s} className={cn("h-[4px] flex-1 rounded-[2px]", SEGMENT[s])} />
            ))}
        </div>
    );
}

function Header({ c, now, acts }: { c: Council; now: number; acts: Actions }) {
    const action = summarizeAction(c);
    const enabled = canSummarize(c);
    const summarizing = acts.busy.has("summarize");
    const summarize = async () => {
        if (action.call && !(await acts.run("summarize", "Summarize", () => summarizeCouncil(c.id)))) {
            return;
        }
        showCouncil(c.id, "summary");
    };
    const title = enabled
        ? action.call
            ? "Rank the directions and fill the matrix from the discussion so far"
            : "Open the ranked directions and the matrix"
        : c.state === "not-run"
          ? "This council has not run"
          : "Summarize unlocks after round 1";
    const showBar = (c.state === "running" && c.round <= 1) || c.state === "awaiting-you";
    return (
        <header className="flex flex-none flex-col gap-3 border-b border-edge-faint px-8 pb-3 pt-4">
            <div className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-2">
                <span className="text-[12px] text-muted">Council</span>
                <h1
                    data-council-title
                    title={c.feature}
                    className="m-0 min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-primary"
                >
                    {c.feature}
                </h1>
                <StatusChip c={c} />
                <AvatarStack c={c} />
                <div className="flex-1" />
                {c.state !== "not-run" && (
                    <span data-council-cost className="whitespace-nowrap text-[11.5px] tabular-nums text-muted">
                        {headerCost(c, now)}
                    </span>
                )}
                <button
                    type="button"
                    data-council-summarize
                    disabled={!enabled || summarizing}
                    title={title}
                    onClick={() => void summarize()}
                    className="inline-flex h-[28px] cursor-pointer items-center gap-[6px] rounded-[6px] border border-edge-strong bg-surface-raised px-[12px] text-[12px] font-semibold text-primary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:border-border disabled:bg-surface disabled:text-ink-faint"
                >
                    <ListChecks size={13} strokeWidth={2} aria-hidden />
                    {summarizing ? "Summarizing…" : action.label}
                </button>
                {c.state === "running" && (
                    <button
                        type="button"
                        data-council-stop
                        disabled={acts.busy.has("stop")}
                        onClick={() => void acts.run("stop", "Stop council", () => stopCouncil(c.id))}
                        className="h-[28px] cursor-pointer rounded-[6px] border border-transparent bg-transparent px-[12px] text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
                    >
                        {acts.busy.has("stop") ? "Stopping…" : "Stop council"}
                    </button>
                )}
            </div>
            {showBar && <CallBar c={c} />}
            {c.state === "running" && c.round <= 1 && (
                <span className="self-start text-[11.5px] text-muted">
                    The discussion opens here as proposals arrive. Summarize unlocks after round 1.
                </span>
            )}
            {acts.error != null && (
                <span role="alert" data-council-error className="text-[12px] text-error-soft">
                    {acts.error}
                </span>
            )}
        </header>
    );
}

// ---- failures ----

function RetryButton({ expertId, label, acts, c }: { expertId: string; label: string; acts: Actions; c: Council }) {
    const key = `retry:${expertId}`;
    return (
        <button
            type="button"
            data-council-retry={expertId}
            aria-label={label}
            disabled={acts.busy.has(key)}
            onClick={() => void acts.run(key, "Retry", () => retryExpert(c.id, expertId))}
            className={cn(secondaryButton, "h-[26px] self-start px-[10px] text-[11.5px]")}
        >
            {acts.busy.has(key) ? "Retrying…" : "Retry"}
        </button>
    );
}

function ExpertFailureCard({ c, f, acts }: { c: Council; f: FailedExpert; acts: Actions }) {
    return (
        <div
            data-council-failed={f.expert.id}
            className="flex flex-col gap-[7px] rounded-[10px] border border-error/30 bg-surface-raised px-3 py-[10px]"
        >
            <div className="flex items-center gap-2">
                <CouncilAvatar tone={avatarTone(c, f.expert.id)} name={f.expert.name} />
                <span className="text-[12.5px] font-semibold">{f.expert.name}</span>
                <span className="text-[11px] text-muted">{f.expert.model}</span>
                <span className="flex items-center gap-[6px] text-[11.5px] text-error-soft">
                    <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-error" />
                    Failed in round {f.round}
                </span>
            </div>
            <span data-council-failed-error className="break-words text-[12px] leading-[1.5] text-secondary">
                {f.error}
            </span>
            <RetryButton expertId={f.expert.id} label={`Retry ${f.expert.name}`} acts={acts} c={c} />
        </div>
    );
}

function SummaryFailedPanel({ c, f, acts }: { c: Council; f: FailedExpert; acts: Actions }) {
    return (
        <div
            data-council-summary-failed
            className="flex flex-col gap-[7px] rounded-[10px] border border-error/30 bg-surface-raised px-3 py-[10px]"
        >
            <div className="flex items-center gap-2">
                <CouncilAvatar tone={avatarTone(c, f.expert.id)} name={f.expert.name} />
                <span className="text-[12.5px] font-semibold">Summary failed</span>
                <span className="flex items-center gap-[6px] text-[11.5px] text-error-soft">
                    <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-error" />
                    Failed in round {f.round}
                </span>
            </div>
            <span data-council-failed-error className="break-words text-[12px] leading-[1.5] text-secondary">
                {f.error}
            </span>
            <span className="text-[11.5px] text-muted">The discussion is kept. Retry runs the summary again.</span>
            <RetryButton expertId={f.expert.id} label="Retry the summary" acts={acts} c={c} />
        </div>
    );
}

// what went wrong and can be retried, above the thread (the experts' own cards show theirs in round 1)
function FailureNotes({ c, acts, withExperts }: { c: Council; acts: Actions; withExperts: boolean }) {
    const coordinator = coordinatorFailure(c);
    const experts = withExperts ? failedExperts(c) : [];
    const note = retriedOut(c)
        ? "Every failed call was retried. Summarize to finish this council."
        : c.state === "failed" && c.error && coordinator == null && failedExperts(c).length === 0
          ? c.error
          : null;
    if (coordinator == null && experts.length === 0 && note == null) {
        return null;
    }
    return (
        <div data-council-failures className="flex flex-col gap-2">
            {note != null && <span className="text-[12px] text-secondary">{note}</span>}
            {experts.map((f) => (
                <ExpertFailureCard key={f.expert.id} c={c} f={f} acts={acts} />
            ))}
            {coordinator != null && <SummaryFailedPanel c={c} f={coordinator} acts={acts} />}
        </div>
    );
}

// ---- round 1: the experts' cards and the proposals as they arrive ----

const DOT: Record<CardDot, string> = {
    working: "bg-working pulse-dot",
    done: "bg-success/45",
    failed: "bg-error",
    waiting: "bg-ink-faint",
};

function ExpertCard({ c, e, acts }: { c: Council; e: CouncilExpert; acts: Actions }) {
    const state = expertCard(c, e);
    const failure = c.failed?.[e.id];
    const stat = expertStat(c, e.id);
    return (
        <div
            data-council-expert-card={e.id}
            className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-edge-mid bg-surface-raised px-3 py-[10px]"
        >
            <div className="flex items-center gap-2">
                <CouncilAvatar tone={avatarTone(c, e.id)} name={e.name} />
                <span className="truncate text-[12.5px] font-semibold">{e.name}</span>
                <span className="text-[11px] text-muted">{e.model}</span>
            </div>
            <div
                data-dot={state.dot}
                className={cn(
                    "flex min-w-0 items-center gap-[6px] text-[11.5px]",
                    state.dot === "working"
                        ? "text-primary"
                        : state.dot === "failed"
                          ? "text-error-soft"
                          : "text-secondary"
                )}
            >
                <span aria-hidden className={cn("h-[6px] w-[6px] flex-none rounded-full", DOT[state.dot])} />
                <span data-council-expert-state className="min-w-0 truncate" title={state.text}>
                    {state.text}
                </span>
            </div>
            {failure != null && (
                <span data-council-failed-error className="break-words text-[11.5px] leading-[1.45] text-secondary">
                    {failure.error}
                </span>
            )}
            {stat !== "" && (
                <span data-council-expert-stat className="text-[10.5px] tabular-nums text-muted">
                    {stat}
                </span>
            )}
            {failure != null && <RetryButton expertId={e.id} label={`Retry ${e.name}`} acts={acts} c={c} />}
        </div>
    );
}

function ProposalsSoFar({ c }: { c: Council }) {
    const proposals = c.proposals ?? [];
    return (
        <>
            <div className="flex items-center gap-[10px]">
                <span className={SECTION_LABEL}>Proposals so far</span>
                <span className="text-[10.5px] tabular-nums text-muted">{proposals.length}</span>
                <div className="h-px flex-1 bg-edge-faint" />
            </div>
            {proposals.length === 0 && <span className="text-[12px] text-muted">No proposals yet.</span>}
            {proposals.map((p) => (
                <div
                    key={p.id}
                    data-council-arrived={p.id}
                    className="flex items-start gap-[10px] rounded-[10px] border border-border bg-surface px-3 py-[10px]"
                >
                    <CouncilAvatar
                        tone={avatarTone(c, p.author)}
                        name={c.experts.find((e) => e.id === p.author)?.name ?? p.author}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-muted">{p.id}</span>
                            <span className="text-[13px] font-semibold">{p.title}</span>
                        </div>
                        <span className="text-[12px] leading-[1.5] text-secondary">{p.argument}</span>
                        <EvidenceChips evidence={p.evidence} />
                    </div>
                </div>
            ))}
        </>
    );
}

function ExpertsBody({ c, acts }: { c: Council; acts: Actions }) {
    const running = c.state === "running";
    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
            <div className="flex max-w-[900px] flex-col gap-4">
                <FailureNotes c={c} acts={acts} withExperts={false} />
                <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2">
                    {panel(c).map((e) => (
                        <ExpertCard key={e.id} c={c} e={e} acts={acts} />
                    ))}
                </div>
                <ProposalsSoFar c={c} />
                {running && (
                    <>
                        <div aria-hidden className="flex flex-col gap-[7px]">
                            <span className="h-[58px] rounded-[10px] bg-surface opacity-60" />
                            <span className="h-[58px] rounded-[10px] bg-surface opacity-35" />
                        </div>
                        <span className="text-[11.5px] text-muted">
                            The ranked directions appear here after round 3. You can leave; the Council row in the tree
                            turns to Done.
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}

// ---- the pause ----

function PauseRow({ c, p, kept, onToggle }: { c: Council; p: CouncilProposal; kept: boolean; onToggle: () => void }) {
    return (
        <label
            data-council-pause-row={p.id}
            data-kept={kept ? "true" : "false"}
            className="flex cursor-pointer items-center gap-[10px] border-t border-border px-3 py-[10px] first:border-t-0"
        >
            <input
                type="checkbox"
                checked={kept}
                onChange={onToggle}
                aria-label={`Keep ${p.id}: ${p.title}`}
                className="peer sr-only"
            />
            <span
                aria-hidden
                className={cn(
                    "box-border flex h-[16px] w-[16px] flex-none items-center justify-center rounded-[4px] border-[1.5px] peer-focus-visible:ring-2 peer-focus-visible:ring-accent",
                    kept ? "border-accent bg-accent text-background" : "border-edge-strong text-transparent"
                )}
            >
                <Check size={11} strokeWidth={3} />
            </span>
            <CouncilAvatar
                tone={avatarTone(c, p.author)}
                name={c.experts.find((e) => e.id === p.author)?.name ?? p.author}
                dim={!kept}
            />
            <span className="w-[24px] flex-none text-[11px] font-bold text-muted">{p.id}</span>
            <span
                data-council-pause-title
                className={cn("min-w-0 flex-1 text-[13px]", kept ? "text-primary" : "text-muted line-through")}
            >
                {p.title}
            </span>
            <span className="text-[11px] text-muted">{p.evidence?.find((e) => !e.weak && e.ref)?.ref ?? ""}</span>
        </label>
    );
}

function PauseBody({ c, acts }: { c: Council; acts: Actions }) {
    const [draft, setDraft] = useAtom(councilPauseAtom(c.id));
    const est = useEstimate({ id: c.id });
    const proposals = c.proposals ?? [];
    const question = draft.question.trim();
    const go = async () => {
        const ok = await acts.run("continue", "Continue", () =>
            continueCouncil({ id: c.id, cut: draft.cut, question: question === "" ? undefined : question })
        );
        if (ok) {
            setDraft({ cut: [], question: "" });
        }
    };
    return (
        <div data-council-pause className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
            <div className="flex max-w-[900px] flex-col gap-3">
                <p className="m-0 text-[13.5px] leading-[1.55] text-ink-hi">
                    Round 1 brought {proposals.length} {proposals.length === 1 ? "proposal" : "proposals"}. Untick the
                    ones not worth a review; round 2 reads only the ones you keep, and anything you ask below.
                </p>
                <div className="flex flex-col rounded-[10px] border border-border bg-surface">
                    {proposals.map((p) => (
                        <PauseRow
                            key={p.id}
                            c={c}
                            p={p}
                            kept={!draft.cut.includes(p.id)}
                            onToggle={() => setDraft({ ...draft, cut: toggleCut(draft.cut, p.id) })}
                        />
                    ))}
                </div>
                <label className="flex flex-col gap-[6px] pt-[6px]">
                    <span className={SECTION_LABEL}>Ask the experts</span>
                    <textarea
                        data-council-pause-ask
                        rows={3}
                        value={draft.question}
                        onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                        className="box-border w-full resize-none rounded-[6px] border border-edge-strong bg-surface px-[10px] py-2 text-[13px] leading-[1.5] text-primary outline-none focus:border-accent"
                    />
                    <span className="text-[11.5px] text-muted">
                        Every expert answers it in round 2, beside their review of the kept proposals.
                    </span>
                </label>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                        type="button"
                        data-council-continue
                        disabled={!canContinue(c, draft.cut) || acts.busy.has("continue")}
                        title={canContinue(c, draft.cut) ? undefined : "Keep at least one proposal"}
                        onClick={() => void go()}
                        className={primaryButton}
                    >
                        {acts.busy.has("continue") ? "Continuing…" : "Continue to round 2"}
                    </button>
                    <button
                        type="button"
                        data-council-stop-here
                        disabled={acts.busy.has("stop")}
                        onClick={() => void acts.run("stop", "Stop", () => stopCouncil(c.id))}
                        className={secondaryButton}
                    >
                        Stop here and keep round 1
                    </button>
                    <span data-council-remaining className="text-[11.5px] tabular-nums text-muted">
                        {est != null ? `Rounds 2 and 3: ${estimateLabel(est, false)}` : ""}
                    </span>
                </div>
                {keptProposals(c, draft.cut).length === 0 && (
                    <span className="text-[11.5px] text-warning-soft">
                        Nothing is kept. Tick a proposal, or stop here and keep round 1.
                    </span>
                )}
            </div>
        </div>
    );
}

// ---- a council the gate did not run ----

function NotRunBody({ c, acts }: { c: Council; acts: Actions }) {
    const est = useEstimate({ project: c.project, files: c.files, experts: c.experts });
    return (
        <div data-council-notrun className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            <div className="flex max-w-[640px] flex-col gap-3">
                <p className="m-0 text-[14px] font-semibold">This council has not run</p>
                <p className="m-0 text-[13px] leading-[1.55] text-ink-hi">
                    The token gate did not run it when it was asked for, so no expert was called. Starting it here is
                    the yes.
                </p>
                <span data-council-estimate className="text-[12px] tabular-nums text-secondary">
                    {est != null ? estimateLabel(est) : "Estimating…"}
                </span>
                <div>
                    <button
                        type="button"
                        data-council-start
                        disabled={acts.busy.has("start")}
                        onClick={() => void acts.run("start", "Start council", () => startSavedCouncil(c.id))}
                        className={primaryButton}
                    >
                        {acts.busy.has("start") ? "Starting…" : "Start council"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---- the thread and the proposals beside it ----

function ProposalRow({
    c,
    row,
    selected,
    onOpen,
}: {
    c: Council;
    row: RankedProposal;
    selected: boolean;
    onOpen: () => void;
}) {
    const p = row.proposal;
    const out = p.withdrawn || p.cut;
    return (
        <button
            type="button"
            data-council-proposal={p.id}
            data-selected={selected ? "true" : "false"}
            data-withdrawn={p.withdrawn ? "true" : undefined}
            aria-current={selected ? "true" : undefined}
            onClick={onOpen}
            className={cn(
                "flex w-full cursor-pointer gap-[10px] rounded-[8px] border px-[10px] py-[9px] text-left outline-none focus-visible:ring-2 focus-visible:ring-accent",
                selected
                    ? "border-edge-strong bg-surface-selected"
                    : out
                      ? "border-border bg-background"
                      : "border-border bg-surface hover:bg-surface-hover"
            )}
        >
            <span
                className={cn(
                    "flex w-[22px] flex-none flex-col items-center text-[12px] font-bold tabular-nums",
                    row.score < 0 ? "text-error-soft" : out ? "text-muted" : "text-success-soft"
                )}
            >
                <ArrowBigUp size={12} strokeWidth={2.2} aria-hidden />
                <span data-council-proposal-score>{row.score}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className={cn("text-[12px] font-semibold leading-[1.35]", out ? "text-muted" : "text-primary")}>
                    {p.title}
                </span>
                <span className="flex items-center gap-[5px] text-[10.5px] text-muted">
                    <span
                        aria-hidden
                        data-council-live={row.replying > 0 ? "true" : undefined}
                        className={cn(
                            "h-[5px] w-[5px] flex-none rounded-full",
                            row.replying > 0 ? "bg-working pulse-dot" : "bg-transparent"
                        )}
                    />
                    {proposalLine(c, row)}
                </span>
            </span>
        </button>
    );
}

function ThreadBody({ c, acts }: { c: Council; acts: Actions }) {
    const ranked = rankedProposals(c);
    const [openId, setOpenId] = useAtom(councilOpenProposalAtom(c.id));
    const [composer, setComposer] = useAtom(councilComposerAtom(c.id));
    const open = (ranked.find((r) => r.proposal.id === openId) ?? ranked[0])?.proposal;

    const here = (proposalId: string, parentId: string) =>
        composer != null && composer.proposalId === proposalId && composer.parentId === parentId;
    const startReply = (proposalId: string, parentId: string) => {
        if (!here(proposalId, parentId)) {
            setComposer({ proposalId, parentId, text: "", tools: false });
        }
    };
    const renderComposer = (proposalId: string, parentId: string): ReactNode =>
        composer != null && here(proposalId, parentId) ? (
            <CouncilComposer c={c} draft={composer} onChange={setComposer} onClose={() => setComposer(null)} />
        ) : null;

    return (
        <div className="flex min-h-0 flex-1 gap-6 px-8 py-4">
            <div
                data-council-main
                className="flex min-h-0 min-w-0 max-w-[760px] flex-1 flex-col gap-3 overflow-y-auto pr-1"
            >
                <FailureNotes c={c} acts={acts} withExperts />
                {open != null && (
                    <>
                        <ProposalPost
                            c={c}
                            proposal={open}
                            onReply={() => startReply(open.id, "")}
                            composer={renderComposer(open.id, "")}
                        />
                        <ThreadView
                            c={c}
                            proposalId={open.id}
                            renderComposer={renderComposer}
                            onReply={(replyId) => startReply(open.id, replyId)}
                        />
                    </>
                )}
            </div>
            <aside data-council-proposals className="flex min-h-0 w-[270px] flex-none flex-col gap-2 overflow-y-auto">
                <button
                    type="button"
                    data-council-ask-all
                    onClick={() => startReply("", "")}
                    className="flex h-[34px] w-full flex-none cursor-pointer items-center gap-2 rounded-[8px] border border-edge-mid bg-surface px-[10px] text-left text-[12px] text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <MessageCircle size={13} strokeWidth={1.8} aria-hidden />
                    Ask the whole council
                </button>
                {renderComposer("", "")}
                <span className={cn(SECTION_LABEL, "pt-[6px]")}>Proposals</span>
                {ranked.map((row) => (
                    <ProposalRow
                        key={row.proposal.id}
                        c={c}
                        row={row}
                        selected={row.proposal.id === open?.id}
                        onOpen={() => setOpenId(row.proposal.id)}
                    />
                ))}
            </aside>
        </div>
    );
}
