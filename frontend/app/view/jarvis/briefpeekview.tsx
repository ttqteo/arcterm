// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's record peek. In the three-pane composition a record is a subject on the Stage; the Brief has
// no Stage, so this is where a record oref lands (see openref.ts's task arm).
//
// It is deliberately the smaller half of the meta spec's §2 line: what is running against the record and
// what you set it to, and nothing else. Its full history, decision log and past corrections belong to the
// record as a Brief subject.
//
// Everything shown is derived in briefpeek.ts. RecordPeekBody mounts it, loads the two caches it reads, and
// owns the one write on it; the Brief's modal and the avatar popup's record item both render it.

import { SkeletonLine } from "@/app/element/skeleton";
import { ConfirmDialog } from "@/app/modals/confirmdialog";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { channelsAtom } from "@/app/view/agents/channelsstore";
import { harnessesAtom } from "@/app/view/agents/harnessstore";
import { fleetCounts } from "@/app/view/agents/jarviscards";
import type { RunStatusTone } from "@/app/view/agents/runmodel";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { Check, ChevronDown, ChevronUp, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import { buildRecordPeek, type PeekRunRow, type PeekStatusRow } from "./briefpeek";
import { FAINT_TEXT, META_TEXT, REGION_LABEL, SMALL_BTN } from "./briefstyle";
import { fleetForRecord } from "./fleetscope";
import { briefGraphRecordAtom, briefPeekRecordAtom, graphPeekOpenAtom } from "./jarvisstore";
import {
    loadRecordDetail,
    loadRecordScope,
    recordDetailAtom,
    recordRunsAtom,
    recordScopeAtom,
} from "./jarvissubjectstore";
import { openAddress, openOrPeekAddress } from "./openref";
import { closePeek } from "./peekstore";
import { setDossierStatus } from "./recordactions";

// Same vocabulary and same tones as taskdetail.tsx's chip, on purpose: the status is the one field scanned
// before anything else is read, and a record that reads "paused" in one place and grey in another is the
// kind of drift that makes a colour meaningless.
const STATUS_FG: Record<string, string> = {
    active: "text-success",
    paused: "text-warning",
    completed: "text-accent-soft",
    archived: "text-muted",
};

// The run's outcome column is scanned as colour rather than read as more grey text. Mirrors recordthread's
// mapping — the same runs, described the same way.
export const RUN_TONE: Record<RunStatusTone, string> = {
    planning: "text-accent-soft",
    review: "text-warning",
    running: "text-success",
    done: "text-success/70",
    blocked: "text-warning",
    failed: "text-error",
    cancelled: "text-muted",
};

// LINK_BTN's type and hover without its border: a link inside the body, not a control beside it
const BODY_LINK =
    "inline-flex cursor-pointer items-center gap-1 self-start text-[10.5px] text-accent-soft hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// The body's host. The Brief's modal is a destination, so its run links peek on Ctrl+click; the avatar popup is
// itself a peek, and a link inside one is a plain open (depth 1).
type Place = "brief" | "popup";

function StatusRow({ row, onPick }: { row: PeekStatusRow; onPick: (status: string) => void }) {
    const fg = STATUS_FG[row.status] ?? "text-muted";
    const body = (
        <>
            <span className={cn("inline-flex w-3 flex-none", fg)}>
                {row.current ? <Check size={12} strokeWidth={2.4} className="translate-y-px" /> : null}
            </span>
            <span className={cn("w-[58px] flex-none text-[11px] font-semibold", fg)}>{row.label}</span>
            <span className="min-w-0 flex-1 text-[11.5px] leading-[1.45] text-muted">{row.note}</span>
        </>
    );
    // the row naming the status the record is already in is a label, not a control: there is nothing for it
    // to do, and dressing it as a button would be the same lie as camouflaging a real one.
    if (row.current) {
        return (
            <div
                data-jarvis-peek-status={row.status}
                className="flex items-baseline gap-2.5 rounded-[6px] px-2.5 py-1.5"
            >
                {body}
            </div>
        );
    }
    return (
        <button
            type="button"
            data-jarvis-peek-status={row.status}
            onClick={() => onPick(row.status)}
            className="flex cursor-pointer items-baseline gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            {body}
        </button>
    );
}

// an open from inside the popup leaves it, the way the hub's own escorts do; a failed one keeps it up behind
// the toast
async function openFromPopup(model: AgentsViewModel, address: string): Promise<void> {
    const result = await openAddress(model, address);
    if (result.ok) {
        closePeek();
    }
}

function RunRowView({ row, model, place }: { row: PeekRunRow; model: AgentsViewModel; place: Place }) {
    const address = "run:" + row.runId;
    return (
        <button
            type="button"
            data-jarvis-peek-row="run"
            data-jarvis-peek-run={row.runId}
            data-peek={place === "brief" ? true : undefined}
            onClick={(e) =>
                place === "brief"
                    ? void openOrPeekAddress(model, address, e)
                    : fireAndForget(() => openFromPopup(model, address))
            }
            className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 px-3 py-[7px] text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <span className="flex-none font-mono text-[10.5px] font-semibold text-accent-soft">{row.shortId}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-mid">{row.headline}</span>
            <span className="flex-none whitespace-nowrap text-[10.5px] tabular-nums text-muted">{row.meta}</span>
            <span className={cn("flex-none whitespace-nowrap text-[10.5px] font-semibold", RUN_TONE[row.tone])}>
                {row.state}
            </span>
        </button>
    );
}

const confirmTitle = (status: string) => `Mark this record ${status}?`;
const confirmBody = (status: string) => `This sets the record's status to "${status}". You can reactivate it later.`;

// The popup's terminal-status question. The Brief asks in a ConfirmDialog of its own beside its modal; inside the
// popup a second modal would sit under the popup's focus trap, so the question is asked in place.
function InlineConfirm({
    status,
    onConfirm,
    onCancel,
}: {
    status: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div
            data-jarvis-peek-confirm={status}
            className="flex flex-none flex-col gap-2 border-b border-border bg-surface-raised px-[17px] py-2.5"
        >
            <span className="text-[12px] font-semibold text-ink-hi">{confirmTitle(status)}</span>
            <span className="text-[11.5px] leading-[1.45] text-muted">{confirmBody(status)}</span>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onConfirm}
                    className={cn(SMALL_BTN, status === "archived" ? "text-error" : "text-warning")}
                >
                    {`Yes, ${status}`}
                </button>
                <button type="button" onClick={onCancel} className={SMALL_BTN}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

export function RecordPeekBody({
    model,
    recordId,
    place,
    onMap,
    onAskTerminal,
}: {
    model: AgentsViewModel;
    recordId: string;
    place: Place;
    // the map button's exit; each host leaves its own way
    onMap: () => void;
    // a completed or archived pick asks first: through the host when it has a dialog of its own, else in place
    onAskTerminal?: (status: string) => void;
}) {
    const details = useAtomValue(recordDetailAtom);
    const runsByRecord = useAtomValue(recordRunsAtom);
    const scopes = useAtomValue(recordScopeAtom);
    const channels = useAtomValue(channelsAtom);
    const agents = useAtomValue(model.agentsAtom);
    const harnesses = useAtomValue(harnessesAtom);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [asking, setAsking] = useState<string | null>(null);
    const [objectiveOpen, setObjectiveOpen] = useState(false);

    // both caches, because the peek's two halves come from different reads: the record's own fields, and the
    // runs attributed to it (a dossier has no run list of its own — ResolveSpaceScope answers that).
    useEffect(() => {
        loadRecordDetail(recordId);
        loadRecordScope(recordId);
    }, [recordId]);

    // the picker and the expanded objective are per-opening, not per-record: leaving the picker open across a
    // close would reopen the peek mid-write, and a second record would open already expanded
    useEffect(() => {
        setPickerOpen(false);
        setAsking(null);
        setObjectiveOpen(false);
    }, [recordId]);

    const detail = details[recordId];
    const runs = runsByRecord[recordId] ?? [];
    const fleet = fleetForRecord({
        channels: channels ?? [],
        agents,
        attributedRunORefs: scopes[recordId]?.runorefs ?? [],
    });
    const peek =
        detail != null
            ? buildRecordPeek({
                  detail,
                  runs,
                  fleet,
                  counts: fleetCounts(fleet.workers),
                  harnesses,
                  now: Date.now(),
              })
            : null;

    const applyStatus = (next: string) => {
        const row = peek?.statusRows.find((r) => r.status === next);
        setPickerOpen(false);
        // completed and archived are terminal enough to confirm — the same guard taskdetail applies, kept
        // here rather than re-decided, so the two entry points cannot disagree about what needs a prompt.
        if (row?.terminal) {
            if (onAskTerminal != null) {
                onAskTerminal(next);
            } else {
                setAsking(next);
            }
            return;
        }
        setDossierStatus(recordId, next);
    };

    return (
        <>
            <div className="flex min-w-0 flex-none items-center gap-2.5 border-b border-border px-[17px] py-3">
                <span className={cn(REGION_LABEL, "text-accent-soft")}>record</span>
                <span
                    data-jarvis-peek-title
                    className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-hi"
                >
                    {peek != null ? peek.title : <SkeletonLine className="h-[12px] w-[180px]" />}
                </span>
                {peek != null ? (
                    <>
                        <span className={cn("flex-none", FAINT_TEXT)}>{peek.updatedLabel}</span>
                        <button
                            type="button"
                            data-jarvis-peek-status-toggle
                            aria-label="Change what this record does"
                            aria-expanded={pickerOpen}
                            onClick={() => setPickerOpen((v) => !v)}
                            className={cn(
                                "inline-flex flex-none cursor-pointer items-center gap-1 rounded-[6px] border border-border bg-surface-raised py-0.5 pl-2 pr-1.5 text-[10.5px] font-semibold hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                STATUS_FG[peek.statusLabel] ?? "text-muted"
                            )}
                        >
                            {peek.statusLabel}
                            <span className="inline-flex text-muted">
                                {pickerOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </span>
                        </button>
                    </>
                ) : null}
            </div>
            {pickerOpen && peek != null ? (
                <div className="flex flex-none flex-col gap-px border-b border-border bg-surface-raised px-2 py-1.5">
                    {peek.statusRows.map((row) => (
                        <StatusRow key={row.status} row={row} onPick={applyStatus} />
                    ))}
                </div>
            ) : null}
            {asking != null ? (
                <InlineConfirm
                    status={asking}
                    onConfirm={() => {
                        setDossierStatus(recordId, asking);
                        setAsking(null);
                    }}
                    onCancel={() => setAsking(null)}
                />
            ) : null}
            {peek != null ? (
                <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-[17px] py-4">
                    {peek.body != null ? (
                        <div className="flex flex-col gap-1.5">
                            <p
                                data-jarvis-peek-body
                                className={cn(
                                    "whitespace-pre-line text-[13px] leading-[1.6] text-ink-mid",
                                    peek.bodyMore != null && !objectiveOpen && "line-clamp-4"
                                )}
                            >
                                {peek.body}
                            </p>
                            {peek.bodyMore != null ? (
                                <button
                                    type="button"
                                    data-jarvis-peek-body-toggle
                                    aria-expanded={objectiveOpen}
                                    onClick={() => setObjectiveOpen((v) => !v)}
                                    className={BODY_LINK}
                                >
                                    {objectiveOpen ? "Show less" : peek.bodyMore}
                                    {objectiveOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                    <div className="flex flex-col overflow-hidden rounded-[9px] border border-border bg-background">
                        <div className="flex items-center gap-2.5 border-b border-edge-faint px-3 py-2">
                            <span className={cn(REGION_LABEL, "text-ink-mid")}>Fleet · on this record</span>
                            <span className="h-px flex-1 bg-edge-faint" />
                            <span className={cn("flex-none", FAINT_TEXT)}>{peek.fleetMeta}</span>
                        </div>
                        {peek.runs.length === 0 ? (
                            <div className="px-3 py-2.5 text-[11px] text-muted">{peek.runsAbsent}</div>
                        ) : (
                            peek.runs.map((row) => <RunRowView key={row.runId} row={row} model={model} place={place} />)
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {/* a label, not a button: the peek reports the count and the Brief owns the log,
                            so this states it and stops there. */}
                        <span className={cn("rounded-[6px] border border-edge-faint px-[9px] py-[3px]", META_TEXT)}>
                            {peek.logLine}
                        </span>
                        <span className="flex-1" />
                        <button
                            type="button"
                            data-jarvis-peek-open-graph
                            onClick={onMap}
                            className={cn(SMALL_BTN, "inline-flex items-center gap-1.5")}
                        >
                            <Waypoints size={12} className="text-muted" />
                            Where it sits on the map
                        </button>
                    </div>
                </div>
            ) : null}
        </>
    );
}

export function BriefPeek({ model }: { model: AgentsViewModel }) {
    const recordId = useAtomValue(briefPeekRecordAtom);
    const setRecordId = useSetAtom(briefPeekRecordAtom);
    const [pendingStatus, setPendingStatus] = useState<string | null>(null);

    useEffect(() => {
        setPendingStatus(null);
    }, [recordId]);

    const close = () => setRecordId(null);
    // The peek's one exit. It closes the peek first: the graph peek is an overlay on the surface, and leaving the
    // record modal up over it would stack two modals, both claiming Escape.
    const openMap = () => {
        if (recordId == null) return;
        globalStore.set(briefGraphRecordAtom, recordId);
        setRecordId(null);
        globalStore.set(graphPeekOpenAtom, true);
    };

    return (
        <>
            <ModalShell open={recordId != null} onClose={close} align="center" className="w-[640px] max-w-full">
                <div data-jarvis-brief-band="peek" className="flex min-h-0 flex-col">
                    {recordId != null ? (
                        <RecordPeekBody
                            model={model}
                            recordId={recordId}
                            place="brief"
                            onMap={openMap}
                            onAskTerminal={setPendingStatus}
                        />
                    ) : null}
                </div>
            </ModalShell>
            {pendingStatus != null && recordId != null ? (
                <ConfirmDialog
                    tone={pendingStatus === "archived" ? "danger" : "warning"}
                    title={confirmTitle(pendingStatus)}
                    body={confirmBody(pendingStatus)}
                    confirmLabel={`Yes, ${pendingStatus}`}
                    cancelLabel="Cancel"
                    onConfirm={() => {
                        setDossierStatus(recordId, pendingStatus);
                        setPendingStatus(null);
                    }}
                    onClose={() => setPendingStatus(null)}
                />
            ) : null}
        </>
    );
}
