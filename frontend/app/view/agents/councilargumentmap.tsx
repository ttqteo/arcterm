// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The argument map (figure E of docs/superpowers/plans/2026-11-19-council-figures.md): who replied to which idea, and how.
// The Map tab's Graph view, beside the stance matrix. Two columns joined by edges:
//   - left, the seats in panel order (avatar, name, "N replies" under it) and a "You" row when the person replied;
//   - right, the ideas grouped by outcome (one group per direction, then Also raised, Withdrawn, Cut), each an id, a
//     one-line title and its check label chip.
// An edge is a horizontal cubic from a seat to an idea: the author's is solid and neutral, a reply's takes its stance
// (accept solid, challenge dashed, oppose dotted) with the stance's glyph at the idea end. A stance is never a colour
// alone: the dash pattern and the glyph always come with the tint, and the legend names them.
//
// Every position comes from the model's fixed rows (`GraphIdea.y`, `index * GRAPH_ROW_PX`), computed once by
// `placeGraph` (councilargumentgeometry.ts): nothing is measured, so the edges draw in one pass and nothing moves
// between renders. Hovering or focusing an idea or a seat keeps its edges at full strength and drops the rest to 20%
// (the nodes they do not connect fade with them); a click or Enter on an idea calls `onOpenIdea` (the Map switches to
// Matrix with that row open). The graph scrolls vertically inside its box.
//
// Markers for the CDP scenario `council-figures-graph`: `data-council-figure="graph"`, `data-graph-idea={id}`,
// `data-graph-seat={id}`, `data-graph-edge="<seat>-><idea>"` with `data-stance`, and `data-dimmed` on a faded edge.

import { cn } from "@/util/util";
import { useMemo, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import {
    GRAPH_GAP_PX,
    edgePath,
    edgeStays,
    ideaMark,
    parseMark,
    placeGraph,
    relatedTo,
    seatMark,
    stanceTally,
    tallyWords,
} from "./councilargumentgeometry";
import {
    ChartFigure,
    ChartTable,
    DIM_OPACITY,
    HOVER_FADE,
    STANCE_GLYPH_WORD,
    STANCE_TONE,
    TipBody,
    hoverFadeStyle,
    useChartTip,
    useHoverDim,
    type ChartStance,
} from "./councilchartparts";
import { CouncilAvatar } from "./councilchat";
import { CHECK_TONE, CheckIcon } from "./councilchecks";
import { avatarTone, seatInitials } from "./councildiscussionmodel";
import {
    GRAPH_HEADING_PX,
    GRAPH_ROW_PX,
    GRAPH_SEAT_TOP_PX,
    argumentGraph,
    type GraphEdge,
    type GraphIdea,
    type GraphSeat,
} from "./councilfiguresmodel";
import { checkLabelOf, checkWord, councilLang, type CouncilLang } from "./councilmodel";

const LEFT_COL_PX = 168; // the seat column
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// how each stance's edge is drawn: its ink (the status token) and its dash. Accept is solid, challenge dashed and oppose
// dotted (round caps turn a near-zero dash into a dot), so the stance survives a colour-blind reading.
const EDGE_STROKE: Record<ChartStance, string> = {
    proposed: "stroke-muted",
    accept: "stroke-success",
    challenge: "stroke-warning",
    oppose: "stroke-error",
    builds: "stroke-muted",
};
const EDGE_DASH: Record<ChartStance, string | undefined> = {
    proposed: undefined,
    accept: undefined,
    challenge: "6 4",
    oppose: "0.1 5",
    builds: undefined,
};

const LEGEND: readonly ChartStance[] = ["proposed", "accept", "challenge", "oppose"];

/** The stance glyph of an edge's end, about 10px across and centred on the origin, in the ink of its `<g>` (`currentColor`):
 *  ✓ Accept, ? Challenge, ✕ Oppose, ● Proposed. */
function GlyphMark({ stance }: { stance: ChartStance }) {
    const line = {
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
    } as const;
    switch (stance) {
        case "accept":
            return <path d="M-3 0.3 L-0.9 2.5 L3.2 -2.5" {...line} />;
        case "oppose":
            return <path d="M-2.6 -2.6 L2.6 2.6 M2.6 -2.6 L-2.6 2.6" {...line} />;
        case "challenge":
            return (
                <>
                    <path d="M-2.2 -1.7 Q-2.2 -3.7 0 -3.7 Q2.2 -3.7 2.2 -1.8 Q2.2 -0.6 0.7 0 Q0 0.4 0 1.5" {...line} />
                    <circle cx={0} cy={3.6} r={0.95} fill="currentColor" />
                </>
            );
        default:
            return <circle r={3} fill="currentColor" />;
    }
}

/** A glyph on its backing disc, which hides the edges under it and is the hover target (larger than the mark). */
function EdgeGlyph({ stance }: { stance: ChartStance }) {
    return (
        <>
            <circle r={8} className="fill-background" />
            <GlyphMark stance={stance} />
        </>
    );
}

// the seat's avatar, decorative: the name always sits beside it
function SeatAvatar({ c, seat }: { c: Council; seat: GraphSeat }) {
    return (
        <span aria-hidden className="flex flex-none">
            <CouncilAvatar tone={avatarTone(c, seat.id)} name={seat.name} initials={seatInitials(c, seat.id)} small />
        </span>
    );
}

/** An idea's check label as a chip: the label's icon and word on its tint (Ran, Read code, Guess, Disproved). A label the
 *  cockpit does not know (the model may hand a word) is a plain pill; none draws nothing. */
function LabelChip({ label, lang }: { label: string; lang: CouncilLang }) {
    const key = checkLabelOf({ label });
    if (key === "" && label === "") {
        return null;
    }
    return (
        <span
            data-graph-label={key === "" ? label : key}
            className={cn(
                "inline-flex h-[18px] flex-none items-center gap-[4px] whitespace-nowrap rounded-[5px] px-[6px] text-[10.5px] font-semibold leading-none",
                key === "" ? "bg-pill text-secondary" : CHECK_TONE[key].badge
            )}
        >
            {key !== "" && <CheckIcon label={key} size={10} />}
            {key === "" ? label : checkWord(key, lang)}
        </span>
    );
}

function stanceWord(stance: GraphEdge["stance"]): string {
    return STANCE_GLYPH_WORD[stance];
}

/** Figure E for the Map's Graph view. `onOpenIdea(id)` is what a click or Enter on an idea calls. Draws nothing for a
 *  council with no sent idea (the model answers `null`). */
export function ArgumentMap({ c, onOpenIdea }: { c: Council; onOpenIdea: (id: string) => void }) {
    const graph = useMemo(() => argumentGraph(c), [c]);
    if (graph == null) {
        return null;
    }
    return <GraphFigure c={c} graph={graph} onOpenIdea={onOpenIdea} />;
}

function GraphFigure({
    c,
    graph,
    onOpenIdea,
}: {
    c: Council;
    graph: NonNullable<ReturnType<typeof argumentGraph>>;
    onOpenIdea: (id: string) => void;
}) {
    const { seats, groups, edges, takeaway } = graph;
    const lang = councilLang(c);
    const layout = useMemo(() => placeGraph(seats, groups, edges), [seats, groups, edges]);
    const hov = useHoverDim<string>();
    const tip = useChartTip();
    const mark = parseMark(hov.active);
    const related = relatedTo(mark, edges);
    const seatName = (id: string) => seats.find((s) => s.id === id)?.name ?? id;
    const ideas = groups.flatMap((g) => g.ideas);
    const ideaOf = (id: string): GraphIdea | undefined => ideas.find((i) => i.id === id);

    // one handler set per mark: the hover that dims the rest, and the tooltip
    const marks = (m: string, content: ReactNode) => {
        const h = hov.bind(m);
        const t = tip.bind(content);
        return {
            onPointerEnter: (e: PointerEvent<Element>) => {
                h.onPointerEnter();
                t.onPointerEnter(e);
            },
            onPointerLeave: (e: PointerEvent<Element>) => {
                h.onPointerLeave();
                t.onPointerLeave(e);
            },
            onFocus: (e: FocusEvent<Element>) => {
                h.onFocus();
                t.onFocus(e);
            },
            onBlur: (e: FocusEvent<Element>) => {
                h.onBlur();
                t.onBlur(e);
            },
        };
    };

    const seatTip = (seat: GraphSeat) => {
        const proposed = edges.filter((e) => e.seat === seat.id && e.stance === "proposed").length;
        const lines = [
            `${seat.replies} ${seat.replies === 1 ? "reply" : "replies"}: ${tallyWords(stanceTally(edges, (e) => e.seat === seat.id))}`,
        ];
        if (proposed > 0) {
            lines.push(`proposed ${proposed} ${proposed === 1 ? "idea" : "ideas"}`);
        }
        return <TipBody title={seat.name} lines={lines} />;
    };
    const ideaTip = (idea: GraphIdea) => {
        const author = edges.find((e) => e.idea === idea.id && e.stance === "proposed");
        const lines = [tallyWords(stanceTally(edges, (e) => e.idea === idea.id))];
        if (author != null) {
            lines.push(`proposed by ${seatName(author.seat)}`);
        }
        return <TipBody title={`${idea.id} · ${idea.title}`} lines={lines} />;
    };
    const edgeTip = (e: GraphEdge) => (
        <TipBody
            title={`${seatName(e.seat)} → ${e.idea}`}
            lines={[
                e.stance === "proposed"
                    ? "Proposed it"
                    : `${stanceWord(e.stance)}${e.count > 1 ? ` × ${e.count}` : ""}`,
            ]}
        />
    );

    const faded = (kind: "idea" | "seat", id: string) =>
        related != null && !(kind === "idea" ? related.ideas : related.seats).has(id);

    const table = (
        <ChartTable
            columns={["Seat", "Idea", "Stance", "Replies"]}
            numeric={[3]}
            rows={edges.map((e) => [
                seatName(e.seat),
                `${e.idea} · ${ideaOf(e.idea)?.title ?? ""}`,
                stanceWord(e.stance),
                e.stance === "proposed" ? "" : e.count,
            ])}
        />
    );

    return (
        <ChartFigure id="graph" title="Argument map" takeaway={takeaway} table={table}>
            <div
                data-graph-scroll
                className="max-h-[440px] overflow-auto rounded-lg border border-edge-mid bg-background p-3"
            >
                <div className="relative min-w-[560px]" style={{ height: layout.height }}>
                    {/* the seats, in reading order first */}
                    <ul className="m-0 list-none p-0">
                        {seats.map((seat, i) => (
                            <li
                                key={seat.id}
                                data-graph-seat={seat.id}
                                data-node-dimmed={faded("seat", seat.id) ? "" : undefined}
                                tabIndex={0}
                                aria-label={`${seat.name}, ${seat.replies} ${seat.replies === 1 ? "reply" : "replies"}`}
                                style={{
                                    ...hoverFadeStyle,
                                    top: GRAPH_SEAT_TOP_PX + i * GRAPH_ROW_PX,
                                    height: GRAPH_ROW_PX,
                                    width: LEFT_COL_PX,
                                }}
                                className={cn(
                                    "absolute left-0 flex items-center gap-2 rounded-md px-1",
                                    FOCUS,
                                    HOVER_FADE,
                                    faded("seat", seat.id) && DIM_OPACITY
                                )}
                                {...marks(seatMark(seat.id), seatTip(seat))}
                            >
                                <SeatAvatar c={c} seat={seat} />
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-[12px] font-semibold leading-[13px] text-primary">
                                        {seat.name}
                                    </span>
                                    <span className="truncate text-[10px] leading-[11px] text-muted">
                                        {seat.replies} {seat.replies === 1 ? "reply" : "replies"}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>

                    {/* the edges, between the columns: drawn from the placed rows, no measuring */}
                    <svg
                        aria-hidden
                        width={GRAPH_GAP_PX}
                        height={layout.height}
                        className="absolute top-0 overflow-visible"
                        style={{ left: LEFT_COL_PX }}
                    >
                        {layout.edges.map((p) => {
                            const stays = edgeStays(mark, p.edge);
                            const stance: ChartStance = p.edge.stance;
                            return (
                                <g
                                    key={p.key}
                                    data-graph-edge={`${p.edge.seat}->${p.edge.idea}`}
                                    data-stance={stance}
                                    data-count={p.edge.count}
                                    data-dimmed={stays ? undefined : ""}
                                    style={hoverFadeStyle}
                                    className={cn(HOVER_FADE, !stays && DIM_OPACITY)}
                                >
                                    <path
                                        d={edgePath(p.y1, p.y2)}
                                        fill="none"
                                        strokeWidth={2}
                                        strokeLinecap="round"
                                        strokeDasharray={EDGE_DASH[stance]}
                                        className={EDGE_STROKE[stance]}
                                    />
                                    <g
                                        transform={`translate(${p.glyph.x} ${p.glyph.y})`}
                                        className={STANCE_TONE[stance]}
                                        {...tip.bind(edgeTip(p.edge))}
                                    >
                                        <EdgeGlyph stance={stance} />
                                    </g>
                                </g>
                            );
                        })}
                    </svg>

                    {/* the ideas, by outcome */}
                    <div
                        className="absolute top-0"
                        style={{ left: LEFT_COL_PX + GRAPH_GAP_PX, right: 0, height: layout.height }}
                    >
                        {layout.headings.map((h) => (
                            <div
                                key={h.key}
                                data-graph-group={h.key}
                                style={{ top: h.top, height: GRAPH_HEADING_PX }}
                                className="absolute inset-x-0 flex items-end truncate px-2 pb-[3px] text-[11px] font-semibold text-muted"
                            >
                                <span className="truncate">{h.heading}</span>
                            </div>
                        ))}
                        {ideas.map((idea) => {
                            const fade = faded("idea", idea.id);
                            return (
                                <button
                                    key={idea.id}
                                    type="button"
                                    data-graph-idea={idea.id}
                                    data-node-dimmed={fade ? "" : undefined}
                                    onClick={() => onOpenIdea(idea.id)}
                                    style={{ ...hoverFadeStyle, top: idea.y, height: GRAPH_ROW_PX }}
                                    className={cn(
                                        "absolute inset-x-0 flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[12px] hover:bg-surface-hover",
                                        FOCUS,
                                        HOVER_FADE,
                                        fade ? DIM_OPACITY : idea.dim && "opacity-50"
                                    )}
                                    {...marks(ideaMark(idea.id), ideaTip(idea))}
                                >
                                    <span className="flex-none text-[11px] font-semibold tabular-nums text-secondary">
                                        {idea.id}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-primary">{idea.title}</span>
                                    <LabelChip label={idea.label} lang={lang} />
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
            <ul
                data-graph-legend
                className="m-0 mt-2 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-[11px] text-muted"
            >
                {LEGEND.map((stance) => (
                    <li key={stance} className="flex items-center gap-[6px]">
                        <svg width={46} height={16} aria-hidden className="flex-none">
                            <path
                                d="M1 8 H32"
                                fill="none"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeDasharray={EDGE_DASH[stance]}
                                className={EDGE_STROKE[stance]}
                            />
                            <g transform="translate(38 8)" className={STANCE_TONE[stance]}>
                                <GlyphMark stance={stance} />
                            </g>
                        </svg>
                        {STANCE_GLYPH_WORD[stance]}
                    </li>
                ))}
                <li className="flex items-center gap-[6px]">
                    <span className="opacity-50">Faded</span>
                    withdrawn or cut
                </li>
            </ul>
            {tip.node}
        </ChartFigure>
    );
}
