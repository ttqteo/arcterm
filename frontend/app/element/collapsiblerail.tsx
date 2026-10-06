// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reusable right-rail: a thin always-visible strip that expands to a 300px (or caller-given width) scroll panel.
// Content-agnostic — callers pass a list of {icon,label,content} sections and a caller-owned
// openAtom (so each surface keeps its own persistence/default). Owns width, border, and the
// width-reveal animation. Collapsed, it shows a single expand button (the first section's icon
// represents the rail) — one affordance, since per-section jump anchors all just opened the panel.
// See docs/superpowers/specs/2026-07-03-collapsible-rail-and-cockpit-motion-gaps-design.md.

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useAtom, type PrimitiveAtom } from "jotai";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/util/util";
import { MOTION } from "./motiontokens";
import {
    railSectionOpenAtom,
    sectionExpandable,
    sectionOpen,
    toggleSection,
    type RailSectionHeader,
} from "./railsections";
import { Tooltip } from "./tooltip";

export interface RailSection {
    id: string;
    icon: ReactNode; // the first section's icon is the rail's collapsed glyph; others are unused for now
    label: string; // in-content headings are caller-owned, unless `header` is set
    content: ReactNode;
    // when set, the rail draws the section's header row and owns open/closed; the caller's content then
    // carries no heading of its own
    header?: RailSectionHeader;
}

function HeadedSection({ section, header }: { section: RailSection; header: RailSectionHeader }) {
    const [stored, setStored] = useAtom(railSectionOpenAtom);
    const expandable = sectionExpandable(header);
    const open = sectionOpen(stored, section.id, header);
    return (
        <section data-rail-section={section.id} data-open={open ? "true" : "false"}>
            {/* the button sits inside the heading, so a screen reader still lists the section by its label */}
            <h3 className="text-[12px] font-medium">
                <button
                    type="button"
                    disabled={!expandable}
                    aria-expanded={expandable ? open : undefined}
                    aria-controls={expandable ? `rail-section-${section.id}` : undefined}
                    onClick={() => setStored(toggleSection(stored, section.id, header))}
                    className={cn(
                        "group flex w-full items-center gap-[8px] rounded-[6px] py-[5px] text-left",
                        expandable ? "cursor-pointer text-muted hover:text-secondary" : "cursor-default text-ink-faint"
                    )}
                >
                    {section.label}
                    {header.count != null ? (
                        <span className="text-[11px] tabular-nums text-ink-faint">{header.count}</span>
                    ) : null}
                    <ChevronRight
                        size={12}
                        aria-hidden
                        className={cn(
                            "text-ink-faint transition-transform",
                            open && "rotate-90",
                            !expandable && "invisible"
                        )}
                    />
                </button>
            </h3>
            {open ? (
                <div id={`rail-section-${section.id}`} className="pb-[10px] pt-[8px]">
                    {section.content}
                </div>
            ) : null}
        </section>
    );
}

// An extra glyph in the rail's icon slot — a trigger for a *sibling* drawer (e.g. the Jarvis profile
// drawer under the channel context rail), so both live in one 44px column instead of two side-by-side
// strips. The sibling stays a separate drawer; only the icon is here. Drawn in both rail states: stacked
// under the rail's own icon while collapsed, and beside the collapse control in the header band while
// expanded — a rail that opens by default would otherwise hide its sibling's only trigger.
export interface RailExtraIcon {
    key: string;
    icon: ReactNode;
    ariaLabel: string;
    onClick: () => void;
}

// same glyph, same size, same tone in both rail states: it is one control, and collapsing the rail must
// not read as swapping it for another.
function ExtraIcon({ ei }: { ei: RailExtraIcon }) {
    return (
        <Tooltip content={ei.ariaLabel} placement="left">
            <button
                type="button"
                onClick={ei.onClick}
                aria-label={ei.ariaLabel}
                title={ei.ariaLabel}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] text-[18px] text-accent hover:bg-surface-hover hover:text-accent-soft"
            >
                {ei.icon}
            </button>
        </Tooltip>
    );
}

// one control per tab on the collapsed strip, above the strip's own content
export interface RailStripTab {
    key: string;
    icon: ReactNode;
    ariaLabel: string;
    onClick: () => void;
    badge?: number;
}

const RAIL_EXPANDED_PX = 300; // matches the app-bar usage column (app-bar.tsx) → continuous divider
const RAIL_COLLAPSED_PX = 44;

export function CollapsibleRail({
    openAtom,
    sections,
    footer,
    ariaLabel,
    title,
    extraIcons,
    hideWhenCollapsed,
    forceCollapsed,
    strip,
    width,
    tabs,
    body,
    stripTabs,
    edge,
}: {
    openAtom: PrimitiveAtom<boolean>;
    sections: RailSection[];
    footer?: ReactNode;
    ariaLabel?: string;
    // when given, the collapse control sits in a titled header band of the same height and rule as the
    // calling surface's other column headers, instead of a bare chevron row of its own height. Opt-in per
    // caller: the surfaces that have not had their header bands measured keep today's look.
    title?: string;
    extraIcons?: RailExtraIcon[];
    // when true, the rail shows no collapsed strip (it animates to zero width): its glyph lives in a
    // sibling rail's extraIcons, so this drawer only takes space while open. Preserves the slide.
    hideWhenCollapsed?: boolean;
    // when true, the rail is fully hidden (zero width, no strip) regardless of `open`: a sibling drawer
    // has taken the shared right-edge slot, so this rail slides out of the way instead of stacking
    // beside it. The width animation is preserved so it collapses as the sibling expands.
    forceCollapsed?: boolean;
    // what the collapsed strip's expand control shows instead of the first section's icon: a caller that
    // wants the rail's key figures readable while it is closed. The title is the control's tooltip.
    strip?: { content: ReactNode; title: string };
    // the open width; 300 when absent
    width?: number;
    // a tab strip in place of the bare collapse row: the 44px band and rule of a titled header, the collapse chevron
    // at its end
    tabs?: ReactNode;
    // replaces the sections' scroll column, for a tab that owns the whole panel body
    body?: ReactNode;
    stripTabs?: RailStripTab[];
    // laid over the panel's left edge while it is open (a resize grip)
    edge?: ReactNode;
}) {
    const [open, setOpen] = useAtom(openAtom);
    const collapsedWidth = hideWhenCollapsed ? 0 : RAIL_COLLAPSED_PX;
    const railWidth = forceCollapsed ? 0 : open ? (width ?? RAIL_EXPANDED_PX) : collapsedWidth;
    // only opening and collapsing slide: a width change while open (Overview to a wide tab) is one layout commit, so
    // the centre's terminal sees one PTY resize instead of one per animation frame
    const prevMode = useRef({ open, forceCollapsed });
    const slide = prevMode.current.open !== open || prevMode.current.forceCollapsed !== forceCollapsed;
    useEffect(() => {
        prevMode.current = { open, forceCollapsed };
    });
    const headed = sections.some((s) => s.header != null);

    const collapseButton = (
        <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Collapse panel"
            title="Collapse"
            className="flex cursor-pointer items-center rounded-[7px] px-2 py-1 text-[14px] leading-none text-muted hover:bg-surface-hover hover:text-secondary"
        >
            <ChevronRight size={16} aria-hidden />
        </button>
    );

    return (
        <MotionConfig reducedMotion="user">
            <motion.aside
                aria-label={ariaLabel}
                initial={false}
                animate={{ width: railWidth }}
                transition={slide ? { duration: MOTION.durMacro, ease: MOTION.easeFluid } : { duration: 0 }}
                className={cn(
                    "relative flex h-full shrink-0 flex-col overflow-hidden bg-surface",
                    railWidth > 0 && "border-l border-border"
                )}
            >
                {open && !forceCollapsed && edge != null ? edge : null}
                {/* the content fades in under the width slide, so a swap between strip and panel reads as one
                    change instead of a snap clipped mid-slide; no exit, the outgoing content is already clipped */}
                <AnimatePresence initial={false}>
                    {forceCollapsed ? null : open ? (
                        <motion.div
                            key="panel"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: MOTION.durMacro, ease: MOTION.easeFluid }}
                            className="flex min-h-0 flex-1 flex-col"
                        >
                            {tabs != null ? (
                                <div className="flex h-11 shrink-0 items-stretch border-b border-border bg-surface pl-2 pr-1.5">
                                    {tabs}
                                    <div className="flex-1" />
                                    <div className="flex items-center gap-0.5">
                                        {extraIcons?.map((ei) => (
                                            <ExtraIcon key={ei.key} ei={ei} />
                                        ))}
                                        {collapseButton}
                                    </div>
                                </div>
                            ) : (
                                <div
                                    className={cn(
                                        "flex shrink-0 items-center",
                                        title != null
                                            ? "h-11 justify-between border-b border-border bg-surface px-[18px]"
                                            : "justify-end px-2 pt-2"
                                    )}
                                >
                                    {title != null ? (
                                        <span className="text-[9.5px] font-bold uppercase tracking-[.12em] text-muted">
                                            {title}
                                        </span>
                                    ) : null}
                                    {/* the extra glyphs group with the collapse control rather than being spread by
                                        justify-between: they are this edge's controls, and the title is the label. */}
                                    <div className="flex items-center gap-0.5">
                                        {extraIcons?.map((ei) => (
                                            <ExtraIcon key={ei.key} ei={ei} />
                                        ))}
                                        {collapseButton}
                                    </div>
                                </div>
                            )}
                            {body != null ? (
                                <div className="flex min-h-0 flex-1 flex-col">{body}</div>
                            ) : (
                                <div
                                    className={cn(
                                        "flex min-h-0 flex-1 flex-col overflow-y-auto px-[18px] pb-[40px] pt-[8px]",
                                        headed ? "gap-[4px]" : "gap-[24px]"
                                    )}
                                >
                                    {sections.map((s) =>
                                        s.header ? (
                                            <HeadedSection key={s.id} section={s} header={s.header} />
                                        ) : (
                                            <div key={s.id}>{s.content}</div>
                                        )
                                    )}
                                </div>
                            )}
                            {footer ? (
                                <div className="shrink-0 border-t border-border px-[18px] py-3">{footer}</div>
                            ) : null}
                        </motion.div>
                    ) : hideWhenCollapsed ? null : (
                        <motion.div
                            key="strip"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: MOTION.durMacro, ease: MOTION.easeFluid }}
                            className="flex flex-col items-center gap-1 pt-3"
                        >
                            {stripTabs?.map((t) => (
                                <button
                                    key={t.key}
                                    type="button"
                                    aria-label={t.ariaLabel}
                                    title={t.ariaLabel}
                                    onClick={t.onClick}
                                    className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] text-muted hover:bg-surface-hover hover:text-secondary"
                                >
                                    {t.icon}
                                    {t.badge ? (
                                        <span className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-2 border-surface bg-surface-selected px-[3px] text-[9.5px] font-bold tabular-nums leading-none text-primary">
                                            {t.badge}
                                        </span>
                                    ) : null}
                                </button>
                            ))}
                            {strip ? (
                                <button
                                    type="button"
                                    onClick={() => setOpen(true)}
                                    aria-label={ariaLabel ?? "Expand panel"}
                                    title={strip.title}
                                    className="flex w-[34px] cursor-pointer flex-col items-center gap-[8px] rounded-[8px] pb-[8px] pt-[7px] text-muted hover:bg-surface-hover hover:text-secondary"
                                >
                                    {strip.content}
                                </button>
                            ) : (
                                <Tooltip content={ariaLabel ?? "Expand"} placement="left">
                                    <button
                                        type="button"
                                        onClick={() => setOpen(true)}
                                        aria-label={ariaLabel ?? "Expand panel"}
                                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] text-[18px] text-accent hover:bg-surface-hover hover:text-accent-soft"
                                    >
                                        {sections[0]?.icon}
                                    </button>
                                </Tooltip>
                            )}
                            {extraIcons?.map((ei) => (
                                <ExtraIcon key={ei.key} ei={ei} />
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.aside>
        </MotionConfig>
    );
}
