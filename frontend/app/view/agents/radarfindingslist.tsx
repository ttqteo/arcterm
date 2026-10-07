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
import {
    findingSite,
    groupForList,
    investigationView,
    isNewFinding,
    LIST_GROUP_ORDER,
    listGroupMeta,
    shortSha,
    type RadarListGroup,
} from "./radarmodel";
import { radarOpenListGroupsAtom } from "./radarstore";
import { INVESTIGATION_TEXT, LIST_TONE_DOT, LIST_TONE_TEXT, severityPill } from "./radarstyles";

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
    const grouped = useMemo(() => groupForList(findings), [findings]);
    const [open, setOpen] = useAtom(radarOpenListGroupsAtom);
    const toggle = (g: RadarListGroup) =>
        setOpen((prev) => {
            const next = new Set(prev);
            if (!next.delete(g)) {
                next.add(g);
            }
            return next;
        });
    // publish only the *rendered* order (open groups) for global j/k list-nav, so the cursor never lands
    // on a row hidden inside a collapsed group. cursor==selection. (listnav.ts)
    const navIds = useMemo(
        () => LIST_GROUP_ORDER.filter((g) => open.has(g)).flatMap((g) => grouped[g].map((f) => f.id)),
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

    return (
        <div className="flex w-[384px] flex-none flex-col border-r border-edge-faint">
            <div className="min-h-0 flex-1 overflow-y-auto pb-2.5 pt-1">
                {LIST_GROUP_ORDER.map((g) => {
                    const items = grouped[g];
                    if (items.length === 0) {
                        return null;
                    }
                    const meta = listGroupMeta(g, items);
                    const isOpen = open.has(g);
                    return (
                        <div key={g} data-radar-group={g} className="flex flex-col">
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
                                <span className={cn("h-1.5 w-1.5 rounded-full", LIST_TONE_DOT[meta.tone])} />
                                <span className={cn(REGION_LABEL, LIST_TONE_TEXT[meta.tone])}>{meta.label}</span>
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
                                                dimmed={g === "dismissed"}
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
    dimmed,
    onSelect,
}: {
    finding: RadarFinding;
    active: boolean;
    dimmed: boolean;
    onSelect: (id: string) => void;
}) {
    const iv = investigationView(f);
    const site = findingSite(f);
    return (
        <button
            type="button"
            data-radar-finding-row={f.id}
            aria-current={active}
            onClick={() => onSelect(f.id)}
            className={cn(
                "flex flex-col gap-[7px] rounded-lg px-2.5 pb-2.5 pt-[9px] text-left transition-colors duration-150",
                active ? "bg-surface-selected ring-1 ring-inset ring-accent/45" : "hover:bg-surface-hover",
                dimmed && !active && "opacity-[0.62]"
            )}
        >
            {site ? (
                <span className="flex min-w-0 items-baseline text-[11.5px]">
                    <span className="min-w-0 truncate text-muted">{site.dir}</span>
                    <span className="flex-none text-ink-hi">
                        {site.file}:{site.line}
                    </span>
                    {site.more > 0 ? <span className="ml-2 flex-none text-ink-mid">+{site.more} site</span> : null}
                </span>
            ) : null}
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
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                    fix {shortSha(f.sourcecommit)}
                </span>
                {iv ? (
                    <span className={cn("flex-none text-[11px] font-semibold", INVESTIGATION_TEXT[iv.tone])}>
                        {iv.rowLabel}
                    </span>
                ) : null}
                {isNewFinding(f) ? (
                    <span
                        data-radar-new
                        className="flex-none rounded bg-accent/10 px-1.5 py-px text-[10.5px] font-semibold text-accent-soft"
                    >
                        new
                    </span>
                ) : null}
            </span>
        </button>
    );
}
