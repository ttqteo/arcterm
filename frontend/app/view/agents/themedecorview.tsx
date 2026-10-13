// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Spider theme's drawn pieces (themedecor.ts holds their cells and when they show). Each is aria-hidden and
// catches no pointer: decor over the app, never in its way.

import { MOTION } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { motion, MotionConfig } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import {
    cellsPath,
    cobwebPath,
    hasSpiderDecor,
    SPIDER_MARK,
    SPIDER_SENSE,
    SPIDER_SENSE_OFFSET,
    SPIDER_SMALL,
} from "./themedecor";
import { themePresetAtom } from "./themestore";

const MARK_PATH = cellsPath(SPIDER_MARK, "#", 1);
const SMALL_BODY = cellsPath(SPIDER_SMALL, "S", 2);
const SMALL_EYES = cellsPath(SPIDER_SMALL, "e", 2);
const SENSE_JAGS = cellsPath(SPIDER_SENSE, "y", 2);
const HERO_BODY = cellsPath(SPIDER_SMALL, "S", 3);
const HERO_EYES = cellsPath(SPIDER_SMALL, "e", 3);
const WEB_TOP = cobwebPath(132, [20, 42, 68, 98, 128]);

export function useSpiderDecor(): boolean {
    return hasSpiderDecor(useAtomValue(themePresetAtom));
}

// The app bar's mark under the Spider theme, in the t> mark's box, drawn in currentColor.
// pointer-events-none: drag.js skips SVG elements, so the press must land on the parent span.
export function SpiderMark() {
    return (
        <svg
            width="25"
            height="19"
            viewBox="0 0 25 19"
            fill="currentColor"
            shapeRendering="crispEdges"
            aria-hidden="true"
            className="pointer-events-none"
        >
            <path d={MARK_PATH} />
        </svg>
    );
}

export function SmallSpider({ className }: { className?: string }) {
    return (
        <svg
            width="18"
            height="16"
            viewBox="0 0 18 16"
            shapeRendering="crispEdges"
            aria-hidden="true"
            className={cn("pointer-events-none block flex-none", className)}
        >
            <path d={SMALL_BODY} fill="var(--color-spidey-red)" />
            <path d={SMALL_EYES} fill="var(--color-spidey-eye)" />
        </svg>
    );
}

// how far below the tree's top it hangs: into the empty right end of the Conversation History row, clear of the
// Active header's asking badge under it
const THREAD_PX = 16;
const SPIDER_PX = 16;
// the spider-sense frame around it, in px
const SENSE_X = SPIDER_SENSE_OFFSET.x * 2;
const SENSE_Y = SPIDER_SENSE_OFFSET.y * 2;

// The spider on its thread at the agent tree's top right, the tree's first child. It drops once as it mounts (the
// theme turning on, or the tree coming back), out from under the app bar, then hangs still: a loop would hold the page
// at display rate. Reduced motion skips the drop, as both moves are transforms. `sensing` (an agent in the tree is
// asking) draws its spider-sense, static: the jags come and go with the state. Its own zero-height box anchors it, so
// the tree gains no containing block.
export function TreeSpider({ sensing }: { sensing: boolean }) {
    const on = useSpiderDecor();
    if (!on) {
        return null;
    }
    const drop = { duration: MOTION.durMacro, ease: MOTION.easeFluid };
    const width = 18 + 2 * SENSE_X;
    return (
        <MotionConfig reducedMotion="user">
            <div aria-hidden className="pointer-events-none relative h-0">
                <div
                    className="absolute top-0 z-[1] overflow-hidden"
                    style={{ right: 22 - SENSE_X, width, height: THREAD_PX + SPIDER_PX }}
                >
                    <motion.div
                        className="absolute top-0 w-px origin-top bg-spidey-web/55"
                        style={{ left: SENSE_X + 8, height: THREAD_PX }}
                        initial={{ scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={drop}
                    />
                    <motion.div
                        className="absolute left-0"
                        style={{ top: THREAD_PX - SENSE_Y }}
                        initial={{ y: -(THREAD_PX + SPIDER_PX) }}
                        animate={{ y: 0 }}
                        transition={drop}
                    >
                        <svg
                            width={width}
                            height={SPIDER_PX + SENSE_Y}
                            viewBox={`0 0 ${width} ${SPIDER_PX + SENSE_Y}`}
                            shapeRendering="crispEdges"
                            className="block"
                        >
                            <g transform={`translate(${SENSE_X} ${SENSE_Y})`}>
                                <path d={SMALL_BODY} fill="var(--color-spidey-red)" />
                                <path d={SMALL_EYES} fill="var(--color-spidey-eye)" />
                            </g>
                            {sensing ? <path d={SENSE_JAGS} fill="var(--color-asking)" /> : null}
                        </svg>
                    </motion.div>
                </div>
            </div>
        </MotionConfig>
    );
}

// The no-terminal hero's spider (agentlaunchhero.tsx), over its icon box at 3px a cell. Its strand runs a viewport
// up, and the hero clips it at its own top (overflow-hidden while this shows), so it hangs from the surface's top
// wherever the centred column sits. Static: it marks the theme, not a state.
export function HeroSpider() {
    return (
        <div aria-hidden className="pointer-events-none relative mb-4 h-[24px] w-[27px] flex-none">
            <div className="absolute bottom-full left-[13px] h-[100vh] w-px bg-spidey-web/55" />
            <svg width="27" height="24" viewBox="0 0 27 24" shapeRendering="crispEdges" className="block">
                <path d={HERO_BODY} fill="var(--color-spidey-red)" />
                <path d={HERO_EYES} fill="var(--color-spidey-eye)" />
            </svg>
        </div>
    );
}

// where the web's corner sits in the window: just under the app bar (38px), at the left edge
const WEB_ORIGIN = { x: 0, y: 38 };

// One web in the window's top-left corner, drawn as the background of each panel it crosses (the nav rail, then the
// agent tree): the panel's icons and rows paint over it, and a panel in the way hides it rather than being crossed by
// it. Each piece is placed at its panel's offset from the web's corner, so the pieces read as one web across the
// border. The panel must be `relative isolate`, so the piece's -z-10 lands between the panel's background and its
// content. Measured again on a window resize, which can narrow the rail and move the tree.
export function PanelWeb() {
    const on = useSpiderDecor();
    const ref = useRef<HTMLDivElement>(null);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    useLayoutEffect(() => {
        if (!on) {
            return;
        }
        const measure = () => {
            const box = ref.current?.getBoundingClientRect();
            if (box) {
                setOffset({ x: box.left - WEB_ORIGIN.x, y: box.top - WEB_ORIGIN.y });
            }
        };
        measure();
        let frame = 0;
        // after the rail's own resize handler has rendered its new width
        const onResize = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        };
        window.addEventListener("resize", onResize);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", onResize);
        };
    }, [on]);
    if (!on) {
        return null;
    }
    return (
        <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <svg
                width="170"
                height="150"
                viewBox="0 0 170 150"
                fill="none"
                className="absolute text-spidey-web opacity-[0.14]"
                style={{ left: -offset.x, top: -offset.y }}
            >
                <path d={WEB_TOP} stroke="currentColor" strokeWidth={1} />
            </svg>
        </div>
    );
}
