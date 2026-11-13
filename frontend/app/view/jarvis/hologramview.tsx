// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Jarvis as a hologram (Settings → Jarvis → Form): fixed in the window's bottom-right corner, where Sprout would walk
// the footer. What it shows is hologrammodel.ts's, its pixels hologramscene.ts's, loaded only once this mounts. It
// opens the same peek and carries the same bubble as Sprout; PetView decides which of the two is shown. The frame loop
// is useHologramCanvas, which the startup loader (startuploader.tsx) draws its own hologram with.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { attentionAtom, cockpitWaitingCount, splitAttention } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { answeredAskIdsAcross } from "@/app/view/agents/jarvisderive";
import { useAtomValue } from "jotai";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, type MouseEvent, type RefObject } from "react";
import { easeMix, hologramFps, stepMix, type HologramPose } from "./hologrammodel";
import type { HologramScene } from "./hologramscene";
import { closePeek } from "./peekstore";

// Reduced motion holds the forms at this moment rather than at 0, where every ring starts aligned
const STILL_T = 12;

/** The agents asking you something, as the Cockpit's badge counts them. Only a question turns the hologram to the
 * sphere: gates, runs to land and the rest of Jarvis's queue leave it on the HUD. */
export function useAskingCount(model: AgentsViewModel): number {
    const attention = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const messages = useAtomValue(channelMessagesAtom);
    return useMemo(() => {
        const answered = answeredAskIdsAcross(Object.values(messages));
        return cockpitWaitingCount(splitAttention(attention).cockpit, agents, answered);
    }, [attention, agents, messages]);
}

export interface HologramCanvasInputs {
    sizePx: number;
    pose: HologramPose;
    reduce: boolean;
    // no GL context, or it was lost: the caller shows Sprout instead of an empty space
    onFail: () => void;
    // false while the canvas is not on screen (a surface kept mounted under display:none): no scene is built and
    // nothing draws until it is
    shown?: boolean;
    // build the HUD part by part from the first frame (hologramscene.ts) instead of showing it whole
    assemble?: boolean;
}

// The size and `assemble` are read once, when the scene is built: a caller keys its canvas by the size, so a new size is
// a new canvas. The loop starts once per mount and reads the rest through a ref, so a pose change never rebuilds the GL
// context.
export function useHologramCanvas(canvasRef: RefObject<HTMLCanvasElement | null>, inputs: HologramCanvasInputs) {
    const live = useRef(inputs);
    live.current = inputs;

    useEffect(() => {
        let disposed = false;
        let mod: typeof import("./hologramscene") | null = null;
        let scene: HologramScene | null = null;
        let raf = 0;
        let t = 0;
        let lastDraw = -Infinity;
        let mix: number = live.current.pose.sphere;
        let stillKey = "";
        const fail = () => {
            if (!disposed) {
                live.current.onFail();
            }
        };
        const frame = (now: number) => {
            raf = requestAnimationFrame(frame);
            const { pose: p, reduce: still, shown = true } = live.current;
            const canvas = canvasRef.current;
            if (document.hidden || mod == null || canvas == null || !shown) {
                lastDraw = now;
                // a still frame is drawn again when it shows again
                stillKey = "";
                return;
            }
            if (scene == null) {
                // the declaration is live, so a theme picked since still reads through on the next mount
                const rootStyle = getComputedStyle(document.documentElement);
                const colours = mod.readHologramColours((name) => rootStyle.getPropertyValue(name).trim());
                scene = mod.HologramScene.create(canvas, live.current.sizePx, colours, fail, live.current.assemble);
                if (scene == null) {
                    cancelAnimationFrame(raf);
                    fail();
                    return;
                }
            }
            if (still) {
                // no motion: the form the pose asks for, drawn once per change
                mix = p.sphere;
                const key = `${p.sphere}`;
                if (key !== stillKey) {
                    stillKey = key;
                    scene.draw(STILL_T, false, mix);
                }
                return;
            }
            stillKey = "";
            const dt = now - lastDraw;
            if (dt < 1000 / hologramFps(p, mix) - 1) {
                return;
            }
            lastDraw = now;
            const step = Math.min(dt, 100);
            t += step / 1000;
            mix = stepMix(mix, p.sphere, step);
            scene.draw(t, p.busy, easeMix(mix));
        };
        import("./hologramscene")
            .then((loaded) => {
                if (disposed) {
                    return;
                }
                mod = loaded;
                raf = requestAnimationFrame(frame);
            })
            .catch(fail);
        return () => {
            disposed = true;
            cancelAnimationFrame(raf);
            scene?.dispose();
        };
    }, []);
}

// The size is read once, when the scene is built: PetView keys this view by it, so a new size is a new canvas.
export function HologramView({
    sizePx,
    pose,
    unread,
    peekOpen,
    reduce,
    setAnchor,
    openPeek,
    onContextMenu,
    onFail,
}: {
    sizePx: number;
    pose: HologramPose;
    unread: boolean;
    peekOpen: boolean;
    reduce: boolean;
    setAnchor: (el: HTMLDivElement | null) => void;
    openPeek: () => void;
    // the right-click's menu: hide Jarvis for a while (pethidemenu.tsx)
    onContextMenu: (e: MouseEvent) => void;
    // no GL context, or it was lost: PetView shows Sprout instead of an empty corner
    onFail: () => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    useHologramCanvas(canvasRef, { sizePx, pose, reduce, onFail });

    return (
        <motion.div
            ref={setAnchor}
            data-pet-hologram
            role="button"
            tabIndex={0}
            // the name Sprout carries (petview.tsx): the CDP harness and a screen reader find Jarvis by it
            aria-label="Jarvis condition"
            onClick={() => (peekOpen ? closePeek() : openPeek())}
            onContextMenu={onContextMenu}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openPeek();
                }
            }}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: pose.quiet ? 0.4 : 1 }}
            whileHover={{ opacity: 1 }}
            transition={reduce ? { duration: 0 } : { opacity: { duration: 0.3 } }}
            // round, so the corner of the terminal outside the form still takes clicks
            className="fixed bottom-[40px] right-[18px] z-[60] cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ width: sizePx, height: sizePx }}
        >
            <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
            {/* the unread marker: a kind of thing happened, never how many; on the form's rim at every size */}
            {unread ? (
                <span
                    className="pointer-events-none absolute h-[9px] w-[9px] rounded-full border border-background bg-accent"
                    style={{ right: Math.round(sizePx * 0.14), top: Math.round(sizePx * 0.14) }}
                />
            ) : null}
        </motion.div>
    );
}
