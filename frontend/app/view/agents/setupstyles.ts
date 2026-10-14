// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Class strings and motion the Setup tabs share (setupsurface.tsx, projectcontexttab.tsx).

import { MOTION } from "@/app/element/motiontokens";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";

export const SECTION_HEAD = cn(REGION_LABEL, "text-muted");
export const BTN_PRIMARY =
    "h-8 cursor-pointer rounded border-0 bg-accent px-[14px] text-[13px] font-bold text-background shadow-inset-highlight hover:bg-accenthover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent";
export const INPUT =
    "h-[30px] min-w-0 rounded-[7px] border border-edge-mid bg-background px-2.5 text-[13px] text-primary outline-none placeholder:text-muted focus:border-accent";
export const BTN_SECONDARY =
    "h-[30px] cursor-pointer rounded border border-edge-mid bg-surface-raised px-3 text-[12.5px] font-semibold text-ink-mid hover:border-edge-strong hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:text-ink-faint disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";

// a swapped tab or skill fades in rather than cutting; the outgoing one leaves at once, so a quick run of
// arrow keys through the skill list never queues exits
export const FADE_IN = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid },
};
