// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The board pointers' marks over the canvas (boardpointers.ts): an outline on the shapes a hovered phrase in the Chat
// points at, and a flash on the shapes a click just showed. Drawn over Excalidraw, never into the scene, so nothing is
// saved or undone; it follows every pan and pinch through the canvas's view store, as the part labels do, without
// re-rendering the canvas.

import { MOTION } from "@/app/element/motiontokens";
import { useAtomValue } from "jotai";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import type { Viewport } from "./boardparts";
import { shapeRects, type SceneRect } from "./boardpointers";
import { boardFlashAtom, boardGlowAtom } from "./boardpointerstore";

interface ViewSource {
    subscribe: (fn: () => void) => () => void;
    get: () => Viewport | null;
}

type Elements = Parameters<typeof shapeRects>[0];

// how far the mark stands off the shape, in screen pixels
const PAD = 5;

function onView(r: SceneRect, vp: Viewport) {
    return {
        left: (r.x + vp.scrollX) * vp.zoom - PAD,
        top: (r.y + vp.scrollY) * vp.zoom - PAD,
        width: r.w * vp.zoom + PAD * 2,
        height: r.h * vp.zoom + PAD * 2,
    };
}

export function PointerGlow({
    boardId,
    views,
    elements,
    onFlashDone,
}: {
    boardId: string;
    views: ViewSource;
    elements: () => Elements;
    onFlashDone: (ts: number) => void;
}) {
    const vp = useSyncExternalStore(views.subscribe, views.get);
    const glow = useAtomValue(boardGlowAtom(boardId));
    const flash = useAtomValue(boardFlashAtom(boardId));
    if (vp == null) {
        return null;
    }
    const lit = glow.length > 0 ? shapeRects(elements(), glow) : [];
    const flashed = flash != null ? shapeRects(elements(), flash.ids) : [];
    return (
        <MotionConfig reducedMotion="user">
            <div data-board-pointer-layer className="pointer-events-none absolute inset-0 z-[5]">
                <AnimatePresence>
                    {lit.map((r) => (
                        <motion.div
                            key={`glow-${r.id}`}
                            data-board-pointer-glow={r.id}
                            aria-hidden
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: MOTION.durMicro }}
                            className="absolute rounded-[8px] border-2 border-accent bg-accent/10"
                            style={onView(r, vp)}
                        />
                    ))}
                </AnimatePresence>
                {flash != null
                    ? flashed.map((r, i) => (
                          <motion.div
                              key={`flash-${flash.ts}-${r.id}`}
                              data-board-pointer-flash={r.id}
                              aria-hidden
                              initial={{ opacity: 0 }}
                              animate={{ opacity: [0, 1, 0.35, 1, 0] }}
                              transition={{ duration: 1.6, times: [0, 0.15, 0.45, 0.7, 1], ease: "easeInOut" }}
                              // one of them reports the end, so the flash goes once
                              onAnimationComplete={i === 0 ? () => onFlashDone(flash.ts) : undefined}
                              className="absolute rounded-[8px] border-[3px] border-accent bg-accent/15"
                              style={onView(r, vp)}
                          />
                      ))
                    : null}
            </div>
        </MotionConfig>
    );
}
