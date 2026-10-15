// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office (docs/superpowers/specs/2026-10-15-cockpit-office-design.md): the Cockpit's cards drawn as a
// floor plan seen from above, the boss you walk around, and the card of the desk you stand at. Thin by design: the
// plan is officeplanmodel.ts, who goes where officebehavior.ts, how the boss moves officeboss.ts, the pixels
// plansprite.ts, the clocks officeclock.ts. This file owns the DOM, the walk state and the popup.
//
// Cost is the point of most choices (the spec's Benchmark): a person is one <img> from a cache; a desk's top and face
// are pseudo-elements; the boss, the walkers and the path dots are small components on their own atoms, so a walk
// step re-renders only them; only animated people read the frame clock; no clock runs while nothing moves.

import { globalStore } from "@/app/store/jotaiStore";
import {
    officeClocks,
    officeMeterAtom,
    officeTickAtom,
    setOfficeRoot,
    useFrameClock,
    useWalkLoop,
} from "@/app/view/office/officeclock";
import {
    BOSS_SHIRT,
    LANE_SHIRTS,
    LEAD_SHIRT,
    mirrorOf,
    PLAN_CELL,
    PLAN_SPRITES,
    PLAN_TOKENS,
    planSpriteUrl,
    seatSprite,
    shirtOf,
    spriteWidth,
    walkSprite,
    type PlanOutfit,
    type PlanSprite,
    type SeatPose,
} from "@/app/view/office/plansprite";
import { spriteCacheStats, tokenRgb } from "@/app/view/office/spritecache";
import { cn } from "@/util/util";
import { atom, useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { Maximize2, Minimize2, Moon, Sun, Zap } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
    Fragment,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type MutableRefObject,
    type ReactNode,
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
    type Dir,
} from "./officeboss";
import {
    buildPlan,
    HWALL,
    peopleDrawn,
    popupBox,
    WALL,
    type Box,
    type Desk,
    type Lounger,
    type Plan,
    type PlanAgent,
    type PlanRun,
    type Point,
    type Room,
    type RoomKind,
    type Seat,
    type Tone,
} from "./officeplanmodel";
import { officeAnimation, officeAnimationAtom, officeBigCardAtom, officeHoursAtom } from "./officestore";
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
    dismiss(): void;
    /** Opens the card the ↵ over the boss's desk offers; false when none is offered. */
    openCard(): boolean;
    /** Grows or shrinks the open card (an offered one opens big); false when there is no card. */
    toggleBig(): boolean;
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
    renderCard: (key: string) => ReactNode;
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
const dotsAtom = atom<Point[]>([]) as PrimitiveAtom<Point[]>;
// the card beside the boss's desk: a click on a desk opens it, ↵ or Enter does at a desk the boss walked to, and any
// move or Esc shuts it
const cardOpenAtom = atom(false) as PrimitiveAtom<boolean>;
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
    popup: "" as "" | "agent" | "run",
    prompt: "" as "" | "agent" | "run",
    big: false,
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
        unresolved: PLAN_TOKENS.filter((t) => tokenRgb(t) == null),
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

// the floors' materials: planks in the agents' rooms and Home, tiles in meeting rooms, carpet in the lounge
const WOOD: CSSProperties = {
    background:
        "repeating-linear-gradient(90deg, var(--color-office-wood-1) 0 15px, var(--color-office-wood-2) 15px 16px)",
};
const FLOOR: Record<RoomKind, CSSProperties> = {
    agents: WOOD,
    home: WOOD,
    meeting: {
        background:
            "repeating-conic-gradient(var(--color-office-tile-1) 0 25%, var(--color-office-tile-2) 0 50%) 0 0 / 24px 24px",
    },
    lounge: { background: "var(--color-office-carpet)" },
};
const BRICK: CSSProperties = {
    backgroundColor: "var(--color-office-brick)",
    backgroundImage: "repeating-linear-gradient(0deg, transparent 0 9px, var(--color-office-mortar) 9px 11px)",
};
const TONE: Record<Tone, string> = {
    plain: "text-muted",
    asking: "font-semibold text-asking",
    done: "font-semibold text-success",
    muted: "text-ink-faint",
};
const SCREEN: Record<string, string> = {
    done: "bg-success/45",
    work: "bg-working",
    wait: "bg-edge-mid",
    fail: "bg-error",
};
const BUBBLE: Record<string, string> = {
    "!": "bg-asking text-on-warning",
    "?": "bg-asking text-on-warning",
    "×": "bg-error text-background",
};

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
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        // the content box: the scroller's 20 px gutters each side
        const measure = () => setWidth(el.clientWidth - 40);
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
        () => buildPlan({ agents, runs, width, now, away: planAway, night }),
        [agents, runs, width, now, planAway, night]
    );
    lastPlan = plan;

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
        globalStore.set(cardOpenAtom, false);
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
        globalStore.set(cardOpenAtom, false);
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
        globalStore.set(cardOpenAtom, false);
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
    handleRef.current = {
        walk,
        release,
        goTo,
        showPath,
        dismiss: () => globalStore.set(cardOpenAtom, false),
        openCard: () => {
            const key = cursorRef.current;
            const at = cardAt(planRef.current, globalStore.get(bossAtom), key);
            if (globalStore.get(cardOpenAtom) || !at || !key || renderCard(key) == null) {
                return false;
            }
            globalStore.set(cardOpenAtom, true);
            return true;
        },
        toggleBig: () => {
            if (globalStore.get(cardOpenAtom)) {
                globalStore.set(officeBigCardAtom, !globalStore.get(officeBigCardAtom));
                return true;
            }
            if (!handleRef.current?.openCard()) {
                return false;
            }
            globalStore.set(officeBigCardAtom, true);
            return true;
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
        globalStore.set(cardOpenAtom, true);
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
            globalStore.set(cardOpenAtom, false);
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
            lamps: night ? plan.desks.filter((d) => d.light !== "off").length : 0,
            cups: energy === "tired" ? plan.desks.filter((d) => d.light === "working").length : 0,
            walking: walkingIds.size,
            loungeMore: plan.loungeOverflow.length,
        });
    });

    return (
        <div ref={scrollRef} data-cockpit-office className="min-h-0 flex-1 overflow-auto px-5 pb-3 pt-2.5">
            <FiveHourLeaf model={props.model} />
            <OfficeHeading now={now} night={night} pct={pct} />
            {width > 0 ? (
                <div
                    ref={rootRef}
                    data-office-root
                    className="relative isolate mt-2"
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
                    <Building plan={plan} night={night} />
                    {plan.desks.map((d) => (
                        <DeskView
                            key={d.key}
                            d={d}
                            hidePerson={walkingIds.has(d.key)}
                            energy={energy}
                            stretching={stretching}
                            cheering={cheering.has(d.key)}
                            onPick={onPick}
                        />
                    ))}
                    {plan.rooms.map((r) => (r.table ? <Table key={r.key} room={r} onPick={onPick} /> : null))}
                    {plan.seats.map((s) => (
                        <SeatView key={s.key} s={s} onPick={onPick} />
                    ))}
                    {plan.loungers
                        .filter((l) => !walkingIds.has(l.agentId))
                        .map((l) => (
                            <LoungerView key={l.agentId} l={l} />
                        ))}
                    <Shades plan={plan} night={night} />
                    <Walls plan={plan} night={night} />
                    <Labels plan={plan} walking={walkingIds} night={night} />
                    <WalkersView />
                    <BossView plan={plan} />
                    <PathDots />
                    <OfficePopup plan={plan} cursorId={cursorId} renderCard={renderCard} />
                    {dev?.sheet ? <PoseSheet /> : null}
                </div>
            ) : null}
        </div>
    );
}

function OfficeHeading({ now, night, pct }: { now: number; night: boolean; pct?: number }) {
    const time = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const tired = pct != null && pct >= 90;
    const kbd = "rounded border border-edge-mid bg-surface-raised px-1 font-mono text-[10.5px] text-secondary";
    return (
        <div data-office-heading className="flex items-center gap-4 text-[12px] text-muted">
            <span className="flex items-center gap-1.5">
                {night ? <Moon size={14} className="text-ink-mid" /> : <Sun size={14} className="text-graphlane-3" />}
                <span className="tabular-nums text-primary">{time}</span>
                {night ? "after hours" : "work hours"}
            </span>
            <span
                title="Claude's 5-hour window, as the app bar meter reads it"
                className={cn("flex items-center gap-1.5 tabular-nums", tired && "text-asking")}
            >
                <Zap size={14} />
                {pct == null ? "—" : `${Math.round(pct)} %`}
            </span>
            <span className="ml-auto flex items-center gap-2.5 text-[11.5px]">
                <span>
                    <kbd className={kbd}>←↑↓→</kbd> walk
                </span>
                <span>
                    <kbd className={kbd}>j</kbd> <kbd className={kbd}>k</kbd> desk
                </span>
                <span>
                    <kbd className={kbd}>n</kbd> next ask
                </span>
                <span>
                    <kbd className={kbd}>o</kbd> cards
                </span>
            </span>
        </div>
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

function Person({
    sprite,
    outfit,
    left,
    bottom,
    lounger,
}: {
    sprite: PlanSprite;
    outfit: PlanOutfit;
    left: number;
    bottom: number;
    lounger?: string;
}) {
    const h = spriteH(sprite);
    return (
        <img
            alt=""
            draggable={false}
            data-office-sprite={sprite}
            data-office-lounger={lounger}
            src={planSpriteUrl(sprite, outfit)}
            className="pointer-events-none absolute z-[1] [image-rendering:pixelated]"
            style={{ left, top: bottom - h, width: spriteWidth(sprite) * PLAN_CELL, height: h }}
        />
    );
}

// a person at a desk whose pose moves; the 5-hour reset stretches everyone at a desk, at work or not. The yawn waits
// for the clock's first tick: tick is 0 while the clock is off (animation off, reduced motion), and a pose holds frame 0
function TickPerson(p: {
    id: string;
    pose: SeatPose;
    outfit: PlanOutfit;
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
    return <Person sprite={sprite} outfit={p.outfit} left={26} bottom={56} />;
}

const DESK_CLASS =
    "absolute z-[1] isolate cursor-pointer border-0 bg-transparent p-0 [contain-intrinsic-size:88px_98px] [content-visibility:auto] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
    // the desk's top and face are pseudo-elements, not nodes: the bench's 2,000-node budget
    "before:absolute before:left-[4px] before:top-[50px] before:z-[2] before:h-[22px] before:w-[80px] before:bg-office-desk-top before:content-[''] " +
    "after:absolute after:left-[4px] after:top-[72px] after:z-[2] after:h-[8px] after:w-[80px] after:bg-office-desk-face after:content-['']";

const DeskView = memo(function DeskView(p: {
    d: Desk;
    hidePerson: boolean;
    energy: Energy;
    stretching: boolean;
    cheering: boolean;
    onPick: (key: string) => void;
}) {
    const { d, hidePerson, energy, stretching, cheering, onPick } = p;
    const outfit = useMemo<PlanOutfit>(() => ({ shirt: shirtOf(d.harness), look: lookOf(d.key) }), [d.harness, d.key]);
    const seated = !hidePerson && d.pose !== "empty";
    const working = d.light === "working";
    const pose: SeatPose = cheering ? "cheer" : d.pose;
    const ticks = d.animated || cheering || stretching || (working && energy !== "fresh");
    return (
        <button
            type="button"
            data-office-desk={d.key}
            data-office-pose={!seated ? "empty" : stretching ? "stretch" : pose}
            title={d.tip}
            aria-label={d.tip}
            onClick={() => onPick(d.key)}
            className={cn(DESK_CLASS, d.dim && "opacity-60")}
            style={{ left: d.x - 4, top: d.y - 50, width: 88, height: 98 }}
        >
            {seated ? (
                ticks ? (
                    <TickPerson
                        id={d.key}
                        pose={pose}
                        outfit={outfit}
                        working={working}
                        energy={energy}
                        stretching={stretching}
                    />
                ) : (
                    <Person sprite={seatSprite(pose, 0) ?? "doze"} outfit={outfit} left={26} bottom={56} />
                )
            ) : null}
            <span className="absolute left-[30px] top-[44px] z-[3] box-border h-[18px] w-[28px] border-2 border-solid border-surface-hover bg-surface-code" />
            <span
                className={cn(
                    "absolute left-[42px] top-[54px] z-[4] h-[2px] w-[4px]",
                    working ? "bg-working" : d.light === "asking" ? "bg-asking" : "bg-edge-mid"
                )}
            />
            <span className="absolute left-[66px] top-[42px] z-[3] box-border h-[22px] w-[12px] border border-solid border-surface-hover bg-surface-code" />
            {energy === "tired" && working ? (
                <span className="absolute left-[12px] top-[54px] z-[4] h-[9px] w-[7px] rounded-b-[2px] bg-office-cup" />
            ) : null}
        </button>
    );
}, sameValues);

function TickSeat({ pose, outfit }: { pose: SeatPose; outfit: PlanOutfit }) {
    const tick = useAtomValue(officeTickAtom);
    return <Person sprite={seatSprite(pose, (tick % 2) as 0 | 1) ?? "doze"} outfit={outfit} left={0} bottom={42} />;
}

const SeatView = memo(function SeatView({ s, onPick }: { s: Seat; onPick: (key: string) => void }) {
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
    return (
        <button
            type="button"
            data-office-seat={s.key}
            data-office-pose={s.pose}
            title={s.tip}
            aria-label={s.tip}
            onClick={() => onPick(s.key)}
            className="absolute cursor-pointer border-0 bg-transparent p-0 [contain-intrinsic-size:36px_42px] [content-visibility:auto] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            // the near side is in front of the table, the far side behind it
            style={{ left: s.x, top: s.bottom - 42, width: 36, height: 42, zIndex: s.pose === "back" ? 3 : 1 }}
        >
            {s.animated ? (
                <TickSeat pose={s.pose} outfit={outfit} />
            ) : (
                <Person sprite={seatSprite(s.pose, 0) ?? "doze"} outfit={outfit} left={0} bottom={42} />
            )}
        </button>
    );
}, sameValues);

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
                className="absolute z-[2] box-border cursor-pointer rounded-md border-0 border-b-[7px] border-solid border-office-desk-face bg-office-desk-top p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={box(t)}
            />
            {room.more ? (
                <span
                    className="pointer-events-none absolute z-[2] text-[11px] font-semibold text-primary"
                    style={{ left: t.x + t.w - 30, top: t.y + 6 }}
                >
                    +{room.more}
                </span>
            ) : null}
        </>
    );
}

function LoungerView({ l }: { l: Lounger }) {
    const outfit = useMemo<PlanOutfit>(
        () => ({ shirt: shirtOf(l.harness), look: lookOf(l.agentId) }),
        [l.harness, l.agentId]
    );
    return (
        <Person
            sprite={l.at === "sofa" ? "back" : "cup"}
            outfit={outfit}
            left={l.x}
            bottom={l.bottom}
            lounger={l.agentId}
        />
    );
}

function Screen({ r }: { r: Room }) {
    const cells = r.screen ?? [];
    const done = cells.filter((c) => c === "done").length;
    return (
        <span
            className="absolute z-[1] box-border flex flex-col justify-between border-[3px] border-solid border-edge-strong bg-surface-code p-[5px]"
            style={{ left: r.box.x + r.box.w - 170, top: r.box.y + 8, width: 152, height: 36 }}
        >
            <span className="flex flex-wrap gap-[3px]">
                {cells.map((c, i) => (
                    <span key={i} className={cn("h-[8px] w-[10px]", SCREEN[c])} />
                ))}
            </span>
            <span className="h-[3px] w-full bg-edge-mid">
                <span
                    className="block h-[3px] bg-working"
                    style={{ width: cells.length ? `${(100 * done) / cells.length}%` : 0 }}
                />
            </span>
        </span>
    );
}

function Building({ plan, night }: { plan: Plan; night: boolean }) {
    const l = plan.lounge;
    const e = plan.entrance;
    const y = plan.body.y + plan.body.h;
    const windows: number[] = [];
    for (let x = 60; x < plan.width - 60; x += 140) {
        if (x + 36 < e.x - 20 || x > e.x + e.w + 20) {
            windows.push(x);
        }
    }
    return (
        <>
            <span data-office-hall className="absolute z-0 bg-office-hall" style={box(plan.hall)} />
            {plan.rooms.map((r) => (
                <span
                    key={r.key}
                    data-office-floor={r.kind}
                    className="absolute z-0"
                    style={{ ...box(r.box), ...FLOOR[r.kind] }}
                />
            ))}
            {/* the lounge: the TV on the wall, the sofa facing it, the coffee machine, a plant */}
            <span
                className="absolute z-[1] box-border border-2 border-solid border-surface-hover bg-surface-code"
                style={{ left: l.x + 62, top: l.y, width: 110, height: 14 }}
            />
            <span
                className="absolute z-[1] rounded-t-[4px] bg-edge-strong"
                style={{ left: l.x + 168, top: l.y + 104, width: 30, height: 46 }}
            />
            <span
                className="absolute z-[2] rounded-t-[8px] bg-office-sofa"
                style={{ left: l.x + 40, top: l.y + 150, width: 150, height: 20 }}
            />
            <span
                className="absolute z-[2] rounded-[6px] bg-office-sofa brightness-75"
                style={{ left: l.x + 34, top: l.y + 166, width: 162, height: 16 }}
            />
            <span
                className="absolute z-[1] rounded-b-[4px] rounded-t-[11px] bg-office-plant"
                style={{ left: l.x + 204, top: l.y + 176, width: 22, height: 34 }}
            />
            {plan.rooms
                .filter((r) => r.kind === "agents")
                .map((r) => (
                    <span
                        key={`plant:${r.key}`}
                        className="absolute z-[1] rounded-b-[4px] rounded-t-[11px] bg-office-plant"
                        style={{ left: r.box.x + r.box.w - 40, top: r.box.y + r.box.h - 60, width: 22, height: 34 }}
                    />
                ))}
            {plan.rooms
                .filter((r) => r.kind === "meeting" && r.runId)
                .map((r) => (
                    <Screen key={`screen:${r.key}`} r={r} />
                ))}
            {/* the facade: brick, windows, the glass doors at the hall's foot, the sign over them */}
            <span
                className="absolute z-[1]"
                style={{ left: 0, top: y, width: plan.width, height: plan.height - y, ...BRICK }}
            />
            {windows.map((x) => (
                <span
                    key={x}
                    className={cn(
                        "absolute z-[1] box-border border-[3px] border-solid border-office-wall-top",
                        night ? "bg-office-window-night" : "bg-office-window-day"
                    )}
                    style={{ left: x, top: y + 8, width: 36, height: 20 }}
                />
            ))}
            <span
                className="absolute z-[1] box-border border-x-[3px] border-solid border-office-wall-top bg-white/15"
                style={box(e)}
            />
            <span
                data-office-sign
                className={cn(
                    "absolute z-[6] flex items-center justify-center rounded-[4px] border-2 border-solid border-accent bg-surface-code font-mono text-[14px] font-extrabold tracking-[0.18em] text-accent-50",
                    night ? "shadow-office-sign-night" : "shadow-office-sign"
                )}
                style={{ left: e.x + e.w / 2 - 80, top: y - 16, width: 160, height: 26 }}
            >
                ARCTERM
            </span>
        </>
    );
}

function Shades({ plan, night }: { plan: Plan; night: boolean }) {
    return (
        <>
            {plan.rooms
                .filter((r) => !r.lit)
                .map((r) => (
                    <span
                        key={r.key}
                        data-office-dark={r.key}
                        className="pointer-events-none absolute z-[4] bg-office-dark"
                        style={box(r.box)}
                    />
                ))}
            {night ? (
                <span
                    data-office-night
                    className="pointer-events-none absolute z-[4] bg-office-night"
                    style={box(plan.body)}
                />
            ) : null}
        </>
    );
}

function Walls({ plan, night }: { plan: Plan; night: boolean }) {
    const windows: number[] = [];
    for (let x = 60; x < plan.width - 60; x += 130) {
        windows.push(x);
    }
    return (
        <>
            {plan.walls.map((w, i) => (
                <span
                    key={i}
                    className={cn(
                        "pointer-events-none absolute z-[5]",
                        w.h === HWALL && w.w > WALL
                            ? "box-border border-t-8 border-solid border-office-wall-top bg-office-wall-face"
                            : "bg-office-wall-top"
                    )}
                    style={box(w)}
                />
            ))}
            {windows.map((x) => (
                <span
                    key={`w${x}`}
                    className={cn(
                        "pointer-events-none absolute z-[5] h-[6px] w-[26px]",
                        night ? "bg-office-window-night" : "bg-office-window-day"
                    )}
                    style={{ left: x, top: 10 }}
                />
            ))}
        </>
    );
}

function Bubble({ mark, left, top }: { mark: string; left: number; top: number }) {
    return (
        <span
            className={cn(
                "pointer-events-none absolute z-[6] flex size-5 items-center justify-center rounded-[6px] text-[13px] font-extrabold",
                BUBBLE[mark]
            )}
            style={{ left, top }}
        >
            {mark}
        </span>
    );
}

function Labels({ plan, walking, night }: { plan: Plan; walking: Set<string>; night: boolean }) {
    return (
        <>
            {plan.rooms
                .filter((r) => r.kind !== "lounge")
                .map((r) => (
                    <span
                        key={r.key}
                        className="pointer-events-none absolute z-[6] flex flex-col"
                        style={{ left: r.box.x + 14, top: r.box.y + 10 }}
                    >
                        <span className="text-[13px] font-bold text-primary">{r.title}</span>
                        <span className="text-[11px] text-secondary">{r.sub}</span>
                    </span>
                ))}
            {plan.desks.map((d) => (
                <Fragment key={d.key}>
                    <span
                        className={cn(
                            "pointer-events-none absolute z-[6] w-[140px] truncate text-center text-[11px]",
                            TONE[d.tone]
                        )}
                        style={{ left: d.x - 30, top: d.y + 34 }}
                    >
                        {d.word ? `${d.name} · ${d.word}` : d.name}
                    </span>
                    {d.bubble && !walking.has(d.key) ? <Bubble mark={d.bubble} left={d.x + 56} top={d.y - 46} /> : null}
                    {night && d.light !== "off" ? (
                        <span
                            className="pointer-events-none absolute z-[6] h-[6px] w-[12px] rounded-t-[3px] bg-office-lamp shadow-office-lamp"
                            style={{ left: d.x + 4, top: d.y - 10 }}
                        />
                    ) : null}
                </Fragment>
            ))}
            {plan.seats
                .filter((s) => s.bubble)
                .map((s) => (
                    <Bubble key={s.key} mark={s.bubble!} left={s.x + 22} top={s.bottom - 58} />
                ))}
            {/* after hours a meeting room with a running task lights its table */}
            {night
                ? plan.rooms
                      .filter((r) => r.kind === "meeting" && r.lit && r.table)
                      .map((r) => (
                          <span
                              key={`lamp:${r.key}`}
                              className="pointer-events-none absolute z-[6] h-[6px] w-[12px] rounded-t-[3px] bg-office-lamp shadow-office-lamp"
                              style={{ left: r.table!.x + r.table!.w / 2 - 6, top: r.table!.y - 8 }}
                          />
                      ))
                : null}
            {plan.loungers
                .filter((l) => !walking.has(l.agentId))
                .map((l) => (
                    <span
                        key={l.agentId}
                        data-office-lounge-label={l.agentId}
                        title={l.label}
                        className="absolute z-[6] flex justify-center overflow-hidden whitespace-pre text-[11px] leading-[14px] text-muted"
                        style={box(l.labelBox)}
                    >
                        <span className="min-w-0 truncate">{l.name}</span>
                        <span className="shrink-0">{` · ${l.age}`}</span>
                    </span>
                ))}
            {plan.loungeOverflow.length > 0 ? (
                <span
                    data-office-lounge-more
                    className="pointer-events-none absolute z-[6] truncate text-center text-[11px] leading-[14px] text-muted"
                    style={box(plan.loungeMore)}
                >
                    +{plan.loungeOverflow.length} in the lounge
                </span>
            ) : null}
        </>
    );
}

function Mover(p: { at: Point; sprite: PlanSprite; mirror: boolean; outfit: PlanOutfit; boss?: boolean }) {
    const w = spriteWidth(p.sprite) * PLAN_CELL;
    const h = spriteH(p.sprite);
    return (
        <img
            alt=""
            draggable={false}
            data-office-boss={p.boss ? "" : undefined}
            data-office-sprite={p.sprite}
            src={planSpriteUrl(p.sprite, p.outfit)}
            className="pointer-events-none absolute left-0 top-0 z-[7] [image-rendering:pixelated]"
            style={{
                width: w,
                height: h,
                transform: `translate(${Math.round(p.at.x - w / 2)}px, ${Math.round(p.at.y - h)}px)${p.mirror ? " scaleX(-1)" : ""}`,
            }}
        />
    );
}

function WalkersView() {
    const ws = useAtomValue(walkersAtom);
    const frame = walkFrame();
    return (
        <>
            {ws.map((w) => (
                <Mover
                    key={w.id}
                    at={w.at}
                    sprite={walkSprite(w.dir, frame)}
                    mirror={mirrorOf(w.dir)}
                    outfit={w.outfit}
                />
            ))}
        </>
    );
}

function BossView({ plan }: { plan: Plan }) {
    const b = useAtomValue(bossAtom);
    if (!b) {
        return null;
    }
    const moving = b.path.length > 1 || b.holding != null;
    const sprite: PlanSprite = moving ? walkSprite(b.dir, walkFrame()) : deskAt(plan, b.at) ? "boss" : "down1";
    return (
        <>
            <span
                className="pointer-events-none absolute left-0 top-0 z-[7] h-3 w-11 rounded-full bg-accent/35"
                style={{ transform: `translate(${Math.round(b.at.x - 22)}px, ${Math.round(b.at.y - 8)}px)` }}
            />
            <Mover at={b.at} sprite={sprite} mirror={moving && mirrorOf(b.dir)} outfit={BOSS_OUTFIT} boss />
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
                    style={{ transform: `translate(${Math.round(p.x - 3)}px, ${Math.round(p.y - 3)}px)` }}
                />
            ))}
            <span
                className="pointer-events-none absolute z-[7] w-[120px] text-center text-[11px] font-semibold text-asking"
                style={{ left: end.x - 60, top: end.y + 8 }}
            >
                next Needs you
            </span>
        </>
    );
}

function OfficePopup({
    plan,
    cursorId,
    renderCard,
}: {
    plan: Plan;
    cursorId?: string;
    renderCard: (key: string) => ReactNode;
}) {
    const b = useAtomValue(bossAtom);
    const open = useAtomValue(cardOpenAtom);
    const [big, setBig] = useAtom(officeBigCardAtom);
    const boxRef = useRef<HTMLDivElement>(null);
    const at = cardAt(plan, b, cursorId);
    const card = at != null && cursorId != null ? renderCard(cursorId) : null;
    const kind = at?.desk ? "agent" : "run";
    probe.popup = card && open ? kind : "";
    probe.prompt = card && !open ? kind : "";
    probe.big = !!card && open && big;
    const shown = card != null && open;
    // a card grown past the office's view scrolls into it
    useEffect(() => {
        if (shown && big) {
            boxRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
    }, [shown, big, cursorId]);
    if (!card || !at) {
        return null;
    }
    if (!open) {
        // like a game's "press E": over the person's head, clear of their bubble
        const over = at.desk
            ? { x: at.desk.x + 40, y: at.desk.y - 50 }
            : { x: at.seat!.x + 18, y: at.seat!.bottom - 62 };
        return <OfficePrompt kind={kind} over={over} verb={at.desk?.light === "asking" ? "Answer" : "Show card"} />;
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
function OfficePrompt({ kind, over, verb }: { kind: "agent" | "run"; over: Point; verb: string }) {
    const tick = useAtomValue(officeTickAtom);
    return (
        <button
            type="button"
            data-office-prompt={kind}
            onClick={() => globalStore.set(cardOpenAtom, true)}
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

// DEV (the States board): every sprite, to judge the set at a glance
function PoseSheet() {
    const outfit: PlanOutfit = { shirt: shirtOf("claude"), look: 1 };
    return (
        <div
            data-office-sheet
            className="absolute left-2 top-2 z-[9] grid grid-cols-6 gap-3 rounded-md border border-edge-mid bg-surface-raised p-3"
        >
            {(Object.keys(PLAN_SPRITES) as PlanSprite[]).map((s) => (
                <div key={s} className="flex flex-col items-center gap-1">
                    <img
                        alt=""
                        src={planSpriteUrl(s, s.startsWith("down") || s === "boss" ? BOSS_OUTFIT : outfit)}
                        className="[image-rendering:pixelated]"
                        style={{ width: spriteWidth(s) * PLAN_CELL, height: spriteH(s) }}
                    />
                    <span className="font-mono text-[10.5px] text-muted">{s}</span>
                </div>
            ))}
        </div>
    );
}
