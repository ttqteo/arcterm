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
import { art, rasterise, scenery, sceneryKey, type Op } from "@/app/view/office/scenery";
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
    type RefObject,
} from "react";
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
import {
    advance,
    BOSS_SPEED,
    bossLook,
    canWalk,
    cardAt,
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
import { clampSel, enabledOf, selAfterActivate, type DeskKind } from "./officedialogmodel";
import {
    buildPlan,
    peopleDrawn,
    popupBox,
    type Box,
    type Desk,
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
    officeHoursAtom,
    officeMenuOpenAtom,
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
    order(): string[];
    asks(): string[];
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
// the 5-hour window's use, rounded; FiveHourLeaf sets it, so the 1 s clock the meter reads re-renders that leaf only
const officeFiveHourAtom = atom<number | undefined>(undefined) as PrimitiveAtom<number | undefined>;

const BOSS_OUTFIT: PlanOutfit = { shirt: BOSS_SHIRT, look: 1, boss: true };
const WALK_FRAME_MS = 180;
const ARROW_STEP_PX = 24; // one arrow press when people do not walk (reduced motion, animation off)
const PATH_HINT_MS = 1000;

// what the probe reads, kept up to date as the office draws
const probe = {
    desks: 0,
    seats: 0,
    rooms: 0,
    dark: [] as string[],
    night: false,
    lamps: 0,
    cups: 0,
    walking: 0,
    loungeMore: 0,
    sceneryDraws: 0,
    phase: "day" as OfficePhase,
    popup: "" as "" | "agent" | "run",
    prompt: "" as "" | "agent" | "run",
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
};
let lastPlan: Plan | null = null;
let lastWalking: ReadonlySet<string> = new Set();

/** What the office drew, for the DEV probe (cockpitofficedevhooks.ts). */
export function readOfficeProbe() {
    const b = globalStore.get(bossAtom);
    return {
        ...probe,
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
    const plan = useMemo(
        () => buildPlan({ agents, runs, width, height, now, away: planAway, night }),
        [agents, runs, width, height, now, planAway, night]
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

    // the boss has stopped: the desk it stands at becomes the Cockpit's cursor
    const afterStop = () => {
        const b = globalStore.get(bossAtom);
        if (!b) {
            return;
        }
        const key = deskAt(planRef.current, b.at);
        if (key) {
            globalStore.set(bossAtom, { ...b, dir: "up" });
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
        const b = globalStore.get(bossAtom);
        const spot = spotOf(planRef.current, key);
        if (!b || !spot) {
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
        const b = globalStore.get(bossAtom);
        const spot = spotOf(planRef.current, key);
        if (!b || !spot) {
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
        if (!b) {
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
        if (!b || !canWalk(planRef.current, at)) {
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
    const dialogRef = useRef(props.dialogFor);
    dialogRef.current = props.dialogFor;
    const onMenuRef = useRef(props.onMenu);
    onMenuRef.current = props.onMenu;
    const menuItems = officeMenuItems(plan.asks.length, props.newEvents, props.eventsOpen, 0);
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
                const all = menuItemsRef.current.map(() => true);
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
            const open = !globalStore.get(officeMenuOpenAtom);
            if (open) {
                globalStore.set(menuSelAtom, 0);
            }
            globalStore.set(officeMenuOpenAtom, open);
        },
        order: () => planRef.current.order,
        asks: () => planRef.current.asks,
    };

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
        const b = globalStore.get(bossAtom);
        if (b && (b.path.length > 1 || b.holding)) {
            globalStore.set(bossAtom, { ...b, at: b.path[b.path.length - 1] ?? b.at, path: [], holding: undefined });
        }
        const ws = globalStore.get(walkersAtom);
        if (ws.length > 0) {
            globalStore.set(walkersAtom, []);
            globalStore.set(walkingAtom, {});
            setSettled((s) => ws.reduce((acc, w) => (w.loop ? acc : withAway(acc, w.id, w.to)), s));
        }
    }, [moving]);

    useEffect(
        () => () => {
            window.clearTimeout(hintTimer.current);
            globalStore.set(bossAtom, null);
            globalStore.set(walkersAtom, []);
            globalStore.set(walkingAtom, {});
            globalStore.set(dotsAtom, []);
            globalStore.set(layerAtom, "walk");
            globalStore.set(selAtom, 0);
            globalStore.set(officeMenuOpenAtom, false);
            globalStore.set(menuSelAtom, 0);
            globalStore.set(cardAdjustAtom, false);
            globalStore.set(officeMeterAtom, null);
            globalStore.set(officeFiveHourAtom, undefined);
            setOfficeRoot(null);
            lastPlan = null;
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
    const cheerTimers = useRef<number[]>([]);
    const [cheering, setCheering] = useState<ReadonlySet<string>>(() => new Set());
    useEffect(() => {
        const done = new Set(plan.desks.filter((d) => d.word === "done").map((d) => d.key));
        const was = doneWas.current;
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
        lastWalking = walkingIds;
        const people = peopleDrawn(plan, walkingIds, true);
        const prev = globalStore.get(officeMeterAtom);
        if (prev?.people !== people || prev.walking !== walkingIds.size || prev.animated !== animated) {
            globalStore.set(officeMeterAtom, { people, walking: walkingIds.size, animated });
        }
        Object.assign(probe, {
            desks: plan.desks.length,
            seats: plan.seats.length,
            rooms: plan.rooms.length,
            dark: plan.rooms.filter((r) => !r.lit).map((r) => r.key),
            night,
            phase,
            lamps: night ? plan.desks.filter((d) => d.light !== "off").length : 0,
            cups: energy === "tired" ? plan.desks.filter((d) => d.light === "working").length : 0,
            walking: walkingIds.size,
            loungeMore: plan.loungeOverflow.length,
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
                            const room = plan.rooms.find((r) => r.key === s.room);
                            return (
                                <SeatView
                                    key={s.key}
                                    s={s}
                                    phase={phase}
                                    lit={room?.lit ?? true}
                                    near={room?.table != null && s.bottom > room.table.y + 20}
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
                        <Labels plan={plan} walking={walkingIds} night={night} phase={phase} />
                        <WalkersView phase={phase} />
                        <BossView plan={plan} phase={phase} />
                        <PathDots />
                        <OfficePopup
                            plan={plan}
                            cursorId={cursorId}
                            renderCard={renderCard}
                            onTalk={() => handleRef.current?.talk()}
                        />
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

// in work hours the floor is light, so a label sits on a plate; after hours it is dark enough without
const plate = (night: boolean) => (night ? "" : "rounded-[3px] bg-office-plate px-[5px]");

function Labels({
    plan,
    walking,
    night,
    phase,
}: {
    plan: Plan;
    walking: Set<string>;
    night: boolean;
    phase: OfficePhase;
}) {
    const mark = night ? undefined : "";
    return (
        <>
            {plan.rooms
                .filter((r) => r.kind !== "lounge")
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
                            data-office-plate={mark}
                            className={cn("text-[13px] font-bold text-primary", plate(night))}
                        >
                            {r.title}
                        </span>
                        <span data-office-plate={mark} className={cn("text-[11px] text-secondary", plate(night))}>
                            {r.sub}
                        </span>
                    </span>
                ))}
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
    const sprite: PlanSprite = look.moving
        ? walkSprite(look.dir, frame)
        : look.rest && deskAt(plan, look.rest)
          ? "boss"
          : "stand";
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

// the dialog box of the desk at the boss, at the foot of the office's view, or at its head when the boss stands low in
// it; it shows only while the boss stands still at the cursor's desk, as the card does
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
    // the boss's feet in px from the view's top; at a desk it stands as the "boss" sprite, spriteH("boss") tall
    const foot = look?.rest && el ? (rootRef.current?.offsetTop ?? 0) + look.rest.y - el.scrollTop : undefined;
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

function OfficePopup({
    plan,
    cursorId,
    renderCard,
    onTalk,
}: {
    plan: Plan;
    cursorId?: string;
    renderCard: (key: string, opts?: { adjust?: boolean }) => ReactNode;
    onTalk: () => void;
}) {
    // the boss's look, not its spot: a walk step does not re-render the card
    const look = useAtomValue(bossLookAtom);
    const layer = useAtomValue(layerAtom);
    const adjust = useAtomValue(cardAdjustAtom);
    const open = layer === "card";
    const [big, setBig] = useAtom(officeBigCardAtom);
    const boxRef = useRef<HTMLDivElement>(null);
    const found = cardAt(plan, look?.rest ? { at: look.rest, path: [] } : null, cursorId);
    // the notice board has no card and no "↵ Talk" prompt: its dialog box is OfficeDialogLayer's
    const at = found?.board ? undefined : found;
    const card = at != null && cursorId != null ? renderCard(cursorId, { adjust }) : null;
    const kind = at?.desk ? "agent" : "run";
    probe.popup = card && open ? kind : "";
    // the ↵ prompt shows only while walking: the dialog box hides it
    probe.prompt = card && layer === "walk" ? kind : "";
    probe.big = !!card && open && big;
    const shown = card != null && open;
    // a card grown past the office's view scrolls into it
    useEffect(() => {
        if (shown && big) {
            boxRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
    }, [shown, big, cursorId]);
    if (!card || !at || layer === "dialog") {
        return null;
    }
    if (!open) {
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
    const anchor = at.desk ? { x: at.desk.x, y: at.desk.y } : { x: at.seat!.x, y: at.seat!.bottom - 40 };
    // beside the desk, over the hall; the card fills the box's height and scrolls, as in its grid column
    const { box, right, pointerTop } = popupBox(plan, anchor, at.room, big);
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

// the ↵ over the desk the boss stands at; it bobs on the frame clock, so it holds still when the office does
function OfficePrompt({
    kind,
    over,
    verb,
    onTalk,
}: {
    kind: "agent" | "run";
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
