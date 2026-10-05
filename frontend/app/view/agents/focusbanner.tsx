// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Presence-C escape-hatch banner on a scoped surface (roster, Conversation History). "Show all" reveals the
// hidden rows for this surface without leaving the focus, and flips to "Hide the other N"; "Clear
// focus" leaves it. Copy is computed by focusBannerCopy (pure).

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Crosshair } from "lucide-react";
import type { FocusBannerCopy } from "./focusscope";
import { concealSurface, exitFocus, focusRestoredAtom, revealSurface, type RevealKey } from "./focusstore";
import { divergenceText, type DivergenceScope, type SubjectDecision } from "./focussubject";

const BANNER_BUTTON =
    "shrink-0 cursor-pointer rounded-sm px-2 py-1 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function FocusBanner({
    surface,
    copy,
    revealed,
}: {
    surface: RevealKey;
    copy: FocusBannerCopy;
    revealed: boolean;
}) {
    const restored = useAtomValue(focusRestoredAtom);
    const toggle = () => (revealed ? concealSurface(surface) : revealSurface(surface));
    return (
        <div
            role="status"
            data-focus-banner={surface}
            className={cn(
                "@container mx-1 mb-2 flex items-center gap-2.5 rounded-[8px] border py-1 pl-3 pr-1.5 text-[12.5px]",
                // revealed goes neutral: the rows on screen are no longer the focus's alone
                revealed ? "border-edge-strong bg-surface" : "border-accent/30 bg-accent/5"
            )}
        >
            <Crosshair
                size={14}
                strokeWidth={1.8}
                className={cn("shrink-0", revealed ? "text-muted" : "text-accent")}
            />
            <span className="min-w-0 flex-1 truncate text-ink-mid">
                {copy.lead}
                <span className="font-semibold text-primary">{copy.label}</span>
                {copy.trail}
            </span>
            {/* the counts matter more than the tag, so a narrow banner drops the tag rather than truncate them */}
            {restored ? (
                <span className="hidden shrink-0 rounded-full @2xl:inline bg-pill px-2 py-0.5 text-[11px] text-ink-mid">
                    kept from last session
                </span>
            ) : null}
            {copy.toggle != null ? (
                <button
                    type="button"
                    onClick={toggle}
                    className={cn(BANNER_BUTTON, "text-accent-soft hover:text-accent-100")}
                >
                    {copy.toggle}
                </button>
            ) : null}
            <button type="button" onClick={exitFocus} className={cn(BANNER_BUTTON, "text-ink-mid hover:text-primary")}>
                Clear focus
            </button>
        </div>
    );
}

// The subject-posture counterpart to FocusBanner. A subject surface hides nothing, so it needs a
// rejoin rather than a reveal — and it renders nothing at all when aligned, because the app bar
// already carries the global answer and silence is the reward for being in sync.
export function DivergenceBanner({
    scope,
    decision,
    onRejoin,
}: {
    scope: DivergenceScope;
    decision: SubjectDecision;
    onRejoin: () => void;
}) {
    if (decision.kind !== "diverged") {
        return null;
    }
    return (
        <div
            data-divergence-banner
            className="mx-1 mb-2 flex items-center gap-2.5 rounded-[8px] border border-edge-strong bg-surface py-1 pl-3 pr-1.5 text-[12.5px]"
        >
            <Crosshair size={14} strokeWidth={1.8} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-ink-mid">
                {divergenceText(scope, decision.focus, decision.local)}
            </span>
            <button
                type="button"
                data-divergence-rejoin
                onClick={onRejoin}
                className={cn(BANNER_BUTTON, "text-accent-soft hover:text-accent-100")}
            >
                {scope === "project" ? "Show the project" : "Show the focus"}
            </button>
        </div>
    );
}
