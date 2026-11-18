// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Q, Sidecar's compact window (spec 2026-11-17-sidecar-orbit-dashboard-design.md; board Q-compact-live): the same
// dashboard as P (sidecarorbit.tsx) at the small form's 340 x 440, pinned beside the person's work. The core a small
// three-ring dial of 128 px with its figures beside it, the strain as one line with the heaviest job's Stop and Sleep,
// the Needs you rows (which scroll inside their own list, never the page), and at the bottom one dot per agent in the
// orbit beside the run. No timeline. It draws the snapshot it is given and sends SidecarActs; it holds only the
// selection and the Stop question. Every decision it draws is the page model's (sidecarorbitmodel.ts). The page is
// storeless: only the types, the pure models, motion's tokens and React.
//
// It wears Sidecar's HUD skin (spec 2026-11-18-sidecar-hud-design.md; board Q-dang-nho): the `hud-*` tokens, the parts
// of sidecarhud.tsx (a tick ring round the dial, glowing value rings, brackets on the strain line, labels) and
// monospace figures, thinner than P's so the small form stays readable. The window's corner brackets board Q draws are
// left out: the alert frame (FRAME) does that job.

import { springReveal } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { GlowCircle, HudBrackets, HudDivider, HudLabel, HudTickRing } from "./sidecarhud";
import { ageText } from "./sidecarkeys";
import {
    coreLabel,
    coreTone,
    dashKey,
    frameOf,
    needHow,
    needPings,
    nodeLine,
    nodeTone,
    pings,
    ringDash,
    screenState,
    selectionAfter,
    waitingIds,
    type AlertFrame,
    type DashSel,
    type Tone,
} from "./sidecarorbitmodel";
import { formatBytes } from "./sidecarstrainmodel";
import type {
    SidecarAct,
    SidecarHeavy,
    SidecarNeed,
    SidecarRunBox,
    SidecarSnapshot,
    SidecarStrain,
} from "./sidecartypes";

export interface SidecarCompactProps {
    snap: SidecarSnapshot;
    // `receivedAt` and `clock` are both Date.now() on the Sidecar page, and only their difference is used (P's rule)
    receivedAt: number;
    clock: number;
    send: (act: SidecarAct) => void;
}

// Each tone's classes are written out whole: Tailwind finds a class by reading the source, not by building it. The status
// tones keep their tokens; the two quiet ones (finished, asleep) are the HUD's `hud-muted`, as board Q draws an idle dot.
const TEXT: Record<Tone, string> = {
    warning: "text-warning",
    error: "text-error",
    success: "text-success",
    secondary: "text-hud-muted",
    muted: "text-hud-muted",
};
const BG: Record<Tone, string> = {
    warning: "bg-warning",
    error: "bg-error",
    success: "bg-success",
    secondary: "bg-hud-muted",
    muted: "bg-hud-muted",
};
const BORDER: Record<Tone, string> = {
    warning: "border-warning",
    error: "border-error",
    success: "border-success",
    secondary: "border-hud-muted",
    muted: "border-hud-muted",
};

// The alert frame, an inset edge drawn over the whole window (an outer one would fall off the screen): 2 px at this size
// (P draws 4 px and 3 px). It is built from the tokens, so a theme that recolours `error` recolours it. It eases between
// states and under reduced motion changes at once.
const FRAME: Record<AlertFrame, string> = {
    none: "",
    warning: "shadow-[inset_0_0_0_2px_var(--color-warning)]",
    error: "shadow-[inset_0_0_0_2px_var(--color-error),inset_0_0_40px_color-mix(in_srgb,var(--color-error)_35%,transparent)]",
};

// a heavy agent's dot wears a ring in the strain's colour, set off from the dot by a gap of the HUD's own ground
const HALO = {
    amber: "shadow-[0_0_0_2px_var(--color-hud-bg),0_0_0_3.5px_var(--color-warning)]",
    red: "shadow-[0_0_0_2px_var(--color-hud-bg),0_0_0_3.5px_var(--color-error)]",
} as const;

// ---- The core ----

const CORE_PX = 128;
// a value ring's core is 2 px over a 8 px halo (GlowCircle), on a 1 px `hud-line` track; the rings are 8 px apart, so a
// halo touches the next one's but never covers it
const RING_GLOW = 2;
const RING_TRACK = 1;
// outside in: the 5-hour window, the week, RAM used (board Q-dang-nho)
const RING_5H = 52;
const RING_WEEK = 44;
const RING_RAM = 36;
// the tick ring just outside the 5-hour ring's halo: 60 ticks (every 6 degrees), every 5th a major one, 3 / 5 px long
const TICK_R = CORE_PX / 2 - 2;
const TICKS = 60;
const TICKS_MAJOR_EVERY = 5;
const TICK_MINOR_PX = 3;
const TICK_MAJOR_PX = 5;

function percent(pct: number | undefined): string {
    return pct == null || !Number.isFinite(pct) ? "–" : `${Math.round(pct)}%`;
}

function Ring(props: { r: number; pct: number | undefined; arc: string; eased?: boolean }) {
    const { dash, gap } = ringDash(props.pct, props.r);
    const c = CORE_PX / 2;
    return (
        <>
            <circle cx={c} cy={c} r={props.r} fill="none" strokeWidth={RING_TRACK} className="stroke-hud-line" />
            <GlowCircle
                cx={c}
                cy={c}
                r={props.r}
                width={RING_GLOW}
                // a round cap on an empty ring would still draw a dot
                strokeLinecap={dash > 0 ? "round" : "butt"}
                style={{ strokeDasharray: `${dash} ${gap}` }}
                transform={`rotate(-90 ${c} ${c})`}
                className={cn(
                    props.arc,
                    props.eased && "transition-[stroke,stroke-dasharray] duration-500 motion-reduce:transition-none"
                )}
            />
        </>
    );
}

// The dial's tick ring in its own svg under the value rings: it takes no snapshot field and has no props, so a snapshot
// never re-renders it and the browser never repaints it.
const DialTicks = memo(function DialTicks() {
    const c = CORE_PX / 2;
    return (
        <svg
            width={CORE_PX}
            height={CORE_PX}
            viewBox={`0 0 ${CORE_PX} ${CORE_PX}`}
            className="pointer-events-none absolute left-0 top-0"
            aria-hidden="true"
        >
            <HudTickRing
                cx={c}
                cy={c}
                r={TICK_R}
                count={TICKS}
                majorEvery={TICKS_MAJOR_EVERY}
                minorLen={TICK_MINOR_PX}
                majorLen={TICK_MAJOR_PX}
            />
        </svg>
    );
});

// RAM's ring is near-white until RAM itself is strained, then it takes the band's colour (a CPU strain leaves it alone)
function ramArc(strain: SidecarStrain | undefined): string {
    if (strain?.ram == null) {
        return "stroke-hud-text";
    }
    return strain.ram.critical ? "stroke-error" : "stroke-warning";
}

function Core({ snap, needs }: { snap: SidecarSnapshot; needs: readonly SidecarNeed[] }) {
    const tone = coreTone(snap);
    const failed = needs.filter((n) => n.failed === true).length;
    const m = snap.machine;
    const usedPct = m != null && m.memTotal > 0 ? (1 - m.memFree / m.memTotal) * 100 : undefined;
    const label = coreLabel(snap);
    const ramTone: Tone = label == null ? "muted" : snap.strain?.level === "red" ? "error" : "warning";
    // the label says what the colour says, so the strain is never colour alone
    const ramText = m == null ? "RAM –" : `${label ?? `RAM ${percent(usedPct)} used`} · ${formatBytes(m.memFree)} free`;
    return (
        <div className="flex shrink-0 items-center gap-3.5 px-3.5 pb-2 pt-3">
            {/* the dial: the static tick ring, the glowing value rings over it, and the figure at its centre */}
            <div data-hud-dial className="relative shrink-0" style={{ width: CORE_PX, height: CORE_PX }}>
                <DialTicks />
                <svg
                    width={CORE_PX}
                    height={CORE_PX}
                    viewBox={`0 0 ${CORE_PX} ${CORE_PX}`}
                    className="absolute left-0 top-0"
                    aria-hidden="true"
                >
                    <Ring r={RING_5H} pct={snap.usage?.fiveHourPct} arc="stroke-hud-glow" />
                    <Ring r={RING_WEEK} pct={snap.usage?.weekPct} arc="stroke-hud-muted" />
                    <Ring r={RING_RAM} pct={usedPct} arc={ramArc(snap.strain)} eased />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    <span
                        data-sidecar-core
                        data-core-tone={tone}
                        className={cn(
                            "font-mono text-[32px] font-medium leading-none tabular-nums transition-colors duration-500 motion-reduce:transition-none",
                            TEXT[tone]
                        )}
                    >
                        {needs.length}
                    </span>
                </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 font-mono text-[12px] uppercase tabular-nums">
                <span
                    data-sidecar-core-words
                    className={cn(
                        "truncate text-[12.5px] font-medium transition-colors duration-500 motion-reduce:transition-none",
                        TEXT[tone]
                    )}
                >
                    {failed > 0 ? `${needs.length} need you · ${failed} failed` : `${needs.length} need you`}
                </span>
                <span className="truncate text-hud-muted">
                    <b className="font-medium text-success">{snap.counts.working}</b> working
                </span>
                <span data-sidecar-usage className="truncate text-hud-muted">
                    5h {percent(snap.usage?.fiveHourPct)} · week {percent(snap.usage?.weekPct)}
                </span>
                {/* it wraps instead of truncating: the RAM figure is what the strain band is about */}
                <span
                    data-sidecar-ram
                    data-ram-tone={ramTone}
                    className={cn("break-words", TEXT[ramTone], label != null && "font-medium")}
                >
                    {ramText}
                </span>
            </div>
        </div>
    );
}

// ---- The strain, as one line ----

// a weight as the band words it: RAM in bytes, CPU in percent of the machine
function weightText(w: { ramBytes?: number; cpuPct?: number }): string {
    if (w.ramBytes != null) {
        return formatBytes(w.ramBytes);
    }
    return w.cpuPct != null ? `${Math.round(w.cpuPct)}%` : "";
}

function strainTitle(strain: SidecarStrain): string {
    return `${strain.by === "ram" ? "RAM" : "CPU"} ${strain.level === "red" ? "critical" : "high"}`;
}

const STRAIN_BUTTON =
    "flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-sm border border-hud-line bg-hud-panel px-[9px] text-[12.5px] text-hud-text hover:border-hud-glow active:scale-100";

function StrainLine({ strain, send }: { strain: SidecarStrain; send: (act: SidecarAct) => void }) {
    const red = strain.level === "red";
    const h: SidecarHeavy | undefined = strain.heavy[0];
    const proc = h?.process;
    // the Stop question is for one process: if the row's process changes while it is open, the question no longer fits
    // and the line goes back to its buttons, so a Stop never ends a process the person was not asked about
    const [confirm, setConfirm] = useState<number | null>(null);
    if (confirm != null && proc?.pid !== confirm) {
        setConfirm(null);
    }
    const asking = proc != null && confirm === proc.pid;
    // none of these may keep focus after a press: Enter and the arrows belong to the page
    const press = { type: "button" as const, tabIndex: -1, onMouseDown: (e: MouseEvent) => e.preventDefault() };
    return (
        <div
            data-sidecar-strainline
            data-level={strain.level}
            role="status"
            // the brackets, in the strain's tone, stand where the border was: the line is `relative` for them, and its
            // padding is wider than their 10 px so they never sit over the text
            className={cn(
                "relative mx-3 mb-2.5 flex shrink-0 flex-col gap-2 px-3 py-2.5",
                red ? "bg-errorbg" : "bg-askingbg"
            )}
        >
            <HudBrackets size={10} className={red ? "stroke-error" : "stroke-warning"} />
            <span
                className={cn(
                    "flex items-center gap-1.5 font-mono text-[11.5px] font-medium uppercase tracking-[0.08em]",
                    red ? "text-error" : "text-warning"
                )}
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    className="shrink-0"
                    aria-hidden="true"
                >
                    <path d="M12 3 2 21h20L12 3zM12 10v5M12 18h.01" />
                </svg>
                <span data-sidecar-strainline-title className="min-w-0 truncate">
                    {strainTitle(strain)}
                    <span className="font-normal text-hud-muted"> · the heaviest job</span>
                </span>
            </span>
            {h == null ? (
                <span data-sidecar-strainline-finding className="text-[12.5px] text-hud-muted">
                    Finding the heaviest agents…
                </span>
            ) : (
                <div data-sidecar-heavy={h.id} className="flex min-w-0 items-center gap-2">
                    {asking ? (
                        <div data-sidecar-confirm className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-hud-muted" title={proc.command}>
                                Stop <span className="font-mono text-hud-text">{proc.command}</span>?
                            </span>
                            <button
                                {...press}
                                data-sidecar-confirm-stop
                                onClick={() => {
                                    setConfirm(null);
                                    send({ kind: "stop", id: h.id, pid: proc.pid });
                                }}
                                className="flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-sm bg-hud-glow px-[9px] text-[12.5px] font-semibold text-hud-bg active:scale-100"
                            >
                                Stop
                            </button>
                            <button
                                {...press}
                                data-sidecar-confirm-cancel
                                onClick={() => setConfirm(null)}
                                className={STRAIN_BUTTON}
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <>
                            <span
                                className="flex min-w-0 flex-1 gap-1.5 text-[12.5px] text-hud-text"
                                title={proc != null ? `${h.name}: ${proc.command}` : h.name}
                            >
                                {proc != null ? (
                                    <span
                                        data-sidecar-heavy-process
                                        className="min-w-0 truncate font-mono text-[11.5px]"
                                    >
                                        {proc.command}
                                    </span>
                                ) : (
                                    <span className="min-w-0 truncate">{h.name}</span>
                                )}
                                {weightText(h) !== "" && (
                                    <span className="shrink-0 font-mono text-[11.5px] font-medium tabular-nums">{`· ${weightText(h)}`}</span>
                                )}
                            </span>
                            {proc != null && (
                                <button
                                    {...press}
                                    data-sidecar-heavy-stop
                                    onClick={() => setConfirm(proc.pid)}
                                    className={STRAIN_BUTTON}
                                >
                                    Stop
                                </button>
                            )}
                            <button
                                {...press}
                                data-sidecar-heavy-sleep
                                title={`Sleep ${h.name}`}
                                onClick={() => send({ kind: "sleep", id: h.id })}
                                className={STRAIN_BUTTON}
                            >
                                Sleep
                            </button>
                        </>
                    )}
                </div>
            )}
            {h?.note != null && (
                <span data-sidecar-heavy-note className="truncate text-[11.5px] text-hud-muted" title={h.note}>
                    {h.note}
                </span>
            )}
        </div>
    );
}

// ---- Needs you ----

function sameSel(a: DashSel | null, b: DashSel | null): boolean {
    return a?.area === b?.area && a?.index === b?.index && a?.key === b?.key;
}

// A row that waits on you pings until it is answered (a sent ask has been, and stops, as its dot does); a failed one pings.
function NeedRow(props: {
    need: SidecarNeed;
    age: string;
    selected: boolean;
    reduce: boolean;
    rowRef: (el: HTMLElement | null) => void;
    onSelect: () => void;
    onOpen: () => void;
}) {
    const { need, selected } = props;
    const failed = need.failed === true;
    const tone: Tone = failed ? "error" : "warning";
    const ping = needPings(need);
    return (
        // the reveal opens the row's height on a spring, so the gap below is this wrapper's padding, not the list's
        <motion.div
            variants={springReveal}
            initial={props.reduce ? false : "initial"}
            animate="animate"
            className="shrink-0 overflow-hidden pb-2"
        >
            <div
                ref={props.rowRef}
                role="option"
                aria-selected={selected}
                data-sidecar-need={need.key}
                data-need-kind={need.kind}
                data-need-failed={failed ? "true" : undefined}
                data-selected={selected ? "true" : undefined}
                onClick={props.onSelect}
                onDoubleClick={props.onOpen}
                className={cn(
                    // board Q: a 2 px bar in the row's tone down its left edge over the tint, no rounded corners
                    "flex select-none gap-2.5 border-l-2 px-3 py-2.5",
                    BORDER[tone],
                    // selection is a `hud-glow` inset ring, never the accent: an outer one is clipped by the list's overflow
                    selected ? "bg-hud-panel ring-2 ring-inset ring-hud-glow" : failed ? "bg-errorbg" : "bg-askingbg"
                )}
            >
                <span className="relative mt-[5px] h-2.5 w-2.5 shrink-0">
                    {ping && (
                        <span
                            aria-hidden="true"
                            className={cn(
                                "absolute inset-0 rounded-full border-[1.5px] animate-sidecar-ping",
                                BORDER[tone]
                            )}
                        />
                    )}
                    <span aria-hidden="true" className={cn("absolute inset-[1px] rounded-full", BG[tone])} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline gap-1.5">
                        {failed && (
                            <span className="shrink-0 font-mono text-[11px] font-medium text-error">Failed</span>
                        )}
                        <span
                            className="min-w-0 flex-1 truncate text-[13px] font-semibold text-hud-text"
                            title={need.who}
                        >
                            {need.who}
                        </span>
                        {!failed && need.kind === "jarvis" && need.word != null && (
                            <span className="shrink-0 font-mono text-[11px] text-hud-muted">{need.word}</span>
                        )}
                        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-hud-muted">
                            {props.age}
                        </span>
                    </div>
                    <span
                        className="line-clamp-2 break-words text-[14px] leading-[1.35] text-hud-text"
                        title={need.text}
                    >
                        {need.text}
                    </span>
                    <span className="font-mono text-[11px] text-hud-muted">{needHow(need)}</span>
                </div>
            </div>
        </motion.div>
    );
}

function AllClear() {
    return (
        <div
            data-sidecar-allclear
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-3 text-center"
        >
            <span className="text-[15px] font-semibold text-hud-text">All clear</span>
            <span className="text-[13px] text-hud-muted">Nothing waits on you.</span>
        </div>
    );
}

// ---- The agents, as dots ----

// `Run 7 of 9 · 1h 34m`; a failed run says so where its age would be (the age is left out when the run has no `since`)
function runLine(run: SidecarRunBox, age: string): string {
    const tail = run.failed ? "failed" : age;
    return `Run ${run.done} of ${run.total}${tail === "" ? "" : ` · ${tail}`}`;
}

function Dot(props: { id: string; tone: Tone; ping: boolean; tip: string; halo?: string }) {
    return (
        <span
            data-sidecar-dot={props.id}
            data-node-tone={props.tone}
            data-heavy={props.halo != null ? "true" : undefined}
            role="img"
            aria-label={props.tip}
            title={props.tip}
            className={cn("relative h-2.5 w-2.5 shrink-0 rounded-full", BG[props.tone], props.halo)}
        >
            {props.ping && (
                <span
                    aria-hidden="true"
                    className={cn(
                        "absolute inset-0 rounded-full border-[1.5px] animate-sidecar-ping",
                        BORDER[props.tone]
                    )}
                />
            )}
        </span>
    );
}

// ---- The window ----

export function SidecarCompact({ snap, receivedAt, clock, send }: SidecarCompactProps) {
    const reduce = useReducedMotion() === true;
    const needs = useMemo(() => snap.needs ?? [], [snap.needs]);
    const tiles = snap.tiles;
    const waiting = useMemo(() => waitingIds(needs), [needs]);
    const state = screenState(snap);
    const frame = frameOf(state);
    const sinceArrived = clock - receivedAt;

    // The selection stays on the same row when the list changes, and falls to the row now at its index when that one
    // leaves (selectionAfter). `picked` is what the person chose; `sel` is that after the lists moved, written back
    // so the next change follows the row it landed on.
    const [picked, setPicked] = useState<DashSel | null>(null);
    const sel = useMemo(() => selectionAfter(picked, needs, tiles), [picked, needs, tiles]);
    useEffect(() => {
        if (!sameSel(sel, picked)) {
            setPicked(sel);
        }
    }, [sel, picked]);

    // the key handler reads the latest of these without being re-registered on each snapshot
    const live = useRef({ sel, needs, tiles, send });
    live.current = { sel, needs, tiles, send };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }
            const { sel, needs, tiles, send } = live.current;
            const action = dashKey(e.key, "compact", sel, needs, tiles);
            if (action == null) {
                return;
            }
            e.preventDefault();
            if (action.kind === "select") {
                setPicked((prev) => (sameSel(prev, action.sel) ? prev : action.sel));
            } else if (!e.repeat) {
                // a held key sends once: a second Enter or answer would repeat what the first already did
                send(action);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // the arrows keep the selected row on screen when the rows scroll
    const rowEls = useRef(new Map<string, HTMLElement>());
    const selectedKey = sel?.area === "needs" ? sel.key : undefined;
    useEffect(() => {
        if (selectedKey != null) {
            rowEls.current.get(selectedKey)?.scrollIntoView({ block: "nearest" });
        }
    }, [selectedKey]);

    const { run, strain } = snap;
    const runAge = run == null ? "" : ageText(run.since, snap.now, sinceArrived);
    const heavyIds = new Set((strain?.heavy ?? []).map((h) => h.id));

    return (
        <div
            data-sidecar-dashboard="compact"
            data-sidecar-state={state}
            data-sidecar-frame={frame}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-hud-bg text-hud-text"
        >
            <Core snap={snap} needs={needs} />
            {strain != null && <StrainLine strain={strain} send={send} />}
            {needs.length === 0 && <AllClear />}
            {/* board Q's list heading: a label and a circuit-line rule. Static decoration beside the always-mounted list,
                shown only while it holds rows */}
            {needs.length > 0 && (
                <div className="flex shrink-0 items-center gap-2 px-3.5 pb-1.5">
                    <HudLabel>Needs you</HudLabel>
                    <HudDivider className="min-w-0 flex-1" />
                </div>
            )}
            {/* always mounted, hidden while empty: AnimatePresence's `initial={false}` spares only the rows it first
                mounts with, so a list that mounted with the first need would skip that row's reveal */}
            <div
                role="listbox"
                aria-label="Needs you"
                className={cn(
                    "min-h-0 flex-col overflow-y-auto overflow-x-hidden px-3",
                    needs.length === 0 ? "hidden" : "flex flex-1"
                )}
            >
                <AnimatePresence initial={false}>
                    {needs.map((need, index) => (
                        <NeedRow
                            key={need.key}
                            need={need}
                            age={ageText(need.since, snap.now, sinceArrived)}
                            selected={selectedKey === need.key}
                            reduce={reduce}
                            rowRef={(el) => {
                                if (el != null) {
                                    rowEls.current.set(need.key, el);
                                } else {
                                    rowEls.current.delete(need.key);
                                }
                            }}
                            onSelect={() => setPicked({ area: "needs", index, key: need.key })}
                            onOpen={() => {
                                const action = dashKey(
                                    "Enter",
                                    "compact",
                                    { area: "needs", index, key: need.key },
                                    needs,
                                    tiles
                                );
                                if (action != null && action.kind !== "select") {
                                    send(action);
                                }
                            }}
                        />
                    ))}
                </AnimatePresence>
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-hud-line px-3.5 py-2.5">
                {tiles.map((tile) => (
                    <Dot
                        key={tile.id}
                        id={tile.id}
                        tone={nodeTone(tile, waiting)}
                        ping={pings(tile, waiting)}
                        tip={`${tile.name}: ${nodeLine(tile, run, snap.now, sinceArrived)}`}
                        halo={strain != null && heavyIds.has(tile.id) ? HALO[strain.level] : undefined}
                    />
                ))}
                <span className="flex-1" />
                {run != null && (
                    <span
                        data-sidecar-run
                        data-run-failed={run.failed ? "true" : undefined}
                        className={cn(
                            "min-w-0 truncate whitespace-nowrap font-mono text-[11px] uppercase tabular-nums",
                            run.failed ? "text-error" : "text-hud-muted"
                        )}
                        title={run.title}
                    >
                        {runLine(run, runAge)}
                    </span>
                )}
            </div>
            {/* the frame is over the whole window, the title bar too, and takes no clicks */}
            <div
                aria-hidden="true"
                data-sidecar-frame-edge
                className={cn(
                    "pointer-events-none fixed inset-0 z-50 rounded-[var(--sidecar-corner,0px)] transition-[box-shadow] duration-500 motion-reduce:transition-none",
                    FRAME[frame]
                )}
            />
        </div>
    );
}
