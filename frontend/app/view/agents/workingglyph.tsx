// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat's working dot as a small Jarvis hologram: two dashed rings turning opposite ways around a hot core, with
// sparks arcing out from the core to the outer ring now and then. It is SVG moved by pulsedriver.tsx's variables at
// 12fps, not CSS animations (pulse.ts says why): --spin on the svg turns the rings, each spark's --spark flashes it.
// Under reduced motion the driver writes nothing, so the rings stand still and the sparks stay out.

// A spark lying along +x from the core's edge to past the outer ring; each copy turns it to its own angle.
const SPARK = "11.2,9 12.6,8.1 13.7,9.9 15.1,8.4 16.2,9.5 17.4,8.9";

// angle, the pulse class (two periods so the flashes never settle into a beat), and how far behind it starts
const SPARKS = [
    { angle: -35, cls: "holo-spark", lag: 0 },
    { angle: 110, cls: "holo-spark-slow", lag: 700 },
    { angle: 220, cls: "holo-spark", lag: 520 },
] as const;

export function WorkingGlyph() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden
            className="holo-spin holo-glyph flex-none overflow-visible"
        >
            <g className="holo-ring-out">
                <circle
                    cx="9"
                    cy="9"
                    r="7.5"
                    stroke="var(--color-conn-1)"
                    strokeWidth="1"
                    strokeDasharray="9 3 3 3"
                    opacity="0.75"
                />
                {SPARKS.map((s) => (
                    <polyline
                        key={s.angle}
                        points={SPARK}
                        transform={`rotate(${s.angle} 9 9)`}
                        stroke="var(--color-accent-100)"
                        strokeWidth="0.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={s.cls}
                        data-pulse-lag={s.lag}
                    />
                ))}
            </g>
            <circle
                className="holo-ring-in"
                cx="9"
                cy="9"
                r="4.75"
                stroke="var(--color-conn-1)"
                strokeWidth="1.25"
                strokeDasharray="6 2.5"
            />
            <circle className="pulse-soft" cx="9" cy="9" r="2.2" fill="var(--color-accent-100)" />
        </svg>
    );
}
