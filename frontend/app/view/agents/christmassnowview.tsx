// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Christmas snow: one fixed full-window canvas over the content (below popovers and modals), mounted beside
// PulseDriver at the cockpit root. It keeps its own 12fps interval rather than hooking PulseDriver, which writes styles
// to DOM nodes; this paints a canvas. The interval runs only while the motion gate is on, the window is visible and it
// is neither in Float nor folded into Sprout; otherwise it is cleared and so is the canvas. A flake over a visible
// terminal is drawn at half opacity (christmassnow.ts flakeAlpha). Nothing renders while the decor is off.

import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";

import { flakeAlpha, makeFlakes, stepFlake, type Flake, type SnowRect } from "./christmassnow";
import { useChristmasDecor, useChristmasMotion } from "./christmasstore";
import { floatMiniAtom, floatModeAtom } from "./floatstore";
import { themePresetAtom } from "./themestore";

const SNOW_FRAME_MS = 1_000 / 12;
// a longer gap (a stalled tab, a debugger) is stepped as this, so flakes never jump
const MAX_STEP_S = 0.2;

function useDocumentVisible(): boolean {
    const [visible, setVisible] = useState(() => !document.hidden);
    useEffect(() => {
        const onChange = () => setVisible(!document.hidden);
        onChange();
        document.addEventListener("visibilitychange", onChange);
        return () => document.removeEventListener("visibilitychange", onChange);
    }, []);
    return visible;
}

// The rects of the terminals on screen; a hidden one (display:none somewhere above it) measures zero and is skipped.
function terminalRects(): SnowRect[] {
    const rects: SnowRect[] = [];
    for (const el of document.querySelectorAll(".term-connectelem")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
            rects.push(r);
        }
    }
    return rects;
}

export function SnowLayer() {
    const decorOn = useChristmasDecor();
    if (!decorOn) {
        return null;
    }
    return <SnowCanvas />;
}

function SnowCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const motionOn = useChristmasMotion();
    const floating = useAtomValue(floatModeAtom);
    const folded = useAtomValue(floatMiniAtom);
    // the flake colour is read from the computed style once per theme change, not every frame
    const preset = useAtomValue(themePresetAtom);
    const visible = useDocumentVisible();
    const running = motionOn && visible && !floating && !folded;

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) {
            return;
        }
        let width = 0;
        let height = 0;
        const size = () => {
            const dpr = window.devicePixelRatio || 1;
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        size();
        if (!running) {
            ctx.clearRect(0, 0, width, height);
            return;
        }
        // the canvas carries text-xmas-snow, so its computed colour is the --color-xmas-snow token
        const color = getComputedStyle(canvas).color;
        let flakes: Flake[] = makeFlakes(width, height);
        let last = performance.now();
        let frames = 0;
        const paint = () => {
            const now = performance.now();
            const dt = Math.min(MAX_STEP_S, (now - last) / 1000);
            last = now;
            flakes = flakes.map((f) => stepFlake(f, dt, now, width, height));
            const rects = terminalRects();
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = color;
            for (const f of flakes) {
                ctx.globalAlpha = flakeAlpha(f.x, f.y, f.alpha, rects);
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            // a frame count the CDP scenario reads to tell a running snow from a still one
            frames++;
            canvas.dataset.frames = String(frames);
        };
        const onResize = () => {
            size();
            flakes = makeFlakes(width, height);
        };
        window.addEventListener("resize", onResize);
        paint();
        const timer = setInterval(paint, SNOW_FRAME_MS);
        return () => {
            clearInterval(timer);
            window.removeEventListener("resize", onResize);
            ctx.clearRect(0, 0, width, height);
        };
    }, [running, preset]);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden
            data-christmas-snow=""
            className="pointer-events-none fixed inset-0 z-[45] h-full w-full text-xmas-snow"
        />
    );
}
