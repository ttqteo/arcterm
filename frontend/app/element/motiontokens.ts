// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Single source of truth for cockpit motion. Feel = "Fluid" (calm): macro moments
// ~360ms on a gentle ease-out; micro-interactions stay fast. See
// docs/superpowers/specs/2026-07-03-cockpit-motion-system-design.md.
import type { Transition, Variants } from "motion/react";

export const MOTION = {
    durMacro: 0.36, // entrances, reflow
    durMicro: 0.14, // feedback, composer reveal
    durExit: 0.28, // exits leave a touch quicker than they arrive
    durTip: 0.09, // a hover tooltip: there before the eye arrives, never a wait
    easeFluid: [0.22, 1, 0.36, 1] as [number, number, number, number],
    // Anything that changes shape (a box's height, a panel's scale, a row opening). A spring keeps its velocity when
    // its target moves mid-way, so a fast change never stalls or jumps the way a fixed-duration tween does. No bounce;
    // it settles in ~durMacro. Opacity stays on easeFluid: a spring on opacity overshoots past 1.
    spring: { type: "spring", visualDuration: 0.35, bounce: 0 } satisfies Transition,
} as const;

// Card entrance/exit. IMPORTANT: opacity + scale only — never x/y. Reorder.Item
// owns the x/y transform for drag + reorder; animating y here fights it.
export const cardVariants: Variants = {
    initial: { opacity: 0, scale: 0.97 },
    animate: { opacity: 1, scale: 1, transition: { duration: MOTION.durMacro, ease: MOTION.easeFluid } },
    exit: { opacity: 0, scale: 0.96, transition: { duration: MOTION.durExit, ease: MOTION.easeFluid } },
};

// Modal open/close (shared-modals surface). Scrim cross-fades; blur is static (animating
// backdrop-filter is a perf trap). Panel reuses the card entrance signature (moment 1).
export const modalBackdrop: Variants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
    exit: { opacity: 0, transition: { duration: MOTION.durExit, ease: MOTION.easeFluid } },
};

// Panel reuses moment 1's opacity+scale signature — one source of feel for cards and modals.
export const modalPanel = cardVariants;

// Sheet reveal (Jarvis detail sheet). A right-pinned full-height drawer slides in from the edge it is
// pinned to: a layer arriving from off-screen reads as navigation, where a centered scale reads as a
// dialog. x is safe here — cardVariants bans it because Reorder.Item owns that transform on cockpit
// cards, and a sheet has no such owner.
export const sheetPanel: Variants = {
    initial: { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0, transition: { duration: MOTION.durMacro, ease: MOTION.easeFluid } },
    exit: { opacity: 0, x: 24, transition: { duration: MOTION.durExit, ease: MOTION.easeFluid } },
};

// Lift on grab (moment 8). Drop-settle is the Reorder.Item dragTransition already in place.
// Black shadow alpha (not a brand color) — matches the existing shadow-[...rgba(0,0,0,...)] usage.
export const reorderLift = { scale: 1.02, boxShadow: "0 12px 30px rgba(0,0,0,0.45)" };

// Composer reveal (moment 6): expand height + fade in.
export const composerReveal: Variants = {
    initial: { opacity: 0, height: 0 },
    animate: { opacity: 1, height: "auto", transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
    exit: { opacity: 0, height: 0, transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
};

// Spring reveal: composerReveal / paneReveal on MOTION.spring. The height opens 0 -> auto on the spring while opacity
// fades on the micro ease, so a row arriving in a stuck-to-bottom feed grows rather than jumps. Chat's rows, parts and
// folds use it; other surfaces keep their tween reveals.
export const springReveal: Variants = {
    initial: { opacity: 0, height: 0 },
    animate: {
        opacity: 1,
        height: "auto",
        transition: { height: MOTION.spring, opacity: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
    },
    exit: {
        opacity: 0,
        height: 0,
        transition: { height: MOTION.spring, opacity: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
    },
};

// Spring pop: popoverReveal's signature on the spring, for a panel that scales in from the edge it is anchored to
// (set transform-origin per site: the suggestion panel scales from its bottom edge). Opacity + scale only, never x/y.
export const springPop: Variants = {
    initial: { opacity: 0, scale: 0.97 },
    animate: {
        opacity: 1,
        scale: 1,
        transition: { scale: MOTION.spring, opacity: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
    },
    exit: {
        opacity: 0,
        scale: 0.97,
        transition: { scale: MOTION.spring, opacity: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
    },
};

// Fold in x: composerReveal's signature on the horizontal axis, plus a 0.96 scale. A composer part (a chip, the mode
// chip, the wake button) folding into or out of a row of siblings: the width opens or closes the gap the neighbours
// slide across, and the scale keeps the part from reading as a wipe. Never x/y/height, so a part never shifts the row's
// height or fights a transform something else owns.
export const foldX: Variants = {
    initial: { opacity: 0, scale: 0.96, width: 0 },
    animate: { opacity: 1, scale: 1, width: "auto", transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
    exit: { opacity: 0, scale: 0.96, width: 0, transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
};

// Sent rise: the message the person just sent rising into the chat from the composer below it, so the eye follows
// it from the box to the log. y is safe here: a chat row has no Reorder.Item owning its transform. Scales from the
// bubble's tail corner (set transform-origin per site); arrive only, the row never leaves this way.
export const sentRise: Variants = {
    initial: { opacity: 0, y: 18, scale: 0.96 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: MOTION.durMacro, ease: MOTION.easeFluid } },
};

// Pane reveal: composerReveal's signature on the macro duration. A composer strip is a few dozen
// pixels, so durMicro reads as a reveal there; a disclosure pane is several hundred, and the same
// 140ms on this ease covers ~90% of that distance in two frames — indistinguishable from a snap.
export const paneReveal: Variants = {
    initial: { opacity: 0, height: 0 },
    animate: { opacity: 1, height: "auto", transition: { duration: MOTION.durMacro, ease: MOTION.easeFluid } },
    exit: { opacity: 0, height: 0, transition: { duration: MOTION.durExit, ease: MOTION.easeFluid } },
};

// Fold reveal: paneReveal for a list that folds under its header (the agent sidebar's sections and project
// folders). It clips only while it moves, so a row's focus ring past the list's edge shows once it has opened.
export const foldReveal: Variants = {
    initial: { opacity: 0, height: 0, overflow: "hidden" },
    animate: {
        opacity: 1,
        height: "auto",
        overflow: "hidden",
        transition: { duration: MOTION.durMacro, ease: MOTION.easeFluid },
        transitionEnd: { overflow: "visible" },
    },
    exit: {
        opacity: 0,
        height: 0,
        overflow: "hidden",
        transition: { duration: MOTION.durExit, ease: MOTION.easeFluid },
    },
};

// Indicator slide: a shared-layout (layoutId) bar moving between sibling tabs. durMacro because easeFluid
// front-loads the travel, so the bar arrives in the first frames and the rest is settle; durMicro over a long
// jump reads as a snap. Named for the pattern so another tab strip can reuse it.
export const indicatorSlide: Transition = { duration: MOTION.durMacro, ease: MOTION.easeFluid };

// View swap: a pane trading what it shows (the next question, the design, another step). Opacity only, since a
// whole pane scaling reads as a zoom; no exit, so the old view leaves at once and two never stack in the flow.
export const viewFade: Variants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: MOTION.durMacro, ease: MOTION.easeFluid } },
};

// Layer fade: a whole layer fading over another one that stays mounted under it (the chat over the terminal).
// Opacity only, like viewFade, but unlike viewFade it has an exit: the layer underneath is already there, so the
// leaving one cannot stack in the flow. The exit also stops taking pointer events at once, so a layer on its way
// out never takes a click or a key meant for the one beneath.
export const layerFade: Variants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: MOTION.durMacro, ease: MOTION.easeFluid } },
    exit: {
        opacity: 0,
        pointerEvents: "none",
        transition: { duration: MOTION.durExit, ease: MOTION.easeFluid },
    },
};

// Micro swap: one small mark trading for another in place (a status glyph, copy -> copied). Opacity only and
// micro both ways, so the old mark and the new one overlap briefly instead of blinking through an empty frame.
export const microFade: Variants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
    exit: { opacity: 0, transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
};

// Popover / dropdown reveal. Opacity + scale only (never x/y — consistent with cardVariants); the
// panel scales from its anchor corner via a per-site transform-origin. Snappy in and out — a dropdown
// dismiss should not linger.
export const popoverReveal: Variants = {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
    exit: { opacity: 0, scale: 0.96, transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid } },
};

// Hover tooltip reveal (titletiphost.tsx). Opacity + scale from the side facing the anchor, open only: a tip
// leaves at once, so sweeping the pointer along a toolbar never trails a fading one behind it.
export const tooltipReveal: Variants = {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: { duration: MOTION.durTip, ease: MOTION.easeFluid } },
};

// Narration burst guard (moment 5): only prose/user turns fade in. Tool-action bursts
// never animate, so a fast stream of tool lines cannot strobe.
const NARRATED_KINDS = new Set(["message", "user"]);
export function shouldFadeEntry(kind: string): boolean {
    return NARRATED_KINDS.has(kind);
}

// CSS-transition form of easeFluid (Framer wants the array; CSS `transition:` wants the string).
export const easeFluidCss = `cubic-bezier(${MOTION.easeFluid.join(", ")})`;

// Disclosure chevron turn: pair with `transition-transform motion-reduce:transition-none` on the icon. Only the
// timing lives here, so reduced motion (transition-property: none) still wins over the inline style.
export const turnTransition = { transitionDuration: `${MOTION.durMicro}s`, transitionTimingFunction: easeFluidCss };

// Completion settle (moment 4): the one-shot `@keyframes settle` in tailwindsetup.css, gated by useSettle. A
// literal so Tailwind's scanner sees the class; 0.5s matches useSettle's hold.
export const settleClass = "animate-[settle_0.5s_ease-out] motion-reduce:animate-none";

// No-cascade entrance guard (shared by Channels, Files, and future list surfaces). Switching the
// active `key` (channel / files source / …) reseeds silently so a whole-list swap never cascades;
// only ids that arrive while the key is unchanged animate in. Pure — callers hold the returned
// state in a ref. See docs/superpowers/specs/2026-07-04-files-diff-motion-design.md.
export interface EntranceState {
    key: string | undefined;
    seen: Set<string>;
}

export function initialEntranceState(): EntranceState {
    return { key: undefined, seen: new Set() };
}

export function computeEntrances(
    prev: EntranceState,
    key: string | undefined,
    ids: string[]
): { animate: Set<string>; state: EntranceState } {
    if (key !== prev.key) {
        return { animate: new Set(), state: { key, seen: new Set(ids) } };
    }
    const animate = new Set<string>();
    const seen = new Set(prev.seen);
    for (const id of ids) {
        if (!seen.has(id)) {
            animate.add(id);
            seen.add(id);
        }
    }
    return { animate, state: { key, seen } };
}

// Chip-driven reflow props (shared by Sessions and Activity). `animated` = a user filter changed the
// list (chips) → play enter/exit + the fluid macro reflow. `false` = a silent, zero-duration layout snap
// (Sessions' search path; Activity's first populate). Maps the decision to the Framer props a reflowing
// list item spreads. See docs/superpowers/specs/2026-07-04-activity-motion-design.md.
export interface ReflowProps {
    initial: string | false;
    exit: string | undefined;
    transition: Transition;
}

export function reflowProps(animated: boolean): ReflowProps {
    if (animated) {
        return {
            initial: "initial",
            exit: "exit",
            transition: { duration: MOTION.durMacro, ease: MOTION.easeFluid },
        };
    }
    return { initial: false, exit: undefined, transition: { duration: 0 } };
}
