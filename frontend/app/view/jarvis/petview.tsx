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

import { digitHintAtom } from "@/app/cockpit/digithints";
import { toastsAtom } from "@/app/cockpit/notificationstore";
import { MOTION } from "@/app/element/motiontokens";
import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { deriveKeyContext } from "@/app/store/keybindings/dispatcher";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { floatMiniAtom, floatModeAtom } from "@/app/view/agents/floatstore";
import { workingCount } from "@/app/view/agents/sproutroster";
import { usePlanDonuts } from "@/app/view/agents/usagemeters";
import { useWorkerCapacity } from "@/app/view/agents/workercapacitystore";
import { useAtomValue } from "jotai";
import {
    animate,
    motion,
    useMotionValue,
    useReducedMotion,
    useTransform,
    type AnimationPlaybackControls,
} from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { openTarget } from "./openref";
import { closePeek, openPetPeek, peekChordActive } from "./peekstore";
import { PetBubble } from "./petbubble";
import { petCharacter } from "./petcharacter";
import { expressionFor, postureFor, type PetExpression, type PetPosture, type PetSignals } from "./petcondition";
import { landing, ledgeShift, webLanding, type LedgeAt } from "./petfall";
import { bubbleClick } from "./petjoin";
import {
    avoidSpans,
    cornerFor,
    measureCeiling,
    measureLedge,
    type LedgeBox,
    type MeasuredLedge,
    type PetCorner,
} from "./petledge";
import { petOutfit, petOutfitChoice } from "./petoutfit";
import { PetPeek } from "./petpeek";
import { queueRows } from "./petpeekmodel";
import { tightestWindow } from "./petquota";
import {
    canQuote,
    pickQuote,
    QUOTE_RETRY_MS,
    quoteDelayMs,
    quoteEvent,
    quotePool,
    type QuoteMoment,
} from "./petquotes";
import {
    PET_CELL_PX,
    PET_PX,
    SPIDEY_CRAWL,
    SPIDEY_HANG,
    spriteFor,
    spriteOfRows,
    type PetCell,
    type PetMark,
} from "./petsprite";
import {
    petBubbleAtom,
    petCharacterAtom,
    petEventsAtom,
    petHomeAtom,
    petOfficeSeatAtom,
    petOutfitChoiceAtom,
    petPeekOpenAtom,
    petQuotesOnAtom,
    petUnreadAtom,
    petWatermarkAtom,
    rememberSaid,
    setPetHome,
    setPetWatermark,
} from "./petstore";
import type { TeleportKind } from "./petteleport";
import { PetTeleportLayers } from "./petteleportsvg";
import { nextUtterance, unreadAfterLeaving, unreadAfterSaying } from "./petvoice";
import {
    dropAt,
    HANG_DOWN_MS,
    HANG_UP_MS,
    homeFraction,
    initialWalker,
    nextTick,
    REST_POSES,
    restIn,
    slideFrom,
    startHang,
    STEP_PX,
    stepWalker,
    type WalkerInput,
    type WalkerState,
    type WalkerStep,
} from "./petwalk";
import { petTeleportAtom, type TeleportRun } from "./teleportstore";
import { WorkingDots } from "./workingdots";

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

// How many agents are working: the "…" beside Sprout in Float and folded (the rail shows it in Full)
export function useWorkingCount(model: AgentsViewModel): number {
    const agents = useAtomValue(model.agentsAtom);
    return useMemo(() => workingCount(agents), [agents]);
}

// How many things wait on you, the count on Sprout's chip in Float and folded (the nav badge's in Full)
export function useWaitingCount(model: AgentsViewModel): number {
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const messages = useAtomValue(channelMessagesAtom);
    return useMemo(() => queueRows(items, agents, messages).length, [items, agents, messages]);
}

// A click on the bubble: a quote is not news, so clicking it only puts it away; a line said once for an agent opens
// that agent (petjoin.ts bubbleClick); anything else opens the chat.
export function openPetBubble(model?: AgentsViewModel): void {
    const said = globalStore.get(petBubbleAtom);
    if (said?.kind === "quote") {
        globalStore.set(petBubbleAtom, null);
        return;
    }
    if (model != null) {
        const click = bubbleClick(said, globalStore.get(model.agentsAtom));
        if ("tabId" in click) {
            globalStore.set(petBubbleAtom, null);
            void openTarget(model, { kind: "agent", tabId: click.tabId });
            return;
        }
    }
    openPetPeek();
}

// The bubble's time ran out or its × was pressed: what it said stays unread, unless it was said once; a quote leaves
// nothing behind.
export function dismissPetBubble(): void {
    const said = globalStore.get(petBubbleAtom);
    globalStore.set(petBubbleAtom, null);
    if (said?.kind !== "quote") {
        globalStore.set(petUnreadAtom, unreadAfterLeaving(said, globalStore.get(petUnreadAtom)));
    }
}

// The DEV contract's override (sprout spec §4): replaces those walker inputs until force(null).
type PetForce = {
    expression?: PetExpression["kind"];
    posture?: PetPosture;
    speaking?: boolean;
    idle?: boolean;
    // start Spider-Man's app-bar pastime now (only under an app bar); the others ignore it
    hang?: boolean;
    // rest now in this pose, for any character, so a step can show each without waiting on the random pick
    rest?: (typeof REST_POSES)[number];
    // hold Spider-Man's web-swing still at t ms into it, in place of his cells; the others ignore it
    swing?: { kind: TeleportKind; t: number };
    // draw the working mark at this count, held or not and in Float or not
    working?: number;
};

interface PetFrame {
    step: WalkerStep;
    ledge: MeasuredLedge;
    // the app bar's underside Spider-Man hangs from, or null where there is no app bar (Float, folded)
    ceiling: number | null;
    avoid: [number, number][];
}

// Spider-Man under the app bar: the strand between the bar and his boots while he hangs
const HANG_STRAND_PX = 4 * PET_CELL_PX;
// held, he hangs this far under the pointer on a strand
const DRAG_DROP_PX = 4 * PET_CELL_PX;
// the strand's column: his raised hand in dangle, his boots in the hang
const HAND_LEFT_PX = 12 * PET_CELL_PX;
const BOOTS_LEFT_PX = 8 * PET_CELL_PX;

// where a column of the body is once the body is mirrored to face left
function strandLeft(col: number, flip: boolean): number {
    return flip ? PET_PX - PET_CELL_PX - col : col;
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

// the app bar Spider-Man hangs from (petledge.ts measureCeiling), absent in Float and folded
function readCeiling(): number | null {
    return measureCeiling(
        Array.from(document.querySelectorAll("[data-pet-ceiling]"), (e) => e.getBoundingClientRect())
    );
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
    const agents = useAtomValue(model.agentsAtom);
    const surface = useAtomValue(model.surfaceAtom);
    // folded, the shell is hidden but this stays mounted (its voice keeps running); the bubble and the peek portal to
    // the body, past the hidden shell, so the folded Sprout draws its own (cockpit/sprout-mini.tsx)
    const folded = useAtomValue(floatMiniAtom);
    // in Float the nav badge is gone: the count of what waits rides beside Sprout
    const floating = useAtomValue(floatModeAtom);
    // the Brief's office draws Jarvis at its desk (officeview.tsx): it sits there rather than walking the footer, so
    // there is one Jarvis, and the bubble and the peek hang off the seat
    const seat = useAtomValue(petOfficeSeatAtom);
    const seated = seat != null && !folded;
    const waiting = useWaitingCount(model);
    const working = useWorkingCount(model);
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
            // the bubble itself is the notice, unless it is said once and so stands for nothing kept
            const unread = unreadAfterSaying(speech, globalStore.get(petBubbleAtom), globalStore.get(petUnreadAtom));
            globalStore.set(petBubbleAtom, speech.utterance);
            globalStore.set(petUnreadAtom, unread);
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
            // read when it fires, as the moment is, so a character picked since the timer was armed draws its own lines
            const pool = quotePool(petCharacter(globalStore.get(petCharacterAtom)));
            lastQuote = pickQuote(Math.random(), lastQuote, pool);
            globalStore.set(petBubbleAtom, quoteEvent(lastQuote, Date.now(), pool));
            arm(quoteDelayMs(Math.random()));
        };
        arm(quoteDelayMs(Math.random()));
        return () => clearTimeout(timer);
    }, [quotesOn]);

    // a quote is not news: clicking it only puts it away, and it leaves no unread marker behind
    const openPeek = useCallback(() => openPetBubble(model), [model]);

    return (
        <>
            {seated ? null : (
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
                    working={floating && working > 0 ? working : null}
                />
            )}
            {folded ? null : (
                <PetBubble
                    event={bubble}
                    agents={agents}
                    anchor={seated ? seat : anchor}
                    corner={seated ? "bottom-left" : corner}
                    onOpen={openPeek}
                    onDismiss={dismissPetBubble}
                />
            )}
            {/* the peek derives its own ranked condition LIST from the same signals — expressionFor is
                the creature's single face, and passing it here would cap the panel at one condition */}
            {folded ? null : (
                <PetPeek
                    model={model}
                    anchor={seated ? seat : anchor}
                    corner={seated ? "bottom-left" : corner}
                    // the seat is mid-page, with no room above it for the panel: it opens beside Jarvis, not over it
                    placement={seated ? "right-end" : undefined}
                    signals={signals}
                />
            )}
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
    working,
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
    // the agents working, Float only
    working: number | null;
}) {
    const [frame, setFrame] = useState<PetFrame | null>(null);
    const [forced, setForced] = useState<PetForce | null>(null);
    // the fold's teleport (floatstore.ts): it plays in place of the cells, and holds the walk while it does
    const teleport = useAtomValue(petTeleportAtom).walk;
    const teleporting = teleport != null;
    // who he is: Spider-Man hangs, rappels and web-swings, and the walker reads it
    const character = petCharacter(useAtomValue(petCharacterAtom));
    // Mod held on its own (digithints.ts, the rail's digits too): a J where ⌘J would open the peek
    const keyHint = useAtomValue(digitHintAtom) === "ctrl" && !teleporting && peekChordActive(deriveKeyContext());
    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);

    // Everything the step reads, through refs: the step runs from timers and handlers, and a closure would
    // read the inputs of whichever render scheduled it.
    const speaking = utterance != null;
    const liveRef = useRef({ expression, posture, speaking, peekOpen, reduce, teleporting, character });
    liveRef.current = { expression, posture, speaking, peekOpen, reduce, teleporting, character };
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
    // and one the ledge narrows under (petwalk.ts slideFrom) slides over to where the walker put it
    const slideX = useMotionValue(0);
    const slideAnimRef = useRef<AnimationPlaybackControls | null>(null);
    const prevStepRef = useRef<{ x: number; name: WalkerState["name"] } | null>(null);
    const prevLedgeRef = useRef<LedgeAt | null>(null);
    // The cursor came onto him while he hung: he comes down, and does not go back up until that hang is over. Set by
    // the hover, cleared by the first step with no hang in it.
    const hangCutRef = useRef(false);
    // Spider-Man under the app bar: px above his ledge spot (the root's margin, so its hit box goes up with him), and
    // the strand from the bar down to him
    const hangY = useMotionValue(0);
    const hangBase = useMotionValue(0);
    const hangStrand = useTransform([hangY, hangBase], ([y, base]: number[]) => Math.max(0, base + y));
    const hangAnimRef = useRef<AnimationPlaybackControls | null>(null);
    // held, he hangs this far under the pointer on a strand, and rappels down one when let go
    const dropY = useMotionValue(0);
    const dropAnimRef = useRef<AnimationPlaybackControls | null>(null);
    const holdAnimRef = useRef<AnimationPlaybackControls | null>(null);
    // where the press caught him, from the root's top-left: the strand's top while he is held
    const grabRef = useRef({ x: 0, y: 0 });
    const grabY = useMotionValue(0);
    // held, his raised hand is under the pointer: the body slides over by this much, back to 0 as he rappels
    const holdX = useMotionValue(0);
    // dragY where the strand is stuck: the pointer while held, the release point while he rappels
    const releaseY = useMotionValue(0);
    const svgX = useTransform([slideX, holdX], ([a, b]: number[]) => a + b);
    const svgY = useTransform([ledgeY, dropY], ([a, b]: number[]) => a + b);
    const strandTop = useTransform([releaseY, dragY, grabY], ([r, y, g]: number[]) => r - y + g);
    const strandH = useTransform([releaseY, dragY, dropY, grabY], ([r, y, d, g]: number[]) =>
        Math.max(0, y - r + d - g)
    );
    // the DEV contract's force({ swing }) holds a web-swing still; its run is made once, in force, so the clock under
    // it is not restarted by every render
    const swingRunRef = useRef<TeleportRun | null>(null);

    // What the walker reads, measured now. The DEV forces build it too, so a forced pastime starts from the same input.
    const measure = useCallback(() => {
        const ledge = readLedge();
        const ceiling = readCeiling();
        // a ledge that holds the sprite keeps it off the terminal already
        const avoid = ledge.holds ? [] : readAvoid(ledge.top);
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
            hangs: live.character === "spidey" && ceiling != null && !live.reduce && !hangCutRef.current,
        };
        return { ledge, ceiling, avoid, input };
    }, []);

    // Step the walker to now against a fresh measure, draw what comes back, and schedule the next step. Safe to
    // call at any time, which is how every input change reaches the walker.
    const run = useCallback(
        function run() {
            clearTimeout(timerRef.current);
            timerRef.current = undefined;
            // a teleport holds it where it stands: no step while it plays, so the ring stays under its feet and the walk
            // picks up where it was
            if (liveRef.current.teleporting && walkerRef.current != null) {
                return;
            }
            const { ledge, ceiling, avoid, input } = measure();
            const now = Date.now();
            const step = stepWalker(
                walkerRef.current ?? initialWalker(input, now, Math.random),
                input,
                now,
                Math.random
            );
            walkerRef.current = step.state;
            if (step.hang == null) {
                hangCutRef.current = false;
            }
            setFrame({ step, ledge, ceiling, avoid });
            const delay = nextTick(step.delayMs, document.hidden);
            if (delay != null) {
                timerRef.current = setTimeout(run, delay);
            }
        },
        [measure]
    );

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
    }, [run, expression, peekOpen, reduce, speaking, teleporting, character]);

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
            swingRunRef.current = o?.swing != null ? { kind: o.swing.kind, at: performance.now() } : null;
            if (o?.hang || o?.rest) {
                // a rest begun now, from the walker as it stands (or as it would boot)
                const { input } = measure();
                const now = Date.now();
                let w = walkerRef.current ?? initialWalker(input, now, Math.random);
                if (o.rest) {
                    w = restIn(w, o.rest, now);
                }
                if (o.hang && liveRef.current.character === "spidey") {
                    w = startHang(w, input, now, Math.random);
                }
                walkerRef.current = w;
            }
            setForced(o);
            // a force is an interaction too, so lifting idle wakes it
            touch();
        },
        [touch, measure]
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

    // Before the paint that moves it: a step the walker took without walking (the ledge narrowed under it) starts the
    // svg where it stood and eases it over, from wherever a slide still under way had got to.
    const stepName = frame?.step.state.name ?? null;
    useLayoutEffect(() => {
        if (x == null || stepName == null) {
            return;
        }
        const shift = slideFrom(prevStepRef.current, x);
        prevStepRef.current = { x, name: stepName };
        if (shift === 0 || reduce || draggingNowRef.current) {
            return;
        }
        slideAnimRef.current?.stop();
        slideX.set(slideX.get() + shift);
        slideAnimRef.current = animate(slideX, 0, { duration: MOTION.durMacro, ease: MOTION.easeFluid });
    }, [x, stepName, reduce, slideX]);

    // Spider-Man's app-bar pastime: up the strand to the bar's underside, along it, a few cells down the strand to hang,
    // and back down to his spot. The walker times the phases (petwalk.ts); this moves the root and the strand with them.
    const hangPhase = frame?.step.hang ?? null;
    // px from his ledge spot up to the bar's underside, 0 where there is no bar
    const hangRise = frame?.ceiling != null ? frame.ledge.top - PET_PX - frame.ceiling : 0;
    useLayoutEffect(() => {
        hangBase.set(hangRise);
    }, [hangRise, hangBase]);
    useEffect(() => {
        hangAnimRef.current?.stop();
        hangAnimRef.current = null;
        if (hangPhase === "up") {
            hangAnimRef.current = animate(hangY, -hangRise, { duration: HANG_UP_MS / 1000, ease: "easeOut" });
        } else if (hangPhase === "crawl") {
            hangY.set(-hangRise);
        } else if (hangPhase === "hang") {
            hangAnimRef.current = animate(hangY, -hangRise + HANG_STRAND_PX, { duration: 0.15, ease: "easeOut" });
        } else if (hangY.get() !== 0 && !draggingNowRef.current) {
            // down, or a hang cut short: back to his spot. Not while held: the margin stays where the press caught it,
            // so the root does not slide out from under the pointer, and the release folds it into the drag's offset
            hangAnimRef.current = animate(hangY, 0, { duration: HANG_DOWN_MS / 1000, ease: "easeOut" });
        }
    }, [hangPhase, hangRise, hangY]);

    useEffect(
        () => () => {
            fallSeqRef.current++;
            fallRef.current.forEach((a) => a.stop());
            ledgeAnimRef.current?.stop();
            slideAnimRef.current?.stop();
            hangAnimRef.current?.stop();
            dropAnimRef.current?.stop();
            holdAnimRef.current?.stop();
        },
        []
    );

    const marks: PetMark[] = frame == null ? [] : unread ? [...frame.step.marks, "unread"] : frame.step.marks;
    // read per frame, so a flag day dresses it on the first step past midnight
    const outfit = petOutfit(petOutfitChoice(useAtomValue(petOutfitChoiceAtom)), new Date());
    // the crawl and the hang are grids of their own, not poses; the crawl's two frames alternate with each cell crawled
    const sprite =
        frame == null
            ? null
            : hangPhase === "crawl"
              ? spriteOfRows(SPIDEY_CRAWL[Math.abs(Math.round(frame.step.x / STEP_PX)) % 2], marks)
              : hangPhase === "hang"
                ? spriteOfRows(SPIDEY_HANG, marks)
                : spriteFor(frame.step.pose, marks, outfit, character);

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
            flip: frame.step.flip,
            character,
            hang: frame.step.hang,
            ceiling: frame.ceiling,
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
    // the web-swing a DEV force holds still stands in for the cells just as a fold's teleport does
    const swingRun = f?.swing != null && character === "spidey" && teleport == null ? swingRunRef.current : null;
    // the working mark: Float's, or the count a DEV force gives it
    const shownWorking = f?.working !== undefined ? (f.working > 0 ? f.working : null) : working;
    // Spider-Man's strands: from the app bar to him while he hangs, and from the pointer (or the release point) while
    // he is held and rappels; neither while a teleport plays in his place
    const hangStrandShown = !teleporting && step.hang != null && step.hang !== "crawl" && frame.ceiling != null;
    const dragStrandShown = !teleporting && !reduce && character === "spidey" && draggingNowRef.current;

    return (
        <motion.div
            ref={setAnchor}
            // where a fold starts (floatstore.ts foldToSprout reads its box)
            data-pet-sprite
            drag
            dragMomentum={false}
            // the walker owns left and top; motion's drag owns only the transform, reset on release. Spider-Man's margin
            // takes his hit box up to the app bar with him, so a hover on him there cuts his hang
            style={{ left: step.x, top: ledge.top - PET_PX - step.lift, marginTop: hangY, x: dragX, y: dragY }}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: quiet && !teleporting && !keyHint ? 0.4 : 1 }}
            // opacity only: a scaled sprite would no longer stand on the ledge, and would smear its cells
            whileHover={{ opacity: 1 }}
            transition={reduce ? { duration: 0 } : { opacity: { duration: 0.3 } }}
            onHoverStart={() => {
                // the cursor on him ends his hang: he comes down, and stays down until the hang would have been over
                if (frame?.step.hang != null) {
                    hangCutRef.current = true;
                }
                touch();
            }}
            // a press starts clean: a drag whose release fired no click must not swallow the next real one
            onPointerDown={(e) => {
                draggedRef.current = false;
                const r = e.currentTarget.getBoundingClientRect();
                grabRef.current = {
                    x: Math.min(Math.max(0, e.clientX - r.left), PET_PX),
                    y: Math.min(Math.max(0, e.clientY - r.top), PET_PX),
                };
            }}
            onDragStart={() => {
                draggedRef.current = true;
                draggingNowRef.current = true;
                // caught mid-fall: the pointer takes it from where it is
                fallSeqRef.current++;
                fallRef.current.forEach((a) => a.stop());
                fallRef.current = [];
                // caught on his way down from the app bar: he stops there, under the pointer
                hangAnimRef.current?.stop();
                hangAnimRef.current = null;
                releaseY.set(dragY.get());
                if (character === "spidey" && !reduce) {
                    // 4 cells under the pointer, his raised hand right under it
                    const grab = grabRef.current;
                    grabY.set(grab.y);
                    const hand = strandLeft(HAND_LEFT_PX, step.flip) + PET_CELL_PX / 2;
                    dropAnimRef.current?.stop();
                    dropAnimRef.current = animate(dropY, grab.y + DRAG_DROP_PX, { duration: 0.12, ease: "easeOut" });
                    holdAnimRef.current?.stop();
                    holdAnimRef.current = animate(holdX, grab.x - hand, { duration: 0.12, ease: "easeOut" });
                }
                touch();
            }}
            // the strand is stuck to the pointer while he is held
            onDrag={() => releaseY.set(dragY.get())}
            onDragEnd={(_, info) => {
                // a margin the press caught on his way down from the app bar goes into the drag's offset, where the
                // fall below takes it down; the root stays where it is on screen
                if (hangY.get() !== 0) {
                    dragY.set(dragY.get() + hangY.get());
                    hangY.set(0);
                }
                const l = { left: ledge.left, right: ledge.right };
                const dropX = dropAt(info.point.x, l);
                const land = () => {
                    setPetHome(homeFraction(dropX, l));
                    draggingNowRef.current = false;
                    dropAnimRef.current?.stop();
                    dropY.set(0);
                    holdAnimRef.current?.stop();
                    holdX.set(0);
                    grabY.set(0);
                    // the new left edge is committed before the transform resets, so no paint between them shows
                    // it back at the left edge it was picked up from
                    flushSync(touch);
                    dragX.set(0);
                    dragY.set(0);
                };
                const way = reduce ? null : (character === "spidey" ? webLanding : landing)(dragY.get());
                // from here the strand stays stuck where he was let go
                releaseY.set(dragY.get());
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
                if (character === "spidey") {
                    // he ends the rappel on the ledge, not four cells under it: the drop he hung at eases out with it,
                    // and so does the slide that held his hand under the pointer
                    const down = { duration: way.duration * way.times[1], ease: "easeOut" } as const;
                    dropAnimRef.current?.stop();
                    dropAnimRef.current = animate(dropY, 0, down);
                    holdAnimRef.current?.stop();
                    holdAnimRef.current = animate(holdX, 0, down);
                    fallRef.current.push(dropAnimRef.current, holdAnimRef.current);
                }
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
                style={{ x: svgX, y: svgY }}
                className="block"
            >
                {teleport != null || swingRun != null ? (
                    <PetTeleportLayers
                        run={(teleport ?? swingRun)!}
                        sprite={sprite}
                        cellPx={PET_CELL_PX}
                        flip={step.flip}
                        character={character}
                        at={teleport == null ? f?.swing?.t : undefined}
                    />
                ) : (
                    <>
                        {/* under the body and never mirrored, like the marks: the flag stays at its left either way */}
                        {sprite.back.map(cellRect)}
                        {/* only the body turns to face left; marks drawn inside would read backwards */}
                        <g data-pet-body transform={step.flip ? `matrix(-1 0 0 1 ${PET_PX} 0)` : undefined}>
                            {sprite.body.map(cellRect)}
                        </g>
                        {sprite.overlay.map(cellRect)}
                    </>
                )}
            </motion.svg>
            {hangStrandShown ? (
                // from the app bar to his boots (hanging) or his raised hand (going up, coming down)
                <motion.span
                    aria-hidden
                    data-pet-strand
                    className="pointer-events-none absolute bottom-full w-[3px] bg-spidey-web"
                    style={{
                        left: strandLeft(step.hang === "hang" ? BOOTS_LEFT_PX : HAND_LEFT_PX, step.flip),
                        height: hangStrand,
                    }}
                />
            ) : null}
            {dragStrandShown ? (
                // from the pointer (the release point, once let go) to his raised hand
                <motion.span
                    aria-hidden
                    data-pet-strand
                    className="pointer-events-none absolute top-0 w-[3px] bg-spidey-web"
                    style={{ left: strandLeft(HAND_LEFT_PX, step.flip), x: holdX, y: strandTop, height: strandH }}
                />
            ) : null}
            {chip != null && !teleporting ? (
                <span className="pointer-events-none absolute -left-1 top-1 min-w-4 rounded-full bg-warning px-1 text-center text-[10px] font-bold leading-4 text-on-warning tabular-nums">
                    {chip}
                </span>
            ) : null}
            {shownWorking != null && !teleporting ? (
                <WorkingDots count={shownWorking} className="absolute -right-2 -top-1" />
            ) : null}
            {/* the rail's digit badge (digithint.tsx), on the same bottom-right corner */}
            {keyHint ? (
                <kbd
                    data-pet-key-hint="j"
                    className="pointer-events-none absolute -bottom-[4px] -right-[6px] flex h-[12px] min-w-[12px] items-center justify-center rounded-[3px] bg-accent px-[2px] font-sans text-[9px] font-bold leading-none text-background"
                >
                    J
                </kbd>
            ) : null}
        </motion.div>
    );
}
