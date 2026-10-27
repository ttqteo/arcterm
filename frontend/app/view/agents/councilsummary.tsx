// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council report (docs/superpowers/specs/2026-10-22-council-agent-team-design.md "UI", board ReportDone.dc.html): what
// was asked, the answer in one bold sentence, the coordinator's text under it, the directions ranked (a row opens to the
// coordinator's reasoning and each expert's position), and the matrix of every idea against every expert, folded at the
// bottom. A finished council opens on it; Summarize on the Discussion opens it too, and Show the discussion goes back.
// A Brainstorm's report heads its directions "Ideas worth trying, best first" (each with a first step and who had and
// built on it), keeps the wild ideas aside under them with a count of the rest, and says where the finished council saved
// itself (docs/council/) with the `⋯` menu opening that document. A Review's report gives its first three directions a
// first step each and lists the rest under Also raised, one line each. Under the directions a quiet row asks "Was this
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
import { atom, useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { Check, ChevronDown, ChevronUp, Code, Ellipsis, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { showCouncil, showCouncilSetup } from "./agentcenter";
import { openRefInCode } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import { avatarTone } from "./councildiscussionmodel";
import {
    STANCE_WORD,
    draftFromCouncil,
    matrixRows,
    outdatedCount,
    panel,
    summaryChip,
    type StanceLabel,
} from "./councilmodel";
import {
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
    askedLine,
    brainstormPrompt,
    canRunSummary,
    directionRows,
    directionsHeading,
    docAction,
    docPathLabel,
    droppedLine,
    evidenceLabel,
    initiativeSeed,
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
    type Position,
} from "./councilsummarymodel";
import { CouncilAvatar } from "./councilthread";
import { runtimeStartupCommand } from "./launch";
import { projectListAtom } from "./projectsstore";

// what the Summary keeps for a council while the person is elsewhere (the Agent surface stays mounted, this view does not)
const openDirectionsAtom = atomFamily((_id: string) => atom<number[]>([]) as PrimitiveAtom<number[]>);
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
    "flex h-[28px] flex-none cursor-pointer items-center rounded-md border border-edge-mid bg-surface-raised px-3 text-[12px] text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50 disabled:hover:border-edge-mid disabled:hover:bg-surface-raised",
    FOCUS
);
const PRIMARY = cn(
    "flex h-[28px] flex-none cursor-pointer items-center rounded-md bg-accent px-3 text-[12px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-accent",
    FOCUS
);

// The Discussion's avatar, in the colour avatarTone gives the expert. It is decorative here (the name is always beside
// it, so a screen reader skips the letter) and sits on the Summary's own surfaces, so it has no disc fill of its own.
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
                small={small}
                className={cn("bg-transparent", className)}
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
                "inline-flex items-center gap-[5px] rounded-[6px] border bg-surface px-2 py-[2px] text-[11px]",
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
            <Avatar c={c} id={position.expert.id} name={position.expert.name} className="text-[11px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-primary">{position.expert.name}</span>
                    <StancePill stance={position.stance} />
                </div>
                {position.text !== "" ? (
                    <span className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-ink-hi">
                        {position.text}
                    </span>
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

function DirectionCard({
    c,
    row,
    open,
    busy,
    onToggle,
    onBrainstorm,
    onAskAgain,
}: {
    c: Council;
    row: DirectionRow;
    open: boolean;
    busy: boolean;
    onToggle: () => void;
    onBrainstorm: () => void;
    onAskAgain: () => void;
}) {
    const d = row.direction;
    const bodyId = `council-direction-${d.rank}`;
    return (
        <div
            data-council-direction={d.rank}
            className={cn(
                "overflow-hidden rounded-[10px] border bg-surface-raised",
                open ? "border-edge-strong" : "border-edge-mid"
            )}
        >
            <button
                type="button"
                data-council-direction-toggle
                aria-expanded={open}
                aria-controls={open ? bodyId : undefined}
                onClick={onToggle}
                className={cn("flex w-full cursor-pointer items-center gap-3 px-[14px] py-3 text-left", FOCUS)}
            >
                <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] bg-surface text-[11.5px] font-bold tabular-nums text-secondary">
                    {d.rank}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span data-council-title className="text-[13.5px] font-semibold text-primary">
                        {d.title}
                    </span>
                    {row.firstStep !== "" ? (
                        <span data-council-first-step className="text-[12px] leading-[1.45] text-secondary">
                            {row.firstStep}
                        </span>
                    ) : null}
                    {row.meta !== "" ? (
                        <span data-council-meta className="text-[11px] text-muted">
                            {row.meta}
                        </span>
                    ) : null}
                </span>
                <span className="flex flex-none items-center gap-1">
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
                </span>
                <span
                    data-council-tag
                    className={cn(
                        "flex-none rounded-full px-2 py-[2px] text-[10.5px] font-semibold",
                        row.tag === "Everyone agrees"
                            ? "bg-success/12 text-success-soft"
                            : "bg-askingbg text-warning-soft"
                    )}
                >
                    {row.tag}
                </span>
                {open ? (
                    <ChevronUp size={14} aria-hidden className="flex-none text-muted" />
                ) : (
                    <ChevronDown size={14} aria-hidden className="flex-none text-muted" />
                )}
            </button>
            {open ? (
                <div
                    id={bodyId}
                    data-council-direction-body
                    className="flex flex-col gap-3 pb-[14px] pl-[48px] pr-[14px] pt-1"
                >
                    {d.reasoning !== "" ? (
                        <p data-council-reasoning className="m-0 text-[12.5px] leading-[1.55] text-secondary">
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
            ) : null}
        </div>
    );
}

// a Brainstorm's wild idea kept aside, or a Review's direction also raised: not ranked, so a plain row, no stances and
// nothing to open
function KeptCard({ row }: { row: KeptRow }) {
    const d = row.direction;
    return (
        <div
            data-council-kept-idea={d.rank}
            className="flex flex-col gap-[3px] rounded-[10px] border border-edge-mid bg-surface-raised px-[14px] py-[10px]"
        >
            <span data-council-title className="text-[13px] font-semibold text-primary">
                {d.title}
            </span>
            {row.meta !== "" ? (
                <span data-council-meta className="text-[11px] text-muted">
                    {row.meta}
                </span>
            ) : null}
            {d.reasoning !== "" ? (
                <span className="text-[12.5px] leading-[1.5] text-secondary">{d.reasoning}</span>
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
            className="mt-[6px] flex flex-wrap items-center gap-x-[10px] gap-y-[6px] text-[12px] text-muted"
        >
            <span
                role="status"
                data-council-rating-thanks={row.choices.length === 0 ? "" : undefined}
                className="text-[12px]"
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
                    className={cn(BUTTON, "h-[24px] px-[10px] text-[11.5px]")}
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
                    className={cn("cursor-pointer rounded-[4px] text-[12px] text-accent hover:text-accenthover", FOCUS)}
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
        <section id="council-matrix" data-council-matrix className="flex flex-col gap-[10px]">
            <button
                type="button"
                data-council-matrix-toggle
                aria-expanded={open}
                aria-controls={open ? bodyId : undefined}
                onClick={() => setOpen(!open)}
                className={cn(
                    "flex w-fit cursor-pointer items-center gap-[8px] rounded-[6px] py-[3px] pr-[6px] text-left text-[12.5px] font-semibold text-secondary hover:text-primary",
                    FOCUS
                )}
            >
                {open ? (
                    <ChevronUp size={14} aria-hidden className="flex-none text-muted" />
                ) : (
                    <ChevronDown size={14} aria-hidden className="flex-none text-muted" />
                )}
                Every expert on every idea
                <span className="text-[11.5px] font-normal text-muted">where each expert ended up on each idea</span>
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
                                        className="px-[10px] py-[9px] text-[12px] font-semibold text-primary"
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
                                                    "text-[12.5px] font-semibold",
                                                    out ? "text-muted" : "text-primary"
                                                )}
                                            >
                                                {row.proposal.title}
                                            </div>
                                            <div className="mt-1 text-[11px] text-muted">{citedRefs(row.proposal)}</div>
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
                                                            <span className="break-words text-[11.5px] leading-[1.4] text-secondary">
                                                                {cell.reason}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                ) : (
                                                    <span className="text-[11.5px] text-ink-faint">No view</span>
                                                )}
                                            </td>
                                        ))}
                                        <td
                                            data-council-matrix-outcome
                                            className={cn(
                                                "border-l border-edge-faint px-[10px] py-[11px] text-[11.5px]",
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
                            className="flex h-[28px] w-full cursor-pointer items-center rounded-[6px] border-0 bg-transparent px-[8px] text-left text-[12px] text-primary outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

// the dot before the state word in the header chip: the word is the status, the dot only draws it
function StateMark({ state }: { state: string }) {
    if (state === "done") {
        return <Check size={11} strokeWidth={2.4} aria-hidden className="text-success" />;
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

// the chip alone reads the model's clock (a running council's minutes move), so the rest of the Summary does not
// re-draw on every tick
function StateChip({ model, c }: { model: AgentsViewModel; c: Council }) {
    const now = useAtomValue(model.nowAtom);
    return (
        <span
            data-council-state-chip
            className="flex items-center gap-[6px] rounded-full bg-pill px-[9px] py-[3px] text-[10.5px] tabular-nums text-secondary"
        >
            <StateMark state={c.state} />
            {summaryChip(c, now)}
        </span>
    );
}

function Banner({ tone, children }: { tone: "asking" | "error" | "working"; children: ReactNode }) {
    return (
        <div
            role={tone === "error" ? "alert" : "status"}
            className={cn(
                "flex flex-none items-center gap-3 border-b px-8 py-[9px] text-[12px]",
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
        c.state === "running" && (c.round >= 3 || (coordinator != null && c.activity?.[coordinator.id] != null));
    return (
        <div
            data-council-nosummary
            className="flex max-w-[900px] flex-col items-start gap-3 text-[13px] text-secondary"
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
                        <button
                            type="button"
                            data-council-action="retry"
                            onClick={() => void retryExpert(c.id, coordinator.id)}
                            className={BUTTON}
                        >
                            Retry the summary
                        </button>
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
    const [open, setOpen] = useAtom(openDirectionsAtom(c.id));
    const [savedDoc, setSavedDoc] = useAtom(savedDocAtom(c.id));
    const [initiative, setInitiative] = useAtom(initiativeAtom(c.id));
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const summary = c.summary;
    const directions = useMemo(() => directionRows(c), [c]);
    const outdated = outdatedCount(c);
    const coordinator = c.experts.find((e) => e.coordinator);
    const coordinatorFailed = coordinator != null ? c.failed?.[coordinator.id] : undefined;

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

    // the document the finished council saved itself, in the Code surface
    const openDocument = () =>
        act("open-doc", async () => {
            try {
                await openRefInCode(model, { abs: c.docpath ?? "", root: c.project });
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

    const toggle = (rank: number) => setOpen(open.includes(rank) ? open.filter((r) => r !== rank) : [...open, rank]);

    const written = writtenLine(c);
    const asked = askedLine(c);
    const { answer, rest } = answerParts(c);
    const heading = directionsHeading(c);
    const kept = useMemo(() => keptRows(c), [c]);
    const dropped = droppedLine(c);
    const saved = savedLine(c);
    const doc = docAction(c);
    return (
        <>
            <header className="flex flex-none flex-col gap-3 border-b border-edge-faint px-8 pb-[14px] pt-[18px]">
                <div className="flex flex-wrap items-center gap-x-[10px] gap-y-2">
                    <h1 className="m-0 min-w-0 text-[15px] font-semibold tracking-[-0.01em] text-primary">
                        Council · {c.feature}
                    </h1>
                    <StateChip model={model} c={c} />
                    <div className="flex-1" />
                    <button
                        type="button"
                        data-council-action="discussion"
                        onClick={() => showCouncil(c.id, "discussion")}
                        className={BUTTON}
                    >
                        Show the discussion
                    </button>
                    <ActionsMenu
                        items={[
                            doc.id === "open-doc"
                                ? {
                                      id: doc.id,
                                      label: doc.label,
                                      disabled: busy === "open-doc",
                                      onPick: () => void openDocument(),
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
                                disabled:
                                    summary == null ||
                                    directions.length === 0 ||
                                    busy === "initiative" ||
                                    initiative != null,
                                onPick: () => void createInitiative(),
                            },
                            {
                                id: "run-again",
                                label: "Run again",
                                onPick: () => showCouncilSetup(c.project, draftFromCouncil(c)),
                            },
                        ]}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-[6px]">
                    {c.experts.map((e) => (
                        <span
                            key={e.id}
                            data-council-expert={e.id}
                            className="flex items-center gap-[6px] rounded-full bg-surface py-[3px] pl-[3px] pr-[9px] text-[11px] text-secondary"
                        >
                            <Avatar c={c} id={e.id} name={e.name} small />
                            {e.name} <span className="text-muted">{e.model}</span>
                        </span>
                    ))}
                </div>
                {saved !== "" || savedDoc != null || initiative != null || error != null ? (
                    <div className="flex flex-col gap-1 text-[11.5px]">
                        {saved !== "" ? (
                            <span data-council-docpath data-path={c.docpath} className="select-text text-secondary">
                                {saved}
                            </span>
                        ) : savedDoc != null ? (
                            <span data-council-doc-saved data-path={savedDoc} className="text-secondary">
                                Saved to{" "}
                                <span className="select-text text-primary">{docPathLabel(c.project, savedDoc)}</span>
                            </span>
                        ) : null}
                        {initiative != null ? (
                            <span
                                data-council-initiative-made
                                data-effort-oid={initiative.oid}
                                className="flex items-center gap-2 text-secondary"
                            >
                                Created the initiative <span className="text-primary">{initiative.title}</span> with{" "}
                                {initiative.chunks} {initiative.chunks === 1 ? "chunk" : "chunks"}
                                <button
                                    type="button"
                                    data-council-action="open-initiative"
                                    onClick={() => void openTarget(model, { kind: "effort", effortId: initiative.oid })}
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
                        <button
                            type="button"
                            data-council-action="retry"
                            onClick={() => void retryExpert(c.id, coordinator.id)}
                            className={BUTTON}
                        >
                            Retry the summary
                        </button>
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
            <div data-council-scroll className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
                {summary == null ? (
                    <NoSummary c={c} busy={busy === "summarize"} onSummarize={() => void summarizeAgain()} />
                ) : (
                    <div className="flex flex-col gap-[30px]">
                        <div className="flex max-w-[900px] flex-col gap-[10px]">
                            {asked !== "" ? (
                                <span data-council-asked className="text-[12px] text-muted">
                                    {asked}
                                </span>
                            ) : null}
                            {answer !== "" ? (
                                <p
                                    data-council-answer
                                    className="m-0 whitespace-pre-wrap text-[17px] font-semibold leading-[1.4] tracking-[-0.01em] text-primary"
                                >
                                    {answer}
                                </p>
                            ) : null}
                            {rest !== "" ? (
                                <p
                                    data-council-summary-text
                                    className="m-0 whitespace-pre-wrap text-[13.5px] leading-[1.55] text-ink-hi"
                                >
                                    {rest}
                                </p>
                            ) : null}
                            {written !== "" ? (
                                <span data-council-written className="mb-[6px] text-[11.5px] text-muted">
                                    {written}
                                </span>
                            ) : null}
                            {heading !== "" && directions.length > 0 ? (
                                <h2
                                    data-council-directions-heading
                                    className="m-0 text-[13px] font-semibold text-primary"
                                >
                                    {heading}
                                </h2>
                            ) : null}
                            {directions.map((row) => (
                                <DirectionCard
                                    key={row.direction.rank}
                                    c={c}
                                    row={row}
                                    open={open.includes(row.direction.rank)}
                                    busy={busy === `brainstorm:${row.direction.rank}`}
                                    onToggle={() => toggle(row.direction.rank)}
                                    onBrainstorm={() => void brainstorm(row)}
                                    onAskAgain={() => askAgain(row)}
                                />
                            ))}
                            {kept.length > 0 ? (
                                <section data-council-kept className="mt-[14px] flex flex-col gap-[10px]">
                                    <h2 className="m-0 text-[13px] font-semibold text-primary">{keptHeading(c)}</h2>
                                    {kept.map((row, i) => (
                                        <KeptCard key={`${row.direction.rank}-${i}`} row={row} />
                                    ))}
                                </section>
                            ) : null}
                            {dropped !== "" ? (
                                <span data-council-dropped className="text-[11.5px] text-muted">
                                    {dropped}
                                </span>
                            ) : null}
                            <RatingRow key={c.id} c={c} />
                        </div>
                        <Matrix c={c} />
                    </div>
                )}
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
                <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
                    {id == null ? "No council is open." : "Loading the council…"}
                </div>
            ) : (
                <SummaryView model={model} c={c} />
            )}
        </div>
    );
}
