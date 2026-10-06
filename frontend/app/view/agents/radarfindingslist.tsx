// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { composerReveal } from "@/app/element/motiontokens";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { useAtom } from "jotai";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { ambientRefForFinding } from "./ambient";
import { AmbientTags } from "./ambientviews";
import {
    findingMode,
    GROUP_ORDER,
    groupFindings,
    groupMeta,
    investigationView,
    isMutedGroup,
    missedLatestScan,
    MODE_META,
    strengthPips,
    subsystemLabel,
    type RadarGroup,
} from "./radarmodel";
import { radarOpenGroupsAtom } from "./radarstore";
import { INVESTIGATION_TEXT, modeBadge, severityPill, TONE_DOT, TONE_TEXT } from "./radarstyles";

export function StrengthPips({ strength, tall }: { strength: string; tall?: boolean }) {
    const filled = strengthPips(strength);
    return (
        <span title={`${strength} evidence`} className="flex flex-none gap-0.5">
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    className={cn(
                        "w-[3px] rounded-[1px]",
                        tall ? "h-[11px]" : "h-2.5",
                        i < filled ? "bg-accent-soft" : "bg-edge-strong"
                    )}
                />
            ))}
        </span>
    );
}

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="rounded border border-edge-strong px-[5px] font-mono text-[10.5px] text-ink-mid">
            {children}
        </kbd>
    );
}

export function RadarFindingsList({
    reportId,
    findings,
    selectedId,
    onSelect,
    onActivate,
    activateLabel,
}: {
    reportId: string; // the report the findings belong to, for Space's peek
    findings: RadarFinding[];
    selectedId: string | undefined;
    onSelect: (id: string) => void;
    onActivate?: () => void; // list-nav Enter: the selected finding's primary action
    activateLabel?: string;
}) {
    const grouped = useMemo(() => groupFindings(findings), [findings]);
    const [open, setOpen] = useAtom(radarOpenGroupsAtom);
    const toggle = (g: RadarGroup) =>
        setOpen((prev) => {
            const next = new Set(prev);
            next.has(g) ? next.delete(g) : next.add(g);
            return next;
        });
    // publish only the *rendered* order (open groups) for global j/k list-nav, so the cursor never lands
    // on a row hidden inside a collapsed group. cursor==selection. (listnav.ts)
    const navIds = useMemo(
        () => GROUP_ORDER.filter((g) => open.has(g)).flatMap((g) => grouped[g].map((f) => f.id)),
        [grouped, open]
    );
    const listNav = useMemo<ListNavController>(
        () => ({
            surface: "radar",
            navigableIds: navIds,
            cursorId: selectedId,
            setCursor: onSelect,
            activate: onActivate,
            peekTarget: () => (selectedId != null ? { kind: "radar", reportId, findingId: selectedId } : null),
        }),
        [navIds, selectedId, onSelect, onActivate, reportId]
    );
    useSurfaceListNav(listNav);
    // a lens tag only tells rows apart when the list mixes lenses
    const mixedModes = new Set(findings.map(findingMode)).size > 1;

    return (
        <div className="flex w-[384px] flex-none flex-col border-r border-edge-faint">
            <div className="min-h-0 flex-1 overflow-y-auto pb-2.5 pt-1">
                {GROUP_ORDER.map((g) => {
                    const items = grouped[g];
                    if (items.length === 0) {
                        return null;
                    }
                    const meta = groupMeta(g);
                    const isOpen = open.has(g);
                    return (
                        <div key={g} className="flex flex-col">
                            <button
                                type="button"
                                aria-expanded={isOpen}
                                onClick={() => toggle(g)}
                                className="flex items-center gap-2 px-4 pb-1.5 pt-3 text-left"
                            >
                                {isOpen ? (
                                    <ChevronDown className="h-3 w-3 text-muted" />
                                ) : (
                                    <ChevronRight className="h-3 w-3 text-muted" />
                                )}
                                <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[meta.tone])} />
                                <span className={cn(REGION_LABEL, TONE_TEXT[meta.tone])}>{meta.label}</span>
                                <span className="text-[10.5px] tabular-nums text-muted">{items.length}</span>
                                <span className="flex-1" />
                                <span className="text-[11px] text-muted">{meta.hint}</span>
                            </button>
                            <AnimatePresence initial={false}>
                                {isOpen ? (
                                    <motion.div
                                        key="items"
                                        variants={composerReveal}
                                        initial="initial"
                                        animate="animate"
                                        exit="exit"
                                        className="flex flex-col gap-px overflow-hidden px-2"
                                    >
                                        {items.map((f) => (
                                            <FindingRow
                                                key={f.id}
                                                finding={f}
                                                active={selectedId === f.id}
                                                showMode={mixedModes && findingMode(f) !== "correctness"}
                                                onSelect={onSelect}
                                            />
                                        ))}
                                    </motion.div>
                                ) : null}
                            </AnimatePresence>
                        </div>
                    );
                })}
            </div>
            <div className="flex flex-none items-center gap-4 border-t border-edge-faint px-4 py-[9px] text-[11px] text-muted">
                <span className="flex items-center gap-1.5">
                    <span className="flex gap-[3px]">
                        <Kbd>j</Kbd>
                        <Kbd>k</Kbd>
                    </span>
                    move
                </span>
                {activateLabel ? (
                    <span className="flex items-center gap-1.5">
                        <Kbd>↵</Kbd>
                        {activateLabel}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function FindingRow({
    finding: f,
    active,
    showMode,
    onSelect,
}: {
    finding: RadarFinding;
    active: boolean;
    showMode: boolean;
    onSelect: (id: string) => void;
}) {
    const iv = investigationView(f);
    const mode = findingMode(f);
    return (
        <button
            type="button"
            aria-current={active}
            onClick={() => onSelect(f.id)}
            className={cn(
                "flex flex-col gap-[7px] rounded-lg px-2.5 pb-2.5 pt-[9px] text-left transition-colors duration-150",
                active ? "bg-surface-selected ring-1 ring-inset ring-accent/45" : "hover:bg-surface-hover",
                isMutedGroup(f.group) && !active && "opacity-[0.62]"
            )}
        >
            <span
                className={cn(
                    "line-clamp-2 text-[13px] font-medium leading-[1.42] text-pretty",
                    active ? "text-primary" : "text-ink-hi"
                )}
            >
                {f.risk}
            </span>
            <span className="flex min-w-0 items-center gap-2">
                <span
                    className={cn(
                        "flex-none rounded px-1.5 py-px text-[10.5px] font-bold uppercase tracking-[0.06em]",
                        severityPill(f.severity)
                    )}
                >
                    {f.severity}
                </span>
                {showMode ? (
                    <span
                        className={cn(
                            "flex-none rounded border px-[5px] text-[10.5px] font-bold uppercase tracking-[0.06em]",
                            modeBadge(mode)
                        )}
                    >
                        {MODE_META[mode].short}
                    </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {subsystemLabel(f.subsystem)}
                </span>
                <AmbientTags {...ambientRefForFinding(f)} />
                {missedLatestScan(f) ? (
                    <span className="flex-none text-[11px] text-muted">not detected this scan</span>
                ) : null}
                {iv ? (
                    <span className={cn("flex-none text-[11px] font-semibold", INVESTIGATION_TEXT[iv.tone])}>
                        {iv.rowLabel}
                    </span>
                ) : null}
                <StrengthPips strength={f.strength} />
            </span>
        </button>
    );
}
