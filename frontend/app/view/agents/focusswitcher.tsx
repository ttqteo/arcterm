// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { selectSubject } from "@/app/view/jarvis/jarvissubjectstore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Bot, Check, ChevronDown, Crosshair, GitBranch, ListChecks, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentState } from "./agentsviewmodel";
import { activeFocusAtom, enterFocusFor, exitFocus, focusesAtom, loadFocuses, type FocusKind } from "./focusstore";
import { buildFocusSections, moveFocusCursor, type FocusRowVM } from "./focusswitchermodel";

const KIND_ICON: Record<FocusKind, LucideIcon> = { agent: Bot, run: GitBranch, task: ListChecks };

// status is never color alone: every dot travels with its word
const STATUS: Record<AgentState, { word: string; dot: string; text: string }> = {
    working: { word: "working", dot: "bg-working", text: "text-working" },
    asking: { word: "asking", dot: "bg-asking", text: "text-asking" },
    idle: { word: "ready", dot: "bg-muted", text: "text-ink-mid" },
};

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const INLINE_ACTION =
    "shrink-0 cursor-pointer rounded-sm px-1.5 py-0.5 text-[12px] font-medium text-accent-soft hover:text-accent-100 " +
    FOCUS_RING;

function FocusRow({
    row,
    selected,
    cursor,
    onPick,
    onHover,
}: {
    row: FocusRowVM;
    selected: boolean;
    cursor: boolean;
    onPick: () => void;
    onHover: () => void;
}) {
    const status = row.status ? STATUS[row.status] : null;
    const hasSecondLine = row.detail !== "" || row.meta !== "";
    return (
        <button
            type="button"
            data-focus-row={row.key}
            onClick={onPick}
            onMouseMove={onHover}
            className={cn(
                "flex w-full cursor-pointer items-start gap-2.5 rounded-sm px-2 py-[7px] text-left",
                selected ? "bg-surface-selected" : cursor && "bg-surface-hover",
                selected && cursor && "ring-1 ring-inset ring-accent/40"
            )}
        >
            <span className={cn("mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full", status?.dot)} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary">{row.label}</span>
                    {status ? <span className={cn("text-[11px] font-medium", status.text)}>{status.word}</span> : null}
                    {row.paused ? (
                        <span className="rounded-full bg-pill px-[7px] py-px text-[10.5px] text-ink-mid">paused</span>
                    ) : null}
                </span>
                {hasSecondLine ? (
                    <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{row.detail}</span>
                        {row.meta ? <span className="text-[10.5px] tabular-nums text-muted">{row.meta}</span> : null}
                    </span>
                ) : null}
            </span>
            <span className="mt-[3px] w-3.5 shrink-0 text-accent">
                {selected ? <Check size={14} strokeWidth={2.2} /> : null}
            </span>
        </button>
    );
}

// App-bar focus (Presence C) switcher. Unfocused it reads "Focus", so the control names itself; focused
// it is a chip with the target's kind, its label and a one-click clear. The dropdown filters as you
// type and walks with the arrow keys; "Open dossier" puts a focused task's record on the Jarvis Stage.
export function FocusSwitcher({ model }: { model: AgentsViewModel }) {
    const active = useAtomValue(activeFocusAtom);
    const spaces = useAtomValue(focusesAtom);
    const agents = useAtomValue(model.agentsAtom);
    const projectFilter = useAtomValue(model.projectFilterAtom);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [cursor, setCursor] = useState<string | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const activeKey = active ? `${active.ref.kind}:${active.ref.id}` : null;
    const sections = useMemo(
        () => buildFocusSections(agents, spaces, query, projectFilter),
        [agents, spaces, query, projectFilter]
    );
    const rows = sections.flatMap((s) => s.rows);
    const keys = rows.map((r) => r.key);
    // a cursor the filter removed falls back to the first match, so Enter always has a target
    const cursorKey = cursor != null && keys.includes(cursor) ? cursor : (keys[0] ?? null);

    useEffect(() => {
        if (!open || cursorKey == null) {
            return;
        }
        listRef.current
            ?.querySelector(`[data-focus-row="${CSS.escape(cursorKey)}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [open, cursorKey]);

    const close = () => {
        setOpen(false);
        setQuery("");
    };
    const toggle = () => {
        if (open) {
            close();
            return;
        }
        loadFocuses();
        setCursor(activeKey);
        setOpen(true);
    };
    const choose = (r: FocusRowVM) => {
        enterFocusFor(model, { ref: { kind: r.kind, id: r.id }, label: r.label, project: r.project });
        close();
    };
    const clear = () => {
        exitFocus();
        close();
    };
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setCursor(moveFocusCursor(keys, cursorKey, e.key === "ArrowDown" ? 1 : -1));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const r = rows.find((x) => x.key === cursorKey);
            if (r) {
                choose(r);
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            close();
            triggerRef.current?.focus();
        }
    };

    const KindIcon = active ? KIND_ICON[active.ref.kind] : null;
    return (
        <div className="relative">
            {active == null ? (
                <button
                    ref={triggerRef}
                    type="button"
                    data-focus-switcher
                    onClick={toggle}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    title="Narrow the cockpit to one agent, run or task"
                    className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-sm border border-dashed border-edge-strong px-2 py-[3px] text-[13px] font-medium text-ink-mid hover:bg-surface-hover hover:text-primary",
                        FOCUS_RING
                    )}
                >
                    <Crosshair size={13} strokeWidth={1.8} />
                    Focus
                    <ChevronDown size={12} className="text-muted" />
                </button>
            ) : (
                <div className="flex items-center rounded-sm border border-accent/30 bg-accentbg">
                    <button
                        ref={triggerRef}
                        type="button"
                        data-focus-switcher
                        onClick={toggle}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        title={`Focused on ${active.ref.kind}: ${active.label}`}
                        className={cn(
                            "flex cursor-pointer items-center gap-[7px] rounded-sm py-[3px] pl-2 pr-1.5 text-[13px] font-medium text-primary",
                            FOCUS_RING
                        )}
                    >
                        {KindIcon ? (
                            <KindIcon size={13} strokeWidth={1.8} className="shrink-0 text-accent-soft" />
                        ) : null}
                        <span className="max-w-[220px] truncate">{active.label}</span>
                        <ChevronDown size={12} className="shrink-0 text-accent-soft" />
                    </button>
                    <span className="h-3.5 w-px bg-accent/30" />
                    <button
                        type="button"
                        onClick={clear}
                        aria-label="Clear focus"
                        title="Clear focus"
                        className={cn(
                            "flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm text-accent-soft hover:text-primary",
                            FOCUS_RING
                        )}
                    >
                        <X size={11} strokeWidth={2.2} />
                    </button>
                </div>
            )}
            {open ? <div className="fixed inset-0 z-50" onClick={close} /> : null}
            <PopoverReveal
                open={open}
                origin="top left"
                className="absolute left-0 top-[calc(100%+7px)] z-[60] flex w-[372px] flex-col overflow-hidden rounded-lg border border-edge-strong bg-surface-raised shadow-popover"
            >
                <div role="dialog" aria-label="Focus on" className="flex flex-col">
                    <div className="flex flex-col gap-1 px-3.5 pb-2.5 pt-3">
                        <span className={cn(REGION_LABEL, "text-muted")}>Focus on</span>
                        <span className="text-[12px] leading-[1.45] text-ink-mid">
                            Cockpit and History hide everything outside it. Agent, Diff and Code open on it.
                        </span>
                    </div>
                    <label className="mx-2.5 mb-1.5 flex items-center gap-2 rounded-[8px] border border-edge-strong bg-surface px-2.5 py-[7px] text-muted focus-within:border-accent/60">
                        <Search size={13} strokeWidth={1.8} className="shrink-0" />
                        <input
                            autoFocus
                            type="text"
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setCursor(null);
                            }}
                            onKeyDown={onKeyDown}
                            aria-label="Filter agents, runs and tasks"
                            placeholder="Filter agents, runs and tasks"
                            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-primary outline-none placeholder:text-muted"
                        />
                    </label>
                    {active != null ? (
                        <div className="mx-2.5 mb-1.5 flex items-center gap-2 rounded-[8px] bg-surface-selected px-2.5 py-2">
                            <span className="shrink-0 text-[12px] text-ink-mid">Focused on</span>
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-primary">
                                {active.label}
                            </span>
                            {active.ref.kind === "task" ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        selectSubject({ kind: "dossier", id: active.ref.id });
                                        globalStore.set(model.surfaceAtom, "jarvis");
                                        close();
                                    }}
                                    className={INLINE_ACTION}
                                >
                                    Open dossier
                                </button>
                            ) : null}
                            <button type="button" onClick={clear} className={INLINE_ACTION}>
                                Clear
                            </button>
                        </div>
                    ) : null}
                    <div ref={listRef} className="flex max-h-[46vh] flex-col overflow-y-auto px-1.5 pb-1.5">
                        {sections.map((s) => {
                            const Icon = KIND_ICON[s.kind];
                            return (
                                <div key={s.kind} className="flex flex-col">
                                    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2.5 text-muted">
                                        <Icon size={12} strokeWidth={1.8} />
                                        <span className={REGION_LABEL}>{s.title}</span>
                                        <span className="text-[10.5px] tabular-nums">{s.rows.length}</span>
                                    </div>
                                    {s.rows.map((r) => (
                                        <FocusRow
                                            key={r.key}
                                            row={r}
                                            selected={r.key === activeKey}
                                            cursor={r.key === cursorKey}
                                            onPick={() => choose(r)}
                                            onHover={() => setCursor(r.key)}
                                        />
                                    ))}
                                </div>
                            );
                        })}
                        {sections.length === 0 ? (
                            <div className="px-2.5 py-3.5 text-[12px] text-muted">
                                {query.trim() !== ""
                                    ? `Nothing matches “${query.trim()}”.`
                                    : "Nothing to focus on yet. Agents, runs and tasks show up here once they start."}
                            </div>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-3.5 border-t border-edge-mid px-3.5 py-2 text-[10.5px] text-muted">
                        <span>
                            <span className="font-mono text-ink-mid">↑↓</span> move
                        </span>
                        <span>
                            <span className="font-mono text-ink-mid">Enter</span> focus
                        </span>
                        <span>
                            <span className="font-mono text-ink-mid">Esc</span> close
                        </span>
                    </div>
                </div>
            </PopoverReveal>
        </div>
    );
}
