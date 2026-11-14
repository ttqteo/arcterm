// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council report (docs/superpowers/specs/2026-10-22-council-agent-team-design.md "UI", board M-report-cover.dc.html):
// the header row the three views share (councilheader.tsx: the tabs, the title, the step chip and, on the Report alone,
// the mode, the clock, the replies and the tokens; jump links to the sections below, the seats, and the one `⋯` menu:
// Save as doc or Open the document, Create initiative, Run again, then Resume and Pin) over one scroll box. In the box the
// cover: the title, what was asked, the answer in one bold sentence with the coordinator's text under it, and a glance
// box beside them: the state, three figures, the panel with each model and what each seat did (a click opens the
// Discussion on that seat's messages alone), and where the council saved itself, docs/council/, a click or the `⋯` menu
// opening that document. Under the cover the body: the directions as cards (one open at a
// time, its detail under the grid: the coordinator's reasoning and each expert's position), and at the bottom one line that
// opens the Map tab, where every idea stands against every expert. A finished council opens on it; Summarize on the
// Discussion opens it too, and the Discussion tab goes back. A Brainstorm's report heads its directions "Ideas worth trying, best first" (each with a first
// step and who had and built on it) and keeps the wild ideas aside under them with a count of the rest. A Review's report
// shows every direction it ranked and lists the rest under Also raised. Both keep their kept ideas folded behind the
// heading and count until a click opens them. While a seat message is pinned
// (the Discussion's Pin to Report), the Final proposal section follows the directions and the kept ideas, summary or not.
// Under the directions a quiet row asks "Was this
// useful?" (Useful / Not really) and feeds the answer to the council benchmark. What it derives from the council is
// councilsummarymodel.ts (and councilmodel.ts); what it hands on is a saved doc, an initiative, a Setup draft to run
// again, the Discussion on one direction's thread, and a new agent started on it.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { useCopyFeedback } from "@/app/element/copyfeedback";
import { viewFade } from "@/app/element/motiontokens";
import { Tooltip } from "@/app/element/tooltip";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { loadBriefingAsync, stateRpcTimeoutMs } from "@/app/view/jarvis/briefingstore";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn } from "@/util/util";
import { atom, useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import {
    ArrowRight,
    Check,
    ChevronDown,
    ChevronUp,
    Code,
    Contrast,
    Copy,
    CornerDownRight,
    FileText,
    LayoutGrid,
    Loader2,
    MessageSquare,
    PinOff,
    TriangleAlert,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { showCouncil, showCouncilSetup } from "./agentcenter";
import { openRefInCode } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import { CouncilAvatar, CouncilText } from "./councilchat";
import { askChips } from "./councilchatmodel";
import { ClaimBadgeChip, WrongCiteChip } from "./councilchecks";
import { avatarTone, modeWord, seatInitials } from "./councildiscussionmodel";
import { finalProposal, type FinalProposal } from "./councilfinalmodel";
import { CouncilHeaderRow } from "./councilheader";
import { useKeptScroll } from "./councilkeptscroll";
import { mapWords } from "./councilmapmodel";
import {
    STANCE_WORD,
    askedParts,
    councilLang,
    draftFromCouncil,
    glanceFigures,
    outdatedChanges,
    outdatedCount,
    summaryFacts,
    synthesisRound,
    type CouncilLang,
    type StanceLabel,
} from "./councilmodel";
import { RetryWithButton } from "./councilretrymenu";
import { revealCouncilMessage } from "./councilreveal";
import { claimBadge, isWrongCite, wrongCiteOf } from "./councilsources";
import {
    councilChatDraftAtom,
    councilOpenProposalAtom,
    councilSelAtom,
    finalPickCouncil,
    rateCouncil,
    retryExpert,
    saveCouncilDoc,
    summarizeCouncil,
    useCouncil,
} from "./councilstore";
import {
    answerParts,
    brainstormPrompt,
    canRunSummary,
    directionRows,
    directionsHeading,
    docAction,
    docPathLabel,
    droppedLine,
    evidenceLabel,
    expertActivity,
    initiativeSeed,
    isWeakEvidence,
    jumpLinks,
    keptHeading,
    keptRows,
    outdatedLabel,
    projectNameOf,
    ratingRow,
    savedLine,
    summarizerName,
    writtenLine,
    type CouncilRating,
    type DirectionRow,
    type KeptRow,
    type OutlineEntry,
    type Position,
} from "./councilsummarymodel";
import { runtimeStartupCommand } from "./launch";
import { projectListAtom } from "./projectsstore";

// what the Summary keeps for a council while the person is elsewhere (the Agent surface stays mounted, this view does not)
const openDirectionAtom = atomFamily((_id: string) => atom<number | null>(null) as PrimitiveAtom<number | null>);
const savedDocAtom = atomFamily((_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>);
// whether the ideas kept aside (Also raised) are unfolded: the header's jump link to them opens them too
const keptOpenAtom = atomFamily((_id: string) => atom(false) as PrimitiveAtom<boolean>);
interface MadeInitiative {
    oid: string;
    title: string;
    chunks: number;
}
const initiativeAtom = atomFamily(
    (_id: string) => atom<MadeInitiative | null>(null) as PrimitiveAtom<MadeInitiative | null>
);

const STANCE_PILL: Record<StanceLabel, string> = {
    accept: "bg-success/12 text-success-soft",
    challenge: "bg-warning/12 text-warning-soft",
    oppose: "bg-error/12 text-error-soft",
    proposed: "bg-pill text-secondary",
};

// a card's avatar of an expert that took a stance is ringed in its colour; one that only proposed is not
const STANCE_RING: Record<StanceLabel, string> = {
    accept: "ring-[1.5px] ring-success",
    challenge: "ring-[1.5px] ring-warning",
    oppose: "ring-[1.5px] ring-error",
    proposed: "",
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const BUTTON = cn(
    "flex h-[28px] flex-none cursor-pointer items-center rounded-md border border-edge-mid bg-surface-raised px-3 text-[13px] text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50 disabled:hover:border-edge-mid disabled:hover:bg-surface-raised",
    FOCUS
);
const PRIMARY = cn(
    "flex h-[28px] flex-none cursor-pointer items-center rounded-md bg-accent px-3 text-[13px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-accent",
    FOCUS
);

// The Discussion's avatar, in the colour avatarTone gives the expert. It is decorative here (the name is always beside
// it, so a screen reader skips the letters).
function Avatar({
    c,
    id,
    name,
    small,
    className,
}: {
    c: Council;
    id: string;
    name: string;
    small?: boolean;
    className?: string;
}) {
    return (
        <span aria-hidden className="flex flex-none">
            <CouncilAvatar
                tone={avatarTone(c, id)}
                name={name}
                initials={seatInitials(c, id)}
                small={small}
                className={className}
            />
        </span>
    );
}

function StancePill({ stance }: { stance: StanceLabel }) {
    return (
        <span
            className={cn(
                "flex-none self-start rounded-full px-[7px] py-px text-[10px] font-semibold",
                STANCE_PILL[stance]
            )}
        >
            {STANCE_WORD[stance]}
        </span>
    );
}

function EvidenceChip({ evidence, lang, checked }: { evidence: CouncilEvidence; lang: CouncilLang; checked: boolean }) {
    const weak = isWeakEvidence(evidence, checked);
    if (isWrongCite(evidence)) {
        // a cite Go found wrong keeps its place among the chips, as the Wrong cite chip with Go's note
        return <WrongCiteChip cite={wrongCiteOf(evidence, lang)} className="text-[12px]" />;
    }
    return (
        <span
            data-council-evidence={weak ? "weak" : "ref"}
            className={cn(
                "inline-flex items-center gap-[5px] rounded-[6px] border bg-surface px-2 py-[2px] text-[12px]",
                weak ? "border-warning/40 text-warning-soft" : "border-edge-mid text-secondary"
            )}
        >
            {weak ? <TriangleAlert size={11} aria-hidden /> : <Code size={11} aria-hidden />}
            {evidenceLabel(evidence, checked)}
        </span>
    );
}

function PositionView({ c, position }: { c: Council; position: Position }) {
    const lang = councilLang(c);
    // the claim's badge leads its evidence row, as it does in the Discussion; a position Go did not label has none
    const badge = claimBadge(position.label, lang);
    return (
        <div data-council-position={position.expert.id} className="flex gap-[10px]">
            <Avatar c={c} id={position.expert.id} name={position.expert.name} className="text-[12px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-primary">{position.expert.name}</span>
                    <StancePill stance={position.stance} />
                </div>
                {position.text !== "" ? (
                    <CouncilText text={position.text} className="text-[13.5px] leading-[1.5]" />
                ) : null}
                {badge != null || position.evidence.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-[6px]">
                        {badge != null && <ClaimBadgeChip badge={badge} className="h-auto py-[2px] text-[12px]" />}
                        {position.evidence.map((e, i) => (
                            <EvidenceChip key={i} evidence={e} lang={lang} checked={position.label !== ""} />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

// one idea as a card of the grid: the rank, its tag, the title, the coordinator's first step, who had it and the stance
// of each expert. One card is open at a time; its detail (DirectionDetail) sits under the grid.
function DirectionCard({
    c,
    row,
    open,
    onToggle,
}: {
    c: Council;
    row: DirectionRow;
    open: boolean;
    onToggle: () => void;
}) {
    const d = row.direction;
    return (
        <button
            type="button"
            data-council-direction={d.rank}
            data-council-direction-toggle
            aria-expanded={open}
            aria-controls={open ? `council-direction-${d.rank}` : undefined}
            onClick={onToggle}
            className={cn(
                "flex min-w-0 cursor-pointer flex-col gap-3 rounded-lg border p-[18px] text-left",
                open
                    ? "border-edge-strong bg-surface-hover"
                    : "border-edge-mid bg-surface-raised hover:border-edge-strong",
                FOCUS
            )}
        >
            <span className="flex w-full items-start gap-[10px]">
                <span className="text-[30px] font-semibold leading-none tabular-nums text-muted">{d.rank}</span>
                <span className="flex-1" />
                <span
                    data-council-tag
                    className={cn(
                        "flex flex-none items-center gap-[5px] rounded-full px-2 py-[2px] text-[11px] font-semibold",
                        row.tag === "Everyone agrees"
                            ? "bg-success/12 text-success-soft"
                            : "bg-askingbg text-warning-soft"
                    )}
                >
                    <Contrast size={12} aria-hidden />
                    {row.tag}
                </span>
            </span>
            <span data-council-title className="text-[16.5px] font-semibold leading-[1.4] text-primary">
                {d.title}
            </span>
            {row.step !== "" ? (
                <span data-council-first-step className="flex flex-col gap-1 rounded-lg bg-surface px-3 py-[11px]">
                    <span className="flex items-center gap-[6px] text-[12px] font-semibold text-muted">
                        <CornerDownRight size={13} aria-hidden />
                        First step
                    </span>
                    <span className="text-[13.5px] leading-[1.5] text-ink-hi">{row.step}</span>
                </span>
            ) : null}
            <span data-council-direction-footer className="mt-auto flex w-full items-end gap-2">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[10px] gap-y-[6px]">
                    {row.chips.length > 0 ? (
                        <span data-council-chips className="flex flex-none items-center gap-[4px]">
                            {row.chips.map((chip) => (
                                // one avatar per expert: who proposed it is plain, a stance rings it in its colour;
                                // the name and the stance are on hover (and read out), the tag above says the verdict
                                <span
                                    key={chip.expert.id}
                                    data-council-chip={chip.expert.id}
                                    data-council-chip-stance={chip.stance}
                                    role="img"
                                    aria-label={`${chip.expert.name}: ${STANCE_WORD[chip.stance]}`}
                                    title={`${chip.expert.name}: ${STANCE_WORD[chip.stance]}`}
                                    className={cn("flex rounded-full", STANCE_RING[chip.stance])}
                                >
                                    <Avatar c={c} id={chip.expert.id} name={chip.expert.name} small />
                                </span>
                            ))}
                        </span>
                    ) : null}
                    {row.meta !== "" ? (
                        <span data-council-meta className="text-[12.5px] text-muted">
                            {row.meta}
                        </span>
                    ) : null}
                </span>
                {open ? (
                    <ChevronUp
                        size={14}
                        aria-hidden
                        data-council-direction-chevron
                        className="mb-[1px] flex-none text-muted"
                    />
                ) : (
                    <ChevronDown
                        size={14}
                        aria-hidden
                        data-council-direction-chevron
                        className="mb-[1px] flex-none text-muted"
                    />
                )}
            </span>
        </button>
    );
}

// the open card's detail under the grid: why the summarizer picked it, each expert's position, and what to do with it
function DirectionDetail({
    c,
    row,
    busy,
    onBrainstorm,
    onAskAgain,
}: {
    c: Council;
    row: DirectionRow;
    busy: boolean;
    onBrainstorm: () => void;
    onAskAgain: () => void;
}) {
    const d = row.direction;
    return (
        <div
            id={`council-direction-${d.rank}`}
            data-council-direction-body
            data-council-direction-detail={d.rank}
            className="flex flex-col gap-[14px] rounded-lg border border-edge-mid bg-surface px-[22px] py-5"
        >
            <span className="text-[12.5px] font-semibold text-muted">
                Idea {d.rank} · why it was picked and who weighed in
            </span>
            {d.reasoning !== "" ? (
                <p data-council-reasoning className="m-0 text-[13.5px] leading-[1.55] text-secondary">
                    <span className="font-semibold">{summarizerName(c)}: </span>
                    {d.reasoning}
                </p>
            ) : null}
            {row.positions.map((p) => (
                <PositionView key={p.expert.id} c={c} position={p} />
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                    type="button"
                    data-council-action="brainstorm"
                    disabled={busy}
                    onClick={onBrainstorm}
                    className={PRIMARY}
                >
                    {busy ? <Loader2 size={12} aria-hidden className="mr-[6px] animate-spin" /> : null}
                    Start an agent on it
                </button>
                <button type="button" data-council-action="ask-again" onClick={onAskAgain} className={BUTTON}>
                    Ask the experts again
                </button>
            </div>
        </div>
    );
}

// a Brainstorm's wild idea kept aside, or a Review's direction also raised: not ranked, so a plain row, no stances and
// nothing to open
function KeptCard({ row }: { row: KeptRow }) {
    const d = row.direction;
    return (
        <div data-council-kept-idea={d.rank} className="flex flex-col gap-[3px] rounded-lg bg-surface px-[18px] py-4">
            <span data-council-title className="text-[15px] font-semibold text-primary">
                {d.title}
            </span>
            {row.meta !== "" ? (
                <span data-council-meta className="text-[12px] text-muted">
                    {row.meta}
                </span>
            ) : null}
            {d.reasoning !== "" ? (
                <span className="text-[13.5px] leading-[1.5] text-secondary">{d.reasoning}</span>
            ) : null}
        </div>
    );
}

// The ideas kept aside under the ranked directions (Also raised, or Wild ideas kept aside): the long tail of the report,
// so it starts folded behind its heading and count, and a click on them opens the grid. The fold is the council's
// (keptOpenAtom), so the header's jump link to this section can open it.
function KeptSection({ c, rows }: { c: Council; rows: KeptRow[] }) {
    const [open, setOpen] = useAtom(keptOpenAtom(c.id));
    const Chevron = open ? ChevronUp : ChevronDown;
    return (
        <section data-council-kept className="flex flex-col gap-4">
            <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-primary">
                <button
                    type="button"
                    data-council-kept-toggle
                    aria-expanded={open}
                    aria-controls={open ? "council-kept-ideas" : undefined}
                    onClick={() => setOpen(!open)}
                    className={cn(
                        "group flex w-fit cursor-pointer items-baseline gap-[10px] rounded-[4px] border-0 bg-transparent p-0 text-left",
                        FOCUS
                    )}
                >
                    <span data-council-kept-heading>{keptHeading(c)}</span>
                    <span data-council-kept-count className="text-[14px] font-medium tabular-nums text-muted">
                        {rows.length}
                    </span>
                    <Chevron size={14} aria-hidden className="self-center text-muted group-hover:text-primary" />
                </button>
            </h2>
            {open ? (
                <div id="council-kept-ideas" className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[14px]">
                    {rows.map((row, i) => (
                        <KeptCard key={`${row.direction.rank}-${i}`} row={row} />
                    ))}
                </div>
            ) : null}
        </section>
    );
}

// "Was this useful?" under the report, a quiet row: the question with Useful and Not really, then a thanks line with a
// Change link that asks again. The answer feeds the council benchmark (rateCouncil); the rule for when it shows is
// ratingRow's. It is keyed by council, so one council's Change state never carries to another.
function RatingRow({ c }: { c: Council }) {
    const [changing, setChanging] = useState(false);
    const [busy, setBusy] = useState<CouncilRating | null>(null);
    const [error, setError] = useState<string | null>(null);
    const row = ratingRow(c, changing);
    if (row == null) {
        return null;
    }
    const rate = async (rating: CouncilRating) => {
        setBusy(rating);
        setError(null);
        const r = await rateCouncil(c.id, rating);
        setBusy(null);
        if (r.ok === false) {
            setError(`Could not save the rating: ${r.error}`);
        } else {
            setChanging(false);
        }
    };
    return (
        <div
            data-council-rating
            className="mt-[6px] flex flex-wrap items-center gap-x-[10px] gap-y-[6px] text-[13px] text-muted"
        >
            <span
                role="status"
                data-council-rating-thanks={row.choices.length === 0 ? "" : undefined}
                className="text-[13px]"
            >
                {row.text}
            </span>
            {row.choices.map((choice) => (
                <button
                    key={choice.id}
                    type="button"
                    data-council-rate={choice.id}
                    disabled={busy != null}
                    onClick={() => void rate(choice.id)}
                    className={cn(BUTTON, "h-[24px] px-[10px] text-[12.5px]")}
                >
                    {busy === choice.id ? <Loader2 size={11} aria-hidden className="mr-[6px] animate-spin" /> : null}
                    {choice.label}
                </button>
            ))}
            {row.change !== "" ? (
                <button
                    type="button"
                    data-council-rating-change
                    onClick={() => setChanging(true)}
                    className={cn("cursor-pointer rounded-[4px] text-[13px] text-accent hover:text-accenthover", FOCUS)}
                >
                    {row.change}
                </button>
            ) : null}
            {error != null ? (
                <span role="alert" data-council-rating-error className="text-error-soft">
                    {error}
                </span>
            ) : null}
        </div>
    );
}

// The report's bottom line: who agrees with which idea is the Map tab's, so the Report keeps one line that opens it. It
// speaks in the council's language, like the Map.
function MapLink({ c }: { c: Council }) {
    return (
        <div data-council-map-link-row className="flex border-t border-edge-faint pt-[18px]">
            <button
                type="button"
                data-council-map-link
                onClick={() => showCouncil(c.id, "map")}
                className={cn(
                    "flex w-fit cursor-pointer items-center gap-[8px] rounded-[6px] py-[3px] pr-[6px] text-left text-[13.5px] font-semibold text-secondary hover:text-primary",
                    FOCUS
                )}
            >
                <LayoutGrid size={14} aria-hidden className="flex-none text-muted" />
                {mapWords(c).reportLink}
                <ArrowRight size={13} aria-hidden className="flex-none text-muted" />
            </button>
        </div>
    );
}

// the dot before the state word in the side column: the word is the status, the dot only draws it
function StateMark({ state }: { state: string }) {
    if (state === "done") {
        return <Check size={12} strokeWidth={2.4} aria-hidden className="text-success" />;
    }
    const tone =
        state === "running"
            ? "bg-working pulse-dot"
            : state === "awaiting-you"
              ? "bg-asking"
              : state === "failed"
                ? "bg-error"
                : "bg-ink-faint";
    return <span aria-hidden className={cn("h-[6px] w-[6px] rounded-full", tone)} />;
}

// this block alone reads the model's clock (a running council's minutes move), so the rest of the Summary does not
// re-draw on every tick
function StateFacts({ model, c }: { model: AgentsViewModel; c: Council }) {
    const now = useAtomValue(model.nowAtom);
    const { state, facts } = summaryFacts(c, now);
    const figures = glanceFigures(c, now);
    return (
        <div className="flex flex-col gap-[14px]">
            <span data-council-state className="flex items-center gap-[6px] font-semibold text-primary">
                <StateMark state={c.state} />
                {state}
            </span>
            <div data-council-facts role="group" aria-label={facts} className="grid grid-cols-3 gap-2">
                {figures.map((f) => (
                    <div key={f.label} className="flex flex-col gap-[2px]">
                        <span className="text-[22px] font-semibold leading-[1.2] tabular-nums text-primary">
                            {f.value}
                        </span>
                        <span className="text-[12px] text-muted">{f.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// where an outline entry's element is in the report: `data-council-section` names the answer, the directions start at
// their heading (a Review's have none: the first direction), and each direction is its card
function sectionOf(box: HTMLElement, id: string): HTMLElement | null {
    if (id.startsWith("direction:")) {
        return box.querySelector(`[data-council-direction="${id.slice("direction:".length)}"]`);
    }
    switch (id) {
        case "directions":
            return (
                box.querySelector("[data-council-directions-heading]") ?? box.querySelector("[data-council-direction]")
            );
        case "kept":
            return box.querySelector("[data-council-kept]");
        default:
            return box.querySelector(`[data-council-section="${id}"]`);
    }
}

// Moves the report's scroll box alone (scrollIntoView would also scroll the surfaces around it): a glide, so the eye
// follows the page down to where it lands, or a jump with reduced motion.
function glideTo(box: HTMLElement, top: number) {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
}

// The header's jump links (board M-report-cover.dc.html), before its seats: a button per section after the answer,
// scrolling the box under the header so the section's top lands 12px under the box's top (as far as it can scroll).
function JumpLinks({ c, scroller }: { c: Council; scroller: RefObject<HTMLDivElement | null> }) {
    const entries = useMemo(() => jumpLinks(c), [c]);
    const [, setKeptOpen] = useAtom(keptOpenAtom(c.id));
    if (entries.length === 0) {
        return null;
    }
    const go = (e: OutlineEntry) => {
        const box = scroller.current;
        const el = box == null ? null : sectionOf(box, e.id);
        if (box == null || el == null) {
            return;
        }
        // the ideas kept aside are what the link is for: it opens their fold, which sits under the heading it lands on
        if (e.id === "kept") {
            setKeptOpen(true);
        }
        glideTo(box, box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 12);
    };
    return (
        <nav aria-label="On this page" className="flex min-w-0 flex-none items-center gap-1 @max-[700px]:hidden">
            {entries.map((e) => (
                <button
                    key={e.id}
                    type="button"
                    data-council-jump={e.id}
                    onClick={() => go(e)}
                    className={cn(
                        "flex h-7 flex-none cursor-pointer items-center gap-[6px] self-center rounded-md px-[10px] text-[13px] text-muted hover:bg-surface-hover hover:text-primary",
                        FOCUS
                    )}
                >
                    {e.label}
                    {e.count != null ? <span className="text-[12px] tabular-nums">{e.count}</span> : null}
                </button>
            ))}
        </nav>
    );
}

// The panel in the glance box (board C2-panel-activity.dc.html): each seat with its model and what it did; a seat that
// wrote something opens the Discussion on its messages alone.
function Panel({ c }: { c: Council }) {
    const rows = useMemo(() => expertActivity(c), [c]);
    return (
        <div className="-mx-[6px] flex flex-col gap-[2px]">
            {rows.map(({ expert: e, line, filter }) => {
                const body = (
                    <>
                        <Avatar c={c} id={e.id} name={e.name} small className="mt-px" />
                        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                            <span data-council-expert-who className="flex items-baseline gap-[6px]">
                                <span className="min-w-0 flex-1 text-[13px]">{e.name}</span>
                                <span className="flex-none text-[12px] text-muted">{e.model}</span>
                            </span>
                            {line !== "" ? (
                                <span className="flex items-center gap-[6px]">
                                    <span
                                        data-council-expert-activity
                                        className="min-w-0 flex-1 text-[12px] leading-[1.4] tabular-nums text-muted"
                                    >
                                        {line}
                                    </span>
                                    {/* the way to their messages: it holds its room always and only shows on hover, so
                                        the row never changes size */}
                                    {filter ? (
                                        <ArrowRight
                                            size={12}
                                            strokeWidth={2}
                                            aria-hidden
                                            className="flex-none text-primary opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                                        />
                                    ) : null}
                                </span>
                            ) : null}
                        </span>
                    </>
                );
                // the hint sits at the row's right, not under it where the browser's title would cover the next seat
                return filter ? (
                    <Tooltip key={e.id} content="Show their messages in the Discussion" placement="right" hideOnClick>
                        <button
                            type="button"
                            data-council-expert={e.id}
                            aria-label={`${e.name}, ${line}. Show only their messages in the Discussion`}
                            onClick={() => showCouncil(c.id, "discussion", undefined, e.id)}
                            className={cn(
                                "group flex w-full cursor-pointer items-start gap-2 rounded-[6px] p-[6px] text-left text-secondary hover:bg-surface-hover hover:text-primary",
                                FOCUS
                            )}
                        >
                            {body}
                        </button>
                    </Tooltip>
                ) : (
                    <div key={e.id} data-council-expert={e.id} className="flex items-start gap-2 p-[6px]">
                        {body}
                    </div>
                );
            })}
        </div>
    );
}

// The glance box at the right of the cover (board M-report-cover.dc.html): the state, three figures, the panel with what
// each seat did, and the document the council saved. It draws with or without a summary.
function Glance({
    model,
    c,
    savedDoc,
    opening,
    onOpenDoc,
}: {
    model: AgentsViewModel;
    c: Council;
    savedDoc: string | null;
    opening: boolean;
    onOpenDoc: (path: string) => void;
}) {
    const saved = savedLine(c);
    const docLink = (path: string, label: ReactNode, marker: Record<string, string>) => (
        <button
            type="button"
            {...marker}
            data-path={path}
            disabled={opening}
            onClick={() => onOpenDoc(path)}
            className={cn(
                "flex cursor-pointer items-start gap-[7px] rounded-[4px] text-left text-[12.5px] leading-[1.45] text-secondary [overflow-wrap:anywhere] hover:text-primary hover:underline disabled:cursor-default",
                FOCUS
            )}
        >
            <FileText size={13} aria-hidden className="mt-[2px] flex-none" />
            <span>{label}</span>
        </button>
    );
    return (
        <aside
            aria-label="About this council"
            data-council-glance
            className="flex w-[340px] max-w-full flex-none flex-col gap-[14px] rounded-lg border border-edge-mid bg-surface-raised p-[18px] text-[13px] text-secondary"
        >
            <StateFacts model={model} c={c} />
            <div aria-hidden className="h-px bg-edge-mid" />
            <span className="text-[12px] font-semibold text-muted">The panel</span>
            <Panel c={c} />
            {saved !== "" || savedDoc != null ? (
                <>
                    <div aria-hidden className="h-px bg-edge-mid" />
                    {saved !== ""
                        ? docLink(c.docpath ?? "", saved, { "data-council-docpath": "" })
                        : docLink(
                              savedDoc ?? "",
                              <>
                                  Saved to{" "}
                                  <span className="text-primary">{docPathLabel(c.project, savedDoc ?? "")}</span>
                              </>,
                              { "data-council-doc-saved": "" }
                          )}
                </>
            ) : null}
        </aside>
    );
}

// What the person asked, folded to two lines in a quiet card (board E-asked-folded.dc.html, .superpowers/design/
// council-report): Show all opens the whole question and, under "Keep to", the limits it set.
function AskedCard({ question }: { question: string | undefined }) {
    const parts = useMemo(() => askedParts(question), [question]);
    const [open, setOpen] = useState(false);
    if (parts.question === "") {
        return null;
    }
    const n = parts.limits.length;
    const foldable = n > 0 || parts.question.length > ASKED_FOLD;
    return (
        <section data-council-asked aria-label="What you asked" className="flex flex-col gap-[6px]">
            <div className="flex items-center gap-[10px]">
                <span className="text-[12.5px] font-semibold text-muted">You asked</span>
                {foldable && (
                    <button
                        type="button"
                        data-council-asked-toggle
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                        className={cn(
                            "ml-auto flex cursor-pointer items-center gap-[4px] rounded-[4px] border-0 bg-transparent p-0 text-[12.5px] text-muted hover:text-primary",
                            FOCUS
                        )}
                    >
                        {open ? "Show less" : n > 0 ? `${n} ${n === 1 ? "limit" : "limits"} · Show all` : "Show all"}
                        {open ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
                    </button>
                )}
            </div>
            <p
                data-council-asked-question
                className={cn("m-0 text-[14px] leading-[1.55] text-secondary", !open && "line-clamp-2")}
            >
                {parts.question}
            </p>
            {open && n > 0 && (
                <>
                    <span className="mt-1 text-[12.5px] font-semibold text-muted">Keep to</span>
                    <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-[6px] p-0 text-[13.5px] leading-[1.5] text-secondary lg:grid-cols-2">
                        {parts.limits.map((limit, i) => (
                            <li key={i} data-council-asked-limit className="flex gap-2">
                                <span aria-hidden className="flex-none text-ink-faint">
                                    –
                                </span>
                                <span>{limit}</span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}

// past this many characters a question with no limits folds too
const ASKED_FOLD = 200;

function Banner({ tone, children }: { tone: "asking" | "error" | "working"; children: ReactNode }) {
    return (
        <div
            role={tone === "error" ? "alert" : "status"}
            className={cn(
                "flex flex-none items-center gap-3 border-b px-8 py-[9px] text-[13px]",
                tone === "asking" && "border-asking/30 bg-askingbg text-warning-soft",
                tone === "error" && "border-error/30 bg-error/10 text-error-soft",
                tone === "working" && "border-edge-faint bg-surface text-secondary"
            )}
        >
            {children}
        </div>
    );
}

// the council has no summary: it is being written, it failed, or Summarize has not run
function NoSummary({ c, busy, onSummarize }: { c: Council; busy: boolean; onSummarize: () => void }) {
    const coordinator = c.experts.find((e) => e.coordinator);
    const failure = coordinator != null ? c.failed?.[coordinator.id] : undefined;
    const writing =
        c.state === "running" &&
        (c.round >= synthesisRound(c) || (coordinator != null && c.activity?.[coordinator.id] != null));
    return (
        <div
            data-council-nosummary
            className="flex max-w-[900px] flex-col items-start gap-3 text-[14px] text-secondary"
        >
            {writing ? (
                <span className="flex items-center gap-2" role="status">
                    <Loader2 size={14} aria-hidden className="animate-spin text-muted" />
                    The coordinator is writing the summary…
                </span>
            ) : failure != null ? (
                <>
                    <span role="alert" className="text-error-soft">
                        The coordinator failed: {failure.error}
                    </span>
                    {coordinator != null ? (
                        <span className="flex items-center gap-2">
                            <button
                                type="button"
                                data-council-action="retry"
                                onClick={() => void retryExpert(c.id, coordinator.id)}
                                className={BUTTON}
                            >
                                Retry the summary
                            </button>
                            <RetryWithButton
                                expert={coordinator}
                                error={c.failed?.[coordinator.id]?.error}
                                onPick={(model) => void retryExpert(c.id, coordinator.id, model)}
                                className={BUTTON}
                            />
                        </span>
                    ) : null}
                </>
            ) : (
                <>
                    <span>There is no summary yet.</span>
                    {canRunSummary(c) ? (
                        <button
                            type="button"
                            data-council-action="summarize"
                            disabled={busy}
                            onClick={onSummarize}
                            className={BUTTON}
                        >
                            Summarize
                        </button>
                    ) : (
                        <span className="text-muted">
                            {c.state === "running"
                                ? "The council is still running. Summarize is on when it waits for you or ends."
                                : "Summarize is on once an expert has a proposal."}
                        </span>
                    )}
                </>
            )}
        </div>
    );
}

// The Final proposal (docs/superpowers/specs/2026-11-04-council-final-proposal-design.md): the one seat message the person
// pinned to the Report, at its end, with or without a summary above it. The header says whose message it is and when, and
// holds what to do with it: open it in the Discussion where it was said, copy its markdown (the chat's Copy puts the same
// text there), unpin it. The body is drawn the way the chat draws a message, so a table or a list reads the same in both.
function FinalProposalSection({
    councilId,
    proposal,
    unpinning,
    onUnpin,
}: {
    councilId: string;
    proposal: FinalProposal;
    unpinning: boolean;
    onUnpin: () => void;
}) {
    const { state, copy } = useCopyFeedback();
    const hasText = proposal.markdown !== "";
    return (
        <section data-council-final data-council-section="final" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-[10px] gap-y-2">
                <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-primary">Final proposal</h2>
                <span data-council-final-from className="min-w-0 flex-1 truncate text-[13px] text-muted">
                    {proposal.at !== "" ? `${proposal.seatName} · ${proposal.at}` : proposal.seatName}
                </span>
                <span className="flex flex-none items-center gap-2">
                    <button
                        type="button"
                        data-council-final-open
                        onClick={() => revealCouncilMessage(councilId, proposal.id)}
                        className={cn(BUTTON, "gap-[6px]")}
                    >
                        <MessageSquare size={13} aria-hidden />
                        Open in Discussion
                    </button>
                    <button
                        type="button"
                        data-council-final-copy
                        disabled={!hasText}
                        onClick={() => copy(proposal.markdown)}
                        className={cn(BUTTON, "gap-[6px]")}
                    >
                        {state === "copied" ? (
                            <Check size={13} aria-hidden className="text-success" />
                        ) : (
                            <Copy size={13} aria-hidden />
                        )}
                        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
                    </button>
                    <button
                        type="button"
                        data-council-final-unpin
                        disabled={unpinning}
                        onClick={onUnpin}
                        className={cn(BUTTON, "gap-[6px]")}
                    >
                        <PinOff size={13} aria-hidden />
                        Unpin
                    </button>
                </span>
            </div>
            {hasText ? (
                <div data-council-final-body className="max-w-[900px] rounded-lg border border-edge-mid px-5 py-4">
                    <CouncilText text={proposal.markdown} className="text-[15px] leading-[1.62]" />
                </div>
            ) : null}
        </section>
    );
}

function SummaryView({ model, c }: { model: AgentsViewModel; c: Council }) {
    const projects = useAtomValue(projectListAtom);
    const [open, setOpen] = useAtom(openDirectionAtom(c.id));
    const [savedDoc, setSavedDoc] = useAtom(savedDocAtom(c.id));
    const [initiative, setInitiative] = useAtom(initiativeAtom(c.id));
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const summary = c.summary;
    const directions = useMemo(() => directionRows(c), [c]);
    const pinned = useMemo(() => finalProposal(c), [c]);
    const changes = outdatedChanges(c);
    const outdated = outdatedCount(c);
    const coordinator = c.experts.find((e) => e.coordinator);
    const coordinatorFailed = coordinator != null ? c.failed?.[coordinator.id] : undefined;
    const scroller = useRef<HTMLDivElement>(null);
    const onScroll = useKeptScroll(scroller, `summary:${c.id}`);
    // the Report tab, clicked while it is shown, glides the page down past the cover to the report itself, at the top of
    // the box under the header
    const toReport = () => {
        const box = scroller.current;
        const cover = box?.querySelector<HTMLElement>("[data-council-cover]");
        if (box != null && cover != null) {
            glideTo(box, cover.offsetHeight);
        }
    };

    // one action at a time; a refusal is shown where the person clicked, not thrown
    const act = async (what: string, run: () => Promise<void>) => {
        setBusy(what);
        setError(null);
        try {
            await run();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    };

    const summarizeAgain = () =>
        act("summarize", async () => {
            const r = await summarizeCouncil(c.id);
            if (r.ok === false) {
                throw new Error(`Could not summarize: ${r.error}`);
            }
        });

    // the document the council saved, in the Code surface
    const openDocument = (path: string) =>
        act("open-doc", async () => {
            try {
                await openRefInCode(model, { abs: path, root: c.project });
            } catch (e) {
                throw new Error(`Could not open the document: ${e instanceof Error ? e.message : String(e)}`);
            }
        });

    const saveDoc = () =>
        act("doc", async () => {
            const r = await saveCouncilDoc(c.id);
            if (r.ok === false) {
                throw new Error(`Could not save the doc: ${r.error}`);
            }
            setSavedDoc(r.value.path);
        });

    const createInitiative = () =>
        act("initiative", async () => {
            const seed = initiativeSeed(c);
            try {
                const rtn = await RpcApi.EffortCreateCommand(
                    TabRpcClient,
                    {
                        title: seed.title,
                        project: projectNameOf(projects, c.project),
                        chunks: seed.chunks,
                    },
                    { timeout: stateRpcTimeoutMs }
                );
                setInitiative({ oid: rtn.effortoid, title: seed.title, chunks: seed.chunks.length });
                void loadBriefingAsync();
            } catch (e) {
                throw new Error(`Could not create the initiative: ${e instanceof Error ? e.message : String(e)}`);
            }
        });

    const unpin = () =>
        act("unpin", async () => {
            const r = await finalPickCouncil(c.id, "");
            if (r.ok === false) {
                throw new Error(`Could not unpin the Final proposal: ${r.error}`);
            }
        });

    const brainstorm = (row: DirectionRow) =>
        act(`brainstorm:${row.direction.rank}`, async () => {
            const name =
                projectNameOf(projects, c.project) ?? (c.project.split(/[\\/]/).filter(Boolean).pop() || "agent");
            try {
                await launchAgent(model, {
                    runtime: "claude",
                    startupCommand: runtimeStartupCommand("claude"),
                    task: brainstormPrompt(c, row),
                    projectPath: c.project,
                    projectName: name,
                });
            } catch (e) {
                throw new Error(`Could not open an agent: ${e instanceof Error ? e.message : String(e)}`);
            }
        });

    const askAgain = (row: DirectionRow) => {
        if (row.firstProposal !== "") {
            globalStore.set(councilOpenProposalAtom(c.id), row.firstProposal);
        }
        showCouncil(c.id, "discussion");
    };

    // Ask next puts the question in the Discussion's box, to edit and send there
    const askNext = (fill: string) => {
        globalStore.set(councilChatDraftAtom(c.id), (d) => ({ ...d, texts: { ...d.texts, [""]: fill } }));
        showCouncil(c.id, "discussion");
    };
    const asks = useMemo(() => askChips(c), [c]);

    // one card open at a time; a click on the open one closes it
    const toggle = (rank: number) => setOpen(open === rank ? null : rank);
    const openRow = directions.find((r) => r.direction.rank === open);

    const written = writtenLine(c);
    const { answer, rest } = answerParts(c);
    const heading = directionsHeading(c);
    const kept = useMemo(() => keptRows(c), [c]);
    const dropped = droppedLine(c);
    const doc = docAction(c);
    // the report's own rows of the header's `⋯` menu, ahead of Resume and Pin (CouncilActions)
    const menuItems: ContextMenuItem[] = [
        doc.id === "open-doc"
            ? {
                  label: doc.label,
                  enabled: busy !== "open-doc",
                  click: () => void openDocument(c.docpath ?? ""),
                  attrs: { "data-council-action": doc.id },
              }
            : {
                  label: doc.label,
                  enabled: summary != null && busy !== "doc",
                  click: () => void saveDoc(),
                  attrs: { "data-council-action": doc.id },
              },
        {
            label: "Create initiative",
            enabled: summary != null && directions.length > 0 && busy !== "initiative" && initiative == null,
            click: () => void createInitiative(),
            attrs: { "data-council-action": "initiative" },
        },
        {
            label: "Run again",
            click: () => showCouncilSetup(c.project, draftFromCouncil(c)),
            attrs: { "data-council-action": "run-again" },
        },
        { type: "separator" },
    ];
    const finalSection =
        pinned != null ? (
            <FinalProposalSection
                councilId={c.id}
                proposal={pinned}
                unpinning={busy === "unpin"}
                onUnpin={() => void unpin()}
            />
        ) : null;
    return (
        <>
            {/* the header row the three views share, over the box like theirs, so a tab click moves nothing in it; the
                tabs, the jump links and the ⋯ menu are what the scenarios find under data-council-tabbar */}
            <header
                data-council-tabbar
                className="@container flex flex-none flex-col border-b border-border bg-surface"
            >
                <CouncilHeaderRow
                    c={c}
                    view="summary"
                    titleAttr="data-council-summary-title"
                    details
                    aside={<JumpLinks c={c} scroller={scroller} />}
                    items={menuItems}
                    onCurrent={toReport}
                    onOpenTerminal={(tab) => model.openTerminal(tab)}
                />
            </header>
            {summary != null && c.state === "running" ? (
                <Banner tone="working">
                    <Loader2 size={13} aria-hidden className="animate-spin text-muted" />
                    <span data-council-banner="running">Updating the summary…</span>
                </Banner>
            ) : summary != null && coordinatorFailed != null ? (
                <Banner tone="error">
                    <span data-council-banner="failed">The coordinator failed: {coordinatorFailed.error}</span>
                    {coordinator != null ? (
                        <span className="flex items-center gap-2">
                            <button
                                type="button"
                                data-council-action="retry"
                                onClick={() => void retryExpert(c.id, coordinator.id)}
                                className={BUTTON}
                            >
                                Retry the summary
                            </button>
                            <RetryWithButton
                                expert={coordinator}
                                error={c.failed?.[coordinator.id]?.error}
                                onPick={(model) => void retryExpert(c.id, coordinator.id, model)}
                                className={BUTTON}
                            />
                        </span>
                    ) : null}
                </Banner>
            ) : summary != null && outdated > 0 ? (
                <Banner tone="asking">
                    <span data-council-banner="outdated" className="font-semibold">
                        {outdatedLabel(changes)}
                    </span>
                    <button
                        type="button"
                        data-council-action="summarize-again"
                        disabled={!canRunSummary(c) || busy === "summarize"}
                        onClick={() => void summarizeAgain()}
                        className={BUTTON}
                    >
                        Summarize again
                    </button>
                </Banner>
            ) : null}
            {/* the page fades in as the view opens (a tab click, a council picked); the header stays put */}
            <motion.div
                ref={scroller}
                variants={viewFade}
                initial="initial"
                animate="animate"
                data-council-scroll
                onScroll={onScroll}
                className="min-h-0 flex-1 overflow-y-auto"
            >
                <div data-council-cover className="bg-surface">
                    <div className="mx-auto flex max-w-[1180px] flex-col gap-[22px] px-10 pt-[26px]">
                        <div className="flex flex-col gap-2">
                            <span data-council-eyebrow className="text-[13px] font-medium text-muted">
                                Council · {modeWord(c)}
                            </span>
                            {initiative != null || error != null ? (
                                <div className="flex flex-col gap-1 text-[12.5px]">
                                    {initiative != null ? (
                                        <span
                                            data-council-initiative-made
                                            data-effort-oid={initiative.oid}
                                            className="flex items-center gap-2 text-secondary"
                                        >
                                            Created the initiative{" "}
                                            <span className="text-primary">{initiative.title}</span> with{" "}
                                            {initiative.chunks} {initiative.chunks === 1 ? "chunk" : "chunks"}
                                            <button
                                                type="button"
                                                data-council-action="open-initiative"
                                                onClick={() =>
                                                    void openTarget(model, { kind: "effort", effortId: initiative.oid })
                                                }
                                                className={cn(
                                                    "cursor-pointer rounded-[4px] text-accent hover:text-accenthover",
                                                    FOCUS
                                                )}
                                            >
                                                Open
                                            </button>
                                        </span>
                                    ) : null}
                                    {error != null ? (
                                        <span role="alert" data-council-error className="text-error-soft">
                                            {error}
                                        </span>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                        <div className="flex flex-wrap items-start gap-12 pb-[30px]">
                            <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-5">
                                <h1 className="m-0 text-title font-semibold leading-[1.4] tracking-[-0.01em] text-secondary">
                                    {c.feature}
                                </h1>
                                <AskedCard key={c.id} question={c.question} />
                                <div
                                    data-council-section="answer"
                                    className="flex flex-col gap-3 border-t border-edge-mid pt-5"
                                >
                                    {summary == null ? (
                                        <NoSummary
                                            c={c}
                                            busy={busy === "summarize"}
                                            onSummarize={() => void summarizeAgain()}
                                        />
                                    ) : (
                                        <>
                                            <h2 className="m-0 text-[12.5px] font-semibold text-muted">The answer</h2>
                                            {answer !== "" ? (
                                                <p
                                                    data-council-answer
                                                    className="m-0 whitespace-pre-wrap text-[24px] font-semibold leading-[1.4] tracking-[-0.01em] text-primary"
                                                >
                                                    {answer}
                                                </p>
                                            ) : null}
                                            {rest !== "" ? (
                                                <p
                                                    data-council-summary-text
                                                    className="m-0 whitespace-pre-wrap text-[15px] leading-[1.62] text-ink-hi"
                                                >
                                                    {rest}
                                                </p>
                                            ) : null}
                                            {written !== "" ? (
                                                <span data-council-written className="text-[12.5px] text-muted">
                                                    {written}
                                                </span>
                                            ) : null}
                                        </>
                                    )}
                                </div>
                            </div>
                            <Glance
                                model={model}
                                c={c}
                                savedDoc={savedDoc}
                                opening={busy === "open-doc"}
                                onOpenDoc={(path) => void openDocument(path)}
                            />
                        </div>
                    </div>
                </div>
                {summary != null ? (
                    <div className="mx-auto flex max-w-[1180px] flex-col gap-11 px-10 pb-[72px] pt-9">
                        {directions.length > 0 ? (
                            <section className="flex flex-col gap-4">
                                {heading !== "" ? (
                                    <div className="flex items-baseline gap-[10px]">
                                        <h2
                                            data-council-directions-heading
                                            className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-primary"
                                        >
                                            {heading}
                                        </h2>
                                        <span className="text-[14px] font-medium tabular-nums text-muted">
                                            {directions.length}
                                        </span>
                                    </div>
                                ) : null}
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] items-stretch gap-[14px]">
                                    {directions.map((row) => (
                                        <DirectionCard
                                            key={row.direction.rank}
                                            c={c}
                                            row={row}
                                            open={open === row.direction.rank}
                                            onToggle={() => toggle(row.direction.rank)}
                                        />
                                    ))}
                                </div>
                                {openRow != null ? (
                                    <DirectionDetail
                                        c={c}
                                        row={openRow}
                                        busy={busy === `brainstorm:${openRow.direction.rank}`}
                                        onBrainstorm={() => void brainstorm(openRow)}
                                        onAskAgain={() => askAgain(openRow)}
                                    />
                                ) : null}
                            </section>
                        ) : null}
                        {kept.length > 0 ? <KeptSection key={c.id} c={c} rows={kept} /> : null}
                        {finalSection}
                        {asks.length > 0 ? (
                            <section data-council-asks-next className="flex flex-col gap-4">
                                <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-primary">
                                    Ask next
                                </h2>
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[14px]">
                                    {asks.map((a, i) => (
                                        <button
                                            key={a.text}
                                            type="button"
                                            data-council-summary-ask={i}
                                            onClick={() => askNext(a.fill)}
                                            title="Open the Discussion with this question in the box"
                                            className="flex cursor-pointer flex-col gap-[10px] rounded-lg border border-edge-mid bg-transparent px-4 py-[14px] text-left outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                                        >
                                            <span className="text-[13.5px] leading-[1.5] text-secondary">{a.text}</span>
                                            <span className="mt-auto flex items-center gap-[6px] text-[12px] text-muted">
                                                To {c.experts.find((e) => e.id === a.to)?.name ?? "everyone"}
                                                <ArrowRight size={13} aria-hidden />
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        ) : null}
                        {dropped !== "" ? (
                            <span data-council-dropped className="text-[12.5px] text-muted">
                                {dropped}
                            </span>
                        ) : null}
                        <RatingRow key={c.id} c={c} />
                        <MapLink c={c} />
                    </div>
                ) : finalSection != null ? (
                    <div className="mx-auto flex max-w-[1180px] flex-col gap-11 px-10 pb-[72px] pt-9">
                        {finalSection}
                    </div>
                ) : null}
            </motion.div>
        </>
    );
}

export function CouncilSummary({ model }: { model: AgentsViewModel }) {
    const id = useAtomValue(councilSelAtom);
    const c = useCouncil(id);
    return (
        <div
            data-council-summary
            data-council-id={id ?? undefined}
            aria-busy={c == null}
            className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
        >
            {c == null ? (
                <div className="flex flex-1 items-center justify-center text-[14px] text-muted">
                    {id == null ? "No council is open." : "Loading the council…"}
                </div>
            ) : (
                <SummaryView model={model} c={c} />
            )}
        </div>
    );
}
