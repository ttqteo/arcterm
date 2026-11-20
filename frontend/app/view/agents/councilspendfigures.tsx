// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Report's "What it spent" section (docs/superpowers/plans/2026-11-19-council-figures.md, figures C and D), drawn
// from what councilfiguresmodel.ts derives from the council:
//   - C, what each seat spent: one bar per seat on one shared linear axis, in panel order with the coordinator last, so a
//     seat keeps its place whatever it spent, then a muted "Memory check" row for the tokens and calls the seats' own
//     stats do not hold (the rows add up to the header line).
//   - D, when each seat worked and what it read twice: a lane per seat on a time axis, its stretches of work as bars, its
//     steps on them told apart by shape (a read is a tick, a search a dot, a command a square, a post a flag; a read of a
//     file another seat also read is hollow), the rounds as rules, and under the lanes the files more than one seat read.
// Every number and word is the model's; a figure the model gives `null` is not drawn. Click or Enter on a seat row or a
// lane calls `onSeat(id)` (the Discussion on that seat's messages alone). Reduced motion: no transitions.
//
// Markers: `data-council-figure="spend"` / `"lanes"` (ChartFigure's), `data-spend-seat={id}` on each seat row
// (`data-spend-memory` on the memory-check row, which is not a seat), `data-lane-seat={id}` on each lane,
// `data-lane-span` on each stretch's hit target, `data-shared-read={path}` on each row of the shared-read list
// (`data-shared-read-more` on its "and N more" row).

import { cn } from "@/util/util";
import useResizeObserver from "@react-hook/resize-observer";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
    ChartFigure,
    ChartTable,
    HOVER_FADE,
    LinearAxis,
    TipBody,
    WIDTH_EASE,
    hoverFadeStyle,
    linearScale,
    linearTicks,
    useChartTip,
    widthEaseStyle,
} from "./councilchartparts";
import { CouncilAvatar } from "./councilchat";
import { avatarTone, seatInitials, shortName } from "./councildiscussionmodel";
import {
    MAX_TIMELINE_STEPS,
    seatLanes,
    seatSpend,
    type Lane,
    type LaneSpan,
    type LaneStep,
    type SharedRead,
    type SpendRow,
} from "./councilfiguresmodel";
import { duration } from "./councilmodel";

type SpendData = NonNullable<ReturnType<typeof seatSpend>>;
type LanesData = NonNullable<ReturnType<typeof seatLanes>>;

// ── words and numbers ───────────────────────────────────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A token count as the figure's lines write it: 3.0M, 38k, 950. */
function tokensLabel(n: number): string {
    if (n >= 999_500) {
        return `${(n / 1_000_000).toFixed(1)}M`;
    }
    if (n >= 1_000) {
        return `${Math.round(n / 1_000)}k`;
    }
    return String(Math.round(n));
}

const exact = (n: number) => Math.round(n).toLocaleString("en-US");

/** A step's time as a clock (09:04:12), for a stretch's tooltip and the Table. */
function clockOf(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

/** A path as the list shows it: the folder muted, the file's own name in primary ink. Backslashes read as slashes. */
function splitPath(path: string): { dir: string; base: string } {
    const slashed = path.replace(/\\/g, "/");
    const at = slashed.lastIndexOf("/");
    return at < 0 ? { dir: "", base: slashed } : { dir: slashed.slice(0, at + 1), base: slashed.slice(at + 1) };
}

/** A step's target in a tooltip: a path as its file's name, anything else (a pattern, a command) cut at 40 characters. */
function shortTarget(target: string): string {
    const t = target.trim();
    const isPath = /[\\/]/.test(t) && !/\s/.test(t);
    const text = isPath ? splitPath(t).base || t : t;
    return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function SeatAvatar({ c, id, name }: { c: Council; id: string; name: string }) {
    return (
        <span aria-hidden className="flex flex-none">
            <CouncilAvatar tone={avatarTone(c, id)} name={name} initials={seatInitials(c, id)} small />
        </span>
    );
}

// ── C: what each seat spent ─────────────────────────────────────────────────────────────────────────────────────────

/** The longest bar's share of its track, so the label at a bar's end always has the rest of the track to sit in. The
 *  scale stays one linear axis for every row. */
const BAR_SHARE = 58;

function rowLabel(r: SpendRow): string {
    const parts = [tokensLabel(r.tokens), plural(r.calls, "call")];
    if (r.calls > 0) {
        parts.push(`${tokensLabel(r.perCall)} a call`);
    }
    return parts.join(" · ");
}

// the line over the bars, and the folded section's row: the tokens, the calls and the time the seats worked
function spendHeadline(data: SpendData): string {
    return [
        `${tokensLabel(data.total)} tokens in ${plural(data.calls, "call")}`,
        data.ms > 0 ? `${duration(data.ms)} of reading and writing` : "",
    ]
        .filter((p) => p !== "")
        .join(" · ");
}

function SpendBars({ c, data, onSeat }: { c: Council; data: SpendData; onSeat: (id: string) => void }) {
    const tip = useChartTip();
    const max = Math.max(1, ...data.rows.map((r) => r.tokens));
    const headline = spendHeadline(data);
    return (
        <div className="flex flex-col gap-2">
            <p className="m-0 text-[12px] tabular-nums text-muted">{headline}</p>
            <ul className="m-0 flex list-none flex-col p-0">
                {data.rows.map((r) => {
                    const outside = r.id == null;
                    const body = (
                        <>
                            {/* the hover highlight: its opacity eases over the fast duration, and not at all under
                                reduced motion; the memory-check row is no seat, so it never lifts */}
                            <span
                                aria-hidden
                                style={hoverFadeStyle}
                                className={cn(
                                    "pointer-events-none absolute inset-0 rounded-md bg-surface-hover opacity-0",
                                    HOVER_FADE,
                                    !outside && "group-hover:opacity-100 group-focus-visible:opacity-100"
                                )}
                            />
                            <span className="relative flex w-[38%] min-w-[150px] max-w-[260px] flex-none items-center gap-2">
                                {r.id != null ? (
                                    <SeatAvatar c={c} id={r.id} name={r.name} />
                                ) : (
                                    <span aria-hidden className="flex flex-none">
                                        <CouncilAvatar tone="muted" name={r.name} initials="M" small dashed />
                                    </span>
                                )}
                                <span
                                    className={cn(
                                        "min-w-0 truncate text-[13px]",
                                        outside ? "text-muted" : "text-primary"
                                    )}
                                    title={r.name}
                                >
                                    {r.name}
                                </span>
                                {r.model !== "" && (
                                    <span className="min-w-0 flex-none truncate text-[12px] text-muted">{r.model}</span>
                                )}
                            </span>
                            <span className="relative flex min-w-0 flex-1 items-center gap-2 border-l-2 border-edge-mid">
                                <span
                                    aria-hidden
                                    data-spend-bar=""
                                    className={cn(
                                        "block h-[14px] flex-none rounded-r-[4px]",
                                        outside ? "bg-accent/30" : "bg-accent/60",
                                        WIDTH_EASE
                                    )}
                                    style={{
                                        ...widthEaseStyle,
                                        width: `${(r.tokens / max) * BAR_SHARE}%`,
                                        minWidth: r.tokens > 0 ? 2 : 0,
                                    }}
                                />
                                <span
                                    className={cn(
                                        "min-w-0 truncate text-[12px] tabular-nums",
                                        outside ? "text-muted" : "text-secondary"
                                    )}
                                >
                                    {rowLabel(r)}
                                </span>
                            </span>
                        </>
                    );
                    const rowClass = "group relative flex h-[32px] w-full items-center gap-3 rounded-md px-2 text-left";
                    if (r.id == null) {
                        return (
                            <li key="memory" className="m-0 p-0">
                                <div data-spend-memory="" className={rowClass}>
                                    {body}
                                </div>
                            </li>
                        );
                    }
                    const id = r.id;
                    return (
                        <li key={id} className="m-0 p-0">
                            <button
                                type="button"
                                data-spend-seat={id}
                                aria-label={`${r.name}: ${rowLabel(r)}. Show only their messages in the Discussion`}
                                onClick={() => onSeat(id)}
                                className={cn(rowClass, "cursor-pointer border-0 bg-transparent", FOCUS)}
                                {...tip.bind(
                                    <TipBody
                                        title={r.name}
                                        lines={[
                                            r.ms > 0 ? `Time spent: ${duration(r.ms)}` : null,
                                            plural(r.calls, "call"),
                                            r.calls > 0 ? `${tokensLabel(r.perCall)} tokens a call` : null,
                                        ].filter((l): l is string => l != null)}
                                    />
                                )}
                            >
                                {body}
                            </button>
                        </li>
                    );
                })}
            </ul>
            {tip.node}
        </div>
    );
}

function SpendFigure({ c, data, onSeat }: { c: Council; data: SpendData; onSeat: (id: string) => void }) {
    const table = (
        <ChartTable
            columns={["Seat", "Model", "Tokens", "Calls", "Tokens per call", "Time"]}
            numeric={[2, 3, 4, 5]}
            rows={[
                ...data.rows.map((r) => [
                    r.name,
                    r.model === "" ? "–" : r.model,
                    exact(r.tokens),
                    r.calls,
                    r.calls > 0 ? exact(r.perCall) : "–",
                    r.ms > 0 ? duration(r.ms) : "–",
                ]),
                [
                    "Total",
                    "",
                    exact(data.total),
                    data.calls,
                    data.calls > 0 ? exact(data.total / data.calls) : "–",
                    data.ms > 0 ? duration(data.ms) : "–",
                ],
            ]}
        />
    );
    return (
        <ChartFigure id="spend" title="What each seat spent" takeaway={data.takeaway} table={table}>
            <SpendBars c={c} data={data} onSeat={onSeat} />
        </ChartFigure>
    );
}

// ── D: when each seat worked ────────────────────────────────────────────────────────────────────────────────────────

const LABEL_PX = 150; // the seat column, left of every lane
const LANE_PX = 32; // one lane's height, which also holds a name over a "last N steps kept" note
const HEAD_PX = 14; // the round labels' row
const AXIS_PX = 26; // the time axis's row
const PAD_X = 16; // room either side of the axis, so a mark at the first or last step is not cut
const BAR_H = 12;
const HIT_MIN_PX = 14; // a stretch's hit target, never narrower: a 5 s stretch is a few pixels wide
const PLOT_MIN = 240;
const PLOT_UNMEASURED = 560;

/** The ink of a step mark: a neutral, never a series colour; the shape says which step it is. */
const MARK_INK = "fill-secondary stroke-secondary";
const MARK_HOLLOW = "fill-transparent stroke-secondary";

/** One step's mark, centred on (x, y): a read is a tick, a search a dot, a command a square, a post a flag. A step
 *  `shared` (a read of a file another seat also read) is hollow. */
function StepMark({ shape, shared, x, y }: { shape: LaneStep["shape"]; shared: boolean; x: number; y: number }) {
    const cls = shared ? MARK_HOLLOW : MARK_INK;
    const stroke = shared ? 1.5 : 0;
    switch (shape) {
        case "tick":
            return <rect x={x - 2.5} y={y - 5} width={5} height={10} rx={1} strokeWidth={stroke} className={cls} />;
        case "dot":
            return <circle cx={x} cy={y} r={3.5} strokeWidth={stroke} className={cls} />;
        case "square":
            return <rect x={x - 4} y={y - 4} width={8} height={8} rx={1} strokeWidth={stroke} className={cls} />;
        case "flag":
            return (
                <path
                    d={`M${x} ${y + 6}L${x} ${y - 6}L${x + 7} ${y - 3}L${x} ${y}`}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    className={shared ? MARK_HOLLOW : MARK_INK}
                />
            );
    }
}

const LEGEND: { shape: LaneStep["shape"]; shared: boolean; text: string }[] = [
    { shape: "tick", shared: false, text: "read" },
    { shape: "tick", shared: true, text: "read by another seat too" },
    { shape: "dot", shared: false, text: "search" },
    { shape: "square", shared: false, text: "command" },
    { shape: "flag", shared: false, text: "posted an idea or reply" },
];

function Legend({ idle }: { idle: string }) {
    return (
        <div className="flex flex-col gap-1">
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[11px] text-muted">
                {LEGEND.map((item) => (
                    <li key={item.text} className="m-0 flex items-center gap-[6px] p-0">
                        <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden className="flex-none">
                            <StepMark shape={item.shape} shared={item.shared} x={5} y={7} />
                        </svg>
                        {item.text}
                    </li>
                ))}
            </ul>
            {idle !== "" && <p className="m-0 text-[11px] text-muted">{idle}</p>}
        </div>
    );
}

function spanTip(c: Council, lane: Lane, span: LaneSpan) {
    const lines = [`${clockOf(span.start)} – ${clockOf(span.end)}`, plural(span.steps, "step")];
    if (span.top.length > 0) {
        lines.push(`Most read: ${span.top.map(shortTarget).join(", ")}`);
    }
    return { title: shortName(c, lane.seat.id), lines };
}

function LanePlot({ c, data, onSeat }: { c: Council; data: LanesData; onSeat: (id: string) => void }) {
    const tip = useChartTip();
    const hostRef = useRef<HTMLDivElement>(null);
    const [measured, setMeasured] = useState(0);
    useLayoutEffect(() => {
        if (hostRef.current) {
            setMeasured(hostRef.current.clientWidth);
        }
    }, []);
    useResizeObserver(hostRef, (e) => setMeasured(e.contentRect.width));
    const width = measured > 0 ? Math.max(PLOT_MIN, Math.floor(measured)) : PLOT_UNMEASURED;

    const { lanes, rounds, t0, t1 } = data;
    const xOf = linearScale([t0, t1], [PAD_X, width - PAD_X]);
    // the axis is in minutes from the first step; a council of under two minutes reads in seconds
    const spanMs = Math.max(0, t1 - t0);
    const unitMs = spanMs >= 120_000 ? 60_000 : 1_000;
    const unitWord = unitMs === 60_000 ? "min" : "s";
    const ticks = linearTicks(0, spanMs / unitMs, 6);

    const idleSeats = c.experts.filter((e) => !lanes.some((l) => l.seat.id === e.id));
    const idle =
        idleSeats.length > 0
            ? `${idleSeats.map((e) => shortName(c, e.id)).join(" and ")} took no steps, so ${idleSeats.length === 1 ? "has" : "have"} no lane.`
            : "";

    const onKey = (id: string) => (e: KeyboardEvent<SVGElement>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSeat(id);
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <div data-lane-plot="" className="flex flex-col">
                {rounds.length > 0 && (
                    <div className="flex">
                        <span aria-hidden className="flex-none" style={{ width: LABEL_PX }} />
                        <svg aria-hidden width={width} height={HEAD_PX} className="block flex-none overflow-visible">
                            {rounds.map((r) => (
                                <text
                                    key={r.round}
                                    data-round-mark={r.round}
                                    x={xOf(r.ts) + 3}
                                    y={HEAD_PX - 3}
                                    fontSize={10}
                                    className="fill-muted"
                                >
                                    {`R${r.round}`}
                                </text>
                            ))}
                        </svg>
                    </div>
                )}
                {lanes.map((lane) => {
                    const id = lane.seat.id;
                    const name = shortName(c, id);
                    const cy = LANE_PX / 2;
                    return (
                        // a click anywhere on the lane opens the seat's messages; the name is its button, so Enter and
                        // Space on it do the same, and each stretch answers them too
                        <div
                            key={id}
                            data-lane-seat={id}
                            onClick={() => onSeat(id)}
                            className="group relative flex cursor-pointer items-center border-t border-edge-mid first:border-t-0"
                        >
                            <span
                                aria-hidden
                                style={hoverFadeStyle}
                                className={cn(
                                    "pointer-events-none absolute inset-0 bg-surface-hover opacity-0 group-hover:opacity-100",
                                    HOVER_FADE
                                )}
                            />
                            <button
                                type="button"
                                aria-label={`${name}: show only their messages in the Discussion`}
                                style={{ width: LABEL_PX, height: LANE_PX }}
                                className={cn(
                                    "relative flex flex-none cursor-pointer items-center gap-2 border-0 bg-transparent p-0 pr-2 text-left",
                                    FOCUS
                                )}
                            >
                                <SeatAvatar c={c} id={id} name={name} />
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-[12px] leading-[1.25] text-secondary group-hover:text-primary">
                                        {name}
                                    </span>
                                    {lane.capped && (
                                        <span
                                            data-lane-capped=""
                                            className="truncate text-[10px] leading-[1.25] text-muted"
                                            title={`A seat keeps at most ${MAX_TIMELINE_STEPS} steps and drops its oldest, so this lane starts after the seat's first steps`}
                                        >
                                            {`last ${lane.steps.length} steps kept`}
                                        </span>
                                    )}
                                </span>
                            </button>
                            <svg
                                role="group"
                                aria-label={`${name}'s stretches of work`}
                                width={width}
                                height={LANE_PX}
                                className="relative block flex-none overflow-visible"
                            >
                                <g className="pointer-events-none">
                                    {rounds.map((r) => (
                                        <line
                                            key={r.round}
                                            x1={xOf(r.ts) + 0.5}
                                            x2={xOf(r.ts) + 0.5}
                                            y1={0}
                                            y2={LANE_PX}
                                            strokeWidth={1}
                                            strokeDasharray="2 3"
                                            className="stroke-muted/40"
                                        />
                                    ))}
                                    {lane.spans.map((sp, i) => {
                                        const x0 = xOf(sp.start);
                                        return (
                                            <rect
                                                key={i}
                                                x={x0}
                                                y={cy - BAR_H / 2}
                                                width={Math.max(xOf(sp.end) - x0, 2)}
                                                height={BAR_H}
                                                rx={4}
                                                className="fill-accent/45"
                                            />
                                        );
                                    })}
                                    {lane.steps.map((s, i) => (
                                        <StepMark key={i} shape={s.shape} shared={s.shared} x={xOf(s.ts)} y={cy} />
                                    ))}
                                </g>
                                {lane.spans.map((sp, i) => {
                                    const x0 = xOf(sp.start);
                                    const w = Math.max(xOf(sp.end) - x0, 2);
                                    const hitW = Math.max(w, HIT_MIN_PX);
                                    const t = spanTip(c, lane, sp);
                                    return (
                                        <rect
                                            key={i}
                                            data-lane-span={i}
                                            tabIndex={0}
                                            role="button"
                                            aria-label={`${t.title}, ${t.lines.join(", ")}. Show only their messages in the Discussion`}
                                            x={x0 + w / 2 - hitW / 2}
                                            y={0}
                                            width={hitW}
                                            height={LANE_PX}
                                            strokeWidth={2}
                                            onKeyDown={onKey(id)}
                                            className="cursor-pointer fill-transparent outline-none focus-visible:stroke-accent"
                                            {...tip.bind(<TipBody title={t.title} lines={t.lines} />)}
                                        />
                                    );
                                })}
                            </svg>
                        </div>
                    );
                })}
                <div className="flex">
                    <span aria-hidden className="flex-none" style={{ width: LABEL_PX }} />
                    <div ref={hostRef} className="min-w-0 flex-1">
                        <svg aria-hidden width={width} height={AXIS_PX} className="block overflow-visible">
                            <LinearAxis
                                orient="x"
                                domain={[0, spanMs / unitMs]}
                                range={[PAD_X, width - PAD_X]}
                                at={2}
                                ticks={ticks}
                                format={(v) => `${v} ${unitWord}`}
                                lineClassName="stroke-edge-mid"
                            />
                        </svg>
                    </div>
                </div>
            </div>
            <Legend idle={idle} />
            <SharedReads c={c} data={data} />
            {tip.node}
        </div>
    );
}

function seatsOf(c: Council, ids: readonly string[]): string[] {
    return ids.map((id) => shortName(c, id));
}

function SharedReads({ c, data }: { c: Council; data: LanesData }) {
    const headingId = useId();
    const { shared, more, moreCount } = data;
    if (shared.length === 0) {
        return null;
    }
    return (
        <section aria-labelledby={headingId} data-council-shared-reads="" className="flex flex-col gap-1">
            <h4 id={headingId} className="m-0 text-[12px] font-semibold text-muted">
                Read by more than one seat
            </h4>
            <ul className="m-0 flex list-none flex-col p-0">
                {shared.map((s: SharedRead) => {
                    const { dir, base } = splitPath(s.path);
                    return (
                        <li
                            key={s.path}
                            data-shared-read={s.path}
                            className="m-0 flex items-center gap-3 border-t border-edge-mid p-0 py-[4px] text-[12px] first:border-t-0"
                        >
                            <span className="min-w-0 flex-1 truncate" title={s.path}>
                                <span className="text-muted">{dir}</span>
                                <span className="text-primary">{base}</span>
                            </span>
                            <span className="flex flex-none gap-[3px]" title={seatsOf(c, s.seats).join(", ")}>
                                {s.seats.map((id) => (
                                    <SeatAvatar key={id} c={c} id={id} name={shortName(c, id)} />
                                ))}
                                <span className="sr-only">{seatsOf(c, s.seats).join(", ")}</span>
                            </span>
                            <span className="w-[64px] flex-none text-right tabular-nums text-secondary">
                                {s.reads} reads
                            </span>
                        </li>
                    );
                })}
                {more != null && (
                    <li
                        data-shared-read-more=""
                        className="m-0 truncate border-t border-edge-mid p-0 py-[4px] text-[12px] text-muted"
                    >
                        {`and ${moreCount} more: ${more.path} (${seatsOf(c, more.seats).join(", ")}, ${more.reads} reads)`}
                    </li>
                )}
            </ul>
        </section>
    );
}

function LanesFigure({ c, data, onSeat }: { c: Council; data: LanesData; onSeat: (id: string) => void }) {
    const stretches = data.lanes.flatMap((lane) =>
        lane.spans.map((sp) => [
            shortName(c, lane.seat.id),
            clockOf(sp.start),
            clockOf(sp.end),
            sp.steps,
            sp.top.length > 0 ? sp.top.map(shortTarget).join(", ") : "–",
        ])
    );
    const sharedRows = [
        ...data.shared.map((s) => [s.path, seatsOf(c, s.seats).join(", "), s.reads]),
        ...(data.more != null
            ? [
                  [
                      `and ${data.moreCount} more: ${data.more.path}`,
                      seatsOf(c, data.more.seats).join(", "),
                      data.more.reads,
                  ],
              ]
            : []),
    ];
    const table = (
        <div className="flex flex-col gap-4">
            <ChartTable columns={["Seat", "From", "To", "Steps", "Most read"]} numeric={[3]} rows={stretches} />
            {sharedRows.length > 0 && (
                <div className="flex flex-col gap-1">
                    <div className="text-[12px] font-semibold text-muted">Read by more than one seat</div>
                    <ChartTable columns={["File", "Seats", "Reads"]} numeric={[2]} rows={sharedRows} />
                </div>
            )}
        </div>
    );
    return (
        <ChartFigure
            id="lanes"
            title="When each seat worked, and what it read twice"
            takeaway={data.takeaway}
            table={table}
        >
            <LanePlot c={c} data={data} onSeat={onSeat} />
        </ChartFigure>
    );
}

// ── the section ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The "What it spent" section's figures: what each seat spent (C), then when each seat worked and what it read twice
 *  (D). Each draws only when the model has something for it (C when a seat has tokens, D when a step has a time), and
 *  nothing draws when neither does. `onSeat(id)` is what a click or Enter on a seat's row or lane calls. */
export function SpendFigures({ c, onSeat }: { c: Council; onSeat: (id: string) => void }) {
    const spend = useMemo(() => seatSpend(c), [c]);
    const lanes = useMemo(() => seatLanes(c), [c]);
    if (spend == null && lanes == null) {
        return null;
    }
    return (
        <div data-council-spend-figures="" className="flex flex-col gap-7">
            {spend != null && <SpendFigure c={c} data={spend} onSeat={onSeat} />}
            {lanes != null && <LanesFigure c={c} data={lanes} onSeat={onSeat} />}
        </div>
    );
}

/** The folded "What it spent" row's line, from figure C's numbers: `1.9M tokens in 9 calls · 19 min 10 s of reading and
 *  writing`; "" when no seat has tokens (the lanes alone draw the section). */
export function spendLine(c: Council): string {
    const data = seatSpend(c);
    return data == null ? "" : spendHeadline(data);
}
