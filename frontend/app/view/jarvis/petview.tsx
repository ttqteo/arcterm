// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The creature: Sprout, a pixel pet walking the top edge of the hints footer (sprout spec). Thin by design —
// what it expresses is decided in petcondition.ts / petvoice.ts, where it stands and what it is doing in
// petwalk.ts, which ledge and which terminals count in petledge.ts, and its pixels are petsprite.ts's. This
// file owns only the measuring, the timer that steps the walker, and the SVG.
//
// Mounted once in cockpit-root, never inside a surface: every surface but Agent unmounts on a nav switch,
// and a creature that vanished when you changed rooms would be a status glyph, not a presence.
//
// It never draws a number. The nav badge owns the count; the creature owns the kind (pet spec §3).

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import {
    activeClaudeAccountAtom,
    planDonuts,
    savedRateLimitsAtom,
    topProviderUsage,
} from "@/app/view/agents/ratelimitstore";
import { useWorkerCapacity } from "@/app/view/agents/workercapacitystore";
import { useAtomValue } from "jotai";
import { motion, useMotionValue, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { closePeek } from "./peekstore";
import { PetBubble } from "./petbubble";
import { expressionFor, postureFor, type PetExpression, type PetPosture, type PetSignals } from "./petcondition";
import { avoidSpans, cornerFor, measureLedge, type MeasuredLedge, type PetCorner } from "./petledge";
import { PetPeek } from "./petpeek";
import { PET_CELL_PX, PET_PX, spriteFor, type PetCell, type PetMark } from "./petsprite";
import {
    petBubbleAtom,
    petEventsAtom,
    petHomeAtom,
    petPeekOpenAtom,
    petUnreadAtom,
    petWatermarkAtom,
    rememberSaid,
    setPetHome,
    setPetWatermark,
} from "./petstore";
import { nextUtterance } from "./petvoice";
import {
    dropAt,
    homeFraction,
    initialWalker,
    nextTick,
    stepWalker,
    type WalkerInput,
    type WalkerState,
    type WalkerStep,
} from "./petwalk";

// pkg/jarvis/attention.go's three kinds. Named here rather than inlined so the mapping to the creature's
// posture vocabulary is one line to check against the server.
const ATTENTION_GATE = "gate";
const ATTENTION_ESCALATION = "escalation";
const ATTENTION_ASK = "ask";

// After a surface switch the new surface's ledge can arrive late (the Cockpit draws its HintsBar only once
// its roster is ready), and a resting creature would not look again for up to half a minute. So a switch
// measures on the next frame and again at each of these.
const SWITCH_SETTLE_MS = [150, 500, 1500, 3000];

function count(items: AttentionItem[], kind: string): number {
    return items.reduce((n, i) => (i.kind === kind ? n + 1 : n), 0);
}

// Every signal the creature reads.
function usePetSignals(model: AgentsViewModel): PetSignals {
    const agents = useAtomValue(model.agentsAtom);
    const saved = useAtomValue(savedRateLimitsAtom);
    const activeAccount = useAtomValue(activeClaudeAccountAtom);
    const now = useAtomValue(model.nowAtom);
    const attention = useAtomValue(attentionAtom);
    const cap = useWorkerCapacity();

    const donuts = planDonuts(agents, saved, activeAccount, now);
    const top = topProviderUsage(donuts);
    const rateLimit =
        top != null
            ? {
                  provider: top.provider,
                  pct: top.pct,
                  resetAt: donuts.find((d) => d.provider === top.provider)?.fivehour.reset,
              }
            : undefined;

    return {
        rateLimit,
        memory:
            cap != null
                ? {
                      more: cap.moreworkers,
                      available: cap.availablebytes,
                      perWorker: cap.perworkerbytes,
                      heavy: cap.heavybytes,
                  }
                : undefined,
        attention: {
            reviewGates: count(attention, ATTENTION_GATE),
            escalations: count(attention, ATTENTION_ESCALATION),
            blockedWorkers: count(attention, ATTENTION_ASK),
        },
    };
}

// The DEV contract's override (sprout spec §4): replaces those walker inputs until force(null).
type PetForce = {
    expression?: PetExpression["kind"];
    posture?: PetPosture;
    speaking?: boolean;
    idle?: boolean;
};

interface PetFrame {
    step: WalkerStep;
    ledge: MeasuredLedge;
    avoid: [number, number][];
}

function readLedge(): MeasuredLedge {
    const boxes = Array.from(document.querySelectorAll("[data-pet-ledge]"), (e) => e.getBoundingClientRect());
    // the nav rail's <nav> is the app's only one
    const nav = document.querySelector("nav")?.getBoundingClientRect();
    return measureLedge(boxes, nav != null && nav.width > 0 ? nav.right : null, {
        width: window.innerWidth,
        height: window.innerHeight,
    });
}

function readAvoid(top: number): [number, number][] {
    const boxes = Array.from(document.querySelectorAll(".xterm, [data-pet-avoid]"), (e) => e.getBoundingClientRect());
    return avoidSpans(boxes, top);
}

function cellRect(c: PetCell, i: number) {
    return (
        <rect
            key={i}
            x={c.x * PET_CELL_PX}
            y={c.y * PET_CELL_PX}
            width={PET_CELL_PX}
            height={PET_CELL_PX}
            fill={`var(${c.token})`}
        />
    );
}

export function PetView({ model }: { model: AgentsViewModel }) {
    const signals = usePetSignals(model);
    const expression = expressionFor(signals);
    const posture = postureFor(signals);
    const bubble = useAtomValue(petBubbleAtom);
    const unread = useAtomValue(petUnreadAtom);
    const peekOpen = useAtomValue(petPeekOpenAtom);
    const events = useAtomValue(petEventsAtom);
    const watermark = useAtomValue(petWatermarkAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const reduce = useReducedMotion() === true;
    // state, not a ref: the bubble and the peek re-position when it lands
    const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
    // set by the sprite only when it crosses the window's middle, so the walk does not re-render the peek
    const [corner, setCorner] = useState<PetCorner>("bottom-right");

    // Push once per event (pet spec §4 decision 8). Advancing the watermark re-runs this effect, which then
    // finds nothing new — so the loop settles after one push rather than repeating it.
    useEffect(() => {
        const speech = nextUtterance(events, watermark);
        if (speech.watermark == null) {
            return;
        }
        setPetWatermark(speech.watermark);
        // oldest first, so the newest lands at the head of what the peek reads back
        for (const event of [...speech.heard].reverse()) {
            rememberSaid(event);
        }
        if (speech.utterance != null) {
            globalStore.set(petBubbleAtom, speech.utterance);
            globalStore.set(petUnreadAtom, false); // the bubble itself is the notice
        }
    }, [events, watermark]);

    const openPeek = useCallback(() => {
        globalStore.set(petPeekOpenAtom, true);
        globalStore.set(petUnreadAtom, false);
        globalStore.set(petBubbleAtom, null);
    }, []);

    return (
        <>
            <PetSprite
                expression={expression.kind}
                posture={posture}
                utterance={bubble?.id ?? null}
                peekOpen={peekOpen}
                unread={unread}
                reduce={reduce}
                surface={surface}
                setAnchor={setAnchor}
                onCorner={setCorner}
                openPeek={openPeek}
            />
            <PetBubble
                event={bubble}
                anchor={anchor}
                corner={corner}
                onOpen={openPeek}
                onDismiss={() => {
                    globalStore.set(petBubbleAtom, null);
                    globalStore.set(petUnreadAtom, true);
                }}
            />
            {/* the peek derives its own ranked condition LIST from the same signals — expressionFor is
                the creature's single face, and passing it here would cap the panel at one condition */}
            <PetPeek model={model} anchor={anchor} corner={corner} signals={signals} />
        </>
    );
}

// The walking sprite, apart from PetView so that a walk frame (8 a second) re-renders only the SVG, never the
// peek or the bubble.
function PetSprite({
    expression,
    posture,
    utterance,
    peekOpen,
    unread,
    reduce,
    surface,
    setAnchor,
    onCorner,
    openPeek,
}: {
    expression: PetExpression["kind"];
    posture: PetPosture;
    // the bubble's event id while one shows
    utterance: string | null;
    peekOpen: boolean;
    unread: boolean;
    reduce: boolean;
    surface: string;
    setAnchor: (el: HTMLDivElement | null) => void;
    onCorner: (corner: PetCorner) => void;
    openPeek: () => void;
}) {
    const [frame, setFrame] = useState<PetFrame | null>(null);
    const [forced, setForced] = useState<PetForce | null>(null);
    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);

    // Everything the step reads, through refs: the step runs from timers and handlers, and a closure would
    // read the inputs of whichever render scheduled it.
    const speaking = utterance != null;
    const liveRef = useRef({ expression, posture, speaking, peekOpen, reduce });
    liveRef.current = { expression, posture, speaking, peekOpen, reduce };
    const forceRef = useRef<PetForce | null>(null);
    const walkerRef = useRef<WalkerState | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const lastActivityRef = useRef(Date.now());
    // true from a drag's start to its end, which is what the walker reads
    const draggingNowRef = useRef(false);
    // set by a drag's start and cleared by the click that motion fires on its release, so a drag never
    // toggles the peek
    const draggedRef = useRef(false);

    // Step the walker to now against a fresh measure, draw what comes back, and schedule the next step. Safe to
    // call at any time, which is how every input change reaches the walker.
    const run = useCallback(function run() {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
        const ledge = readLedge();
        const avoid = readAvoid(ledge.top);
        const now = Date.now();
        const live = liveRef.current;
        const f = forceRef.current;
        const input: WalkerInput = {
            ledge: { left: ledge.left, right: ledge.right },
            avoid,
            expression: f?.expression ?? live.expression,
            posture: f?.posture ?? live.posture,
            speaking: f?.speaking ?? live.speaking,
            peekOpen: live.peekOpen,
            dragging: draggingNowRef.current,
            reduce: live.reduce,
            lastActivityAt: f?.idle ? 0 : lastActivityRef.current,
            // read from the store, not a prop: a drop persists home and steps in the same handler
            home: globalStore.get(petHomeAtom),
        };
        const step = stepWalker(walkerRef.current ?? initialWalker(input, now, Math.random), input, now, Math.random);
        walkerRef.current = step.state;
        setFrame({ step, ledge, avoid });
        const delay = nextTick(step.delayMs, document.hidden);
        if (delay != null) {
            timerRef.current = setTimeout(run, delay);
        }
    }, []);

    const touch = useCallback(() => {
        lastActivityRef.current = Date.now();
        run();
    }, [run]);

    // placed before the first paint, so it never shows anywhere but on the ledge
    useLayoutEffect(() => {
        run();
        return () => clearTimeout(timerRef.current);
    }, [run]);

    useEffect(() => {
        run();
    }, [run, expression, peekOpen, reduce, speaking]);

    // a posture change and an utterance are activity: they wake it and push its sleep back
    useEffect(() => {
        touch();
    }, [touch, posture]);
    useEffect(() => {
        if (utterance != null) {
            touch();
        }
    }, [touch, utterance]);

    useEffect(() => {
        window.addEventListener("resize", run);
        document.addEventListener("visibilitychange", run);
        return () => {
            window.removeEventListener("resize", run);
            document.removeEventListener("visibilitychange", run);
        };
    }, [run]);

    useEffect(() => {
        const raf = requestAnimationFrame(run);
        const timers = SWITCH_SETTLE_MS.map((ms) => setTimeout(run, ms));
        return () => {
            cancelAnimationFrame(raf);
            timers.forEach(clearTimeout);
        };
    }, [run, surface]);

    const force = useCallback(
        (o: PetForce | null) => {
            forceRef.current = o;
            setForced(o);
            // a force is an interaction too, so lifting idle wakes it
            touch();
        },
        [touch]
    );

    // re-read on a resize too, which moves the window's middle without moving the creature
    const x = frame?.step.x ?? null;
    const ledgeRight = frame?.ledge.right ?? null;
    useEffect(() => {
        if (x != null) {
            onCorner(cornerFor(x, window.innerWidth));
        }
    }, [x, ledgeRight, onCorner]);

    const marks: PetMark[] = frame == null ? [] : unread ? [...frame.step.marks, "unread"] : frame.step.marks;
    const sprite = frame == null ? null : spriteFor(frame.step.pose, marks);

    // Dev-only: the CDP harness asserts on this (sprout spec §4, "The DEV contract"). Folded out of production
    // builds — import.meta.env.DEV is statically false there.
    useEffect(() => {
        if (!import.meta.env.DEV || frame == null || sprite == null) {
            return;
        }
        (window as unknown as { __jarvisPet?: unknown }).__jarvisPet = {
            state: frame.step.state.name,
            pose: frame.step.pose,
            marks,
            x: frame.step.x,
            ledge: frame.ledge,
            avoid: frame.avoid,
            tokens: [...new Set([...sprite.body, ...sprite.overlay].map((c) => `var(${c.token})`))],
            force,
        };
    });
    useEffect(
        () => () => {
            if (import.meta.env.DEV) {
                delete (window as unknown as { __jarvisPet?: unknown }).__jarvisPet;
            }
        },
        []
    );

    if (frame == null || sprite == null) {
        return null;
    }
    const { step, ledge } = frame;
    const f = forced;
    // faint while it walks, rests or sleeps with nothing to express, and solid the moment it has something —
    // a health indicator you cannot see does not work (pet spec §3)
    const quiet =
        (f?.expression ?? expression) === "at-rest" &&
        (f?.posture ?? posture) === "none" &&
        !(f?.speaking ?? speaking) &&
        !peekOpen;

    return (
        <motion.div
            ref={setAnchor}
            drag
            dragMomentum={false}
            // the walker owns left and top; motion's drag owns only the transform, reset on release
            style={{ left: step.x, top: ledge.top - PET_PX - step.lift, x: dragX, y: dragY }}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: quiet ? 0.4 : 1 }}
            // opacity only: a scaled sprite would no longer stand on the ledge, and would smear its cells
            whileHover={{ opacity: 1 }}
            transition={reduce ? { duration: 0 } : { opacity: { duration: 0.3 } }}
            onHoverStart={touch}
            // a press starts clean: a drag whose release fired no click must not swallow the next real one
            onPointerDown={() => {
                draggedRef.current = false;
            }}
            onDragStart={() => {
                draggedRef.current = true;
                draggingNowRef.current = true;
                touch();
            }}
            onDragEnd={(_, info) => {
                const l = { left: ledge.left, right: ledge.right };
                setPetHome(homeFraction(dropAt(info.point.x, l), l));
                draggingNowRef.current = false;
                dragX.set(0);
                dragY.set(0);
                touch();
            }}
            onClick={() => {
                if (draggedRef.current) {
                    draggedRef.current = false;
                    return;
                }
                touch();
                if (peekOpen) {
                    closePeek();
                    return;
                }
                openPeek();
            }}
            role="button"
            tabIndex={0}
            // not "Jarvis": the nav rail's entry-two button already owns that name, and the CDP harness
            // navigates by it (scripts/cdp/attach.mjs SURFACE_LABEL). Two controls with one accessible name is
            // ambiguous to a screen reader and makes a by-label query pick whichever comes first in the DOM.
            aria-label="Jarvis condition"
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    touch();
                    openPeek();
                }
            }}
            // opacity is animated above rather than set here: an inline style beats a utility class, so a
            // class would always have lost
            className="fixed z-[60] cursor-grab outline-none active:cursor-grabbing"
        >
            <svg
                width={PET_PX}
                height={PET_PX}
                viewBox={`0 0 ${PET_PX} ${PET_PX}`}
                shapeRendering="crispEdges"
                aria-hidden="true"
                className="block"
            >
                {/* only the body turns to face left; marks drawn inside would read backwards */}
                <g transform={step.flip ? `matrix(-1 0 0 1 ${PET_PX} 0)` : undefined}>{sprite.body.map(cellRect)}</g>
                {sprite.overlay.map(cellRect)}
            </svg>
        </motion.div>
    );
}
