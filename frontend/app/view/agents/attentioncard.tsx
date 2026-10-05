// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The 4b "attention" treatment (Wave-attention-4b.dc.html · TURN 4b, "solid callout banner"). A "needs
// you" surface reads as a neutral card carrying one filled-amber banner strip — not a warm-washed card.
// Amber lives only in the banner (bg-warning / text-on-warning, full contrast); the body sits on the
// neutral lane surface with normal light text. Shared so every attention surface (cockpit grid card,
// channel escalation, runs review gate, runs clarify/fork) reads identically. Tokens only — no raw hex.

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import type { ReactNode } from "react";

// The amber banner strip: a leading glyph (◆ diamond, or a pulsing dot for a live ask), an uppercase
// label, optional meta (elapsed), and an optional right-aligned slot (e.g. a BannerChip). Ink is
// on-warning throughout; dimmer meta uses on-warning at reduced opacity so we never introduce an
// off-palette "dim amber ink".
export function AttentionBanner({
    label,
    meta,
    right,
    pulse,
    glyph = "dot",
    className,
}: {
    label: string;
    meta?: string;
    right?: ReactNode;
    pulse?: boolean;
    glyph?: "dot" | "diamond";
    className?: string;
}) {
    return (
        <div className={cn("flex shrink-0 items-center gap-2 bg-warning px-3.5 py-2", className)}>
            {glyph === "diamond" ? (
                <span className="shrink-0 text-[11px] leading-none text-on-warning">◆</span>
            ) : (
                <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full bg-on-warning", pulse && "pulse-dot")} />
            )}
            <span className={cn(REGION_LABEL, "text-on-warning")}>{label}</span>
            {meta ? <span className="text-[10.5px] font-semibold tabular-nums text-on-warning/60">{meta}</span> : null}
            <div className="min-w-[6px] flex-1" />
            {right}
        </div>
    );
}

// A right-aligned chip that reads on the amber banner (e.g. "3/5 tasks"): dark ink on a faint dark tint.
export function BannerChip({ children }: { children: ReactNode }) {
    return (
        <span className="shrink-0 rounded-[5px] border border-on-warning/20 bg-on-warning/10 px-1.5 py-px text-[10.5px] font-bold tabular-nums text-on-warning">
            {children}
        </span>
    );
}

// The neutral card shell: lane surface, amber hairline border, rounded + clipped so the banner's top
// corners follow the radius. `glow` adds the existing breathing drop-shadow for an unanswered ask
// (moment-3 attention). Compose AttentionBanner as its first child.
export function AttentionCard({
    glow,
    className,
    children,
}: {
    glow?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                "overflow-hidden rounded-[13px] border border-warning/40 bg-lane",
                glow && "animate-[breatheGlow_2.4s_ease-in-out_infinite] motion-reduce:animate-none",
                className
            )}
        >
            {children}
        </div>
    );
}
