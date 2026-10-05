// Copyright 2026, Command Line Inc.
//
// Thin render: the collapsible hybrid timeline inside the run body. ALL derivations and click
// decisions live in runtimeline.ts; this component only maps rows to DOM and click targets.

import { getApi } from "@/app/store/global";
import { useState } from "react";
import { setActiveRunId } from "../jarvis/jarvissubjectstore";
import { openDagLive } from "../orchestrate/dagmodalstate";
import { useRunEvents } from "./runeventstore";
import { runTree } from "./runmodel";
import {
    artifactsOf,
    buildRunTimeline,
    clickTargetFor,
    eventText,
    joinWorkspacePath,
    planReviewPicks,
    toneFor,
    tsLabel,
    type RunTimelineGroup,
} from "./runtimeline";

export function RunTimeline({ channel, run }: { channel: Channel; run: Run }) {
    const [open, setOpen] = useState(false);
    const events = useRunEvents(run.id, channel.oid);
    const { groups, preview } = buildRunTimeline(run, events);
    if (groups.length === 0) {
        return null; // no lifecycle data yet — render nothing (the card is a fresh run)
    }
    return (
        <div className="mt-2 overflow-hidden rounded-[9px] border border-edge-mid bg-background">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-hover"
            >
                <span className="shrink-0 text-xxxs text-edge-strong">{open ? "▼" : "▶"}</span>
                <span className="text-xxxs font-bold uppercase tracking-[0.08em] text-muted">Timeline</span>
                <span className="text-[11px] tabular-nums text-secondary">{eventsCount(groups)} events</span>
                <span className="ml-auto text-[9px] text-success">● live</span>
            </button>
            <div className="max-h-[300px] overflow-y-auto border-t border-edge-mid px-3 py-2">
                {open
                    ? groups.map((g) => <GroupSection key={g.id} group={g} channel={channel} run={run} />)
                    : preview.map((e) => (
                          <EventRow key={e.id} event={e} channel={channel} run={run} interactive={false} />
                      ))}
            </div>
        </div>
    );
}

export function eventsCount(groups: RunTimelineGroup[]): number {
    return groups.reduce((n, g) => n + g.events.length, 0);
}

// exported for the run sheet, which puts the timeline's toggle in its tasks heading rather than a card of its own
export function GroupSection({ group, channel, run }: { group: RunTimelineGroup; channel: Channel; run: Run }) {
    return (
        <div>
            <div className="px-1 pt-2 pb-1 text-xxxs font-bold uppercase tracking-[0.1em] text-edge-strong">
                {group.title}
            </div>
            {group.events.map((e) => (
                <EventRow key={e.id} event={e} channel={channel} run={run} interactive />
            ))}
        </div>
    );
}

function EventRow({
    event,
    channel,
    run,
    interactive,
}: {
    event: RunEvent;
    channel: Channel;
    run: Run;
    interactive: boolean;
}) {
    const onClick = interactive ? clickTarget(event, channel, run) : undefined;
    const artifacts = artifactsOf(event);
    const picks = event.kind === "plan-reviewed" ? planReviewPicks(event.detail) : [];
    return (
        <>
            <div
                onClick={onClick}
                style={onClick ? { cursor: "pointer" } : undefined}
                className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] text-secondary hover:bg-surface-hover"
            >
                <span className="shrink-0 text-xxxs tabular-nums text-edge-strong">{tsLabel(event.ts)}</span>
                <span className={"shrink-0 text-[10px] " + toneFor(event.kind)}>●</span>
                <span className="truncate">{eventText(event)}</span>
                {artifacts.length > 0 && (
                    <span
                        className="ml-auto shrink-0 cursor-pointer border-b border-dotted border-edge-strong font-mono text-[10px] text-accent-soft hover:text-accent"
                        onClick={(e) => {
                            e.stopPropagation(); // the row's own click target must not steal the artifact link
                            openArtifact(runTree(run), artifacts[0]);
                        }}
                        title={`open ${artifacts[0]} in editor`}
                    >
                        {artifacts[0]} ✎
                    </span>
                )}
            </div>
            {picks.map((p) => (
                <div
                    key={p.taskid}
                    data-plan-review-pick={p.taskid}
                    className="truncate pl-[52px] font-mono text-[10.5px] text-ink-mid"
                >
                    {[p.taskid, p.model, p.reason].filter(Boolean).join(" · ")}
                </div>
            ))}
        </>
    );
}

// openArtifact opens a run artifact the way the completion surface does (getApi().openExternal of the
// projectPath+rel join) — the artifact paths the worker reports are workspace-relative, so a bare
// openExternal would miss the file.
function openArtifact(projectPath: string, rel: string): void {
    getApi().openExternal(joinWorkspacePath(projectPath, rel));
}

// focus-phase scrolls to the phase node — the phase's worker card renders immediately below it, so the
// card region comes into view with it (no extra plumbing; the scroll is the primary action).
function scrollToPhase(phaseIdx: number): void {
    document.querySelector(`[data-phase-id="${phaseIdx}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// clickTarget applies the pure clickTargetFor decision to the existing run verbs.
function clickTarget(event: RunEvent, channel: Channel, run: Run): (() => void) | undefined {
    const t = clickTargetFor(event);
    switch (t.kind) {
        case "select-child":
            return () => setActiveRunId(channel.oid, t.childRunId);
        case "open-dag":
            return () => {
                if (run.dagoref) {
                    openDagLive(channel.oid, run.id, "dag:" + run.dagoref);
                }
            };
        case "focus-phase":
            return () => scrollToPhase(t.phaseIdx);
        case "open-diff":
            return () =>
                document.querySelector("[data-evidence-block]")?.scrollIntoView({ behavior: "smooth", block: "start" });
        default:
            return undefined;
    }
}
