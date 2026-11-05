// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief: the queue-first Jarvis surface (spec 2026-11-05-jarvis-revamp-design.md, board Main.dc.html). A main
// column — the Waiting strip, then Initiatives: the pinned cards and every other initiative as one compact list — beside
// a side column of Activity (runs and councils), Since you looked, Shipped and Ideas, over the briefing snapshot, under
// a header whose fleet line comes off the live agent roster. An initiative opens in the sheet (initiativesheet.tsx),
// never in place; a council in the sheet too (councilsheet.tsx).
//
// Two rules shape every region. Absence is a written sentence, never a heading over an empty frame: a region renders
// rows or it says what is not there. And every count printed is the number of rows rendered beneath it, with whatever
// a window hid stated separately as "+N more" — so no line here can claim more work than the surface is showing.
//
// The record peek is here (BriefPeek, opened by a record oref) and the palette extends the app's own. Every row opens
// its sheet in a click, because the sheet is where the actions live; a region's overflow opens in place. The
// steer-only composer lives in the run sheet's footer (briefcomposer.tsx).
//
// One presentation rule runs through the whole file and decides every border below: a bordered chip is
// the control recipe, a borderless one is a label. Dressing something inert as a control and camouflaging
// a real control among labels are the same lie, so neither happens here.

import { pushToast } from "@/app/cockpit/notificationstore";
import { MOTION, paneReveal } from "@/app/element/motiontokens";
import { contextMenuAtom, ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { buildJarvisBindings } from "@/app/store/keybindings/bindings";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import { useKeybindings } from "@/app/store/keybindings/store";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { channelsAtom, createChannel, loadChannels, runAtom } from "@/app/view/agents/channelsstore";
import { useCouncils } from "@/app/view/agents/councilstore";
import { openLauncher } from "@/app/view/agents/launcherstore";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { RollingCount } from "@/app/view/agents/rollingcount";
import { pendingRunDraftAtom } from "@/app/view/agents/runactions";
import { leadAsker } from "@/app/view/agents/runmodel";
import { queuedRowsAtom, useRunQueueFeed } from "@/app/view/agents/runqueuestore";
import { DagModal } from "@/app/view/orchestrate/dagmodal";
import { setDagModalAgentsContext } from "@/app/view/orchestrate/dagmodalstate";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue, useSetAtom, type Atom, type PrimitiveAtom } from "jotai";
import {
    Archive,
    ArchiveRestore,
    ArrowUpRight,
    ChevronDown,
    Copy,
    Link2,
    Maximize2,
    Minimize2,
    Pause,
    Pencil,
    Pin,
    PinOff,
    Play,
    Plus,
    Search,
    SlidersHorizontal,
    Trash2,
    Unlink,
    X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityRegion } from "./activityregion";
import { runAttentionAct } from "./attentionrun";
import { AutonomyLadder } from "./autonomyladderview";
import {
    activityCouncils,
    activityRunKind,
    buildActivity,
    keepsShipped,
    queuedCount,
    type ActivityFilter,
    type ActivityRunInput,
} from "./briefactivity";
import {
    cardFace,
    countLive,
    countPinned,
    listAfterCards,
    listRowFace,
    listWindow,
    pinnedCards,
    pinnedHeading,
    showPinSlot,
    type FaceInput,
    type ListItem,
} from "./briefcards";
import { briefFleet } from "./brieffleet";
import { BRIEFING_FIXTURES } from "./briefingfixtures";
import {
    ackableRuns,
    buildAttentionQueue,
    capRegion,
    DELTA_CAP,
    groupDelta,
    IDEA_CAP,
    projectBriefing,
    queueAction,
    SEVEN_DAYS_MS,
    SHIPPED_CAP,
    waitingStrip,
    type QueueRow,
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
import { briefNavIds, cardAt, listRowAt, navInitiative, resolveBriefCursor } from "./briefnav";
import { isArchivedStatus } from "./briefpalette";
import { BriefPeek } from "./briefpeekview";
import { BriefProfileModal } from "./briefprofileview";
import { openQueueSheet } from "./briefqueuestore";
import { briefRestorePlan } from "./briefrestore";
import {
    behindGroups,
    filterAsMenu,
    filterLines,
    initiativeLine,
    initiativeProjects,
    keepsProject,
    keepsRunKind,
    lineOpenTarget,
    nestInitiatives,
    projectCounts,
    projectName,
    queueLine,
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
} from "./briefrows";
import {
    DeltaRowView,
    IdeaRow,
    InitiativeRow,
    ReviewBody,
    ReviewDone,
    ReviewTools,
    ShippedRowView,
    type ReviewActionBtn,
} from "./briefrowviews";
import { BriefSheet } from "./briefsheet";
import { FAINT_TEXT, LINK_BTN, REGION_LABEL, SMALL_BTN } from "./briefstyle";
import { BriefToastView } from "./brieftoast";
import { briefUndo, effortKey, pendingDeleteKeysAtom } from "./briefundo";
import { councilSheetAtom, openCouncilSheet } from "./councilsheetstore";
import { EffortCreateForm } from "./effortcreateform";
import { buildEffortCard, type EffortCardModel } from "./effortmodel";
import {
    archivedEffortsAtom,
    createIdea,
    deleteEffort,
    effortDetailAtom,
    linkEffort,
    loadArchivedEfforts,
    loadEffortDetail,
    setEffortStatus,
    togglePin,
    unarchiveEffort,
} from "./effortstore";
import { freshKeys } from "./freshrows";
import { InitiativeCards } from "./initiativecards";
import { useInitiativeEdits } from "./initiativeedits";
import { InitiativeList } from "./initiativelist";
import { InitiativePicker } from "./initiativepicker";
import { descendantOrefs } from "./initiativepickermodel";
import { InitiativeChunkList, InitiativeSheetHead } from "./initiativesheet";
import { initiativeSheetOpenAtom, openInitiativeChunk } from "./initiativesheetstore";
import { initiativeResume, openAgentFor, orderInitiatives, shortDate } from "./initiativework";
import { workOnDueChunk, workOnInitiative } from "./initiativeworkaction";
import {
    briefCursorInitiativeAtom,
    briefEffortIndexAtom,
    briefInitiativeListAtom,
    briefPeekRecordAtom,
    briefProfileAtom,
    briefRevealChunkAtom,
    briefRunListAtom,
    briefSheetOpenAtom,
    initiativeSheetRequestAtom,
} from "./jarvisstore";
import { activeSubjectAtom, persistedSubjectAtom, setComposingRun, stageRunAtom } from "./jarvissubjectstore";
import { JarvisTour, TourButton, TourOffer } from "./jarvistourview";
import { NewInitiativeControl } from "./newinitiativecontrol";
import { radarDraftLanding } from "./newrun";
import { openChannelSheet, openOrPeek, openOrPeekAddress } from "./openref";
import { planReviewORef } from "./planreviewtarget";
import {
    eventAge,
    eventLine,
    eventParts,
    eventsSince,
    eventTone,
    idleLabel,
    isChanged,
    isIdle,
    quietLine,
    reviewCards,
    reviewDone,
    reviewedInSession,
    reviewQueue,
    sinceHeading,
} from "./reviewmodel";
import {
    advanceReview,
    enterReview,
    exitReview,
    markReviewed,
    markReviewedAndAdvance,
    moveReview,
    reviewedAtom,
    reviewModeAtom,
    reviewQueueAtom,
    setReviewCursor,
} from "./reviewstore";
import { loadTaskList, taskListAtom } from "./tasksstore";
import { WaitingStrip } from "./waitingstrip";

// what an empty Initiatives region says, and what an empty list under the cards says
const NO_INITIATIVES =
    "No initiative yet. Work bigger than one run lives here as a list of chunks that agents tick off.";
const ALL_CARDS = "Every initiative is on a card above.";

// The regions that can be read alone: the page's two big ones. Reading one region alone is its own small icon
// button at the end of its heading: a full-width heading that hid every other region on a misclick was the trap
// (spec 2026-10-12 decision 11).
type OnlyId = "initiatives" | "activity";

function OnlyButton({ label, only, onOnly }: { label: string; only: boolean; onOnly: () => void }) {
    return (
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
    );
}

// The starting control an empty region carries: the secondary button recipe, as the header's New initiative wears it,
// so the page's one accent button stays the header's New run.
const EMPTY_ACT =
    "flex h-[26px] flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-edge-mid bg-surface-raised px-2.5 text-[11.5px] font-semibold text-ink-hi hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// A region's filter: which project the initiatives list shows. The first option is always all.
type FilterSpec<T> = {
    label: string;
    // what the menu's face calls the choice: "project"
    noun: string;
    // the data attribute a CDP scenario finds the filter by
    tag: string;
    options: { value: T; label: string; count?: number }[];
    value: T;
    onChange: (v: T) => void;
};

// A few choices sit as a line of chips, where they never squeeze the heading; past FILTER_LINE_MAX they become one
// menu, which a long project list cannot wrap.
function filterNode<T>(spec: FilterSpec<T>): ReactNode {
    return filterAsMenu(spec.options.length) ? <FilterMenu {...spec} /> : <FilterLine {...spec} />;
}

function FilterLine<T>({ label, tag, options, value, onChange }: FilterSpec<T>) {
    return (
        <div role="group" aria-label={label} {...{ [tag]: "" }} className="flex flex-wrap items-center gap-1">
            {options.map((o) => (
                <button
                    key={o.label}
                    type="button"
                    aria-pressed={value === o.value}
                    data-filter-option={o.label}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        "flex cursor-pointer items-baseline gap-1.5 rounded-[5px] border px-1.5 py-px text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        value === o.value
                            ? "border-edge-strong text-ink-hi"
                            : "border-transparent text-muted hover:text-ink-hi"
                    )}
                >
                    {o.label}
                    {o.count != null ? (
                        <span className={cn("tabular-nums", value === o.value ? "text-ink-mid" : "text-muted")}>
                            {o.count}
                        </span>
                    ) : null}
                </button>
            ))}
        </div>
    );
}

function FilterMenu<T>({ label, noun, tag, options, value, onChange }: FilterSpec<T>) {
    // the one context menu may be a row's, so open means it holds this filter's items
    const shown = useRef<ContextMenuItem[] | null>(null);
    const open = useAtomValue(contextMenuAtom)?.items === shown.current && shown.current != null;
    const picked = options.find((o) => o.value === value) ?? options[0];
    // opened at the face rather than the pointer, so Enter on the face drops it in the same place
    const show = (e: React.MouseEvent<HTMLButtonElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        shown.current = [
            { type: "header", label },
            ...options.map(
                (o): ContextMenuItem => ({
                    type: "radio",
                    label: o.label,
                    checked: o.value === value,
                    sublabel: o.count != null ? String(o.count) : undefined,
                    click: () => onChange(o.value),
                })
            ),
        ];
        globalStore.set(contextMenuAtom, { x: r.left, y: r.bottom, items: shown.current });
    };
    return (
        <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={label}
            {...{ [tag]: "" }}
            onClick={show}
            className="flex flex-none cursor-pointer items-center gap-1.5 rounded-[5px] border border-edge-strong px-[7px] py-px text-[10.5px] text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <span className="text-muted">{noun}</span>
            {picked.label}
            <ChevronDown size={10} aria-hidden className="text-muted" />
        </button>
    );
}

// What a side-column region's window hid, and the way past it: the overflow opens in place. Bordered because it is a
// control.
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

// the key the fresh set is built with: a line's id minus its region prefix
const keyOf = (line: BriefLine) => line.id.slice(line.id.indexOf(":") + 1);

// a filter that matched nothing in a region leaves a sentence, not a heading over an empty frame
function NoMatch() {
    return <span className="px-[11px] py-1 text-[10.5px] text-ink-faint">Nothing here matches the filter.</span>;
}

// An initiative's name and its id are the two things you carry out of the Brief — into a prompt, a `wsh effort` call,
// a message to someone. A card and a row are buttons, so neither could be dragged out of them: the menu copies both.
// A click opens the sheet, so the activity feed is opened from here too. The initiative's own edits sit here as well
// (the ⋯ opens the same menu), so pinning, renaming, archiving or deleting it does not mean opening the sheet first.
type InitiativeManage = {
    status: string;
    pinned: boolean;
    pin: () => void;
    rename: () => void;
    details: () => void;
    togglePause: () => void;
    archive: () => void;
    unarchive: () => void;
    remove: () => void;
    // Link to…: the picker opens under `anchor` (the card's ⋯ button, or the card or row)
    link: (anchor: HTMLElement) => void;
    // present on a sub-initiative: Unlink from its parent, named by the title
    unlink?: { parentTitle: string; run: () => void };
};

// The activity link opens the initiative's Activity feed in the sheet.
function openActivity(model: AgentsViewModel, oref: string, e?: React.MouseEvent): void {
    fireAndForget(() =>
        openOrPeek(model, { kind: "effort", effortId: oref.replace(/^effort:/, ""), view: "activity" }, e)
    );
}

function showInitiativeMenu(
    line: BriefLine,
    ev: React.MouseEvent,
    openActivity: (oref: string) => void,
    manage?: InitiativeManage
): void {
    const target = line.target;
    const oid = target != null && "oref" in target ? target.oref.replace(/^effort:/, "") : "";
    // read now: a React event's currentTarget is gone once the handler returns
    const anchor = ev.currentTarget as HTMLElement;
    const items: ContextMenuItem[] = [];
    if (manage != null) {
        const archived = isArchivedStatus(manage.status);
        if (!archived) {
            items.push(
                manage.pinned
                    ? { label: "Unpin", icon: <PinOff size={15} />, click: manage.pin }
                    : { label: "Pin to the top", icon: <Pin size={15} />, click: manage.pin },
                { type: "separator" }
            );
        }
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
        if (!archived) {
            // a parent for this initiative, or none; an archived one is finished and stays where it was
            items.push({ label: "Link to…", icon: <Link2 size={15} />, click: () => manage.link(anchor) });
            if (manage.unlink != null) {
                items.push({
                    label: `Unlink from ${manage.unlink.parentTitle}`,
                    icon: <Unlink size={15} />,
                    click: manage.unlink.run,
                });
            }
            items.push({ type: "separator" });
        }
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

// Which regions the user has opened past their window: the Waiting strip's Show all, the initiatives list's
// "+N more", Since you looked's and Ideas'. Module scope for the cursor's reason: the Brief unmounts on every surface
// switch, and a region that silently re-collapsed while you were reading a record would be worse than one that never
// opened.
type FoldId = "waiting" | "initiatives" | "behind" | "ideas";
const briefExpandedAtom = atom<Partial<Record<FoldId, boolean>>>({});

// Activity's own folds (Earlier past five lines, the runs quiet for a week) and Shipped's rows past the cap; module
// scope for the same reason
const briefStaleOpenAtom = atom(false);
const briefEarlierOpenAtom = atom(false);
const briefShippedOpenAtom = atom(false);
// which kind of work Activity and Shipped show; module scope for the same reason
const briefActivityFilterAtom = atom<ActivityFilter>("all") as PrimitiveAtom<ActivityFilter>;
// which project the initiatives list shows, null for every one; module scope for the same reason
const briefInitiativeProjectAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// a stable empty list, so a region with no rows does not churn the memos that read it
const NO_LINES: BriefLine[] = [];
const NO_RUNS = atom<(Run | undefined)[]>([]);

// The review pass's open initiative: the sheet's head and plan, drawn in place over the pass rather than in the sheet
// (spec decision 10). Its own component, because the plan's edits are a hook.
function ReviewOpenInitiative({
    model,
    card,
    since,
}: {
    model: AgentsViewModel;
    card: EffortCardModel;
    // what changed since the mark, and what to do about it (ReviewBody)
    since: ReactNode;
}) {
    const oref = card.oref;
    // the head's Activity and the plan's Delete act on this pass, not on a sheet that is not open
    const opts = useMemo(
        () => ({
            onActivity: (e: React.MouseEvent) => openActivity(model, oref, e),
            onDeleted: () => advanceReview(oref),
        }),
        [model, oref]
    );
    const state = useInitiativeEdits(oref, opts);
    const [cursor, setCursor] = useState<string | null>(null);
    return (
        <div
            data-jarvis-review-current={oref}
            className="relative flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-edge-mid bg-surface-raised"
        >
            <InitiativeSheetHead
                model={model}
                oref={oref}
                state={state}
                card={card}
                stepping={false}
                onActivity={(e) => openActivity(model, oref, e)}
            />
            {since}
            <div data-jarvis-review-plan className="flex flex-col border-t border-edge-faint px-3 pb-2 pt-2.5">
                {state.effort == null ? (
                    <p data-jarvis-review-plan-loading className="px-2 py-1 text-[12px] text-muted">
                        Loading…
                    </p>
                ) : (
                    <InitiativeChunkList
                        model={model}
                        oref={oref}
                        state={state}
                        card={card}
                        cursor={cursor}
                        onCursor={setCursor}
                        onOpenChunk={(label) => openInitiativeChunk(oref, label)}
                    />
                )}
                {state.mutateError != null ? (
                    <p className="px-2 pt-1 text-[11px] text-error">{state.mutateError}</p>
                ) : null}
            </div>
            {/* the open one, in the cursor's accent ring: painted over the box, never in the way of it */}
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[10px] ring-1 ring-inset ring-accent/45"
            />
            {state.detailsOpen && state.effort != null ? (
                <EffortCreateForm
                    onClose={() => state.setDetailsOpen(false)}
                    edit={{
                        oref,
                        details: {
                            title: state.effort.title,
                            project: state.effort.project ?? "",
                            ticket: state.effort.ticket ?? "",
                            parent: state.effort.parentoid ?? "",
                        },
                    }}
                />
            ) : null}
        </div>
    );
}

export function BriefSurface({ model }: { model: AgentsViewModel }) {
    // the briefing pipeline, unchanged from briefingview: one load per entry, a dwell-gated visit ack,
    // the memoized projection, the DEV fixture seam, and the live attention read.
    const { snapshot, loading, error } = useAtomValue(briefingStateAtom);
    const fixture = useAtomValue(briefingFixtureAtom);
    const liveAgents = useAtomValue(model.agentsAtom);
    const liveAttention = useAtomValue(attentionAtom);
    // the run queue, Activity's Queued N line. The Agent tree feeds the same atom from the same event; the Brief does
    // not depend on the tree being mounted.
    useRunQueueFeed();
    const queued = useAtomValue(queuedRowsAtom);

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
    // A plan to review opens the agent that proposed it while one is open (planreviewtarget.ts), so the queue reads
    // the roster. The roster ticks far more often than the queue changes, so the memo is keyed on where each plan
    // opens, not on the roster: a tick that moves no plan's target recomputes nothing and the j/k controller below
    // is not registered again. A due chunk's button reads Go to agent while an agent is open on its initiative, so
    // that joins the key too.
    const rosterKey = attention
        .map((a) =>
            a.kind === "plan-review"
                ? planReviewORef(a, agents)
                : a.kind === "chunk-due" && a.effortoid && openAgentFor(a.effortoid, agents) != null
                  ? "go"
                  : ""
        )
        .join("|");
    const queue = useMemo(
        () =>
            model_ != null
                ? buildAttentionQueue({
                      attention,
                      efforts: model_.efforts,
                      blockers: model_.blockers,
                      roster: agents,
                  })
                : [],
        [model_, attention, rosterKey]
    );
    // the full projection: a blocked chunk on an initiative under the list's fold is still waiting on you, so the queue
    // reads every effort
    const efforts = useMemo(() => model_?.efforts ?? [], [model_]);

    // Each region opens at its window and the region's own control opens the rest in place. The windows stay
    // display-side so the overflow count is what was actually hidden from the rows above it.
    const [expanded, setExpanded] = useAtom(briefExpandedAtom);
    const toggleRegion = useCallback(
        (id: FoldId) => setExpanded((prev) => ({ ...prev, [id]: prev[id] !== true })),
        [setExpanded]
    );
    const waitingOpen = expanded.waiting === true;
    const initiativesOpen = expanded.initiatives === true;
    const ideasOpen = expanded.ideas === true;
    const behindOpen = expanded.behind === true;

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
    const effortGroups = useMemo(() => {
        const g = splitIdeas(efforts);
        const kept = (c: EffortCardModel) => !pendingDeletes.has(effortKey(c.oref));
        return { trackers: g.trackers.filter(kept), ideas: g.ideas.filter(kept) };
    }, [efforts, pendingDeletes]);
    const archivedKept = useMemo(
        () => archivedCards.filter((c) => !pendingDeletes.has(effortKey(c.oref))),
        [archivedCards, pendingDeletes]
    );
    // the project tabs narrow the list only: the cards always show
    const [pickedProject, setPickedProject] = useAtom(briefInitiativeProjectAtom);
    const projectCards = useMemo(
        () => (showArchived ? [...effortGroups.trackers, ...archivedKept] : effortGroups.trackers),
        [effortGroups, archivedKept, showArchived]
    );
    const projectOptions = useMemo(() => initiativeProjects(projectCards), [projectCards]);
    const perProject = useMemo(() => projectCounts(projectCards), [projectCards]);
    // a pick whose last initiative went away reads as every project rather than an empty region
    const project = pickedProject != null && projectOptions.includes(pickedProject) ? pickedProject : null;
    const archivedShown = useMemo(
        () => archivedKept.filter((c) => keepsProject(project, c.project)),
        [archivedKept, project]
    );
    const ideaWindow = useMemo(() => capRegion(effortGroups.ideas, IDEA_CAP, ideasOpen), [effortGroups, ideasOpen]);
    // moment 1: which ideas are new to YOU (the Since you looked region is new by construction, so it is not marked)
    const cursorTs = snapshot?.actualCursor ?? 0;
    const freshIdeas = useMemo(
        () =>
            freshKeys(
                ideaWindow.rows.map((e) => ({ key: e.oref, ts: e.updatedts })),
                cursorTs
            ),
        [ideaWindow, cursorTs]
    );

    // --- review (reviewmodel.ts): what changed since the person last reviewed an initiative, and what sat idle. It
    // reads every tracker, not the window the region draws, and never reaches the attention queue or the badge.
    const reviewed = useAtomValue(reviewedAtom);
    const review = useAtomValue(reviewModeAtom);
    const reviewCardList = useMemo(
        () => reviewCards(effortGroups.trackers, snapshot?.state.efforts ?? [], attention, agents),
        [effortGroups, snapshot, attention, agents]
    );
    const reviewItems = useMemo(
        () => reviewQueue(reviewCardList, reviewed, cursorTs, Date.now()),
        [reviewCardList, reviewed, cursorTs]
    );
    // the marks: "idle 3w" in an idle one's status cell, a dot on a changed one's review row
    const reviewMarks = useMemo(() => {
        const now = Date.now();
        const changed = new Set<string>();
        const idle = new Map<string, string>();
        for (const c of reviewCardList) {
            if (isChanged(c, reviewed[c.oref], cursorTs)) {
                changed.add(c.oref);
            }
            if (isIdle(c, reviewed[c.oref], now)) {
                idle.set(c.oref, idleLabel(c.updatedts, now));
            }
        }
        return { changed, idle };
    }, [reviewCardList, reviewed, cursorTs]);
    // `v` and Review · N begin a pass over this list; the bindings read it from the store
    const reviewOrefs = useMemo(() => reviewItems.map((q) => q.oref), [reviewItems]);
    const reviewOrefsKey = reviewOrefs.join(",");
    useEffect(() => {
        globalStore.set(reviewQueueAtom, reviewOrefs);
    }, [reviewOrefsKey]);
    // The pass: the initiatives it began with that still exist, the one it is on (a vanished cursor falls to the
    // first one not yet marked), and how far along it is.
    const pass = useMemo(() => {
        if (review == null) {
            return null;
        }
        const cards = new Map(reviewCardList.map((c) => [c.oref, c]));
        const orefs = review.orefs.filter((o) => cards.has(o));
        const done = reviewDone(orefs, reviewed, review.startedAt);
        const current = done
            ? null
            : orefs.includes(review.cursor)
              ? review.cursor
              : (orefs.find((o) => !reviewedInSession(reviewed, o, review.startedAt)) ?? null);
        return {
            cards,
            orefs,
            done,
            current,
            at: done ? orefs.length : orefs.indexOf(current ?? "") + 1,
        };
    }, [review, reviewCardList, reviewed]);
    const reviewCurrentORef = pass?.current ?? null;
    const reviewCurrentTs = reviewCurrentORef != null ? pass?.cards.get(reviewCurrentORef)?.updatedts : undefined;
    useEffect(() => {
        if (review != null && reviewCurrentORef != null && reviewCurrentORef !== review.cursor) {
            setReviewCursor(reviewCurrentORef);
        }
    }, [review?.cursor, reviewCurrentORef]);
    // the open initiative's plan and events come off its detail, loaded as the pass lands on it
    useEffect(() => {
        if (reviewCurrentORef != null) {
            fireAndForget(() => loadEffortDetail(reviewCurrentORef, reviewCurrentTs));
        }
    }, [reviewCurrentORef, reviewCurrentTs]);

    const deltaWindow = useMemo(() => capRegion(model_?.delta ?? [], DELTA_CAP, behindOpen), [model_, behindOpen]);
    const deltaGroups = useMemo(() => groupDelta(deltaWindow.rows, Date.now()), [deltaWindow]);

    // The filter and the one-region view narrow what is drawn, and the nav ids are the drawn rows' own, so j/k can
    // never land on a row the filter hid.
    const [query, setQuery] = useState("");
    const [only, setOnly] = useState<OnlyId | null>(null);
    const toggleOnly = (id: OnlyId) => setOnly((cur) => (cur === id ? null : id));
    const filtering = query.trim() !== "";
    const matches = useCallback(
        (c: EffortCardModel) => !filtering || filterLines([initiativeLine(c)], query).length > 0,
        [filtering, query]
    );
    const [activityFilter, setActivityFilter] = useAtom(briefActivityFilterAtom);
    const [staleOpen, setStaleOpen] = useAtom(briefStaleOpenAtom);
    const [earlierOpen, setEarlierOpen] = useAtom(briefEarlierOpenAtom);
    const [shippedOpen, setShippedOpen] = useAtom(briefShippedOpenAtom);
    const shippedAll = useMemo(
        () => (model_?.shipped ?? []).filter((s) => keepsShipped(activityFilter, s.mode)),
        [model_, activityFilter]
    );
    const shipped = useMemo(
        () => capRegion(shippedAll, SHIPPED_CAP, shippedOpen || filtering),
        [shippedAll, shippedOpen, filtering]
    );
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

    // --- Initiatives: the cards (the pins, else the first six in order) and the list of the rest (briefcards.ts) -----
    const liveCards = useMemo(() => new Map(efforts.map((e) => [e.oref, e])), [efforts]);
    const ordered = useMemo(() => orderInitiatives(effortGroups.trackers, agents), [effortGroups, agents]);
    const cardSet = useMemo(
        () => pinnedCards([...effortGroups.trackers, ...archivedKept], ordered),
        [effortGroups, archivedKept, ordered]
    );
    const allTrackers = useMemo(() => [...effortGroups.trackers, ...archivedKept], [effortGroups, archivedKept]);
    const pinnedN = countPinned(allTrackers);
    const heading = pinnedHeading(pinnedN, countLive(allTrackers));
    const cards = useMemo(() => cardSet.filter(matches), [cardSet, matches]);
    const listAll = useMemo(() => {
        const projectTrackers = effortGroups.trackers.filter((e) => keepsProject(project, e.project));
        const items = listAfterCards(nestInitiatives(orderInitiatives(projectTrackers, agents)), cardSet);
        return items.filter(matches);
    }, [effortGroups, project, agents, cardSet, matches]);
    const list = useMemo(
        () => listWindow(listAll, initiativesOpen || filtering),
        [listAll, initiativesOpen, filtering]
    );
    // the archived ones close the list, on request
    const archivedItems = useMemo<ListItem[]>(
        () => (showArchived ? archivedShown.filter(matches).map((c) => ({ ...c, depth: 0, subCount: 0 })) : []),
        [showArchived, archivedShown, matches]
    );
    const listItems = useMemo(() => [...list.rows, ...archivedItems], [list, archivedItems]);
    const ideaLines = useMemo(() => filterLines(ideaWindow.rows.map(initiativeLine), query), [ideaWindow, query]);

    // --- Activity: Runs and Councils merged (briefactivity.ts) -----------------------------------------------------
    const councilList = useCouncils("");
    const councilProjects = useAtomValue(projectsAtom);
    // every run and direct agent at work, with the time its row carries (what orders Activity and cuts its week)
    const runRows = useMemo(() => {
        if (model_ == null) {
            return [];
        }
        const now = Date.now();
        const legs = { activeRuns: model_.activeRuns, directAgents: model_.directAgents };
        const rows = sessionWindow(legs, true, now).rows.map((r) => ({ line: sessionLine(r, now), ts: r.ts }));
        const kept = new Set(
            filterLines(
                rows.map((r) => r.line),
                query
            )
        );
        return rows.filter((r) => kept.has(r.line));
    }, [model_, query]);
    const runLines = useMemo(() => runRows.map((r) => r.line), [runRows]);
    // a run's face reads its live Run, and each Run is its own atom: one derived atom reads them all
    const runOidsKey = runLines.flatMap((l) => (l.runOid != null ? [l.runOid] : [])).join(",");
    const liveRunsAtom = useMemo<Atom<(Run | undefined)[]>>(() => {
        const oids = runOidsKey === "" ? [] : runOidsKey.split(",");
        return oids.length === 0 ? NO_RUNS : atom((get) => oids.map((id) => get(runAtom(id))));
    }, [runOidsKey]);
    const liveRuns = useAtomValue(liveRunsAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const effortIndex = useAtomValue(briefEffortIndexAtom);
    const activity = useMemo(() => {
        const now = Date.now();
        const byOid = new Map(liveRuns.flatMap((r) => (r != null ? [[r.id, r] as const] : [])));
        const rowOf = new Map((model_?.activeRuns ?? []).map((r) => [r.oid, r]));
        const runs: ActivityRunInput[] = runRows.map(({ line, ts }) => {
            const row = line.runOid != null ? rowOf.get(line.runOid) : undefined;
            const run = line.runOid != null ? byOid.get(line.runOid) : undefined;
            const face =
                run != null
                    ? runRowFace({
                          line,
                          run,
                          dag: lineage.runs[run.id]?.dag,
                          asking: leadAsker(run, agents) != null,
                          project: projectName(run.projectpath ?? "", councilProjects),
                          effort: run.effortref != null ? effortIndex.get(run.effortref.effortoid) : undefined,
                      })
                    : undefined;
            return {
                line,
                mode: row?.mode ?? "",
                status: row?.status ?? "",
                ts,
                ...(face != null ? { face: { stage: face.state, stageTone: face.stateTone, meta: face.meta } } : {}),
            };
        });
        const councils = activityCouncils(councilList, councilProjects, now).filter(
            (c) => filterLines([c.line], query).length > 0
        );
        return buildActivity({ runs, councils, filter: activityFilter, earlierOpen, now });
    }, [
        runRows,
        liveRuns,
        model_,
        lineage,
        agents,
        councilProjects,
        effortIndex,
        councilList,
        query,
        activityFilter,
        earlierOpen,
    ]);
    const queuedKept = useMemo(() => {
        const kind = activityRunKind(activityFilter);
        return kind == null ? [] : queued.filter((r) => keepsRunKind(kind, r.entry.data.mode ?? ""));
    }, [queued, activityFilter]);
    const queuedN = queuedCount(
        queued.map((r) => r.entry.data.mode ?? ""),
        activityFilter
    );
    // the runs the run sheet steps through from Activity: live, then Earlier
    const activityRunLines = useMemo(
        () => [...activity.live, ...activity.earlierAll].map((i) => i.line).filter((l) => l.runOid != null),
        [activity]
    );

    const lines = useMemo(() => {
        const now = Date.now();
        return {
            waiting: filterLines(
                queue.map((q) => queueLine(q, now)),
                query
            ),
            behind: behindGroups(deltaGroups, shipped.rows, now)
                .map((g) => ({ ...g, lines: filterLines(g.lines, query) }))
                .filter((g) => g.lines.length > 0),
        };
    }, [queue, deltaGroups, shipped, query]);
    const strip = waitingStrip(lines.waiting, waitingOpen || filtering);
    const mainShown = only !== "activity";
    const sideShown = only == null || only === "activity";
    const behindLines = useMemo(
        () => lines.behind.filter((g) => g.label !== SHIPPED_LABEL).flatMap((g) => g.lines),
        [lines]
    );
    const shippedLines = useMemo(() => lines.behind.find((g) => g.label === SHIPPED_LABEL)?.lines ?? NO_LINES, [lines]);
    const reviewing = pass != null;

    // j/k walks the rows in the order they are drawn (briefnav.ts): the strip's item (its rows with Show all open), the
    // cards row by row, the list, Activity, then Since you looked, Shipped and Ideas
    const activityShown = useMemo(
        () => [...activity.live, ...activity.earlier, ...(staleOpen ? activity.older : [])],
        [activity, staleOpen]
    );
    const navIds = useMemo(
        () =>
            briefNavIds({
                strip: mainShown
                    ? strip.rows.length > 0
                        ? strip.rows.map((l) => l.id)
                        : strip.head != null
                          ? [strip.head.id]
                          : []
                    : [],
                cards: mainShown && !reviewing ? cards.map((c) => c.oref) : [],
                list: mainShown && !reviewing ? listItems.map((c) => c.oref) : [],
                activity: sideShown ? activityShown.map((i) => i.line.id) : [],
                behind: only == null ? behindLines.map((l) => l.id) : [],
                shipped: only == null ? shippedLines.map((l) => l.id) : [],
                ideas: only == null ? ideaLines.map((l) => l.id) : [],
            }),
        [
            mainShown,
            sideShown,
            only,
            strip,
            reviewing,
            cards,
            listItems,
            activityShown,
            behindLines,
            shippedLines,
            ideaLines,
        ]
    );

    const [storedCursor, setStoredCursor] = useAtom(briefCursorAtom);
    const cursor = resolveBriefCursor(navIds, storedCursor);
    const setCursor = useCallback((id: string) => setStoredCursor(id), [setStoredCursor]);

    const sheetOpen = useAtomValue(briefSheetOpenAtom);
    const councilSheet = useAtomValue(councilSheetAtom);
    const initiativeSheetOpen = useAtomValue(initiativeSheetOpenAtom);
    const subject = useAtomValue(activeSubjectAtom);
    // the initiative open in the sheet keeps the accent outline under the dimmed page
    const openedOref = initiativeSheetOpen && subject?.kind === "effort" ? "effort:" + subject.id : null;
    // a click hands its event over, so Ctrl peeks the row's target instead
    const openLine = useCallback(
        (target: LineTarget, e?: React.MouseEvent) => {
            if (target == null) {
                return;
            }
            if ("runQueue" in target) {
                openQueueSheet(target.runQueue);
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
    // an initiative opens in the sheet through the router (openref.ts selectEffort), as every way in does
    const openInitiative = useCallback((oref: string, e?: React.MouseEvent) => openLine({ oref }, e), [openLine]);
    const stageRun = useAtomValue(stageRunAtom);
    // what the cursor's id opens on Enter, and peeks on Space
    const navTarget = useMemo(() => {
        const out = new Map<string, { target: LineTarget; council?: string }>();
        for (const l of lines.waiting) {
            out.set(l.id, { target: l.target });
        }
        for (const i of activityShown) {
            out.set(i.line.id, { target: i.line.target, council: i.source === "council" ? i.councilId : undefined });
        }
        for (const l of [...behindLines, ...shippedLines, ...ideaLines]) {
            out.set(l.id, { target: l.target });
        }
        return out;
    }, [lines.waiting, activityShown, behindLines, shippedLines, ideaLines]);
    const cursorTarget: LineTarget = (() => {
        const oref = navInitiative(cursor);
        if (oref != null) {
            return { oref };
        }
        return cursor != null ? (navTarget.get(cursor)?.target ?? null) : null;
    })();
    const activateCursor = useCallback(() => {
        if (cursor == null) {
            return;
        }
        const council = navTarget.get(cursor)?.council;
        if (council != null) {
            openCouncilSheet(council);
            return;
        }
        if (cursorTarget != null) {
            openLine(cursorTarget);
        }
    }, [cursor, navTarget, cursorTarget, openLine]);
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
        const navLines = (shippedList ? shippedLines : activityRunLines).filter((l) => inList.has(oidOf(l)));
        return { lines: navLines, cursorId: navLines.find((l) => oidOf(l) === stageRun.id)?.id };
    }, [sheetOpen, stageRun, runList, shippedLines, activityRunLines]);
    // j/k across every region in render order, and Enter opens the row under the cursor. Enter is left alone
    // while a sheet is open, because the sheet's own Enter (an ask's submit) is the one on screen, and on a
    // row that opens nothing, so the key passes through. Typing never reaches here: list keys are off in a field. The
    // initiative and council sheets take j and k themselves (bindings.ts buildListNavBindings stands down).
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
                          navigableIds: navIds,
                          cursorId: cursor,
                          setCursor,
                          activate: sheetOpen || cursor == null ? undefined : activateCursor,
                          peekTarget: sheetOpen ? undefined : () => lineOpenTarget(cursorTarget),
                      },
            [runNav, navIds, cursor, setCursor, openLine, sheetOpen, activateCursor, cursorTarget]
        )
    );
    // the regions scroll as one page, so a cursor moved off-screen has to be brought back
    useEffect(() => {
        document.querySelector('[data-jarvis-brief-cursor="true"]')?.scrollIntoView({ block: "nearest" });
    }, [cursor]);
    // `p` pins and `w` works on the initiative under the cursor (bindings.ts); the sheet's own are its head's
    const cursorInitiative = navInitiative(cursor);
    useEffect(() => {
        globalStore.set(
            briefCursorInitiativeAtom,
            cursorInitiative != null
                ? {
                      oref: cursorInitiative,
                      workOn: () => {
                          // an archived initiative is finished, so it offers nothing to resume
                          const c = globalStore
                              .get(briefingStateAtom)
                              .snapshot?.state.efforts?.find((e) => e.oref === cursorInitiative);
                          if (c != null && c.status !== "archived") {
                              fireAndForget(() => workOnInitiative(model, buildEffortCard(c)));
                          }
                      },
                  }
                : null
        );
    }, [cursorInitiative, model]);
    useEffect(() => () => globalStore.set(briefCursorInitiativeAtom, null), []);

    const fleet = briefFleet(agents);

    // The profile modal is open on a project the palette can name, so it lives in jarvisstore. The detail
    // sheet draws the surface's active subject, so what is open lives in the subject store instead.
    const [profileTarget, setProfileTarget] = useAtom(briefProfileAtom);

    // The surface's own keys: the run switcher, the record band and the composer's i/Escape. The Stage
    // used to register these for a composition that no longer exists.
    const jarvisBindings = useMemo(() => buildJarvisBindings(model), [model]);
    useKeybindings(jarvisBindings);

    const projectCount = snapshot?.state.projects?.length ?? 0;
    const visitCursor = useAtomValue(briefingCursorAtom);
    const deltaRowsN = behindLines.length;

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
    // the initiative sheet's Previous / Next step through the page's order: the cards, then the list
    const pageOrder = useMemo(() => [...cards, ...listAll].map((c) => c.oref), [cards, listAll]);
    const pageOrderKey = pageOrder.join(",");
    useEffect(() => {
        globalStore.set(briefInitiativeListAtom, pageOrder);
    }, [pageOrderKey]);
    // the run sheet's ↳ chunk line opens the initiative sheet on that chunk
    const setRevealChunk = useSetAtom(briefRevealChunkAtom);
    useEffect(() => {
        setRevealChunk(() => openInitiativeChunk);
        return () => setRevealChunk(null);
    }, [setRevealChunk]);
    // the menu's edits reach archived initiatives too (unarchive, delete), so they read both lists
    const allCards = useMemo(
        () => new Map([...efforts, ...archivedCards].map((e) => [e.oref, e])),
        [efforts, archivedCards]
    );
    // the row menu's Link to…: the initiative being linked, and the element the picker opens under
    const [linking, setLinking] = useState<{ oref: string; anchor: HTMLElement } | null>(null);
    // A write the menu starts and the server refuses is told in the toast, with the server's own words.
    const toastError = (e: unknown) => briefUndo.error(e instanceof Error ? e.message : String(e));
    const runMutation = useCallback((fn: () => Promise<unknown>) => {
        fn().catch((e) => briefUndo.error(e instanceof Error ? e.message : String(e)));
    }, []);
    // A link that lands says so and offers the way back: the parent the initiative had, or none.
    const relink = (oref: string, parent: string, said: string, back: string) =>
        linkEffort(oref, parent).then(
            () => briefUndo.notify(said, () => void linkEffort(oref, back).catch(toastError)),
            toastError
        );
    // what the menu asks the sheet to do once it is open on the initiative (initiativesheet.tsx takes the request)
    const openWith = (oref: string, action: "rename" | "details") => {
        globalStore.set(initiativeSheetRequestAtom, { oref, action });
        openInitiative(oref);
    };
    const manageOf = (oref: string): InitiativeManage | undefined => {
        const c = allCards.get(oref);
        if (c == null) {
            return undefined;
        }
        const { title, status } = c;
        const parentOref = c.parentoid != null && c.parentoid !== "" ? "effort:" + c.parentoid : "";
        // a parent the lists do not hold (deleted) leaves a link worth clearing, named by what it is
        const parentTitle = allCards.get(parentOref)?.title ?? "its parent";
        return {
            status,
            pinned: c.pinnedTs > 0,
            pin: () => fireAndForget(() => togglePin(oref)),
            rename: () => openWith(oref, "rename"),
            details: () => openWith(oref, "details"),
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
            remove: () => briefUndo.schedule([effortKey(oref)], `Deleted “${title}”`, () => deleteEffort(oref)),
            link: (anchor) => setLinking({ oref, anchor }),
            unlink:
                parentOref !== ""
                    ? { parentTitle, run: () => void relink(oref, "", `Unlinked from “${parentTitle}”`, parentOref) }
                    : undefined,
        };
    };
    const showMenu = (oref: string, ev: React.MouseEvent) => {
        const c = allCards.get(oref);
        if (c != null) {
            showInitiativeMenu(initiativeLine(c), ev, (o) => openActivity(model, o), manageOf(oref));
        }
    };
    // what the picker's pick does: link the initiative under it
    const pickParent = (pick: string) => {
        const child = linking != null ? allCards.get(linking.oref) : undefined;
        setLinking(null);
        if (child == null) {
            return;
        }
        const back = child.parentoid != null && child.parentoid !== "" ? "effort:" + child.parentoid : "";
        void relink(child.oref, pick, `Linked under “${allCards.get(pick)?.title ?? "its parent"}”`, back);
    };
    // what a card and a list row say (briefcards.ts): Work on reads the live initiatives only
    const faceNow = Date.now();
    const faceInput = (c: EffortCardModel): FaceInput => ({
        now: faceNow,
        resume: liveCards.has(c.oref)
            ? initiativeResume(c.oref.replace(/^effort:/, ""), c.lastnote, agents, faceNow)
            : undefined,
        idle: reviewMarks.idle.get(c.oref),
    });
    const cardFaces = cards.map((c) => cardFace(c, faceInput(c)));
    const listFaces = listItems.map((c) => listRowFace(c, faceInput(c)));
    const workOn = (oref: string) => {
        const c = liveCards.get(oref);
        if (c != null) {
            fireAndForget(() => workOnInitiative(model, c));
        }
    };
    const pin = (oref: string) => fireAndForget(() => togglePin(oref));
    const peek = (oref: string, e: React.MouseEvent) => openInitiative(oref, e);

    // --- the review pass's rows: the open initiative with what happened since the mark and what to do about it, and
    // the rest of the pass as one-line rows with the reason each is there
    const effortCache = useAtomValue(effortDetailAtom);
    const reviewNow = Date.now();
    const reviewBodyOf = (card: EffortCardModel): ReactNode => {
        const detail = effortCache.get(card.oref);
        const marked = review != null && reviewedInSession(reviewed, card.oref, review.startedAt);
        const mark = reviewed[card.oref];
        const events = eventsSince(detail?.events, mark ?? cursorTs).map((ev) => ({
            ...eventParts(eventLine(ev, detail?.chunks)),
            when: eventAge(ev.ts, reviewNow),
            tone: eventTone(ev.kind),
        }));
        // idle by the reason the queue gave it: an initiative that changed and has sat since is read as changed
        const idle = reviewItems.find((q) => q.oref === card.oref)?.reason === "idle";
        const oid = card.oref.replace(/^effort:/, "");
        const paused = card.status === "paused";
        // Pause and Archive step on at once and mark the initiative once the server has written, so the write's own
        // stamp is not read as a change since the review
        const settle = (write: () => Promise<unknown>) => {
            advanceReview(card.oref);
            runMutation(async () => {
                await write();
                markReviewed(card.oref, Date.now());
            });
        };
        const keep: ReviewActionBtn = {
            id: "keep",
            label: "Keep going",
            onClick: () => markReviewedAndAdvance(Date.now()),
        };
        const work: ReviewActionBtn = {
            id: "work",
            label: openAgentFor(oid, agents) != null ? "Go to agent" : "Work on",
            onClick: () => void workOnInitiative(model, card),
        };
        const pause: ReviewActionBtn = {
            id: "pause",
            label: paused ? "Resume" : "Pause",
            onClick: () => {
                const next = paused ? "active" : "paused";
                settle(() => setEffortStatus(card.oref, next));
                briefUndo.notify(next === "paused" ? "Paused" : "Resumed", () =>
                    runMutation(() => setEffortStatus(card.oref, card.status))
                );
            },
        };
        const archive: ReviewActionBtn = {
            id: "archive",
            label: "Archive",
            onClick: () => {
                settle(() => setEffortStatus(card.oref, "archived"));
                briefUndo.notify(`Archived “${card.title}”`, () => runMutation(() => unarchiveEffort(card.oref)));
            },
        };
        return (
            <ReviewBody
                since={
                    events.length === 0 && idle ? `no change since ${shortDate(card.updatedts)}` : sinceHeading(mark)
                }
                events={events}
                quiet={
                    marked
                        ? "Marked reviewed in this pass."
                        : idle
                          ? quietLine(card.updatedts, reviewNow)
                          : "Changed since, with nothing in the feed to list: renames and moves leave no event."
                }
                // an idle one most likely wants parking or closing, so those lead
                actions={idle ? [pause, archive, work, keep] : [keep, work, pause, archive]}
                onMark={() => markReviewedAndAdvance(Date.now())}
            />
        );
    };
    const reviewRows =
        pass != null && !pass.done ? (
            <div
                data-jarvis-review="open"
                className="flex flex-col gap-1 rounded-[10px] border border-edge-mid bg-surface p-1"
            >
                {pass.orefs.map((oref) => {
                    const card = pass.cards.get(oref)!;
                    if (oref === pass.current) {
                        return <ReviewOpenInitiative key={oref} model={model} card={card} since={reviewBodyOf(card)} />;
                    }
                    const line = initiativeLine(card);
                    const marked = review != null && reviewedInSession(reviewed, oref, review.startedAt);
                    const live = liveCards.get(oref);
                    return (
                        <div key={oref} data-jarvis-review-row={oref} className={cn("min-w-0", marked && "opacity-45")}>
                            <InitiativeRow
                                line={line}
                                focused={false}
                                fresh={false}
                                expanded={false}
                                resume={
                                    live != null
                                        ? initiativeResume(
                                              oref.replace(/^effort:/, ""),
                                              live.lastnote,
                                              agents,
                                              reviewNow
                                          )
                                        : undefined
                                }
                                changed={reviewMarks.changed.has(oref)}
                                idle={reviewMarks.idle.get(oref)}
                                titleSlot={
                                    marked ? (
                                        <span
                                            title={line.title}
                                            className="truncate text-[13px] font-semibold text-ink-hi"
                                        >
                                            <span className="text-success">✓ </span>
                                            {line.title}
                                        </span>
                                    ) : undefined
                                }
                                trailing={
                                    <span className="whitespace-nowrap text-right text-[10.5px] text-ink-mid">
                                        {marked ? "reviewed" : (reviewItems.find((q) => q.oref === oref)?.reason ?? "")}
                                    </span>
                                }
                                onOpen={() => setReviewCursor(oref)}
                            />
                        </div>
                    );
                })}
            </div>
        ) : null;

    // the run sheet's n / N and its Previous / Next: Shipped from a shipped run, else Activity's live then Earlier runs
    useEffect(() => {
        globalStore.set(
            briefRunListAtom,
            stageRun != null && stageRun.status === "done"
                ? shipped.rows.map((r) => r.oref.replace(/^run:/, ""))
                : activityRunLines.flatMap((l) => (l.runOid ? [l.runOid] : []))
        );
    }, [stageRun, shipped, activityRunLines]);

    // Waiting's in-place button: Approve and Retry act on the exact phase or task the server named, and
    // anything else opens the row's run
    const queueOf = (l: BriefLine) => queue.find((q) => "waiting:" + q.key === l.id);
    const actOnQueue = (l: BriefLine) => {
        const q = queueOf(l);
        if (q == null) {
            return;
        }
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
    const queueActOf = (l: BriefLine) => queueAction(queueOf(l) as QueueRow);
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
    // the Activity item whose sheet is open: the council, or the run
    const activitySelected = !sheetOpen
        ? null
        : councilSheet != null
          ? "councils:" + councilSheet
          : stageRun != null
            ? (activityShown.find((i) => i.line.runOid === stageRun.id)?.id ?? null)
            : null;
    const firstLoad = snapshot == null && loading;
    const loadFailed = snapshot == null && error != null;
    const staleSnapshot = snapshot != null && error != null;
    const noInitiatives = efforts.length === 0 && archivedCards.length === 0;

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
                                {navIds.length} {navIds.length === 1 ? "hit" : "hits"}
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
            {/* @container, not a media query: the side column's width rule is about how much SURFACE the Brief has
                left, and the window is not the surface. */}
            <div className="@container relative flex min-h-0 flex-1">
                <div
                    className="flex min-h-0 flex-1 flex-col gap-[26px] overflow-y-auto px-[22px] pb-2.5 pt-5"
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
                    place would read as a double exposure of the same headings. The skeleton blocks'
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
                                {/* the main column only: the side column's sections are records of the past */}
                                {["Initiatives", "All initiatives"].map((label) => (
                                    <div key={label} className="flex min-h-0 flex-1 flex-col gap-2">
                                        <span className={cn(REGION_LABEL, "text-feed-label")}>{label}</span>
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
                                // main column (minmax 1fr) and side column (360px); below a container width of
                                // 1180px (about a 1280px window less the nav rail) the side column drops under the
                                // main one, as the cards go to two columns (initiativecards.tsx). A region read alone
                                // has no other column to make room for.
                                data-jarvis-brief-columns
                                className={cn(
                                    "grid grid-cols-1 items-start gap-7",
                                    mainShown && sideShown && "@min-[1180px]:grid-cols-[minmax(0,1fr)_360px]"
                                )}
                            >
                                {mainShown ? (
                                    <div data-jarvis-brief-main className="flex min-w-0 flex-col gap-5">
                                        {/* nothing waiting is said once, by the header chip: the strip comes back
                                        with the first gate or ask */}
                                        <WaitingStrip
                                            lines={lines.waiting}
                                            total={queue.length}
                                            open={waitingOpen || filtering}
                                            onToggle={() => toggleRegion("waiting")}
                                            actOf={queueActOf}
                                            onAct={actOnQueue}
                                            onOpen={(l, e) => {
                                                setCursor(l.id);
                                                openLine(l.target, e);
                                            }}
                                            cursor={cursor}
                                        />
                                        <section
                                            data-jarvis-brief-region="initiatives"
                                            className="flex min-w-0 flex-col gap-4"
                                        >
                                            <InitiativeCards
                                                faces={pass != null ? [] : cardFaces}
                                                heading={heading}
                                                pinSlot={pass == null && !filtering && showPinSlot(pinnedN)}
                                                review={
                                                    <div className="flex flex-none items-center gap-2">
                                                        <ReviewTools
                                                            count={reviewItems.length}
                                                            pass={
                                                                pass != null
                                                                    ? { at: pass.at, total: pass.orefs.length }
                                                                    : null
                                                            }
                                                            onEnter={() => enterReview(reviewOrefs, Date.now())}
                                                            onStep={moveReview}
                                                            onExit={exitReview}
                                                        />
                                                        <OnlyButton
                                                            label="Initiatives"
                                                            only={only === "initiatives"}
                                                            onOnly={() => toggleOnly("initiatives")}
                                                        />
                                                    </div>
                                                }
                                                cursor={cardAt(cursor)}
                                                opened={openedOref}
                                                onOpen={(oref) => {
                                                    setCursor("card:" + oref);
                                                    openInitiative(oref);
                                                }}
                                                onPeek={peek}
                                                onWork={workOn}
                                                onMenu={showMenu}
                                                onPin={pin}
                                            />
                                            {pass != null ? (
                                                <div className="flex min-w-0 flex-col gap-2">
                                                    {pass.done ? <ReviewDone onBack={exitReview} /> : reviewRows}
                                                </div>
                                            ) : noInitiatives ? (
                                                <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-edge-strong bg-surface px-4 py-3">
                                                    <span className="min-w-0 flex-1 text-[13px] text-secondary">
                                                        {NO_INITIATIVES}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        data-jarvis-empty-act="initiative"
                                                        onClick={() =>
                                                            globalStore.set(model.newInitiativeOpenAtom, true)
                                                        }
                                                        className={EMPTY_ACT}
                                                    >
                                                        New initiative
                                                        <kbd className="font-mono text-[10px] font-normal text-muted">
                                                            {formatChordString("Shift:n")}
                                                        </kbd>
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    {filtering && cards.length === 0 && cardSet.length > 0 ? (
                                                        <NoMatch />
                                                    ) : null}
                                                    <InitiativeList
                                                        faces={listFaces}
                                                        more={list.more}
                                                        expanded={initiativesOpen}
                                                        onToggleMore={() => toggleRegion("initiatives")}
                                                        tabs={
                                                            projectOptions.length > 1
                                                                ? filterNode({
                                                                      label: "Show initiatives of project",
                                                                      noun: "project",
                                                                      tag: "data-jarvis-initiative-project",
                                                                      options: [
                                                                          {
                                                                              value: null,
                                                                              label: "all",
                                                                              count: projectCards.length,
                                                                          },
                                                                          ...projectOptions.map((p) => ({
                                                                              value: p,
                                                                              label: p || "no project",
                                                                              count: perProject.get(p),
                                                                          })),
                                                                      ],
                                                                      value: project,
                                                                      onChange: setPickedProject,
                                                                  })
                                                                : undefined
                                                        }
                                                        empty={
                                                            filtering || project != null ? (
                                                                <NoMatch />
                                                            ) : (
                                                                <span className="px-2.5 py-1 text-[12px] text-ink-faint">
                                                                    {ALL_CARDS}
                                                                </span>
                                                            )
                                                        }
                                                        footer={
                                                            archivedShown.length > 0 ? (
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
                                                                        : `Show ${archivedShown.length} archived`}
                                                                </button>
                                                            ) : undefined
                                                        }
                                                        cursor={listRowAt(cursor)}
                                                        opened={openedOref}
                                                        onOpen={(oref) => {
                                                            setCursor("list:" + oref);
                                                            openInitiative(oref);
                                                        }}
                                                        onPeek={peek}
                                                        onWork={workOn}
                                                        onMenu={showMenu}
                                                        onPin={pin}
                                                    />
                                                </>
                                            )}
                                        </section>
                                    </div>
                                ) : null}
                                {/* the side column: what is going on now (Activity), what happened, what shipped,
                                    and what is not planned yet */}
                                {sideShown ? (
                                    <aside
                                        data-jarvis-brief-side
                                        className="flex min-w-0 flex-col gap-[22px] @min-[1180px]:border-l @min-[1180px]:border-edge-faint @min-[1180px]:pl-5"
                                    >
                                        <ActivityRegion
                                            model={activity}
                                            filter={activityFilter}
                                            onFilter={setActivityFilter}
                                            earlierOpen={earlierOpen}
                                            onToggleEarlier={() => setEarlierOpen(!earlierOpen)}
                                            olderOpen={staleOpen}
                                            onToggleOlder={() => setStaleOpen(!staleOpen)}
                                            queued={queuedN}
                                            onOpenQueue={() => {
                                                const first = queuedKept[0];
                                                if (first != null) {
                                                    openQueueSheet(first.entry.id);
                                                }
                                            }}
                                            ack={
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
                                            only={
                                                <OnlyButton
                                                    label="Activity"
                                                    only={only === "activity"}
                                                    onOnly={() => toggleOnly("activity")}
                                                />
                                            }
                                            act={
                                                <button
                                                    type="button"
                                                    data-jarvis-empty-act={
                                                        activityFilter === "councils" ? "council" : "run"
                                                    }
                                                    onClick={() =>
                                                        openLauncher(
                                                            model,
                                                            activityFilter === "councils" ? "council" : "run"
                                                        )
                                                    }
                                                    className={EMPTY_ACT}
                                                >
                                                    {activityFilter === "councils" ? "New council" : "New run"}
                                                </button>
                                            }
                                            cursor={cursor}
                                            selected={activitySelected}
                                            onOpenRun={(l, e) => {
                                                setCursor(l.id);
                                                openLine(l.target, e);
                                            }}
                                            onOpenCouncil={(id) => {
                                                setCursor("councils:" + id);
                                                openCouncilSheet(id);
                                            }}
                                        />
                                        {only == null ? (
                                            <>
                                                <section
                                                    data-jarvis-brief-region="behind"
                                                    className="flex flex-col gap-[9px]"
                                                >
                                                    <div className="flex items-center gap-[9px]">
                                                        <span className={cn(REGION_LABEL, "text-ink-mid")}>
                                                            Since you looked
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
                                                {/* its own section, because the two have different time bases: events
                                                since your last visit, and the last seven days' landed runs. Always
                                                drawn, so an empty week says so; Activity's tab narrows it. */}
                                                <section
                                                    data-jarvis-brief-region="shipped"
                                                    className="flex flex-col gap-[9px]"
                                                >
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
                                                                {(model_.shipped ?? []).length > 0
                                                                    ? "Nothing here matches the filter."
                                                                    : SHIPPED_EMPTY}
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
                                                                    l.target != null
                                                                        ? (e) => openLine(l.target, e)
                                                                        : undefined
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
                                                    <section
                                                        data-jarvis-ideas
                                                        className="flex min-w-0 flex-col gap-[9px]"
                                                    >
                                                        <div
                                                            data-jarvis-ideas-label
                                                            className="flex items-center gap-[9px]"
                                                        >
                                                            <span className={cn(REGION_LABEL, "text-ink-mid")}>
                                                                Ideas
                                                            </span>
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
                                                                    fresh={freshIdeas.has(keyOf(l))}
                                                                    // an idea opens in the sheet, which offers the ways
                                                                    // to plan it; the open one is marked as a card is
                                                                    expanded={
                                                                        l.target != null &&
                                                                        "oref" in l.target &&
                                                                        l.target.oref === openedOref
                                                                    }
                                                                    onContextMenu={(ev) =>
                                                                        l.target != null && "oref" in l.target
                                                                            ? showMenu(l.target.oref, ev)
                                                                            : undefined
                                                                    }
                                                                    onOpen={() => {
                                                                        setCursor(l.id);
                                                                        openLine(l.target);
                                                                    }}
                                                                />
                                                            ))}
                                                            <label
                                                                data-jarvis-jot-idea
                                                                className={cn(
                                                                    "flex h-8 items-center gap-2 rounded-[8px] border border-dashed border-edge-strong px-2.5 focus-within:border-accent/60",
                                                                    ideaLines.length > 0 && "mt-1"
                                                                )}
                                                            >
                                                                <Plus
                                                                    size={12}
                                                                    aria-hidden
                                                                    className="flex-none text-muted"
                                                                />
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
                                            </>
                                        ) : null}
                                    </aside>
                                ) : null}
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </div>
                <BriefToastView />
            </div>
            {/* the Brief's destination for a record address: openref.ts's record landing sets the atom this reads.
                Mounted here rather than beside the surface switch because it is the Brief's own overlay —
                the three-pane composition opens a record on the Stage instead. */}
            <BriefPeek model={model} />
            {/* the detail sheet, drawing the surface's active subject: a channel's run body (or its launcher), an
                initiative (initiativesheet.tsx), a council's report or a queued plan. */}
            <BriefSheet model={model} />
            {/* keyed by project so an open on a named project starts there, not on the last one picked */}
            <BriefProfileModal
                key={profileTarget ?? ""}
                open={profileTarget != null}
                initialChannelId={profileTarget ?? ""}
                onClose={() => setProfileTarget(null)}
            />
            {/* the menu's Link to…: the initiatives it can go under, which leave out itself and everything
                beneath it (that would be a cycle; the server refuses one too) */}
            <InitiativePicker
                open={linking != null}
                anchor={linking?.anchor ?? null}
                project={(linking != null ? allCards.get(linking.oref)?.project : undefined) ?? ""}
                excluding={linking != null ? descendantOrefs([...efforts, ...archivedCards], linking.oref) : undefined}
                newLabel={null}
                pickVerb="link"
                onPick={pickParent}
                onClose={() => {
                    linking?.anchor.focus({ preventScroll: true });
                    setLinking(null);
                }}
            />
            {/* the plan-gate modal, mounted here because the Stage was the surface that hosted it */}
            <DagModal />
            <TourOffer />
            <JarvisTour model={model} />
        </div>
    );
}
