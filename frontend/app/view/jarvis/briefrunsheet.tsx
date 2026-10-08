// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The sheet's shell and its run-settings dock. B5 moved "which subject is drawn" out to briefsheet.tsx,
// because the sheet draws the active subject rather than a run id; what stays here is everything that is
// specific to a run's configuration.
//
// Two rules decide what is a control and what is a fact. Shape, machine and the lead route are immutable
// after launch, so they are printed, not offered. Parallelism, the workers setting and the reviewer route are
// genuinely mutable, so they carry real controls — but only once asked for: until then the configuration is
// one printed line, and a run with nothing to reconfigure states its reason in the slot where the dials would be.
//
// A third rule decides *when* any of it is offered. A run that links a DAG has mutable settings, but never
// from the launch snapshot: until the linked TaskGroup is here the sheet cannot know what the scheduler is
// running at, and a save sent from the snapshot would overwrite it. So the dock reads the group through
// WOS (a scheduler tick has to show up here) and renders no controls until it has arrived.

import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { leadRuntimesAtom } from "@/app/view/agents/harnessstore";
import { RoutePicker } from "@/app/view/agents/routepicker";
import { MAX_PARALLELISM } from "@/app/view/agents/runconfig";
import { useDagGroup } from "@/app/view/orchestrate/dagstore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { REGION_LABEL } from "./briefstyle";
import {
    draftIsDirty,
    draftSeedKey,
    parallelismInvalid,
    routeLabel,
    runSettingsDraft,
    runSettingsPanelState,
    settingsPayload,
    withWorkers,
    workersLabel,
    type LinkedGroupRead,
    type RunSettingsDraft,
} from "./runsettings";
import { configLine, configNote } from "./runsheetmodel";

const META_ROW = "flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10.5px] tabular-nums";
const FIELD = "rounded-[7px] border border-border bg-background px-2 py-1 text-[11.5px] text-ink-hi";
export const SHEET_BTN =
    "cursor-pointer rounded-[7px] border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-semibold text-secondary hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40";

const RUN_ID_SHOWN = 8;
const COPIED_MS = 1200;

// The header's run id: the short form is what is read, the whole id is what is copied.
function RunIdChip({ id }: { id: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () =>
        fireAndForget(async () => {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            setTimeout(() => setCopied(false), COPIED_MS);
        });
    return (
        <button
            type="button"
            data-run-id={id}
            onClick={copy}
            title={copied ? "Copied" : `Copy run id ${id}`}
            aria-label="Copy run id"
            className="inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-[5px] border border-border bg-surface-raised px-1.5 py-px text-secondary hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            {id.slice(0, RUN_ID_SHOWN)}
            {copied ? <Check size={11} aria-hidden className="text-success" /> : <Copy size={11} aria-hidden />}
        </button>
    );
}

// The one panel both faces use. `face` is what the sheet is drawing, and it is on the element rather than
// inferred from the subject so a check can tell a sheet that never opened from one that opened empty.
export function SheetShell({
    face,
    label,
    title,
    meta,
    runId,
    actions,
    onClose,
    children,
}: {
    face: string;
    label: string;
    title: string;
    // the run the header is showing, printed under the project it belongs to
    meta?: string;
    runId?: string;
    actions?: ReactNode;
    onClose: () => void;
    children: ReactNode;
}) {
    return (
        <aside
            data-jarvis-brief-sheet={face}
            aria-label="Detail sheet"
            // positioning, width, scrim and edge now belong to ModalShell variant="sheet"
            className="flex h-full min-h-0 flex-col"
        >
            <header className="flex flex-none items-center gap-3 border-b border-edge-faint px-4 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-baseline gap-2.5">
                        <span className={cn(REGION_LABEL, "text-accent-soft")}>{label}</span>
                        <span title={title} className="min-w-0 truncate text-[13.5px] font-semibold text-ink-hi">
                            {title}
                        </span>
                    </div>
                    {meta || runId ? (
                        <div className="flex min-w-0 items-center gap-2 font-mono text-[10.5px] text-muted">
                            {runId ? <RunIdChip id={runId} /> : null}
                            {meta ? <span className="min-w-0 truncate">{meta}</span> : null}
                        </div>
                    ) : null}
                </div>
                <div className="flex flex-none items-center gap-2.5 whitespace-nowrap">
                    {actions}
                    <button type="button" aria-label="Close detail sheet" onClick={onClose} className={SHEET_BTN}>
                        Close
                    </button>
                </div>
            </header>
            {children}
        </aside>
    );
}

// The inline form lives in the run sheet's reading (design L436-452): the run's meta, then the configuration
// as spans with an adjust toggle, and the dials as a block below that row rather than in a dock.
type ConfigProps = {
    run: Run;
    inline?: boolean;
    // inline only: what the reading prints ahead of the configuration on the same row
    meta?: ReactNode;
};

function LoadedConfig({
    run,
    group,
    groupRead,
    inline,
    meta,
}: ConfigProps & { group: TaskGroup | null; groupRead: LinkedGroupRead }) {
    const leadRuntimes = useAtomValue(leadRuntimesAtom);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<RunSettingsDraft | null>(null);
    const [baseline, setBaseline] = useState<RunSettingsDraft | null>(null);
    const [saving, setSaving] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const channelId = run.channeloid ?? "";
    const state = runSettingsPanelState(run, group, groupRead);
    // every effective mutable input, keyed: a status tick changes the object but not this, so it cannot
    // wipe whatever the user has typed into the panel.
    const seed = draftSeedKey(run, group);

    useEffect(() => {
        if (state.kind !== "editable") {
            setDraft(null);
            setBaseline(null);
            return;
        }
        const next = runSettingsDraft(run, group);
        setDraft(next);
        setBaseline(next);
    }, [run.oid, group?.oid, seed, state.kind]);

    const note = configNote(run, state);
    const lead = `${run.mode === "orchestrator" ? "lead " : ""}${run.runtime || "claude"}/${run.model || "default"}`;
    if (note != null) {
        const readState = state.kind === "loading" || state.kind === "unavailable" ? state.kind : undefined;
        if (inline) {
            // the note's reason rides on the span: the meta row has no room for a paragraph
            return (
                <div className={META_ROW}>
                    {meta}
                    <span data-jarvis-brief-sheet-state={readState} title={note.title} className="text-ink-mid">
                        {lead}
                    </span>
                </div>
            );
        }
        return (
            <div data-jarvis-brief-sheet-state={readState} className="flex items-start gap-[9px] px-4 py-[11px]">
                <span
                    className={cn(
                        "mt-1 h-1.5 w-1.5 flex-none rounded-full",
                        note.tone === "error" ? "bg-error" : note.tone === "muted" ? "bg-muted" : "bg-edge-strong",
                        note.pulse && "pulse-soft"
                    )}
                />
                <div className="flex min-w-0 flex-col gap-[3px]">
                    <span className="text-[11.5px] font-semibold text-secondary">{note.title}</span>
                    {note.body ? <span className="text-[11px] leading-[1.5] text-muted">{note.body}</span> : null}
                </div>
            </div>
        );
    }
    if (draft == null || baseline == null) {
        return inline ? (
            <div className={META_ROW}>
                {meta}
                <span className="text-ink-mid">{lead}</span>
            </div>
        ) : null;
    }

    const busy = saving != null;
    const dirty = draftIsDirty(draft, baseline);
    const invalid = parallelismInvalid(draft.parallelism);
    // the scheduler runs at the baseline until a save lands, so a draft it refused (or never received) is
    // printed as not saved rather than as the configuration in force
    const notSaved = dirty && (invalid || error != null);
    const shown = notSaved ? draft : baseline;

    const submit = (label: string, work: () => Promise<void>, onDone: () => void) => {
        setSaving(label);
        setError(null);
        setNotice(null);
        fireAndForget(async () => {
            try {
                await work();
                onDone();
            } catch (e) {
                setError(String(e));
            } finally {
                setSaving(null);
            }
        });
    };
    const save = () =>
        submit(
            "settings",
            () => RpcApi.SetRunSettingsCommand(TabRpcClient, settingsPayload(channelId, run.id, draft)),
            () => {
                // only a successful write re-seeds: a refused save must leave the user's draft alone.
                setBaseline(draft);
                setNotice("Saved. Applies to future dispatches.");
            }
        );

    const dials = (
        <>
            <p className="text-[11.5px] leading-[1.5] text-muted">
                Shape, machine and the lead route are fixed after launch. These apply to workers and reviewers
                dispatched from now on. Nothing already running changes.
            </p>
            <div className="flex items-start gap-4">
                <label className="flex flex-col gap-[5px]">
                    <span className="text-[11.5px] font-semibold text-secondary">Worker parallelism</span>
                    <input
                        type="number"
                        min={1}
                        max={MAX_PARALLELISM}
                        value={draft.parallelism}
                        disabled={busy}
                        onChange={(e) => setDraft({ ...draft, parallelism: Number(e.target.value) })}
                        className={cn(FIELD, "w-[72px] text-[12px] tabular-nums")}
                    />
                    <span className="text-[10.5px] text-muted">1 through {MAX_PARALLELISM}</span>
                </label>
                <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                    <span className="text-[11.5px] font-semibold text-secondary">Worker route</span>
                    <RoutePicker
                        value={draft.workerRoute}
                        canInherit
                        inheritedLabel="Inherit the lead"
                        disabled={busy}
                        onChange={(route) => setDraft(withWorkers(draft, route))}
                        extraOption={{
                            label: "Reviewer picks",
                            selected: draft.reviewerPicks,
                            onSelect: () => setDraft(withWorkers(draft, "picks")),
                        }}
                    />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                    <span className="text-[11.5px] font-semibold text-secondary">Reviewers</span>
                    <RoutePicker
                        value={draft.reviewerRoute}
                        canInherit
                        inheritedLabel="Inherit the lead"
                        disabled={busy}
                        onChange={(route) => setDraft({ ...draft, reviewerRoute: route })}
                        runtimes={leadRuntimes}
                    />
                </div>
            </div>
            {invalid ? (
                <p data-jarvis-brief-sheet-state="error" className="text-[11.5px] text-error">
                    Enter a whole number from 1 through {MAX_PARALLELISM}. The scheduler is still running at{" "}
                    {baseline.parallelism}.
                </p>
            ) : null}
            {error != null ? (
                <p data-jarvis-brief-sheet-state="error" className="text-[11.5px] text-error">
                    {error}
                </p>
            ) : null}
            {notice != null ? (
                <p data-jarvis-brief-sheet-state="saved" className="text-[11.5px] text-success">
                    {notice}
                </p>
            ) : null}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={save}
                    disabled={busy || !dirty || invalid || channelId === ""}
                    className={cn(SHEET_BTN, "border-accent/40 px-[11px] py-[5px] text-accent-soft")}
                >
                    {saving === "settings" ? "Saving…" : "Save settings"}
                </button>
            </div>
        </>
    );

    if (inline) {
        const tone = notSaved ? "text-error" : "text-ink-mid";
        const workers = shown.reviewerPicks
            ? `workers ${workersLabel(shown)}`
            : (shown.workerRoute?.runtime ?? "") === ""
              ? "workers inherit the lead"
              : `workers on ${routeLabel(shown.workerRoute)}`;
        return (
            <>
                <div data-jarvis-brief-sheet-config="editable" className={META_ROW}>
                    {meta}
                    <span className={tone}>{lead}</span>
                    {/* a run launched before widths were resolved at launch stores 0: the engine picks at submit */}
                    {shown.parallelism > 0 ? <span className={tone}>{shown.parallelism} workers</span> : null}
                    <span className={tone}>{workers}</span>
                    {shown.reviewerRoute != null ? (
                        <span className={tone}>reviewers on {routeLabel(shown.reviewerRoute)}</span>
                    ) : null}
                    {notSaved ? <span className="text-error">not saved</span> : null}
                    <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpen((o) => !o)}
                        className="cursor-pointer text-[10.5px] text-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >
                        {open ? "done" : "adjust"}
                    </button>
                </div>
                {open ? (
                    <div className="flex flex-col gap-3 rounded-[9px] border border-border bg-surface px-[13px] pb-[13px] pt-[11px]">
                        {dials}
                    </div>
                ) : null}
            </>
        );
    }

    return (
        <div data-jarvis-brief-sheet-config="editable">
            <div className="flex items-center gap-2.5 px-4 py-[11px]">
                <span
                    title={configLine(run, shown, notSaved)}
                    className={cn(
                        "min-w-0 flex-1 truncate text-[10.5px] tabular-nums",
                        notSaved ? "text-error" : "text-muted"
                    )}
                >
                    {configLine(run, shown, notSaved)}
                </span>
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((o) => !o)}
                    className={cn(SHEET_BTN, "flex-none rounded-[6px] px-[9px] py-[3px] text-[10.5px]")}
                >
                    {open ? "Done" : "Adjust"}
                </button>
            </div>
            {open ? (
                <div className="flex flex-col gap-3 border-t border-edge-faint px-4 pb-3.5 pt-[11px]">{dials}</div>
            ) : null}
        </div>
    );
}

// Mounted only when the run actually links a dag, so the WOS subscription below always names a real object.
// The read state is carried whole — loading, arrived, failed, gone — because a failed or deleted group is not
// a group that is still loading.
function LinkedRunConfig({ dagId, ...props }: ConfigProps & { dagId: string }) {
    const oref = WOS.makeORef("dag", dagId);
    const [group, loading] = useDagGroup(oref);
    const errored = useAtomValue(WOS.getWaveObjectErrorAtom(oref));
    const groupRead: LinkedGroupRead = loading ? "loading" : group != null ? "ready" : errored ? "error" : "missing";
    return <LoadedConfig {...props} group={group ?? null} groupRead={groupRead} />;
}

// The run's configuration for whichever run the sheet is showing: a dock of its own, or, inline, the tail of
// the reading's meta row. The linked/unlinked split is a component boundary rather than a hook inside a
// branch: useDagGroup has to be called unconditionally.
export function RunSettingsPanel(props: ConfigProps) {
    const dagId = props.run.dagoref ?? "";
    if (dagId !== "") {
        return <LinkedRunConfig {...props} dagId={dagId} />;
    }
    return <LoadedConfig {...props} group={null} groupRead="ready" />;
}
