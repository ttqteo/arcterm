// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council report (docs/superpowers/specs/2026-10-22-council-agent-team-design.md "UI", board M-report-cover.dc.html):
// one scroll box under a cover. The cover holds the title and its `⋯` menu, what was asked, the answer in one bold
// sentence with the coordinator's text under it, and a glance box beside them: the state, three figures, the panel with
// each model and what each seat did (a click opens the Discussion on that seat's messages alone), and where the council
// saved itself, docs/council/, a click or the `⋯` menu opening that document. Under the cover a tab bar sticks to the top
// (Report / Discussion, and jump links to the sections below), then the body: the directions as cards (one open at a time,
// its detail under the grid: the coordinator's reasoning and each expert's position), the matrix of every idea against
// every expert folded at the bottom. A finished council opens on it; Summarize on the Discussion opens it too, and the
// Discussion tab goes back. A Brainstorm's report heads its directions "Ideas worth trying, best first" (each with a first
// step and who had and built on it) and keeps the wild ideas aside under them with a count of the rest. A Review's report
// gives its first three directions a first step each and lists the rest under Also raised. Under the directions a quiet row asks "Was this
// useful?" (Useful / Not really) and feeds the answer to the council benchmark. What it derives from the council is
// councilsummarymodel.ts (and councilmodel.ts); what it hands on is a saved doc, an initiative, a Setup draft to run
// again, the Discussion on one direction's thread, and a new agent started on it.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { loadBriefingAsync, stateRpcTimeoutMs } from "@/app/view/jarvis/briefingstore";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn } from "@/util/util";
import { atom, useAtom, useAtomValue, useSetAtom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import {
    ArrowRight,
    Check,
    ChevronDown,
    ChevronUp,
    Code,
    Contrast,
    CornerDownRight,
    Ellipsis,
    FileText,
    Loader2,
    TriangleAlert,
} from "lucide-react";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
    type RefObject,
} from "react";
import { showCouncil, showCouncilSetup } from "./agentcenter";
import { openRefInCode } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import { CouncilAvatar, CouncilText, MarkedText, useKeptScroll } from "./councilchat";
import { askChips } from "./councilchatmodel";
import { avatarTone, modeWord, seatInitials } from "./councildiscussionmodel";
import {
    STANCE_WORD,
    askedParts,
    draftFromCouncil,
    glanceFigures,
    matrixRows,
    outdatedCount,
    panel,
    summaryFacts,
    synthesisRound,
    type StanceLabel,
} from "./councilmodel";
import { RetryWithButton } from "./councilretrymenu";
import {
    councilChatDraftAtom,
    councilOpenProposalAtom,
    councilSelAtom,
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
    jumpLinks,
    keptHeading,
    keptRows,
    outcomeLabel,
    outdatedLabel,
    projectNameOf,
    ratingRow,
    savedLine,
    writtenLine,
    type CouncilRating,
    type DirectionRow,
    type KeptRow,
    type OutlineEntry,
    type Position,
} from "./councilsummarymodel";
import { CouncilTabs } from "./counciltabs";
import { runtimeStartupCommand } from "./launch";
import { projectListAtom } from "./projectsstore";

// what the Summary keeps for a council while the person is elsewhere (the Agent surface stays mounted, this view does not)
const openDirectionAtom = atomFamily((_id: string) => atom<number | null>(null) as PrimitiveAtom<number | null>);
const matrixOpenAtom = atomFamily((_id: string) => atom<boolean>(false) as PrimitiveAtom<boolean>);
const savedDocAtom = atomFamily((_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>);
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

function EvidenceChip({ evidence }: { evidence: CouncilEvidence }) {
    const weak = evidence.weak === true;
    return (
        <span
            data-council-evidence={weak ? "weak" : "ref"}
            className={cn(
                "inline-flex items-center gap-[5px] rounded-[6px] border bg-surface px-2 py-[2px] text-[12px]",
                weak ? "border-warning/40 text-warning-soft" : "border-edge-mid text-secondary"
            )}
        >
            {weak ? <TriangleAlert size={11} aria-hidden /> : <Code size={11} aria-hidden />}
            {evidenceLabel(evidence)}
        </span>
    );
}

function PositionView({ c, position }: { c: Council; position: Position }) {
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
                {position.evidence.length > 0 ? (
                    <div className="flex flex-wrap gap-[6px]">
                        {position.evidence.map((e, i) => (
                            <EvidenceChip key={i} evidence={e} />
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
            <span className="mt-auto flex w-full flex-wrap items-center gap-x-[7px] gap-y-[6px]">
                {row.meta !== "" ? (
                    <span data-council-meta className="text-[12.5px] text-muted">
                        {row.meta}
                    </span>
                ) : null}
                {row.chips.map((chip) => (
                    <span
                        key={chip.expert.id}
                        data-council-chip={chip.expert.id}
                        title={`${chip.expert.name}: ${STANCE_WORD[chip.stance]}`}
                        className={cn(
                            "flex items-center gap-1 rounded-full py-[2px] pl-[2px] pr-[7px] text-[10.5px]",
                            STANCE_PILL[chip.stance]
                        )}
                    >
                        <Avatar
                            c={c}
                            id={chip.expert.id}
                            name={chip.expert.name}
                            small
                            className="h-[16px] w-[16px] text-[8px]"
                        />
                        {STANCE_WORD[chip.stance]}
                    </span>
                ))}
                <span className="flex-1" />
                {open ? (
                    <ChevronUp size={14} aria-hidden className="flex-none text-muted" />
                ) : (
                    <ChevronDown size={14} aria-hidden className="flex-none text-muted" />
                )}
            </span>
        </button>
    );
}

// the open card's detail under the grid: why the coordinator picked it, each expert's position, and what to do with it
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
                    <span className="font-semibold">Coordinator: </span>
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

// a proposal's cited places down to one line; a weak claim names no place
function citedRefs(p: CouncilProposal): string {
    const refs = (p.evidence ?? []).filter((e) => !e.weak && e.ref !== "").map((e) => evidenceLabel(e));
    return refs.length > 0 ? refs.join(", ") : "cites no evidence";
}

// the report's bottom: every idea against every expert, folded (the open state is kept per council)
function Matrix({ c }: { c: Council }) {
    const [open, setOpen] = useAtom(matrixOpenAtom(c.id));
    const rows = useMemo(() => matrixRows(c), [c]);
    const experts = panel(c);
    const bodyId = "council-matrix-body";
    return (
        <section
            id="council-matrix"
            data-council-matrix
            className="flex flex-col gap-[10px] border-t border-edge-faint pt-[18px]"
        >
            <button
                type="button"
                data-council-matrix-toggle
                aria-expanded={open}
                aria-controls={open ? bodyId : undefined}
                onClick={() => setOpen(!open)}
                className={cn(
                    "flex w-fit cursor-pointer items-center gap-[8px] rounded-[6px] py-[3px] pr-[6px] text-left text-[13.5px] font-semibold text-secondary hover:text-primary",
                    FOCUS
                )}
            >
                {open ? (
                    <ChevronUp size={14} aria-hidden className="flex-none text-muted" />
                ) : (
                    <ChevronDown size={14} aria-hidden className="flex-none text-muted" />
                )}
                Every expert on every idea
                <span className="text-[12.5px] font-normal text-muted">where each expert ended up on each idea</span>
            </button>
            {open ? (
                <div id={bodyId} className="overflow-x-auto rounded-[10px] border border-border">
                    <table className="w-full table-fixed border-collapse text-left">
                        <colgroup>
                            <col className="w-[26%]" />
                            {experts.map((e) => (
                                <col key={e.id} />
                            ))}
                            <col className="w-[150px]" />
                        </colgroup>
                        <thead className="bg-surface">
                            <tr>
                                <th
                                    scope="col"
                                    className="px-3 py-[9px] text-[10.5px] font-bold uppercase tracking-[.1em] text-muted"
                                >
                                    Idea
                                </th>
                                {experts.map((e) => (
                                    <th
                                        key={e.id}
                                        scope="col"
                                        className="px-[10px] py-[9px] text-[13px] font-semibold text-primary"
                                    >
                                        <span className="flex items-center gap-[6px]">
                                            <Avatar c={c} id={e.id} name={e.name} small />
                                            {e.name}
                                        </span>
                                    </th>
                                ))}
                                <th
                                    scope="col"
                                    className="px-[10px] py-[9px] text-[10.5px] font-bold uppercase tracking-[.1em] text-muted"
                                >
                                    Outcome
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const out = row.proposal.withdrawn || row.proposal.cut;
                                return (
                                    <tr
                                        key={row.proposal.id}
                                        data-council-matrix-row={row.proposal.id}
                                        className="border-t border-border align-top"
                                    >
                                        <td className="min-w-0 px-3 py-[11px]">
                                            <div
                                                className={cn(
                                                    "text-[13.5px] font-semibold",
                                                    out ? "text-muted" : "text-primary"
                                                )}
                                            >
                                                {row.proposal.title}
                                            </div>
                                            <div className="mt-1 text-[12px] text-muted">{citedRefs(row.proposal)}</div>
                                        </td>
                                        {row.cells.map((cell) => (
                                            <td
                                                key={cell.expert.id}
                                                data-council-matrix-cell={cell.expert.id}
                                                className="min-w-0 border-l border-edge-faint px-[10px] py-[11px]"
                                            >
                                                {cell.stance !== "" ? (
                                                    <div className="flex flex-col gap-[5px]">
                                                        <StancePill stance={cell.stance} />
                                                        {cell.reason !== "" ? (
                                                            <span className="break-words text-[12.5px] leading-[1.4] text-secondary">
                                                                <MarkedText text={cell.reason} />
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                ) : (
                                                    <span className="text-[12.5px] text-ink-faint">No view</span>
                                                )}
                                            </td>
                                        ))}
                                        <td
                                            data-council-matrix-outcome
                                            className={cn(
                                                "border-l border-edge-faint px-[10px] py-[11px] text-[12.5px]",
                                                out ? "text-muted" : "text-primary"
                                            )}
                                        >
                                            {outcomeLabel(row.outcome) || "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </section>
    );
}

// The report's less-used actions behind a `⋯`: Save as doc, Create initiative, Run again. Arrow keys move through them,
// Escape closes and gives the focus back, a click outside closes.
function ActionsMenu({ items }: { items: { id: string; label: string; disabled?: boolean; onPick: () => void }[] }) {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: MouseEvent) => {
            if (!wrap.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onDown, true);
        wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [open]);
    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!open) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            trigger.current?.focus();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const els = Array.from(
                wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
            );
            if (els.length > 0) {
                const at = els.indexOf(document.activeElement as HTMLElement);
                els[(at + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length].focus();
            }
        }
    };
    return (
        <div ref={wrap} onKeyDown={onKeyDown} className="relative flex-none">
            <button
                ref={trigger}
                type="button"
                data-council-menu
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="More actions"
                onClick={() => setOpen((o) => !o)}
                className={cn(BUTTON, "w-[28px] justify-center px-0")}
            >
                <Ellipsis size={14} aria-hidden />
            </button>
            {open ? (
                <div
                    role="menu"
                    aria-label="More actions"
                    className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[190px] rounded-[10px] border border-edge-mid bg-surface-raised p-[4px] shadow-popover-md"
                >
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            role="menuitem"
                            data-council-action={item.id}
                            disabled={item.disabled}
                            onClick={() => {
                                setOpen(false);
                                trigger.current?.focus();
                                item.onPick();
                            }}
                            className="flex h-[28px] w-full cursor-pointer items-center rounded-[6px] border-0 bg-transparent px-[8px] text-left text-[13px] text-primary outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}
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
        case "matrix":
            return box.querySelector("[data-council-matrix]");
        default:
            return box.querySelector(`[data-council-section="${id}"]`);
    }
}

// The tab bar's jump links (board M-report-cover.dc.html): a button per section after the answer, scrolling the box so
// the section's top lands 12px under the bar (as far as the box can scroll); the matrix also unfolds.
function JumpLinks({
    c,
    scroller,
    bar,
}: {
    c: Council;
    scroller: RefObject<HTMLDivElement | null>;
    bar: RefObject<HTMLDivElement | null>;
}) {
    const entries = useMemo(() => jumpLinks(c), [c]);
    const openMatrix = useSetAtom(matrixOpenAtom(c.id));
    if (entries.length === 0) {
        return null;
    }
    const go = (e: OutlineEntry) => {
        const box = scroller.current;
        const el = box == null ? null : sectionOf(box, e.id);
        if (box == null || el == null) {
            return;
        }
        if (e.id === "matrix") {
            openMatrix(true);
        }
        const barHeight = bar.current?.offsetHeight ?? 0;
        // the scroll box alone moves (scrollIntoView would also scroll the surfaces around it)
        box.scrollTo({
            top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - barHeight - 12,
        });
    };
    return (
        <nav aria-label="On this page" className="flex min-w-0 items-center gap-1">
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
                                <span
                                    data-council-expert-activity
                                    className="text-[12px] leading-[1.4] tabular-nums text-muted"
                                >
                                    {line}
                                </span>
                            ) : null}
                            {filter ? (
                                <span className="hidden text-[12px] text-primary group-hover:block group-focus-visible:block">
                                    Show their messages →
                                </span>
                            ) : null}
                        </span>
                    </>
                );
                return filter ? (
                    <button
                        key={e.id}
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

function SummaryView({ model, c }: { model: AgentsViewModel; c: Council }) {
    const projects = useAtomValue(projectListAtom);
    const [open, setOpen] = useAtom(openDirectionAtom(c.id));
    const [savedDoc, setSavedDoc] = useAtom(savedDocAtom(c.id));
    const [initiative, setInitiative] = useAtom(initiativeAtom(c.id));
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const summary = c.summary;
    const directions = useMemo(() => directionRows(c), [c]);
    const outdated = outdatedCount(c);
    const coordinator = c.experts.find((e) => e.coordinator);
    const coordinatorFailed = coordinator != null ? c.failed?.[coordinator.id] : undefined;
    const scroller = useRef<HTMLDivElement>(null);
    const tabBar = useRef<HTMLDivElement>(null);
    const onScroll = useKeptScroll(scroller, `summary:${c.id}`);

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
    const menuItems = [
        doc.id === "open-doc"
            ? {
                  id: doc.id,
                  label: doc.label,
                  disabled: busy === "open-doc",
                  onPick: () => void openDocument(c.docpath ?? ""),
              }
            : {
                  id: doc.id,
                  label: doc.label,
                  disabled: summary == null || busy === "doc",
                  onPick: () => void saveDoc(),
              },
        {
            id: "initiative",
            label: "Create initiative",
            disabled: summary == null || directions.length === 0 || busy === "initiative" || initiative != null,
            onPick: () => void createInitiative(),
        },
        {
            id: "run-again",
            label: "Run again",
            onPick: () => showCouncilSetup(c.project, draftFromCouncil(c)),
        },
    ];
    return (
        <>
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
                        {outdatedLabel(outdated)}
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
            <div ref={scroller} data-council-scroll onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
                <div data-council-cover className="bg-surface">
                    <div className="mx-auto flex max-w-[1180px] flex-col gap-[22px] px-10 pt-[26px]">
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-[10px]">
                                <span
                                    data-council-eyebrow
                                    className="min-w-0 flex-1 text-[13px] font-medium text-muted"
                                >
                                    Council · {modeWord(c)}
                                </span>
                                <ActionsMenu items={menuItems} />
                            </div>
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
                                <h1 className="m-0 text-[24px] font-semibold leading-[1.34] tracking-[-0.018em] text-primary">
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
                <div ref={tabBar} data-council-tabbar className="sticky top-0 z-10 border-b border-border bg-surface">
                    <div className="mx-auto flex h-[46px] max-w-[1180px] items-stretch gap-6 px-10">
                        <CouncilTabs c={c} view="summary" />
                        <span className="flex-1" />
                        <JumpLinks c={c} scroller={scroller} bar={tabBar} />
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
                        {kept.length > 0 ? (
                            <section data-council-kept className="flex flex-col gap-4">
                                <div className="flex items-baseline gap-[10px]">
                                    <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-primary">
                                        {keptHeading(c)}
                                    </h2>
                                    <span className="text-[14px] font-medium tabular-nums text-muted">
                                        {kept.length}
                                    </span>
                                </div>
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[14px]">
                                    {kept.map((row, i) => (
                                        <KeptCard key={`${row.direction.rank}-${i}`} row={row} />
                                    ))}
                                </div>
                            </section>
                        ) : null}
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
                        <Matrix c={c} />
                    </div>
                ) : null}
            </div>
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
