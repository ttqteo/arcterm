// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent and Cockpit surfaces show while the roster is read for the first time (rosterLoadPhase "loading"),
// in the form Jarvis takes (Settings → Jarvis → Form), and a line saying arcterm is setting up. It replaced skeleton
// panes, which after a reinstall sat blank long enough to read as a hang.
// - Sprout: the pet the person picked running back and forth over a floor line, drawn at 12fps by a timer, not a CSS
//   animation, which would hold the page at display rate (pulse.ts).
// - Hologram: Jarvis's HUD a size up from its corner, built layer by layer (the core, then the rings from the inside out),
//   then swaying with pulses running in along its struts until the roster is read. While it shows, the corner hologram stands down
//   (hologramLoadersShownAtom). Float's small window keeps Sprout, as the corner does, and so does a GL failure.
// With reduced motion either stands still. While Jarvis is hidden (pethide.ts) neither shows, only the line, so a hidden
// Jarvis makes no WebGL context even at launch.

import { globalStore } from "@/app/store/jotaiStore";
import { petForm, type HologramPose } from "@/app/view/jarvis/hologrammodel";
import { useHologramCanvas } from "@/app/view/jarvis/hologramview";
import { petCharacter } from "@/app/view/jarvis/petcharacter";
import { jarvisHiddenAtom } from "@/app/view/jarvis/pethidestore";
import { PET_GRID, spriteFor } from "@/app/view/jarvis/petsprite";
import { hologramLoadersShownAtom, petCharacterAtom, petFormAtom } from "@/app/view/jarvis/petstore";
import { SproutSvg } from "@/app/view/jarvis/sproutsvg";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useChristmasDecor } from "./christmasstore";
import { floatModeAtom } from "./floatstore";
import { RUN_FRAME_MS, runFrame } from "./startuprun";

// a size up from the folded pet's 3px cells: it is the only thing on an otherwise empty screen
const CELL_PX = 4;
const PET_PX = PET_GRID * CELL_PX;
const TRACK_PX = 440;
// a size up from the corner's largest (132 px), for the same reason
const HOLOGRAM_PX = 176;
// the HUD at work, pulses running in along its struts: arcterm is busy, and nothing waits on you yet
const LOADING_POSE: HologramPose = { sphere: 0, busy: true, activity: 0.6, speaking: false, quiet: false };

function useReducedMotion(): boolean {
    const [reduce, setReduce] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        const onChange = () => setReduce(mq.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);
    return reduce;
}

function useElapsed(running: boolean): number {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!running) {
            return;
        }
        const start = performance.now();
        const timer = setInterval(() => setElapsed(performance.now() - start), RUN_FRAME_MS);
        return () => clearInterval(timer);
    }, [running]);
    return elapsed;
}

function RunningPet() {
    const character = petCharacter(useAtomValue(petCharacterAtom));
    const outfit = useChristmasDecor() ? "santa-hat" : null;
    const reduce = useReducedMotion();
    const elapsed = useElapsed(!reduce);
    const sprites = useMemo(
        () => ({
            walk1: spriteFor("walk1", [], outfit, character),
            walk2: spriteFor("walk2", [], outfit, character),
            stand: spriteFor("stand", [], outfit, character),
        }),
        [character, outfit]
    );
    const frame = runFrame(elapsed, TRACK_PX, PET_PX, CELL_PX);
    const x = reduce ? Math.round((TRACK_PX - PET_PX) / 2) : frame.x;
    const flip = !reduce && frame.facing === "left";
    return (
        <div className="relative" style={{ width: TRACK_PX, height: PET_PX }}>
            <div
                className="absolute bottom-0 left-0"
                style={{ transform: `translate(${x}px, ${reduce ? 0 : -frame.lift}px)${flip ? " scaleX(-1)" : ""}` }}
            >
                <SproutSvg sprite={reduce ? sprites.stand : sprites[frame.pose]} cellPx={CELL_PX} />
            </div>
            <div className="absolute inset-x-0 -bottom-[3px] h-px bg-edge-mid" />
        </div>
    );
}

// Whether the element is on screen: false under display:none (the Agent surface kept mounted while another shows)
function useShown(ref: RefObject<HTMLElement | null>): boolean {
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (el == null) {
            return;
        }
        const observer = new IntersectionObserver(([entry]) => setShown(entry.isIntersecting));
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);
    return shown;
}

function AssemblingHologram({ onFail }: { onFail: () => void }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const reduce = useReducedMotion();
    const shown = useShown(canvasRef);
    useHologramCanvas(canvasRef, { sizePx: HOLOGRAM_PX, pose: LOADING_POSE, reduce, onFail, shown, assemble: true });
    // counted only while on screen, so a loader under a hidden surface leaves the corner hologram alone
    useEffect(() => {
        if (!shown) {
            return;
        }
        globalStore.set(hologramLoadersShownAtom, (n) => n + 1);
        return () => globalStore.set(hologramLoadersShownAtom, (n) => Math.max(0, n - 1));
    }, [shown]);
    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            data-startup-hologram
            className="block"
            style={{ width: HOLOGRAM_PX, height: HOLOGRAM_PX }}
        />
    );
}

function LoaderFigure() {
    const form = petForm(useAtomValue(petFormAtom));
    const floating = useAtomValue(floatModeAtom);
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [form]);
    if (form === "hologram" && !floating && !failed) {
        return <AssemblingHologram onFail={() => setFailed(true)} />;
    }
    return <RunningPet />;
}

export function StartupLoader({ className }: { className?: string }) {
    const hidden = useAtomValue(jarvisHiddenAtom);
    return (
        <div
            role="status"
            aria-live="polite"
            className={cn("flex h-full w-full flex-col items-center justify-center gap-5 bg-background", className)}
        >
            {hidden ? null : <LoaderFigure />}
            <div className="flex flex-col items-center gap-1 text-center">
                <span className="text-[14px] font-semibold text-primary">Setting up arcterm</span>
                <span className="text-[12.5px] text-muted">Loading your agents and terminals, just a moment…</span>
            </div>
        </div>
    );
}
