// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief: the queue-first Jarvis surface that replaces the Subjects · Stage · rail composition.
// A main column of three bounded regions — waiting on you, runs, initiatives — beside a side column for the
// past and the not yet planned (since you looked, shipped, ideas), over the briefing snapshot, under a header
// whose fleet line comes off the live agent roster.
//
// Two rules shape every region. Absence is a written sentence, never a heading over an empty frame:
// a region renders rows or it says what is not there, and the `empty` flag on Region makes that
// structural rather than a habit. And every count printed is the number of rows rendered beneath it,
// with whatever the projection's caps hid stated separately as "+N more" — so no line here can claim
// more work than the surface is showing.
//
// The record peek is here (BriefPeek, opened by a record oref) and the palette extends the app's own. Every
// row is one line that opens its sheet in a click (briefrows.ts), because the sheet is where the actions
// live; a region's overflow and its folded stale runs open in place. The steer-only composer lives in the
// run sheet's footer (briefcomposer.tsx).
//
// One presentation rule runs through the whole file and decides every border below: a bordered chip is
// the control recipe, a borderless one is a label. Dressing something inert as a control and camouflaging
// a real control among labels are the same lie, so neither happens here.

import { pushToast } from "@/app/cockpit/notificationstore";
import { cardVariants, computeEntrances, initialEntranceState, MOTION, paneReveal } from "@/app/element/motiontokens";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { buildJarvisBindings } from "@/app/store/keybindings/bindings";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import { useKeybindings } from "@/app/store/keybindings/store";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { jumpToAgent } from "@/app/view/agents/channelsprimitives";
import { channelsAtom, createChannel, loadChannels, runAtom } from "@/app/view/agents/channelsstore";
import { openLauncher } from "@/app/view/agents/launcherstore";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { RollingCount } from "@/app/view/agents/rollingcount";
import { confirmCancelRun, pendingRunDraftAtom } from "@/app/view/agents/runactions";
import { leadAsker, leadWorker, liveWorkers } from "@/app/view/agents/runmodel";
import { DagModal } from "@/app/view/orchestrate/dagmodal";
import { setDagModalAgentsContext } from "@/app/view/orchestrate/dagmodalstate";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue, useSetAtom, type Atom, type PrimitiveAtom } from "jotai";
import {
    Archive,
    ArchiveRestore,
    ArrowUpRight,
    Copy,
    Maximize2,
    Minimize2,
    Pause,
    Pencil,
    Play,
    Plus,
    Search,
    SlidersHorizontal,
    Trash2,
    X,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig, type Variants } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { runAttentionAct } from "./attentionrun";
import { AutonomyLadder } from "./autonomyladderview";
import { briefFleet } from "./brieffleet";
import { BRIEFING_FIXTURES } from "./briefingfixtures";
import {
    ackableRuns,
    buildAttentionQueue,
    capRegion,
    DELTA_CAP,
    EFFORT_CAP,
    groupDelta,
    IDEA_CAP,
    projectBriefing,
    queueAction,
    SEVEN_DAYS_MS,
    SHIPPED_CAP,
    summarizeAttentionQueue,
    WAITING_CAP,
    type QueueRow,
    type QueueSummary,
} from "./briefingmodel";
import {
    ackBriefingVisit,
    briefingCursorAtom,
    briefingFixtureAtom,
    briefingStateAtom,
    briefRestoreConsumedAtom,
    loadBriefing,
    markBriefingSeen,
    refreshBriefing,
} from "./briefingstore";
import { resolveBriefCursor } from "./briefnav";
import { isArchivedStatus } from "./briefpalette";
import { BriefPeek } from "./briefpeekview";
import { BriefProfileModal } from "./briefprofileview";
import { briefRestorePlan } from "./briefrestore";
import {
    behindGroups,
    filterLines,
    initiativeLine,
    keepsRunKind,
    lineOpenTarget,
    projectName,
    queueLine,
    RUN_KIND_FILTERS,
    runKindLegs,
    runRowFace,
    sessionLine,
    sessionWindow,
    SHIPPED_EMPTY,
    SHIPPED_LABEL,
    sinceEmptyLine,
    sinceLabel,
    splitIdeas,
    type BriefLine,
    type LineTarget,
    type RunKindFilter,
} from "./briefrows";
import { DeltaRowView, IdeaRow, InitiativeRow, RunRowView, ShippedRowView, WaitingRow } from "./briefrowviews";
import { BriefSheet } from "./briefsheet";
import { FAINT_TEXT, LINK_BTN, REGION_LABEL, SMALL_BTN } from "./briefstyle";
import { BriefToastView } from "./brieftoast";
import { briefUndo, chunkKey, effortKey, noteKey, pendingDeleteKeysAtom } from "./briefundo";
import { ChunkSidebar } from "./chunksidebar";
import { EffortCreateForm } from "./effortcreateform";
import { effortFeed, feedNoteCounts } from "./effortfeed";
import { buildEffortCard, groupChunksByStage, stageOptions } from "./effortmodel";
import {
    addChunkAt,
    appendChunkNote,
    archivedEffortsAtom,
    createIdea,
    deleteEffort,
    editNote,
    effortChunkRows,
    effortDetailAtom,
    loadArchivedEfforts,
    loadEffortDetail,
    moveChunk,
    moveChunkToStage,
    removeChunks,
    removeNote,
    renameChunk,
    renameEffort,
    setChunkStage,
    setChunkStatus,
    setEffortStatus,
    unarchiveEffort,
} from "./effortstore";
import { freshKeys } from "./freshrows";
import { initiativeResume, noteStamp, openAgentFor, orderInitiatives, type InitiativeResume } from "./initiativework";
import { workOnDueChunk, workOnInitiative } from "./initiativeworkaction";
import {
    chunkRowId,
    expandableORef,
    isFlatPlan,
    stageRowId,
    trackerNavIds,
    trackerRows,
    type DetailRow,
} from "./inlinetracker";
import { IdeaDetail, InitiativeDetail, type TrackerEdits } from "./inlinetrackerview";
import {
    briefEffortIndexAtom,
    briefPeekRecordAtom,
    briefProfileAtom,
    briefRevealChunkAtom,
    briefRunListAtom,
    briefSheetOpenAtom,
    chunkMoveAtom,
    noteChunkAtom,
    readingNoteAtom,
} from "./jarvisstore";
import { clearSubject, persistedSubjectAtom, setComposingRun, stageRunAtom } from "./jarvissubjectstore";
import { JarvisTour, TourButton, TourOffer } from "./jarvistourview";
import { NewInitiativeControl } from "./newinitiativecontrol";
import { radarDraftLanding } from "./newrun";
import { openChannelSheet, openOrPeek, openOrPeekAddress } from "./openref";
import { forgetOrigin } from "./returnsurface";
import { loadTaskList, taskListAtom } from "./tasksstore";
import {
    appendInStageAt,
    canRemove,
    chunkRef,
    moveTarget,
    stageMoveTarget,
    stageRunLabels,
    stepChunk,
} from "./trackeredit";

const REGIONS = {
    waiting: {
        label: "Waiting on you",
        absent: "Nothing is waiting on you. The next gate or ask arrives here.",
        ok: true,
    },
    sessions: {
        label: "Runs",
        absent: "Nothing is running. A run takes a goal or a plan file and lands its work on its own branch.",
        ok: false,
    },
    initiatives: {
        label: "Initiatives",
        absent: "No initiative yet. Work bigger than one run lives here as a list of chunks that agents tick off.",
        ok: false,
    },
    behind: { label: "Since you looked", absent: "Nothing new since you last looked.", ok: false },
} as const;
type RegionId = keyof typeof REGIONS;
const SKELETON_REGIONS: RegionId[] = ["waiting", "sessions", "initiatives"];

// A region heading is a label. Reading one region alone is its own small icon button at the heading's end: a
// full-width heading that hid every other region on a misclick was the trap (spec 2026-10-12 decision 11).
function RegionHead({
    id,
    label,
    meta,
    count,
    alert,
    only,
    onOnly,
}: {
    id: RegionId;
    label: string;
    meta: string;
    count?: number;
    alert?: boolean;
    only: boolean;
    onOnly: () => void;
}) {
    return (
        <div className="flex w-full items-center gap-[9px]">
            {alert ? <span className="h-1.5 w-1.5 flex-none pulse-soft rounded-full bg-asking" /> : null}
            <span
                className={cn(
                    REGION_LABEL,
                    alert ? "text-asking" : id === "waiting" ? "text-feed-label" : "text-ink-mid"
                )}
            >
                {label}
            </span>
            {count != null ? (
                <span className="flex-none text-[10.5px] font-medium tabular-nums text-ink-mid">{count}</span>
            ) : null}
            <span className="h-px min-w-3 flex-1 bg-edge-faint" />
            <span className={cn("flex-none", FAINT_TEXT)}>{only ? `${meta} · only this region` : meta}</span>
            <button
                type="button"
                data-jarvis-region-only
                aria-pressed={only}
                aria-label={only ? "Show every region" : `Show only ${label}`}
                title={only ? "Show every region" : "Show only this region"}
                onClick={onOnly}
                className="flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-[5px] border border-border text-muted hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                {only ? <Minimize2 size={11} aria-hidden /> : <Maximize2 size={11} aria-hidden />}
            </button>
        </div>
    );
}

// The starting control an empty Runs or Initiatives box carries: the secondary button recipe, as the header's
// New initiative wears it, so the page's one accent button stays the header's New run.
const EMPTY_ACT =
    "flex h-[26px] flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-edge-mid bg-surface-raised px-2.5 text-[11.5px] font-semibold text-ink-hi hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// Which kind of run Runs and Shipped show. Sits beside the region head, not in it.
function RunKindToggle({ value, onChange }: { value: RunKindFilter; onChange: (v: RunKindFilter) => void }) {
    return (
        <div
            role="group"
            aria-label="Show runs of kind"
            data-jarvis-run-kind
            className="flex flex-none items-center gap-1"
        >
            {RUN_KIND_FILTERS.map((k) => (
                <button
                    key={k}
                    type="button"
                    aria-pressed={value === k}
                    onClick={() => onChange(k)}
                    className={cn(
                        "cursor-pointer rounded-[5px] border px-1.5 py-px text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        value === k
                            ? "border-edge-strong text-ink-hi"
                            : "border-transparent text-muted hover:text-ink-hi"
                    )}
                >
                    {k}
                </button>
            ))}
        </div>
    );
}

function Region({
    id,
    meta,
    count,
    alert,
    empty,
    absent,
    gap,
    only,
    onOnly,
    tools,
    act,
    children,
}: {
    id: RegionId;
    meta: string;
    count?: number;
    alert?: boolean;
    empty: boolean;
    absent?: string;
    gap: string;
    only: boolean;
    onOnly: () => void;
    tools?: ReactNode;
    // the control that starts what the empty box says is missing
    act?: ReactNode;
    children: ReactNode;
}) {
    const region = REGIONS[id];
    return (
        <section data-jarvis-brief-region={id} className={cn("flex flex-col", gap)}>
            <div className="flex items-center gap-2.5">
                <RegionHead
                    id={id}
                    label={region.label}
                    meta={meta}
                    count={count}
                    alert={alert}
                    only={only}
                    onOnly={onOnly}
                />
                {tools}
            </div>
            {empty ? (
                <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-edge-strong bg-surface px-4 py-3">
                    {region.ok ? (
                        <span aria-hidden className="flex-none text-[12px] font-bold text-success">
                            ✓
                        </span>
                    ) : null}
                    <span className="min-w-0 flex-1 text-[13px] text-secondary">{absent ?? region.absent}</span>
                    {act}
                </div>
            ) : (
                children
            )}
        </section>
    );
}

// What the region's window hid, and the way past it. There is no all-initiatives or all-events surface
// to send this anywhere — the three-pane composition's rail was the old destination and B5 deleted it —
// so the overflow opens in place. Bordered because it is a control: invariant 4 forbids the borderless
// link-coloured span this used to be, which named a number and did nothing.
function MoreControl({ n, expanded, onToggle }: { n: number; expanded: boolean; onToggle: () => void }) {
    if (n <= 0 && !expanded) {
        return null;
    }
    return (
        <button
            type="button"
            data-jarvis-brief-more={expanded ? "less" : "more"}
            onClick={onToggle}
            className={cn(LINK_BTN, "mt-0.5")}
        >
            {expanded ? "Show less" : `+${n} more`}
        </button>
    );
}

// The first line of the Waiting box: what is waiting, in one sentence. It is a label, not a control; the rows
// under it carry the actions, and Show all N folds the rest in.
function QueueSummaryView({ summary, error }: { summary: QueueSummary; error: boolean }) {
    return (
        <div className="mb-0.5 flex w-full items-center gap-3 border-b border-border px-2.5 pb-2 pt-[7px]">
            <span className={cn("w-[3px] flex-none self-stretch rounded-[2px]", error ? "bg-error" : "bg-asking")} />
            <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-ink-hi">{summary.title}</span>
                <span className="mt-0.5 block truncate text-[10.5px] tabular-nums text-ink-mid">{summary.detail}</span>
            </span>
        </div>
    );
}

// the key the fresh and entrance sets are built with: a line's id minus its region prefix
const keyOf = (line: BriefLine) => line.id.slice(line.id.indexOf(":") + 1);

// a filter that matched nothing in a region leaves a sentence, not a heading over an empty frame
function NoMatch() {
    return <span className="px-[11px] py-1 text-[10.5px] text-ink-faint">Nothing here matches the filter.</span>;
}

// An initiative's name and its id are the two things you carry out of the Brief — into a prompt, a
// `wsh effort` call, a message to someone. The row is a button, so neither could be dragged out of it:
// a mousedown inside a button starts a click, not a text selection. The expanded detail's id line
// (inlinetrackerview) copies the bare id for the same reason.
// A left click expands the row, so the activity sheet is opened from here instead.
// The row's own edits sit here too (the row's "..." opens the same menu), so renaming, archiving or
// deleting an initiative does not mean expanding it to reach the detail's action bar first.
type InitiativeManage = {
    status: string;
    rename: () => void;
    details: () => void;
    togglePause: () => void;
    archive: () => void;
    unarchive: () => void;
    remove: () => void;
};

function showInitiativeMenu(
    line: BriefLine,
    ev: React.MouseEvent,
    openActivity: (oref: string) => void,
    manage?: InitiativeManage
): void {
    const target = line.target;
    const oid = target != null && "oref" in target ? target.oref.replace(/^effort:/, "") : "";
    const items: ContextMenuItem[] = [];
    if (manage != null) {
        const archived = isArchivedStatus(manage.status);
        items.push(
            { label: "Rename", icon: <Pencil size={15} />, click: manage.rename },
            { label: "Edit details…", icon: <SlidersHorizontal size={15} />, click: manage.details }
        );
        if (archived) {
            items.push({ label: "Unarchive", icon: <ArchiveRestore size={15} />, click: manage.unarchive });
        } else {
            items.push(
                manage.status === "paused"
                    ? { label: "Resume", icon: <Play size={15} />, click: manage.togglePause }
                    : { label: "Pause", icon: <Pause size={15} />, click: manage.togglePause },
                { label: "Archive", icon: <Archive size={15} />, click: manage.archive }
            );
        }
        items.push({ type: "separator" });
    }
    if (oid !== "") {
        items.push({
            label: "Open activity",
            icon: <ArrowUpRight size={15} />,
            click: () => openActivity("effort:" + oid),
        });
    }
    items.push({
        label: "Copy name",
        icon: <Copy size={15} />,
        click: () => void navigator.clipboard.writeText(line.title),
    });
    if (oid !== "") {
        items.push({
            label: "Copy handle",
            icon: <Copy size={15} />,
            click: () => void navigator.clipboard.writeText("wsh effort show " + oid),
        });
    }
    if (manage != null) {
        // no confirm step: the delete waits out the Brief's undo window like every other row delete
        items.push(
            { type: "separator" },
            { label: "Delete", icon: <Trash2 size={15} />, danger: true, click: manage.remove }
        );
    }
    ContextMenuModel.getInstance().showContextMenu(items, ev);
}

// module scope, not useState: a j/k cursor that reset on every glance at another surface would be worse
// than none.
// Cast per this repo's convention: under the pinned jotai, atom<T | undefined>(undefined) infers a
// read-only Atom, and the setter is only callable once it is a PrimitiveAtom.
const briefCursorAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;

// The inline tracker's state, module scope for the cursor's reason: the Brief unmounts on every surface
// switch, and an initiative that silently re-collapsed while you were away would be worse than none.
// Keyed by BRIEF LINE id rather than oref, because the same effort can also sit in Since you looked and only
// its Initiatives row expands.
const openInitiativeAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
const stageOverridesAtom = atom<Record<string, boolean>>({});

// Which regions the user has opened past their window. Module scope for the same reason as the cursor:
// the Brief unmounts on every surface switch, and a region that silently re-collapsed while you were
// reading a record would be worse than one that never opened.
// the ideas section folds on its own, in the side column
type FoldId = RegionId | "ideas";
const briefExpandedAtom = atom<Partial<Record<FoldId, boolean>>>({});

// Whether Runs shows its runs older than seven days, and Shipped its rows past the cap. Module scope for
// the same reason as the two above.
const briefStaleOpenAtom = atom(false);
const briefShippedOpenAtom = atom(false);
// which kind of run Runs and Shipped show; module scope for the same reason
const briefRunKindAtom = atom<RunKindFilter>("all") as PrimitiveAtom<RunKindFilter>;

// The plan reveal clips only while its height animates: left clipped, it cut off the chunk and stage menus
// that drop below the card's edge.
const planReveal: Variants = {
    initial: { ...(paneReveal.initial as object), overflow: "hidden" },
    animate: { ...(paneReveal.animate as object), transitionEnd: { overflow: "visible" } },
    exit: { ...(paneReveal.exit as object), overflow: "hidden" },
};

// a stable empty list, so a region with no rows does not churn the memos that read it
const NO_LINES: BriefLine[] = [];

// A Runs row reads its live run and the roster, and hooks cannot run inside the region's map, so the row
// is its own component.
const NO_RUN = atom<Run | undefined>(undefined);
function BriefRunRow({
    model,
    line,
    focused,
    selected,
    onOpenSheet,
    onOpenChunk,
}: {
    model: AgentsViewModel;
    line: BriefLine;
    focused: boolean;
    selected: boolean;
    onOpenSheet?: (e?: React.MouseEvent) => void; // the answer button opens the sheet with no gesture
    onOpenChunk: (effortOref: string, chunk: string) => void;
}) {
    const run = useAtomValue((line.runOid ? runAtom(line.runOid) : NO_RUN) as Atom<Run | undefined>);
    const agents = useAtomValue(model.agentsAtom);
    const projects = useAtomValue(projectsAtom);
    const index = useAtomValue(briefEffortIndexAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const asking = run != null ? leadAsker(run, agents) != null : line.state === "asking";
    // the lineage holds a lead run's dag; a run outside it reads by its own status alone
    const dag = run != null ? lineage.runs[run.id]?.dag : undefined;
    const face = runRowFace({
        line,
        run,
        dag,
        asking,
        project: projectName(run?.projectpath ?? "", projects),
        effort: run?.effortref != null ? index.get(run.effortref.effortoid) : undefined,
    });
    return (
        <RunRowView
            line={line}
            face={face}
            focused={focused}
            selected={selected}
            onOpenSheet={onOpenSheet}
            onOpenChunk={() => onOpenChunk(face.effortOref, face.chunk)}
            onAnswer={() => onOpenSheet?.()}
            onOpenAgent={() => {
                const worker = run != null ? leadWorker(run, agents) : undefined;
                const id = worker?.id ?? line.agentId;
                if (id == null) {
                    briefUndo.notify("No live session to open.");
                    return;
                }
                jumpToAgent(model, id);
            }}
            onStop={() =>
                run != null && confirmCancelRun(run.channeloid ?? "", run.id, liveWorkers(run, agents).length)
            }
        />
    );
}

export function BriefSurface({ model }: { model: AgentsViewModel }) {
    // the briefing pipeline, unchanged from briefingview: one load per entry, a dwell-gated visit ack,
    // the memoized projection, the DEV fixture seam, and the live attention read.
    const { snapshot, loading, error } = useAtomValue(briefingStateAtom);
    const fixture = useAtomValue(briefingFixtureAtom);
    const liveAgents = useAtomValue(model.agentsAtom);
    const liveAttention = useAtomValue(attentionAtom);

    useEffect(() => {
        loadBriefing();
    }, []);

    // DEV-only: the resource-linking scenario's seams (linkingdevhooks.ts)
    useEffect(() => {
        if (import.meta.env.DEV) {
            void import("./linkingdevhooks").then((m) => m.installLinkingDevHooks(model));
        }
    }, [model]);

    // The lists the Brief's boot restore validates against. Loaded here rather than inherited: in the Brief
    // composition the Subjects column does not mount, and that column is what loads both of these today.
    useEffect(() => {
        loadTaskList();
        // channels, because a Radar draft names a project and the landing has to resolve it to a channel
        loadChannels();
    }, []);

    // A Radar draft moved off the Stage with the panes it drew. It is one-shot — `landed` bounds it to a single
    // attempt, because a channel that never resolves must not re-fire on every change and yank the user back.
    const pendingDraft = useAtomValue(pendingRunDraftAtom);
    const setPendingDraft = useSetAtom(pendingRunDraftAtom);
    const channels = useAtomValue(channelsAtom);

    // Radar "Start investigation": put its project's channel on the subject, so the sheet opens on that
    // channel's launcher holding the draft rather than dropping it on the queue. A project with no channel yet
    // gets one minted, as + Run does.
    useEffect(() => {
        if (pendingDraft == null || pendingDraft.landed) {
            return;
        }
        const landing = radarDraftLanding(channels, pendingDraft);
        if (landing === "wait") {
            return;
        }
        setPendingDraft({ ...pendingDraft, landed: true });
        if (landing === "none") {
            return;
        }
        fireAndForget(async () => {
            try {
                const oid = landing.kind === "existing" ? landing.oid : await createChannel(landing.name, landing.path);
                // composing, as New run does: otherwise a channel with any past run opens on that run's
                // report, and the launcher holding the draft is one click away and looks like nothing happened
                setComposingRun(oid, true);
                await openChannelSheet(oid, null);
            } catch (e) {
                pushToast({ title: "Couldn't open the investigation's project", message: String(e), level: "error" });
            }
        });
    }, [pendingDraft, channels, setPendingDraft]);

    // Boot restore, Brief edition. A stored record lands on the record peek; a stored channel is forgotten
    // (briefrestore.ts). One-shot: this
    // surface unmounts on every nav switch, and a restore that re-ran would re-open a peek the user had closed.
    const storedSubject = useAtomValue(persistedSubjectAtom);
    const dossiers = useAtomValue(taskListAtom);
    const [restoreConsumed, consumeRestore] = useAtom(briefRestoreConsumedAtom);

    useEffect(() => {
        if (restoreConsumed) {
            return;
        }
        const plan = briefRestorePlan(storedSubject, {
            channels: channels?.map((c) => c.oid) ?? null,
            dossiers: dossiers?.map((d) => d.id) ?? null,
        });
        if (plan.action === "wait") {
            return;
        }
        consumeRestore(true);
        if (plan.action === "record") {
            globalStore.set(briefPeekRecordAtom, plan.id);
            return;
        }
        globalStore.set(persistedSubjectAtom, null);
    }, [storedSubject, dossiers, channels, restoreConsumed, consumeRestore]);

    // dwell, not load: a glance-and-close must leave the delta unseen so it repeats on the next visit.
    const snapshotComplete = snapshot?.complete === true;
    const queryStartedAt = snapshot?.queryStartedAt;
    useEffect(() => {
        if (!snapshotComplete) {
            return;
        }
        const t = window.setTimeout(ackBriefingVisit, 3000);
        return () => window.clearTimeout(t);
    }, [snapshotComplete, queryStartedAt]);

    const agents = fixture != null ? BRIEFING_FIXTURES[fixture].agents : liveAgents;
    // the plan-gate modal reads the roster out of this atom, and the Stage was its only writer
    useEffect(() => {
        setDagModalAgentsContext(model, agents);
    }, [model, agents]);
    const model_ = useMemo(() => {
        if (snapshot == null) {
            return null;
        }
        return projectBriefing({
            state: snapshot.state,
            agents,
            actualCursor: snapshot.actualCursor,
            queryStartedAt: snapshot.queryStartedAt,
            sevenDaysAgo: snapshot.queryStartedAt - SEVEN_DAYS_MS,
        });
    }, [snapshot, agents]);

    // a fixture seeds attention the same way it seeds the roster, so every fixture previews the queue.
    const attention = fixture != null ? BRIEFING_FIXTURES[fixture].attention : liveAttention;
    // memoized because the j/k controller below is registered per identity: recomputing these every
    // render would re-register it every render. They are pure functions of the snapshot projection, so
    // pinning them to it also stops groupDelta's "now" drifting between renders of the same snapshot.
    const queue = useMemo(
        () =>
            model_ != null
                ? buildAttentionQueue({ attention, efforts: model_.efforts, blockers: model_.blockers })
                : [],
        [model_, attention]
    );
    // the full projection, not the window: a blocked chunk on the seventh initiative is still waiting on
    // you, so the queue reads every effort even when the Initiatives region is only showing six.
    const efforts = useMemo(() => model_?.efforts ?? [], [model_]);

    // Each region opens at its cap and the region's own control opens the rest in place. The caps stay
    // display-side so the overflow count is what was actually hidden from the rows above it.
    const [expanded, setExpanded] = useAtom(briefExpandedAtom);
    const toggleRegion = useCallback(
        (id: FoldId) => setExpanded((prev) => ({ ...prev, [id]: prev[id] !== true })),
        [setExpanded]
    );
    const waitingOpen = expanded.waiting === true;
    const initiativesOpen = expanded.initiatives === true;
    const ideasOpen = expanded.ideas === true;
    const sessionsOpen = expanded.sessions === true;
    const behindOpen = expanded.behind === true;
    const queueSummary = useMemo(() => summarizeAttentionQueue(queue, Date.now()), [queue]);

    const effortGroups = useMemo(() => splitIdeas(efforts), [efforts]);
    // ordered before the cap, so the eight shown are the ones that need the next hour
    const effortWindow = useMemo(
        () => capRegion(orderInitiatives(effortGroups.trackers, agents), EFFORT_CAP, initiativesOpen),
        [effortGroups, agents, initiativesOpen]
    );
    const ideaWindow = useMemo(() => capRegion(effortGroups.ideas, IDEA_CAP, ideasOpen), [effortGroups, ideasOpen]);
    const [runKind, setRunKind] = useAtom(briefRunKindAtom);
    const sessions = useMemo(
        () =>
            model_ == null
                ? { rows: [], more: 0 }
                : sessionWindow(runKindLegs(model_, runKind), sessionsOpen, Date.now()),
        [model_, sessionsOpen, runKind]
    );
    // moment 1: which rows are new to YOU. Excludes `behind` deliberately — that region is entirely
    // since-your-last-visit by construction, so marking it would mark every row and its own label
    // already states the fact.
    const cursorTs = snapshot?.actualCursor ?? 0;
    const freshInitiatives = useMemo(
        () =>
            freshKeys(
                [...effortWindow.rows, ...ideaWindow.rows].map((e) => ({ key: e.oref, ts: e.updatedts })),
                cursorTs
            ),
        [effortWindow, ideaWindow, cursorTs]
    );

    // moment 2: only ids that arrive while the snapshot's identity is unchanged animate in. A refresh
    // reseeds silently, which is what stops a whole-snapshot swap from firing N entrances at once; the
    // live attention poll still lands a new waiting row against an unchanged key. Committed in a layout
    // effect rather than during render because the render pass can run twice (motiontokens.ts).
    const entranceIds = [
        ...queue.map((q) => q.key),
        // every effort rather than the window: opening the region is not news arriving, so the rows it
        // adds must not animate in as if they had
        ...efforts.map((e) => e.oref),
        ...sessions.rows.map((r) => r.key),
    ];
    const entranceKey = snapshot?.queryStartedAt?.toString();
    const entranceRef = useRef(initialEntranceState());
    const { animate: entering } = computeEntrances(entranceRef.current, entranceKey, entranceIds);
    const entranceIdsKey = entranceIds.join(",");
    useLayoutEffect(() => {
        entranceRef.current = computeEntrances(entranceRef.current, entranceKey, entranceIds).state;
    }, [entranceIdsKey, entranceKey]);

    const deltaWindow = useMemo(() => capRegion(model_?.delta ?? [], DELTA_CAP, behindOpen), [model_, behindOpen]);
    const deltaGroups = useMemo(() => groupDelta(deltaWindow.rows, Date.now()), [deltaWindow]);

    // The filter and the one-region view narrow what is drawn, and the nav ids are the drawn lines' own, so
    // j/k can never land on a row the filter hid.
    const [query, setQuery] = useState("");
    const [only, setOnly] = useState<RegionId | null>(null);
    const [staleOpen, setStaleOpen] = useAtom(briefStaleOpenAtom);
    const toggleOnly = (id: RegionId) => setOnly((cur) => (cur === id ? null : id));
    const filtering = query.trim() !== "";
    const [shippedOpen, setShippedOpen] = useAtom(briefShippedOpenAtom);
    const shippedAll = useMemo(
        () => (model_?.shipped ?? []).filter((s) => keepsRunKind(runKind, s.mode)),
        [model_, runKind]
    );
    const shipped = useMemo(
        () => capRegion(shippedAll, SHIPPED_CAP, shippedOpen || filtering),
        [shippedAll, shippedOpen, filtering]
    );
    // archived initiatives come off the effort list, not the briefing, and show only on request
    const [showArchived, setShowArchived] = useState(false);
    // the Ideas column's inline input
    const [jot, setJot] = useState("");
    const archivedSummaries = useAtomValue(archivedEffortsAtom);
    const archivedCards = useMemo(() => archivedSummaries.map(buildEffortCard), [archivedSummaries]);
    useEffect(() => {
        fireAndForget(loadArchivedEfforts);
    }, []);
    // a delete waiting out its undo window is already gone as far as the reader is concerned
    const pendingDeletes = useAtomValue(pendingDeleteKeysAtom);
    // leaving the Brief or the app inside the window still performs the delete the user did not undo;
    // beforeunload is best-effort, the RPCs are already in flight when the page goes
    useEffect(() => {
        const flush = () => void briefUndo.flushAll();
        window.addEventListener("beforeunload", flush);
        return () => {
            window.removeEventListener("beforeunload", flush);
            flush();
        };
    }, []);
    const lines = useMemo(() => {
        const now = Date.now();
        // trackers and ideas are drawn apart (an ideas section in the side column), so j/k has to read them apart
        const initiatives = filterLines(
            [...effortWindow.rows, ...(showArchived ? archivedCards : []), ...ideaWindow.rows]
                .filter((r) => !pendingDeletes.has(effortKey(r.oref)))
                .map(initiativeLine),
            query
        );
        return {
            waiting: filterLines(
                queue.map((q) => queueLine(q, now)),
                query
            ),
            trackers: initiatives.filter((l) => !l.idea),
            ideas: initiatives.filter((l) => l.idea),
            sessions: filterLines(
                sessions.rows.map((r) => sessionLine(r, now)),
                query
            ),
            behind: behindGroups(deltaGroups, shipped.rows, now)
                .map((g) => ({ ...g, lines: filterLines(g.lines, query) }))
                .filter((g) => g.lines.length > 0),
        };
    }, [
        queue,
        effortWindow,
        ideaWindow,
        showArchived,
        archivedCards,
        sessions,
        deltaGroups,
        shipped,
        query,
        pendingDeletes,
    ]);
    const staleCount = lines.sessions.filter((l) => l.stale).length;
    // Waiting's window: the first three rows, the rest behind Show all; a filter shows every match
    const waitingWindow = useMemo(
        () => capRegion(lines.waiting, WAITING_CAP, waitingOpen || filtering),
        [lines.waiting, waitingOpen, filtering]
    );
    const view = useMemo(() => {
        const shows = (id: RegionId) => only == null || only === id;
        // the side column and its ideas are drawn only when no one region is being read alone
        const sideShown = only == null;
        // a search reaches the folded runs too: a match hidden behind the fold would read as no match
        const sessionLines = staleOpen || filtering ? lines.sessions : lines.sessions.filter((l) => !l.stale);
        const behindLines = lines.behind.filter((g) => g.label !== SHIPPED_LABEL).flatMap((g) => g.lines);
        const shippedLines = lines.behind.find((g) => g.label === SHIPPED_LABEL)?.lines ?? NO_LINES;
        // j/k walks the rows in the order they are drawn: the main column (Waiting, Runs, Initiatives), then the
        // side column (Since you looked, Shipped, Ideas)
        const visible: BriefLine[] = [
            ...(shows("waiting") ? waitingWindow.rows : []),
            ...(shows("sessions") ? sessionLines : []),
            ...(shows("initiatives") ? lines.trackers : []),
            ...(shows("behind") ? behindLines : []),
            ...(sideShown ? shippedLines : []),
            ...(sideShown ? lines.ideas : []),
        ];
        return { shows, sideShown, sessionLines, shippedLines, visible };
    }, [lines, only, staleOpen, filtering, waitingWindow]);

    // --- inline tracker -----------------------------------------------------------------------------
    // The expanded initiative's plan is spliced into the SAME row list the cursor walks, so j/k falls
    // into the chunks and back out. A second ↑/↓ handler here would be a second cursor fighting the first.
    const [openInitiative, setOpenInitiative] = useAtom(openInitiativeAtom);
    const [stageOverrides, setStageOverrides] = useAtom(stageOverridesAtom);
    const [noteChunk, setNoteChunk] = useAtom(noteChunkAtom);
    const [readingNote, setReadingNote] = useAtom(readingNoteAtom);
    const effortCache = useAtomValue(effortDetailAtom);
    const expandedLine = view.visible.find((l) => l.id === openInitiative) ?? null;
    const openEffortORef = expandedLine != null ? expandableORef(expandedLine) : null;
    const openEffort = openEffortORef != null ? (effortCache.get(openEffortORef) ?? null) : null;
    // the freshest updatedts the app knows, so a chunk ticked by `wsh effort` out of band still refreshes
    const openCard = efforts.find((e) => e.oref === openEffortORef) ?? null;
    const openFreshTs = openCard?.updatedts;
    useEffect(() => {
        if (openEffortORef == null) {
            return;
        }
        // a failure here leaves the row expanded on its "loading" line rather than collapsing under the
        // click; the next snapshot refresh retries.
        fireAndForget(() => loadEffortDetail(openEffortORef, openFreshTs));
    }, [openEffortORef, openFreshTs]);

    const tracker = useMemo(() => {
        const feed =
            openEffort != null
                ? effortFeed(openEffort).filter(
                      (e) => !pendingDeletes.has(noteKey(openEffortORef ?? "", e.chunk, e.ts))
                  )
                : [];
        const rows = trackerRows({
            lines: view.visible,
            openLineId: openInitiative,
            chunks:
                openEffort != null
                    ? effortChunkRows(openEffort).filter(
                          (r) => !pendingDeletes.has(chunkKey(openEffortORef ?? "", r.label))
                      )
                    : null,
            noteCounts: feedNoteCounts(feed),
            stageOverrides,
        });
        return {
            rows,
            feed,
            navIds: trackerNavIds(rows),
            detail: rows.filter((r): r is DetailRow => r.kind !== "line"),
        };
    }, [view.visible, openInitiative, openEffort, openEffortORef, openCard, stageOverrides, pendingDeletes]);

    const [storedCursor, setStoredCursor] = useAtom(briefCursorAtom);
    const cursor = resolveBriefCursor(tracker.navIds, storedCursor);
    // cursor == selection: landing on a chunk is what shows its notes, so j/k reads the plan as it walks.
    const setCursor = useCallback(
        (id: string) => {
            setStoredCursor(id);
            if (id.includes("/chunk:")) {
                setNoteChunk(id);
                setReadingNote(new Set());
            }
        },
        [setStoredCursor, setNoteChunk, setReadingNote]
    );
    const selected = tracker.rows.find((r) => r.kind === "chunk" && r.id === noteChunk);
    const selectedChunk = selected?.kind === "chunk" ? selected : null;
    // Work on this chunk, or Go to agent when one is already open on the initiative (workOnInitiative goes there first)
    const chunkWork =
        selectedChunk != null && openCard != null
            ? {
                  label:
                      openAgentFor(openCard.oref.replace(/^effort:/, ""), agents) != null
                          ? "Go to agent"
                          : "Work on this chunk",
                  onWork: () => void workOnInitiative(model, openCard, { chunk: selectedChunk.row.label }),
              }
            : undefined;
    const chunkPanel = selectedChunk != null && openInitiative != null;
    const closeNotes = useCallback(() => {
        setNoteChunk(null);
        setReadingNote(new Set());
    }, [setNoteChunk, setReadingNote]);

    // Every write goes through here so a failure is SHOWN rather than swallowed: the mutate helpers
    // write through and refresh the briefing's summary leg, and a rejected op would otherwise leave the
    // row looking unchanged with no explanation.
    const [mutateError, setMutateError] = useState<string | null>(null);
    const runMutation = useCallback((fn: () => Promise<unknown>) => {
        setMutateError(null);
        fn().catch((e) => setMutateError(e instanceof Error ? e.message : String(e)));
    }, []);

    // index math runs on the server's list, pending deletes included: the server still has them
    const planChunks = useMemo(() => (openEffort != null ? effortChunkRows(openEffort) : []), [openEffort]);
    const [renamingTitle, setRenamingTitle] = useState<string | null>(null);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const edits = useMemo<TrackerEdits | null>(() => {
        const oref = openEffortORef;
        if (oref == null || openEffort == null) {
            return null;
        }
        const chunks = planChunks;
        const indexOf = (label: string) => chunks.findIndex((c) => c.label === label);
        const ref = (label: string) => chunkRef(chunks, label);
        const scheduleRemove = (labels: string[], text: string) => {
            const pending = chunks.filter((c) => pendingDeletes.has(chunkKey(oref, c.label))).map((c) => c.label);
            if (!canRemove(chunks, [...pending, ...labels])) {
                setMutateError("An initiative keeps at least one chunk.");
                return;
            }
            briefUndo.schedule(
                labels.map((l) => chunkKey(oref, l)),
                text,
                () => removeChunks(oref, chunks, labels)
            );
        };
        const status = openEffort.status;
        return {
            oid: oref.replace(/^effort:/, ""),
            title: openEffort.title,
            effortStatus: status,
            total: chunks.length,
            stages: stageOptions(chunks),
            onSetStatus: (label, next) => {
                const prev = chunks.find((c) => c.label === label)?.status ?? "pending";
                runMutation(() => setChunkStatus(oref, ref(label), next));
                briefUndo.notify(`Marked “${label}” ${next}`, () =>
                    runMutation(() => setChunkStatus(oref, ref(label), prev))
                );
            },
            onRenameChunk: (label, next) => runMutation(() => renameChunk(oref, chunks, label, next)),
            canMove: (label, dir) => moveTarget(chunks, label, dir) != null,
            onMoveChunk: (label, dir) => {
                const at = moveTarget(chunks, label, dir);
                if (at == null) {
                    return;
                }
                const back = indexOf(label) + 1;
                runMutation(() => moveChunk(oref, chunks, label, at));
                briefUndo.notify(`Moved “${label}” ${dir}`, () =>
                    runMutation(() => moveChunk(oref, chunks, label, back))
                );
            },
            onMoveToStage: (label, stage) => {
                const at = stageMoveTarget(chunks, label, stage);
                const prev = chunks.find((c) => c.label === label);
                if (at == null || prev == null) {
                    return;
                }
                const back = indexOf(label) + 1;
                runMutation(() => moveChunkToStage(oref, chunks, label, stage, at));
                briefUndo.notify(`Moved to ${stage || "unstaged"}`, () =>
                    runMutation(() => moveChunkToStage(oref, chunks, label, prev.stage, back))
                );
            },
            onDeleteChunk: (label) => scheduleRemove([label], `Deleted “${label}”`),
            onRenameStage: (at, next) =>
                runMutation(() => setChunkStage(oref, stageRunLabels(chunks, at).map(ref), next)),
            onDeleteStage: (at) => {
                const labels = stageRunLabels(chunks, at);
                const name = chunks.find((c) => c.label === labels[0])?.stage || "unstaged";
                scheduleRemove(
                    labels,
                    `Deleted stage “${name}” · ${labels.length} chunk${labels.length === 1 ? "" : "s"}`
                );
            },
            onAddChunk: (label, stage, runAt) =>
                runMutation(() =>
                    addChunkAt(oref, label, stage, runAt != null ? appendInStageAt(chunks, runAt) : undefined)
                ),
            onRename: (title) => setRenamingTitle(title),
            onDetails: () => setDetailsOpen(true),
            onActivity: (e) => fireAndForget(() => openOrPeekAddress(model, oref, e)),
            onTogglePause: () => {
                const next = status === "paused" ? "active" : "paused";
                runMutation(() => setEffortStatus(oref, next));
                briefUndo.notify(next === "paused" ? "Paused" : "Resumed", () =>
                    runMutation(() => setEffortStatus(oref, status))
                );
            },
            onArchive: () => {
                runMutation(() => setEffortStatus(oref, "archived"));
                briefUndo.notify(`Archived “${openEffort.title}”`, () => runMutation(() => unarchiveEffort(oref)));
            },
            onUnarchive: () => runMutation(() => unarchiveEffort(oref)),
            onDelete: () => {
                setOpenInitiative(null);
                briefUndo.schedule([effortKey(oref)], `Deleted “${openEffort.title}”`, () => deleteEffort(oref));
            },
        };
    }, [model, openEffortORef, openEffort, planChunks, pendingDeletes, runMutation, setOpenInitiative]);

    // Alt+↑/↓: published only while the cursor sits on a chunk of the open plan
    const setChunkMove = useSetAtom(chunkMoveAtom);
    useEffect(() => {
        const row = tracker.rows.find((r) => r.id === cursor);
        if (edits == null || row?.kind !== "chunk") {
            setChunkMove(null);
            return;
        }
        setChunkMove(() => (dir: "up" | "down") => edits.onMoveChunk(row.row.label, dir));
        return () => setChunkMove(null);
    }, [edits, cursor, tracker.rows, setChunkMove]);
    // the sidebar's ↑/↓ move the ONE Brief cursor, opening the target's stage if it is collapsed
    const stepTo = (dir: "prev" | "next"): (() => void) | null => {
        if (selectedChunk == null || openInitiative == null) {
            return null;
        }
        const visible = planChunks.filter((c) => !pendingDeletes.has(chunkKey(selectedChunk.oref, c.label)));
        const to = stepChunk(visible, selectedChunk.row.label, dir);
        if (to == null) {
            return null;
        }
        return () => {
            const stage = visible.find((c) => c.label === to.label)?.stage ?? "";
            // stageRowId's run index is counted on this same filtered list, which is what trackerRows groups
            setStageOverrides((cur) => ({ ...cur, [stageRowId(openInitiative, stage, to.runAt)]: true }));
            setCursor(chunkRowId(openInitiative, to.label));
        };
    };
    const sheetOpen = useAtomValue(briefSheetOpenAtom);
    // a click hands its event over, so Ctrl peeks the row's target instead
    const openLine = useCallback(
        (target: LineTarget, e?: React.MouseEvent) => {
            if (target == null) {
                return;
            }
            if ("queue" in target) {
                const queue = target.queue;
                fireAndForget(() =>
                    queue.kind === "channel"
                        ? openOrPeek(
                              model,
                              { kind: "channel", channelId: queue.channelId, runId: queue.runId ?? undefined },
                              e
                          )
                        : openOrPeekAddress(model, queue.oref, e)
                );
                return;
            }
            fireAndForget(() => openOrPeekAddress(model, target.oref, e));
        },
        [model]
    );
    const cursorRow = tracker.rows.find((r) => r.id === cursor) ?? null;
    const cursorTarget = cursorRow?.kind === "line" ? cursorRow.line.target : null;
    // Enter's primary action, by what the cursor is on: an initiative expands in place (it no longer has
    // a sheet to open), a chunk opens its sidebar (its newest short note already reads open), every other
    // row opens its target.
    const toggleInitiative = useCallback(
        (lineId: string) => {
            setOpenInitiative((cur) => (cur === lineId ? null : lineId));
            setNoteChunk(null);
            setReadingNote(new Set());
        },
        [setOpenInitiative, setNoteChunk, setReadingNote]
    );
    const activateCursor = useCallback(() => {
        if (cursorRow == null) {
            return;
        }
        if (cursorRow.kind === "chunk") {
            setNoteChunk(cursorRow.id);
            setReadingNote(new Set());
            return;
        }
        if (cursorRow.kind === "line" && expandableORef(cursorRow.line) != null) {
            toggleInitiative(cursorRow.id);
            return;
        }
        if (cursorTarget != null) {
            openLine(cursorTarget);
        }
    }, [cursorRow, cursorTarget, openLine, setNoteChunk, setReadingNote, toggleInitiative]);
    const shippedLines = view.shippedLines;
    const stageRun = useAtomValue(stageRunAtom);
    const runList = useAtomValue(briefRunListAtom);
    // With a run sheet open on a run of the published list, j/k step the sheet through that list (design
    // L1830): the rows are the ones its n / N counts, and landing on one opens it. The cursor is still the
    // Brief's one cursor, so closing the sheet leaves it on the run last shown.
    const runNav = useMemo(() => {
        if (!sheetOpen || stageRun == null || !runList.includes(stageRun.id)) {
            return null;
        }
        const inList = new Set(runList);
        const shippedList = stageRun.status === "done";
        const oidOf = (l: BriefLine) =>
            shippedList
                ? l.target != null && "oref" in l.target
                    ? l.target.oref.replace(/^run:/, "")
                    : ""
                : (l.runOid ?? "");
        const navLines = (shippedList ? shippedLines : view.sessionLines).filter((l) => inList.has(oidOf(l)));
        return { lines: navLines, cursorId: navLines.find((l) => oidOf(l) === stageRun.id)?.id };
    }, [sheetOpen, stageRun, runList, shippedLines, view.sessionLines]);
    // j/k across every region in render order, and Enter opens the row under the cursor. Enter is left alone
    // while a sheet is open, because the sheet's own Enter (an ask's submit) is the one on screen, and on a
    // row that opens nothing, so the key passes through. Typing never reaches here: list keys are off in a field.
    useSurfaceListNav(
        useMemo<ListNavController>(
            () =>
                runNav != null
                    ? {
                          surface: "jarvis",
                          navigableIds: runNav.lines.map((l) => l.id),
                          cursorId: runNav.cursorId,
                          setCursor: (id: string) => {
                              setCursor(id);
                              const target = runNav.lines.find((l) => l.id === id)?.target;
                              if (target != null) {
                                  openLine(target);
                              }
                          },
                      }
                    : {
                          surface: "jarvis",
                          navigableIds: tracker.navIds,
                          cursorId: cursor,
                          setCursor,
                          activate: sheetOpen || cursorRow == null ? undefined : activateCursor,
                          peekTarget: sheetOpen ? undefined : () => lineOpenTarget(cursorTarget),
                      },
            [runNav, tracker.navIds, cursor, setCursor, openLine, sheetOpen, cursorRow, activateCursor, cursorTarget]
        )
    );
    // the regions scroll as one page, so a cursor moved off-screen has to be brought back
    useEffect(() => {
        document.querySelector('[data-jarvis-brief-cursor="true"]')?.scrollIntoView({ block: "nearest" });
    }, [cursor]);

    const fleet = briefFleet(agents);

    // The profile modal is open on a project the palette can name, so it lives in jarvisstore. The detail
    // sheet draws the surface's active subject, so what is open lives in the subject store instead.
    const [profileTarget, setProfileTarget] = useAtom(briefProfileAtom);

    // The surface's own keys: the run switcher, the record band and the composer's i/Escape. The Stage
    // used to register these for a composition that no longer exists.
    const jarvisBindings = useMemo(() => buildJarvisBindings(model), [model]);
    useKeybindings(jarvisBindings);

    const projectCount = snapshot?.state.projects?.length ?? 0;
    const paused = efforts.filter((e) => e.status === "paused").length;
    const liveN = view.sessionLines.filter((l) => !l.stale).length;
    const visitCursor = useAtomValue(briefingCursorAtom);
    const deltaRowsN = lines.behind.filter((g) => g.label !== SHIPPED_LABEL).reduce((n, g) => n + g.lines.length, 0);

    // the run sheet mounts outside the Brief's snapshot, so the Brief publishes what its ↳ chunk line and
    // its n / N position read
    useEffect(() => {
        globalStore.set(
            briefEffortIndexAtom,
            new Map(
                [...efforts, ...archivedCards].map((e) => [
                    e.oref.replace(/^effort:/, ""),
                    { oref: e.oref, title: e.title, chunkStages: e.chunkStages },
                ])
            )
        );
    }, [efforts, archivedCards]);
    // Work on reads the live initiatives only: an archived one is finished, so it offers nothing to resume
    const liveCards = useMemo(() => new Map(efforts.map((e) => [e.oref, e])), [efforts]);
    const cardOf = (l: BriefLine) =>
        l.target != null && "oref" in l.target ? liveCards.get(l.target.oref) : undefined;
    const resumeOf = (l: BriefLine): InitiativeResume | undefined => {
        const c = cardOf(l);
        return c != null ? initiativeResume(c.oref.replace(/^effort:/, ""), c.lastnote, agents, Date.now()) : undefined;
    };
    const trackerLines = lines.trackers;
    const ideaLines = lines.ideas;
    // the row menu's edits reach archived initiatives too (unarchive, delete), so they read both lists
    const allCards = useMemo(
        () => new Map([...efforts, ...archivedCards].map((e) => [e.oref, e])),
        [efforts, archivedCards]
    );
    const manageOf = (l: BriefLine): InitiativeManage | undefined => {
        const c = l.target != null && "oref" in l.target ? allCards.get(l.target.oref) : undefined;
        if (c == null) {
            return undefined;
        }
        const { oref, title, status } = c;
        // rename and details live on the expanded row (the title input, the form fed by the effort detail)
        const expand = () => {
            setCursor(l.id);
            if (openInitiative !== l.id) {
                toggleInitiative(l.id);
            }
        };
        return {
            status,
            rename: () => {
                expand();
                setRenamingTitle(title);
            },
            details: () => {
                expand();
                setDetailsOpen(true);
            },
            togglePause: () => {
                const next = status === "paused" ? "active" : "paused";
                runMutation(() => setEffortStatus(oref, next));
                briefUndo.notify(next === "paused" ? "Paused" : "Resumed", () =>
                    runMutation(() => setEffortStatus(oref, status))
                );
            },
            archive: () => {
                runMutation(() => setEffortStatus(oref, "archived"));
                briefUndo.notify(`Archived “${title}”`, () => runMutation(() => unarchiveEffort(oref)));
            },
            unarchive: () => runMutation(() => unarchiveEffort(oref)),
            remove: () => {
                if (openInitiative === l.id) {
                    setOpenInitiative(null);
                }
                briefUndo.schedule([effortKey(oref)], `Deleted “${title}”`, () => deleteEffort(oref));
            },
        };
    };
    useEffect(() => {
        globalStore.set(
            briefRunListAtom,
            stageRun != null && stageRun.status === "done"
                ? shipped.rows.map((r) => r.oref.replace(/^run:/, ""))
                : view.sessionLines.flatMap((l) => (l.runOid ? [l.runOid] : []))
        );
    }, [stageRun, shipped, view.sessionLines]);

    // Waiting's in-place button: Approve and Retry act on the exact phase or task the server named, and
    // anything else opens the row's run
    const actOnQueue = (q: QueueRow, l: BriefLine) => {
        const act = queueAction(q);
        if (act.kind === "open") {
            if (l.target != null) {
                openLine(l.target);
            }
            return;
        }
        if (act.kind === "work-on") {
            if (q.nav?.kind === "effort") {
                const oref = q.nav.oref;
                fireAndForget(() => workOnDueChunk(model, oref, q.title));
            }
            return;
        }
        // the Cockpit's Needs-you strip runs the same call (attentionrun.ts), answering in its own toast
        fireAndForget(() =>
            runAttentionAct(act, q, {
                done: (text) => briefUndo.notify(text),
                fail: (text) => briefUndo.error(text),
            })
        );
    };
    const queueOf = (l: BriefLine) => queue.find((q) => "waiting:" + q.key === l.id)!;
    const ackable = ackableRuns(queue);
    // every run is accepted on its own, so one refused ack leaves the rest accepted and names how many failed
    const ackAll = () =>
        fireAndForget(async () => {
            const results = await Promise.allSettled(
                ackable.map((r) => RpcApi.AckRunCommand(TabRpcClient, { channelid: r.channelId, runid: r.runId }))
            );
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed > 0) {
                briefUndo.error(`${failed} of ${results.length} runs could not be accepted`);
            } else {
                briefUndo.notify(`Accepted ${results.length} unverified runs`);
            }
        });

    // a run row's ↳ opens its initiative inline on that chunk, with the chunk's stage unfolded
    const revealChunk = useCallback(
        (effortOref: string, chunk: string) => {
            const lineId = "initiatives:" + effortOref;
            globalStore.set(briefSheetOpenAtom, false);
            clearSubject();
            forgetOrigin();
            setOpenInitiative(lineId);
            setCursor(chunkRowId(lineId, chunk));
            fireAndForget(async () => {
                // the stage override needs the plan, which a never-opened initiative has not loaded yet
                await loadEffortDetail(effortOref);
                const effort = globalStore.get(effortDetailAtom).get(effortOref);
                const chunks = effort != null ? effortChunkRows(effort) : [];
                const at = groupChunksByStage(chunks).findIndex((g) => g.rows.some((r) => r.label === chunk));
                const stage = chunks.find((c) => c.label === chunk)?.stage ?? "";
                if (at >= 0) {
                    setStageOverrides((cur) => ({ ...cur, [stageRowId(lineId, stage, at)]: true }));
                }
            });
        },
        [setOpenInitiative, setCursor, setStageOverrides]
    );
    // the run sheet's ↳ chunk line reveals through the same handler, published because the sheet mounts
    // outside the Brief
    const setRevealChunk = useSetAtom(briefRevealChunkAtom);
    useEffect(() => {
        setRevealChunk(() => revealChunk);
        return () => setRevealChunk(null);
    }, [revealChunk, setRevealChunk]);
    const firstLoad = snapshot == null && loading;
    const loadFailed = snapshot == null && error != null;
    const staleSnapshot = snapshot != null && error != null;

    // the rename input and the opened plan, shared by a tracker card and an idea row
    const titleSlotOf = (l: BriefLine): ReactNode =>
        l.id === openInitiative && renamingTitle != null ? (
            <input
                autoFocus
                data-jarvis-rename-input
                value={renamingTitle}
                onChange={(e) => setRenamingTitle(e.target.value)}
                onBlur={() => {
                    const t = renamingTitle.trim();
                    setRenamingTitle(null);
                    if (t !== "" && openEffortORef != null && t !== openEffort?.title) {
                        runMutation(() => renameEffort(openEffortORef, t));
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                        e.stopPropagation();
                        setRenamingTitle(null);
                    }
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded-[6px] border border-accent/60 bg-background px-[7px] py-0.5 text-[13px] text-ink-hi outline-none"
            />
        ) : undefined;
    // the plan reveal: height+opacity on the macro duration, and NOT a layout node, so the reveal and the
    // list's reflow don't fight
    const detailOf = (l: BriefLine): ReactNode => (
        <AnimatePresence initial={false}>
            {l.id === openInitiative ? (
                <motion.div key="detail" variants={planReveal} initial="initial" animate="animate" exit="exit">
                    {edits != null ? (
                        <InitiativeDetail
                            rows={tracker.detail}
                            cursor={cursor}
                            edits={edits}
                            onSelectChunk={(id) => {
                                setCursor(id);
                                setNoteChunk(id);
                                setReadingNote(new Set());
                            }}
                            onToggleStage={(id, open) => setStageOverrides((cur) => ({ ...cur, [id]: open }))}
                        />
                    ) : (
                        <p data-jarvis-initiative-detail="loading" className="px-3 py-2 text-[12px] text-muted">
                            {tracker.detail[0]?.kind === "pending" ? tracker.detail[0].message : ""}
                        </p>
                    )}
                    {mutateError != null && selectedChunk == null ? (
                        <p className="px-3 pb-2 text-[11px] text-error">{mutateError}</p>
                    ) : null}
                </motion.div>
            ) : null}
        </AnimatePresence>
    );

    // an opened idea: no plan to edit, only the ways to start one
    const ideaDetailOf = (l: BriefLine): ReactNode => (
        <AnimatePresence initial={false}>
            {l.id === openInitiative ? (
                <motion.div key="detail" variants={planReveal} initial="initial" animate="animate" exit="exit">
                    {edits != null && openEffort != null ? (
                        <IdeaDetail
                            jotted={noteStamp(openEffort.createdts)}
                            edits={edits}
                            onPlan={() => {
                                const c = cardOf(l);
                                if (c != null) {
                                    void workOnInitiative(model, c, "plan");
                                }
                            }}
                        />
                    ) : (
                        <p data-jarvis-idea-detail="loading" className="px-3 pb-2.5 text-[12px] text-muted">
                            Loading…
                        </p>
                    )}
                    {mutateError != null ? <p className="px-3 pb-2 text-[11px] text-error">{mutateError}</p> : null}
                </motion.div>
            ) : null}
        </AnimatePresence>
    );

    return (
        <div data-jarvis-region="brief" className="absolute inset-0 flex flex-col bg-background">
            <header className="flex h-[54px] flex-none items-center gap-2.5 border-b border-edge-faint bg-surface px-[22px]">
                <span aria-hidden className="text-[12px] font-semibold text-accent-soft">
                    ◈
                </span>
                <span className="flex-none text-[15px] font-bold tracking-[-.01em] text-ink-hi">Jarvis</span>
                {projectCount > 0 ? (
                    <span className="whitespace-nowrap text-[10.5px] tabular-nums text-ink-mid">
                        all work · {projectCount} {projectCount === 1 ? "project" : "projects"}
                    </span>
                ) : null}
                <span aria-hidden className="mx-1 h-[18px] w-px flex-none bg-border" />
                {/* the chip needs a snapshot: "all clear" over a load that has not landed is a lie */}
                {model_ != null ? (
                    <span
                        data-jarvis-brief-band="waiting"
                        className={cn(
                            "flex flex-none items-center gap-[7px] rounded-[6px] border px-2.5 py-[3px] text-[10.5px] font-bold uppercase tracking-[.06em] transition-colors duration-[140ms]",
                            queue.length === 0
                                ? "border-success/30 bg-success/15 text-success"
                                : "border-asking/30 bg-asking/15 text-asking"
                        )}
                    >
                        <span
                            className={cn(
                                "h-[5px] w-[5px] flex-none rounded-full transition-colors duration-[140ms]",
                                queue.length === 0 ? "bg-success" : "pulse-dot-slow bg-asking"
                            )}
                        />
                        {queue.length === 0 ? (
                            "all clear"
                        ) : (
                            <span className="flex items-center gap-1">
                                <RollingCount value={queue.length} /> waiting
                            </span>
                        )}
                    </span>
                ) : null}
                <span
                    data-jarvis-brief-band="fleet"
                    className="flex-none whitespace-nowrap text-[10.5px] tabular-nums text-ink-mid"
                >
                    {fleet.line}
                </span>
                <span className="flex-1" />
                <label
                    className={cn(
                        "flex h-[28px] w-[200px] flex-none items-center gap-2 rounded-[8px] border bg-surface-raised pl-2.5 focus-within:border-accent/60",
                        filtering ? "border-accent/60 pr-1" : "border-edge-mid pr-1.5"
                    )}
                >
                    <Search
                        aria-hidden
                        size={13}
                        strokeWidth={2}
                        className={cn("flex-none", filtering ? "text-accent-soft" : "text-muted")}
                    />
                    <input
                        data-jarvis-brief-filter
                        aria-label="Filter the Brief"
                        placeholder="Filter"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                setQuery("");
                                e.currentTarget.blur();
                            }
                        }}
                        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-hi outline-none placeholder:text-muted"
                    />
                    {filtering ? (
                        <>
                            <span className="flex-none whitespace-nowrap text-[10.5px] tabular-nums text-muted">
                                {view.visible.length} {view.visible.length === 1 ? "hit" : "hits"}
                            </span>
                            <button
                                type="button"
                                aria-label="Clear filter"
                                onClick={() => setQuery("")}
                                className="flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-[5px] text-ink-mid hover:bg-surface-hover hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                <X aria-hidden size={11} strokeWidth={2.2} />
                            </button>
                        </>
                    ) : (
                        <kbd className="flex-none rounded-[4px] border border-edge-strong px-[5px] font-mono text-[10.5px] leading-4 text-ink-mid">
                            /
                        </kbd>
                    )}
                </label>
                {/* the settings group: three quiet controls, one size */}
                <div className="flex flex-none items-center gap-1">
                    <AutonomyLadder />
                    {/* A real control with the control recipe's border: invariant 4 forbids camouflaging it among
                        the status chips above, which are borderless labels. */}
                    <button
                        type="button"
                        data-jarvis-brief-profile
                        aria-haspopup="dialog"
                        aria-expanded={profileTarget != null}
                        aria-label="Profile — run defaults"
                        title="Profile — run defaults"
                        onClick={() => setProfileTarget("")}
                        className="flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center rounded-[8px] border border-edge-mid bg-surface-raised text-ink-mid hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <SlidersHorizontal aria-hidden size={14} strokeWidth={1.8} />
                    </button>
                    <TourButton />
                </div>
                <span aria-hidden className="mx-0.5 h-[18px] w-px flex-none bg-border" />
                <NewInitiativeControl model={model} />
                {/* the surface's one accent button; r opens the same launcher (buildJarvisBindings) */}
                <button
                    type="button"
                    data-jarvis-new-run
                    title="New run (r)"
                    onClick={() => openLauncher(model, "run")}
                    className="flex h-[28px] flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-accent px-[11px] text-[12px] font-bold text-background shadow-inset-highlight hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    New run
                    <kbd className="font-mono text-[10px] font-normal text-accent-900">r</kbd>
                </button>
            </header>
            {/* both bands push the surface down, so height belongs in the animation rather than a cut */}
            <AnimatePresence initial={false}>
                {staleSnapshot ? (
                    <motion.div
                        key="stale"
                        variants={paneReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        data-jarvis-brief-band="stale"
                        className="flex flex-none items-center gap-2 overflow-hidden border-b border-edge-faint px-[22px] py-1 text-[10.5px] text-error"
                    >
                        <X size={12} aria-hidden className="flex-none" />
                        refresh failed — showing the previous snapshot
                    </motion.div>
                ) : null}
            </AnimatePresence>
            {/* @container, not a media query: the sidebar's width rule is about how much SURFACE the
                index has left, and the window is not the surface. */}
            <div className="@container relative flex min-h-0 flex-1">
                <div
                    className={cn(
                        "flex min-h-0 flex-1 flex-col gap-[26px] overflow-y-auto px-[22px] pb-2.5 pt-5",
                        // the panel docks only in the wide band, where it takes the side column's place and the
                        // scroller keeps a gutter for it (460px and the 22px edge); below it, it floats over the index
                        selectedChunk != null && "@min-[1281px]:pr-[482px]"
                    )}
                    aria-live="polite"
                >
                    <AnimatePresence initial={false}>
                        {loadFailed ? (
                            <motion.div
                                key="load-error"
                                variants={paneReveal}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                data-jarvis-brief-state="error"
                                className="flex flex-col gap-2 overflow-hidden rounded-[10px] border border-border bg-surface px-4 py-3"
                            >
                                <span className="text-[13px] font-semibold text-ink-hi">
                                    Couldn't load your work state.
                                </span>
                                <span className="text-[12px] text-secondary">{error}</span>
                                <button
                                    type="button"
                                    onClick={refreshBriefing}
                                    className="mt-1 w-fit cursor-pointer rounded-[7px] border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-semibold text-secondary hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    Retry
                                </button>
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                    {/* mode="wait" so the skeleton is gone before the regions arrive: the two cross-faded in
                    place would read as a double exposure of the same four headings. The skeleton blocks'
                    own animate-pulse is unchanged. */}
                    <AnimatePresence mode="wait" initial={false}>
                        {firstLoad ? (
                            <motion.div
                                key="skeleton"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                                data-jarvis-brief-state="loading"
                                className="flex min-h-0 flex-1 flex-col gap-[26px]"
                            >
                                {/* the main regions only: the side column's sections are records of the past */}
                                {SKELETON_REGIONS.map((id) => (
                                    <div key={id} className="flex min-h-0 flex-1 flex-col gap-2">
                                        <span className={cn(REGION_LABEL, "text-feed-label")}>{REGIONS[id].label}</span>
                                        <div className="min-h-12 flex-1 animate-pulse rounded-[10px] bg-edge-strong motion-reduce:animate-none" />
                                    </div>
                                ))}
                            </motion.div>
                        ) : null}
                        {model_ != null ? (
                            <motion.div
                                key="regions"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                                // main column (minmax 1fr) and side column (340px); below a container width of
                                // 1100px the side column drops under the main one. A region read alone has no
                                // side column to make room for, and neither has a chunk panel docked in its place.
                                className={cn(
                                    "grid grid-cols-1 items-start gap-7",
                                    view.sideShown && "@min-[1100px]:grid-cols-[minmax(0,1fr)_340px]",
                                    view.sideShown && chunkPanel && "@min-[1281px]:grid-cols-[minmax(0,1fr)]"
                                )}
                            >
                                <div className="flex min-w-0 flex-col gap-6">
                                    {/* nothing waiting is said once, by the header chip; the region comes back
                                    with the first gate or ask, or when a filter or the one-region view asks */}
                                    {view.shows("waiting") && (queue.length > 0 || filtering || only === "waiting") ? (
                                        <Region
                                            id="waiting"
                                            alert={queue.length > 0}
                                            count={queue.length || undefined}
                                            empty={queue.length === 0}
                                            gap="gap-[9px]"
                                            meta={
                                                queueSummary?.oldestTs != null
                                                    ? `gates first · oldest ${formatAge(Date.now() - queueSummary.oldestTs)}`
                                                    : "gates first"
                                            }
                                            only={only === "waiting"}
                                            onOnly={() => toggleOnly("waiting")}
                                            tools={
                                                ackable.length > 1 ? (
                                                    <button
                                                        type="button"
                                                        data-jarvis-queue-ack-all
                                                        onClick={ackAll}
                                                        className={cn(SMALL_BTN, "flex-none")}
                                                    >
                                                        Accept {ackable.length} unverified
                                                    </button>
                                                ) : undefined
                                            }
                                        >
                                            {queueSummary != null ? (
                                                // the summary line, then the first three rows, in one box
                                                <div
                                                    id="jarvis-attention-details"
                                                    className="flex flex-col rounded-[10px] border border-edge-mid bg-surface p-1"
                                                >
                                                    <QueueSummaryView
                                                        summary={queueSummary}
                                                        error={queue.some((q) => q.tone === "error")}
                                                    />
                                                    {lines.waiting.length === 0 ? <NoMatch /> : null}
                                                    <MotionConfig reducedMotion="user">
                                                        <AnimatePresence initial={false}>
                                                            {waitingWindow.rows.map((l) => (
                                                                <motion.div
                                                                    key={l.id}
                                                                    layout
                                                                    variants={cardVariants}
                                                                    initial={entering.has(keyOf(l)) ? "initial" : false}
                                                                    animate="animate"
                                                                    exit="exit"
                                                                    transition={{
                                                                        duration: MOTION.durMacro,
                                                                        ease: MOTION.easeFluid,
                                                                    }}
                                                                >
                                                                    <WaitingRow
                                                                        line={l}
                                                                        focused={cursor === l.id}
                                                                        act={queueAction(queueOf(l))}
                                                                        onOpen={
                                                                            l.target != null
                                                                                ? (e) => openLine(l.target, e)
                                                                                : undefined
                                                                        }
                                                                        onAct={() => actOnQueue(queueOf(l), l)}
                                                                    />
                                                                </motion.div>
                                                            ))}
                                                        </AnimatePresence>
                                                    </MotionConfig>
                                                    {/* what the window hid, and the way to it: the rows past the third fold
                                                    here rather than behind a summary button */}
                                                    {lines.waiting.length > WAITING_CAP && !filtering ? (
                                                        <button
                                                            type="button"
                                                            data-jarvis-brief-attention-summary
                                                            aria-expanded={waitingOpen}
                                                            aria-controls="jarvis-attention-details"
                                                            onClick={() => toggleRegion("waiting")}
                                                            className={cn(LINK_BTN, "mx-2 mb-1.5 mt-1")}
                                                        >
                                                            {waitingOpen
                                                                ? "Show fewer"
                                                                : `Show all ${lines.waiting.length}`}
                                                        </button>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </Region>
                                    ) : null}
                                    {view.shows("sessions") ? (
                                        <Region
                                            id="sessions"
                                            empty={sessions.rows.length === 0}
                                            absent={runKind === "all" ? undefined : `No ${runKind} run is going.`}
                                            gap="gap-[9px]"
                                            meta={`${liveN} live`}
                                            only={only === "sessions"}
                                            onOnly={() => toggleOnly("sessions")}
                                            tools={<RunKindToggle value={runKind} onChange={setRunKind} />}
                                            act={
                                                <button
                                                    type="button"
                                                    data-jarvis-empty-act="run"
                                                    onClick={() => openLauncher(model, "run")}
                                                    className={EMPTY_ACT}
                                                >
                                                    New run
                                                    <kbd className="font-mono text-[10px] font-normal text-muted">
                                                        r
                                                    </kbd>
                                                </button>
                                            }
                                        >
                                            <div className="flex flex-col">
                                                {filtering && view.sessionLines.length === 0 ? <NoMatch /> : null}
                                                <MotionConfig reducedMotion="user">
                                                    <AnimatePresence initial={false}>
                                                        {view.sessionLines.map((l) => (
                                                            <motion.div
                                                                key={l.id}
                                                                layout
                                                                variants={cardVariants}
                                                                initial={entering.has(keyOf(l)) ? "initial" : false}
                                                                animate="animate"
                                                                exit="exit"
                                                                transition={{
                                                                    duration: MOTION.durMacro,
                                                                    ease: MOTION.easeFluid,
                                                                }}
                                                            >
                                                                <BriefRunRow
                                                                    model={model}
                                                                    line={l}
                                                                    focused={cursor === l.id}
                                                                    selected={sheetOpen && stageRun?.id === l.runOid}
                                                                    onOpenSheet={
                                                                        l.target != null
                                                                            ? (e) => openLine(l.target, e)
                                                                            : undefined
                                                                    }
                                                                    onOpenChunk={revealChunk}
                                                                />
                                                            </motion.div>
                                                        ))}
                                                    </AnimatePresence>
                                                </MotionConfig>
                                                {/* runs the lead marked executing and then never touched again: they are
                                            real rows, but a week of silence reads as dead, so they fold */}
                                                {staleCount > 0 && !filtering ? (
                                                    <button
                                                        type="button"
                                                        aria-expanded={staleOpen}
                                                        data-jarvis-brief-stale
                                                        onClick={() => setStaleOpen(!staleOpen)}
                                                        className={cn(LINK_BTN, "mt-0.5")}
                                                    >
                                                        {staleOpen ? `Hide ${staleCount}` : `+${staleCount}`}{" "}
                                                        {staleCount === 1 ? "run" : "runs"} older than 7 days
                                                    </button>
                                                ) : null}
                                                <MoreControl
                                                    n={sessions.more}
                                                    expanded={sessionsOpen}
                                                    onToggle={() => toggleRegion("sessions")}
                                                />
                                            </div>
                                        </Region>
                                    ) : null}
                                    {view.shows("initiatives") ? (
                                        <Region
                                            id="initiatives"
                                            count={trackerLines.length}
                                            empty={efforts.length === 0 && archivedCards.length === 0}
                                            gap="gap-[9px]"
                                            meta={paused > 0 ? `${paused} paused` : "all moving"}
                                            only={only === "initiatives"}
                                            onOnly={() => toggleOnly("initiatives")}
                                            act={
                                                <button
                                                    type="button"
                                                    data-jarvis-empty-act="initiative"
                                                    onClick={() => globalStore.set(model.newInitiativeOpenAtom, true)}
                                                    className={EMPTY_ACT}
                                                >
                                                    New initiative
                                                    <kbd className="font-mono text-[10px] font-normal text-muted">
                                                        {formatChordString("Shift:n")}
                                                    </kbd>
                                                </button>
                                            }
                                        >
                                            <div className="flex min-w-0 flex-col gap-2">
                                                {trackerLines.length === 0 ? (
                                                    filtering ? (
                                                        <NoMatch />
                                                    ) : (
                                                        <span className="px-[11px] py-[7px] text-[12.5px] text-ink-mid">
                                                            {REGIONS.initiatives.absent}
                                                        </span>
                                                    )
                                                ) : null}
                                                {trackerLines.length > 0 ||
                                                effortWindow.more > 0 ||
                                                initiativesOpen ||
                                                archivedCards.length > 0 ? (
                                                    <div className="flex flex-col rounded-[10px] border border-edge-mid bg-surface p-1">
                                                        <MotionConfig reducedMotion="user">
                                                            <AnimatePresence initial={false}>
                                                                {trackerLines.map((l) => (
                                                                    <motion.div
                                                                        key={l.id}
                                                                        // position, not full layout: the opened row detail owns
                                                                        // its own height animation, and a size-animating parent
                                                                        // would re-project that growth as a scale
                                                                        layout="position"
                                                                        variants={cardVariants}
                                                                        initial={
                                                                            entering.has(keyOf(l)) ? "initial" : false
                                                                        }
                                                                        animate="animate"
                                                                        exit="exit"
                                                                        transition={{
                                                                            duration: MOTION.durMacro,
                                                                            ease: MOTION.easeFluid,
                                                                        }}
                                                                        // the opened row expands where it is; lifted so a plan menu
                                                                        // hanging past it paints over the rows after it
                                                                        className={cn(
                                                                            "min-w-0",
                                                                            l.id === openInitiative && "relative z-10"
                                                                        )}
                                                                    >
                                                                        <InitiativeRow
                                                                            line={l}
                                                                            focused={cursor === l.id}
                                                                            fresh={freshInitiatives.has(keyOf(l))}
                                                                            expanded={l.id === openInitiative}
                                                                            resume={resumeOf(l)}
                                                                            onWork={() => {
                                                                                const c = cardOf(l);
                                                                                if (c != null) {
                                                                                    void workOnInitiative(model, c);
                                                                                }
                                                                            }}
                                                                            onContextMenu={(ev) =>
                                                                                showInitiativeMenu(
                                                                                    l,
                                                                                    ev,
                                                                                    (oref) => openLine({ oref }),
                                                                                    manageOf(l)
                                                                                )
                                                                            }
                                                                            onOpen={() => {
                                                                                setCursor(l.id);
                                                                                toggleInitiative(l.id);
                                                                            }}
                                                                            titleSlot={titleSlotOf(l)}
                                                                        >
                                                                            {detailOf(l)}
                                                                        </InitiativeRow>
                                                                    </motion.div>
                                                                ))}
                                                            </AnimatePresence>
                                                        </MotionConfig>
                                                        {/* what the cap hid, and the archived ones, close the box */}
                                                        <div className="flex flex-wrap items-center gap-2 px-1.5 pb-1 pt-0.5 empty:hidden">
                                                            <MoreControl
                                                                n={effortWindow.more}
                                                                expanded={initiativesOpen}
                                                                onToggle={() => toggleRegion("initiatives")}
                                                            />
                                                            {archivedCards.length > 0 ? (
                                                                <button
                                                                    type="button"
                                                                    data-jarvis-brief-archived={
                                                                        showArchived ? "hide" : "show"
                                                                    }
                                                                    onClick={() => setShowArchived(!showArchived)}
                                                                    className={LINK_BTN}
                                                                >
                                                                    {showArchived
                                                                        ? "Hide archived"
                                                                        : `Show ${archivedCards.length} archived`}
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </Region>
                                    ) : null}
                                </div>
                                {/* the side column: the past (what happened, what shipped) and what is not
                                    planned yet. Drawn only when no one region is being read alone. */}
                                {view.sideShown ? (
                                    <aside
                                        data-jarvis-brief-side
                                        className={cn(
                                            "flex min-w-0 flex-col gap-[22px]",
                                            // the chunk panel takes its place on a wide Brief
                                            chunkPanel && "@min-[1281px]:hidden"
                                        )}
                                    >
                                        {view.shows("behind") ? (
                                            <section
                                                data-jarvis-brief-region="behind"
                                                className="flex flex-col gap-[9px]"
                                            >
                                                <div className="flex items-center gap-[9px]">
                                                    <span className={cn(REGION_LABEL, "text-ink-mid")}>
                                                        {REGIONS.behind.label}
                                                    </span>
                                                    <span className="h-px min-w-3 flex-1 bg-edge-faint" />
                                                    <span className={FAINT_TEXT}>
                                                        {sinceLabel(
                                                            cursorTs,
                                                            snapshot?.queryStartedAt ?? Date.now(),
                                                            visitCursor == null
                                                        )}
                                                    </span>
                                                    {deltaRowsN > 0 ? (
                                                        <button
                                                            type="button"
                                                            data-jarvis-brief-mark-seen
                                                            onClick={() => {
                                                                const undo = markBriefingSeen();
                                                                briefUndo.notify("Marked seen", undo);
                                                            }}
                                                            className="cursor-pointer text-[10.5px] text-accent-soft hover:underline"
                                                        >
                                                            Mark seen
                                                        </button>
                                                    ) : null}
                                                </div>
                                                <div className="flex flex-col">
                                                    {deltaRowsN === 0 ? (
                                                        // a first visit has no last look to be "since", so it says what will show up
                                                        <p
                                                            data-jarvis-brief-empty="behind"
                                                            className="m-0 text-[11.5px] text-muted"
                                                        >
                                                            {sinceEmptyLine(visitCursor == null)}
                                                        </p>
                                                    ) : null}
                                                    {lines.behind
                                                        .filter((g) => g.label !== SHIPPED_LABEL)
                                                        .map((g) => (
                                                            <div key={g.label} className="flex flex-col">
                                                                <div className="px-[11px] pb-0.5 pt-1.5 text-[10.5px] font-bold uppercase tracking-[.09em] text-muted">
                                                                    {g.label}
                                                                </div>
                                                                {g.lines.map((l) => (
                                                                    <DeltaRowView
                                                                        key={l.id}
                                                                        line={l}
                                                                        focused={cursor === l.id}
                                                                        onOpen={
                                                                            l.target != null
                                                                                ? (e) => openLine(l.target, e)
                                                                                : undefined
                                                                        }
                                                                    />
                                                                ))}
                                                            </div>
                                                        ))}
                                                    <MoreControl
                                                        n={deltaWindow.more}
                                                        expanded={behindOpen}
                                                        onToggle={() => toggleRegion("behind")}
                                                    />
                                                </div>
                                            </section>
                                        ) : null}
                                        {/* its own section, because the two have different time bases: events since your
                                    last visit, and the last seven days' landed runs. Always drawn, so an empty
                                    week says so. */}
                                        <section data-jarvis-brief-region="shipped" className="flex flex-col gap-[9px]">
                                            <div className="flex items-center gap-[9px]">
                                                <span className={cn(REGION_LABEL, "text-ink-mid")}>
                                                    {SHIPPED_LABEL}
                                                </span>
                                                <span className="flex-none text-[10.5px] font-medium tabular-nums text-ink-mid">
                                                    {shippedAll.length}
                                                </span>
                                                <span className="h-px min-w-3 flex-1 bg-edge-faint" />
                                                <span className={FAINT_TEXT}>7 days</span>
                                            </div>
                                            <div className="flex flex-col">
                                                {shippedAll.length === 0 ? (
                                                    <p
                                                        data-jarvis-brief-empty="shipped"
                                                        className="m-0 text-[11.5px] text-muted"
                                                    >
                                                        {SHIPPED_EMPTY}
                                                    </p>
                                                ) : null}
                                                {shippedLines.map((l) => (
                                                    <ShippedRowView
                                                        key={l.id}
                                                        line={l}
                                                        focused={cursor === l.id}
                                                        selected={
                                                            sheetOpen &&
                                                            stageRun != null &&
                                                            l.target != null &&
                                                            "oref" in l.target &&
                                                            l.target.oref === "run:" + stageRun.id
                                                        }
                                                        onOpen={
                                                            l.target != null ? (e) => openLine(l.target, e) : undefined
                                                        }
                                                    />
                                                ))}
                                                {shippedAll.length > SHIPPED_CAP && !filtering ? (
                                                    <button
                                                        type="button"
                                                        data-jarvis-brief-shipped-more
                                                        onClick={() => setShippedOpen(!shippedOpen)}
                                                        className="cursor-pointer self-start px-[11px] py-[7px] text-[10.5px] text-accent-soft hover:underline"
                                                    >
                                                        {shippedOpen
                                                            ? "show less"
                                                            : `+${shippedAll.length - SHIPPED_CAP} more`}
                                                    </button>
                                                ) : null}
                                            </div>
                                        </section>
                                        {ideaLines.length > 0 || !filtering ? (
                                            <section data-jarvis-ideas className="flex min-w-0 flex-col gap-[9px]">
                                                <div data-jarvis-ideas-label className="flex items-center gap-[9px]">
                                                    <span className={cn(REGION_LABEL, "text-ink-mid")}>Ideas</span>
                                                    <span className="flex-none text-[10.5px] font-medium tabular-nums text-ink-mid">
                                                        {ideaLines.length}
                                                    </span>
                                                    <span className="h-px min-w-3 flex-1 bg-edge-faint" />
                                                    <span className={FAINT_TEXT}>not planned yet</span>
                                                </div>
                                                <div
                                                    className={cn(
                                                        "flex flex-col",
                                                        ideaLines.length > 0 &&
                                                            "rounded-[10px] border border-border bg-surface p-1"
                                                    )}
                                                >
                                                    {ideaLines.map((l) => (
                                                        <IdeaRow
                                                            key={l.id}
                                                            line={l}
                                                            focused={cursor === l.id}
                                                            fresh={freshInitiatives.has(keyOf(l))}
                                                            expanded={l.id === openInitiative}
                                                            onContextMenu={(ev) =>
                                                                showInitiativeMenu(
                                                                    l,
                                                                    ev,
                                                                    (oref) => openLine({ oref }),
                                                                    manageOf(l)
                                                                )
                                                            }
                                                            onOpen={() => {
                                                                setCursor(l.id);
                                                                toggleInitiative(l.id);
                                                            }}
                                                            titleSlot={titleSlotOf(l)}
                                                        >
                                                            {ideaDetailOf(l)}
                                                        </IdeaRow>
                                                    ))}
                                                    <label
                                                        data-jarvis-jot-idea
                                                        className={cn(
                                                            "flex h-8 items-center gap-2 rounded-[8px] border border-dashed border-edge-strong px-2.5 focus-within:border-accent/60",
                                                            ideaLines.length > 0 && "mt-1"
                                                        )}
                                                    >
                                                        <Plus size={12} aria-hidden className="flex-none text-muted" />
                                                        <input
                                                            aria-label="Jot down an idea"
                                                            placeholder="Jot down an idea — Enter saves"
                                                            value={jot}
                                                            onChange={(e) => setJot(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (
                                                                    e.key === "Enter" &&
                                                                    !e.nativeEvent.isComposing &&
                                                                    jot.trim() !== ""
                                                                ) {
                                                                    const t = jot.trim();
                                                                    setJot("");
                                                                    runMutation(() => createIdea(t));
                                                                    briefUndo.notify(`Jotted “${t}”`);
                                                                } else if (e.key === "Escape") {
                                                                    e.stopPropagation();
                                                                    setJot("");
                                                                    e.currentTarget.blur();
                                                                }
                                                            }}
                                                            className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-hi outline-none placeholder:text-muted"
                                                        />
                                                    </label>
                                                </div>
                                                <MoreControl
                                                    n={ideaWindow.more}
                                                    expanded={ideasOpen}
                                                    onToggle={() => toggleRegion("ideas")}
                                                />
                                            </section>
                                        ) : null}
                                    </aside>
                                ) : null}
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </div>
                <AnimatePresence initial={false}>
                    {selectedChunk != null && openInitiative != null ? (
                        <ChunkSidebar
                            key="chunk-sidebar"
                            model={model}
                            initiative={openEffort?.title ?? ""}
                            label={selectedChunk.row.label}
                            stage={selectedChunk.row.stage}
                            flat={isFlatPlan(planChunks)}
                            status={selectedChunk.row.status}
                            position={{
                                n: planChunks.findIndex((c) => c.label === selectedChunk.row.label) + 1,
                                total: planChunks.length,
                            }}
                            feed={tracker.feed}
                            expanded={readingNote}
                            now={Date.now()}
                            handle={`wsh effort note ${selectedChunk.oref.replace(/^effort:/, "")} "${selectedChunk.row.label}"`}
                            error={mutateError}
                            work={chunkWork}
                            onPrev={stepTo("prev")}
                            onNext={stepTo("next")}
                            onToggle={(key) =>
                                setReadingNote((cur) => {
                                    const next = new Set(cur);
                                    if (!next.delete(key)) {
                                        next.add(key);
                                    }
                                    return next;
                                })
                            }
                            onClose={closeNotes}
                            onActivity={(e) => openLine({ oref: selectedChunk.oref }, e)}
                            onAddNote={(text) =>
                                runMutation(() => appendChunkNote(selectedChunk.oref, selectedChunk.row.label, text))
                            }
                            onSetStatus={(status) => edits?.onSetStatus(selectedChunk.row.label, status)}
                            onEditNote={(entry, text) =>
                                entry.noteAt != null &&
                                runMutation(() =>
                                    editNote(
                                        selectedChunk.oref,
                                        chunkRef(planChunks, entry.chunk),
                                        entry.noteAt!,
                                        entry.ts,
                                        text
                                    )
                                )
                            }
                            onDeleteNote={(entry) => {
                                if (entry.noteAt == null) {
                                    return;
                                }
                                const at = entry.noteAt;
                                setReadingNote(new Set());
                                briefUndo.schedule(
                                    [noteKey(selectedChunk.oref, entry.chunk, entry.ts)],
                                    "Note deleted",
                                    () =>
                                        removeNote(selectedChunk.oref, chunkRef(planChunks, entry.chunk), at, entry.ts)
                                );
                            }}
                            onOpenSession={(c, e) =>
                                fireAndForget(() =>
                                    c.sessionTab !== ""
                                        ? openOrPeek(model, { kind: "agent", tabId: c.sessionTab }, e)
                                        : openOrPeekAddress(model, "run:" + c.runOid, e)
                                )
                            }
                        />
                    ) : null}
                </AnimatePresence>
                <BriefToastView />
            </div>
            {/* the Brief's destination for a record address: openref.ts's record landing sets the atom this reads.
                Mounted here rather than beside the surface switch because it is the Brief's own overlay —
                the three-pane composition opens a record on the Stage instead. */}
            <BriefPeek model={model} />
            {/* B4's detail sheet, now drawing the surface's active subject: a channel's run body (or its
                launcher), or an initiative's chunk detail. */}
            <BriefSheet model={model} />
            {/* keyed by project so an open on a named project starts there, not on the last one picked */}
            <BriefProfileModal
                key={profileTarget ?? ""}
                open={profileTarget != null}
                initialChannelId={profileTarget ?? ""}
                onClose={() => setProfileTarget(null)}
            />
            {detailsOpen && openEffort != null && openEffortORef != null ? (
                <EffortCreateForm
                    onClose={() => setDetailsOpen(false)}
                    edit={{
                        oref: openEffortORef,
                        details: {
                            title: openEffort.title,
                            project: openEffort.project ?? "",
                            ticket: openEffort.ticket ?? "",
                            parent: openEffort.parentoid ?? "",
                        },
                    }}
                />
            ) : null}
            {/* the plan-gate modal, mounted here because the Stage was the surface that hosted it */}
            <DagModal />
            <TourOffer />
            <JarvisTour model={model} />
        </div>
    );
}
