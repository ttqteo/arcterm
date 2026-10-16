// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office (docs/superpowers/specs/2026-10-15-cockpit-office-design.md): the Cockpit's cards drawn as a
// floor plan seen from above, the boss you walk around, and the card of the desk you stand at. Thin by design: the
// plan is officeplanmodel.ts, who goes where officebehavior.ts, how the boss moves officeboss.ts, the pixels
// plansprite.ts, the clocks officeclock.ts. This file owns the DOM, the walk state and the popup.
//
// Cost is the point of most choices (the spec's Benchmark): the static building is two canvases (scenery.ts), drawn at
// art resolution only when sceneryKey changes; a person is one <img> from a cache; a walk step renders nothing: it
// moves the boss's and the walkers' <img> on the DOM, and React draws them again only when they turn, set off, stop or
// flip their walking frame; only animated people read the frame clock; no clock runs while nothing moves.

import { MOTION } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import {
    officeClocks,
    officeMeterAtom,
    officeTickAtom,
    setOfficeRoot,
    useFrameClock,
    useWalkLoop,
} from "@/app/view/office/officeclock";
import { OFFICE_TOKENS, officeColors, type OfficePhase } from "@/app/view/office/officepalette";
import {
    BOSS_POSES,
    BOSS_SHIRT,
    LANE_SHIRTS,
    LEAD_SHIRT,
    markUrl,
    mirrorOf,
    PLAN_CELL,
    PLAN_SPRITES,
    PLAN_TOKENS,
    planSpriteUrl,
    seatSprite,
    SHEET_POSES,
    SHEET_SHIRTS,
    shirtOf,
    spriteLeft,
    spriteWidth,
    walkSprite,
    type PlanMark,
    type PlanOutfit,
    type PlanSprite,
    type SeatPose,
    type Shade,
} from "@/app/view/office/plansprite";
import { art, boardArt, rasterise, scenery, sceneryKey, type Op } from "@/app/view/office/scenery";
import { clearSprites, clearTokenColors, spriteCacheStats, tokenRgb } from "@/app/view/office/spritecache";
import { cn } from "@/util/util";
import { atom, useAtom, useAtomValue, type Atom, type PrimitiveAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { Maximize2, Minimize2, Moon, Sun, Zap } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
    Fragment,
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type MutableRefObject,
    type ReactNode,
    type PointerEvent as ReactPointerEvent,
    type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { AgentsViewModel } from "./agents";
import {
    admitWalkers,
    afterHours,
    awayTarget,
    CHEER_MS,
    energyOf,
    isReset,
    lookOf,
    sanitizeHours,
    STRETCH_MS,
    yawnsNow,
    type Away,
    type Energy,
} from "./officebehavior";
import { boardPage } from "./officeboardmodel";
import {
    advance,
    BOSS_SPEED,
    bossLook,
    canWalk,
    cardAt,
    carriedStop,
    deskAt,
    dotsAlong,
    facing,
    JUMP_SPEED,
    pathBetween,
    roomAt,
    spotOf,
    STEP_PX,
    stepToward,
    WALKER_SPEED,
    type BossLook,
    type Dir,
} from "./officeboss";
import {
    backFrom,
    boxLayer,
    canBuildFloor,
    carryPlace,
    carryTarget,
    DIALOG_FOOT_PX,
    dialogEdge,
    HUD_SPACE_PX,
    officeMenuItems,
    stepSel,
    type OfficeLayer,
    type OfficeMenuId,
    type OfficeMenuItem,
} from "./officecontrols";
import { OfficeDialogBox, OfficeHudBar, OfficeMenuBox, type OfficeDialogVM } from "./officedialog";
import {
    carryOver,
    carryWords,
    clampSel,
    enabledOf,
    liftAskLines,
    liftDialog,
    selAfterActivate,
    type DeskKind,
} from "./officedialogmodel";
import { floorLabel, moveToFloor, parseLayout, placeRooms, swapRooms } from "./officelayout";
import {
    BOARD_KEY,
    buildPlan,
    LIFT_KEY,
    peopleDrawn,
    popupBox,
    projectsOf,
    type Box,
    type Desk,
    type FloorSummary,
    type Lounger,
    type Plan,
    type PlanAgent,
    type PlanRun,
    type Point,
    type Room,
    type Seat,
    type Tone,
} from "./officeplanmodel";
import {
    officeAnimation,
    officeAnimationAtom,
    officeBigCardAtom,
    officeBoardPageAtom,
    officeBoardWhyAtom,
    officeCarryAtom,
    officeFloorAtom,
    officeHoursAtom,
    officeLayoutAtom,
    officeMenuOpenAtom,
    type Carry,
} from "./officestore";
import { themeOverridesAtom, themePresetAtom } from "./themestore";
import { usePlanDonuts } from "./usagemeters";

/** What the CDP scenarios set through cockpitofficedevhooks.ts; always null in a real session. */
export interface OfficeDev {
    runs?: PlanRun[]; // drawn after the live ones
    energy?: number; // the 5-hour window's use, in place of the meter's
    afterHours?: boolean; // in place of the clock and the work hours
    quiet?: boolean; // everyone idle in the Finished window and no run: nothing moves
    patrol?: boolean; // the boss walks desk to desk without end (the bench)
    walkers?: number; // this many people walk desk to coffee and back without end (the bench)
    sheet?: boolean; // every sprite on a sheet over the office (the States board)
    crowd?: number; // this many more idle agents past the Finished window, to crowd the lounge
    floor?: number; // the floor to show at once: cockpitofficedevhooks.ts writes it to officeFloorAtom, not to this atom
    rideHold?: boolean; // the next ride keeps its doors shut after the dial has ticked, until this is false (the Ride board)
}
export const officeDevAtom = atom<OfficeDev | null>(null) as PrimitiveAtom<OfficeDev | null>;

export interface OfficeHandle {
    walk(dir: Dir): void;
    release(dir: Dir): void;
    goTo(key: string): void;
    showPath(key: string): void;
    layer(): OfficeLayer;
    menuOpen(): boolean;
    /** ↵ at the desk the boss stands at: opens its dialog box; false when the boss stands at no desk. */
    talk(): boolean;
    /** f and the box's Full card: opens the desk's full card big, or grows or shrinks the open one; Adjust opens a
     *  run's card with its Adjust panel. False when the boss stands at no desk. */
    card(opts?: { adjust?: boolean }): boolean;
    /** ↑ ↓ in the dialog box or the office menu. */
    move(delta: -1 | 1): void;
    /** ↵ on the ▶ item of the office menu, or else of the dialog box. */
    activate(): void;
    /** Esc: one step back (the menu shuts; the card goes back to the box, the box to walking); false when nothing was up. */
    back(): boolean;
    toggleMenu(): void;
    /** The cursor's stops in office order: the desks and seats, then the notice board while Needs you rows wait. */
    order(): string[];
    /** The stops `n` visits: the asking desks, then the notice board while Needs you rows wait. */
    asks(): string[];
    /** ◀ ▶ over the notice board's box: the page `delta` rows on, clamped to the rows there are; the ▶ goes back to the
     *  page's first item and its Why shuts. */
    pageBoard(delta: -1 | 1): void;
    /** The office menu's Notice board, and a click on the board: the boss walks there and its box opens. */
    openBoard(): void;
    /** The office menu's Lift, and a click on the lift's doors: the boss walks there and the lift's panel opens. */
    openLift(): void;
    /** Rides the lift to floor `to`, one of `floors()`: the doors close over the office, the dial ticks, the doors open on
     *  the new floor with the boss by the lift. At once, with no doors, under reduced motion or with the animation off.
     *  A ride already under way, or the floor already shown, does nothing. */
    ride(to: number): void;
    /** The floor shown. */
    floor(): number;
    /** Every floor that holds a room, from G up, as the lift's panel lists them. */
    floors(): FloorSummary[];
    /** g and the office menu's Move this room: picks up the room the boss stands in. False when it stands in none (or
     *  not still, or a room is already carried). */
    grab(): boolean;
    /** ← ↑ ↓ → while a room is carried: its target moves to the neighbouring slot of the floor shown. */
    slot(dir: Dir): void;
    /** PageUp / PageDown while a room is carried: it rides to the next floor with it, and past the top its target is a
     *  new floor. */
    carryFloor(delta: -1 | 1): void;
    /** ↵ while a room is carried, and the pointer let go over its target: the room goes there, swapping with the room in
     *  the slot, and the boss goes with it. A pointer over no target puts it back. */
    drop(): void;
    /** Esc and g while a room is carried: it goes back where it was, riding back when the floor changed. */
    cancel(): void;
    /** A room's chip by its key: the room, and the cards its hidden ids name. */
    chipOf(key: string): { room: Room; agents: PlanAgent[]; runs: PlanRun[] } | undefined;
    /** ↵ on a row of a chip's dialog: that card opens beside the chip. */
    openChipCard(id: string): void;
}

export interface CockpitOfficeProps {
    agents: PlanAgent[];
    runs: PlanRun[];
    now: number;
    // only FiveHourLeaf reads it: the 5-hour meter ticks every second
    model: AgentsViewModel;
    cursorId?: string;
    onCursor: (key: string) => void;
    renderCard: (key: string, opts?: { adjust?: boolean }) => ReactNode;
    // the dialog box of a desk, built from the view models its card draws from (cockpitsurface.tsx)
    dialogFor: (key: string) => OfficeDialogVM | null;
    // the Cockpit's filters and switches, drawn in the HUD bar after the office's clock and energy
    hud: ReactNode;
    // the office menu's Events count and label, and what its items do
    newEvents: number;
    eventsOpen: boolean;
    onMenu: (id: OfficeMenuId) => void;
    // the Needs you rows that wait: the notice board's bubble and slips, its place among the cursor's stops, and the
    // office menu's count. The rows themselves are the dialog's (dialogFor)
    boardRows: number;
    handleRef: MutableRefObject<OfficeHandle | null>;
}

interface BossState {
    at: Point;
    path: Point[];
    dir: Dir;
    speed: number;
    holding?: Dir;
}
interface Walker {
    id: string;
    at: Point;
    path: Point[];
    dir: Dir;
    to?: Away;
    outfit: PlanOutfit;
    loop?: [Point, Point];
}

const bossAtom = atom<BossState | null>(null) as PrimitiveAtom<BossState | null>;
// walkers' positions, read only by WalkersView; who walks where to is walkingAtom, read by the office, which
// changes only when a walk starts or ends
const walkersAtom = atom<Walker[]>([]) as PrimitiveAtom<Walker[]>;
const walkingAtom = atom<Record<string, Away | null>>({}) as PrimitiveAtom<Record<string, Away | null>>;
// what React draws of the boss and the walkers: a walk step that only moves them changes neither, and each Mover
// places its <img> from the atoms above, on the DOM
const bossLookAtom = selectAtom<BossState | null, BossLook | null>(bossAtom, bossLook, sameValues);
const walkerLooksAtom = selectAtom<Walker[], Pick<Walker, "id" | "dir" | "outfit">[]>(
    walkersAtom,
    (ws) => ws.map((w) => ({ id: w.id, dir: w.dir, outfit: w.outfit })),
    sameValues
);
// the walking sprites' frame, flipped by the walk loop
const walkFrameAtom = atom<0 | 1>(0) as PrimitiveAtom<0 | 1>;
const dotsAtom = atom<Point[]>([]) as PrimitiveAtom<Point[]>;
// what is up over the office (officecontrols.ts): the desk's dialog box (↵, or a click on the desk), its full card (f,
// or the box's Full card), or nothing; any walk shuts both. The office menu (m, officeMenuOpenAtom in officestore.ts,
// which the footer's m chip reads) opens over any of them
const layerAtom = atom<OfficeLayer>("walk") as PrimitiveAtom<OfficeLayer>;
const selAtom = atom(0) as PrimitiveAtom<number>;
const menuSelAtom = atom(0) as PrimitiveAtom<number>;
// the full card the box's Adjust opened: a run's card with its Adjust panel open
const cardAdjustAtom = atom(false) as PrimitiveAtom<boolean>;
// a ride in progress (the lift's doors over the office): whether the doors are shut or shutting, the ms they take, and
// what the dial says (the floor, with the way it ticks); null while no ride
interface RideState {
    closed: boolean;
    ms: number;
    label: string;
    arrow: "" | "▲" | "▼";
}
const rideAtom = atom<RideState | null>(null) as PrimitiveAtom<RideState | null>;
// the card of a chip's hidden agent or run, open beside the chip (↵ on a row of the chip's dialog): its id, and which it is
const chipCardAtom = atom<{ id: string; kind: "agent" | "run" } | null>(null) as PrimitiveAtom<{
    id: string;
    kind: "agent" | "run";
} | null>;
// where the pointer is over the office, in plan px, while a room is dragged by its title: the carry's card follows it
const carryPointerAtom = atom<Point | null>(null) as PrimitiveAtom<Point | null>;
// whether the boss stood in a project room when the office menu opened: Move this room is disabled outside one
const menuInRoomAtom = atom(false) as PrimitiveAtom<boolean>;
// the 5-hour window's use, rounded; FiveHourLeaf sets it, so the 1 s clock the meter reads re-renders that leaf only
const officeFiveHourAtom = atom<number | undefined>(undefined) as PrimitiveAtom<number | undefined>;

const BOSS_OUTFIT: PlanOutfit = { shirt: BOSS_SHIRT, look: 1, boss: true };
const WALK_FRAME_MS = 180;
const ARROW_STEP_PX = 24; // one arrow press when people do not walk (reduced motion, animation off)
const PATH_HINT_MS = 1000;
const DRAG_PX = 4; // a room's title moves this far before a press on it becomes a drag, so a click still selects

// what the probe reads, kept up to date as the office draws
const probe = {
    desks: 0,
    seats: 0,
    dark: [] as string[],
    night: false,
    lamps: 0,
    cups: 0,
    walking: 0,
    loungeMore: 0,
    sceneryDraws: 0,
    phase: "day" as OfficePhase,
    popup: "" as "" | "agent" | "run",
    prompt: "" as "" | "agent" | "run" | "board",
    big: false,
    layer: "walk" as OfficeLayer,
    dialog: "" as "" | DeskKind,
    items: [] as string[],
    dims: [] as number[],
    sel: -1,
    edge: "" as "" | "top" | "bottom",
    menu: false,
    menuItems: [] as string[],
    menuSel: -1,
    boardRows: 0,
};
let lastPlan: Plan | null = null;
let lastWalking: ReadonlySet<string> = new Set();
let lastRoot: HTMLElement | null = null;

// a room's title label as the page drew it, in plan coordinates; the plan's guess at its place before it is drawn
function titleBoxOf(r: Room): Box {
    const el = lastRoot?.querySelector(`[data-office-room-title="${r.key}"]`);
    const root = lastRoot?.getBoundingClientRect();
    if (el && root) {
        const b = el.getBoundingClientRect();
        return {
            x: Math.round(b.left - root.left),
            y: Math.round(b.top - root.top),
            w: Math.round(b.width),
            h: Math.round(b.height),
        };
    }
    return { x: r.box.x + 14, y: r.box.y + 10, w: 0, h: 0 };
}

const carryProbe = (c: Carry | null) => (c ? { project: c.project, target: c.target, by: c.by } : null);

/** What the office drew, for the DEV probe (cockpitofficedevhooks.ts). */
export function readOfficeProbe() {
    const b = globalStore.get(bossAtom);
    return {
        ...probe,
        // the floor shown, the floors' labels from G up, and each room of this floor by slot (a project's or an empty one):
        // how many desks and tables it drew, whether it has a plant, its chip, its title label's box
        floor: lastPlan?.floor ?? 0,
        floors: lastPlan?.floors.map((f) => f.label) ?? [],
        rooms: lastPlan
            ? lastPlan.rooms
                  .filter((r) => r.kind === "agents" || r.kind === "empty")
                  .map((r) => ({
                      key: r.key,
                      kind: r.kind,
                      title: r.title,
                      slot: r.slot ?? -1,
                      box: r.box,
                      titleBox: titleBoxOf(r),
                      chip: r.chip ? { text: r.chip.text, ask: r.chip.ask, box: r.chip.box } : null,
                      desks: lastPlan!.desks.filter((d) => d.room === r.key).length,
                      tables: lastPlan!.rooms.filter((z) => z.parent === r.key).length,
                      plant: r.plant != null,
                  }))
            : [],
        // the lift: its doors and where the boss stands at them, the amber lines drawn beside it, and whether a ride is on
        lift: lastPlan ? { doors: lastPlan.lift.doors, spot: lastPlan.lift.spot } : null,
        liftAsks: lastPlan ? liftAskLines(lastPlan.floors, lastPlan.floor).map((l) => l.text) : [],
        riding: globalStore.get(rideAtom) != null,
        // the room carried: which, where a drop would put it (a slot of some floor, "new", or null while the pointer is over
        // none), and whether the keys or the pointer carry it; null while none is
        carry: carryProbe(globalStore.get(officeCarryAtom)),
        // counted when read: the boss draws a render after the plan does
        people: lastPlan ? peopleDrawn(lastPlan, lastWalking, b != null) : 0,
        boss:
            b && lastPlan
                ? {
                      x: Math.round(b.at.x),
                      y: Math.round(b.at.y),
                      room: roomAt(lastPlan, b.at),
                      moving: b.path.length > 1 || b.holding != null,
                  }
                : null,
        dots: globalStore.get(dotsAtom).length,
        // the notice board: the rows it drew (count, and the pages there are), the page in view counted from 1 (0 with
        // no rows), whether its Why is open, and where the boss stands at it. Page and Why are read when asked, like the
        // boss: they change without the office drawing
        board: {
            count: probe.boardRows,
            page: boardPage(globalStore.get(officeBoardPageAtom), probe.boardRows) + 1,
            of: probe.boardRows,
            why: globalStore.get(officeBoardWhyAtom),
            spot: lastPlan?.board.spot ?? null,
        },
        order: lastPlan?.order ?? [],
        hall: lastPlan?.hall ?? null,
        boxes: lastPlan
            ? Object.fromEntries(lastPlan.rooms.map((r) => [r.key, { ...r.box, door: r.door ?? null }]))
            : {},
        clock: officeClocks(),
        cache: spriteCacheStats("plan"),
        sheetSize: 4 * SHEET_POSES.length + BOSS_POSES.length,
        lounge: lastPlan?.lounge ?? null,
        unresolved: [...PLAN_TOKENS, ...OFFICE_TOKENS].filter((t) => tokenRgb(t) == null),
    };
}

// DEV (the lounge board): idle agents past the Finished window, the first six at the coffee machine's age and the rest
// from ten minutes on, the first with a name too long for its label
function crowdOf(n: number, now: number): PlanAgent[] {
    return Array.from({ length: n }, (_, i) => ({
        id: `fx-crowd-${String(i).padStart(2, "0")}`,
        name: i === 0 ? "crowd-member-with-a-long-name" : `crowd ${String(i).padStart(2, "0")}`,
        project: "crowd",
        state: "idle" as const,
        idleSince: now - (i < 6 ? 6 + i * 0.5 : 10 + (i - 6) * 2.5) * 60_000,
        finished: false,
    }));
}

const box = (b: Box): CSSProperties => ({ left: b.x, top: b.y, width: b.w, height: b.h });
const spriteH = (s: PlanSprite) => PLAN_SPRITES[s].length * PLAN_CELL;
const walkFrame = () => (Math.floor(performance.now() / WALK_FRAME_MS) % 2) as 0 | 1;
const sameSpot = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;

// the plan is rebuilt on every coarse tick and roster change, each time with new objects: a desk or a seat
// re-renders only when a value it draws has changed (its memo compares props with this)
function sameValues(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) {
        return true;
    }
    if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) {
        return false;
    }
    const ka = Object.keys(a);
    return (
        ka.length === Object.keys(b).length &&
        ka.every((k) => sameValues((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
}

function withAway(s: Record<string, Away>, id: string, to: Away | undefined): Record<string, Away> {
    const next = { ...s };
    if (to) {
        next[id] = to;
    } else {
        delete next[id];
    }
    return next;
}

const TONE: Record<Tone, string> = {
    plain: "text-muted",
    asking: "font-semibold text-asking",
    done: "font-semibold text-success",
    muted: "text-ink-faint",
};
// the theme the office's colours were last read in. Module level: tokenRgb's colours and the plan's sprites outlive
// the office, and a theme can change while it is away (Cards, another surface)
let drawnTheme: string | undefined;

// a theme re-skins the status tokens a run's screen, the laptops, the bubbles and the ring use
function useThemeEpoch(): string {
    const key = `${useAtomValue(themePresetAtom)}|${JSON.stringify(useAtomValue(themeOverridesAtom))}`;
    // mounting after the theme changed while the office was away: its vars are on <html> already, so the old colours
    // are forgotten before anything here draws (idempotent, so strict mode's second call is harmless)
    const [epoch, setEpoch] = useState(() => {
        if (drawnTheme !== key) {
            clearTokenColors();
            clearSprites("plan");
            drawnTheme = key;
        }
        return key;
    });
    // the theme changing while the office is open: the shell writes its vars in a layout effect that runs after this
    // office's own, so the colours are forgotten in a passive effect, after every layout effect, and the epoch it
    // returns redraws what used them
    useEffect(() => {
        if (epoch !== key) {
            clearTokenColors();
            clearSprites("plan");
            drawnTheme = key;
            setEpoch(key);
        }
    }, [key, epoch]);
    return epoch;
}

// scenes drawn since the page loaded, for the probe: one per sceneryKey, counted in CockpitOffice, not per canvas
let sceneryDraws = 0;

// the building at art resolution, scaled 3x: drawn only when its ops change, which happens only when sceneryKey does
// (the phase and the theme are in it). The first draw is in a passive effect, after the shell's layout effect has put
// the theme's vars on <html>; every later one in a layout effect, before paint: a new size clears the canvas at
// commit, and a passive redraw would show the office blank for a frame each time an agent comes or goes
const OfficeCanvas = memo(function OfficeCanvas(p: {
    which: "under" | "over";
    ops: Op[];
    width: number;
    height: number;
    phase: OfficePhase;
    z: number;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    const drawn = useRef(false);
    const draw = () => {
        const canvas = ref.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) {
            return;
        }
        const image = ctx.createImageData(p.width, p.height);
        image.data.set(rasterise(p.ops, p.width, p.height, officeColors(p.phase)));
        ctx.putImageData(image, 0, 0);
        drawn.current = true;
        // the bench's open time stops once every canvas has painted
        canvas.dataset.officeDrawn = "";
    };
    useLayoutEffect(() => {
        if (drawn.current) {
            draw();
        }
    }, [p.ops, p.width, p.height, p.phase]);
    useEffect(() => {
        if (!drawn.current) {
            draw();
        }
    }, [p.ops, p.width, p.height, p.phase]);
    return (
        <canvas
            ref={ref}
            data-office-canvas={p.which}
            width={p.width}
            height={p.height}
            className="pointer-events-none absolute left-0 top-0 [image-rendering:pixelated]"
            style={{ width: p.width * PLAN_CELL, height: p.height * PLAN_CELL, zIndex: p.z }}
        />
    );
});

export function CockpitOffice(props: CockpitOfficeProps) {
    const { cursorId, onCursor, renderCard, handleRef } = props;
    const dev = useAtomValue(officeDevAtom);
    const hours = sanitizeHours(useAtomValue(officeHoursAtom));
    const animationOn = officeAnimation(useAtomValue(officeAnimationAtom));
    const reduced = useReducedMotion() ?? false;
    // people walk only with the animation on and no reduced motion; otherwise they are at once where they go
    const moving = animationOn && !reduced;

    const now = props.now;
    const livePct = useAtomValue(officeFiveHourAtom);
    const pct = dev?.energy ?? livePct;
    const energy = energyOf(pct);
    const night = dev?.afterHours ?? afterHours(new Date(now), hours);
    const phase: OfficePhase = night ? "after" : "day";
    const tired = energy === "tired";
    const theme = useThemeEpoch();
    const agents = useMemo(() => {
        const base = dev?.quiet
            ? props.agents.map((a) => ({ ...a, state: "idle" as const, finished: true, idleSince: now - 60_000 }))
            : props.agents;
        return dev?.crowd ? [...base, ...crowdOf(dev.crowd, now)] : base;
    }, [props.agents, dev?.quiet, dev?.crowd, now]);
    const runs = useMemo(
        () => (dev?.quiet ? [] : [...props.runs, ...(dev?.runs ?? [])]),
        [props.runs, dev?.quiet, dev?.runs]
    );

    const scrollRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        // the content box: the scroller's 20 px gutters each side; the HUD bar's space above, its 12 px foot below,
        // so a short office still fills the view
        const measure = () => {
            setWidth(el.clientWidth - 40);
            setHeight(Math.floor(el.clientHeight - HUD_SPACE_PX - 12));
        };
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, []);

    // who is where: an idle agent past the Finished window goes to the lounge, walking there when people move
    const targets = useMemo(() => {
        const t: Record<string, Away> = {};
        for (const a of agents) {
            const at = awayTarget(a, now);
            if (at) {
                t[a.id] = at;
            }
        }
        return t;
    }, [agents, now]);
    const [settled, setSettled] = useState<Record<string, Away>>(targets);
    const walking = useAtomValue(walkingAtom);
    const walkingIds = useMemo(() => new Set(Object.keys(walking)), [walking]);
    // a walker is at neither end: the plan seats it nowhere, its desk empty and the lounge without it
    const planAway = useMemo(() => {
        const a = { ...settled };
        for (const [id, to] of Object.entries(walking)) {
            a[id] = to ?? a[id] ?? "coffee";
        }
        return a;
    }, [settled, walking]);
    // which floor and slot each project's room takes (officelayout.ts): a newcomer takes the first empty slot from G up,
    // and is saved there
    const layoutRaw = useAtomValue(officeLayoutAtom);
    const placed = useMemo(
        () => placeRooms(parseLayout(layoutRaw), projectsOf(agents, runs)),
        [layoutRaw, agents, runs]
    );
    useEffect(() => {
        if (!sameValues(layoutRaw, placed.layout)) {
            globalStore.set(officeLayoutAtom, placed.layout);
        }
    }, [layoutRaw, placed.layout]);
    const floorWanted = useAtomValue(officeFloorAtom);
    const plan = useMemo(
        () => buildPlan({ agents, runs, width, height, floor: floorWanted, at: placed.at, now, away: planAway, night }),
        [agents, runs, width, height, floorWanted, placed.at, now, planAway, night]
    );
    lastPlan = plan;
    const sceneKey = sceneryKey(plan, phase, tired, theme);
    // the plan is rebuilt on every coarse tick with new objects; the ops only when what they draw has changed
    const scene = useMemo(() => scenery(plan, phase, tired), [sceneKey]);
    // one draw of the building per scene: both canvases paint in their own effects, which run before this one
    useEffect(() => {
        sceneryDraws++;
        probe.sceneryDraws = sceneryDraws;
    }, [scene]);

    const planRef = useRef(plan);
    planRef.current = plan;
    const placedRef = useRef(placed);
    placedRef.current = placed;
    // a room is carried (g, or a title dragged): the boss walks no more, and the keys are the carry's
    const carrying = () => globalStore.get(officeCarryAtom) != null;
    // the stop the boss stood at when it picked a room up: where it walks back to when the room is put back after a ride
    const carryStop = useRef<string | undefined>(undefined);
    const cursorRef = useRef(cursorId);
    cursorRef.current = cursorId;
    const onCursorRef = useRef(onCursor);
    onCursorRef.current = onCursor;
    const movingRef = useRef(moving);
    movingRef.current = moving;
    const devRef = useRef(dev);
    devRef.current = dev;
    const arrivedRef = useRef<string | undefined>(undefined);
    const carry = useRef(0);
    const bossWasMoving = useRef(false);
    const hintTimer = useRef<number | undefined>(undefined);
    // the lift: whether a ride is on, its timers, the floor it goes to, what it does once the boss has stopped walking
    // into the lift (afterWalk), what it holds the doors for (rideHeld, the DEV hold), and what to do once the new floor
    // is shown and the doors are open (afterRide: the walk to an ask on that floor)
    const ridingRef = useRef(false);
    const rideTimers = useRef<number[]>([]);
    const rideTo = useRef<number | null>(null);
    const afterWalk = useRef<(() => void) | null>(null);
    const rideHeld = useRef<(() => void) | null>(null);
    const afterRide = useRef<{ floor: number; run: () => void } | null>(null);

    // the boss has stopped: the desk it stands at becomes the Cockpit's cursor
    const afterStop = () => {
        const b = globalStore.get(bossAtom);
        if (!b) {
            return;
        }
        const walked = afterWalk.current;
        if (walked) {
            afterWalk.current = null;
            walked();
            return;
        }
        const key = deskAt(planRef.current, b.at);
        if (key) {
            // at a desk or a chip the boss looks up at it; at the lift it faces the doors, which are below
            globalStore.set(bossAtom, { ...b, dir: key === LIFT_KEY ? "down" : "up" });
            if (key !== cursorRef.current) {
                arrivedRef.current = key;
                onCursorRef.current(key);
            }
        }
        rootRef.current?.querySelector("[data-office-boss]")?.scrollIntoView({ block: "nearest" });
    };

    const stepAll = (dt: number): boolean => {
        const plan = planRef.current;
        const frame = walkFrame();
        if (frame !== globalStore.get(walkFrameAtom)) {
            globalStore.set(walkFrameAtom, frame);
        }
        let bossBusy = false;
        const b = globalStore.get(bossAtom);
        if (b) {
            if (b.path.length > 1) {
                const r = advance(b.path, (b.speed * dt) / 1000);
                const done = r.rest.length < 2;
                globalStore.set(bossAtom, { ...b, at: r.at, path: done ? [] : r.rest, dir: facing(b.at, r.at, b.dir) });
                bossBusy = !done;
            } else if (b.holding) {
                carry.current += (BOSS_SPEED * dt) / 1000;
                if (carry.current >= STEP_PX) {
                    const dist = Math.floor(carry.current / STEP_PX) * STEP_PX;
                    carry.current -= dist;
                    globalStore.set(bossAtom, { ...b, at: stepToward(plan, b.at, b.holding, dist), dir: b.holding });
                }
                bossBusy = true;
            } else if (devRef.current?.patrol && plan.order.length > 1) {
                const at = deskAt(plan, b.at);
                const next = plan.order[(plan.order.indexOf(at ?? "") + 1) % plan.order.length];
                const spot = spotOf(plan, next);
                if (spot) {
                    globalStore.set(bossAtom, { ...b, path: pathBetween(plan, b.at, spot), speed: BOSS_SPEED });
                }
                bossBusy = true;
            }
        }
        if (bossWasMoving.current && !bossBusy) {
            afterStop();
        }
        bossWasMoving.current = bossBusy;

        const ws = globalStore.get(walkersAtom);
        let walkersBusy = false;
        if (ws.length > 0) {
            const next: Walker[] = [];
            const arrived: Walker[] = [];
            for (const w of ws) {
                const r = advance(w.path, (WALKER_SPEED * dt) / 1000);
                if (r.rest.length >= 2) {
                    next.push({ ...w, at: r.at, path: r.rest, dir: facing(w.at, r.at, w.dir) });
                } else if (w.loop) {
                    const back = sameSpot(r.at, w.loop[0]) ? w.loop[1] : w.loop[0];
                    next.push({ ...w, at: r.at, path: pathBetween(plan, r.at, back) });
                } else {
                    arrived.push(w);
                }
            }
            globalStore.set(walkersAtom, next);
            if (arrived.length > 0) {
                const left = { ...globalStore.get(walkingAtom) };
                for (const w of arrived) {
                    delete left[w.id];
                }
                globalStore.set(walkingAtom, left);
                setSettled((s) => arrived.reduce((acc, w) => withAway(acc, w.id, w.to), s));
            }
            walkersBusy = next.length > 0;
        }
        return bossBusy || walkersBusy;
    };
    const kick = useWalkLoop(stepAll);

    const goTo = (key: string) => {
        if (carrying()) {
            return;
        }
        const b = globalStore.get(bossAtom);
        const elsewhere = planRef.current.otherAsks.find((a) => a.key === key);
        if (elsewhere) {
            // an ask on another floor: ride there, then walk to it
            arrivedRef.current = key;
            ride(elsewhere.floor, () => goTo(key));
            return;
        }
        const spot = spotOf(planRef.current, key);
        if (!b || !spot || ridingRef.current) {
            return;
        }
        arrivedRef.current = key;
        globalStore.set(layerAtom, "walk");
        if (!movingRef.current) {
            globalStore.set(bossAtom, { ...b, at: spot, path: [], holding: undefined, dir: "up" });
            return;
        }
        globalStore.set(bossAtom, {
            ...b,
            path: pathBetween(planRef.current, b.at, spot),
            speed: JUMP_SPEED,
            holding: undefined,
        });
        kick();
    };
    const showPath = (key: string) => {
        if (carrying()) {
            return;
        }
        const b = globalStore.get(bossAtom);
        const elsewhere = planRef.current.otherAsks.find((a) => a.key === key);
        if (elsewhere) {
            // no path to show across floors: the lift takes the boss
            goTo(key);
            return;
        }
        const spot = spotOf(planRef.current, key);
        if (!b || !spot || ridingRef.current) {
            return;
        }
        arrivedRef.current = key;
        globalStore.set(dotsAtom, dotsAlong(pathBetween(planRef.current, b.at, spot)));
        window.clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => {
            globalStore.set(dotsAtom, []);
            goTo(key);
        }, PATH_HINT_MS);
    };
    const walk = (dir: Dir) => {
        const b = globalStore.get(bossAtom);
        if (!b || ridingRef.current || carrying()) {
            return;
        }
        globalStore.set(layerAtom, "walk");
        if (!movingRef.current) {
            globalStore.set(bossAtom, {
                ...b,
                at: stepToward(planRef.current, b.at, dir, ARROW_STEP_PX),
                dir,
                path: [],
            });
            afterStop();
            return;
        }
        if (b.holding === dir) {
            return;
        }
        globalStore.set(bossAtom, { ...b, holding: dir, dir, path: [] });
        kick();
    };
    const release = (dir: Dir) => {
        const b = globalStore.get(bossAtom);
        if (b?.holding === dir) {
            globalStore.set(bossAtom, { ...b, holding: undefined });
        }
    };
    // a click on the floor walks the boss there at a click's speed, through the doors; on arriving, the desk at the
    // boss (if any, in the room it stands in) becomes the cursor, and in the hall the cursor stays on the last desk
    const walkTo = (p: Point) => {
        const b = globalStore.get(bossAtom);
        const at = { x: Math.round(p.x / STEP_PX) * STEP_PX, y: Math.round(p.y / STEP_PX) * STEP_PX };
        if (!b || ridingRef.current || carrying() || !canWalk(planRef.current, at)) {
            return;
        }
        globalStore.set(layerAtom, "walk");
        if (!movingRef.current) {
            globalStore.set(bossAtom, { ...b, at, path: [], holding: undefined });
            afterStop();
            return;
        }
        globalStore.set(bossAtom, {
            ...b,
            path: pathBetween(planRef.current, b.at, at),
            speed: JUMP_SPEED,
            holding: undefined,
        });
        kick();
    };

    // The lift (office floors spec, "Riding"). With motion on: the boss steps into the lift when it stands at the doors,
    // two steel doors close over the office (MOTION.durExit), the floor changes behind them and the dial ticks floor by
    // floor (MOTION.durMacro each), the doors open (MOTION.durMacro) on the new floor with the boss by its lift, facing
    // down. Without motion the floor swaps at once. `then` runs once the new floor is shown and the doors are open.
    // everyone who is walking is at once where they were going: a walker belongs to the floor it set off on
    const settleWalkers = () => {
        const ws = globalStore.get(walkersAtom);
        if (ws.length > 0) {
            globalStore.set(walkersAtom, []);
            globalStore.set(walkingAtom, {});
            setSettled((s) => ws.reduce((acc, w) => (w.loop ? acc : withAway(acc, w.id, w.to)), s));
        }
    };
    const clearRide = () => {
        rideTimers.current.forEach((t) => window.clearTimeout(t));
        rideTimers.current = [];
    };
    const later = (ms: number, fn: () => void) => {
        rideTimers.current.push(window.setTimeout(fn, ms));
    };
    // the floor shows and the boss stands by its lift; the cursor goes to the lift unless a walk is waiting to move it
    const arriveAt = (to: number) => {
        settleWalkers();
        globalStore.set(officeFloorAtom, to);
        globalStore.set(bossAtom, { at: planRef.current.lift.spot, path: [], dir: "down", speed: BOSS_SPEED });
        if (!afterRide.current) {
            arrivedRef.current = LIFT_KEY;
            onCursorRef.current(LIFT_KEY);
        }
    };
    const settleRide = () => {
        clearRide();
        ridingRef.current = false;
        rideTo.current = null;
        rideHeld.current = null;
        globalStore.set(rideAtom, null);
        const p = afterRide.current;
        // the plan may not have drawn the new floor yet: the effect on plan.floor runs it then
        if (p && planRef.current.floor === p.floor) {
            afterRide.current = null;
            p.run();
        }
    };
    const ride = (to: number, then?: () => void) => {
        const shown = planRef.current.floors;
        const from = planRef.current.floor;
        if (ridingRef.current || to === from || !shown.some((f) => f.floor === to)) {
            return;
        }
        window.clearTimeout(hintTimer.current);
        globalStore.set(dotsAtom, []);
        // a room carried rides with the boss: the carry's keys stay up
        if (!carrying()) {
            globalStore.set(layerAtom, "walk");
        }
        globalStore.set(officeMenuOpenAtom, false);
        afterRide.current = then ? { floor: to, run: then } : null;
        if (!movingRef.current) {
            arriveAt(to);
            return;
        }
        ridingRef.current = true;
        rideTo.current = to;
        // the labels the dial reads after the doors shut, in the order it ticks to them
        const at = shown.findIndex((f) => f.floor === from);
        const end = shown.findIndex((f) => f.floor === to);
        const labels = (end > at ? shown.slice(at + 1, end + 1) : shown.slice(end, at).reverse()).map((f) => f.label);
        const arrow = end > at ? "▲" : "▼";
        const closeMs = Math.round(MOTION.durExit * 1000);
        const tickMs = Math.round(MOTION.durMacro * 1000);
        const open = () => {
            rideHeld.current = null;
            globalStore.set(rideAtom, { closed: false, ms: tickMs, label: labels[labels.length - 1], arrow: "" });
            later(tickMs, settleRide);
        };
        const close = () => {
            globalStore.set(rideAtom, { closed: true, ms: closeMs, label: shown[at].label, arrow: "" });
            later(closeMs, () => {
                arriveAt(to);
                globalStore.set(rideAtom, { closed: true, ms: 0, label: shown[at].label, arrow });
                labels.forEach((label, i) =>
                    later((i + 1) * tickMs, () => globalStore.set(rideAtom, { closed: true, ms: 0, label, arrow }))
                );
                later(labels.length * tickMs, () => {
                    if (devRef.current?.rideHold) {
                        rideHeld.current = open;
                    } else {
                        open();
                    }
                });
            });
        };
        const b = globalStore.get(bossAtom);
        const d = planRef.current.lift.doors;
        if (b && b.path.length < 2 && deskAt(planRef.current, b.at) === LIFT_KEY) {
            // the boss steps into the lift
            afterWalk.current = close;
            globalStore.set(bossAtom, {
                ...b,
                path: [b.at, { x: d.x + d.w / 2, y: d.y + d.h - 8 }],
                speed: JUMP_SPEED,
                holding: undefined,
            });
            kick();
        } else {
            close();
        }
    };
    // motion turned off mid-ride: the floor shows and the boss is by its lift at once
    const finishRide = () => {
        clearRide();
        afterWalk.current = null;
        const to = rideTo.current;
        if (to != null && planRef.current.floor !== to) {
            arriveAt(to);
        }
        settleRide();
    };
    // the doors held shut by the DEV hold open when it lets go
    useEffect(() => {
        if (!dev?.rideHold) {
            rideHeld.current?.();
        }
    }, [dev?.rideHold]);
    // a walk that waited for the ride to end (an ask on another floor) starts once that floor is drawn
    useEffect(() => {
        const p = afterRide.current;
        if (p && plan.floor === p.floor && !ridingRef.current) {
            afterRide.current = null;
            p.run();
        }
    }, [plan.floor]);
    // a new floor draws other desks, and a button of the old one that held focus (a click on a desk or the chip) takes it
    // along: the keys are the Cockpit surface's, so focus goes back to it, or the next PageUp would reach nobody
    const floorShown = useRef(plan.floor);
    useEffect(() => {
        if (floorShown.current === plan.floor) {
            return;
        }
        floorShown.current = plan.floor;
        const surface = rootRef.current?.closest<HTMLElement>("[data-cockpit-surface]");
        if (surface && !surface.contains(document.activeElement)) {
            surface.focus({ preventScroll: true });
        }
        // the lift is at the floor's foot, and the view may be scrolled to its head
        rootRef.current?.querySelector("[data-office-boss]")?.scrollIntoView({ block: "nearest" });
    }, [plan.floor]);

    // Carrying a room (office floors spec, "Arranging rooms"). The carry holds the room and its target; the layout is
    // written only when it is put down. By keyboard the boss rides the lift with the room (the floor shown is the
    // target's); by pointer the view stays and the target follows the slot or the floor's button under the pointer.
    const endCarry = () => {
        globalStore.set(officeCarryAtom, null);
        globalStore.set(carryPointerAtom, null);
        globalStore.set(layerAtom, "walk");
    };
    const beginCarry = (project: string, by: Carry["by"]): boolean => {
        const from = placedRef.current.at[project];
        if (!from || ridingRef.current || carrying()) {
            return false;
        }
        window.clearTimeout(hintTimer.current);
        globalStore.set(dotsAtom, []);
        globalStore.set(officeMenuOpenAtom, false);
        globalStore.set(officeCarryAtom, { project, from, target: from, by });
        globalStore.set(layerAtom, "carry");
        return true;
    };
    const setTarget = (c: Carry, target: Carry["target"]) => {
        if (!sameValues(c.target, target)) {
            globalStore.set(officeCarryAtom, { ...c, target });
        }
    };
    const carryCtx = (c: Carry) => ({ floors: planRef.current.floors, project: c.project, fromSlot: c.from.slot });
    const grab = (): boolean => {
        const b = globalStore.get(bossAtom);
        const p = planRef.current;
        if (!b || b.path.length > 1 || b.holding || ridingRef.current || carrying()) {
            return false;
        }
        const key = roomAt(p, b.at);
        const room = p.rooms.find((r) => r.kind === "agents" && r.key === key);
        if (!room) {
            return false;
        }
        carryStop.current = deskAt(p, b.at);
        return beginCarry(room.title, "key");
    };
    const cancelCarry = () => {
        const c = globalStore.get(officeCarryAtom);
        if (!c || ridingRef.current) {
            return;
        }
        endCarry();
        // the room was ridden to another floor: the lift takes the boss back, and it walks to where it stood
        if (c.by === "key" && planRef.current.floor !== c.from.floor) {
            const stop = carryStop.current;
            ride(c.from.floor, stop ? () => goTo(stop) : undefined);
        }
    };
    const dropCarry = () => {
        const c = globalStore.get(officeCarryAtom);
        if (!c || ridingRef.current) {
            return;
        }
        const was = placedRef.current;
        // the pointer let go over no slot and no floor that takes the room, or a room put down where it was
        const place = c.target == null ? undefined : carryPlace(c.target, was.at);
        if (!place || sameValues(place, was.at[c.project])) {
            cancelCarry();
            return;
        }
        const next = placeRooms(parseLayout(swapRooms(was.layout, was.at, c.project, place)), projectsOf(agents, runs));
        const there = buildPlan({
            agents,
            runs,
            width,
            height,
            floor: place.floor,
            at: next.at,
            now,
            away: planAway,
            night,
        });
        // the boss goes with the room: to the stop it stood at when that is in the room, else the room's first
        const stop = carriedStop(there, `room:${c.project}`, cursorRef.current);
        if (place.floor !== planRef.current.floor) {
            settleWalkers();
        }
        endCarry();
        globalStore.set(officeLayoutAtom, next.layout);
        globalStore.set(officeFloorAtom, place.floor);
        globalStore.set(bossAtom, {
            at: (stop && spotOf(there, stop)) || there.lift.spot,
            path: [],
            dir: stop ? "up" : "down",
            speed: BOSS_SPEED,
        });
        arrivedRef.current = stop ?? LIFT_KEY;
        onCursorRef.current(stop ?? LIFT_KEY);
    };
    // the target the pointer is over: the slot of the floor shown under it, a floor's button of the lift's map (the first
    // empty slot of that floor, or a new floor), or none
    const pointerTarget = (ev: PointerEvent, p: Point, c: Carry): Carry["target"] => {
        const plan = planRef.current;
        const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-office-floor]");
        if (row) {
            if (row.dataset.officeFloor === "new") {
                return canBuildFloor(plan.floors, c.project) ? "new" : null;
            }
            const floor = Number(row.dataset.officeFloor);
            const moved =
                floor === plan.floor
                    ? null
                    : moveToFloor(placedRef.current.layout, placedRef.current.at, c.project, floor);
            return moved?.rooms[c.project] ?? null;
        }
        const room = plan.rooms.find(
            (r) =>
                (r.kind === "agents" || r.kind === "empty") &&
                p.x >= r.box.x &&
                p.x <= r.box.x + r.box.w &&
                p.y >= r.box.y &&
                p.y <= r.box.y + r.box.h
        );
        return room?.slot != null ? { floor: plan.floor, slot: room.slot } : null;
    };
    // a press on a project room's title: past DRAG_PX it picks the room up, the pointer carries it until it is let go
    // (dropped where it is, or put back when nothing there takes it) or Esc puts it back. Everything here runs after the
    // render that made it, so it reads the plan and the arrangement through refs and the handle
    const dragRef = useRef<(roomKey: string, e: ReactPointerEvent) => void>(() => undefined);
    dragRef.current = (roomKey, e) => {
        if (e.button !== 0 || ridingRef.current || carrying()) {
            return;
        }
        const project = planRef.current.rooms.find((r) => r.key === roomKey && r.kind === "agents")?.title;
        if (project == null || placedRef.current.at[project] == null) {
            return;
        }
        // no text selection or focus change under a drag; a click is still sent
        e.preventDefault();
        const start = { x: e.clientX, y: e.clientY };
        let dragging = false;
        let cancelled = false;
        const aim = (ev: PointerEvent) => {
            const c = globalStore.get(officeCarryAtom);
            const r = rootRef.current?.getBoundingClientRect();
            if (!c || !r) {
                return;
            }
            const p = { x: ev.clientX - r.left, y: ev.clientY - r.top };
            globalStore.set(carryPointerAtom, p);
            setTarget(c, pointerTarget(ev, p, c));
        };
        const onMove = (ev: PointerEvent) => {
            if (cancelled) {
                return;
            }
            if (!dragging) {
                if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_PX) {
                    return;
                }
                if (!beginCarry(project, "pointer")) {
                    cancelled = true;
                    return;
                }
                dragging = true;
            }
            aim(ev);
        };
        const unsub = globalStore.sub(officeCarryAtom, () => {
            if (dragging && globalStore.get(officeCarryAtom) == null) {
                cancelled = true;
            }
        });
        const cleanup = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onAbort);
            unsub();
        };
        // the click that ends a drag is no click on the floor: it would walk the boss to where the room was dropped
        const swallowClick = () => {
            const stop = (ev: Event) => {
                ev.stopPropagation();
                ev.preventDefault();
            };
            window.addEventListener("click", stop, { capture: true, once: true });
            window.setTimeout(() => window.removeEventListener("click", stop, true), 0);
        };
        const onUp = (ev: PointerEvent) => {
            cleanup();
            if (!dragging) {
                return;
            }
            swallowClick();
            if (!cancelled) {
                aim(ev);
                handleRef.current?.drop();
            }
        };
        const onAbort = () => {
            cleanup();
            if (dragging && !cancelled) {
                handleRef.current?.cancel();
            }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onAbort);
    };
    const onGrab = useCallback((roomKey: string, e: ReactPointerEvent) => dragRef.current(roomKey, e), []);
    // the project of the room carried left (its cards are gone): nothing to put down
    useEffect(() => {
        const c = globalStore.get(officeCarryAtom);
        if (c && placed.at[c.project] == null) {
            endCarry();
        }
    }, [placed.at]);

    const dialogRef = useRef(props.dialogFor);
    dialogRef.current = props.dialogFor;
    const onMenuRef = useRef(props.onMenu);
    onMenuRef.current = props.onMenu;
    // read when the menu opens (a walk step renders nothing): the boss in a project room can pick it up
    const menuInRoom = useAtomValue(menuInRoomAtom);
    const menuItems = officeMenuItems(plan.asks.length, props.newEvents, props.eventsOpen, props.boardRows, menuInRoom);
    const menuItemsRef = useRef(menuItems);
    menuItemsRef.current = menuItems;
    // whether OfficeDialogLayer draws a box now: with none at the boss's desk the dialog layer is walking, and the keys
    // never act on a box that is not drawn (boxLayer)
    const boxShownRef = useRef(false);

    // the desk the boss stands at, when it stands still at the cursor's desk
    const deskAtBoss = (): string | undefined => {
        const key = cursorRef.current;
        return key && cardAt(planRef.current, globalStore.get(bossAtom), key) ? key : undefined;
    };
    // a desk's dialog box, the ▶ on its first item
    const openDialog = (key: string): boolean => {
        const vm = dialogRef.current(key);
        if (!vm) {
            return false;
        }
        globalStore.set(selAtom, clampSel(vm.items, -1));
        globalStore.set(layerAtom, "dialog");
        return true;
    };
    // the dialog the ↑ ↓ and ↵ act on: the desk's, while its box is drawn
    const shownDialog = (): OfficeDialogVM | null => {
        const key = cursorRef.current;
        return key && boxShownRef.current && globalStore.get(layerAtom) === "dialog" ? dialogRef.current(key) : null;
    };
    // ↵ on the ▶ item of the dialog box (a click on a row too, whether or not the office menu is up)
    const activateDialog = () => {
        const vm = shownDialog();
        if (!vm) {
            return;
        }
        const sel = clampSel(vm.items, globalStore.get(selAtom));
        const it = vm.items[sel];
        if (!it || it.dim) {
            return;
        }
        vm.run(it.id);
        globalStore.set(selAtom, selAfterActivate(vm.items, sel));
    };
    handleRef.current = {
        walk,
        release,
        goTo,
        showPath,
        layer: () => boxLayer(globalStore.get(layerAtom), boxShownRef.current),
        menuOpen: () => globalStore.get(officeMenuOpenAtom),
        talk: () => {
            const key = deskAtBoss();
            return key != null && openDialog(key);
        },
        card: (opts) => {
            const key = deskAtBoss();
            if (!key || renderCard(key) == null) {
                return false;
            }
            if (globalStore.get(layerAtom) === "card" && !opts?.adjust) {
                globalStore.set(officeBigCardAtom, !globalStore.get(officeBigCardAtom));
                return true;
            }
            globalStore.set(cardAdjustAtom, !!opts?.adjust);
            globalStore.set(officeBigCardAtom, true);
            globalStore.set(layerAtom, "card");
            return true;
        },
        move: (delta) => {
            if (globalStore.get(officeMenuOpenAtom)) {
                const all = menuItemsRef.current.map((it) => !it.disabled);
                globalStore.set(menuSelAtom, stepSel(globalStore.get(menuSelAtom), delta, all));
                return;
            }
            const vm = shownDialog();
            if (vm) {
                const sel = clampSel(vm.items, globalStore.get(selAtom));
                globalStore.set(selAtom, stepSel(sel, delta, enabledOf(vm.items)));
            }
        },
        activate: () => {
            if (globalStore.get(officeMenuOpenAtom)) {
                const it = menuItemsRef.current[globalStore.get(menuSelAtom)];
                if (it?.disabled) {
                    return;
                }
                globalStore.set(officeMenuOpenAtom, false);
                if (it) {
                    onMenuRef.current(it.id);
                }
                return;
            }
            activateDialog();
        },
        back: () => {
            if (globalStore.get(officeMenuOpenAtom)) {
                globalStore.set(officeMenuOpenAtom, false);
                return true;
            }
            const raw = globalStore.get(layerAtom);
            if (boxLayer(raw, boxShownRef.current) === "walk") {
                // a dialog layer with no box drawn is walking: shut it, so the box does not appear when the boss arrives
                if (raw !== "walk") {
                    globalStore.set(layerAtom, "walk");
                }
                return false;
            }
            const key = cursorRef.current;
            const next = backFrom(raw);
            // a desk whose dialog is gone (the agent left) goes straight back to walking
            globalStore.set(layerAtom, next === "dialog" && !(key && dialogRef.current(key)) ? "walk" : next);
            return true;
        },
        toggleMenu: () => {
            // a carried room takes every key, and the menu waits for it to be put down
            if (carrying()) {
                return;
            }
            const open = !globalStore.get(officeMenuOpenAtom);
            if (open) {
                globalStore.set(menuSelAtom, 0);
                const b = globalStore.get(bossAtom);
                const p = planRef.current;
                globalStore.set(
                    menuInRoomAtom,
                    b != null && p.rooms.some((r) => r.kind === "agents" && r.key === roomAt(p, b.at))
                );
            }
            globalStore.set(officeMenuOpenAtom, open);
        },
        // the board is a stop while rows wait; plan.order and plan.asks stay the floor's desks'. j k walk this floor; n
        // goes on to the asks on the other floors, whose walk rides the lift first (goTo)
        order: () => (props.boardRows > 0 ? [...planRef.current.order, BOARD_KEY] : planRef.current.order),
        asks: () => [
            ...planRef.current.asks,
            ...planRef.current.otherAsks.map((a) => a.key),
            ...(props.boardRows > 0 ? [BOARD_KEY] : []),
        ],
        pageBoard: (delta) => {
            const at = boardPage(globalStore.get(officeBoardPageAtom), props.boardRows);
            if (at < 0) {
                return;
            }
            globalStore.set(officeBoardPageAtom, boardPage(at + delta, props.boardRows));
            globalStore.set(officeBoardWhyAtom, false);
            globalStore.set(selAtom, 0);
        },
        openBoard: () => pickRef.current(BOARD_KEY),
        openLift: () => pickRef.current(LIFT_KEY),
        ride: (to) => ride(to),
        floor: () => planRef.current.floor,
        floors: () => planRef.current.floors,
        grab,
        slot: (dir) => {
            const c = globalStore.get(officeCarryAtom);
            if (c && !ridingRef.current && c.target != null) {
                setTarget(c, carryTarget(c.target, { do: "slot", dir }, carryCtx(c)));
            }
        },
        carryFloor: (delta) => {
            const c = globalStore.get(officeCarryAtom);
            if (!c || ridingRef.current || c.target == null) {
                return;
            }
            const target = carryTarget(c.target, { do: "floor", delta }, carryCtx(c));
            if (sameValues(target, c.target)) {
                return;
            }
            setTarget(c, target);
            // a floor with a room rides there with it; a new floor builds on the top one and shows nothing new
            if (target !== "new" && target.floor !== planRef.current.floor) {
                ride(target.floor);
            }
        },
        drop: dropCarry,
        cancel: cancelCarry,
        chipOf: (key) => {
            const room = planRef.current.rooms.find((r) => r.chip?.key === key);
            return room ? { room, agents, runs } : undefined;
        },
        openChipCard: (id) => {
            const key = cursorRef.current;
            if (!key || !cardAt(planRef.current, globalStore.get(bossAtom), key)?.chip || renderCard(id) == null) {
                return;
            }
            globalStore.set(chipCardAtom, { id, kind: agents.some((a) => a.id === id) ? "agent" : "run" });
            globalStore.set(cardAdjustAtom, false);
            globalStore.set(officeBigCardAtom, true);
            globalStore.set(layerAtom, "card");
        },
    };

    // the last row gone while the board's box is up: dialogFor has no page then, so the box is not drawn; the layer goes
    // back to walking so the next ↵ is a fresh talk
    useEffect(() => {
        if (props.boardRows === 0 && cursorId === BOARD_KEY && globalStore.get(layerAtom) === "dialog") {
            globalStore.set(layerAtom, "walk");
        }
    }, [props.boardRows, cursorId]);

    const pickRef = useRef((key: string) => {
        goTo(key);
        onCursor(key);
    });
    pickRef.current = (key: string) => {
        goTo(key);
        openDialog(key);
        onCursor(key);
    };
    const onPick = useCallback((key: string) => pickRef.current(key), []);

    // the boss comes to where the Cockpit's cursor already is (a pick in the rail, Needs you, a reload), with the card
    // shut: ↵ over the desk offers it
    useEffect(() => {
        if (width === 0) {
            return;
        }
        if (globalStore.get(bossAtom) == null) {
            const at = (cursorId && spotOf(plan, cursorId)) ||
                spotOf(plan, plan.asks[0] ?? "") ||
                spotOf(plan, plan.order[0] ?? "") || {
                    x: plan.lounge.x + plan.lounge.w / 2,
                    y: plan.lounge.y + plan.lounge.h - 20,
                };
            globalStore.set(bossAtom, { at, path: [], dir: "up", speed: BOSS_SPEED });
            arrivedRef.current = cursorId;
            return;
        }
        if (cursorId && cursorId !== arrivedRef.current) {
            goTo(cursorId);
        }
    }, [cursorId, width > 0]);

    // idle people walk to the lounge and back, at most three at once
    useEffect(() => {
        const ids = Object.keys({ ...targets, ...settled }).filter(
            (id) => targets[id] !== settled[id] && !(id in walking)
        );
        if (ids.length === 0) {
            return;
        }
        if (!moving) {
            setSettled(targets);
            return;
        }
        const admit = admitWalkers(
            ids.map((id) => ({ id, idleSince: agents.find((a) => a.id === id)?.idleSince })),
            Object.keys(walking).length
        );
        const started: Walker[] = [];
        const dest: Record<string, Away | null> = { ...walking };
        for (const id of admit) {
            const desk = plan.desks.find((d) => d.key === id);
            const a = agents.find((x) => x.id === id);
            if (!desk || !a) {
                setSettled((s) => withAway(s, id, targets[id]));
                continue;
            }
            const spotFor = (at: Away | undefined) =>
                at === "sofa" ? plan.sofa : at === "coffee" ? plan.coffee : desk.spot;
            const from = spotFor(settled[id]);
            const to = spotFor(targets[id]);
            started.push({
                id,
                at: from,
                path: pathBetween(plan, from, to),
                dir: "down",
                to: targets[id],
                outfit: { shirt: shirtOf(a.harness), look: lookOf(id) },
            });
            dest[id] = targets[id] ?? null;
        }
        if (started.length === 0) {
            return;
        }
        globalStore.set(walkersAtom, [...globalStore.get(walkersAtom), ...started]);
        globalStore.set(walkingAtom, dest);
        kick();
    }, [targets, settled, walking, moving, plan]);

    // DEV (the bench): this many people walk desk to coffee and back without end
    useEffect(() => {
        const n = moving ? (dev?.walkers ?? 0) : 0;
        const all = globalStore.get(walkersAtom);
        const loops = all.filter((w) => w.loop);
        if (n === loops.length || width === 0) {
            return;
        }
        const made: Walker[] = plan.desks
            .filter((d) => d.pose !== "empty" && !walkingIds.has(d.key))
            .slice(0, n)
            .map((d) => ({
                id: d.key,
                at: d.spot,
                path: pathBetween(plan, d.spot, plan.coffee),
                dir: "down",
                outfit: { shirt: shirtOf(d.harness), look: lookOf(d.key) },
                loop: [d.spot, plan.coffee],
            }));
        globalStore.set(walkersAtom, [...all.filter((w) => !w.loop), ...made]);
        const dest = { ...globalStore.get(walkingAtom) };
        for (const w of loops) {
            delete dest[w.id];
        }
        for (const w of made) {
            dest[w.id] = null;
        }
        globalStore.set(walkingAtom, dest);
        if (made.length > 0) {
            kick();
        }
    }, [dev?.walkers, moving, width > 0]);

    useEffect(() => {
        if (dev?.patrol && moving) {
            kick();
        }
    }, [dev?.patrol, moving]);

    // motion turned off mid-walk: everyone is at once where they were going
    useEffect(() => {
        if (moving) {
            return;
        }
        if (ridingRef.current) {
            finishRide();
        }
        const b = globalStore.get(bossAtom);
        if (b && (b.path.length > 1 || b.holding)) {
            globalStore.set(bossAtom, { ...b, at: b.path[b.path.length - 1] ?? b.at, path: [], holding: undefined });
        }
        settleWalkers();
    }, [moving]);

    useEffect(
        () => () => {
            window.clearTimeout(hintTimer.current);
            rideTimers.current.forEach((t) => window.clearTimeout(t));
            rideTimers.current = [];
            ridingRef.current = false;
            afterWalk.current = null;
            afterRide.current = null;
            rideHeld.current = null;
            globalStore.set(rideAtom, null);
            globalStore.set(officeFloorAtom, 0);
            globalStore.set(officeCarryAtom, null);
            globalStore.set(carryPointerAtom, null);
            globalStore.set(chipCardAtom, null);
            globalStore.set(menuInRoomAtom, false);
            globalStore.set(bossAtom, null);
            globalStore.set(walkersAtom, []);
            globalStore.set(walkingAtom, {});
            globalStore.set(dotsAtom, []);
            globalStore.set(layerAtom, "walk");
            globalStore.set(selAtom, 0);
            globalStore.set(officeBoardPageAtom, 0);
            globalStore.set(officeBoardWhyAtom, false);
            globalStore.set(officeMenuOpenAtom, false);
            globalStore.set(menuSelAtom, 0);
            globalStore.set(cardAdjustAtom, false);
            globalStore.set(officeMeterAtom, null);
            globalStore.set(officeFiveHourAtom, undefined);
            setOfficeRoot(null);
            lastPlan = null;
            lastRoot = null;
            lastWalking = new Set();
        },
        []
    );

    // the 5-hour window reset: everyone at a desk stretches once. The timer is the office's, not the effect's: a
    // reading that changes again within the stretch must not cancel its end
    const prevPct = useRef(pct);
    const stretchTimer = useRef<number | undefined>(undefined);
    const [stretching, setStretching] = useState(false);
    useEffect(() => {
        const reset = isReset(prevPct.current, pct);
        prevPct.current = pct;
        if (!reset) {
            return;
        }
        setStretching(true);
        window.clearTimeout(stretchTimer.current);
        stretchTimer.current = window.setTimeout(() => setStretching(false), STRETCH_MS);
    }, [pct]);
    useEffect(() => () => window.clearTimeout(stretchTimer.current), []);

    // the cheer as a desk turns done: the plan's coarse clock would miss a 1.5 s pose, so the office times it here,
    // where the frame clock can count it; the desks already done when the office opens do not cheer
    const doneWas = useRef<Set<string> | null>(null);
    const doneFloor = useRef(plan.floor);
    const cheerTimers = useRef<number[]>([]);
    const [cheering, setCheering] = useState<ReadonlySet<string>>(() => new Set());
    useEffect(() => {
        const done = new Set(plan.desks.filter((d) => d.word === "done").map((d) => d.key));
        // the desks already done on a floor just ridden to are not news either
        const was = doneFloor.current === plan.floor ? doneWas.current : null;
        doneFloor.current = plan.floor;
        doneWas.current = done;
        const fresh = was ? [...done].filter((k) => !was.has(k)) : [];
        if (fresh.length === 0) {
            return;
        }
        setCheering((s) => new Set([...s, ...fresh]));
        cheerTimers.current.push(
            window.setTimeout(() => setCheering((s) => new Set([...s].filter((k) => !fresh.includes(k)))), CHEER_MS)
        );
    }, [plan]);
    useEffect(() => () => cheerTimers.current.forEach((t) => window.clearTimeout(t)), []);

    // the frame clock runs while some drawn person moves: the nod, a raised hand, a cheer, a stretch (a yawn is a
    // working person's frame, so it rides on the nod)
    const animated =
        plan.desks.filter((d) => d.animated && !walkingIds.has(d.key)).length +
        plan.seats.filter((s) => s.animated).length +
        cheering.size;
    useFrameClock(animated > 0 || stretching, animationOn);

    useEffect(() => {
        setOfficeRoot(rootRef.current);
        lastRoot = rootRef.current;
        lastWalking = walkingIds;
        const people = peopleDrawn(plan, walkingIds, true);
        const prev = globalStore.get(officeMeterAtom);
        if (prev?.people !== people || prev.walking !== walkingIds.size || prev.animated !== animated) {
            globalStore.set(officeMeterAtom, { people, walking: walkingIds.size, animated });
        }
        Object.assign(probe, {
            desks: plan.desks.length,
            seats: plan.seats.length,
            dark: plan.rooms.filter((r) => !r.lit).map((r) => r.key),
            night,
            phase,
            lamps: night ? plan.desks.filter((d) => d.light !== "off").length : 0,
            cups: energy === "tired" ? plan.desks.filter((d) => d.light === "working").length : 0,
            walking: walkingIds.size,
            loungeMore: plan.loungeOverflow.length,
            boardRows: props.boardRows,
        });
    });

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div
                ref={scrollRef}
                data-cockpit-office
                className="min-h-0 flex-1 overflow-auto px-5 pb-3"
                style={{ paddingTop: HUD_SPACE_PX }}
            >
                <FiveHourLeaf model={props.model} />
                {width > 0 ? (
                    <div
                        ref={rootRef}
                        data-office-root
                        className="relative isolate"
                        style={{ width: plan.width, height: plan.height }}
                        onClick={(e) => {
                            // desks, seats, tables and the card beside the desk handle their own clicks
                            if ((e.target as HTMLElement).closest("button, [data-office-popup]")) {
                                return;
                            }
                            const r = e.currentTarget.getBoundingClientRect();
                            walkTo({ x: e.clientX - r.left, y: e.clientY - r.top });
                        }}
                    >
                        <OfficeCanvas
                            which="under"
                            ops={scene.under}
                            width={scene.width}
                            height={scene.height}
                            phase={phase}
                            z={0}
                        />
                        {plan.desks.map((d) => (
                            <DeskView
                                key={d.key}
                                d={d}
                                phase={phase}
                                hidePerson={walkingIds.has(d.key)}
                                energy={energy}
                                stretching={stretching}
                                cheering={cheering.has(d.key)}
                                onPick={onPick}
                            />
                        ))}
                        {plan.rooms.map((r) => (r.table ? <Table key={r.key} room={r} onPick={onPick} /> : null))}
                        {plan.seats.map((s) => {
                            // a seat is in its project's room, at the table of a zone: the zone's lights and table
                            const zone = plan.rooms.find((r) => r.key === s.zone);
                            return (
                                <SeatView
                                    key={s.key}
                                    s={s}
                                    phase={phase}
                                    lit={zone?.lit ?? true}
                                    near={zone?.table != null && s.bottom > zone.table.y + 20}
                                    onPick={onPick}
                                />
                            );
                        })}
                        {plan.loungers
                            .filter((l) => !walkingIds.has(l.agentId))
                            .map((l) => (
                                <LoungerView key={l.agentId} l={l} phase={phase} />
                            ))}
                        <OfficeCanvas
                            which="over"
                            ops={scene.over}
                            width={scene.width}
                            height={scene.height}
                            phase={phase}
                            z={2}
                        />
                        <Labels
                            plan={plan}
                            walking={walkingIds}
                            night={night}
                            phase={phase}
                            cursorId={cursorId}
                            onPick={onPick}
                            onGrab={onGrab}
                        />
                        <NoticeBoard box={plan.board.box} rows={props.boardRows} phase={phase} onPick={onPick} />
                        <LiftDoors doors={plan.lift.doors} onPick={onPick} />
                        <WalkersView phase={phase} />
                        <BossView plan={plan} phase={phase} />
                        <PathDots />
                        <OfficePopup
                            plan={plan}
                            cursorId={cursorId}
                            renderCard={renderCard}
                            boardRows={props.boardRows}
                            onTalk={() => handleRef.current?.talk()}
                        />
                        <CarryLayer plan={plan} />
                        {dev?.sheet ? <PoseSheet phase={phase} /> : null}
                    </div>
                ) : null}
            </div>
            <div className="pointer-events-none absolute inset-x-3 top-2.5 z-[9]">
                <OfficeHudBar>
                    <OfficeClock now={now} night={night} pct={pct} />
                    {props.hud}
                </OfficeHudBar>
            </div>
            <OfficeDialogLayer
                plan={plan}
                cursorId={cursorId}
                dialogFor={props.dialogFor}
                scrollRef={scrollRef}
                rootRef={rootRef}
                shownRef={boxShownRef}
                onPick={(i) => {
                    // the menu may be up beside the box: a click on a box row does that row, not the menu's ▶ item
                    globalStore.set(officeMenuOpenAtom, false);
                    globalStore.set(selAtom, i);
                    activateDialog();
                }}
            />
            <OfficeMenuLayer
                items={menuItems}
                onPick={(i) => {
                    globalStore.set(menuSelAtom, i);
                    handleRef.current?.activate();
                }}
            />
            <RideDoors phase={phase} />
        </div>
    );
}

// the office's clock and energy, first in the HUD bar
function OfficeClock({ now, night, pct }: { now: number; night: boolean; pct?: number }) {
    const time = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    // energy reads the window the other way: what is left of it, as a battery would
    const left = pct == null ? undefined : Math.min(100, Math.max(0, 100 - pct));
    const tired = left != null && left <= 10;
    return (
        <>
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                {night ? <Moon size={14} className="text-ink-mid" /> : <Sun size={14} className="text-graphlane-3" />}
                <span className="tabular-nums text-primary">{time}</span>
                {night ? "after hours" : "work hours"}
            </span>
            <span
                title="Energy: what is left of Claude's 5-hour window (the app bar meter shows what is used)"
                className={cn("flex shrink-0 items-center gap-1.5 tabular-nums", tired && "text-asking")}
            >
                <Zap size={14} />
                {left == null ? "—" : `${Math.round(left)} %`}
            </span>
        </>
    );
}

// the 5-hour window where the app bar meter reads it (usePlanDonuts, which ticks every second): only this leaf
// re-renders each second, and the office only when the rounded percent changes
function FiveHourLeaf({ model }: { model: AgentsViewModel }) {
    const pct = usePlanDonuts(model).find((d) => d.provider === "claude")?.fivehour.pct;
    const rounded = pct == null || Number.isNaN(pct) ? undefined : Math.round(pct);
    useEffect(() => {
        globalStore.set(officeFiveHourAtom, rounded);
    }, [rounded]);
    return null;
}

// a person stands on the art grid: `left` is a 14-wide person's left edge (a raised arm widens a sprite to the left),
// `bottom` its feet, both CSS px
function Person(p: {
    sprite: PlanSprite;
    outfit: PlanOutfit;
    phase: OfficePhase;
    shade?: Shade;
    left: number;
    bottom: number;
    z?: number;
    lounger?: string;
}) {
    const h = spriteH(p.sprite);
    return (
        <img
            alt=""
            draggable={false}
            data-office-sprite={p.sprite}
            data-office-lounger={p.lounger}
            src={planSpriteUrl(p.sprite, p.outfit, p.phase, p.shade ?? "")}
            className="pointer-events-none absolute [image-rendering:pixelated]"
            style={{
                left: p.left + spriteLeft(p.sprite) * PLAN_CELL,
                top: p.bottom - h,
                width: spriteWidth(p.sprite) * PLAN_CELL,
                height: h,
                zIndex: p.z ?? 1,
            }}
        />
    );
}

// a person at a desk whose pose moves; the 5-hour reset stretches everyone at a desk, at work or not. The yawn waits
// for the clock's first tick: tick is 0 while the clock is off (animation off, reduced motion), and a pose holds frame 0
function TickPerson(p: {
    id: string;
    pose: SeatPose;
    outfit: PlanOutfit;
    phase: OfficePhase;
    left: number;
    bottom: number;
    working: boolean;
    energy: Energy;
    stretching: boolean;
}) {
    const tick = useAtomValue(officeTickAtom);
    const sprite: PlanSprite = p.stretching
        ? "stretch"
        : p.working && tick > 0 && yawnsNow(p.id, tick, p.energy)
          ? "yawn"
          : (seatSprite(p.pose, (tick % 2) as 0 | 1) ?? "doze");
    return <Person sprite={sprite} outfit={p.outfit} phase={p.phase} left={p.left} bottom={p.bottom} />;
}

// the desk's furniture is on the canvases: this is the person at it and a transparent button over everything
const DESK_CLASS =
    "absolute z-[3] cursor-pointer border-0 bg-transparent p-0 [contain-intrinsic-size:88px_98px] [content-visibility:auto] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const DeskView = memo(function DeskView(p: {
    d: Desk;
    phase: OfficePhase;
    hidePerson: boolean;
    energy: Energy;
    stretching: boolean;
    cheering: boolean;
    onPick: (key: string) => void;
}) {
    const { d, phase, hidePerson, energy, stretching, cheering, onPick } = p;
    const outfit = useMemo<PlanOutfit>(() => ({ shirt: shirtOf(d.harness), look: lookOf(d.key) }), [d.harness, d.key]);
    const seated = !hidePerson && d.pose !== "empty";
    const working = d.light === "working";
    const pose: SeatPose = cheering ? "cheer" : d.pose;
    const ticks = d.animated || cheering || stretching || (working && energy !== "fresh");
    const left = (art(d.x) + 6) * PLAN_CELL;
    const bottom = (art(d.y) + 2) * PLAN_CELL;
    return (
        <>
            {seated ? (
                ticks ? (
                    <TickPerson
                        id={d.key}
                        pose={pose}
                        outfit={outfit}
                        phase={phase}
                        left={left}
                        bottom={bottom}
                        working={working}
                        energy={energy}
                        stretching={stretching}
                    />
                ) : (
                    <Person
                        sprite={seatSprite(pose, 0) ?? "doze"}
                        outfit={outfit}
                        phase={phase}
                        left={left}
                        bottom={bottom}
                    />
                )
            ) : null}
            <button
                type="button"
                data-office-desk={d.key}
                data-office-pose={!seated ? "empty" : stretching ? "stretch" : pose}
                title={d.tip}
                aria-label={d.tip}
                onClick={() => onPick(d.key)}
                className={DESK_CLASS}
                style={{ left: d.x - 4, top: d.y - 50, width: 88, height: 98 }}
            />
        </>
    );
}, sameValues);

// a seat's person: the near side sits in front of the table, on the over canvas's layer (z 3), shaded with its room
const seatShade = (lit: boolean, night: boolean): Shade =>
    !lit && night ? "both" : !lit ? "dark" : night ? "night" : "";

function TickSeat(p: {
    pose: SeatPose;
    outfit: PlanOutfit;
    phase: OfficePhase;
    left: number;
    bottom: number;
    z: number;
    shade: Shade;
}) {
    const tick = useAtomValue(officeTickAtom);
    return (
        <Person
            sprite={seatSprite(p.pose, (tick % 2) as 0 | 1) ?? "doze"}
            outfit={p.outfit}
            phase={p.phase}
            shade={p.shade}
            left={p.left}
            bottom={p.bottom}
            z={p.z}
        />
    );
}

const SeatView = memo(function SeatView(p: {
    s: Seat;
    phase: OfficePhase;
    lit: boolean;
    near: boolean;
    onPick: (key: string) => void;
}) {
    const { s, phase, lit, near, onPick } = p;
    const outfit = useMemo<PlanOutfit>(
        () => ({
            shirt: s.lane === 0 ? LEAD_SHIRT : LANE_SHIRTS[(s.lane - 1) % LANE_SHIRTS.length],
            look: lookOf(s.key),
        }),
        [s.lane, s.key]
    );
    if (s.pose === "empty") {
        return null;
    }
    const left = art(s.x - 3) * PLAN_CELL;
    const bottom = art(s.bottom) * PLAN_CELL;
    const z = near ? 3 : 1;
    const shade: Shade = near ? seatShade(lit, phase === "after") : "";
    return (
        <>
            {s.animated ? (
                <TickSeat pose={s.pose} outfit={outfit} phase={phase} left={left} bottom={bottom} z={z} shade={shade} />
            ) : (
                <Person
                    sprite={s.pose === "back" ? "backseat" : (seatSprite(s.pose, 0) ?? "doze")}
                    outfit={outfit}
                    phase={phase}
                    shade={shade}
                    left={left}
                    bottom={bottom}
                    z={z}
                />
            )}
            <button
                type="button"
                data-office-seat={s.key}
                data-office-pose={s.pose}
                title={s.tip}
                aria-label={s.tip}
                onClick={() => onPick(s.key)}
                className="absolute z-[3] cursor-pointer border-0 bg-transparent p-0 [contain-intrinsic-size:42px_51px] [content-visibility:auto] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{ left, top: bottom - 51, width: 42, height: 51 }}
            />
        </>
    );
}, sameValues);

// the table is drawn on the over canvas: this is its button, and the +N of the tasks it has no seat for
function Table({ room, onPick }: { room: Room; onPick: (key: string) => void }) {
    const t = room.table!;
    return (
        <>
            <button
                type="button"
                data-office-room={room.key}
                title={`${room.title} (Enter opens the run)`}
                aria-label={`${room.title}, the run's card`}
                onClick={() => room.runId && onPick(room.runId)}
                className="absolute z-[3] cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={box(t)}
            />
            {room.more ? (
                <span
                    className="pointer-events-none absolute z-[3] text-[11px] font-semibold text-primary"
                    style={{ left: t.x + t.w - 30, top: t.y + 6 }}
                >
                    +{room.more}
                </span>
            ) : null}
        </>
    );
}

function LoungerView({ l, phase }: { l: Lounger; phase: OfficePhase }) {
    const outfit = useMemo<PlanOutfit>(
        () => ({ shirt: shirtOf(l.harness), look: lookOf(l.agentId) }),
        [l.harness, l.agentId]
    );
    return (
        <Person
            sprite={l.at === "sofa" ? "back" : "cup"}
            outfit={outfit}
            phase={phase}
            left={art(l.x) * PLAN_CELL}
            bottom={art(l.bottom) * PLAN_CELL}
            lounger={l.agentId}
        />
    );
}

function Bubble({ mark, left, top, phase }: { mark: PlanMark; left: number; top: number; phase: OfficePhase }) {
    return (
        <img
            alt=""
            data-office-bubble={mark}
            src={markUrl(mark, phase)}
            className="pointer-events-none absolute z-[6] [image-rendering:pixelated]"
            style={{ left, top, width: 9 * PLAN_CELL, height: 9 * PLAN_CELL }}
        />
    );
}

// the Needs you notice board: its frame and cork are on the canvas (scenery.ts boardArt). This is its button (a click
// walks the boss there and opens its box), a paper slip pinned for each row that waits (three at most; the count says the
// rest), and over it the asking bubble with the count. Written spelled out, so Tailwind finds every class
const BOARD_PAPER: Record<OfficePhase, { pin: string; edge: string; line: string }> = {
    day: { pin: "bg-office-day-sofa", edge: "border-office-day-cap", line: "bg-office-day-cap" },
    after: { pin: "bg-office-after-sofa", edge: "border-office-after-cap", line: "bg-office-after-cap" },
};
// each slip's left and top on the cork, and its tilt in degrees
const BOARD_SLIPS: [number, number, number][] = [
    [4, 6, -4],
    [25, 4, 3],
    [46, 7, -2],
];
const BOARD_SLIP_W = 16;
const BOARD_SLIP_H = 22;

const NoticeBoard = memo(function NoticeBoard(p: {
    box: Box;
    rows: number;
    phase: OfficePhase;
    onPick: (key: string) => void;
}) {
    const { box: b, rows, phase, onPick } = p;
    const paper = BOARD_PAPER[phase];
    const { cork } = boardArt(b);
    const label = rows > 0 ? `Notice board, ${rows} waiting on you` : "Notice board";
    // the bubble stands over the frame, on the art grid like a desk's; the count sits on a plate beside it
    const bubbleLeft = (art(b.x) + 10) * PLAN_CELL;
    const bubbleTop = art(b.y) * PLAN_CELL;
    return (
        <>
            <button
                type="button"
                data-office-board=""
                title={rows > 0 ? `${label} (Enter reads it)` : label}
                aria-label={label}
                onClick={() => onPick(BOARD_KEY)}
                className="absolute z-[3] cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={box(b)}
            >
                {BOARD_SLIPS.slice(0, rows).map(([x, y, tilt], i) => (
                    <span
                        key={i}
                        data-office-board-slip=""
                        className={cn(
                            "pointer-events-none absolute box-border border bg-office-cup",
                            paper.edge,
                            phase === "after" && "opacity-80"
                        )}
                        style={{
                            left: cork.x * PLAN_CELL - b.x + x,
                            top: cork.y * PLAN_CELL - b.y + y,
                            width: BOARD_SLIP_W,
                            height: BOARD_SLIP_H,
                            transform: `rotate(${tilt}deg)`,
                        }}
                    >
                        <span
                            className={cn(
                                "absolute -top-[2px] left-[6px] box-border size-1 border border-office-ink",
                                paper.pin
                            )}
                        />
                        {[10, 7, 9].map((w, line) => (
                            <span
                                key={line}
                                className={cn("absolute left-[3px] h-[2px]", paper.line)}
                                style={{ top: 7 + line * 4, width: w }}
                            />
                        ))}
                    </span>
                ))}
            </button>
            {rows > 0 ? (
                <>
                    <Bubble mark="!" left={bubbleLeft} top={bubbleTop} phase={phase} />
                    <span
                        data-office-board-count=""
                        className="pointer-events-none absolute z-[6] rounded-[3px] bg-office-plate px-[5px] text-[11.5px] font-bold leading-[14px] tabular-nums text-asking"
                        style={{ left: bubbleLeft + 9 * PLAN_CELL + 3, top: bubbleTop + 3 }}
                    >
                        {rows}
                    </span>
                </>
            ) : null}
        </>
    );
}, sameValues);

// in work hours the floor is light, so a label sits on a plate; after hours it is dark enough without
const plate = (night: boolean) => (night ? "" : "rounded-[3px] bg-office-plate px-[5px]");

// a table's caption under it: the run's title and how many of its tasks are done (its zone's sub reads `run · 2 of 7 done`)
const captionOf = (zone: Room) => `${zone.title} · ${zone.sub.replace(/^run · /, "").replace(/ done$/, "")}`;
// where the lift's amber lines start, right of its call button, and the foot they stand over
const LIFT_LINE_DX = 98; // from the doors' left edge
const LIFT_LINE_H = 18;
const LIFT_LINES_UP_FOOT = 84; // the nearest line above the shown floor, over the hall's foot
const LIFT_LINES_DOWN_FOOT = 24; // the nearest line below it, the same

function Labels({
    plan,
    walking,
    night,
    phase,
    cursorId,
    onPick,
    onGrab,
}: {
    plan: Plan;
    walking: Set<string>;
    night: boolean;
    phase: OfficePhase;
    cursorId?: string;
    onPick: (key: string) => void;
    onGrab: (roomKey: string, e: ReactPointerEvent) => void;
}) {
    const mark = night ? undefined : "";
    const { doors, dial } = plan.lift;
    const foot = doors.y + doors.h;
    const lines = liftAskLines(plan.floors, plan.floor);
    const ups = lines.filter((l) => l.up);
    const downs = lines.filter((l) => !l.up);
    return (
        <>
            {plan.rooms
                .filter((r) => r.kind === "agents" || r.kind === "empty")
                .map((r) => (
                    <span
                        key={r.key}
                        className={cn(
                            "pointer-events-none absolute z-[6] flex flex-col items-start",
                            !night && "gap-[2px]"
                        )}
                        style={{ left: r.box.x + 14, top: r.box.y + 10 }}
                    >
                        <span
                            data-office-room-title={r.key}
                            data-office-plate={mark}
                            // a project room is moved by its title: a press and a drag (a click still walks the boss there)
                            title={r.kind === "agents" ? "Drag to move this room (g)" : undefined}
                            onPointerDown={r.kind === "agents" ? (e) => onGrab(r.key, e) : undefined}
                            className={cn(
                                "text-[13px] font-bold",
                                r.kind === "empty" ? TONE.muted : "text-primary",
                                r.kind === "agents" && "pointer-events-auto cursor-grab",
                                plate(night)
                            )}
                        >
                            {r.title}
                        </span>
                        <span
                            data-office-plate={mark}
                            className={cn(
                                "text-[11px]",
                                r.kind === "empty" ? TONE.muted : "text-secondary",
                                plate(night)
                            )}
                        >
                            {r.sub}
                        </span>
                    </span>
                ))}
            {plan.rooms
                .filter((r) => r.kind === "meeting")
                .map((z) => (
                    <span
                        key={z.key}
                        data-office-table-caption={z.key}
                        data-office-plate={mark}
                        className={cn(
                            "pointer-events-none absolute z-[6] max-w-[176px] truncate text-[11px] leading-[14px] text-muted",
                            plate(night)
                        )}
                        style={{ left: z.box.x + 12, top: z.box.y + 106 }}
                    >
                        {captionOf(z)}
                    </span>
                ))}
            {plan.rooms.map((r) =>
                r.chip ? (
                    <button
                        key={r.chip.key}
                        type="button"
                        data-office-chip={r.key}
                        title={`${r.chip.text} (Enter shows who they are)`}
                        aria-label={`${r.title}: ${r.chip.text}${r.chip.ask ? ", someone needs you" : ""}`}
                        onClick={() => onPick(r.chip!.key)}
                        // over the boss, who stands right under it (its spot is 22 px under the chip): the words stay readable
                        className={cn(
                            "absolute z-[8] box-border flex cursor-pointer items-center justify-center whitespace-nowrap rounded-[3px] border p-0 text-[11px] leading-[16px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            r.chip.ask
                                ? "border-asking bg-office-plate font-semibold text-asking"
                                : cn("border-transparent text-muted", plate(night)),
                            cursorId === r.chip.key && "ring-2 ring-secondary"
                        )}
                        style={box(r.chip.box)}
                    >
                        {r.chip.ask ? `! ${r.chip.text}` : r.chip.text}
                    </button>
                ) : null
            )}
            <span
                data-office-lift-label=""
                className="pointer-events-none absolute z-[6] -translate-x-1/2 whitespace-nowrap rounded-[3px] bg-office-plate px-[5px] text-[10px] font-extrabold leading-4 text-office-lamp"
                style={{ left: dial.x + dial.w / 2, top: dial.y - 18 }}
            >
                Floor {floorLabel(plan.floor)}
            </span>
            {[...ups, ...downs].map((l) => {
                const group = l.up ? ups : downs;
                // the nearest floor stands over the foot, the farther ones above it: the list reads top floor first
                const below = group.length - 1 - group.indexOf(l);
                const y = foot - (l.up ? LIFT_LINES_UP_FOOT : LIFT_LINES_DOWN_FOOT) - below * LIFT_LINE_H;
                return (
                    <span
                        key={l.floor}
                        data-office-lift-ask={l.floor}
                        className="pointer-events-none absolute z-[6] whitespace-nowrap rounded-[3px] bg-office-plate px-[5px] text-[10.5px] font-bold leading-4 text-asking"
                        style={{ left: doors.x + LIFT_LINE_DX, top: y }}
                    >
                        {l.text}
                    </span>
                );
            })}
            {plan.desks.map((d) => (
                <Fragment key={d.key}>
                    <span
                        data-office-plate={mark}
                        className={cn(
                            "pointer-events-none absolute z-[6] max-w-[116px] -translate-x-1/2 truncate text-center text-[11px] leading-[14px]",
                            TONE[d.tone],
                            plate(night)
                        )}
                        style={{ left: d.x + 40, top: d.y + 34 }}
                    >
                        {d.word ? `${d.name} · ${d.word}` : d.name}
                    </span>
                    {d.bubble && !walking.has(d.key) ? (
                        // left of the head: an asking person's arm is up on its right
                        <Bubble
                            mark={d.bubble}
                            left={(art(d.x) + 1) * PLAN_CELL}
                            top={(art(d.y) - 22) * PLAN_CELL}
                            phase={phase}
                        />
                    ) : null}
                </Fragment>
            ))}
            {plan.seats
                .filter((s) => s.bubble)
                .map((s) => (
                    // beside the head, clear of the table and the person's own face
                    <Bubble
                        key={s.key}
                        mark={s.bubble!}
                        left={(art(s.x - 3) + 11) * PLAN_CELL}
                        top={(art(s.bottom) - (s.pose === "back" ? 18 : 17) - 5) * PLAN_CELL}
                        phase={phase}
                    />
                ))}
            {plan.loungers
                .filter((l) => !walking.has(l.agentId))
                .map((l) => (
                    <span
                        key={l.agentId}
                        data-office-lounge-label={l.agentId}
                        data-office-plate={mark}
                        title={l.label}
                        className={cn(
                            "absolute z-[6] flex justify-center overflow-hidden whitespace-pre text-[11px] leading-[14px] text-muted",
                            plate(night)
                        )}
                        style={box(l.labelBox)}
                    >
                        <span className="min-w-0 truncate">{l.name}</span>
                        <span className="shrink-0">{` · ${l.age}`}</span>
                    </span>
                ))}
            {plan.loungeOverflow.length > 0 ? (
                <span
                    data-office-lounge-more
                    data-office-plate={mark}
                    className={cn(
                        "pointer-events-none absolute z-[6] truncate text-center text-[11px] leading-[14px] text-muted",
                        plate(night)
                    )}
                    style={box(plan.loungeMore)}
                >
                    +{plan.loungeOverflow.length} in the lounge
                </span>
            ) : null}
        </>
    );
}

// keeps an element where `transform` puts it, written on the DOM: after each render (its sprite may have changed
// size or side) and on each change of `on`, a walk step. React never writes the transform, so a step renders nothing
function useDomTransform(ref: RefObject<HTMLElement | null>, on: Atom<unknown>, transform: () => string | undefined) {
    const fn = useRef(transform);
    fn.current = transform;
    const place = useCallback(() => {
        const t = fn.current();
        if (ref.current && t != null) {
            ref.current.style.transform = t;
        }
    }, [ref]);
    useLayoutEffect(place);
    useLayoutEffect(() => globalStore.sub(on, place), [on, place]);
}

// a person on the move, its feet at the point `at` reads from `on`; on its own layer while it walks, so a step
// repaints nothing under it
function Mover(p: {
    on: Atom<unknown>;
    at: () => Point | undefined;
    sprite: PlanSprite;
    mirror: boolean;
    outfit: PlanOutfit;
    phase: OfficePhase;
    walking: boolean;
    boss?: boolean;
}) {
    const ref = useRef<HTMLImageElement>(null);
    const w = spriteWidth(p.sprite) * PLAN_CELL;
    const h = spriteH(p.sprite);
    // whole art cells on both axes: a person never sits between two pixels of the canvases
    useDomTransform(ref, p.on, () => {
        const at = p.at();
        return (
            at &&
            `translate(${Math.round((at.x - w / 2) / PLAN_CELL) * PLAN_CELL}px, ${Math.round((at.y - h) / PLAN_CELL) * PLAN_CELL}px)${p.mirror ? " scaleX(-1)" : ""}`
        );
    });
    return (
        <img
            ref={ref}
            alt=""
            draggable={false}
            data-office-boss={p.boss ? "" : undefined}
            data-office-sprite={p.sprite}
            src={planSpriteUrl(p.sprite, p.outfit, p.phase)}
            className={cn(
                "pointer-events-none absolute left-0 top-0 z-[7] [image-rendering:pixelated]",
                p.walking && "will-change-transform"
            )}
            style={{ width: w, height: h }}
        />
    );
}

const walkerAt = (id: string) => globalStore.get(walkersAtom).find((w) => w.id === id)?.at;
const bossAt = () => globalStore.get(bossAtom)?.at;

function WalkersView({ phase }: { phase: OfficePhase }) {
    const ws = useAtomValue(walkerLooksAtom);
    const frame = useAtomValue(walkFrameAtom);
    return (
        <>
            {ws.map((w) => (
                <Mover
                    key={w.id}
                    on={walkersAtom}
                    at={() => walkerAt(w.id)}
                    sprite={walkSprite(w.dir, frame)}
                    mirror={mirrorOf(w.dir)}
                    outfit={w.outfit}
                    phase={phase}
                    walking
                />
            ))}
        </>
    );
}

function BossView({ plan, phase }: { plan: Plan; phase: OfficePhase }) {
    const look = useAtomValue(bossLookAtom);
    const frame = useAtomValue(walkFrameAtom);
    const ringRef = useRef<HTMLImageElement>(null);
    useDomTransform(ringRef, bossAtom, () => {
        const at = bossAt();
        return (
            at &&
            `translate(${Math.round((at.x - 21) / PLAN_CELL) * PLAN_CELL}px, ${Math.round((at.y - 9) / PLAN_CELL) * PLAN_CELL}px)`
        );
    });
    if (!look) {
        return null;
    }
    // at a desk or a chip the boss shows its back, looking up at it; at the lift it faces the doors below it, so it stands
    // turned to you
    const at = look.moving || !look.rest ? undefined : deskAt(plan, look.rest);
    const sprite: PlanSprite = look.moving ? walkSprite(look.dir, frame) : at && at !== LIFT_KEY ? "boss" : "stand";
    return (
        <>
            <img
                ref={ringRef}
                alt=""
                data-office-ring=""
                src={markUrl("ring", phase)}
                className={cn(
                    "pointer-events-none absolute left-0 top-0 z-[7] [image-rendering:pixelated]",
                    look.moving && "will-change-transform"
                )}
                style={{ width: 14 * PLAN_CELL, height: 5 * PLAN_CELL }}
            />
            <Mover
                on={bossAtom}
                at={bossAt}
                sprite={sprite}
                mirror={look.moving && mirrorOf(look.dir)}
                outfit={BOSS_OUTFIT}
                phase={phase}
                walking={look.moving}
                boss
            />
        </>
    );
}

function PathDots() {
    const dots = useAtomValue(dotsAtom);
    if (dots.length === 0) {
        return null;
    }
    const end = dots[dots.length - 1];
    return (
        <>
            {dots.map((p, i) => (
                <span
                    key={i}
                    data-office-dot
                    className="pointer-events-none absolute left-0 top-0 z-[7] size-1.5 rounded-full bg-asking"
                    style={{
                        transform: `translate(${Math.round((p.x - 3) / PLAN_CELL) * PLAN_CELL}px, ${Math.round((p.y - 3) / PLAN_CELL) * PLAN_CELL}px)`,
                    }}
                />
            ))}
            <span
                data-office-dot-label
                className="pointer-events-none absolute z-[7] w-[120px] text-center text-[11px] font-semibold text-asking"
                style={{
                    left: Math.round((end.x - 60) / PLAN_CELL) * PLAN_CELL,
                    top: Math.round((end.y + 8) / PLAN_CELL) * PLAN_CELL,
                }}
            >
                next Needs you
            </span>
        </>
    );
}

// the lift's panel stands right of the doors' call button (the doors' right edge + 28, as the LiftPanel board has it) and
// 60 px over the hall's foot
const LIFT_PANEL_DX = 28;
const LIFT_PANEL_FOOT = 60;

// the dialog box of the desk at the boss, at the foot of the office's view, or at its head when the boss stands low in
// it; it shows only while the boss stands still at the cursor's desk, as the card does. The lift's panel is the one
// exception: it is drawn in the floor, beside the lift
function OfficeDialogLayer({
    plan,
    cursorId,
    dialogFor,
    scrollRef,
    rootRef,
    shownRef,
    onPick,
}: {
    plan: Plan;
    cursorId?: string;
    dialogFor: (key: string) => OfficeDialogVM | null;
    scrollRef: RefObject<HTMLDivElement | null>;
    rootRef: RefObject<HTMLDivElement | null>;
    shownRef: MutableRefObject<boolean>;
    onPick: (i: number) => void;
}) {
    const look = useAtomValue(bossLookAtom);
    const layer = useAtomValue(layerAtom);
    const rawSel = useAtomValue(selAtom);
    const at = cardAt(plan, look?.rest ? { at: look.rest, path: [] } : null, cursorId);
    const vm = layer === "dialog" && at && cursorId ? dialogFor(cursorId) : null;
    const sel = vm ? clampSel(vm.items, rawSel) : -1;
    probe.layer = layer;
    probe.dialog = vm ? vm.kind : "";
    probe.items = vm ? vm.items.map((i) => i.label) : [];
    probe.dims = vm ? vm.items.flatMap((it, i) => (it.dim ? [i] : [])) : [];
    probe.sel = sel;
    // the office can scroll under an open box (the wheel, the boss scrolled into view): read the edge again then
    const [, setScrolled] = useState(0);
    const shown = vm != null;
    useEffect(() => {
        const el = scrollRef.current;
        if (!shown || !el) {
            return;
        }
        const onScroll = () => setScrolled((n) => n + 1);
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, [shown, scrollRef]);
    const el = scrollRef.current;
    // the lift's panel is a steel plate beside its doors, on the floor, not a box on the view's edge
    const root = rootRef.current;
    if (vm?.kind === "lift") {
        probe.edge = "";
        shownRef.current = root != null;
        return root
            ? createPortal(
                  <div
                      data-office-lift-panel=""
                      className="pointer-events-none absolute z-[8]"
                      style={{
                          left: plan.lift.doors.x + plan.lift.doors.w + LIFT_PANEL_DX,
                          bottom: plan.height - (plan.lift.doors.y + plan.lift.doors.h) + LIFT_PANEL_FOOT,
                      }}
                  >
                      <OfficeDialogBox vm={vm} sel={sel} onPick={onPick} />
                  </div>,
                  root
              )
            : null;
    }
    // the boss's feet in px from the view's top; at a desk it stands as the "boss" sprite, spriteH("boss") tall
    const foot = look?.rest && el ? (root?.offsetTop ?? 0) + look.rest.y - el.scrollTop : undefined;
    const edge = vm && el && foot != null ? dialogEdge(foot - spriteH("boss"), foot, el.clientHeight) : undefined;
    probe.edge = edge ?? "";
    shownRef.current = vm != null && edge != null;
    if (!vm || !edge) {
        return null;
    }
    return (
        <div
            data-office-dialog-edge={edge}
            className="pointer-events-none absolute inset-x-3 z-[9] mx-auto max-w-[1180px]"
            style={edge === "top" ? { top: HUD_SPACE_PX } : { bottom: DIALOG_FOOT_PX }}
        >
            <OfficeDialogBox vm={vm} sel={sel} onPick={onPick} />
        </div>
    );
}

// the office menu (m), under the HUD bar's right end
function OfficeMenuLayer({ items, onPick }: { items: OfficeMenuItem[]; onPick: (i: number) => void }) {
    const open = useAtomValue(officeMenuOpenAtom);
    const sel = useAtomValue(menuSelAtom);
    probe.menu = open;
    probe.menuItems = open ? items.map((i) => i.label) : [];
    probe.menuSel = open ? sel : -1;
    if (!open) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute right-3 z-[10]" style={{ top: HUD_SPACE_PX }}>
            <OfficeMenuBox items={items} sel={sel} onPick={onPick} />
        </div>
    );
}

// the lift's doors are on the canvas (scenery.ts): this is their button, a click walks the boss to them and opens the
// lift's panel there, as a click on the notice board opens its box
function LiftDoors({ doors, onPick }: { doors: Box; onPick: (key: string) => void }) {
    return (
        <button
            type="button"
            data-office-lift=""
            title="Lift (Enter at the doors)"
            aria-label="Lift: ride to another floor"
            onClick={() => onPick(LIFT_KEY)}
            className="absolute z-[3] cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={box(doors)}
        />
    );
}

const EASE_FLUID = `cubic-bezier(${MOTION.easeFluid.join(", ")})`;

// a ride (Ride board): two steel doors over the whole office, closing from the sides and opening again, and a dial over
// them that reads the floor. The doors start open on mount and close a beat later, so the transition has somewhere to
// come from
function RideDoors({ phase }: { phase: OfficePhase }) {
    const ride = useAtomValue(rideAtom);
    const on = ride != null;
    const [armed, setArmed] = useState(false);
    useEffect(() => {
        if (!on) {
            setArmed(false);
            return;
        }
        const t = window.setTimeout(() => setArmed(true), 30);
        return () => window.clearTimeout(t);
    }, [on]);
    if (!ride) {
        return null;
    }
    const shut = ride.closed && armed;
    const steel =
        phase === "after"
            ? "border-office-after-ink bg-office-after-metal"
            : "border-office-day-ink bg-office-day-metal";
    const door = (side: "left" | "right") => (
        <div
            data-office-ride-door={side}
            className={cn(
                "absolute inset-y-0 box-border w-1/2 border-2",
                steel,
                side === "left" ? "left-0" : "right-0"
            )}
            style={{
                transform: shut ? "translateX(0)" : `translateX(${side === "left" ? "-100%" : "100%"})`,
                transition: `transform ${ride.ms}ms ${EASE_FLUID}`,
            }}
        />
    );
    return (
        <div
            data-office-ride=""
            data-office-ride-shut={shut ? "" : undefined}
            className="pointer-events-auto absolute inset-0 z-[12] overflow-hidden"
        >
            {door("left")}
            {door("right")}
            <div
                className={cn(
                    "absolute left-1/2 top-4 box-border flex h-10 min-w-[150px] -translate-x-1/2 items-center justify-center gap-1.5 rounded-t-[26px] border-2 px-6 text-[13px] font-extrabold text-office-lamp",
                    phase === "after"
                        ? "border-office-after-ink bg-office-after-screen"
                        : "border-office-day-ink bg-office-day-screen"
                )}
            >
                <span data-office-ride-arrow="">{ride.arrow}</span>
                <span data-office-ride-label="">Floor {ride.label}</span>
            </div>
        </div>
    );
}

function OfficePopup({
    plan,
    cursorId,
    renderCard,
    boardRows,
    onTalk,
}: {
    plan: Plan;
    cursorId?: string;
    renderCard: (key: string, opts?: { adjust?: boolean }) => ReactNode;
    boardRows: number;
    onTalk: () => void;
}) {
    // the boss's look, not its spot: a walk step does not re-render the card
    const look = useAtomValue(bossLookAtom);
    const layer = useAtomValue(layerAtom);
    const adjust = useAtomValue(cardAdjustAtom);
    const open = layer === "card";
    const [big, setBig] = useAtom(officeBigCardAtom);
    const boxRef = useRef<HTMLDivElement>(null);
    const chipCard = useAtomValue(chipCardAtom);
    const found = cardAt(plan, look?.rest ? { at: look.rest, path: [] } : null, cursorId);
    // the notice board, the lift and a room's chip have no card and no "↵ Talk" prompt: their dialog boxes are
    // OfficeDialogLayer's. A chip's dialog opens the card of one of the agents or runs it lists, beside the chip
    const at = found?.board || found?.lift || found?.chip ? undefined : found;
    const chip = open && found?.chip && chipCard ? found : undefined;
    const card =
        at != null && cursorId != null
            ? renderCard(cursorId, { adjust })
            : chip && chipCard
              ? renderCard(chipCard.id, { adjust })
              : null;
    const kind = at ? (at.desk ? "agent" : "run") : (chipCard?.kind ?? "run");
    // the board offers "↵ Read" while the boss stands still at it and rows wait
    const readBoard = found?.board === true && boardRows > 0 && layer === "walk";
    probe.popup = card && open ? kind : "";
    // the ↵ prompt shows only while walking: the dialog box hides it
    probe.prompt = readBoard ? "board" : at && card && layer === "walk" ? kind : "";
    probe.big = !!card && open && big;
    const shown = card != null && open;
    // a card grown past the office's view scrolls into it
    useEffect(() => {
        if (shown && big) {
            boxRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
    }, [shown, big, cursorId]);
    if (readBoard && look?.rest) {
        // over the boss's head, as at a desk
        return (
            <OfficePrompt
                kind="board"
                over={{ x: look.rest.x, y: look.rest.y - spriteH("boss") - 4 }}
                verb="Read"
                onTalk={onTalk}
            />
        );
    }
    if (!card || (!at && !chip) || layer === "dialog" || layer === "carry") {
        return null;
    }
    if (!open) {
        if (!at) {
            return null;
        }
        // like a game's "press E": over the person's head, clear of their bubble
        const over = at.desk
            ? { x: at.desk.x + 40, y: at.desk.y - 50 }
            : { x: at.seat!.x + 18, y: at.seat!.bottom - 62 };
        return (
            <OfficePrompt
                kind={kind}
                over={over}
                verb={at.desk?.light === "asking" ? "Answer" : "Talk"}
                onTalk={onTalk}
            />
        );
    }
    const cb = chip?.room?.chip?.box;
    const anchor = at
        ? at.desk
            ? { x: at.desk.x, y: at.desk.y }
            : { x: at.seat!.x, y: at.seat!.bottom - 40 }
        : { x: cb!.x, y: cb!.y + 40 };
    // beside the desk (or the chip), over the hall; the card fills the box's height and scrolls, as in its grid column
    const { box, right, pointerTop } = popupBox(plan, anchor, (at ?? chip)!.room!, big);
    return (
        <div
            ref={boxRef}
            data-office-popup={kind}
            data-office-popup-big={big ? "" : undefined}
            className="absolute z-[8] flex flex-col rounded-md border border-edge-mid bg-surface-raised shadow-popover"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        >
            <span
                className={cn(
                    "absolute size-2.5 rotate-45 border-edge-mid bg-surface-raised",
                    right ? "-left-[6px] border-b border-l" : "-right-[6px] border-r border-t"
                )}
                style={{ top: pointerTop }}
            />
            {card}
            {/* on the corner away from the pointer, clear of the card's own header buttons */}
            <button
                type="button"
                data-office-popup-size
                onClick={() => setBig(!big)}
                title={big ? "Smaller card (F)" : "Bigger card (F)"}
                aria-label={big ? "Smaller card" : "Bigger card"}
                className={cn(
                    "absolute -top-3 z-[1] flex size-6 cursor-pointer items-center justify-center rounded-full border border-edge-mid bg-surface-raised text-secondary shadow-popover hover:border-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    right ? "-right-3" : "-left-3"
                )}
            >
                {big ? <Minimize2 size={12} aria-hidden /> : <Maximize2 size={12} aria-hidden />}
            </button>
        </div>
    );
}

const CARRY_CARD_W = 300;
const CARRY_CARD_GAP = 16; // the pointer's card stands this far from it

// A room carried (Drag board): the slot it came from dimmed with a dashed edge, the slot its target is on grey with a
// dashed edge (selection in grey, never the accent), the card of what a drop does there, and the lift's panel open as the
// map of the floors. By keyboard the card sits in the target slot (on the lounge for a new floor); by pointer it follows
// the pointer.
function CarryLayer({ plan }: { plan: Plan }) {
    const carry = useAtomValue(officeCarryAtom);
    const pointer = useAtomValue(carryPointerAtom);
    if (!carry) {
        return null;
    }
    const slotRoom = (slot: number) =>
        plan.rooms.find((r) => (r.kind === "agents" || r.kind === "empty") && r.slot === slot);
    const t = carry.target;
    const origin = carry.from.floor === plan.floor ? slotRoom(carry.from.slot) : undefined;
    const targetRoom = t != null && t !== "new" && t.floor === plan.floor ? slotRoom(t.slot) : undefined;
    const { over, other } = carryOver(t, carry.from, plan.floor, plan.rooms, carry.project);
    const words = carryWords({
        project: carry.project,
        by: carry.by,
        over,
        other,
        floor: t != null && t !== "new" ? (t.floor === 0 ? "Ground" : `Floor ${floorLabel(t.floor)}`) : undefined,
        counts: plan.rooms.find((r) => r.key === `room:${carry.project}`)?.sub,
    });
    const map = liftDialog(plan.floors, plan.floor, { project: carry.project });
    const sel =
        t == null ? -1 : map.items.findIndex((it) => it.id === (t === "new" ? "floor:new" : `floor:${t.floor}`));
    const wide = Math.min(CARRY_CARD_W, plan.width - 8);
    // where the card stands: following the pointer; else in the target slot; else on the lounge
    const card: Box =
        carry.by === "pointer" && pointer
            ? {
                  x: Math.max(4, Math.min(plan.width - wide - 4, pointer.x + CARRY_CARD_GAP)),
                  y: Math.max(4, Math.min(plan.height - 120, pointer.y + CARRY_CARD_GAP)),
                  w: wide,
                  h: 0,
              }
            : targetRoom
              ? {
                    x: targetRoom.box.x + Math.max(8, (targetRoom.box.w - CARRY_CARD_W) / 2),
                    y: targetRoom.box.y + 110,
                    w: Math.min(CARRY_CARD_W, targetRoom.box.w - 16),
                    h: 0,
                }
              : { x: plan.hall.x + 8, y: plan.lounge.y + 12, w: plan.hall.w - 16, h: 0 };
    const doors = plan.lift.doors;
    return (
        <>
            {origin ? (
                <div
                    data-office-carry-origin={origin.key}
                    className="pointer-events-none absolute z-[5] box-border border-[3px] border-dashed border-ink-mid bg-background/45"
                    style={box(origin.box)}
                />
            ) : null}
            {targetRoom ? (
                <div
                    data-office-carry-target={targetRoom.key}
                    className="pointer-events-none absolute z-[5] box-border border-[3px] border-dashed border-ink-hi bg-ink-hi/10"
                    style={box(targetRoom.box)}
                />
            ) : null}
            <div
                data-office-lift-panel=""
                data-office-carry-panel=""
                className="pointer-events-none absolute z-[8]"
                style={{
                    left: doors.x + doors.w + LIFT_PANEL_DX,
                    bottom: plan.height - (doors.y + doors.h) + LIFT_PANEL_FOOT,
                }}
            >
                <OfficeDialogBox
                    vm={{
                        kind: "lift",
                        label: map.title,
                        plate: null,
                        body: null,
                        items: map.items,
                        run: () => undefined,
                    }}
                    sel={sel}
                    onPick={() => undefined}
                />
            </div>
            <div
                data-office-carry-card={carry.by}
                data-office-carry-over={over}
                className="pointer-events-none absolute z-[9] box-border flex flex-col gap-1 rounded-md border border-edge-mid bg-surface-raised px-3 py-2.5 shadow-popover"
                style={{ left: card.x, top: card.y, width: card.w }}
            >
                <span data-office-carry-head="" className="truncate text-[12.5px] font-bold text-primary">
                    {words.head}
                </span>
                {words.sub ? <span className="truncate text-[11px] text-muted">{words.sub}</span> : null}
                <span data-office-carry-line="" className="text-[11px] text-secondary">
                    {words.line}
                </span>
                {words.keys ? <span className="text-[10.5px] text-ink-faint">{words.keys}</span> : null}
            </div>
        </>
    );
}

// the ↵ over the desk the boss stands at; it bobs on the frame clock, so it holds still when the office does
function OfficePrompt({
    kind,
    over,
    verb,
    onTalk,
}: {
    kind: "agent" | "run" | "board";
    over: Point;
    verb: string;
    onTalk: () => void;
}) {
    const tick = useAtomValue(officeTickAtom);
    return (
        <button
            type="button"
            data-office-prompt={kind}
            onClick={onTalk}
            className="absolute z-[8] flex -translate-x-1/2 -translate-y-full cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-edge-mid bg-surface-raised py-0.5 pl-0.5 pr-2 text-[11.5px] text-primary shadow-popover hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ left: over.x, top: over.y - (tick % 2) * 2 }}
        >
            <kbd className="rounded border border-edge-mid bg-surface-code px-1 font-mono text-[10.5px] text-secondary">
                ↵
            </kbd>
            {verb}
        </button>
    );
}

// DEV (the Cast board): every look's poses, then the boss's, in the board's cells (22 x 30 art px) on the phase's wood
// so the outlines read as they will in the office
const SHEET_CW = 22;
const SHEET_CH = 30;
const SHEET_COL_LABELS = [
    "sit",
    "nod",
    "hand",
    "hand, 2",
    "cheer",
    "cheer, 2",
    "doze",
    "yawn",
    "stretch",
    "sofa",
    "near seat",
    "cup",
    "walk ↓",
    "walk ↓ 2",
    "walk ↑",
    "walk ↑ 2",
    "walk →",
    "walk → 2",
];
const SHEET_BOSS_LABELS = ["standing", "at a desk", "walk ↓", "walk ↓ 2", "walk ↑", "walk ↑ 2", "walk →", "walk → 2"];
const SHEET_ROW_LABELS = ["look 1 · claude", "look 2 · codex", "look 3 · pi", "look 4 · agy", "the boss · cap"];

function PoseSheet({ phase }: { phase: OfficePhase }) {
    const cellW = SHEET_CW * PLAN_CELL;
    const cellH = SHEET_CH * PLAN_CELL;
    const sprite = (s: PlanSprite, outfit: PlanOutfit, c: number, r: number, key: string) => (
        <img
            key={key}
            alt=""
            src={planSpriteUrl(s, outfit, phase)}
            className="absolute [image-rendering:pixelated]"
            style={{
                left: (c * SHEET_CW + 4 + spriteLeft(s)) * PLAN_CELL,
                top: r * cellH + (SHEET_CH - 3 - PLAN_SPRITES[s].length) * PLAN_CELL,
                width: spriteWidth(s) * PLAN_CELL,
                height: spriteH(s),
            }}
        />
    );
    const colLabel = (text: string, i: number, attr: string) => (
        <span
            key={i}
            {...{ [attr]: "" }}
            className="absolute text-center text-[10.5px] text-muted"
            style={{ left: i * cellW, width: cellW }}
        >
            {text}
        </span>
    );
    const sheetH = (SHEET_SHIRTS.length + 1) * cellH;
    return (
        <div
            data-office-sheet
            className={cn(
                "absolute left-2 top-2 z-[9] flex gap-3 rounded-md border border-edge-mid p-3",
                phase === "after" ? "bg-office-after-wood" : "bg-office-day-wood"
            )}
        >
            <div className="relative w-[110px] shrink-0" style={{ height: sheetH }}>
                {SHEET_ROW_LABELS.map((l, r) => (
                    <span
                        key={l}
                        className="absolute left-0 whitespace-nowrap text-[11px] text-secondary"
                        style={{ top: 16 + r * cellH + 52 }}
                    >
                        {l}
                    </span>
                ))}
            </div>
            <div className="relative shrink-0" style={{ width: SHEET_POSES.length * cellW }}>
                <div className="relative h-4">
                    {SHEET_COL_LABELS.map((l, i) => colLabel(l, i, "data-office-sheet-col"))}
                </div>
                <div data-office-sheet-area className="relative" style={{ height: sheetH }}>
                    {SHEET_SHIRTS.map((shirt, r) =>
                        SHEET_POSES.map((s, c) => sprite(s, { shirt, look: r + 1 }, c, r, `${shirt}-${s}`))
                    )}
                    {BOSS_POSES.map((s, c) => sprite(s, BOSS_OUTFIT, c, SHEET_SHIRTS.length, `boss-${s}`))}
                </div>
                <div className="relative mt-1 h-4">
                    {SHEET_BOSS_LABELS.map((l, i) => colLabel(l, i, "data-office-sheet-boss"))}
                </div>
            </div>
        </div>
    );
}
