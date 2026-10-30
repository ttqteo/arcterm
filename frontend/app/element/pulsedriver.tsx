// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Always-mounted (cockpit root) driver for the status-dot pulse. Renders nothing. A dot opts in with one of
// the PULSES classes (pulse.ts); every tick this sets each such dot's opacity (or its spec's prop) from its curve, so the pulse
// costs 12 frames a second instead of the display rate a CSS animation holds the page at. A 6px dot fading
// over 0.8s has no visible steps at 12fps.
//
// Each dot's phase starts when the driver first sees it, as a CSS animation's starts at mount; a dot that
// stops pulsing gets its own opacity back and restarts from the top if it pulses again.

import { useEffect } from "react";
import { PULSES, pulseOpacity, type PulseSpec } from "./pulse";

const PULSE_FRAME_MS = 1_000 / 12;
const DEFAULT_PROP = "opacity";
const SELECTOR = Object.keys(PULSES)
    .map((cls) => "." + cls)
    .join(",");

function specFor(el: Element): PulseSpec | undefined {
    for (const cls of Object.keys(PULSES)) {
        if (el.classList.contains(cls)) {
            return PULSES[cls];
        }
    }
    return undefined;
}

export function PulseDriver() {
    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
        const startedAt = new WeakMap<Element, number>();
        const shown = new WeakMap<Element, string>();
        // the property each element's curve went to, kept because a released element may have lost its class
        const written = new WeakMap<Element, string>();
        let active = new Set<HTMLElement>();

        const release = (el: HTMLElement) => {
            el.style.removeProperty(written.get(el) ?? DEFAULT_PROP);
            written.delete(el);
            startedAt.delete(el);
            shown.delete(el);
        };

        const tick = () => {
            const now = performance.now();
            const next = new Set<HTMLElement>();
            if (!reduce.matches) {
                for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
                    const spec = specFor(el);
                    if (spec == null) {
                        continue;
                    }
                    let start = startedAt.get(el);
                    if (start == null) {
                        start = now;
                        startedAt.set(el, start);
                    }
                    const value = pulseOpacity(spec, now - start).toFixed(3);
                    // an unchanged write would still invalidate the dot's style
                    if (shown.get(el) !== value) {
                        const prop = spec.prop ?? DEFAULT_PROP;
                        el.style.setProperty(prop, value);
                        written.set(el, prop);
                        shown.set(el, value);
                    }
                    next.add(el);
                }
            }
            for (const el of active) {
                if (!next.has(el)) {
                    release(el);
                }
            }
            active = next;
        };

        const timer = setInterval(tick, PULSE_FRAME_MS);
        return () => {
            clearInterval(timer);
            active.forEach(release);
        };
    }, []);
    return null;
}
