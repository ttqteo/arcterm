// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Jarvis as a hologram (Settings → Jarvis → Form): fixed in the window's bottom-right corner, where Sprout would walk
// the footer. What it shows is hologrammodel.ts's, its pixels hologramscene.ts's, loaded only once this mounts. It
// opens the same peek and carries the same bubble as Sprout; PetView decides which of the two is shown.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { attentionAtom, cockpitWaitingCount, splitAttention } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { answeredAskIdsAcross } from "@/app/view/agents/jarvisderive";
import { useAtomValue } from "jotai";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { easeMix, hologramFps, stepMix, type HologramPose } from "./hologrammodel";
import type { HologramScene } from "./hologramscene";
import { closePeek } from "./peekstore";

export const HOLOGRAM_PX = 132;

// Reduced motion holds the forms at this moment rather than at 0, where every ring starts aligned
const STILL_T = 12;

/** Everything that waits on you: the agents that need you and the rest of the queue, as the dock badge counts it. */
export function useNeedsYouCount(model: AgentsViewModel): number {
    const attention = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const messages = useAtomValue(channelMessagesAtom);
    return useMemo(() => {
        const split = splitAttention(attention);
        const answered = answeredAskIdsAcross(Object.values(messages));
        return cockpitWaitingCount(split.cockpit, agents, answered) + split.jarvis.length;
    }, [attention, agents, messages]);
}

export function HologramView({
    pose,
    unread,
    peekOpen,
    reduce,
    setAnchor,
    openPeek,
    onFail,
}: {
    pose: HologramPose;
    unread: boolean;
    peekOpen: boolean;
    reduce: boolean;
    setAnchor: (el: HTMLDivElement | null) => void;
    openPeek: () => void;
    // no GL context, or it was lost: PetView shows Sprout instead of an empty corner
    onFail: () => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    // the loop starts once per mount and reads these through refs, so a pose change never rebuilds the GL context
    const live = useRef({ pose, reduce, onFail });
    live.current = { pose, reduce, onFail };

    useEffect(() => {
        let disposed = false;
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
            const { pose: p, reduce: still } = live.current;
            if (document.hidden || scene == null) {
                lastDraw = now;
                return;
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
            .then((mod) => {
                const canvas = canvasRef.current;
                if (disposed || canvas == null) {
                    return;
                }
                // the declaration is live, so a theme picked since still reads through on the next mount
                const rootStyle = getComputedStyle(document.documentElement);
                const colours = mod.readHologramColours((name) => rootStyle.getPropertyValue(name).trim());
                scene = mod.HologramScene.create(canvas, HOLOGRAM_PX, colours, fail);
                if (scene == null) {
                    fail();
                    return;
                }
                raf = requestAnimationFrame(frame);
            })
            .catch(fail);
        return () => {
            disposed = true;
            cancelAnimationFrame(raf);
            scene?.dispose();
        };
    }, []);

    return (
        <motion.div
            ref={setAnchor}
            data-pet-hologram
            role="button"
            tabIndex={0}
            // the name Sprout carries (petview.tsx): the CDP harness and a screen reader find Jarvis by it
            aria-label="Jarvis condition"
            onClick={() => (peekOpen ? closePeek() : openPeek())}
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
            style={{ width: HOLOGRAM_PX, height: HOLOGRAM_PX }}
        >
            <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
            {/* the unread marker: a kind of thing happened, never how many */}
            {unread ? (
                <span className="pointer-events-none absolute right-[18px] top-[18px] h-[9px] w-[9px] rounded-full border border-background bg-accent" />
            ) : null}
        </motion.div>
    );
}
