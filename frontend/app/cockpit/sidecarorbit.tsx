// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// P, the Sidecar's full window (spec 2026-11-17-sidecar-orbit-dashboard-design.md; boards P-orbit-dashboard, P-calm,
// P-high, P-critical, P-failed, P-live): an orbit of agents around a core that counts what waits on you, the Needs you
// queue, the active run, and under them the machine's resources as Task Manager shows them (sidecarresourcespanel.tsx's
// band, where the last 2 hours' lanes were). It draws the snapshot it is given and sends SidecarActs; every decision (the
// screen's state, tones, lines, geometry, keys) is in sidecarorbitmodel.ts, so this file only draws.
// It holds the selection and whether the x hid the strain band. The orbit is drawn on a fixed 1160 x 620 stage scaled
// into its cell, so the board's sizes hold at any window size. The page is storeless: only the types, the pure models,
// the motion tokens and React.
//
// The HUD skin (spec 2026-11-18-sidecar-hud-design.md, board A-giu-bo-cuc): the orbit on the left at 3fr and the column
// of Needs you (with the strain band and the run box) on the right at 2fr, all on the `hud-*` tokens. The decoration
// (brackets, the tick ring, dividers) takes no snapshot field; the value rings glow as two stacked strokes
// (sidecarhud.tsx), never a filter.

import { springReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type RefObject,
} from "react";
import { SidecarBand } from "./sidecarband";
import { GlowCircle, HudBrackets, HudLabel, HudTickRing } from "./sidecarhud";
import { ageText } from "./sidecarkeys";
import { useSidecarMachine } from "./sidecarmachine";
import { NeedButtons, NeedHead } from "./sidecarneedbuttons";
import {
    coreLabel,
    coreTone,
    dashKey,
    frameOf,
    needPings,
    nodeLine,
    nodeTone,
    orbitPoints,
    pings,
    ringDash,
    screenState,
    selectionAfter,
    waitingIds,
    type AlertFrame,
    type DashSel,
    type Point,
    type Tone,
} from "./sidecarorbitmodel";
import { SidecarResourcesBand } from "./sidecarresourcespanel";
import { bandShows, formatBytes, nextHidden } from "./sidecarstrainmodel";
import type {
    SidecarAct,
    SidecarHeavy,
    SidecarMachine,
    SidecarNeed,
    SidecarRunBox,
    SidecarSnapshot,
    SidecarTile,
    StrainLevel,
} from "./sidecartypes";

export interface SidecarOrbitProps {
    snap: SidecarSnapshot;
    // `receivedAt` and `clock` are both Date.now() on the Sidecar page, and only their difference is used: an age is
    // `snap.now + (clock - receivedAt) - since`. `receivedAt` is when `snap` arrived; `clock` is bumped every 30 s.
    receivedAt: number;
    clock: number;
    send: (act: SidecarAct) => void;
}

// ---- Tokens: a tone is a class, spelled out so Tailwind's scanner sees every one ----
// The status tones keep the theme's colours; the two quiet ones (an idle or review agent, a finished or asleep one) are
// the HUD's muted ink, the second dimmer, so neither lands as a grey on the blue-black ground.

const TEXT: Record<Tone, string> = {
    warning: "text-warning",
    error: "text-error",
    success: "text-success",
    secondary: "text-hud-muted",
    muted: "text-hud-muted/70",
};
const BG: Record<Tone, string> = {
    warning: "bg-warning",
    error: "bg-error",
    success: "bg-success",
    secondary: "bg-hud-muted",
    muted: "bg-hud-muted/60",
};
const BORDER: Record<Tone, string> = {
    warning: "border-warning",
    error: "border-error",
    success: "border-success",
    secondary: "border-hud-muted",
    muted: "border-hud-muted/60",
};
const STROKE: Record<Tone, string> = {
    warning: "stroke-warning",
    error: "stroke-error",
    success: "stroke-success",
    secondary: "stroke-hud-muted",
    muted: "stroke-hud-muted/60",
};
// the same colours as custom properties, for a box-shadow, which has no utility that takes two rings
const VAR: Record<Tone, string> = {
    warning: "var(--color-warning)",
    error: "var(--color-error)",
    success: "var(--color-success)",
    secondary: "var(--color-hud-muted)",
    muted: "var(--color-hud-muted)",
};

// the alert frame as a box-shadow built from the tokens; every state has the same number of shadows where it can, so
// the change between them is a 500 ms ease, not a jump
const FRAME: Record<AlertFrame, string> = {
    none: "inset 0 0 0 0 transparent",
    warning: "inset 0 0 0 3px var(--color-warning)",
    error: "inset 0 0 0 4px var(--color-error), inset 0 0 120px color-mix(in srgb, var(--color-error) 22%, transparent)",
};

const NO_NEEDS: SidecarNeed[] = [];

// ---- The stage: the board's own pixels ----

const STAGE_W = 1160;
const STAGE_H = 620;
const CX = 580;
const CY = 320;
// the orbit is the board's circle (240) a little wider, so a right-hand label (280 px) still ends inside the stage
const ORBIT_RX = 250;
const ORBIT_RY = 240;
// a value ring is a 3 px core over a 12 px glow halo on a 1 px track; the rings are 16 px apart, so a halo never
// reaches the next ring
const RING_CORE = 3;
// outside in: the 5-hour window, the week, RAM used
const RING_R = [150, 134, 118] as const;
// the tick ring sits just outside the outer ring's halo (150 + 6): 120 ticks, every 10th a major one
const TICK_R = 166;
const SPOKE_FROM = TICK_R + 8; // a spoke starts clear of the tick ring
const NODE_R = 9;
const LABEL_W = 280;
// the space between the top node's box and the bottom edge of its label (a two-line label sat 5 px above the dot)
const LABEL_GAP_ABOVE = 5;

function sameSel(a: DashSel | null, b: DashSel | null): boolean {
    return a === b || (a != null && b != null && a.area === b.area && a.index === b.index && a.key === b.key);
}

function pctText(pct: number | undefined): string {
    return pct == null ? "–" : `${Math.round(pct)}%`;
}

// a heavy agent's weight and what Stop would end, as its node says it: `4.2 GB · npm run build`
function heavyText(h: SidecarHeavy): string {
    const weight = h.ramBytes != null ? formatBytes(h.ramBytes) : h.cpuPct != null ? `${Math.round(h.cpuPct)}%` : "";
    return [weight, h.process?.command ?? ""].filter((p) => p !== "").join(" · ");
}

/** The box the element fills, and the style that scales a STAGE_W x STAGE_H stage to sit centred in it. */
function useFit(): { ref: RefObject<HTMLDivElement | null>; stage: CSSProperties } {
    const ref = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState({ w: 0, h: 0 });
    // read before the first paint, so the stage is never drawn at a stale scale
    useLayoutEffect(() => {
        const el = ref.current;
        if (el == null) {
            return;
        }
        const measure = () =>
            setBox((prev) =>
                prev.w === el.clientWidth && prev.h === el.clientHeight
                    ? prev
                    : { w: el.clientWidth, h: el.clientHeight }
            );
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    const scale = Math.max(0, Math.min(box.w / STAGE_W, box.h / STAGE_H));
    return {
        ref,
        stage: {
            position: "absolute",
            left: 0,
            top: 0,
            width: STAGE_W,
            height: STAGE_H,
            transformOrigin: "0 0",
            transform: `translate(${(box.w - STAGE_W * scale) / 2}px, ${(box.h - STAGE_H * scale) / 2}px) scale(${scale})`,
            visibility: scale > 0 ? "visible" : "hidden",
        },
    };
}

// memoized on its props: a sidecar:machine moves the page's machine figures alone, and only the parts that read them
// (RamArc, RamKey, the band) redraw, not the nodes and the needs
export const SidecarOrbit = memo(function SidecarOrbit({ snap, receivedAt, clock, send }: SidecarOrbitProps) {
    const tiles = snap.tiles;
    const needs = snap.needs ?? NO_NEEDS;
    const sinceArrived = clock - receivedAt;
    const now = snap.now + Math.max(0, sinceArrived);
    const state = screenState(snap);
    const frame = frameOf(state);
    const waiting = useMemo(() => waitingIds(snap.needs), [snap.needs]);

    // the strain band: the x hides it until its level differs from the one it was hidden at; `nextHidden` forgets the
    // memory once the level changes or goes. The run box steps aside only while the band shows.
    const strain = snap.strain;
    const level = strain?.level ?? null;
    const [hidden, setHidden] = useState<StrainLevel | null>(null);
    const keptHidden = nextHidden(hidden, level);
    if (keptHidden !== hidden) {
        setHidden(keptHidden);
    }
    const showBand = strain != null && bandShows(level, keptHidden);

    // the selection is a need's key or a node's id, so it stays on its row when the list changes; a row that leaves
    // moves it to the one now at its index
    const [sel, setSel] = useState<DashSel | null>(null);
    const cur = selectionAfter(sel, needs, tiles);
    useEffect(() => {
        if (!sameSel(cur, sel)) {
            setSel(cur);
        }
    });
    const selectedAgent =
        cur == null ? null : cur.area === "orbit" ? (tiles[cur.index]?.id ?? null) : (needs[cur.index]?.id ?? null);

    // the key handler reads the latest of these without being re-registered on each snapshot
    const live = useRef({ needs, tiles, sel: cur, send });
    live.current = { needs, tiles, sel: cur, send };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }
            const { needs, tiles, sel, send } = live.current;
            const action = dashKey(e.key, "orbit", sel, needs, tiles);
            if (action == null) {
                return;
            }
            e.preventDefault();
            if (action.kind === "select") {
                setSel(action.sel);
                return;
            }
            // a held key sends once: a second Enter or answer would repeat what the first already did
            if (!e.repeat) {
                send(action);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const select = useCallback((area: DashSel["area"], index: number, key: string) => setSel({ area, index, key }), []);
    // a double click does what Enter does on that row or node
    const open = useCallback((area: DashSel["area"], index: number) => {
        const { needs, tiles, send } = live.current;
        const act = dashKey("Enter", "orbit", { area, index }, needs, tiles);
        if (act != null && act.kind !== "select") {
            send(act);
        }
    }, []);

    return (
        <div
            data-sidecar-dashboard="orbit"
            data-sidecar-state={state}
            data-sidecar-frame={frame}
            className="relative flex min-h-0 min-w-0 flex-1 select-none flex-col bg-hud-bg text-hud-text"
        >
            <div
                aria-hidden="true"
                className="pointer-events-none visible fixed inset-0 z-50 rounded-[var(--sidecar-corner,0px)] transition-[box-shadow] duration-500 motion-reduce:transition-none"
                style={{ boxShadow: FRAME[frame] }}
            />
            <div className="grid min-h-0 flex-[3_1_0%] grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <OrbitCell
                    snap={snap}
                    tiles={tiles}
                    waiting={waiting}
                    selectedAgent={selectedAgent}
                    sinceArrived={sinceArrived}
                    onSelect={(i) => select("orbit", i, tiles[i].id)}
                    onOpen={(i) => open("orbit", i)}
                />
                <div data-sidecar-needs-col className="flex min-h-0 min-w-0 flex-col gap-3.5 pb-4 pr-6 pt-5">
                    {showBand && (
                        // the band keeps its own side margins: this column has none, so they are taken back
                        <div className="-mx-5 -mt-3 flex shrink-0 flex-col">
                            <SidecarBand strain={strain} now={now} onHide={() => setHidden(level)} send={send} />
                        </div>
                    )}
                    <NeedsPanel
                        needs={needs}
                        sel={cur}
                        snapNow={snap.now}
                        sinceArrived={sinceArrived}
                        onSelect={(i) => select("needs", i, needs[i].key)}
                        onOpen={(i) => open("needs", i)}
                        send={send}
                    />
                    {snap.run != null && !showBand && (
                        <RunBox run={snap.run} snapNow={snap.now} sinceArrived={sinceArrived} />
                    )}
                </div>
            </div>
            <SidecarResourcesBand resources={snap.resources} onEnd={(name) => send({ kind: "endapp", name })} />
            <Footer />
        </div>
    );
});

// ---- The orbit ----

// The orbit's tick ring: static decoration in its own SVG layer under the changing one. It takes no props, so a snapshot
// never re-renders it and the browser never repaints it.
const OrbitTicks = memo(function OrbitTicks() {
    return (
        <svg width={STAGE_W} height={STAGE_H} className="absolute left-0 top-0" aria-hidden="true">
            <HudTickRing cx={CX} cy={CY} r={TICK_R} count={120} majorEvery={10} minorLen={4} majorLen={7} />
        </svg>
    );
});

function OrbitCell(props: {
    snap: SidecarSnapshot;
    tiles: SidecarTile[];
    waiting: ReadonlySet<string>;
    selectedAgent: string | null;
    sinceArrived: number;
    onSelect: (index: number) => void;
    onOpen: (index: number) => void;
}) {
    const { snap, tiles, waiting, selectedAgent } = props;
    const { ref, stage } = useFit();
    const points = useMemo(() => orbitPoints(tiles.length, CX, CY, ORBIT_RX, ORBIT_RY), [tiles.length]);
    const strain = snap.strain;
    // the band's colour: the RAM ring, the core's line and a heavy agent's ring take it
    const bandTone: "warning" | "error" | null = strain == null ? null : strain.level === "red" ? "error" : "warning";
    const ramTone: Tone | null = strain?.by === "ram" ? bandTone : null;
    const heavy = useMemo(() => new Map((strain?.heavy ?? []).map((h) => [h.id, h])), [strain]);

    // the plan rings; the RAM ring and its line read the page's machine figures themselves (RamArc, RamKey), so a
    // sidecar:machine redraws them and not every node
    const rings = [snap.usage?.fiveHourPct, snap.usage?.weekPct] as const;

    const tone = coreTone(snap);
    const needsCount = (snap.needs ?? NO_NEEDS).length;
    const failedRuns = (snap.needs ?? NO_NEEDS).filter((n) => n.failed === true).length;
    const ramLine = coreLabel(snap);
    const review = tiles.filter((t) => t.state === "review").length;

    return (
        <div ref={ref} data-sidecar-orbit-cell className="relative min-h-0 min-w-0 overflow-hidden">
            <div style={stage}>
                <OrbitTicks />
                <svg width={STAGE_W} height={STAGE_H} className="absolute left-0 top-0" aria-hidden="true">
                    {tiles.map((t, i) => {
                        const p = points[i];
                        const dx = p.x - CX;
                        const dy = p.y - CY;
                        const dist = Math.hypot(dx, dy) || 1;
                        const ux = dx / dist;
                        const uy = dy / dist;
                        const spokeTone = heavy.has(t.id) && bandTone != null ? bandTone : nodeTone(t, waiting);
                        const loud = pings(t, waiting) || heavy.has(t.id);
                        return (
                            <line
                                key={t.id}
                                x1={CX + ux * SPOKE_FROM}
                                y1={CY + uy * SPOKE_FROM}
                                x2={p.x - ux * (NODE_R + 5)}
                                y2={p.y - uy * (NODE_R + 5)}
                                strokeWidth={1.5}
                                strokeDasharray={loud ? "4 6" : undefined}
                                className={loud ? STROKE[spokeTone] : "stroke-hud-line"}
                            />
                        );
                    })}
                    <ellipse
                        cx={CX}
                        cy={CY}
                        rx={ORBIT_RX}
                        ry={ORBIT_RY}
                        fill="none"
                        strokeWidth={1}
                        className="stroke-hud-line"
                    />
                    {RING_R.map((r) => (
                        <circle
                            key={`t${r}`}
                            cx={CX}
                            cy={CY}
                            r={r}
                            fill="none"
                            strokeWidth={1}
                            className="stroke-hud-line"
                        />
                    ))}
                    <ValueArc r={RING_R[0]} pct={rings[0]} stroke="stroke-hud-glow" />
                    <ValueArc r={RING_R[1]} pct={rings[1]} stroke="stroke-hud-muted" />
                    <RamArc r={RING_R[2]} tone={ramTone} />
                </svg>

                <div
                    className="absolute flex flex-col items-center justify-center gap-0.5"
                    style={{ left: CX - 135, top: CY - 95, width: 270, height: 190 }}
                >
                    <span
                        data-sidecar-core={needsCount}
                        data-core-tone={tone}
                        className={cn(
                            "font-mono text-[92px] font-medium leading-none tabular-nums transition-colors duration-500 motion-reduce:transition-none",
                            TEXT[tone]
                        )}
                    >
                        {needsCount}
                    </span>
                    {/* the stage is scaled down to its cell, so the word is set larger than a HudLabel's 10.5 px */}
                    <HudLabel
                        className={cn(
                            "text-[16px] transition-colors duration-500 motion-reduce:transition-none",
                            tone === "error" ? "text-error" : tone === "warning" ? "text-warning-soft" : undefined
                        )}
                    >
                        need you
                    </HudLabel>
                    {ramLine != null && bandTone != null && (
                        <span
                            data-sidecar-core-alert
                            className={cn("mt-2 flex items-center gap-1.5 text-[14px] font-semibold", TEXT[bandTone])}
                        >
                            {ramLine}
                        </span>
                    )}
                    {failedRuns > 0 && (
                        <span
                            data-sidecar-core-failed
                            className={cn(
                                "flex items-center gap-1.5 text-[14px] font-semibold text-error",
                                ramLine == null && "mt-2"
                            )}
                        >
                            {failedRuns === 1 ? "1 run failed" : `${failedRuns} runs failed`}
                        </span>
                    )}
                </div>

                <div className="absolute left-7 top-6 flex flex-col gap-1.5 font-mono text-[13px] tabular-nums text-hud-muted">
                    <KeyLine swatch="bg-hud-glow" text={`5h window ${pctText(rings[0])}`} />
                    <KeyLine swatch="bg-hud-muted" text={`Week ${pctText(rings[1])}`} />
                    <RamKey tone={ramTone} />
                </div>
                <div className="absolute bottom-[22px] left-7 flex gap-[22px] font-mono text-[13px] tabular-nums text-hud-muted">
                    <span>
                        <b className="font-medium text-success">{snap.counts.working}</b> working
                    </span>
                    <span>
                        <b className="font-medium text-hud-text">{review}</b> for review
                    </span>
                    <span>
                        <b className="font-medium text-hud-text">{snap.counts.idle}</b> idle
                    </span>
                    {snap.more != null && snap.more > 0 && (
                        <span data-sidecar-more>
                            <b className="font-medium text-hud-text">+{snap.more}</b> more
                        </span>
                    )}
                </div>
                {tiles.length === 0 && (
                    <div
                        data-sidecar-empty
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[14px] text-hud-muted"
                    >
                        {snap.counts.idle > 0 ? `Nothing live · ${snap.counts.idle} idle` : "No agents running"}
                    </div>
                )}

                {tiles.map((t, i) => (
                    <Node
                        key={t.id}
                        tile={t}
                        point={points[i]}
                        tone={nodeTone(t, waiting)}
                        ping={pings(t, waiting)}
                        line={nodeLine(t, snap.run, snap.now, props.sinceArrived)}
                        heavy={heavy.get(t.id)}
                        heavyTone={bandTone}
                        selected={t.id === selectedAgent}
                        onSelect={() => props.onSelect(i)}
                        onOpen={() => props.onOpen(i)}
                    />
                ))}
            </div>
        </div>
    );
}

// one of the core's value rings, drawn from its percent
function ValueArc(props: { r: number; pct: number | undefined; stroke: string }) {
    const { r } = props;
    const { dash, gap } = ringDash(props.pct, r);
    return (
        <GlowCircle
            cx={CX}
            cy={CY}
            r={r}
            width={RING_CORE}
            // a zero-length round cap draws a dot, so an empty ring has butt caps
            strokeLinecap={dash > 0.5 ? "round" : "butt"}
            transform={`rotate(-90 ${CX} ${CY})`}
            style={{ strokeDasharray: `${dash} ${gap}` }}
            className={cn(
                "transition-[stroke-dasharray,stroke] duration-500 motion-reduce:transition-none",
                props.stroke
            )}
        />
    );
}

function ramUsedPct(machine: SidecarMachine | undefined): number | undefined {
    return machine != null && machine.memTotal > 0 ? (1 - machine.memFree / machine.memTotal) * 100 : undefined;
}

// the RAM ring, from the page's machine figures, in the band's tone while RAM is what strains
function RamArc(props: { r: number; tone: Tone | null }) {
    const machine = useSidecarMachine();
    return (
        <ValueArc
            r={props.r}
            pct={ramUsedPct(machine)}
            stroke={props.tone != null ? STROKE[props.tone] : "stroke-hud-text"}
        />
    );
}

// the key's RAM line: used, free and the CPU, from the page's machine figures
function RamKey(props: { tone: Tone | null }) {
    const machine = useSidecarMachine();
    const text =
        machine == null
            ? "RAM –"
            : [
                  `RAM ${pctText(ramUsedPct(machine))} used`,
                  `${formatBytes(machine.memFree)} free`,
                  machine.cpuPct != null ? `CPU ${Math.round(machine.cpuPct)}%` : "",
              ]
                  .filter((p) => p !== "")
                  .join(" · ");
    return (
        <KeyLine
            swatch={props.tone != null ? BG[props.tone] : "bg-hud-text"}
            text={text}
            textClass={props.tone != null ? TEXT[props.tone] : undefined}
        />
    );
}

function KeyLine(props: { swatch: string; text: string; textClass?: string }) {
    return (
        <span className={cn("flex items-center gap-2", props.textClass)}>
            <span className={cn("h-1 w-3.5 shrink-0 rounded-sm transition-colors duration-500", props.swatch)} />
            {props.text}
        </span>
    );
}

// A node is the 18 px dot at its place on the orbit; its label hangs off it (above the top one, below the bottom one,
// beside the rest, on the side away from the core). The ring behind the dot is the selection (cyan) or a heavy agent
// (the band's colour); a node that waits on you or failed also pings.
function Node(props: {
    tile: SidecarTile;
    point: Point;
    tone: Tone;
    ping: boolean;
    line: string;
    heavy: SidecarHeavy | undefined;
    heavyTone: "warning" | "error" | null;
    selected: boolean;
    onSelect: () => void;
    onOpen: () => void;
}) {
    const { tile, point, tone, selected } = props;
    const dx = point.x - CX;
    const vertical = Math.abs(dx) < 1;
    const left = dx < -1;
    const above = point.y < CY;
    const heavyLine = props.heavy != null ? heavyText(props.heavy) : "";
    // the dot's halo: the HUD ground's gap, then the heavy ring (the band's colour) and/or the selection's cyan one. Hard
    // rings (no blur), as before.
    const ringTone = props.heavy != null ? props.heavyTone : null;
    const rings = ["0 0 0 4px var(--color-hud-bg)"];
    if (ringTone != null) {
        rings.push(`0 0 0 6px ${VAR[ringTone]}`);
    }
    if (selected) {
        if (ringTone != null) {
            rings.push("0 0 0 8px var(--color-hud-bg)");
        }
        rings.push(`0 0 0 ${ringTone != null ? 10 : 6}px var(--color-hud-glow)`);
    }
    // relative to the dot's own box. Above the top node the label hangs by its bottom edge, a fixed gap over the dot, so a
    // third line (a heavy agent's) grows upward; a top offset sized for two lines put that line over the dot.
    const labelStyle: CSSProperties = {
        width: LABEL_W,
        left: vertical ? NODE_R - LABEL_W / 2 : left ? -LABEL_W - 15 : NODE_R * 2 + 15,
        ...(vertical && above ? { bottom: NODE_R * 2 + LABEL_GAP_ABOVE } : { top: vertical ? 25 : -11 }),
    };
    return (
        <div
            data-sidecar-node={tile.id}
            data-node-tone={tone}
            data-selected={selected ? "true" : undefined}
            onClick={props.onSelect}
            onDoubleClick={props.onOpen}
            className="absolute"
            style={{ left: point.x - NODE_R, top: point.y - NODE_R, width: NODE_R * 2, height: NODE_R * 2 }}
        >
            {props.ping && (
                <span
                    className={cn(
                        "absolute inset-0 rounded-full border-2 opacity-0 animate-sidecar-ping motion-reduce:hidden",
                        BORDER[tone]
                    )}
                />
            )}
            <span
                className={cn("absolute inset-0.5 rounded-full transition-colors duration-500", BG[tone])}
                style={{ boxShadow: rings.join(", ") }}
            />
            <div
                className={cn(
                    "absolute flex flex-col gap-0.5",
                    vertical ? "text-center" : left ? "text-right" : "text-left"
                )}
                style={labelStyle}
                title={`${tile.name} · ${props.line}`}
            >
                <span className="truncate text-[16px] font-semibold text-hud-text">{tile.name}</span>
                <span className={cn("truncate text-[13.5px]", TEXT[tone])}>{props.line}</span>
                {heavyLine !== "" && props.heavyTone != null && (
                    <span
                        data-sidecar-node-heavy
                        className={cn("truncate text-[13px] font-semibold", TEXT[props.heavyTone])}
                    >
                        {heavyLine}
                    </span>
                )}
            </div>
        </div>
    );
}

// ---- Needs you ----

function NeedsPanel(props: {
    needs: SidecarNeed[];
    sel: DashSel | null;
    snapNow: number;
    sinceArrived: number;
    onSelect: (index: number) => void;
    onOpen: (index: number) => void;
    send: (act: SidecarAct) => void;
}) {
    const { needs, sel } = props;
    const reduce = useReducedMotion();
    const listRef = useRef<HTMLDivElement>(null);
    // the arrows keep the selected row on screen when the list scrolls
    const selectedKey = sel?.area === "needs" ? sel.key : undefined;
    useEffect(() => {
        if (selectedKey != null) {
            listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
        }
    }, [selectedKey]);
    return (
        // the brackets stand on this outer box and the list scrolls inside it, so a scroll never carries them off the corners
        <div className="relative flex min-h-0 flex-1 flex-col rounded-lg bg-hud-panel">
            <HudBrackets size={18} radius={12} />
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 py-3.5">
                <div className="flex shrink-0 items-baseline gap-2.5">
                    <HudLabel className="text-[12px]">Needs you</HudLabel>
                    <span
                        className={cn(
                            "font-mono text-[13px] tabular-nums",
                            needs.length === 0 ? "text-hud-muted" : "text-warning"
                        )}
                    >
                        {String(needs.length).padStart(2, "0")}
                    </span>
                </div>
                {/* the list stays mounted when empty, so the first row after a calm screen arrives on the spring too */}
                <div
                    ref={listRef}
                    role="listbox"
                    aria-label="Needs you"
                    aria-hidden={needs.length === 0 ? true : undefined}
                    tabIndex={-1}
                    className={cn(
                        "flex min-h-0 flex-col overflow-y-auto overflow-x-hidden",
                        needs.length > 0 && "flex-1"
                    )}
                >
                    {/* a row arrives on the spring and leaves at once: no exit is set */}
                    <AnimatePresence initial={false}>
                        {needs.map((need, i) => (
                            <motion.div
                                key={need.key}
                                role="presentation"
                                variants={springReveal}
                                initial={reduce ? false : "initial"}
                                animate="animate"
                                className="shrink-0 overflow-hidden"
                            >
                                <NeedRow
                                    need={need}
                                    selected={sel?.area === "needs" && sel.index === i}
                                    age={ageText(need.since, props.snapNow, props.sinceArrived)}
                                    onSelect={() => props.onSelect(i)}
                                    onOpen={() => props.onOpen(i)}
                                    send={props.send}
                                />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
                {needs.length === 0 && (
                    <div
                        data-sidecar-allclear
                        className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center"
                    >
                        <span className="text-[18px] text-hud-text">All clear</span>
                        <span className="text-[14px] text-hud-muted">Nothing waits on you.</span>
                    </div>
                )}
            </div>
        </div>
    );
}

function NeedRow(props: {
    need: SidecarNeed;
    selected: boolean;
    age: string;
    onSelect: () => void;
    onOpen: () => void;
    send: (act: SidecarAct) => void;
}) {
    const { need, selected } = props;
    const failed = need.failed === true;
    // an answer that went out no longer waits: it stops pinging, as its node does
    const ping = needPings(need);
    return (
        <div
            role="option"
            aria-selected={selected}
            data-sidecar-need={need.key}
            data-need-kind={need.kind}
            data-need-failed={failed ? "true" : "false"}
            data-selected={selected ? "true" : undefined}
            onClick={props.onSelect}
            onDoubleClick={props.onOpen}
            // a failed row is a 1 px error border over its tint, a row still waiting on you a warning one over its tint, an
            // answered one the quiet line; the selection is the cyan ring on any of them
            className={cn(
                "mb-2 flex flex-col gap-[3px] rounded-md border px-3 py-[9px]",
                failed
                    ? "border-error bg-errorbg"
                    : ping
                      ? "border-warning bg-askingbg"
                      : "border-hud-line bg-hud-bg/40",
                selected && "ring-2 ring-inset ring-hud-glow"
            )}
        >
            <div className="flex items-baseline gap-2">
                <Marker tone={failed ? "error" : "warning"} ping={ping} />
                <div className="min-w-0 flex-1">
                    <NeedHead need={need} age={props.age} wall />
                </div>
            </div>
            <span className="line-clamp-2 break-words text-[15.5px] leading-[1.35] text-hud-text" title={need.text}>
                {need.text}
            </span>
            <NeedButtons need={need} send={props.send} wall />
        </div>
    );
}

// the status dot at a row's head: it pings while the row waits on you, and the ring is gone under reduced motion
function Marker(props: { tone: Tone; ping: boolean }) {
    return (
        <span aria-hidden="true" className="relative h-2 w-2 shrink-0 self-center">
            {props.ping && (
                <span
                    className={cn(
                        "absolute inset-0 rounded-full border-2 opacity-0 animate-sidecar-ping motion-reduce:hidden",
                        BORDER[props.tone]
                    )}
                />
            )}
            <span className={cn("absolute inset-0 rounded-full", BG[props.tone])} />
        </span>
    );
}

// ---- Run ----

function RunBox(props: { run: SidecarRunBox; snapNow: number; sinceArrived: number }) {
    const { run } = props;
    const age = ageText(run.since, props.snapNow, props.sinceArrived);
    const text = [`${run.done} of ${run.total} tasks`, run.due != null && run.due !== "" ? `due today: ${run.due}` : ""]
        .filter((p) => p !== "")
        .join(" · ");
    return (
        <div
            data-sidecar-run={run.id}
            data-run-failed={run.failed ? "true" : "false"}
            className="flex shrink-0 flex-col gap-2 rounded-lg border border-hud-line bg-hud-panel px-4 py-3.5"
        >
            <div className="flex items-baseline gap-2">
                <HudLabel className="shrink-0 text-[12px]">Run</HudLabel>
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-hud-text" title={run.title}>
                    {run.title}
                </span>
                {age !== "" && (
                    <span className="shrink-0 font-mono text-[12px] tabular-nums text-hud-muted">{age}</span>
                )}
            </div>
            {run.total > 0 && (
                <div className="flex gap-[3px]">
                    {Array.from({ length: run.total }, (_, i) => (
                        <span
                            key={i}
                            className={cn(
                                "h-1.5 flex-1 rounded-[1px]",
                                i < run.done
                                    ? "bg-success/45"
                                    : i === run.done
                                      ? run.failed
                                          ? "bg-error"
                                          : "bg-success"
                                      : "bg-hud-line"
                            )}
                        />
                    ))}
                </div>
            )}
            <span className="font-mono text-[12.5px] tabular-nums text-hud-muted">
                {run.failed && <span className="mr-1.5 font-semibold text-error">Failed</span>}
                {text}
            </span>
        </div>
    );
}

// ---- Footer ----

function Footer() {
    return (
        <div
            data-sidecar-footer
            className="flex h-7 shrink-0 items-center gap-[18px] border-t border-hud-line bg-hud-bg px-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-hud-muted"
        >
            <Hint keys="←↑↓→" label="move" />
            <Hint keys="Enter" label="open in the main window" />
            <Hint keys="1–9" label="answer" />
            <Hint keys="F11" label="full screen" />
        </div>
    );
}

function Hint({ keys, label }: { keys: string; label: string }) {
    return (
        <span>
            <kbd className="font-mono text-[11px] text-hud-glow">{keys}</kbd> {label}
        </span>
    );
}
