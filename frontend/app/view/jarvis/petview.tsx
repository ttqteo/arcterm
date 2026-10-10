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

import { toastsAtom } from "@/app/cockpit/notificationstore";
import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { floatMiniAtom, floatModeAtom } from "@/app/view/agents/floatstore";
import { usePlanDonuts } from "@/app/view/agents/usagemeters";
import { useWorkerCapacity } from "@/app/view/agents/workercapacitystore";
import { useAtomValue } from "jotai";
import { animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { closePeek, openPetPeek } from "./peekstore";
import { PetBubble } from "./petbubble";
import { petCharacter } from "./petcharacter";
import { expressionFor, postureFor, type PetExpression, type PetPosture, type PetSignals } from "./petcondition";
import { landing, ledgeShift, type LedgeAt } from "./petfall";
import { avoidSpans, cornerFor, measureLedge, type LedgeBox, type MeasuredLedge, type PetCorner } from "./petledge";
import { petOutfit, petOutfitChoice } from "./petoutfit";
import { PetPeek } from "./petpeek";
import { queueRows } from "./petpeekmodel";
import { tightestWindow } from "./petquota";
import { canQuote, pickQuote, QUOTE_RETRY_MS, quoteDelayMs, quoteEvent, type QuoteMoment } from "./petquotes";
import { PET_CELL_PX, PET_PX, spriteFor, type PetCell, type PetMark } from "./petsprite";
import {
    petBubbleAtom,
    petCharacterAtom,
    petEventsAtom,
    petHomeAtom,
    petOutfitChoiceAtom,
    petPeekOpenAtom,
    petQuotesOnAtom,
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
const ATTENTION_GATE = "dag-gate";
const ATTENTION_ESCALATION = "escalation";
const ATTENTION_ASK = "ask";

// After a surface switch the new surface's ledge can arrive late (a surface mounts after the switch, and its
// bar's height settles as its content loads), and a resting creature would not look again for up to half a minute. So a switch
// measures on the next frame and again at each of these.
const SWITCH_SETTLE_MS = [150, 500, 1500, 3000];

function count(items: AttentionItem[], kind: string): number {
    return items.reduce((n, i) => (i.kind === kind ? n + 1 : n), 0);
}

// Every signal the creature reads. Shared with the folded Sprout (cockpit/sprout-mini.tsx).
export function usePetSignals(model: AgentsViewModel): PetSignals {
    const attention = useAtomValue(attentionAtom);
    const cap = useWorkerCapacity();
    const rateLimit = tightestWindow(usePlanDonuts(model));

    return {
        rateLimit,
        memory:
            cap != null
                ? {
                      more: cap.moreworkers,
                      available: cap.availablebytes,
                      perWorker: cap.perworkerbytes,
                      heavy: cap.heavybytes,
                      reserve: cap.reservebytes,
                  }
                : undefined,
        attention: {
            reviewGates: count(attention, ATTENTION_GATE),
            escalations: count(attention, ATTENTION_ESCALATION),
            blockedWorkers: count(attention, ATTENTION_ASK),
        },
    };
}

// How many things wait on you, the count on Sprout's chip in Float and folded (the nav badge's in Full)
export function useWaitingCount(model: AgentsViewModel): number {
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const messages = useAtomValue(channelMessagesAtom);
    return useMemo(() => queueRows(items, agents, messages).length, [items, agents, messages]);
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
    const boxes = Array.from(document.querySelectorAll("[data-pet-ledge]"), (e): LedgeBox => {
        const r = e.getBoundingClientRect();
        return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            holds: e.hasAttribute("data-pet-ledge-holds"),
        };
    });
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

// the last quote said, so the next is never the same one; module scope, so a remount (leaving float) keeps it
let lastQuote = -1;

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
    // folded, the shell is hidden but this stays mounted (its voice keeps running); the bubble and the peek portal to
    // the body, past the hidden shell, so the folded Sprout draws its own (cockpit/sprout-mini.tsx)
    const folded = useAtomValue(floatMiniAtom);
    // in Float the nav badge is gone: the count of what waits rides beside Sprout
    const floating = useAtomValue(floatModeAtom);
    const waiting = useWaitingCount(model);
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

    // Now and then a quote, when the creature has nothing else to say (petquotes.ts). The moment is read when the timer
    // fires, through a ref, so the timer is armed once rather than on every render.
    const quotesOn = useAtomValue(petQuotesOnAtom);
    const focused = useAtomValue(atoms.documentHasFocus);
    const momentRef = useRef<QuoteMoment>(null);
    momentRef.current = {
        enabled: quotesOn,
        expression: expression.kind,
        posture,
        speaking: bubble != null,
        peekOpen,
        focused,
    };
    useEffect(() => {
        if (!quotesOn) {
            return;
        }
        let timer: ReturnType<typeof setTimeout>;
        const arm = (ms: number) => {
            timer = setTimeout(fire, ms);
        };
        const fire = () => {
            const moment = momentRef.current;
            if (moment == null || !canQuote(moment)) {
                arm(QUOTE_RETRY_MS);
                return;
            }
            lastQuote = pickQuote(Math.random(), lastQuote);
            globalStore.set(petBubbleAtom, quoteEvent(lastQuote, Date.now()));
            arm(quoteDelayMs(Math.random()));
        };
        arm(quoteDelayMs(Math.random()));
        return () => clearTimeout(timer);
    }, [quotesOn]);

    // a quote is not news: clicking it only puts it away, and it leaves no unread marker behind
    const openPeek = useCallback(() => {
        if (globalStore.get(petBubbleAtom)?.kind === "quote") {
            globalStore.set(petBubbleAtom, null);
            return;
        }
        openPetPeek();
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
                chip={floating && waiting > 0 ? waiting : null}
            />
            {folded ? null : (
                <PetBubble
                    event={bubble}
                    anchor={anchor}
                    corner={corner}
                    onOpen={openPeek}
                    onDismiss={() => {
                        const said = globalStore.get(petBubbleAtom);
                        globalStore.set(petBubbleAtom, null);
                        if (said?.kind !== "quote") {
                            globalStore.set(petUnreadAtom, true);
                        }
                    }}
                />
            )}
            {/* the peek derives its own ranked condition LIST from the same signals — expressionFor is
                the creature's single face, and passing it here would cap the panel at one condition */}
            {folded ? null : <PetPeek model={model} anchor={anchor} corner={corner} signals={signals} />}
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
    chip,
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
    // the count chip, Float only
    chip: number | null;
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
    // A release falls to the ledge (petfall.ts) on dragX/dragY, still dangling: draggingNowRef stays true until it
    // touches down, so the walker holds it until then. A new drag mid-fall stops the fall and bumps the sequence, so
    // the stopped fall never lands.
    const fallRef = useRef<AnimationPlaybackControls[]>([]);
    const fallSeqRef = useRef(0);
    // A ledge that moves under it (a surface switch changes the bar) is met on the svg's own offset, apart from the
    // drag's transform, so the two never fight over one value.
    const ledgeY = useMotionValue(0);
    const ledgeAnimRef = useRef<AnimationPlaybackControls | null>(null);
    const prevLedgeRef = useRef<LedgeAt | null>(null);

    // Step the walker to now against a fresh measure, draw what comes back, and schedule the next step. Safe to
    // call at any time, which is how every input change reaches the walker.
    const run = useCallback(function run() {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
        const ledge = readLedge();
        // a ledge that holds the sprite keeps it off the terminal already
        const avoid = ledge.holds ? [] : readAvoid(ledge.top);
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

    // a toast is a [data-pet-avoid] box the walker only meets on its next step, which a resting pet takes seconds
    // later: step now, once the stack has laid out, so it walks off from under a new toast at once (and wakes for it)
    const toastCount = useAtomValue(toastsAtom).length;
    const toastCountRef = useRef(toastCount);
    useEffect(() => {
        const added = toastCount > toastCountRef.current;
        toastCountRef.current = toastCount;
        const raf = requestAnimationFrame(added ? touch : run);
        return () => cancelAnimationFrame(raf);
    }, [toastCount, run, touch]);

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

    // Before the paint that moves it: the svg starts where it stood on the old ledge and falls or hops to the new
    // one. In the air (a drag, a drop's fall) there is nothing to stand on yet, so the ledge is only remembered.
    const ledgeTop = frame?.ledge.top ?? null;
    useLayoutEffect(() => {
        if (ledgeTop == null) {
            return;
        }
        const next = { top: ledgeTop, vh: window.innerHeight };
        const shift = ledgeShift(prevLedgeRef.current, next);
        prevLedgeRef.current = next;
        if (shift === 0 || reduce || draggingNowRef.current) {
            return;
        }
        ledgeAnimRef.current?.stop();
        // a move mid-landing starts from where the last one had got to
        const way = landing(ledgeY.get() + shift);
        if (way == null) {
            ledgeY.set(0);
            return;
        }
        ledgeAnimRef.current = animate(ledgeY, way.y, { duration: way.duration, times: way.times, ease: way.ease });
    }, [ledgeTop, reduce, ledgeY]);

    useEffect(
        () => () => {
            fallSeqRef.current++;
            fallRef.current.forEach((a) => a.stop());
            ledgeAnimRef.current?.stop();
        },
        []
    );

    const marks: PetMark[] = frame == null ? [] : unread ? [...frame.step.marks, "unread"] : frame.step.marks;
    // read per frame, so a flag day dresses it on the first step past midnight
    const outfit = petOutfit(petOutfitChoice(useAtomValue(petOutfitChoiceAtom)), new Date());
    const character = petCharacter(useAtomValue(petCharacterAtom));
    const sprite = frame == null ? null : spriteFor(frame.step.pose, marks, outfit, character);

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
            tokens: [...new Set([...sprite.back, ...sprite.body, ...sprite.overlay].map((c) => `var(${c.token})`))],
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
            // where a fold starts (floatstore.ts foldToSprout reads its box)
            data-pet-sprite
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
                // caught mid-fall: the pointer takes it from where it is
                fallSeqRef.current++;
                fallRef.current.forEach((a) => a.stop());
                fallRef.current = [];
                touch();
            }}
            onDragEnd={(_, info) => {
                const l = { left: ledge.left, right: ledge.right };
                const dropX = dropAt(info.point.x, l);
                const land = () => {
                    setPetHome(homeFraction(dropX, l));
                    draggingNowRef.current = false;
                    // the new left edge is committed before the transform resets, so no paint between them shows
                    // it back at the left edge it was picked up from
                    flushSync(touch);
                    dragX.set(0);
                    dragY.set(0);
                };
                const way = reduce ? null : landing(dragY.get());
                if (way == null) {
                    land();
                    return;
                }
                const seq = ++fallSeqRef.current;
                fallRef.current = [
                    // it drifts to centre on the release x while it falls, so the landing needs no sideways jump
                    animate(dragX, dropX - step.x, { duration: way.duration * way.times[1], ease: "easeOut" }),
                    animate(dragY, way.y, { duration: way.duration, times: way.times, ease: way.ease }),
                ];
                // a stopped fall may resolve too; only the fall still current lands
                void fallRef.current[1].finished.then(() => {
                    if (seq === fallSeqRef.current) {
                        fallRef.current = [];
                        land();
                    }
                });
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
            <motion.svg
                width={PET_PX}
                height={PET_PX}
                viewBox={`0 0 ${PET_PX} ${PET_PX}`}
                shapeRendering="crispEdges"
                aria-hidden="true"
                // the flag in hand rises above the sprite's box (PET_FLAG_RISE), so the svg draws past its top
                overflow="visible"
                style={{ y: ledgeY }}
                className="block"
            >
                {/* under the body and never mirrored, like the marks: the flag stays at its left either way */}
                {sprite.back.map(cellRect)}
                {/* only the body turns to face left; marks drawn inside would read backwards */}
                <g transform={step.flip ? `matrix(-1 0 0 1 ${PET_PX} 0)` : undefined}>{sprite.body.map(cellRect)}</g>
                {sprite.overlay.map(cellRect)}
            </motion.svg>
            {chip != null ? (
                <span className="pointer-events-none absolute -left-1 top-1 min-w-4 rounded-full bg-warning px-1 text-center text-[10px] font-bold leading-4 text-on-warning tabular-nums">
                    {chip}
                </span>
            ) : null}
        </motion.div>
    );
}
