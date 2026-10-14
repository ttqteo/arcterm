// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run office (run office spec): a run's floor drawn under its Brief row. Thin by design: who sits where in what
// pose is officemodel.ts, the pixels are officesprite.ts and officesprites.ts. This file owns the toggle, the one
// frame clock and the DOM.
//
// Cost is the point of most choices here (the spec's Benchmark): a person is one <img> from a cache, furniture is a
// few bordered boxes, only animated desks subscribe to the clock, and the clock stops while the window is hidden,
// under reduced motion, and whenever the office is off.

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { runStage } from "@/app/view/agents/runstage";
import { cn } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { memo, useEffect, useMemo, type CSSProperties } from "react";
import { officeFloor, type Desk, type DeskScreen, type DeskTone, type Floor } from "./officemodel";
import { POSES, SPRITE_W, spriteFor, type SpritePose } from "./officesprite";
import { spriteUrl, type Outfit } from "./officesprites";
import { openTarget } from "./openref";

// Off by default: the Brief stays a list until the person asks for the office (compact by default)
export const officeOnAtom = atomWithStorage<boolean>("jarvis.office.on", false);
export const officeFrameAtom = atom<0 | 1>(0);
// DEV-only: floors the CDP scenarios draw in place of live runs (officedevhooks.ts); always null in a real session
export const officeFixtureAtom = atom<{ title: string; floor: Floor }[] | null>(null) as PrimitiveAtom<
    { title: string; floor: Floor }[] | null
>;

const FRAME_MS = 450;
const SCALE = 3;
const FLOOR_Y = 88;
let clockRunning = false;

/** Whether the frame clock is ticking, for the bench. */
export function officeClockRunning(): boolean {
    return clockRunning;
}

/** The one frame clock. Mounted only while the office is on. */
export function OfficeClock() {
    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
        let timer: number | undefined;
        const sync = () => {
            const run = !document.hidden && !reduce.matches;
            if (run && timer == null) {
                timer = window.setInterval(
                    () => globalStore.set(officeFrameAtom, globalStore.get(officeFrameAtom) ? 0 : 1),
                    FRAME_MS
                );
            } else if (!run && timer != null) {
                window.clearInterval(timer);
                timer = undefined;
                globalStore.set(officeFrameAtom, 0);
            }
            clockRunning = timer != null;
        };
        sync();
        document.addEventListener("visibilitychange", sync);
        reduce.addEventListener("change", sync);
        return () => {
            document.removeEventListener("visibilitychange", sync);
            reduce.removeEventListener("change", sync);
            if (timer != null) {
                window.clearInterval(timer);
            }
            clockRunning = false;
            globalStore.set(officeFrameAtom, 0);
        };
    }, []);
    return null;
}

/** The Runs region's toggle, beside the run-kind chips and drawn like them. */
export function OfficeToggle() {
    const on = useAtomValue(officeOnAtom);
    return (
        <button
            type="button"
            data-jarvis-office-toggle
            aria-pressed={on}
            title={on ? "Back to the run list" : "Draw the runs as an office"}
            onClick={() => globalStore.set(officeOnAtom, !on)}
            className={cn(
                "flex-none cursor-pointer rounded-[5px] border px-1.5 py-px text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                on ? "border-edge-strong text-ink-hi" : "border-transparent text-muted hover:text-ink-hi"
            )}
        >
            office
        </button>
    );
}

const TONE_TEXT: Record<DeskTone, string> = {
    muted: "text-muted",
    working: "text-working",
    asking: "text-asking",
    error: "text-error",
    done: "text-success",
};
const TONE_BG: Record<DeskTone, string> = {
    muted: "bg-edge-strong",
    working: "bg-working",
    asking: "bg-asking",
    error: "bg-error",
    done: "bg-success",
};
const TONE_BORDER: Record<DeskTone, string> = {
    muted: "border-muted",
    working: "border-working",
    asking: "border-asking",
    error: "border-error",
    done: "border-success",
};
const GLYPH: Partial<Record<DeskScreen, string>> = {
    prompt: "▍",
    wait: "…",
    fail: "✗",
    conflict: "⇄",
    check: "✓",
};

function spriteBox(pose: SpritePose, left: number): CSSProperties {
    const h = POSES[pose].length * SCALE;
    return { left, top: FLOOR_Y - h, width: SPRITE_W * SCALE, height: h };
}

function Person({ pose, outfit, left }: { pose: SpritePose; outfit: Outfit; left: number }) {
    return (
        <img
            alt=""
            draggable={false}
            src={spriteUrl(pose, outfit)}
            className="pointer-events-none absolute [image-rendering:pixelated]"
            style={spriteBox(pose, left)}
        />
    );
}

function Screen({ screen, tone, frame, left }: { screen: DeskScreen; tone: DeskTone; frame: 0 | 1; left: number }) {
    const glyph = GLYPH[screen];
    const lines = screen === "lines" || screen === "diff" ? (frame ? [22, 14, 18] : [16, 22, 10]) : null;
    return (
        <>
            <span
                className={cn(
                    "absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden border-2 border-edge-strong px-[3px] py-0.5",
                    screen === "off" || screen === "note" ? "bg-background" : "bg-surface-code"
                )}
                style={{ left, top: 36, width: 34, height: 24 }}
            >
                {screen === "note" ? <span className="absolute right-0.5 top-0.5 size-2 bg-warning-soft" /> : null}
                {glyph ? (
                    <span className={cn("font-mono text-xs font-bold leading-none", TONE_TEXT[tone])}>{glyph}</span>
                ) : null}
                {lines?.map((w, i) => (
                    <span
                        key={i}
                        className={cn("h-0.5 self-start", screen === "diff" ? "bg-muted" : TONE_BG[tone])}
                        style={{ width: screen === "diff" ? [20, 12, 20][i] : w }}
                    />
                ))}
                {screen === "bar" ? (
                    <span className="h-1 w-6 bg-edge-mid">
                        <span className={cn("block h-1", TONE_BG[tone])} style={{ width: frame ? 16 : 9 }} />
                    </span>
                ) : null}
            </span>
            <span className="absolute bg-edge-strong" style={{ left: left + 15, top: 60, width: 4, height: 4 }} />
        </>
    );
}

function DeskBody({
    desk,
    board,
    frame,
    onOpen,
}: {
    desk: Desk;
    board?: DeskTone[];
    frame: 0 | 1;
    onOpen: (d: Desk) => void;
}) {
    const lead = desk.key === "lead";
    const pose = spriteFor(desk.pose, frame);
    const standing = desk.pose === "stand" || desk.pose === "box";
    return (
        <button
            type="button"
            data-office-desk={desk.key}
            data-office-pose={desk.pose}
            data-office-state={desk.state}
            title={desk.tip}
            aria-label={desk.tip}
            onClick={() => onOpen(desk)}
            className={cn(
                "relative h-[116px] shrink-0 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                // the chair's back and seat (before) and the desk's top and legs (after) are pseudo-elements, which
                // are not DOM nodes: 104 desks have to fit the bench's 2,000-node budget
                "before:absolute before:left-[12px] before:top-[52px] before:h-[30px] before:w-[28px] before:border-b-[3px] before:border-l-4 before:border-edge-strong before:content-['']",
                "after:absolute after:left-[38px] after:top-[64px] after:h-[24px] after:border-x-[3px] after:border-t-4 after:border-edge-strong after:content-['']",
                lead ? "after:w-[96px]" : "after:w-[48px]",
                desk.dim && "opacity-55"
            )}
            style={{ width: lead ? 140 : 88 }}
        >
            {lead ? (
                <>
                    <span
                        className="absolute flex flex-wrap content-start gap-0.5 border-2 border-edge-strong bg-surface-code p-[3px]"
                        style={{ left: 80, top: 4, width: 50, height: 26 }}
                    >
                        {(board ?? []).map((t, i) => (
                            <span key={i} className={cn("size-1", TONE_BG[t])} />
                        ))}
                    </span>
                    <span
                        className="absolute bg-edge-strong opacity-80"
                        style={{ left: 137, top: 2, width: 3, height: 86 }}
                    />
                </>
            ) : null}
            {/* the chair's stem, under the before: seat */}
            <span className="absolute bg-edge-strong" style={{ left: 25, top: 82, width: 4, height: 6 }} />
            {desk.visitor ? <Person pose="clip" outfit={{ shirt: 0, look: 3, visitor: true }} left={-8} /> : null}
            {pose ? (
                <Person pose={pose} outfit={{ shirt: desk.shirt, look: desk.look }} left={standing ? 2 : 8} />
            ) : null}
            {/* the keyboard, on the after: desk */}
            <span className="absolute bg-ink-faint" style={{ left: 40, top: 61, width: 12, height: 3 }} />
            <Screen screen={desk.screen} tone={desk.tone} frame={frame} left={lead ? 56 : 52} />
            {lead ? <Screen screen={desk.screen} tone={desk.tone} frame={frame} left={94} /> : null}
            {desk.bubble ? (
                <span
                    className={cn(
                        "absolute flex h-4 min-w-4 items-center justify-center rounded-[3px] border bg-surface-raised px-[3px] text-[11px] font-bold leading-none",
                        TONE_TEXT[desk.tone],
                        TONE_BORDER[desk.tone]
                    )}
                    style={{ left: standing ? 12 : 20, top: 12 }}
                >
                    {desk.bubble}
                </span>
            ) : null}
            <span
                className={cn(
                    "absolute inset-x-0 truncate text-center text-[10px] leading-[14px]",
                    desk.label === "Needs you" ? "text-asking" : "text-muted"
                )}
                style={{ top: 94 }}
            >
                {desk.label}
            </span>
        </button>
    );
}

function AnimatedDesk(props: { desk: Desk; board?: DeskTone[]; onOpen: (d: Desk) => void }) {
    const frame = useAtomValue(officeFrameAtom);
    return <DeskBody {...props} frame={frame} />;
}

function DeskSlot(props: { desk: Desk; board?: DeskTone[]; onOpen: (d: Desk) => void }) {
    return props.desk.animated ? <AnimatedDesk {...props} /> : <DeskBody {...props} frame={0} />;
}

/** One floor: the wall, the floor band, the lead's office and a desk per task; scrolls sideways when wider. */
export const OfficeScene = memo(function OfficeScene({
    floor,
    selected,
    onOpen,
}: {
    floor: Floor;
    selected?: boolean;
    onOpen: (d: Desk) => void;
}) {
    return (
        <div
            data-office-floor={floor.runId}
            className={cn(
                "overflow-x-auto overflow-y-hidden rounded-md",
                selected ? "bg-surface-selected" : "bg-surface"
            )}
        >
            <div className="relative flex h-[116px] w-max min-w-full px-2">
                <span aria-hidden className="absolute inset-x-0 bottom-0 top-[88px] bg-surface-raised" />
                <span aria-hidden className="absolute inset-x-0 top-[88px] h-0.5 bg-edge-strong" />
                <DeskSlot desk={floor.lead} board={floor.board} onOpen={onOpen} />
                {floor.desks.map((d) => (
                    <DeskSlot key={d.key} desk={d} onOpen={onOpen} />
                ))}
            </div>
        </div>
    );
});

/** The floor of one live run, read from the store as the run list reads it. */
export function LiveOfficeFloor({
    model,
    runId,
    selected,
}: {
    model: AgentsViewModel;
    runId: string;
    selected?: boolean;
}) {
    const floorAtom = useMemo(
        () =>
            atom((get) => {
                const run = get(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", runId)));
                // dagoref holds the dag's bare id, whatever its name says
                const dag = run?.dagoref
                    ? get(WOS.getWaveObjectAtom<TaskGroup>(WOS.makeORef("dag", run.dagoref)))
                    : undefined;
                const stage = runStage({ status: run?.status, land: run?.land, dag }).key;
                return officeFloor({ runId, stage, tasks: dag?.tasks ?? [] }, get(model.agentsAtom));
            }),
        [model, runId]
    );
    const floor = useAtomValue(floorAtom);
    const onOpen = useMemo(
        () => (d: Desk) =>
            void openTarget(model, d.agentId ? { kind: "agent", tabId: d.agentId } : { kind: "run", runId }),
        [model, runId]
    );
    return <OfficeScene floor={floor} selected={selected} onOpen={onOpen} />;
}

/** DEV-only: the fixture floors, drawn after the live ones. Renders nothing in a real session. */
export function OfficeFixtureFloors() {
    const fixture = useAtomValue(officeFixtureAtom);
    if (fixture == null) {
        return null;
    }
    return (
        <div data-office-fixture className="flex flex-col gap-2">
            {fixture.map((f) => (
                <div key={f.floor.runId} className="flex flex-col gap-1">
                    <div className="px-1 text-[13px] font-medium text-secondary">{f.title}</div>
                    <OfficeScene floor={f.floor} onOpen={() => {}} />
                </div>
            ))}
        </div>
    );
}
