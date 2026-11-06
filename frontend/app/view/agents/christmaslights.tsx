// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Christmas theme's lights in the app bar: a swag of wire in each gap between the bar's boxes (the search, the
// chips, New, the fold button), hooked to their top corners, with bulbs only along the swags (canvas
// xmas-lights-wrap, option B2; the geometry is christmasswag.ts). They first hung below the bar, over the top of every
// surface's header, then ran as one long string along the bar's bottom edge behind its controls; hung in the gaps,
// no bulb sits on a box, so none makes a button look disabled. Rendered first in the bar and unpositioned in z, so the
// boxes paint over the wire's ends: it tucks behind their corners.
// One ResizeObserver on the bar and its groups re-measures the boxes when one of them changes size or a chip comes or
// goes; at rest it measures nothing and renders nothing. Lit and still, the bulbs carry no PULSES class, so they cost
// no frames.
// While an agent needs you (the Cockpit badge's own count) every bulb turns `asking` and blinks through PulseDriver's
// `pulse-blink`, every other one half a period behind, so the string chases; under reduced motion PulseDriver writes
// nothing, so they stay lit in `asking`. Absolutely placed in the bar: the bar's height and layout never change.
// LightString is a straight string, which a dialog (ModalShell christmasLights) and the Christmas effects row in
// Settings → Appearance hang from their top edge, lit and still.

import { PULSES } from "@/app/element/pulse";
import { cn } from "@/util/util";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { AgentsViewModel } from "./agents";
import { swagShape, swagsFor, type Post, type Swag } from "./christmasswag";
import { useCockpitWaitingCount } from "./navrail";

// the spike's spacing: a bulb every 30px, a 6x9 bulb under a 3px socket, the wire dipping 4px between its anchors
const BULB_GAP = 30;
const BULB_COLOURS = ["bg-xmas-bulb", "bg-accent", "bg-success", "bg-xmas-snow"] as const;
const BLINK_LAG_MS = String(PULSES["pulse-blink"].periodMs / 2);

function bulbCount(): number {
    return Math.ceil(window.innerWidth / BULB_GAP);
}

// the bar's first swag starts this far right of the project switcher; on a Mac its last ends this far from the right
const START_GAP = 12;
const END_GAP = 4;

export function ChristmasLights({ model }: { model: AgentsViewModel }) {
    const asking = useCockpitWaitingCount(model) > 0;
    const ref = useRef<HTMLDivElement>(null);
    const swags = useBarSwags(ref);
    const shapes = swags.map(swagShape);
    let n = 0;
    // no z-index: the bar renders this first and its groups are positioned, so they paint over it in tree order
    return (
        <div
            ref={ref}
            data-christmas-lights=""
            data-asking={asking ? "" : undefined}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
        >
            <svg width="100%" height="100%" className="absolute inset-0 overflow-visible text-xmas-pine">
                {shapes.map((s, i) => (
                    <path key={i} d={s.path} stroke="currentColor" strokeWidth="1.2" fill="none" />
                ))}
                {shapes.flatMap((s, i) =>
                    s.sockets.map((p, k) => (
                        <rect key={`${i}-${k}`} x={p.x - 1.5} y={p.y - 0.5} width="3" height="3" fill="currentColor" />
                    ))
                )}
            </svg>
            {shapes.flatMap((s) =>
                s.sockets.map((p) => {
                    const i = n++;
                    return (
                        <span
                            key={i}
                            data-bulb
                            data-pulse-lag={asking && i % 2 === 1 ? BLINK_LAG_MS : undefined}
                            style={{ left: p.x - 3, top: p.y + 2 }}
                            className={cn(
                                "absolute h-[9px] w-[6px] rounded-full",
                                asking ? "bg-asking pulse-blink" : BULB_COLOURS[i % BULB_COLOURS.length]
                            )}
                        />
                    );
                })
            )}
        </div>
    );
}

// The swags across the bar this row sits in. The boxes are the search (data-xmas-post) and every child of the right
// group (data-xmas-posts) but the window controls; the first swag starts after the left group (data-xmas-start), and
// the last ends at the bar's right edge unless window controls sit there. A box moves only when one of these groups
// or the bar changes size, so observing them catches every move; the swags are set again only when they change.
function useBarSwags(ref: RefObject<HTMLDivElement | null>): Swag[] {
    const [swags, setSwags] = useState<Swag[]>([]);
    useEffect(() => {
        const row = ref.current;
        const bar = row?.parentElement;
        if (row == null || bar == null) {
            return;
        }
        let last = "";
        const measure = () => {
            const o = row.getBoundingClientRect();
            const posts: Post[] = [
                ...bar.querySelectorAll("[data-xmas-post], [data-xmas-posts] > :not([data-window-controls])"),
            ].map((el) => {
                const r = el.getBoundingClientRect();
                return { left: r.left - o.left, right: r.right - o.left, top: r.top - o.top };
            });
            const startEl = bar.querySelector("[data-xmas-start]");
            const start = startEl == null ? null : startEl.getBoundingClientRect().right - o.left + START_GAP;
            const end = bar.querySelector("[data-window-controls]") == null ? o.width - END_GAP : null;
            const next = swagsFor(start, posts, end);
            const key = JSON.stringify(next);
            if (key !== last) {
                last = key;
                setSwags(next);
            }
        };
        const ro = new ResizeObserver(measure);
        ro.observe(bar);
        bar.querySelectorAll("[data-xmas-start], [data-xmas-post], [data-xmas-posts]").forEach((el) => {
            ro.observe(el);
            if (el.parentElement != null && el.parentElement !== bar) {
                ro.observe(el.parentElement);
            }
        });
        return () => ro.disconnect();
    }, [ref]);
    return swags;
}

/** The string of bulbs, absolutely placed across its positioned parent; `className` sets where (bottom-0, top-0).
 *  `place` names it for the CDP scenarios: data-christmas-lights in the app bar, data-decor-lights elsewhere. */
export function LightString({
    place,
    asking = false,
    className,
}: {
    place: "bar" | "dialog" | "settings";
    asking?: boolean;
    className?: string;
}) {
    const [count, setCount] = useState(bulbCount);
    // the app bar's string and the dialog's can be on screen together: each its own pattern id
    const wireId = `christmas-wire-${useId().replace(/:/g, "")}`;
    useEffect(() => {
        const onResize = () => setCount(bulbCount());
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return (
        <div
            data-christmas-lights={place === "bar" ? "" : undefined}
            data-decor-lights={place === "bar" ? undefined : place}
            data-asking={asking ? "" : undefined}
            aria-hidden="true"
            className={cn("pointer-events-none absolute inset-x-0 h-4 overflow-hidden", className)}
        >
            <svg width="100%" height="16" className="absolute inset-0 text-xmas-pine">
                <defs>
                    <pattern id={wireId} width={BULB_GAP} height="16" patternUnits="userSpaceOnUse">
                        <path
                            d={`M0 1 Q${BULB_GAP / 2} 9 ${BULB_GAP} 1`}
                            stroke="currentColor"
                            strokeWidth="1.2"
                            fill="none"
                        />
                        <rect x={BULB_GAP / 2 - 1.5} y="4" width="3" height="3" fill="currentColor" />
                    </pattern>
                </defs>
                <rect width="100%" height="16" fill={`url(#${wireId})`} />
            </svg>
            {Array.from({ length: count }, (_, i) => (
                <span
                    key={i}
                    data-bulb
                    data-pulse-lag={asking && i % 2 === 1 ? BLINK_LAG_MS : undefined}
                    style={{ left: i * BULB_GAP + BULB_GAP / 2 - 3 }}
                    className={cn(
                        "absolute top-[6.5px] h-[9px] w-[6px] rounded-full",
                        asking ? "bg-asking pulse-blink" : BULB_COLOURS[i % BULB_COLOURS.length]
                    )}
                />
            ))}
        </div>
    );
}
