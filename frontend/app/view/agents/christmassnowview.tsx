// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Christmas snow: one fixed full-window canvas over the content and over an open dialog's backdrop (z-75, above
// ModalShell's z-70, below the z-80 popovers), mounted beside
// PulseDriver at the cockpit root. It keeps its own requestAnimationFrame loop rather than hooking PulseDriver, which
// writes styles to DOM nodes; this paints a canvas, on the display's frames and at most about 90 a second
// (snowFrameDue): a 12fps interval stepped each flake a pixel or more at a time and read as a stuttering, slow machine.
// The loop runs
// only while the motion gate is on, the window is visible and it is neither in Float nor folded into Sprout; otherwise
// it is stopped and the canvas cleared. A flake over a visible terminal or an open dialog's panel is drawn at half
// opacity (christmassnow.ts flakeAlpha), so the text under it stays readable; those rects are measured every
// DIM_REFRESH_MS, not every frame, since measuring forces a layout whenever a terminal has printed since the last one.
// Nothing renders while the decor is off or its Snow switch is (useChristmasSnow; off by default).

import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";

import { flakeAlpha, makeFlakes, snowFrameDue, stepFlake, type Flake, type SnowRect } from "./christmassnow";
import { useChristmasMotion, useChristmasSnow } from "./christmasstore";
import { floatMiniAtom, floatModeAtom } from "./floatstore";
import { themePresetAtom } from "./themestore";

// a longer gap (a stalled tab, a debugger) is stepped as this, so flakes never jump
const MAX_STEP_S = 0.2;
// how often the terminals' and dialogs' rects are measured again: a flake keeps its old opacity for at most this long
// after one moves, which nobody sees
const DIM_REFRESH_MS = 500;
// how often the frame count reaches the canvas's data-frames: an attribute written every frame would invalidate the
// canvas's style 60 times a second for a number only the CDP scenario reads
const FRAMES_PUBLISH_MS = 250;

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

// Where a flake dims: the terminals on screen and the panels of the open dialogs (ModalShell's role="dialog"). A
// hidden one (display:none somewhere above it) measures zero and is skipped.
const DIM_SELECTOR = '.term-connectelem, [role="dialog"][aria-modal="true"]';

function dimRects(): SnowRect[] {
    const rects: SnowRect[] = [];
    for (const el of document.querySelectorAll(DIM_SELECTOR)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
            rects.push(r);
        }
    }
    return rects;
}

export function SnowLayer() {
    const snowOn = useChristmasSnow();
    if (!snowOn) {
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
        let rects: SnowRect[] = dimRects();
        let rectsAt = performance.now();
        let last = performance.now();
        let frames = 0;
        let publishedAt = -Infinity;
        let raf = 0;
        const paint = (now: number) => {
            // a frame's timestamp can sit a hair before the performance.now() of the first paint
            const dt = Math.min(MAX_STEP_S, Math.max(0, now - last) / 1000);
            last = now;
            flakes = flakes.map((f) => stepFlake(f, dt, now, width, height));
            if (now - rectsAt >= DIM_REFRESH_MS) {
                rects = dimRects();
                rectsAt = now;
            }
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
            if (now - publishedAt >= FRAMES_PUBLISH_MS) {
                canvas.dataset.frames = String(frames);
                publishedAt = now;
            }
        };
        const tick = (now: number) => {
            raf = requestAnimationFrame(tick);
            if (snowFrameDue(now - last)) {
                paint(now);
            }
        };
        const onResize = () => {
            size();
            flakes = makeFlakes(width, height);
            rects = dimRects();
            rectsAt = performance.now();
        };
        window.addEventListener("resize", onResize);
        paint(performance.now());
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", onResize);
            ctx.clearRect(0, 0, width, height);
        };
    }, [running, preset]);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden
            data-christmas-snow=""
            className="pointer-events-none fixed inset-0 z-[75] h-full w-full text-xmas-snow"
        />
    );
}
