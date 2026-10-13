// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Events rail: state changes across the fleet, new ones above a "mark all read" line. Plain-agent
// transitions are tracked by useRailTracking while the cockpit is mounted; run events come from the surface.

import { globalStore } from "@/app/store/jotaiStore";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import {
    Check,
    CircleDashed,
    CornerDownRight,
    GitMerge,
    MessageCircleQuestion,
    MessageSquare,
    Workflow,
    X,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgeShort, type AgentVM } from "./agentsviewmodel";
import {
    agentTransitions,
    groupRailEvents,
    mergeRailEvents,
    RAIL_MAX,
    runRailEvents,
    splitUnread,
    type AgentSnap,
    type RailEvent,
    type RailKind,
    type RailRow,
} from "./cockpitevents";
import type { Lineage } from "./runlineage";
import { SectionLabel } from "./sectionlabel";

const snapsAtom = atom<Record<string, AgentSnap>>({}) as PrimitiveAtom<Record<string, AgentSnap>>;
const agentEventsAtom = atom<RailEvent[]>([]) as PrimitiveAtom<RailEvent[]>;
const seenTsAtom = atom<number>(0) as PrimitiveAtom<number>;

const KIND: Record<RailKind, { icon: LucideIcon; verb: string; tone: string }> = {
    asked: { icon: MessageCircleQuestion, verb: "asked", tone: "text-warning" },
    answered: { icon: CornerDownRight, verb: "answered", tone: "text-accent-soft" },
    finished: { icon: Check, verb: "finished", tone: "text-accent-soft" },
    quiet: { icon: CircleDashed, verb: "went quiet", tone: "text-warning" },
    failed: { icon: X, verb: "failed", tone: "text-error" },
    told: { icon: MessageSquare, verb: "you told", tone: "text-accent-soft" },
    landed: { icon: GitMerge, verb: "landed", tone: "text-success" },
};

// useRailTracking observes plain agents' state changes. Workers and leads are covered by their run's events.
export function useRailTracking(agents: AgentVM[], lineage: Lineage): void {
    const plain = agents.filter((a) => lineage.roles[a.id] == null);
    const key = plain.map((a) => `${a.id}:${a.state}`).join(",");
    useEffect(() => {
        const { events, next } = agentTransitions(globalStore.get(snapsAtom), plain, Date.now());
        globalStore.set(snapsAtom, next);
        if (events.length > 0) {
            globalStore.set(agentEventsAtom, (prev) => mergeRailEvents([events, prev], RAIL_MAX));
        }
    }, [key]);
}

export function CockpitEventsRail({
    model,
    lineage,
    runEvents,
    tags,
    onSelect,
}: {
    model: AgentsViewModel;
    lineage: Lineage;
    runEvents: Record<string, RunEvent[]>;
    // a plain agent's standing ("background", "idle"), shown beside its name
    tags: Record<string, string>;
    onSelect: (id: string) => void;
}) {
    const now = useAtomValue(model.nowAtom);
    const agentEvents = useAtomValue(agentEventsAtom);
    const seenTs = useAtomValue(seenTsAtom);
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
    // the 1s clock only moves the age labels; the list itself changes with the events
    const all = useMemo(() => {
        const leadOf = (runId: string) =>
            Object.entries(lineage.roles).find(([, r]) => r.kind === "lead" && r.runId === runId)?.[0];
        const runLists = Object.values(lineage.runs).map((r) =>
            runRailEvents(r, runEvents[r.runId] ?? [], leadOf(r.runId))
        );
        return mergeRailEvents([agentEvents, ...runLists]);
    }, [agentEvents, lineage, runEvents]);
    const { fresh, old } = splitUnread(all, seenTs);
    const row = (e: RailRow, isNew: boolean) => {
        const k = KIND[e.kind];
        const tag = e.group == null && e.focusId ? tags[e.focusId] : undefined;
        return (
            <div
                key={e.key}
                role="button"
                tabIndex={-1}
                onClick={() => e.focusId && onSelect(e.focusId)}
                className={cn(
                    "grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] gap-x-2.5 rounded-[7px] p-2 hover:bg-surface-raised",
                    isNew && "bg-accent/[0.05]"
                )}
            >
                <span className={cn("flex justify-center pt-px", k.tone)}>
                    <k.icon size={13} aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span className="inline-flex min-w-0 items-center gap-[5px] font-mono text-[11.5px] font-semibold text-secondary">
                            {e.group != null ? (
                                <Workflow size={11} aria-hidden className="shrink-0 text-muted" />
                            ) : null}
                            <span className="truncate">{e.who}</span>
                        </span>
                        {tag ? (
                            <span className="shrink-0 rounded-[4px] border border-edge-mid px-[5px] font-mono text-[10.5px] text-muted">
                                {tag}
                            </span>
                        ) : null}
                    </div>
                    <span className={cn("text-[12px] leading-[1.4]", k.tone)}>
                        {k.verb}
                        {e.text ? <span className="text-ink-mid"> {e.text}</span> : null}
                    </span>
                    {e.more ? (
                        <button
                            type="button"
                            onClick={(ev) => {
                                ev.stopPropagation();
                                setOpenGroups((prev) => ({ ...prev, [e.group!]: !prev[e.group!] }));
                            }}
                            className="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-accent hover:text-accent-soft"
                        >
                            {e.more}
                        </button>
                    ) : null}
                </div>
                <div className="flex flex-col items-end gap-1.5 pt-px">
                    <span className="font-mono text-[10.5px] text-muted">{formatAgeShort(now - e.ts)}</span>
                    {isNew ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                </div>
            </div>
        );
    };
    const section = (label: string, tone: string, top: boolean) => (
        <div className={cn("flex items-center gap-2 px-2 pb-1", top ? "pt-0.5" : "pt-2.5")}>
            <span className={cn(REGION_LABEL, tone)}>{label}</span>
            <div className="h-px flex-1 bg-border" />
        </div>
    );
    return (
        <div className="-mx-2 flex flex-col gap-1">
            <div className="flex items-center justify-between px-2 pb-2">
                <SectionLabel>Events</SectionLabel>
                {fresh.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => globalStore.set(seenTsAtom, all[0].ts)}
                        className="cursor-pointer border-0 bg-transparent text-[11.5px] text-accent hover:text-accent-soft"
                    >
                        Mark all read
                    </button>
                ) : null}
            </div>
            {all.length === 0 ? (
                <div className="px-2 text-[12px] text-muted">Nothing has changed state yet.</div>
            ) : null}
            {fresh.length > 0 ? section(`New · ${fresh.length}`, "text-accent-soft", true) : null}
            {groupRailEvents(fresh, openGroups).map((e) => row(e, true))}
            {old.length > 0 ? section("Earlier", "text-muted", fresh.length === 0) : null}
            {groupRailEvents(old, openGroups).map((e) => row(e, false))}
            <span className="px-2 pt-3 text-[11px] leading-[1.5] text-muted">
                State changes only. Tool calls stay on the cards.
            </span>
        </div>
    );
}
