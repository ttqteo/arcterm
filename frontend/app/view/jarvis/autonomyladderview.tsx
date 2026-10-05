// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The autonomy control: how much Jarvis decides without you. AutonomyLadder is the Brief header's chip,
// stating the summary across projects, over a popover of the nested rungs and their blurbs. Autonomy is
// one policy for all work: a pick writes every project.
//
// Why a chip. The rungs used to sit in the header with a strip beside them that appeared only at the top
// tier — so selecting that tier grew the group ~140px and slid the rungs left, out from under the cursor
// that had just clicked one (this is JC12's cause, measured at a 0px title). Everything that changes size
// lives inside a popover anchored to the chip's right edge, so nothing moves under the pointer. It also
// brings the control to the header's own scale: 28px tall, like the buttons beside it, where the group
// was 41px in a 43px band.
//
// It lost its mount when B5 retired the three-pane composition and has been unreachable since — the tier
// is the remote-approval policy, so there was no way to see or change what Jarvis answers on your behalf.
// This is the re-home, and it is where a one-per-channel setting meets an all-work surface: the chip
// states briefautonomy's summary across projects, and the popover writes all of them.

import { PopoverReveal } from "@/app/element/popoverreveal";
import type { JarvisTier } from "@/app/view/agents/channelmessages";
import { setChannelTiers } from "@/app/view/agents/channelsstore";
import { projectListAtom } from "@/app/view/agents/projectsstore";
import { cn, fireAndForget } from "@/util/util";
import {
    autoUpdate,
    flip,
    offset,
    shift,
    useClick,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo } from "react";
import { autonomyPanelOpenAtom, LADDER, RUNG_BAR_PX, rungState } from "./autonomyladder";
import { autonomySummary, channelAutonomy } from "./briefautonomy";
import { briefUndo } from "./briefundo";

// The ladder itself, at whatever width its host wants: 3px in the chip's glyph, 4px in a panel row. Bars
// fill up to `tier`, so a row passed its own tier says what that tier includes — which makes the current
// row's glyph identical to the chip's, and the chip's glyph legible once you have opened the panel.
function RungBars({ tier, width }: { tier: JarvisTier; width: number }) {
    return (
        <span className="flex flex-none items-end gap-[2px]">
            {LADDER.map((rung, i) => (
                <span
                    key={rung.tier}
                    className={cn("rounded-[1px]", rungState(tier, rung.tier) === "off" ? "bg-edge-mid" : "bg-accent")}
                    style={{ width, height: RUNG_BAR_PX[i] }}
                />
            ))}
        </span>
    );
}

export function AutonomyLadder() {
    // one source for "is it open": the atom, because the keybinding layer reads the same state to hand
    // Escape to the panel (see autonomyladder.ts). Reset on unmount, or leaving the surface with the panel
    // open would keep Escape hostage on every other deep surface.
    const [open, setOpen] = useAtom(autonomyPanelOpenAtom);
    useEffect(() => () => setOpen(false), [setOpen]);
    const projectRows = useAtomValue(projectListAtom);
    const rows = useMemo(() => channelAutonomy(projectRows), [projectRows]);
    const summary = autonomySummary(rows);
    // every pick writes every project, so a mixed set collapses to one value; the toast's undo puts each
    // project's own tier back
    const apply = (tier: JarvisTier, toast: string) => {
        const prev = rows.map((r) => ({ channelId: r.channelId, tier: r.tier }));
        const changes = prev.map((p) => ({ ...p, tier }));
        fireAndForget(async () => {
            try {
                await setChannelTiers(changes);
                briefUndo.notify(toast, () => fireAndForget(() => setChannelTiers(prev)));
            } catch (e) {
                briefUndo.error(e instanceof Error ? e.message : String(e));
            }
        });
    };
    // bottom-end + useDismiss is the cockpit's popover pattern (settingssurface TermThemeDropdown): both
    // Escape and an outside click close it, where a hand-rolled backdrop only ever closed on click.
    // fixed, not absolute: an overflow container around the chip would clip an absolute panel.
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement: "bottom-end",
        strategy: "fixed",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);
    // no projects, no policy: a chip naming a tier over nothing is the header's version of an inert
    // control. Below the hooks, not above them — every hook this component has must run on every render.
    if (summary == null) {
        return null;
    }
    return (
        <div className="relative flex-none">
            <button
                ref={refs.setReference}
                {...getReferenceProps()}
                type="button"
                data-jarvis-autonomy="chip"
                aria-haspopup="dialog"
                aria-expanded={open}
                title="Autonomy — how much Jarvis decides without you"
                className={cn(
                    "flex h-[28px] flex-none cursor-pointer items-center gap-2 rounded-[8px] border bg-surface-raised pl-2.5 pr-[9px] text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    open
                        ? "border-accent-700 text-primary"
                        : "border-edge-mid text-secondary hover:border-edge-strong hover:text-primary"
                )}
            >
                <RungBars tier={summary.tier} width={3} />
                <span className="flex-1 whitespace-nowrap text-left">{summary.label}</span>
                <ChevronDown
                    aria-hidden
                    size={12}
                    strokeWidth={2}
                    className={cn("flex-none text-muted transition-transform", open && "rotate-180")}
                />
            </button>
            {/* rendered unconditionally and driven by `open` — a `{open ? … : null}` caller defeats
                PopoverReveal's AnimatePresence and the exit animation never plays. */}
            <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-20">
                <PopoverReveal
                    open={open}
                    origin="top right"
                    className="w-[300px] rounded-[11px] border border-border bg-surface p-[5px] shadow-popover-md"
                >
                    <div data-jarvis-autonomy="panel">
                        <div className="flex items-baseline gap-2 px-[9px] pb-1.5 pt-1">
                            <span className="flex-none text-[9px] font-semibold uppercase tracking-[.09em] text-muted">
                                Autonomy
                            </span>
                            {/* the backend tier is per-channel, so the panel says how far a pick reaches */}
                            <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted">
                                {rows.length === 1 ? "the one project" : `all ${rows.length} projects`}
                            </span>
                        </div>
                        {LADDER.map((rung) => {
                            // no rung is checked over a mixed set: none of them is the policy everywhere
                            const active = !summary.mixed && rung.tier === summary.tier;
                            return (
                                <button
                                    key={rung.tier}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => apply(rung.tier, `Autonomy set to ${rung.label} for every project`)}
                                    className={cn(
                                        "flex w-full cursor-pointer items-start gap-2.5 rounded px-[9px] py-2 text-left hover:bg-surface-hover",
                                        active ? "bg-surface-raised" : "bg-transparent"
                                    )}
                                >
                                    <span className="pt-[5px]">
                                        <RungBars tier={rung.tier} width={4} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span
                                            className={cn(
                                                "block text-[12.5px] font-semibold",
                                                active ? "text-accent" : "text-primary"
                                            )}
                                        >
                                            {rung.label}
                                        </span>
                                        {/* the blurbs were tooltip-only while the rungs were 70px wide; the
                                            panel is where they finally fit as text */}
                                        <span className="mt-[3px] block text-[11px] leading-[1.45] text-muted">
                                            {rung.blurb}
                                        </span>
                                    </span>
                                    {active ? (
                                        <span className="flex-none pt-[3px] text-[11px] text-accent">✓</span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                </PopoverReveal>
            </div>
        </div>
    );
}
