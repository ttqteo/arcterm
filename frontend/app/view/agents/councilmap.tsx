// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council Map tab (board Map-tab.dc.html in .superpowers/design/council-stronger; docs/superpowers/specs/
// 2026-11-03-council-stronger-design.md "The Map tab"): a glance at who did what and who backs which idea. It is open
// while the council runs and after it ends. A header in one 52px row (the Report / Discussion / Map tabs, the feature, the
// step chip, the Seats popover and Pin); the expert cards, one per seat in a grid (avatar, name, what it does now with the
// working dot and a running command in mono, the evidence bar in four segments with its counts in words, then tokens,
// time and calls; a card is a button that asks for that seat's timeline, councilTimelineAtom); the legend; and the stance
// matrix, one row per idea sorted by agreement (the pill of each seat with its icon and word, the check badge under the
// title, the agreement bar, the outcome; a withdrawn idea dim). A click or Enter on a row opens its reasons under each
// seat's column, a second click closes it; with many seats the matrix scrolls sideways inside its own box and the idea
// column stays in place. Before any idea is sent the matrix is one line, "No ideas yet". A Brainstorm asks for no
// evidence, so its cards carry no bar and its rows no badge: the idea shows a Builds on pill instead.
//
// Status is never colour alone: every badge and pill carries an icon and a word. Every word follows the council's
// language (councilmapmodel.ts `mapWords`, councilmodel.ts for the matrix's own); the rules are in those models, and
// this file only draws them. Every control carries a data-council-map-* attribute for the CDP scenario `council-map`.

import { viewFade } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
    ChevronRight,
    CornerDownRight,
    Lightbulb,
    MessageCircleQuestion,
    ThumbsDown,
    ThumbsUp,
    type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useRef } from "react";
import type { AgentsViewModel } from "./agents";
import { CouncilAvatar, MarkedText } from "./councilchat";
import { stepChip } from "./councilchatmodel";
import { CHECK_TONE, CheckIcon, WRONG_CITE_ICON, WRONG_CITE_TONE } from "./councilchecks";
import { avatarTone, seatInitials } from "./councildiscussionmodel";
import { CouncilHeaderRow } from "./councilheader";
import { expertCards, mapWords, type ExpertCard, type MapWords } from "./councilmapmodel";
import {
    byAgreement,
    councilLang,
    matrixRows,
    panel,
    type MatrixCell,
    type MatrixRow,
    type StanceLabel,
} from "./councilmodel";
import { councilMapOpenAtom, councilSelAtom, councilTimelineAtom, useCouncil } from "./councilstore";
import { isBrainstorm, outcomeLabel } from "./councilsummarymodel";

const ROOT = "flex min-h-0 min-w-0 flex-1 flex-col bg-background text-[14px] text-primary";

const H2 = "m-0 text-[14px] font-semibold text-primary";

// the columns of the matrix: the idea's, each seat's, the agreement bar's and the outcome's. The table is never narrower
// than their sum, so a council with many seats scrolls sideways in its own box instead of squeezing the pills.
const IDEA_COL = 280;
const SEAT_COL = 120;
const AGREEMENT_COL = 150;
const OUTCOME_COL = 130;

// ---- the view ----

export function CouncilMap({ model }: { model: AgentsViewModel }) {
    const id = useAtomValue(councilSelAtom);
    const c = useCouncil(id);
    if (c == null) {
        return (
            <div data-council-map className={cn(ROOT, "items-center justify-center text-muted")}>
                {id == null ? "No council is open." : "Loading the council…"}
            </div>
        );
    }
    return <MapView key={c.id} c={c} model={model} />;
}

function MapView({ c, model }: { c: Council; model: AgentsViewModel }) {
    const words = useMemo(() => mapWords(c), [c]);
    const cards = useMemo(() => expertCards(c), [c]);
    const rows = useMemo(() => byAgreement(matrixRows(c)), [c]);
    return (
        <div
            data-council-map
            data-council-id={c.id}
            data-council-state={c.state}
            data-council-lang={councilLang(c)}
            lang={councilLang(c)}
            className={ROOT}
        >
            <Header c={c} onOpenTerminal={(tab) => model.openTerminal(tab)} />
            {/* the body fades in as the view opens (a tab click, a council picked); the header stays put */}
            <motion.div
                variants={viewFade}
                initial="initial"
                animate="animate"
                data-council-map-scroll
                className="min-h-0 flex-1 overflow-y-auto px-6 py-5 @max-[900px]:px-4"
            >
                <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
                    <Cards c={c} cards={cards} words={words} />
                    <Matrix c={c} rows={rows} words={words} />
                </div>
            </motion.div>
        </div>
    );
}

// ---- the header ----

// the step chip's colours by its dot, as the Discussion's: amber while the council waits on the person, green while it
// runs, red when it failed
const CHIP_TONE = {
    working: { box: "bg-pill text-secondary", dot: "bg-working pulse-dot" },
    waiting: { box: "bg-askingbg text-warning-soft", dot: "bg-asking" },
    failed: { box: "bg-error/12 text-error-soft", dot: "bg-error" },
    idle: { box: "bg-pill text-secondary", dot: "bg-ink-faint" },
};

function StatusChip({ c }: { c: Council }) {
    const chip = stepChip(c);
    const tone = CHIP_TONE[chip.dot];
    return (
        <span
            data-council-map-chip
            aria-live="polite"
            title={chip.text}
            className={cn(
                "inline-flex min-w-0 flex-[0_1_auto] items-center gap-[6px] whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10.5px] tabular-nums",
                tone.box
            )}
        >
            <span aria-hidden className={cn("h-[6px] w-[6px] flex-none rounded-full", tone.dot)} />
            <span className="min-w-0 truncate">{chip.text}</span>
        </span>
    );
}

function Header({ c, onOpenTerminal }: { c: Council; onOpenTerminal: (tab: string) => void }) {
    return (
        <header className="@container flex flex-none flex-col border-b border-border bg-surface">
            <CouncilHeaderRow
                c={c}
                view="map"
                details
                titleAttr="data-council-map-title"
                status={<StatusChip c={c} />}
                onOpenTerminal={onOpenTerminal}
            />
        </header>
    );
}

// ---- the expert cards ----

function Cards({ c, cards, words }: { c: Council; cards: ExpertCard[]; words: MapWords }) {
    return (
        <section data-council-map-cards aria-label={words.cardsTitle} className="flex flex-col gap-[10px]">
            <div className="flex flex-wrap items-baseline gap-x-[10px] gap-y-1">
                <h2 className={H2}>{words.cardsTitle}</h2>
                <span className="text-[12px] text-muted">{words.cardsHint}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[10px]">
                {cards.map((card) => (
                    <Card key={card.id} c={c} card={card} words={words} />
                ))}
            </div>
        </section>
    );
}

// where the dot before "what it does" stands: green while it works, red when its call failed, grey otherwise. The line's
// own words say the same, so the colour is never alone.
function doingDot(card: ExpertCard, failed: boolean): string {
    return card.working ? "bg-working pulse-dot" : failed ? "bg-error" : "bg-ink-faint";
}

function Doing({ card, failed, words }: { card: ExpertCard; failed: boolean; words: MapWords }) {
    return (
        <span
            data-council-map-doing
            data-working={card.working ? "true" : "false"}
            data-command={card.command ? "true" : "false"}
            className={cn(
                "flex min-w-0 items-center gap-[6px] text-[12px]",
                card.working ? "text-primary" : failed ? "text-error-soft" : "text-muted"
            )}
        >
            <span aria-hidden className={cn("h-[7px] w-[7px] flex-none rounded-full", doingDot(card, failed))} />
            {card.command ? (
                <>
                    <span className="flex-none text-success-soft">{words.running}</span>
                    <span
                        data-council-map-command
                        title={card.doing}
                        className="min-w-0 truncate font-mono text-[11.5px] text-secondary"
                    >
                        {card.doing}
                    </span>
                </>
            ) : (
                <span data-council-map-doing-text title={card.doing} className="min-w-0 truncate">
                    {card.doing}
                </span>
            )}
        </span>
    );
}

// the evidence bar: one segment per label that has a claim, as wide as its count, and the four counts in words under it
function Evidence({ card }: { card: ExpertCard }) {
    return (
        <span data-council-map-evidence className="flex flex-col gap-[5px]">
            <span
                data-council-map-bar
                role="img"
                aria-label={[card.claimsText, ...card.evidence.map((e) => e.text)].join(", ")}
                className="flex h-[6px] gap-px overflow-hidden rounded-full bg-pill"
            >
                {card.evidence
                    .filter((e) => e.n > 0)
                    .map((e) => (
                        <span
                            key={e.label}
                            data-segment={e.label}
                            style={{ flexGrow: e.n, flexBasis: 0 }}
                            className={CHECK_TONE[e.label].bar}
                        />
                    ))}
            </span>
            <span className="flex flex-wrap gap-x-[10px] gap-y-[2px] text-[11.5px] tabular-nums">
                <span data-council-map-claims className="text-secondary">
                    {card.claimsText}
                </span>
                {card.evidence.map((e) => (
                    <span
                        key={e.label}
                        data-council-map-count={e.label}
                        className={cn(
                            "inline-flex items-center gap-[3px]",
                            e.n > 0 ? CHECK_TONE[e.label].text : "text-ink-faint"
                        )}
                    >
                        <CheckIcon label={e.label} size={10} />
                        {e.text}
                    </span>
                ))}
            </span>
            {card.wrongCitesText !== "" && (
                <span
                    data-council-map-wrongcites
                    className={cn("inline-flex items-center gap-[4px] text-[11.5px]", WRONG_CITE_TONE.text)}
                >
                    <WRONG_CITE_ICON size={11} aria-hidden className="flex-none" />
                    {card.wrongCitesText}
                </span>
            )}
        </span>
    );
}

function Card({ c, card, words }: { c: Council; card: ExpertCard; words: MapWords }) {
    const setTimeline = useSetAtom(councilTimelineAtom(c.id));
    const failed = c.failed?.[card.id] != null;
    return (
        <button
            type="button"
            data-council-map-card={card.id}
            data-council-timeline-trigger
            aria-label={words.openTimeline(card.name)}
            onClick={() => setTimeline(card.id)}
            className="flex min-w-0 cursor-pointer flex-col gap-[10px] rounded-lg border border-edge-mid bg-surface-raised p-3 text-left outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        >
            <span className="flex items-center gap-[9px]">
                <CouncilAvatar large tone={card.tone} name={card.name} initials={card.initials} />
                <span data-council-map-name className="min-w-0 truncate text-[13.5px] font-semibold text-primary">
                    {card.name}
                </span>
            </span>
            <Doing card={card} failed={failed} words={words} />
            {card.counts != null && <Evidence card={card} />}
            <span className="flex flex-wrap gap-x-3 gap-y-1 border-t border-edge-mid pt-2 text-[11.5px] tabular-nums text-muted">
                <span data-council-map-tokens>{card.tokens}</span>
                <span data-council-map-time>{card.time}</span>
                <span data-council-map-calls>{card.calls}</span>
            </span>
        </button>
    );
}

// ---- the legend ----

function Legend({ words }: { words: MapWords }) {
    return (
        <ul
            data-council-map-legend
            className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[11.5px] text-muted"
        >
            {words.legend.map((item) => (
                <li key={item.label} data-legend={item.label} className="inline-flex items-center gap-[5px]">
                    <CheckIcon label={item.label} className={CHECK_TONE[item.label].text} />
                    <span>
                        <span className="font-semibold text-secondary">{item.word}</span>: {item.meaning}
                    </span>
                </li>
            ))}
            <li data-legend="wrong-cite" className="inline-flex items-center gap-[5px]">
                <WRONG_CITE_ICON size={12} aria-hidden className={cn("flex-none", WRONG_CITE_TONE.text)} />
                <span>
                    <span className="font-semibold text-secondary">{words.wrongCite.word}</span>:{" "}
                    {words.wrongCite.meaning}
                </span>
            </li>
        </ul>
    );
}

// ---- the stance matrix ----

// the pill of each stance: tint, text and icon. The word is the cell's (its language is the matrix's).
const STANCE_STYLE: Record<StanceLabel, { pill: string; icon: LucideIcon }> = {
    proposed: { pill: "bg-pill text-secondary", icon: Lightbulb },
    accept: { pill: "bg-success/12 text-success-soft", icon: ThumbsUp },
    challenge: { pill: "bg-warning/12 text-warning-soft", icon: MessageCircleQuestion },
    oppose: { pill: "bg-error/12 text-error-soft", icon: ThumbsDown },
};

const BADGE = "inline-flex items-center gap-[5px] rounded-[6px] px-2 py-[2px]";

function StanceCell({ cell }: { cell: MatrixCell }) {
    const style = cell.stance !== "" ? STANCE_STYLE[cell.stance] : null;
    return (
        <span className="inline-flex flex-col items-center gap-[4px]">
            {style != null ? (
                <span
                    data-council-map-pill={cell.stance}
                    className={cn(
                        "inline-flex items-center gap-[4px] whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold",
                        style.pill
                    )}
                >
                    <style.icon size={10} strokeWidth={2.2} aria-hidden className="flex-none" />
                    {cell.word}
                </span>
            ) : (
                <span data-council-map-pill="none" className="text-[11.5px] text-ink-faint">
                    {cell.word}
                </span>
            )}
            {cell.note !== "" && (
                <span data-council-map-revised className="text-center text-[10.5px] text-muted">
                    {cell.note}
                </span>
            )}
        </span>
    );
}

// the line under an idea's title: the check badge Go set (with the command that ran and its result, or the cite that
// holds), or in a Brainstorm the Builds on pill; nothing where there is neither
function CheckLine({ row }: { row: MatrixRow }) {
    if (row.builds != null) {
        return (
            <span data-council-map-builds className={cn(BADGE, "w-fit bg-pill text-[12px] text-secondary")}>
                <CornerDownRight size={12} aria-hidden className="flex-none" />
                {row.builds.word}
            </span>
        );
    }
    const check = row.check;
    if (check == null) {
        return null;
    }
    return (
        <span data-council-map-check={check.label} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            <span className={cn(BADGE, CHECK_TONE[check.label].badge)}>
                <CheckIcon label={check.label} />
                {check.word}
            </span>
            {check.command !== "" && (
                <span
                    data-council-map-command
                    title={check.command}
                    className="min-w-0 break-all font-mono text-[11.5px] text-secondary"
                >
                    {check.command}
                </span>
            )}
            {check.result !== "" && <span className="text-muted">{check.result}</span>}
            {check.cite !== "" && (
                <span
                    data-council-map-cite
                    className="inline-flex items-center rounded-[6px] border border-edge-mid bg-surface px-[7px] py-px text-link"
                >
                    {check.cite}
                </span>
            )}
        </span>
    );
}

// the agreement column: a bar of the seats that agree, doubt and are against (green, amber, red; each count in words
// under it, so no segment is colour alone)
function AgreementBar({ row }: { row: MatrixRow }) {
    const parts = [
        { key: "agree", n: row.agrees, tone: "bg-success" },
        { key: "doubt", n: row.doubts, tone: "bg-warning" },
        { key: "against", n: row.against, tone: "bg-error" },
    ];
    const said = row.agrees + row.doubts + row.against > 0;
    return (
        <span className="flex flex-col gap-[5px]">
            <span
                data-council-map-agreement-bar
                role="img"
                aria-label={row.consensus}
                className="flex h-[6px] gap-px overflow-hidden rounded-full bg-pill"
            >
                {parts
                    .filter((p) => p.n > 0)
                    .map((p) => (
                        <span
                            key={p.key}
                            data-segment={p.key}
                            style={{ flexGrow: p.n, flexBasis: 0 }}
                            className={p.tone}
                        />
                    ))}
            </span>
            <span
                data-council-map-consensus
                className={cn("text-[11.5px] tabular-nums", said ? "text-secondary" : "text-muted")}
            >
                {row.consensus}
            </span>
        </span>
    );
}

// the idea column and its sticky edge: the cells of that column stay in place while the seats scroll under them
const STICKY = "sticky left-0 z-[1] border-r border-edge-mid";

function IdeaRow({
    row,
    open,
    onToggle,
    words,
}: {
    row: MatrixRow;
    open: boolean;
    onToggle: () => void;
    words: MapWords;
}) {
    const p = row.proposal;
    const reasonsId = `council-map-reasons-${p.id}`;
    // opaque grounds, so a seat's cell scrolling under the sticky column is covered
    const ground = open ? "bg-surface-hover" : "bg-background group-hover:bg-surface-hover";
    const cell = "border-t border-edge-mid px-[6px] py-[11px] align-top";
    return (
        <>
            <tr
                data-council-map-row={p.id}
                data-open={open ? "true" : "false"}
                data-dimmed={row.dimmed ? "true" : "false"}
                data-withdrawn={row.withdrawn ? "true" : "false"}
                onClick={onToggle}
                className={cn("group cursor-pointer", row.dimmed && "opacity-60")}
            >
                <td className={cn(cell, STICKY, "px-3", ground)}>
                    <span className="flex flex-col gap-[6px]">
                        <button
                            type="button"
                            data-council-map-toggle
                            aria-expanded={open}
                            aria-controls={open ? reasonsId : undefined}
                            className="flex w-full cursor-pointer items-start gap-[6px] rounded-[4px] border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <ChevronRight
                                size={13}
                                aria-hidden
                                className={cn("mt-[3px] flex-none text-muted", open && "rotate-90")}
                            />
                            <span data-council-map-title className="text-[13.5px] font-medium text-primary">
                                {p.title}
                            </span>
                        </button>
                        <CheckLine row={row} />
                    </span>
                </td>
                {row.cells.map((cellData) => (
                    <td
                        key={cellData.expert.id}
                        data-council-map-cell={cellData.expert.id}
                        data-stance={cellData.stance === "" ? "none" : cellData.stance}
                        className={cn(cell, "text-center", ground)}
                    >
                        <StanceCell cell={cellData} />
                    </td>
                ))}
                <td data-council-map-agreement className={cn(cell, "px-3", ground)}>
                    <AgreementBar row={row} />
                </td>
                <td
                    data-council-map-outcome
                    className={cn(
                        cell,
                        "px-3 text-[12px]",
                        row.outcome === "" || row.dimmed ? "text-muted" : "font-semibold text-primary",
                        ground
                    )}
                >
                    {outcomeLabel(row.outcome) || "—"}
                </td>
            </tr>
            {open && (
                <tr data-council-map-reasons={p.id} id={reasonsId}>
                    <td className={cn("bg-surface-hover px-3 pb-3 pt-1 align-top text-[12px] text-muted", STICKY)}>
                        {words.reasonsTitle}
                    </td>
                    {row.cells.map((cellData) => (
                        <td
                            key={cellData.expert.id}
                            data-council-map-reason={cellData.expert.id}
                            className="bg-surface-hover px-[6px] pb-3 pt-1 align-top text-[12px] leading-[1.45] text-secondary"
                        >
                            {cellData.reason !== "" && <MarkedText text={cellData.reason} />}
                        </td>
                    ))}
                    <td colSpan={2} className="bg-surface-hover" aria-hidden />
                </tr>
            )}
        </>
    );
}

function MatrixCols({ seats }: { seats: CouncilExpert[] }) {
    return (
        <colgroup>
            <col style={{ width: IDEA_COL }} />
            {seats.map((e) => (
                <col key={e.id} style={{ width: SEAT_COL }} />
            ))}
            <col style={{ width: AGREEMENT_COL }} />
            <col style={{ width: OUTCOME_COL }} />
        </colgroup>
    );
}

// the matrix's column heads. Drawn twice: once as the visible header that sticks to the top of the page while the rows
// scroll (`shown`, which carries the data-council-map-* marks), and once hidden inside the rows' own table, so a screen
// reader still reads each cell under its column
function MatrixHead({
    c,
    seats,
    words,
    shown,
}: {
    c: Council;
    seats: CouncilExpert[];
    words: MapWords;
    shown: boolean;
}) {
    return (
        <thead className={shown ? undefined : "sr-only"}>
            <tr>
                <th scope="col" className={cn("bg-surface px-3 py-[9px] text-[12px] font-medium text-muted", STICKY)}>
                    {words.headIdea}
                </th>
                {seats.map((e) => (
                    <th
                        key={e.id}
                        scope="col"
                        data-council-map-head={shown ? e.id : undefined}
                        className="bg-surface px-[6px] py-[9px] text-center text-[12px] font-medium text-secondary"
                    >
                        <span className="inline-flex items-center gap-[6px] text-left">
                            <CouncilAvatar
                                small
                                tone={avatarTone(c, e.id)}
                                name={e.name}
                                initials={seatInitials(c, e.id)}
                            />
                            <span data-council-map-head-name={shown ? "" : undefined} className="min-w-0 break-words">
                                {e.name}
                            </span>
                        </span>
                    </th>
                ))}
                <th scope="col" className="bg-surface px-3 py-[9px] text-[12px] font-medium text-muted">
                    {words.headAgreement}
                </th>
                <th scope="col" className="bg-surface px-3 py-[9px] text-[12px] font-medium text-muted">
                    {words.headOutcome}
                </th>
            </tr>
        </thead>
    );
}

function Matrix({ c, rows, words }: { c: Council; rows: MatrixRow[]; words: MapWords }) {
    const [openId, setOpenId] = useAtom(councilMapOpenAtom(c.id));
    const seats = panel(c);
    const minWidth = IDEA_COL + seats.length * SEAT_COL + AGREEMENT_COL + OUTCOME_COL;
    const revisedShown = rows.some((row) => row.cells.some((cell) => cell.note !== ""));
    // the header sits outside the rows' box (a box that scrolls sideways can't let a head stick to the page's top), so it
    // follows the rows' sideways scroll by hand
    const headBox = useRef<HTMLDivElement>(null);
    const followScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (headBox.current != null) {
            headBox.current.scrollLeft = e.currentTarget.scrollLeft;
        }
    };
    return (
        <section data-council-map-matrix aria-label={words.matrixTitle} className="flex flex-col gap-[10px]">
            <div className="flex flex-wrap items-baseline gap-x-[10px] gap-y-1">
                <h2 className={H2}>{words.matrixTitle}</h2>
                {rows.length > 0 && <span className="text-[12px] text-muted">{words.matrixHint}</span>}
                <span className="flex-1" />
                {/* the legend says what the badges mean: a Brainstorm asks for no evidence and has none */}
                {rows.length > 0 && !isBrainstorm(c) && <Legend words={words} />}
            </div>
            {rows.length === 0 ? (
                <p
                    data-council-map-empty
                    className="m-0 rounded-lg border border-dashed border-edge-mid px-4 py-5 text-[13px] text-muted"
                >
                    {words.noIdeas}
                </p>
            ) : (
                <div data-council-map-frame>
                    <div
                        ref={headBox}
                        data-council-map-headbox
                        aria-hidden
                        className="sticky -top-5 z-[2] overflow-hidden rounded-t-lg border border-edge-mid bg-surface"
                    >
                        <table
                            data-council-map-table
                            className="w-full table-fixed border-separate border-spacing-0 text-left"
                            style={{ minWidth }}
                        >
                            <MatrixCols seats={seats} />
                            <MatrixHead c={c} seats={seats} words={words} shown />
                        </table>
                    </div>
                    <div
                        data-council-map-box
                        onScroll={followScroll}
                        className="overflow-x-auto rounded-b-lg border border-t-0 border-edge-mid bg-background"
                    >
                        <table
                            aria-label={words.matrixTitle}
                            className="w-full table-fixed border-separate border-spacing-0 text-left"
                            style={{ minWidth }}
                        >
                            <MatrixCols seats={seats} />
                            <MatrixHead c={c} seats={seats} words={words} shown={false} />
                            <tbody>
                                {rows.map((row) => (
                                    <IdeaRow
                                        key={row.proposal.id}
                                        row={row}
                                        open={openId === row.proposal.id}
                                        onToggle={() => setOpenId(openId === row.proposal.id ? null : row.proposal.id)}
                                        words={words}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {revisedShown && (
                <span data-council-map-foot className="text-[12px] text-muted">
                    {words.revisedFoot}
                </span>
            )}
        </section>
    );
}
