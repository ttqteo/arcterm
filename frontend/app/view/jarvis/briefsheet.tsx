// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's detail sheet: the Stage's successor. The Stage occupied the middle pane and drew whatever
// subject was active; the sheet draws the same subject on the right, so one renderer serves a channel (the
// live body of the run it is showing, or the launcher when it has no run yet) and an initiative (its chunk
// detail).
//
// It reads what the subject store already resolved — the run through stageRunAtom, the attribution through
// the ambient map — instead of re-deriving any of it, which is what stops one run having two live
// renderers. Note what is NOT here: a run id. B4 keyed the sheet by one, and that was fine while a run row
// was the only way in; the moment the sheet draws the active subject, a second key would be a second
// answer to the same question, and the two could name different runs.
//
// A channel with no run is not an empty sheet. The launcher is the only place a run starts from now, so the
// sheet carries its configuration AND the goal row that dispatches it: RunLauncher alone is the config half
// of a launch, and its own docblock says so — the goal and its Run live in the composer that used to sit
// directly below it on the Stage.

import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { buildChannelsAskBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import * as WOS from "@/app/store/wos";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { ambientProviderAtom, ensureAmbient } from "@/app/view/agents/ambientstore";
import { resolveTargetChannel } from "@/app/view/agents/channelderive";
import { activeChannelAtom, activeChannelRunsAtom, channelsAtom, runAtom } from "@/app/view/agents/channelsstore";
import { harnessPreferenceAtom } from "@/app/view/agents/harnessstore";
import { channelProjectLabel } from "@/app/view/agents/projectlabel";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import {
    channelOverrideAtom,
    createRun,
    loadResolvedProfile,
    pendingRunDraftAtom,
    resolvedProfileAtom,
} from "@/app/view/agents/runactions";
import { RunBody } from "@/app/view/agents/runbody";
import { launchBlocker } from "@/app/view/agents/runconfig";
import {
    endRunConfigDraft,
    hydrateRunConfigFromProfile,
    parallelismAtom,
    planPathAtom,
    planPreviewAtom,
    resetRunConfigForChannel,
    reviewerPicksAtom,
    reviewerRouteAtom,
    routeTouchedAtom,
    runRouteAtom,
    runShapeAtom,
    startAtom,
    workerRouteAtom,
} from "@/app/view/agents/runconfigstore";
import { RunLauncher } from "@/app/view/agents/runlauncher";
import { isTerminal, leadAsker } from "@/app/view/agents/runmodel";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RunSettingsPanel, SHEET_BTN, SheetShell } from "./briefrunsheet";
import { sheetFace, type SheetFace } from "./briefsheetmodel";
import { REGION_LABEL } from "./briefstyle";
import { EffortDetailView } from "./effortdetailview";
import { briefRunListAtom, briefSheetOpenAtom } from "./jarvisstore";
import {
    activeSubjectAtom,
    clearSubject,
    loadRecordDetail,
    recordBandOpenAtom,
    recordDetailAtom,
    setActiveRunId,
    setComposingRun,
    stageRunAtom,
    toggleRecordBand,
} from "./jarvissubjectstore";
import { launchGoal, launchOptsFromConfig } from "./newrun";
import { openOrPeekAddress } from "./openref";
import { recordBandCase } from "./recordband";
import { RecordBand } from "./recordbandview";
import { RunSheet } from "./runsheet";
import { launcherReading, sheetRoute } from "./runsheetmodel";

const FIELD =
    "min-w-0 flex-1 rounded-[7px] border border-border bg-background px-2.5 py-1.5 text-[12.5px] text-ink-hi placeholder:text-ink-faint";

const NO_RUN = atom<Run | null>(null);

const STEP_BTN =
    "inline-flex h-[22px] w-6 cursor-pointer items-center justify-center rounded-[6px] border border-border bg-surface-raised text-[11px] hover:border-edge-strong";

// The goal row the launcher needs to be a launch. It reads the same config atoms RunLauncher edits, so a
// control the user moved above is the control this dispatches with — a launch that ignored the launcher
// would be a control that does nothing.
function ChannelLaunch({ channel }: { channel: Channel }) {
    const shape = useAtomValue(runShapeAtom);
    const workerRoute = useAtomValue(workerRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const reviewerRoute = useAtomValue(reviewerRouteAtom);
    const parallelism = useAtomValue(parallelismAtom);
    const startFrom = useAtomValue(startAtom);
    const planPath = useAtomValue(planPathAtom);
    const preview = useAtomValue(planPreviewAtom);
    const runRoute = useAtomValue(runRouteAtom);
    const routeTouched = useAtomValue(routeTouchedAtom);
    const pref = useAtomValue(harnessPreferenceAtom);
    const overrides = useAtomValue(channelOverrideAtom);
    const profiles = useAtomValue(resolvedProfileAtom);
    const pendingDraft = useAtomValue(pendingRunDraftAtom);
    const setPendingDraft = useSetAtom(pendingRunDraftAtom);
    const channels = useAtomValue(channelsAtom);
    const projects = useAtomValue(projectsAtom);
    const [goal, setGoal] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [launching, setLaunching] = useState(false);

    // A Radar "Start investigation" owns the field while it is pending: it is a reviewed draft, not a fresh
    // goal, and its origin has to ride on the run for the finding's outcome to be written back at the end.
    const target = pendingDraft != null ? resolveTargetChannel(channels ?? [], pendingDraft.projectPath) : undefined;
    const radarDraft = pendingDraft != null && target?.oid === channel.oid ? pendingDraft : null;
    const value = radarDraft != null ? radarDraft.goal : goal;
    const config = { shape, parallelism, workerRoute, start: startFrom, planPath, reviewerPicks, reviewerRoute };
    const planStart = shape === "orchestrator" && startFrom === "plan";
    const blocker = launchBlocker({ shape, start: startFrom, goal: value, planPath, preview });

    const channelId = channel.oid;
    useEffect(() => {
        resetRunConfigForChannel(channelId);
    }, [channelId]);
    // the channel's saved profile is the launcher's starting point, and it re-applies whenever the resolved
    // profile changes (a save, a first load, a switch back) — never over a configuration the user edited.
    useEffect(() => {
        hydrateRunConfigFromProfile(profiles[channelId]);
    }, [channelId, profiles]);
    useEffect(() => {
        loadResolvedProfile(channelId);
    }, [channelId]);
    const profileRoute = overrides[channelId]?.route ?? pref.route ?? null;
    useEffect(() => {
        if (!routeTouched && profileRoute != null) {
            globalStore.set(runRouteAtom, profileRoute);
        }
    }, [channelId, profileRoute, routeTouched]);

    const launch = () => {
        if (blocker != null || runRoute == null || launching) {
            return;
        }
        setLaunching(true);
        setError(null);
        fireAndForget(async () => {
            try {
                // one translation from launcher state to CreateRun arguments, shared with the + Run
                // modal and unit-tested there; this had its own inline copy and they drifted.
                const created = await createRun(channelId, launchGoal(config, value), runRoute, {
                    ...launchOptsFromConfig(config),
                    ...(radarDraft != null ? { radarOrigin: radarDraft.radarOrigin } : {}),
                });
                // the launch consumed this draft, so the next one starts from the channel's saved defaults
                endRunConfigDraft(profiles[channelId]);
                setGoal("");
                setPendingDraft(null);
                setActiveRunId(channelId, created.id);
                setComposingRun(channelId, false);
            } catch (e) {
                setError(String(e));
            } finally {
                setLaunching(false);
            }
        });
    };

    return (
        <div className="flex flex-none flex-col gap-1.5 border-t border-edge-faint px-4 py-3">
            <span className={cn(REGION_LABEL, "text-accent-soft")}>
                run this in {channelProjectLabel(channel, projects)}
            </span>
            <div className="flex items-center gap-2">
                <input
                    data-jarvis-launch-goal
                    value={planStart ? "" : value}
                    disabled={launching || planStart}
                    placeholder={planStart ? "Starts from the plan above" : "What should it do?"}
                    onChange={(e) => {
                        if (radarDraft != null) {
                            setPendingDraft({ ...radarDraft, goal: e.target.value });
                            return;
                        }
                        setGoal(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            launch();
                        }
                    }}
                    className={FIELD}
                />
                <button
                    type="button"
                    onClick={launch}
                    // no route is a real block, not a slow state: nothing dispatches without one, so the
                    // control states that instead of accepting a goal it would have to refuse.
                    disabled={launching || blocker != null || runRoute == null}
                    className="flex-none cursor-pointer rounded-[7px] border border-accent/40 bg-surface-raised px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-soft hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40"
                >
                    {launching ? "Starting…" : "Run ⏎"}
                </button>
            </div>
            <span className="text-[11px] text-muted">
                {runRoute == null
                    ? "Pick a lead route in the launcher above — nothing dispatches without one."
                    : radarDraft != null
                      ? "A Radar investigation, awaiting your review. Its finding's outcome is written back when this run ends."
                      : planStart && blocker != null
                        ? blocker
                        : "The shape and start above are what this dispatches with."}
            </span>
            {error != null ? (
                <p data-jarvis-brief-sheet-state="error" className="text-[11.5px] text-error">
                    {error}
                </p>
            ) : null}
        </div>
    );
}

// Runs stored before slice 5c (pipeline, adaptive, parked at a plan gate) keep RunBody, which knows how to
// draw them; every other run is the sheet. Both share the configuration dock.
function ChannelRun({
    model,
    channel,
    run,
    onClose,
}: {
    model: AgentsViewModel;
    channel: Channel;
    run: Run;
    onClose: () => void;
}) {
    const agents = useAtomValue(model.agentsAtom);
    if (sheetRoute(run) === "sheet") {
        return <RunSheet model={model} channel={channel} run={run} onClose={onClose} />;
    }
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <RunBody model={model} channel={channel} agents={agents} run={run} />
            <div data-jarvis-brief-sheet-face="settings" className="flex-none border-t border-edge-faint bg-surface">
                <RunSettingsPanel run={run} />
            </div>
        </div>
    );
}

// The launcher face's reading, in the slot where a run's verb would be: the two faces keep one layout.
function LauncherReading() {
    const runs = useAtomValue(activeChannelRunsAtom);
    const reading = launcherReading(runs, Date.now());
    return (
        <div className="flex flex-none items-center gap-[9px] border-b border-edge-faint px-4 py-4">
            <span className="h-[7px] w-[7px] flex-none rounded-full bg-edge-strong" />
            <span className="flex-none text-[15px] font-bold tracking-[-.01em] text-primary">{reading.verb}</span>
            <span className="min-w-0 truncate text-[13px] text-ink-mid">{reading.sub}</span>
        </div>
    );
}

// the header's run line: which run the sheet is on, and, once it has ended, how
function runLine(run: Run): string {
    const line = `${run.mode || "quick"} run ${run.id.slice(0, 4)}`;
    return isTerminal(run.status) ? `${line} · ${run.status === "done" ? "finished" : run.status}` : line;
}

// The skeleton is only honest while the channel is still being read. A peek's attributed run can name a
// channel that no longer exists, and this sheet is the only place that run is shown — so a read that FAILED
// has to say so rather than sit under "Reading this project…", which is what the two states looked like
// when they shared one branch.
function SheetChannelPending({ channelId }: { channelId: string }) {
    const errored = useAtomValue(WOS.getWaveObjectErrorAtom(WOS.makeORef("channel", channelId)));
    const channels = useAtomValue(channelsAtom);
    // A channel that no longer exists does not fail its read — it never settles: no value, no error. The
    // one signal the client has is the list, which the Brief loads on boot, so "the list is here and this
    // id is not in it" is what says gone. Without it the skeleton below is the permanent state for a run
    // whose channel was deleted, which is most of what an old record's attribution points at.
    const gone = channels != null && !channels.some((c) => c.oid === channelId);
    if (errored || gone) {
        return (
            <div data-jarvis-brief-sheet-state="unavailable" className="flex min-h-0 flex-1 flex-col p-4">
                <div className="flex flex-col gap-[7px] rounded-[10px] border border-dashed border-edge-strong px-3.5 py-[13px]">
                    <span className="text-[12.5px] font-semibold text-ink-hi">
                        This run's project is no longer available.
                    </span>
                    <span className="text-[11.5px] leading-[1.5] text-muted">
                        An older record can still point at a run whose project was deleted. Nothing about the run can be
                        shown here.
                    </span>
                </div>
            </div>
        );
    }
    return (
        <div data-jarvis-brief-sheet-state="loading" className="flex min-h-0 flex-1 flex-col gap-2 p-4">
            <span className="h-8 animate-pulse rounded-[8px] bg-surface-raised motion-reduce:animate-none" />
            <span className="text-[12px] text-secondary">Reading this project…</span>
        </div>
    );
}

export function BriefSheet({ model }: { model: AgentsViewModel }) {
    const subject = useAtomValue(activeSubjectAtom);
    const run = useAtomValue(stageRunAtom);
    const open = useAtomValue(briefSheetOpenAtom);
    const channel = useAtomValue(activeChannelAtom);
    const agents = useAtomValue(model.agentsAtom);
    const ambient = useAtomValue(ambientProviderAtom);
    const recordDetails = useAtomValue(recordDetailAtom);
    const bandsOpen = useAtomValue(recordBandOpenAtom);
    const projects = useAtomValue(projectsAtom);
    const runList = useAtomValue(briefRunListAtom);

    useEffect(() => ensureAmbient(), []);

    // the ask card's numbered (1-9) badges + Enter, targeting the shown run's asking worker. A ref keeps
    // the binding array stable while reading the live worker each render; it moved here with the run body.
    const askAgentRef = useRef<AgentVM | undefined>(undefined);
    const askBindings = useMemo(() => buildChannelsAskBindings(model, askAgentRef), [model]);
    useKeybindings(askBindings);
    // the keys read the live run object, as the question card does: the channel list's copy is a snapshot a
    // run: update never refreshes, so a worker recorded after it was taken would be invisible to the keys
    const liveRun = useAtomValue(run != null ? runAtom(run.id) : NO_RUN) ?? run;
    askAgentRef.current = liveRun != null ? leadAsker(liveRun, agents) : undefined;

    // memoized because the latch below has it in a dep array: sheetFace builds a fresh object each call,
    // so an unmemoized face would refire the latch every render and setState its way into a loop
    const face = useMemo(() => sheetFace(subject, run), [subject, run]);
    const subjectId = subject?.id ?? null;
    const bandOpen = subjectId != null ? (bandsOpen[subjectId] ?? false) : false;
    const tags = run != null ? ambient.tagsFor({ oref: "run:" + run.id }) : [];
    const band = recordBandCase({ kind: subject?.kind ?? "channel", tags });
    const bandRecordId = band.case === "one" ? band.edge.taskId : band.case === "several" ? band.primary.taskId : null;
    // the band's record is loaded only once it is expanded — a collapsed band needs the edge, not the whole
    // dossier (the Stage's rule, moved with the band).
    useEffect(() => {
        if (bandOpen && bandRecordId != null) {
            loadRecordDetail(bandRecordId);
        }
    }, [bandOpen, bandRecordId]);

    const close = () => {
        globalStore.set(briefSheetOpenAtom, false);
        clearSubject();
    };
    // an initiative's body leads with its own title, so the header naming it again would be a second one.
    // "none" is never drawn — `visible` below excludes it, so it is never latched.
    const title = face.kind === "channel" ? channelProjectLabel(channel, projects) : "";
    const meta = face.kind === "channel" && face.body === "run" && run != null ? runLine(run) : undefined;
    // where the shown run sits in the list the Brief published (design L420-424); a run outside it (opened
    // from Waiting, say) has no position and its arrows are inert
    const at = run != null ? runList.indexOf(run.id) : -1;
    const pos = {
        n: at + 1,
        total: at >= 0 ? runList.length : 0,
        prev: at > 0 ? runList[at - 1] : null,
        next: at >= 0 && at < runList.length - 1 ? runList[at + 1] : null,
    };
    const step = (id: string | null, e: React.MouseEvent) => {
        if (id != null) {
            fireAndForget(() => openOrPeekAddress(model, "run:" + id, e));
        }
    };

    const visible = open && face.kind !== "none";
    // the exit animation still needs something to draw after the subject clears, so the last shown
    // face and its title are latched rather than read live (petbubble.tsx keeps the same rule)
    const [shown, setShown] = useState<{ face: SheetFace; title: string; meta?: string } | null>(null);
    useEffect(() => {
        if (visible) {
            setShown({ face, title, meta });
        }
    }, [visible, face, title, meta]);

    return (
        <ModalShell open={visible} variant="sheet" onClose={close} className="h-full w-[640px] max-w-[92vw]">
            {shown == null ? null : (
                <div className="flex h-full min-h-0 flex-col">
                    <SheetShell
                        face={shown.face.kind}
                        label={shown.face.kind === "effort" ? "initiative" : "project"}
                        title={shown.title}
                        meta={shown.meta}
                        actions={
                            // the only way to start a SECOND run in a channel: without it a channel that has any
                            // run could never compose another
                            face.kind === "channel" && face.body === "run" ? (
                                <>
                                    {pos.total > 0 ? (
                                        <span className="text-[10.5px] tabular-nums text-muted">
                                            {pos.n} / {pos.total}
                                        </span>
                                    ) : null}
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            aria-label="Previous run"
                                            title="Previous run (k)"
                                            data-peek={pos.prev ? "" : undefined}
                                            onClick={(e) => step(pos.prev, e)}
                                            className={cn(STEP_BTN, pos.prev ? "text-secondary" : "text-feed-glyph")}
                                        >
                                            <ChevronUp size={13} aria-hidden />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="Next run"
                                            title="Next run (j)"
                                            data-peek={pos.next ? "" : undefined}
                                            onClick={(e) => step(pos.next, e)}
                                            className={cn(STEP_BTN, pos.next ? "text-secondary" : "text-feed-glyph")}
                                        >
                                            <ChevronDown size={13} aria-hidden />
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setComposingRun(face.channelId, true)}
                                        className={SHEET_BTN}
                                    >
                                        New run
                                    </button>
                                </>
                            ) : null
                        }
                        onClose={close}
                    >
                        {face.kind === "channel" && face.body === "run" && run != null ? (
                            <RecordBand
                                kind={subject?.kind ?? "channel"}
                                tags={tags}
                                detail={bandRecordId != null ? (recordDetails[bandRecordId] ?? null) : null}
                                runORef={"run:" + run.id}
                                open={bandOpen}
                                onToggle={() => subjectId != null && toggleRecordBand(subjectId)}
                            />
                        ) : null}
                        {face.kind === "channel" ? (
                            channel == null ? (
                                <SheetChannelPending channelId={face.channelId} />
                            ) : face.body === "run" && run != null ? (
                                <ChannelRun model={model} channel={channel} run={run} onClose={close} />
                            ) : (
                                <div className="flex min-h-0 flex-1 flex-col bg-background">
                                    <LauncherReading />
                                    <RunLauncher projectPath={channel.projectpath ?? ""} />
                                    <ChannelLaunch channel={channel} />
                                </div>
                            )
                        ) : null}
                        {face.kind === "effort" ? (
                            <div className="flex min-h-0 flex-1 flex-col">
                                <EffortDetailView model={model} />
                            </div>
                        ) : null}
                    </SheetShell>
                </div>
            )}
        </ModalShell>
    );
}
