// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The class strings every Brief region repeats, lifted from the design verbatim
// (docs/prototype/jarvis-brief-editing.dc.html) so the regions cannot drift apart again.

export const REGION_LABEL = "flex-none text-[10.5px] font-bold uppercase tracking-[.1em]";
export const META_TEXT = "text-[10.5px] tabular-nums text-ink-mid";
export const FAINT_TEXT = "text-[10.5px] tabular-nums text-muted";
// a Brief row: rounded, a faint bottom rule, the hover fill
export const ROW_BORDER = "rounded-[9px] border-b border-edge-faint px-[11px]";
// the bordered control: "Show 2 archived", "+14 runs older than 7 days"
export const LINK_BTN =
    "cursor-pointer self-start rounded-[6px] border border-border px-2.5 py-1 text-[10.5px] font-medium text-accent-soft hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
// the row action buttons: Open / Stop
export const SMALL_BTN =
    "cursor-pointer rounded-[6px] border border-border bg-surface-raised px-2 py-[3px] text-[10.5px] font-semibold text-secondary hover:border-edge-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export type Tone = "ok" | "active" | "asking" | "error" | "muted" | "faint";
export const TONE_TEXT: Record<Tone, string> = {
    ok: "text-success",
    active: "text-accent-soft",
    asking: "text-asking",
    error: "text-error",
    muted: "text-ink-mid",
    faint: "text-muted",
};

// The j/k cursor. A ring rather than a fill: the cursor says "the keys are here", not "this is
// selected", and the rows carry their own tone (a waiting row is already asking-coloured) which a
// background swap would overwrite. Inset, because the Waiting rows sit in the reveal's overflow-hidden
// wrapper, which cuts an outer ring down to its four rounded corners.
export const CURSOR_RING = "ring-1 ring-inset ring-accent/70";

// every row takes the same attrs, so the scroller can find the cursor
export function cursorAttrs(focused: boolean) {
    return { "data-jarvis-brief-cursor": focused ? "true" : undefined };
}
