// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Santa hat every nav rail icon wears while the Christmas decor shows (docs/superpowers/specs/
// 2026-11-05-christmas-nav-icons-design.md, board A). Static, aria-hidden and catching no pointer; placed inside the
// icon's relatively positioned span, over its top-left corner, so the count badge (top right) and the working count
// (bottom right) stay clear. Off the theme, or with its effects off, it draws nothing and the rail is as before.
// The New agent dialog's Start column and the cockpit's empty state put the same hat on their marks; SantaHatSvg is
// the hat alone, ungated, which the Christmas theme chip in Settings → Appearance wears the way the Spider chip shows
// its spider.

import { cn } from "@/util/util";
import type { CSSProperties } from "react";
import { santaHatBox } from "./christmas";
import { useChristmasDecor } from "./christmasstore";

export function RailSantaHat({ iconSize }: { iconSize: number }) {
    const decorOn = useChristmasDecor();
    if (!decorOn) return null;
    const box = santaHatBox(iconSize);
    return (
        <SantaHatSvg
            size={box.size}
            data-rail-hat
            className="absolute -rotate-[18deg]"
            style={{ left: box.left, top: box.top }}
        />
    );
}

export function SantaHatSvg({
    size,
    className,
    style,
    ...data
}: {
    size: number;
    className?: string;
    style?: CSSProperties;
    [data: `data-${string}`]: unknown;
}) {
    return (
        <svg
            {...data}
            width={size}
            height={size}
            viewBox="0 0 14 14"
            aria-hidden="true"
            className={cn("pointer-events-none", className)}
            style={style}
        >
            {/* the lit-bulb red: the crimson fill reads as a dark smudge on the rail at 11px */}
            <path d="M2 10.5 7.5 2.5 12 10.5Z" className="fill-xmas-bulb" />
            <rect x="1" y="9.5" width="12" height="3" rx="1.5" className="fill-xmas-snow" />
            <circle cx="7.5" cy="2.2" r="1.7" className="fill-xmas-snow" />
        </svg>
    );
}
