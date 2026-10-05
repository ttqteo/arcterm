// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Chunk sidebar: one chunk's status and note trail beside the Brief. Not modal — the Brief behind
// it stays live, and prev/next step the Brief's own cursor rather than keeping a second one here.
// Past the container breakpoint it floats over the index instead of compressing it (a container query:
// the Brief is the whole surface, the window is not).

import { SkeletonLine } from "@/app/element/skeleton";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { runAtom } from "@/app/view/agents/channelsstore";
import { SectionLabel } from "@/app/view/agents/sectionlabel";
import { cn } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { ArrowUpRight, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { useState } from "react";
import { SHEET_BTN } from "./briefrunsheet";
import { REGION_LABEL } from "./briefstyle";
import { type FeedEntry } from "./effortfeed";
import { chunkTone } from "./effortmodel";
import { STATUSES, TONE_FG, ToneIcon } from "./inlinetrackerview";
import { runRecordRows } from "./runrecord";
import { RunReportView } from "./runreportview";
import { sidebarNotes, type NoteCard } from "./sidebarnotes";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const NAV_BUTTON =
    "inline-flex h-[22px] w-6 cursor-pointer items-center justify-center rounded-[6px] border border-border bg-surface-raised hover:border-edge-strong disabled:cursor-default";

const NO_RUN = atom<Run | undefined>(undefined);
// the report a finished run left on this chunk (Task 2): the structured report when the lead filed one,
// else the sealed summary; then the dag's record sealed with it
function NoteRun({ model, runOid }: { model: AgentsViewModel; runOid: string }) {
    const run = useAtomValue((runOid ? runAtom(runOid) : NO_RUN) as Atom<Run | undefined>);
    if (run == null) {
        return (
            <div aria-hidden="true" className="flex flex-col gap-2">
                <SkeletonLine className="h-[10px] w-[85%]" />
                <SkeletonLine className="h-[10px] w-[60%]" />
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-3">
            {(run.report ?? "").trim() !== "" ? (
                <RunReportView model={model} run={run} compact />
            ) : (
                <p className="m-0 text-[12px] leading-[1.55] text-secondary">
                    {run.evidence?.summary || "The run finished without a report."}
                </p>
            )}
            <RunRecord dag={run.evidence?.dag} />
        </div>
    );
}

function RunRecord({ dag }: { dag: EvidenceDag | undefined }) {
    const rows = runRecordRows(dag);
    if (rows.length === 0) {
        return null;
    }
    return (
        <div data-jarvis-run-record className="flex flex-col gap-1">
            <SectionLabel>record</SectionLabel>
            {rows.map((row, n) => (
                <div
                    key={n}
                    className={cn(
                        "whitespace-pre-wrap break-words",
                        row.kind === "task" && "pt-1 font-mono text-[11px] text-ink-hi",
                        row.kind === "section" && "pl-3 text-[12px] leading-[1.5] text-secondary",
                        row.kind === "run" && "pt-1 text-[11px] tabular-nums text-ink-mid",
                        row.kind === "run" && row.label === "left behind" && "font-mono"
                    )}
                >
                    {row.kind !== "task" && row.label != null ? (
                        <span className="text-[10.5px] text-muted">{row.label}: </span>
                    ) : null}
                    {row.text}
                </div>
            ))}
        </div>
    );
}

export function ChunkSidebar({
    model,
    initiative,
    label,
    stage,
    flat,
    status,
    position,
    feed,
    expanded,
    now,
    handle,
    error,
    onPrev,
    onNext,
    onToggle,
    onClose,
    onActivity,
    onAddNote,
    onSetStatus,
    onEditNote,
    onDeleteNote,
    onOpenSession,
}: {
    model: AgentsViewModel;
    initiative: string;
    label: string;
    stage: string;
    // a flat plan has no stages, so its crumb is the initiative alone
    flat: boolean;
    status: string;
    position: { n: number; total: number };
    feed: FeedEntry[];
    expanded: Set<string>;
    now: number;
    handle: string;
    error: string | null;
    onPrev: (() => void) | null;
    onNext: (() => void) | null;
    onToggle: (key: string) => void;
    onClose: () => void;
    onActivity: (e: React.MouseEvent) => void;
    onAddNote: (text: string) => void;
    onSetStatus: (status: string) => void;
    onEditNote: (entry: FeedEntry, text: string) => void;
    onDeleteNote: (entry: FeedEntry) => void;
    onOpenSession: (card: NoteCard, e: React.MouseEvent) => void;
}) {
    const cards = sidebarNotes(feed, label, now, expanded);
    const [draft, setDraft] = useState("");
    const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
    const submit = () => {
        const text = draft.trim();
        if (text !== "") {
            onAddNote(text);
            setDraft("");
        }
    };
    const saveEdit = (entry: FeedEntry) => {
        const text = editing?.text.trim() ?? "";
        if (text === "") {
            return; // Save is disabled on empty text; the server would refuse it too (EC-EMPTY-NOTE)
        }
        setEditing(null);
        if (text !== entry.text) {
            onEditNote(entry, text);
        }
    };

    return (
        <aside
            aria-label="Chunk"
            data-jarvis-chunk-sidebar
            className="absolute inset-y-0 right-0 z-[4] flex w-[460px] flex-col overflow-hidden border-l border-border bg-background @max-[1280px]:shadow-[-18px_0_44px_var(--color-background)] @max-[980px]:w-[min(460px,92cqw)]"
        >
            <div className="flex flex-none items-center gap-2 border-b border-edge-faint px-[13px] py-[9px]">
                <span className={cn(REGION_LABEL, "text-ink-mid")}>Chunk</span>
                <span className="text-[10.5px] tabular-nums text-muted">
                    {position.n} / {position.total}
                </span>
                <div className="flex gap-1">
                    <button
                        type="button"
                        aria-label="Previous chunk"
                        title="Previous chunk (k)"
                        disabled={onPrev == null}
                        onClick={onPrev ?? undefined}
                        className={cn(NAV_BUTTON, onPrev == null ? "text-feed-glyph" : "text-secondary", FOCUS)}
                    >
                        <ChevronUp size={13} aria-hidden />
                    </button>
                    <button
                        type="button"
                        aria-label="Next chunk"
                        title="Next chunk (j)"
                        disabled={onNext == null}
                        onClick={onNext ?? undefined}
                        className={cn(NAV_BUTTON, onNext == null ? "text-feed-glyph" : "text-secondary", FOCUS)}
                    >
                        <ChevronDown size={13} aria-hidden />
                    </button>
                </div>
                <span className="font-mono text-[10.5px] text-muted">j / k</span>
                <button type="button" onClick={onClose} className={cn(SHEET_BTN, "ml-auto")}>
                    Close
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-1.5 px-[18px] pb-3.5 pt-[15px]">
                    <div className="flex flex-wrap items-center gap-[7px] text-[10.5px] uppercase tracking-[.06em] text-ink-mid">
                        <span>{initiative}</span>
                        {flat ? null : (
                            <>
                                <span className="text-feed-glyph">/</span>
                                <span>{stage || "unstaged"}</span>
                            </>
                        )}
                    </div>
                    <div className="text-pretty text-[16px] font-semibold leading-[1.35] text-primary">{label}</div>
                    <div className="flex items-center gap-2.5">
                        <button
                            type="button"
                            title={handle}
                            onClick={() => void navigator.clipboard?.writeText(handle)}
                            className={cn(
                                "flex min-w-0 cursor-pointer items-center gap-1.5 text-left font-mono text-[10.5px] text-muted hover:text-ink-hi",
                                FOCUS
                            )}
                        >
                            <span className="truncate">{handle}</span>
                            <Copy size={11} aria-hidden className="flex-none" />
                        </button>
                        <button
                            type="button"
                            data-peek
                            onClick={onActivity}
                            className={cn(
                                "inline-flex flex-none cursor-pointer items-center gap-1 text-[10.5px] text-accent-soft hover:underline",
                                FOCUS
                            )}
                        >
                            activity
                            <ArrowUpRight size={11} aria-hidden />
                        </button>
                    </div>
                </div>
                <div className="px-[18px] pb-4">
                    <div
                        role="radiogroup"
                        aria-label="Status"
                        className="grid grid-cols-6 gap-[3px] rounded-[8px] border border-border bg-surface p-[3px]"
                    >
                        {STATUSES.map((s) => {
                            const tone = chunkTone(s);
                            const on = s === status;
                            return (
                                <button
                                    key={s}
                                    type="button"
                                    role="radio"
                                    aria-checked={on}
                                    onClick={() => !on && onSetStatus(s)}
                                    className={cn(
                                        "flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-[6px] border px-0.5 py-[5px] hover:bg-surface-hover",
                                        on ? "border-edge-mid bg-surface-selected" : "border-transparent",
                                        FOCUS
                                    )}
                                >
                                    <ToneIcon tone={tone} className={on ? undefined : "text-ink-mid"} />
                                    <span className={cn("text-[10.5px]", on ? TONE_FG[tone] : "text-ink-mid")}>
                                        {s}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="border-t border-edge-faint px-[18px] pb-[18px] pt-3">
                    <div className="mb-2 flex items-center gap-2">
                        <span className={cn(REGION_LABEL, "text-ink-mid")}>Notes</span>
                        <span className="text-[10.5px] tabular-nums text-muted">
                            {cards.length} {cards.length === 1 ? "note" : "notes"}
                        </span>
                    </div>
                    {cards.length === 0 ? (
                        <p className="text-[12px] leading-[1.6] text-muted">
                            No notes on this chunk yet. Notes from you or an agent land here.
                        </p>
                    ) : null}
                    {error != null ? <p className="mb-2 text-[11px] text-error">{error}</p> : null}
                    <div className="flex flex-col gap-2">
                        {cards.map((c) => {
                            const isEditing = editing?.key === c.key;
                            return (
                                <div
                                    key={c.key}
                                    data-jarvis-note-card={c.key}
                                    className={cn(
                                        "rounded-[8px] border bg-surface",
                                        isEditing ? "border-accent/45" : "border-border"
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => !isEditing && onToggle(c.key)}
                                        className={cn(
                                            "flex w-full cursor-pointer flex-col gap-[5px] rounded-[8px] px-[11px] py-[9px] text-left hover:bg-lane",
                                            FOCUS
                                        )}
                                    >
                                        <span className="flex w-full items-center gap-[7px] text-[10.5px] tabular-nums text-ink-mid">
                                            {c.who !== "" ? (
                                                <span className={c.who === "you" ? "text-accent-soft" : "text-success"}>
                                                    {c.who}
                                                </span>
                                            ) : null}
                                            <span>
                                                {c.day}
                                                {c.edited ? " · edited" : ""}
                                            </span>
                                            {c.chev !== "" ? (
                                                <span className="ml-auto flex items-center gap-1 text-muted">
                                                    {c.chev}
                                                    {c.open ? (
                                                        <ChevronUp size={11} aria-hidden />
                                                    ) : (
                                                        <ChevronDown size={11} aria-hidden />
                                                    )}
                                                </span>
                                            ) : null}
                                        </span>
                                        {isEditing ? null : (
                                            <span
                                                className={cn(
                                                    "whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] text-secondary",
                                                    !c.open && "line-clamp-3"
                                                )}
                                            >
                                                {c.text}
                                            </span>
                                        )}
                                    </button>
                                    {c.open && c.runOid !== "" && !isEditing ? (
                                        <div className="border-t border-edge-faint px-[11px] py-2.5">
                                            <NoteRun model={model} runOid={c.runOid} />
                                        </div>
                                    ) : null}
                                    {isEditing ? (
                                        <div className="flex flex-col gap-1.5 px-[11px] pb-2.5">
                                            <textarea
                                                autoFocus
                                                rows={6}
                                                value={editing.text}
                                                onChange={(e) => setEditing({ key: c.key, text: e.target.value })}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                                        saveEdit(c.entry);
                                                    } else if (e.key === "Escape") {
                                                        e.stopPropagation();
                                                        setEditing(null);
                                                    }
                                                }}
                                                className="w-full resize-y rounded-[7px] border border-accent/60 bg-background px-2.5 py-2 text-[12.5px] leading-[1.6] text-primary outline-none"
                                            />
                                            <div className="flex items-center gap-1.5">
                                                <span className="flex-1 text-[10.5px] text-muted">
                                                    ctrl+enter save · esc cancel
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditing(null)}
                                                    className={cn(
                                                        "cursor-pointer rounded-[7px] border border-border bg-surface-raised px-[11px] py-1 text-[11px] font-semibold text-secondary",
                                                        FOCUS
                                                    )}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={editing.text.trim() === ""}
                                                    onClick={() => saveEdit(c.entry)}
                                                    className={cn(
                                                        "cursor-pointer rounded-[7px] bg-accent px-[11px] py-1 text-[11px] font-bold text-background disabled:cursor-default disabled:opacity-40",
                                                        FOCUS
                                                    )}
                                                >
                                                    Save
                                                </button>
                                            </div>
                                        </div>
                                    ) : c.open && c.editable ? (
                                        <div className="flex gap-3 border-t border-edge-faint px-[11px] py-1.5">
                                            <button
                                                type="button"
                                                data-jarvis-note-edit
                                                onClick={() => setEditing({ key: c.key, text: c.entry.text })}
                                                className={cn(
                                                    "cursor-pointer text-[10.5px] text-muted hover:text-accent-soft",
                                                    FOCUS
                                                )}
                                            >
                                                edit
                                            </button>
                                            <button
                                                type="button"
                                                data-jarvis-note-delete
                                                onClick={() => onDeleteNote(c.entry)}
                                                className={cn(
                                                    "cursor-pointer text-[10.5px] text-muted hover:text-error",
                                                    FOCUS
                                                )}
                                            >
                                                delete
                                            </button>
                                        </div>
                                    ) : null}
                                    {!isEditing &&
                                    c.open &&
                                    c.who === "agent" &&
                                    (c.sessionTab !== "" || c.runOid !== "") ? (
                                        <div className="flex gap-3 border-t border-edge-faint px-[11px] py-1.5">
                                            <button
                                                type="button"
                                                data-peek
                                                onClick={(e) => onOpenSession(c, e)}
                                                className={cn(
                                                    "inline-flex cursor-pointer items-center gap-1 text-[10.5px] text-accent-soft hover:underline",
                                                    FOCUS
                                                )}
                                            >
                                                {c.sessionTab !== "" ? "open agent session" : "open run"}
                                                <ArrowUpRight size={11} aria-hidden />
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
            <div className="flex-none border-t border-border bg-surface px-[13px] pb-3 pt-2.5">
                <div className="flex flex-col gap-1.5 rounded-[8px] border border-edge-mid bg-background py-[7px] pl-2.5 pr-2">
                    <textarea
                        rows={3}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                submit();
                            } else if (e.key === "Escape" && draft !== "") {
                                // a half-typed note: Escape clears it before the sidebar's own Escape closes the panel
                                e.stopPropagation();
                                setDraft("");
                            }
                        }}
                        placeholder={`note on ${label}`}
                        aria-label="New note"
                        className="w-full resize-none bg-transparent text-[12.5px] leading-[1.6] text-primary outline-none"
                    />
                    <div className="flex items-center gap-2">
                        <span className="flex-1 text-[10.5px] text-muted">ctrl+enter to add</span>
                        <button
                            type="button"
                            disabled={draft.trim() === ""}
                            onClick={submit}
                            className={cn(
                                "cursor-pointer rounded-[6px] bg-accent px-[11px] py-1 text-[11px] font-bold text-background disabled:cursor-default disabled:bg-border disabled:text-muted",
                                FOCUS
                            )}
                        >
                            Add note
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    );
}
