// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat's working dot as a small Jarvis hologram, live with current: two dashed rings turning opposite ways around a
// core that flickers, bolts striking out from the core past the outer ring, each at a new angle, length and zigzag,
// and now and then the whole dot jolts a pixel and flares. It is SVG moved by pulsedriver.tsx's variables at 12fps,
// not CSS animations (pulse.ts says why): --spin on the svg turns the rings, --jolt on the group shakes it, --flick
// on the core flickers it, and each bolt's --arc (where it strikes) and --spark (its flash). Under reduced motion the
// driver writes nothing, so the rings stand still, the core is steady and no bolt shows.

// A bolt lying along +x from the core's edge to past the outer ring; its group turns it, its own scale stretches and
// bends it (tailwindsetup.css .holo-spark).
const SPARK = "11.2,9 12.6,8.1 13.7,9.9 15.1,8.4 16.2,9.5 17.4,8.9";

// a base angle each, so two bolts on the same period never strike the same way; the flash class and the strike class
// share a period, and a group and its bolt share a lag, so a bolt moves only between its flashes
const SPARKS = [
    { angle: -35, cls: "holo-spark", arc: "holo-arc", lag: 0 },
    { angle: 110, cls: "holo-spark-slow", arc: "holo-arc-slow", lag: 700 },
    { angle: 220, cls: "holo-spark", arc: "holo-arc", lag: 520 },
    { angle: 300, cls: "holo-spark-slow", arc: "holo-arc-slow", lag: 1_300 },
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
            <g className="holo-jolt">
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
                </g>
                {SPARKS.map((s) => (
                    <g key={s.angle} transform={`rotate(${s.angle} 9 9)`}>
                        <g className={s.arc} data-pulse-lag={s.lag}>
                            <polyline
                                points={SPARK}
                                stroke="var(--color-accent-100)"
                                strokeWidth="0.9"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={s.cls}
                                data-pulse-lag={s.lag}
                            />
                        </g>
                    </g>
                ))}
                <circle
                    className="holo-ring-in"
                    cx="9"
                    cy="9"
                    r="4.75"
                    stroke="var(--color-conn-1)"
                    strokeWidth="1.25"
                    strokeDasharray="6 2.5"
                />
                <circle className="holo-core" cx="9" cy="9" r="2.2" fill="var(--color-accent-100)" />
            </g>
        </svg>
    );
}
