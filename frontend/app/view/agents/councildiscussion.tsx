// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council Discussion (Main.dc.html, Running.dc.html, Paused.dc.html, M1-discussion-tab.dc.html): a header in one 52px
// row (the Report / Discussion / Map tabs, the mode, the feature, the step chip, the seats' stack, its list the filters
// and each seat's timeline, the cost line, Summarize while there is a summary to make, Stop council, and Pin), and a body that
// depends on where the council is. Once the seats have proposed it is the chat (councilchat.tsx): a channel of messages
// beside the Ideas rail, whose second tab is an idea's thread, for a council that runs its replies or its summary, one
// that is over, and one that waits on the drafts of its seats; while
// the experts first read and propose it is each expert's card with what it is reading (a button: it opens that seat's
// timeline) and the ideas as they arrive; at
// the pause it is the ticks and the question for the argument; a council the token gate did not run offers Start
// council, and one that waits for the running council says so. The words are plain ones: no proposal id or stance word
// is drawn (the wire's stay in the data-council-* attributes). A failed expert shows its error with Retry, a failed
// coordinator a Summary failed panel. Status is a dot and a word, never colour alone. Every control carries a
// data-council-* attribute for the CDP scenario `council-discussion`. The rules are in councildiscussionmodel.ts,
// councilchatmodel.ts and councilmodel.ts; the store's actions answer `{ ok, error }`, and a refusal shows in place.

import { reopenSession } from "@/app/cockpit/cockpit-actions";
import { openFileInCode } from "@/app/cockpit/openfilestore";
import { viewFade } from "@/app/element/motiontokens";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue, useSetAtom, type PrimitiveAtom } from "jotai";
import { atomFamily, selectAtom } from "jotai/utils";
import { Check, ListChecks, Square, X } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { showCouncil } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { useActions, type Actions } from "./councilactions";
import { CouncilAvatar, CouncilChat, CouncilText } from "./councilchat";
import { chipShort, councilThread, stepChip } from "./councilchatmodel";
import {
    avatarTone,
    callBarLabel,
    canContinue,
    coordinatorFailure,
    discussionBody,
    expertCard,
    failedExperts,
    failedWhile,
    isQueued,
    keptProposals,
    railHoldsDetails,
    retriedOut,
    seatInitials,
    summarizeAction,
    toggleCut,
    type CardDot,
    type DiscussionBody,
    type FailedExpert,
} from "./councildiscussionmodel";
import { CouncilHeaderRow } from "./councilheader";
import { mapWords } from "./councilmapmodel";
import {
    callSegments,
    canSummarize,
    estimateLabel,
    expertStat,
    panel,
    queuedLine,
    summarizeHold,
    type SeatableAgent,
    type SegmentState,
} from "./councilmodel";
import { RetryWithButton } from "./councilretrymenu";
import { seatableAgents } from "./councilsetupmodel";
import { claimOf } from "./councilsources";
import { EvidenceChips } from "./councilsourcespanel";
import {
    continueCouncil,
    councilIdeasRailFoldedAtom,
    councilOpenProposalAtom,
    councilSelAtom,
    councilSourcesAtom,
    councilTimelineAtom,
    retryExpert,
    startSavedCouncil,
    stopCouncil,
    summarizeCouncil,
    useCouncil,
    useEstimate,
} from "./councilstore";
import { projectsAtom } from "./projectsstore";

const ROOT = "flex min-h-0 min-w-0 flex-1 flex-col bg-background text-[14px] text-primary";

const SECTION_LABEL = "text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted";

const secondaryButton =
    "h-[30px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[12px] text-[13.5px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

const primaryButton =
    "h-[30px] cursor-pointer rounded-[6px] border-0 bg-accent px-[14px] text-[13.5px] font-semibold text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

// ---- state the view keeps ----

/** The pause's ticks and question, per council, so they survive a trip to another view. */
interface PauseDraft {
    cut: string[]; // the proposals the person unticked
    question: string;
}

const councilPauseAtom = atomFamily(
    (_id: string) => atom<PauseDraft>({ cut: [], question: "" }) as PrimitiveAtom<PauseDraft>
);

// ---- the view ----

export function CouncilDiscussion({ model }: { model: AgentsViewModel }) {
    const id = useAtomValue(councilSelAtom);
    const c = useCouncil(id);
    if (c == null) {
        return (
            <div data-council-discussion className={cn(ROOT, "items-center justify-center text-muted")}>
                {id == null ? "No council is open." : "Loading the council…"}
            </div>
        );
    }
    return <Discussion key={c.id} c={c} model={model} />;
}

const sameChats = (a: readonly SeatableAgent[], b: readonly SeatableAgent[]) =>
    a.length === b.length &&
    a.every(
        (x, i) =>
            x.id === b[i].id &&
            x.name === b[i].name &&
            x.project === b[i].project &&
            x.harness === b[i].harness &&
            x.context === b[i].context
    );

// The live claude and pi chats a message in the council can add with `@` (the cockpit's roster, which Setup's Add agent
// reads too, by the one seat rule). The roster changes on every agent's state tick, so the list is picked out of it
// and the view re-renders only when a chat, its name, project or context changes.
function useLiveChats(model: AgentsViewModel, project: string): readonly SeatableAgent[] {
    const chatsAtom = useMemo(
        () =>
            selectAtom(
                atom((get) => seatableAgents(get(model.agentsAtom), get(projectsAtom), project)),
                (chats) => chats,
                sameChats
            ),
        [model.agentsAtom, project]
    );
    return useAtomValue(chatsAtom);
}

function Discussion({ c, model }: { c: Council; model: AgentsViewModel }) {
    const acts = useActions();
    const chats = useLiveChats(model, c.project);
    const body = discussionBody(c);
    return (
        <div data-council-discussion={c.id} data-council-id={c.id} data-council-state={c.state} className={ROOT}>
            <Header c={c} body={body} acts={acts} onOpenTerminal={(tab) => model.openTerminal(tab)} />
            {/* the body fades in as the view opens (a tab click, a council picked); the header stays put */}
            <motion.div
                variants={viewFade}
                initial="initial"
                animate="animate"
                className="flex min-h-0 flex-1 flex-col"
            >
                {isQueued(c) ? (
                    <QueuedBody c={c} />
                ) : body === "not-run" ? (
                    <NotRunBody c={c} acts={acts} />
                ) : body === "pause" ? (
                    <PauseBody c={c} acts={acts} />
                ) : body === "experts" ? (
                    <ExpertsBody c={c} acts={acts} />
                ) : (
                    <CouncilChat
                        c={c}
                        acts={acts}
                        chats={chats}
                        notes={<FailureNotes c={c} acts={acts} withExperts={false} />}
                        onOpenTerminal={(tab) => model.openTerminal(tab)}
                        onReopenSession={(transcript) => fireAndForget(() => reopenSession(model, transcript))}
                        onOpenFile={(path, line) => fireAndForget(() => openFileInCode(model, path, false, line))}
                    />
                )}
            </motion.div>
        </div>
    );
}

// ---- the header ----

// the step chip's colours by its dot: amber while the council waits on the person, green while it runs, red when it failed
const CHIP_TONE = {
    working: { box: "bg-pill text-secondary", dot: "bg-working pulse-dot" },
    waiting: { box: "bg-askingbg text-warning-soft", dot: "bg-asking" },
    failed: { box: "bg-error/12 text-error-soft", dot: "bg-error" },
    idle: { box: "bg-pill text-secondary", dot: "bg-ink-faint" },
};

// the step in its short words (`Round 1/2`), whole: the title wraps before it would shrink. The full words are its hover and
// what a screen reader hears (and what `data-council-chip` reads)
function StatusChip({ c }: { c: Council }) {
    const chip = stepChip(c);
    const tone = CHIP_TONE[chip.dot];
    return (
        <span
            title={chip.text}
            className={cn(
                "inline-flex flex-none items-center gap-[5px] whitespace-nowrap rounded-full px-[7px] py-[2px] text-[10.5px] tabular-nums",
                tone.box
            )}
        >
            <span aria-hidden className={cn("h-[6px] w-[6px] flex-none rounded-full", tone.dot)} />
            <span aria-hidden>{chipShort(chip.text)}</span>
            <span data-council-chip aria-live="polite" className="sr-only">
                {chip.text}
            </span>
        </span>
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

function Header({
    c,
    body,
    acts,
    onOpenTerminal,
}: {
    c: Council;
    body: DiscussionBody;
    acts: Actions;
    onOpenTerminal: (tab: string) => void;
}) {
    const action = summarizeAction(c);
    const enabled = canSummarize(c);
    const summarizing = acts.busy.has("summarize");
    const summarize = async () => {
        if (action.call && !(await acts.run("summarize", "Summarize", () => summarizeCouncil(c.id)))) {
            return;
        }
        showCouncil(c.id, "summary");
    };
    const title = enabled ? "Rank the directions and fill the matrix from the discussion so far" : summarizeHold(c);
    // the call bar is the first step's and the pause's; the chat's seat chips say who is at work
    const showBar = body !== "chat" && ((c.state === "running" && c.round <= 1) || c.state === "awaiting-you");
    // the menu's rows (councilheader.tsx): Summarize while a summary is asked for, Stop while the council runs
    const items: ContextMenuItem[] = action.call
        ? [
              {
                  label: summarizing ? "Summarizing…" : action.label,
                  icon: <ListChecks />,
                  enabled: enabled && !summarizing,
                  title,
                  click: () => void summarize(),
                  attrs: { "data-council-summarize": "" },
              },
          ]
        : [];
    const stopping = acts.busy.has("stop");
    // the details sit at the foot of the Ideas rail while it shows; the header's icon holds them otherwise
    const folded = useAtomValue(councilIdeasRailFoldedAtom);
    const openId = useAtomValue(councilOpenProposalAtom(c.id));
    const sources = useAtomValue(councilSourcesAtom(c.id));
    const threadOpen = openId != null && councilThread(c, openId) != null;
    const inRail = railHoldsDetails({
        chat: body === "chat",
        folded,
        threadOpen,
        sourcesOpen: !threadOpen && sources != null,
    });
    const stop: ContextMenuItem | undefined =
        c.state === "running"
            ? {
                  label: stopping ? "Stopping…" : "Stop council",
                  icon: <Square />,
                  danger: true,
                  enabled: !stopping,
                  click: () => void acts.run("stop", "Stop council", () => stopCouncil(c.id)),
                  attrs: { "data-council-stop": "" },
              }
            : undefined;
    return (
        <header className="@container flex flex-none flex-col border-b border-border bg-surface">
            {/* in every body, round 1's too: a round-1 expert card asks the Seats popover for its seat's timeline. The
                Report tab is where a summary opens */}
            <CouncilHeaderRow
                c={c}
                view="discussion"
                details={!inRail}
                titleAttr="data-council-title"
                status={<StatusChip c={c} />}
                items={items}
                stop={stop}
                onOpenTerminal={onOpenTerminal}
            />
            {(showBar || (c.state === "running" && c.round <= 1) || acts.error != null) && (
                // pt keeps the call bar clear of the shown tab's underline at the row's bottom edge
                <div className="flex flex-col gap-2 px-6 pt-[10px] pb-2">
                    {showBar && <CallBar c={c} />}
                    {c.state === "running" && c.round <= 1 && (
                        <span className="self-start text-[12.5px] text-muted">
                            The discussion opens here as ideas arrive. Summarize unlocks after the experts' first ideas.
                        </span>
                    )}
                    {acts.error != null && (
                        <span role="alert" data-council-error className="text-[13px] text-error-soft">
                            {acts.error}
                        </span>
                    )}
                </div>
            )}
        </header>
    );
}

// ---- failures ----

function RetryButton({ expertId, label, acts, c }: { expertId: string; label: string; acts: Actions; c: Council }) {
    const key = `retry:${expertId}`;
    const busy = acts.busy.has(key);
    const running = c.state === "running"; // a retry while it runs is refused: one job at a time
    return (
        <span className="flex items-center gap-[6px] self-start">
            <button
                type="button"
                data-council-retry={expertId}
                aria-label={label}
                disabled={busy || running}
                onClick={() => void acts.run(key, "Retry", () => retryExpert(c.id, expertId))}
                className={cn(secondaryButton, "h-[26px] px-[10px] text-[12.5px]")}
            >
                {busy ? "Retrying…" : "Retry"}
            </button>
            <RetryWithButton
                expert={c.experts.find((e) => e.id === expertId)}
                error={c.failed?.[expertId]?.error}
                disabled={busy || running}
                onPick={(model) => void acts.run(key, "Retry", () => retryExpert(c.id, expertId, model))}
                className={cn(secondaryButton, "h-[26px] px-[8px] text-[12.5px]")}
            />
        </span>
    );
}

function ExpertFailureCard({ c, f, acts }: { c: Council; f: FailedExpert; acts: Actions }) {
    return (
        <div
            data-council-failed={f.expert.id}
            className="flex flex-col gap-[7px] rounded-[10px] border border-error/30 bg-surface-raised px-3 py-[10px]"
        >
            <div className="flex items-center gap-2">
                <CouncilAvatar
                    tone={avatarTone(c, f.expert.id)}
                    name={f.expert.name}
                    initials={seatInitials(c, f.expert.id)}
                />
                <span className="text-[13.5px] font-semibold">{f.expert.name}</span>
                <span className="text-[12px] text-muted">{f.expert.model}</span>
                <span className="flex items-center gap-[6px] text-[12.5px] text-error-soft">
                    <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-error" />
                    {failedWhile(c, f.round)}
                </span>
            </div>
            <span data-council-failed-error className="break-words text-[13px] leading-[1.5] text-secondary">
                {f.error}
            </span>
            <RetryButton expertId={f.expert.id} label={`Retry ${f.expert.name}`} acts={acts} c={c} />
        </div>
    );
}

// A Summary failed panel closed with its ✕, per council: the failure it closed (its round and error), so a new failure
// shows again. The header's Summarize again still reruns the coordinator. Kept for the app's session, outside the
// surface, which unmounts on switch.
const dismissedSummaryFailureAtom = atom<Record<string, string>>({});

function summaryFailureKey(f: FailedExpert): string {
    return `${f.round}|${f.error}`;
}

function SummaryFailedPanel({
    c,
    f,
    acts,
    onDismiss,
}: {
    c: Council;
    f: FailedExpert;
    acts: Actions;
    onDismiss: () => void;
}) {
    return (
        <div
            data-council-summary-failed
            className="flex flex-col gap-[7px] rounded-[10px] border border-error/30 bg-surface-raised px-3 py-[10px]"
        >
            <div className="flex items-center gap-2">
                <CouncilAvatar
                    tone={avatarTone(c, f.expert.id)}
                    name={f.expert.name}
                    initials={seatInitials(c, f.expert.id)}
                />
                <span className="text-[13.5px] font-semibold">Summary failed</span>
                <span className="flex items-center gap-[6px] text-[12.5px] text-error-soft">
                    <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-error" />
                    {failedWhile(c, f.round)}
                </span>
                <button
                    type="button"
                    data-council-summary-dismiss
                    aria-label="Close"
                    title="Close"
                    onClick={onDismiss}
                    className="ml-auto flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <X size={14} aria-hidden />
                </button>
            </div>
            <span data-council-failed-error className="break-words text-[13px] leading-[1.5] text-secondary">
                {f.error}
            </span>
            <span className="text-[12.5px] text-muted">The discussion is kept. Retry runs the summary again.</span>
            <RetryButton expertId={f.expert.id} label="Retry the summary" acts={acts} c={c} />
        </div>
    );
}

// what went wrong and can be retried, above the thread (the experts' own cards show theirs in round 1)
function FailureNotes({ c, acts, withExperts }: { c: Council; acts: Actions; withExperts: boolean }) {
    const [dismissed, setDismissed] = useAtom(dismissedSummaryFailureAtom);
    const failure = coordinatorFailure(c);
    const coordinator = failure != null && dismissed[c.id] !== summaryFailureKey(failure) ? failure : null;
    const experts = withExperts ? failedExperts(c) : [];
    const note = retriedOut(c)
        ? "Every failed call was retried. Summarize to finish this council."
        : c.state === "failed" && c.error && failure == null && failedExperts(c).length === 0
          ? c.error
          : null;
    if (coordinator == null && experts.length === 0 && note == null) {
        return null;
    }
    return (
        <div data-council-failures className="flex flex-col gap-2">
            {note != null && <span className="text-[13px] text-secondary">{note}</span>}
            {experts.map((f) => (
                <ExpertFailureCard key={f.expert.id} c={c} f={f} acts={acts} />
            ))}
            {coordinator != null && (
                <SummaryFailedPanel
                    c={c}
                    f={coordinator}
                    acts={acts}
                    onDismiss={() => setDismissed((d) => ({ ...d, [c.id]: summaryFailureKey(coordinator) }))}
                />
            )}
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

// A round-1 expert's card is a button that opens that seat's timeline in the Seats popover, like the Map's cards. The button
// is the card's invisible cover (a button cannot hold another: a failed seat's Retry sits on top of it, so a press on Retry
// retries and never opens the timeline). The card keeps its look; hover and focus are the cover's.
function ExpertCard({ c, e, acts }: { c: Council; e: CouncilExpert; acts: Actions }) {
    const state = expertCard(c, e);
    const failure = c.failed?.[e.id];
    const stat = expertStat(c, e.id);
    const setTimeline = useSetAtom(councilTimelineAtom(c.id));
    return (
        <div
            data-council-expert-card={e.id}
            className="relative flex min-w-0 flex-col gap-2 rounded-[10px] border border-edge-mid bg-surface-raised px-3 py-[10px] hover:border-edge-strong hover:bg-surface-hover"
        >
            <button
                type="button"
                data-council-expert-card-open={e.id}
                data-council-timeline-trigger
                aria-label={mapWords(c).openTimeline(e.name)}
                onClick={() => setTimeline(e.id)}
                className="absolute inset-0 cursor-pointer rounded-[10px] border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <div className="flex items-center gap-2">
                <CouncilAvatar tone={avatarTone(c, e.id)} name={e.name} initials={seatInitials(c, e.id)} />
                <span className="truncate text-[13.5px] font-semibold">{e.name}</span>
                <span className="text-[12px] text-muted">{e.model}</span>
            </div>
            <div
                data-dot={state.dot}
                className={cn(
                    "flex min-w-0 items-center gap-[6px] text-[12.5px]",
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
                // above the cover, so the error can be selected and copied
                <span
                    data-council-failed-error
                    className="relative break-words text-[12.5px] leading-[1.45] text-secondary"
                >
                    {failure.error}
                </span>
            )}
            {stat !== "" && (
                <span data-council-expert-stat className="text-[10.5px] tabular-nums text-muted">
                    {stat}
                </span>
            )}
            {failure != null && (
                <div className="relative self-start">
                    <RetryButton expertId={e.id} label={`Retry ${e.name}`} acts={acts} c={c} />
                </div>
            )}
        </div>
    );
}

function ProposalsSoFar({ c }: { c: Council }) {
    const proposals = c.proposals ?? [];
    return (
        <>
            <div className="flex items-center gap-[10px]">
                <span className={SECTION_LABEL}>Ideas so far</span>
                <span className="text-[10.5px] tabular-nums text-muted">{proposals.length}</span>
                <div className="h-px flex-1 bg-edge-faint" />
            </div>
            {proposals.length === 0 && <span className="text-[13px] text-muted">No ideas yet.</span>}
            {proposals.map((p) => (
                <div
                    key={p.id}
                    data-council-arrived={p.id}
                    className="flex items-start gap-[10px] rounded-[10px] border border-border bg-surface px-3 py-[10px]"
                >
                    <CouncilAvatar
                        tone={avatarTone(c, p.author)}
                        name={c.experts.find((e) => e.id === p.author)?.name ?? p.author}
                        initials={seatInitials(c, p.author)}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-[14px] font-semibold">{p.title}</span>
                        <CouncilText text={p.argument} className="text-[13px] leading-[1.5] text-secondary" />
                        <EvidenceChips {...claimOf(c, p)} />
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
                        <span className="text-[12.5px] text-muted">
                            The answer appears here once the experts have argued it out. You can leave; the Council row
                            in the tree turns to Done.
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
                aria-label={`Keep: ${p.title}`}
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
                initials={seatInitials(c, p.author)}
                dim={!kept}
            />
            <span
                data-council-pause-title
                className={cn("min-w-0 flex-1 text-[14px]", kept ? "text-primary" : "text-muted line-through")}
            >
                {p.title}
            </span>
            <span className="text-[12px] text-muted">{p.evidence?.find((e) => !e.weak && e.ref)?.ref ?? ""}</span>
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
                <div className="flex items-center gap-[10px]">
                    <span className={SECTION_LABEL}>Ideas so far</span>
                    <span className="text-[10.5px] tabular-nums text-muted">{proposals.length}</span>
                    <div className="h-px flex-1 bg-edge-faint" />
                </div>
                <p className="m-0 text-[15px] leading-[1.55] text-ink-hi">
                    Untick the ideas not worth a review: the argument reads only the ones you keep, and anything you ask
                    below.
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
                        className="box-border w-full resize-none rounded-[6px] border border-edge-strong bg-surface px-[10px] py-2 text-[14px] leading-[1.5] text-primary outline-none focus:border-accent"
                    />
                    <span className="text-[12.5px] text-muted">
                        Every expert answers it while they argue, beside their review of the kept ideas.
                    </span>
                </label>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                        type="button"
                        data-council-continue
                        disabled={!canContinue(c, draft.cut) || acts.busy.has("continue")}
                        title={canContinue(c, draft.cut) ? undefined : "Keep at least one idea"}
                        onClick={() => void go()}
                        className={primaryButton}
                    >
                        {acts.busy.has("continue") ? "Continuing…" : "Continue: let them argue"}
                    </button>
                    <button
                        type="button"
                        data-council-stop-here
                        disabled={acts.busy.has("stop")}
                        onClick={() => void acts.run("stop", "Stop", () => stopCouncil(c.id))}
                        className={secondaryButton}
                    >
                        Stop here and keep these ideas
                    </button>
                    <span data-council-remaining className="text-[12.5px] tabular-nums text-muted">
                        {est != null ? `The rest: ${estimateLabel(est, false)}` : ""}
                    </span>
                </div>
                {keptProposals(c, draft.cut).length === 0 && (
                    <span className="text-[12.5px] text-warning-soft">
                        Nothing is kept. Tick an idea, or stop here and keep these ideas.
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
                <p className="m-0 text-[15px] font-semibold">This council has not run</p>
                <p className="m-0 text-[14px] leading-[1.55] text-ink-hi">
                    The token gate did not run it when it was asked for, so no expert was called. Starting it here is
                    the yes.
                </p>
                <span data-council-estimate className="text-[13px] tabular-nums text-secondary">
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

// ---- a council waiting for the one that runs ----

// the line says which council it waits for and, while that one waits on a busy agent, which agent
function QueuedBody({ c }: { c: Council }) {
    const holder = useCouncil(c.queuedafter || null);
    return (
        <div data-council-queued className="flex min-h-0 flex-1 flex-col gap-1 px-8 py-6 text-[14px] text-secondary">
            <span data-council-queued-line>{queuedLine(holder)}</span>
            <span className="text-[13px] text-muted">It starts when the running council ends.</span>
        </div>
    );
}
