// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent and Cockpit surfaces show while the roster is read for the first time (rosterLoadPhase "loading"):
// the pet the person picked running back and forth over a floor line, and a line saying arcterm is setting up. It
// replaced skeleton panes, which after a reinstall sat blank long enough to read as a hang. Drawn at 12fps by a timer,
// not a CSS animation, which would hold the page at display rate (pulse.ts); with reduced motion the pet stands still.

import { petCharacter } from "@/app/view/jarvis/petcharacter";
import { PET_GRID, spriteFor } from "@/app/view/jarvis/petsprite";
import { petCharacterAtom } from "@/app/view/jarvis/petstore";
import { SproutSvg } from "@/app/view/jarvis/sproutsvg";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useChristmasDecor } from "./christmasstore";
import { RUN_FRAME_MS, runFrame } from "./startuprun";

// a size up from the folded pet's 3px cells: it is the only thing on an otherwise empty screen
const CELL_PX = 4;
const PET_PX = PET_GRID * CELL_PX;
const TRACK_PX = 440;

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

export function StartupLoader({ className }: { className?: string }) {
    return (
        <div
            role="status"
            aria-live="polite"
            className={cn("flex h-full w-full flex-col items-center justify-center gap-5 bg-background", className)}
        >
            <RunningPet />
            <div className="flex flex-col items-center gap-1 text-center">
                <span className="text-[14px] font-semibold text-primary">Setting up arcterm</span>
                <span className="text-[12.5px] text-muted">Loading your agents and terminals, just a moment…</span>
            </div>
        </div>
    );
}
