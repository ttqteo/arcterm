// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Christmas theme's string of lights, hanging from the app bar's bottom edge (spike: .superpowers/design/
// christmas-theme/spike/lights.html, option D). Lit and still, the bulbs carry no PULSES class, so they cost no frames.
// While an agent needs you (the Cockpit badge's own count) every bulb turns `asking` and blinks through PulseDriver's
// `pulse-blink`, every other one half a period behind, so the string chases; under reduced motion PulseDriver writes
// nothing, so they stay lit in `asking`. Absolutely placed under the bar: the bar's height and layout never change.

import { PULSES } from "@/app/element/pulse";
import { cn } from "@/util/util";
import { useEffect, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { useCockpitWaitingCount } from "./navrail";

// the spike's spacing: a bulb every 30px, a 6x9 bulb under a 3px socket, the wire dipping 4px between its anchors
const BULB_GAP = 30;
const BULB_COLOURS = ["bg-xmas-bulb", "bg-accent", "bg-success", "bg-xmas-snow"] as const;
const BLINK_LAG_MS = String(PULSES["pulse-blink"].periodMs / 2);

function bulbCount(): number {
    return Math.ceil(window.innerWidth / BULB_GAP);
}

export function ChristmasLights({ model }: { model: AgentsViewModel }) {
    const asking = useCockpitWaitingCount(model) > 0;
    const [count, setCount] = useState(bulbCount);
    useEffect(() => {
        const onResize = () => setCount(bulbCount());
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return (
        <div
            data-christmas-lights
            data-asking={asking ? "" : undefined}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-full z-10 h-4 overflow-hidden"
        >
            <svg width="100%" height="16" className="absolute inset-0 text-xmas-pine">
                <defs>
                    <pattern id="christmas-wire" width={BULB_GAP} height="16" patternUnits="userSpaceOnUse">
                        <path
                            d={`M0 1 Q${BULB_GAP / 2} 9 ${BULB_GAP} 1`}
                            stroke="currentColor"
                            strokeWidth="1.2"
                            fill="none"
                        />
                        <rect x={BULB_GAP / 2 - 1.5} y="4" width="3" height="3" fill="currentColor" />
                    </pattern>
                </defs>
                <rect width="100%" height="16" fill="url(#christmas-wire)" />
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
