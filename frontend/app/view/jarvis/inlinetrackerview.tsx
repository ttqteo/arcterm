// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The inline initiative tracker — the view over inlinetracker.ts.
//
// The plan reads first: an expanded initiative shows its stages and chunks in place, and prose moves out
// to the Chunk sidebar (chunksidebar.tsx), because an initiative's notes here average ~1.1k characters and
// the sheet this replaces could not hold plan and prose at 640px.

import { cn } from "@/util/util";
import { useAtom } from "jotai";
import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    Check,
    ChevronDown,
    ChevronRight,
    Circle,
    CircleAlert,
    Ellipsis,
    Minus,
    Pause,
    Play,
    Plus,
    Sparkles,
    type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { chunkTone, type ChunkTone } from "./effortmodel";
import { chunkDueChip, localDay, type DetailRow } from "./inlinetracker";
import { trackerMenuAtom } from "./jarvisstore";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const TONE_ICON: Record<ChunkTone, LucideIcon> = {
    done: Check,
    active: Play,
    blocked: CircleAlert,
    deferred: Pause,
    skipped: Minus,
    // pending reads as an empty circle
    pending: Circle,
};

// play and circle fill more of their box than the rest, so they draw smaller to read at the same weight
const TONE_SIZE: Partial<Record<ChunkTone, number>> = { active: 11, pending: 10 };

export function ToneIcon({ tone, size, className }: { tone: ChunkTone; size?: number; className?: string }) {
    const Icon = TONE_ICON[tone];
    return (
        <Icon
            size={size ?? TONE_SIZE[tone] ?? 12}
            strokeWidth={2.25}
            aria-hidden
            className={cn("flex-none", TONE_FG[tone], className)}
        />
    );
}

export const TONE_FG: Record<ChunkTone, string> = {
    done: "text-success",
    active: "text-accent",
    blocked: "text-warning-soft",
    deferred: "text-warning-soft",
    skipped: "text-ink-mid",
    pending: "text-ink-mid",
};

export const STATUSES = ["pending", "active", "blocked", "deferred", "skipped", "done"];

const SMALL_BUTTON =
    "cursor-pointer rounded-[6px] border border-border px-2 py-[3px] text-[10.5px] text-ink-mid hover:border-edge-strong hover:text-ink-hi";

const stageHeadClass = (first: boolean) =>
    cn(
        "relative flex items-center gap-2 border-t px-1.5 pb-1 pt-2.5",
        first ? "mt-0 border-transparent" : "mt-2 border-edge-faint"
    );

export type TrackerEdits = {
    oid: string; // bare effort oid, for the footer's copy button (an empty plan has no facts row)
    title: string;
    effortStatus: string; // active | paused | done | archived
    total: number;
    stages: string[]; // stageOptions(chunks), for "Move to stage"
    onSetStatus: (label: string, status: string) => void;
    onRenameChunk: (label: string, next: string) => void;
    onMoveChunk: (label: string, dir: "up" | "down") => void;
    canMove: (label: string, dir: "up" | "down") => boolean;
    onMoveToStage: (label: string, stage: string) => void;
    onDeleteChunk: (label: string) => void;
    onRenameStage: (at: number, next: string) => void;
    onDeleteStage: (at: number) => void;
    onAddChunk: (label: string, stage: string, runAt: number | null) => void;
    onRename: (title: string) => void;
    onDetails: () => void;
    onActivity: (e: React.MouseEvent) => void;
    onTogglePause: () => void;
    onArchive: () => void;
    onUnarchive: () => void;
    onDelete: () => void;
};

type Editing = { id: string; draft: string } | null;

export function InitiativeDetail({
    rows,
    cursor,
    edits,
    onSelectChunk,
    onToggleStage,
}: {
    rows: DetailRow[];
    cursor: string | undefined;
    edits: TrackerEdits;
    onSelectChunk: (id: string) => void;
    onToggleStage: (id: string, open: boolean) => void;
}) {
    // one menu and one inline editor at a time, across every row of this plan
    // an atom, not local state: Escape closing it is a keybinding (jarvis:close-tracker-menu)
    const [menu, setMenu] = useAtom(trackerMenuAtom);
    const [editing, setEditing] = useState<Editing>(null);
    const [confirming, setConfirming] = useState(false);
    const [newStage, setNewStage] = useState<{ name: string; chunk: string | null } | null>(null);
    // a menu left open when the plan unmounts would hold Escape away from the surface
    useEffect(() => () => setMenu(null), [setMenu]);
    useEffect(() => {
        if (menu == null) {
            return;
        }
        const close = (e: Event) => {
            if ((e.target as Element | null)?.closest("[data-jarvis-tracker-menu]") == null) {
                setMenu(null);
            }
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [menu, setMenu]);

    if (rows.length === 0) {
        return null;
    }
    const startEdit = (id: string, draft: string) => {
        setMenu(null);
        setEditing({ id, draft });
    };
    const commitEdit = (apply: (next: string) => void, before: string) => {
        const next = editing?.draft.trim() ?? "";
        setEditing(null);
        if (next !== "" && next !== before) {
            apply(next);
        }
    };
    const renameInput = (id: string, before: string, apply: (next: string) => void, cls: string) =>
        editing?.id === id ? (
            <input
                autoFocus
                data-jarvis-rename-input
                value={editing.draft}
                onChange={(e) => setEditing({ id, draft: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => commitEdit(apply, before)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        commitEdit(apply, before);
                    } else if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditing(null);
                    }
                }}
                className={cn(
                    "min-w-0 flex-1 rounded-[5px] border border-accent/60 bg-background px-1.5 py-px text-primary outline-none",
                    cls
                )}
            />
        ) : null;
    // the last row each open stage header owns, so "+ Add chunk" lands at the end of the right run
    const addAfter = new Map<number, { stage: string; at: number }>();
    let openStage: Extract<DetailRow, { kind: "stage" }> | null = null;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.kind === "stage") {
            openStage = r.collapsed ? null : r;
        }
        if (openStage != null && (i + 1 === rows.length || rows[i + 1].kind === "stage")) {
            addAfter.set(i, openStage);
        }
    }
    // a flat plan has no header to own its run, so its one run ends at its last chunk
    if (!rows.some((r) => r.kind === "stage")) {
        const last = rows.map((r) => r.kind).lastIndexOf("chunk");
        if (last >= 0) {
            addAfter.set(last, { stage: "", at: 0 });
        }
    }

    return (
        // flush with the row above and sharing its corner radius, so an open initiative reads as one
        // card rather than a row with a second block stepped in beneath it
        <div
            data-jarvis-initiative-detail="true"
            className="mb-3 rounded-b-[10px] border border-t-0 border-border bg-surface pb-2.5 pl-2.5 pr-3.5 pt-3"
        >
            {rows.map((row, i) => {
                const tail = addAfter.get(i);
                const add =
                    tail != null ? (
                        <AddChunkRow
                            stage={tail.stage}
                            onAdd={(label) => edits.onAddChunk(label, tail.stage, tail.at)}
                        />
                    ) : null;
                if (row.kind === "pending") {
                    return (
                        <p key={row.id} className="px-1.5 py-2 text-[12px] leading-[1.55] text-muted">
                            {row.message}
                        </p>
                    );
                }
                // the row head above already reads the fraction, the next chunk and what is blocked; the
                // facts row only feeds the footer's count
                if (row.kind === "facts") {
                    return null;
                }
                if (row.kind === "stage") {
                    const menuId = row.id + "#menu";
                    return (
                        <Fragment key={row.id}>
                            <div
                                data-jarvis-tracker-stage={row.stage}
                                aria-expanded={!row.collapsed}
                                className={stageHeadClass(row.first)}
                            >
                                <button
                                    type="button"
                                    aria-label="Toggle stage"
                                    onClick={() => onToggleStage(row.id, row.collapsed)}
                                    className={cn(
                                        "flex w-3.5 flex-none cursor-pointer items-center justify-center text-ink-mid",
                                        FOCUS
                                    )}
                                >
                                    {row.collapsed ? (
                                        <ChevronRight size={12} aria-hidden />
                                    ) : (
                                        <ChevronDown size={12} aria-hidden />
                                    )}
                                </button>
                                {renameInput(
                                    row.id,
                                    row.stage,
                                    (next) => edits.onRenameStage(row.at, next),
                                    "text-[11.5px] font-semibold"
                                ) ?? (
                                    <button
                                        type="button"
                                        title="Double-click to rename"
                                        onClick={() => onToggleStage(row.id, row.collapsed)}
                                        onDoubleClick={() => startEdit(row.id, row.stage)}
                                        className={cn(
                                            "min-w-0 flex-1 cursor-pointer truncate text-left text-[11.5px] font-semibold text-primary",
                                            FOCUS
                                        )}
                                    >
                                        {row.stage === "" ? "unstaged" : row.stage}
                                    </button>
                                )}
                                <StageBar done={row.done} total={row.total} />
                                <span className="w-7 flex-none text-[10.5px] tabular-nums text-ink-mid">
                                    {row.fraction}
                                </span>
                                <button
                                    type="button"
                                    aria-label="Stage actions"
                                    onClick={() => setMenu(menu === menuId ? null : menuId)}
                                    className={cn(
                                        "flex h-5 w-[22px] flex-none cursor-pointer items-center justify-center rounded-[5px] border text-ink-mid hover:border-edge-mid hover:text-ink-hi",
                                        menu === menuId ? "border-edge-strong" : "border-transparent",
                                        FOCUS
                                    )}
                                >
                                    <Ellipsis size={14} aria-hidden />
                                </button>
                                {menu === menuId ? (
                                    <Menu className="right-1 top-[calc(100%-2px)] w-40">
                                        {/* the unstaged run has no name to rename or label to delete */}
                                        {row.stage === "" ? (
                                            <MenuItem onClick={() => startEdit(row.id, row.stage)}>
                                                Name this stage
                                            </MenuItem>
                                        ) : (
                                            <>
                                                <MenuItem onClick={() => startEdit(row.id, row.stage)}>
                                                    Rename stage
                                                </MenuItem>
                                                <MenuItem
                                                    danger
                                                    onClick={() => {
                                                        setMenu(null);
                                                        edits.onDeleteStage(row.at);
                                                    }}
                                                >
                                                    Delete stage
                                                </MenuItem>
                                            </>
                                        )}
                                    </Menu>
                                ) : null}
                            </div>
                            {add}
                        </Fragment>
                    );
                }
                const selected = cursor === row.id;
                const label = row.row.label;
                const due = chunkDueChip(row.row.due, row.row.status, localDay(new Date()));
                const menuId = row.id + "#menu";
                const otherStages = [...edits.stages, ""].filter((s) => s !== row.row.stage);
                return (
                    <Fragment key={row.id}>
                        <div className="relative">
                            <div
                                role="button"
                                tabIndex={-1}
                                aria-pressed={selected}
                                title="Click for notes · double-click to rename"
                                onClick={() => onSelectChunk(row.id)}
                                onDoubleClick={() => startEdit(row.id, label)}
                                data-jarvis-tracker-chunk={label}
                                className={cn(
                                    "my-px flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[6px] py-[5px] pl-[7px] pr-1.5 text-left",
                                    selected ? "bg-surface-selected" : "hover:bg-surface-hover"
                                )}
                            >
                                <ToneIcon tone={row.row.tone} />
                                {renameInput(
                                    row.id,
                                    label,
                                    (next) => edits.onRenameChunk(label, next),
                                    "text-[12px]"
                                ) ?? (
                                    <span
                                        className={cn(
                                            "min-w-0 flex-1 truncate text-[12px] leading-[1.4]",
                                            selected
                                                ? "font-semibold text-primary"
                                                : row.row.status === "active"
                                                  ? "font-medium text-ink-hi"
                                                  : row.row.status === "done" || row.row.status === "skipped"
                                                    ? "text-ink-mid"
                                                    : "text-ink-hi",
                                            row.row.status === "skipped" && "line-through"
                                        )}
                                    >
                                        {label}
                                    </span>
                                )}
                                {due != null ? (
                                    <span
                                        data-jarvis-chunk-due={row.row.due}
                                        title={due.come ? "Due: it waits in Needs you" : "The day it comes due"}
                                        className={cn(
                                            "flex-none text-[10.5px] tabular-nums",
                                            due.come ? "font-semibold text-asking" : "text-ink-mid"
                                        )}
                                    >
                                        {due.text}
                                    </span>
                                ) : null}
                                {row.notes > 0 ? (
                                    <span className="flex-none text-[10.5px] tabular-nums text-ink-mid">
                                        {row.notes} {row.notes === 1 ? "note" : "notes"}
                                    </span>
                                ) : null}
                                <button
                                    type="button"
                                    title="Change status"
                                    data-jarvis-chunk-status={row.row.status}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setMenu(menu === menuId ? null : menuId);
                                    }}
                                    className={cn(
                                        "flex w-[86px] flex-none cursor-pointer items-center justify-between gap-1 rounded-[5px] border px-[7px] py-0.5 text-[11px] font-medium hover:border-edge-mid",
                                        menu === menuId ? "border-edge-strong" : "border-border",
                                        TONE_FG[row.row.tone],
                                        FOCUS
                                    )}
                                >
                                    {row.row.status}
                                    <ChevronDown size={11} aria-hidden className="text-muted" />
                                </button>
                            </div>
                            {menu === menuId ? (
                                <Menu className="right-1 top-[calc(100%+2px)] w-[184px]">
                                    <MenuHead>Status</MenuHead>
                                    {STATUSES.map((s) => (
                                        <MenuItem
                                            key={s}
                                            active={s === row.row.status}
                                            glyph={<ToneIcon tone={chunkTone(s)} />}
                                            onClick={() => {
                                                setMenu(null);
                                                if (s !== row.row.status) {
                                                    edits.onSetStatus(label, s);
                                                }
                                            }}
                                        >
                                            {s}
                                        </MenuItem>
                                    ))}
                                    <MenuRule />
                                    <MenuItem onClick={() => startEdit(row.id, label)}>Rename</MenuItem>
                                    <MenuItem
                                        glyph={<ArrowUp size={12} aria-hidden />}
                                        hint="alt ↑"
                                        disabled={!edits.canMove(label, "up")}
                                        onClick={() => {
                                            setMenu(null);
                                            edits.onMoveChunk(label, "up");
                                        }}
                                    >
                                        Move up
                                    </MenuItem>
                                    <MenuItem
                                        glyph={<ArrowDown size={12} aria-hidden />}
                                        hint="alt ↓"
                                        disabled={!edits.canMove(label, "down")}
                                        onClick={() => {
                                            setMenu(null);
                                            edits.onMoveChunk(label, "down");
                                        }}
                                    >
                                        Move down
                                    </MenuItem>
                                    {otherStages.length > 0 ? (
                                        <>
                                            <MenuRule />
                                            <MenuHead>Move to stage</MenuHead>
                                            {otherStages.map((s) => (
                                                <MenuItem
                                                    key={s || "~"}
                                                    glyph={<ArrowRight size={12} aria-hidden />}
                                                    onClick={() => {
                                                        setMenu(null);
                                                        edits.onMoveToStage(label, s);
                                                    }}
                                                >
                                                    {s || "unstaged"}
                                                </MenuItem>
                                            ))}
                                        </>
                                    ) : null}
                                    <MenuRule />
                                    <MenuItem
                                        danger
                                        onClick={() => {
                                            setMenu(null);
                                            edits.onDeleteChunk(label);
                                        }}
                                    >
                                        Delete chunk
                                    </MenuItem>
                                </Menu>
                            ) : null}
                        </div>
                        {add}
                    </Fragment>
                );
            })}
            {newStage?.chunk != null ? (
                // a stage is a label on chunks, so this header is a placeholder until its first chunk lands
                <>
                    <div
                        data-jarvis-tracker-stage={newStage.name}
                        className={stageHeadClass(!rows.some((r) => r.kind === "stage"))}
                    >
                        <span className="flex w-3.5 flex-none justify-center text-ink-mid">
                            <ChevronDown size={12} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-primary">
                            {newStage.name}
                        </span>
                        <StageBar done={0} total={0} />
                        <span className="w-7 flex-none text-[10.5px] tabular-nums text-ink-mid">0/0</span>
                    </div>
                    <AddChunkRow
                        stage={newStage.name}
                        initialDraft=""
                        onAdd={(label) => {
                            edits.onAddChunk(label, newStage.name, null);
                            setNewStage(null);
                        }}
                        onCancel={() => setNewStage(null)}
                    />
                </>
            ) : null}
            <NewStageRow state={newStage} onChange={setNewStage} />
            <TrackerFooter
                facts={rows.find((r): r is Extract<DetailRow, { kind: "facts" }> => r.kind === "facts") ?? null}
                edits={edits}
                confirming={confirming}
                onConfirm={setConfirming}
            />
        </div>
    );
}

// An opened idea. It has no plan, so none of the plan's parts (stages, chunk rows, pause, the activity
// trail) apply: it offers the two ways to give it one. Plan it asks an agent for the chunks; the first chunk
// written here makes it an initiative, and it moves over to the cards.
export function IdeaDetail({
    jotted,
    edits,
    onPlan,
}: {
    jotted: string; // noteStamp of the effort's creation
    edits: TrackerEdits;
    onPlan: () => void;
}) {
    const [confirming, setConfirming] = useState(false);
    const archived = edits.effortStatus === "archived";
    const action = (name: string, label: string, run: () => void, danger = false) => (
        <button
            type="button"
            data-jarvis-idea-action={name}
            onClick={run}
            className={cn(SMALL_BUTTON, danger && "hover:border-error/50 hover:text-error", FOCUS)}
        >
            {label}
        </button>
    );
    return (
        <div data-jarvis-idea-detail="true" className="flex flex-col gap-1.5 px-2.5 pb-2.5 pt-0.5">
            <div className="flex items-center gap-2 pl-[22px]">
                <button
                    type="button"
                    data-jarvis-idea-action="plan"
                    title="Start an agent that breaks this idea into chunks"
                    onClick={onPlan}
                    className={cn(
                        "flex flex-none cursor-pointer items-center gap-1.5 rounded-[6px] border border-accent/45 bg-accentbg px-2.5 py-[3px] text-[10.5px] font-semibold text-accent-soft hover:text-accent-50",
                        FOCUS
                    )}
                >
                    <Sparkles size={11} aria-hidden />
                    Plan it
                </button>
                <span className="min-w-0 truncate text-[10.5px] text-ink-mid">an agent writes the chunks</span>
            </div>
            <div className="pl-[15px]">
                <AddChunkRow stage="" text="Add first chunk" onAdd={(label) => edits.onAddChunk(label, "", null)} />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-edge-faint pl-[22px] pt-2 text-[10.5px] tabular-nums text-ink-mid">
                {confirming ? (
                    <span data-jarvis-delete-confirm className="flex items-center gap-2">
                        <span className="text-[11.5px] text-error-soft">Delete this idea?</span>
                        <button
                            type="button"
                            onClick={() => setConfirming(false)}
                            className={cn(
                                "cursor-pointer rounded-[5px] border border-edge-mid bg-surface-raised px-2 py-0.5 text-secondary hover:text-primary",
                                FOCUS
                            )}
                        >
                            cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setConfirming(false);
                                edits.onDelete();
                            }}
                            className={cn(
                                "cursor-pointer rounded-[5px] bg-error px-[9px] py-[3px] font-bold text-background",
                                FOCUS
                            )}
                        >
                            delete
                        </button>
                    </span>
                ) : (
                    <>
                        <span>jotted {jotted}</span>
                        <span className="ml-auto flex items-center gap-1.5">
                            {action("rename", "rename", () => edits.onRename(edits.title))}
                            {archived
                                ? action("unarchive", "unarchive", edits.onUnarchive)
                                : action("archive", "archive", edits.onArchive, true)}
                            {action("delete", "delete", () => setConfirming(true), true)}
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}

function StageBar({ done, total }: { done: number; total: number }) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
        <span className="h-[3px] w-12 flex-none overflow-hidden rounded-sm bg-border">
            <span className="block h-full rounded-sm bg-success" style={{ width: `${pct}%` }} />
        </span>
    );
}

function Menu({ className, children }: { className: string; children: React.ReactNode }) {
    return (
        <div
            data-jarvis-tracker-menu
            onClick={(e) => e.stopPropagation()}
            className={cn(
                "absolute z-30 rounded-[8px] border border-edge-strong bg-surface-raised p-[5px] shadow-[0_12px_34px_var(--color-background)]",
                className
            )}
        >
            {children}
        </div>
    );
}

function MenuHead({ children }: { children: React.ReactNode }) {
    return (
        <div className="px-[7px] pb-[5px] pt-1 text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-mid">
            {children}
        </div>
    );
}

const MenuRule = () => <div className="mx-0.5 my-[5px] h-px bg-border" />;

function MenuItem({
    children,
    onClick,
    glyph,
    hint,
    active,
    danger,
    disabled,
}: {
    children: React.ReactNode;
    onClick: () => void;
    glyph?: React.ReactNode;
    hint?: string;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "flex w-full items-center gap-2 rounded-[5px] px-[7px] py-[5px] text-left text-[12px]",
                danger ? "text-error hover:bg-error/10" : "text-secondary hover:bg-surface-hover",
                active && "bg-surface-hover",
                disabled ? "cursor-default opacity-40" : "cursor-pointer",
                FOCUS
            )}
        >
            <span className="flex w-3 flex-none justify-center text-ink-mid">{glyph}</span>
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {hint != null ? <span className="font-mono text-[10.5px] text-muted">{hint}</span> : null}
        </button>
    );
}

// "+ Add chunk" at the end of a stage run: a button that becomes its own input
function AddChunkRow({
    stage,
    onAdd,
    onCancel,
    initialDraft = null,
    text = "Add chunk",
}: {
    stage: string;
    onAdd: (label: string) => void;
    onCancel?: () => void;
    initialDraft?: string | null;
    text?: string;
}) {
    const [draft, setDraft] = useState<string | null>(initialDraft);
    if (draft == null) {
        return (
            <button
                type="button"
                data-jarvis-add-chunk
                onClick={() => setDraft("")}
                className={cn(
                    "flex cursor-pointer items-center gap-2 px-[7px] py-1 text-[11.5px] font-medium text-ink-mid hover:text-accent-soft",
                    FOCUS
                )}
            >
                <Plus size={12} aria-hidden className="w-3 flex-none text-ink-mid" />
                {text}
            </button>
        );
    }
    const leave = () => {
        setDraft(null);
        onCancel?.();
    };
    const commit = () => {
        const label = draft.trim();
        if (label === "") {
            leave();
            return;
        }
        setDraft(null);
        onAdd(label);
    };
    return (
        <div className="flex items-center gap-2 py-[3px] pl-[7px] pr-1.5">
            <Plus size={12} aria-hidden className="w-3 flex-none text-muted" />
            <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && draft.trim() !== "") {
                        commit();
                    } else if (e.key === "Escape") {
                        e.stopPropagation();
                        leave();
                    }
                }}
                placeholder={
                    stage ? `add to ${stage} · enter to add, esc to stop` : "chunk label · enter to add, esc to stop"
                }
                aria-label="New chunk label"
                className="min-w-0 flex-1 rounded-[5px] border border-edge-mid bg-background px-[7px] py-[3px] text-[12px] text-primary outline-none focus:border-accent/60"
            />
            <span className="font-mono text-[10.5px] text-muted">enter · esc</span>
        </div>
    );
}

// a stage is a label on chunks, so it exists only once its first chunk does: the name set here heads a
// placeholder stage that InitiativeDetail draws, and its first chunk is added there
function NewStageRow({
    state,
    onChange,
}: {
    state: { name: string; chunk: string | null } | null;
    onChange: (s: { name: string; chunk: string | null } | null) => void;
}) {
    return (
        <div className="mt-2.5 border-t border-edge-faint px-[5px] pt-2">
            {state == null || state.chunk != null ? (
                <button
                    type="button"
                    data-jarvis-new-stage
                    onClick={() => onChange({ name: "", chunk: null })}
                    className={cn(
                        "flex cursor-pointer items-center gap-2 px-0.5 py-0.5 text-[11.5px] font-semibold text-ink-mid hover:text-accent-soft",
                        FOCUS
                    )}
                >
                    <Plus size={12} aria-hidden className="w-3 flex-none" />
                    New stage
                </button>
            ) : (
                <div className="flex items-center gap-2">
                    <input
                        autoFocus
                        value={state.name}
                        onChange={(e) => onChange({ name: e.target.value, chunk: null })}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && state.name.trim() !== "") {
                                onChange({ name: state.name.trim(), chunk: "" });
                            } else if (e.key === "Escape") {
                                e.stopPropagation();
                                onChange(null);
                            }
                        }}
                        placeholder="Stage name · enter, then add its first chunk"
                        className="min-w-0 flex-1 rounded-[5px] border border-edge-mid bg-background px-[7px] py-[3px] text-[11.5px] font-semibold text-primary outline-none focus:border-accent/60"
                    />
                    <span className="font-mono text-[10.5px] text-muted">enter · esc</span>
                </div>
            )}
        </div>
    );
}

function TrackerFooter({
    facts,
    edits,
    confirming,
    onConfirm,
}: {
    facts: Extract<DetailRow, { kind: "facts" }> | null;
    edits: TrackerEdits;
    confirming: boolean;
    onConfirm: (on: boolean) => void;
}) {
    const archived = edits.effortStatus === "archived";
    const action = (name: string, label: string, run: (e: React.MouseEvent) => void, danger = false, peek = false) => (
        <button
            type="button"
            data-jarvis-initiative-action={name}
            data-peek={peek ? "" : undefined}
            onClick={run}
            className={cn(SMALL_BUTTON, danger && "hover:border-error/50 hover:text-error", FOCUS)}
        >
            {label}
        </button>
    );
    return (
        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-edge-faint px-1.5 pt-2.5 text-[10.5px] tabular-nums text-ink-mid">
            {/* the id is what you paste into a prompt or a `wsh effort` call, and a span is the one
                thing you cannot lift out of a row you can click */}
            <button
                type="button"
                title="copy this initiative's id"
                onClick={() => void navigator.clipboard?.writeText(edits.oid)}
                className={cn("cursor-pointer font-mono hover:text-ink-hi", FOCUS)}
            >
                {edits.oid.slice(0, 8)}
            </button>
            {facts != null ? <span>{facts.count}</span> : null}
            {confirming ? (
                <span
                    data-jarvis-delete-confirm
                    className="ml-auto flex items-center gap-2 rounded-[7px] border border-error/40 bg-error/10 py-[3px] pl-2.5 pr-1"
                >
                    <span className="font-sans text-[11.5px] text-error-soft">
                        Delete this initiative, its {edits.total} chunks and their notes?
                    </span>
                    <button
                        type="button"
                        onClick={() => onConfirm(false)}
                        className={cn(
                            "cursor-pointer rounded-[5px] border border-edge-mid bg-surface-raised px-2 py-0.5 text-[10.5px] text-secondary hover:text-primary",
                            FOCUS
                        )}
                    >
                        cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            onConfirm(false);
                            edits.onDelete();
                        }}
                        className={cn(
                            "cursor-pointer rounded-[5px] bg-error px-[9px] py-[3px] font-bold text-background",
                            FOCUS
                        )}
                    >
                        delete
                    </button>
                </span>
            ) : (
                <span className="ml-auto flex items-center gap-1.5">
                    {action("rename", "rename", () => edits.onRename(edits.title))}
                    {action("details", "details", edits.onDetails)}
                    {action("activity", "activity", edits.onActivity, false, true)}
                    {archived
                        ? action("unarchive", "unarchive", edits.onUnarchive)
                        : action("pause", edits.effortStatus === "paused" ? "resume" : "pause", edits.onTogglePause)}
                    {archived ? null : action("archive", "archive", edits.onArchive, true)}
                    {action("delete", "delete", () => onConfirm(true), true)}
                </span>
            )}
        </div>
    );
}
