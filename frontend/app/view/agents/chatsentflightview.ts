// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The DOM side of a sent message's flight from the box to its place in the chat (chatsentflight.ts has the arithmetic,
// motiontokens.ts sentFlight the spring). Its bubble mounts with its text over where the text sat in the box and flies
// there on the spring, raised over the box while it flies. Each frame it reads where the bubble lays out now and aims at
// where it will be once the conversation has scrolled to its end (the row it lands in opens as it flies, the box shrinks
// back to one line, a send from higher up scrolls down), so it lands without a jump whatever moves under it. Should the
// transcript's copy of the message land mid-air, that row stays hidden until the bubble has landed and gone, so the swap
// happens at rest, where the two draw the same.

import { sentFlight } from "@/app/element/motiontokens";
import { animate, cancelFrame, frame, useReducedMotion } from "motion/react";
import { useLayoutEffect, useState, type RefObject } from "react";
import { setPendingFlying } from "./chatpendingstore";
import { flightAt, flightOpacity, scrollToGo, type FlightAnchor, type SentFrom } from "./chatsentflight";
import { risesFromBox } from "./chatsentrise";

/** How a sent bubble comes in as it mounts: flying from the box, rising in (sentRise: no place in the box to fly from,
 *  or reduced motion), or there at once (drawn again later: back to this agent, Terminal back to Chat). */
export type SentEntrance = "fly" | "rise" | "none";

// how long a landed bubble may hold its place on screen while the conversation scrolls the rest of the way to it
const SETTLE_MAX_MS = 800;
// how long the transcript's copy stays hidden after a landing when the bubble has not gone by then (the row taken for
// its copy was another message after all)
const TWIN_HIDE_MAX_MS = 1500;

// a text compared without its spaces or a command's `!`, so the bubble's text and its copy's match however each spaces it
const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").replace(/^!/, "");

const px = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

/** The entrance of a pending message's bubble, decided once as it mounts, and its flight when it flies: `row` is the row
 *  it lands in (raised over the box while it flies), `fly` what moves, `text` the box whose first line of text lines up
 *  with the box's (`fly` itself when null). `dim` is the opacity it lands at (a Queued message, a pending command): it
 *  leaves the box at full strength. */
export function useSentFlight(
    pending: { id: string; sentAt: number; from?: SentFrom },
    refs: {
        row: RefObject<HTMLElement | null>;
        fly: RefObject<HTMLElement | null>;
        text: RefObject<HTMLElement | null>;
    },
    dim?: number
): SentEntrance {
    const reduce = useReducedMotion();
    const [entrance] = useState<SentEntrance>(() =>
        !risesFromBox(pending.sentAt, Date.now()) ? "none" : pending.from != null && reduce !== true ? "fly" : "rise"
    );
    useLayoutEffect(() => {
        const from = pending.from;
        const row = refs.row.current;
        const fly = refs.fly.current;
        const text = refs.text.current ?? fly;
        if (entrance !== "fly" || from == null || row == null || fly == null || text == null) {
            return;
        }
        const id = pending.id;
        const scroller = fly.closest<HTMLElement>("[data-chat-scroller]");
        // where the bubble's text starts inside what flies, read before any transform
        const flyBox = fly.getBoundingClientRect();
        const textBox = text.getBoundingClientRect();
        const ts = getComputedStyle(text);
        const fontSize = px(ts.fontSize);
        const lineHeight = px(ts.lineHeight) || fontSize * 1.5;
        const anchor: FlightAnchor = {
            x: textBox.left - flyBox.left + px(ts.borderLeftWidth) + px(ts.paddingLeft),
            y: textBox.top - flyBox.top + px(ts.borderTopWidth) + px(ts.paddingTop) + lineHeight / 2,
            fontSize,
        };

        // The transcript's copy landing mid-air: hidden in the task that drew it (a MutationObserver runs before the
        // frame paints), so neither it nor the scroll it would take ever shows; it shows as this bubble goes.
        const before = new Set(scroller?.querySelectorAll("[data-chat-you]") ?? []);
        const said = squash(fly.textContent).slice(0, 40);
        let twin: HTMLElement | null = null;
        const findTwin = () => {
            if (twin != null || scroller == null) {
                return;
            }
            // newest first: a conversation drawn anew mid-air (its first load) holds older messages that may say the same
            for (const you of [...scroller.querySelectorAll<HTMLElement>("[data-chat-you]")].reverse()) {
                if (!before.has(you) && squash(you.textContent).includes(said)) {
                    twin = you.closest<HTMLElement>("[data-chat-item]") ?? you;
                    twin.style.display = "none";
                    return;
                }
            }
        };
        const showTwin = () => {
            twin?.style.removeProperty("display");
            twin = null;
        };
        const watch = new MutationObserver(findTwin);
        if (scroller != null) {
            watch.observe(scroller, { childList: true, subtree: true });
        }

        // the transform on screen now: what the element's laid-out place is read back through
        let cur = { dx: 0, dy: 0 };
        const apply = (q: number): number => {
            const r = fly.getBoundingClientRect();
            const toGo = scroller != null ? scrollToGo(scroller) : 0;
            const f = flightAt(from, { left: r.left - cur.dx, top: r.top - cur.dy - toGo }, anchor, q);
            cur = { dx: f.dx, dy: f.dy - toGo };
            fly.style.transform = `translate(${cur.dx}px, ${cur.dy}px) scale(${f.scale})`;
            if (dim != null) {
                fly.style.opacity = String(flightOpacity(dim, q));
            }
            return toGo;
        };

        let over = false;
        let settleFrame = 0;
        let twinTimer = 0;
        const land = () => {
            if (over) {
                return;
            }
            over = true;
            cancelAnimationFrame(settleFrame);
            watch.disconnect();
            for (const prop of ["transform", "transform-origin", "opacity", "will-change"]) {
                fly.style.removeProperty(prop);
            }
            row.style.removeProperty("z-index");
            // the transcript's copy, if it landed, now takes this bubble's place (pendingStill lets it go)
            setPendingFlying(id, false);
            if (twin != null) {
                twinTimer = window.setTimeout(showTwin, TWIN_HIDE_MAX_MS);
            }
        };

        fly.style.transformOrigin = "0 0";
        fly.style.willChange = "transform";
        // over the box, which floats over the conversation's end
        row.style.zIndex = "30";
        setPendingFlying(id, true);
        apply(0);
        // A frame's progress is put on screen after the frame's other motion has written its styles (the row opening
        // under the bubble, a reply arriving above it), so the place read is this frame's and not the last one's.
        let progress = 0;
        const step = () => {
            if (!over) {
                apply(progress);
            }
        };
        const run = animate(0, 1, {
            ...sentFlight,
            onUpdate: (q) => {
                progress = q;
                frame.postRender(step);
            },
            onComplete: () => {
                // landed: it holds its place on screen while the conversation scrolls the rest of the way to meet it
                cancelFrame(step);
                const start = performance.now();
                const settle = () => {
                    if (over) {
                        return;
                    }
                    if (apply(1) < 0.5 || performance.now() - start > SETTLE_MAX_MS) {
                        land();
                        return;
                    }
                    settleFrame = requestAnimationFrame(settle);
                };
                settle();
            },
        });
        return () => {
            run.stop();
            cancelFrame(step);
            land();
            window.clearTimeout(twinTimer);
            showTwin();
        };
    }, []);
    return entrance;
}
