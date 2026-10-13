// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Resource Manager popover: Arc's and every agent's process tree, with kill actions for the processes an
// agent started. Mounted once in the shell, so its keys and its open state survive a surface switch. Non-modal:
// no backdrop, and a pointerdown anywhere else closes it while still reaching what it lands on.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { buildResMonBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { capacityChipLabel } from "@/app/view/agents/workercapacity";
import { useWorkerCapacity } from "@/app/view/agents/workercapacitystore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronRight, CircleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    busyWords,
    fmtAge,
    fmtCpu,
    fmtMem,
    groupView,
    isExpanded,
    killChildrenConfirmText,
    killChildrenTargets,
    killConfirmText,
    MORE_ROW,
    orderGroups,
    ownerKindWords,
    rowLabel,
    subtreeSize,
    type ResMonLine,
    type ResMonUi,
    type ResMonView,
} from "./resmon";
import {
    confirmResMon,
    dispatchResMon,
    resmonOpenAtom,
    resmonOpener,
    resmonSnapshotAtom,
    resmonUiAtom,
} from "./resmonstore";

// no PID column: a row's pid is in its tooltip and in every kill confirm
const GRID = "grid grid-cols-[minmax(0,1fr)_64px_64px_76px_84px] items-center px-3.5";
const INDENT_PX = 14;
const WIDTH_PX = 700;
// the popover's top edge sits this far below the RAM chip that opened it
const ANCHOR_GAP_PX = 6;
const MAX_HEIGHT_PX = 760;
// the nearest it comes to the window's edges
const EDGE_PX = 8;
const HINTS: [string, string][] = [
    ["↑↓", "move"],
    ["⏎", "expand"],
    ["x", "kill"],
    ["⇧X", "kill children"],
    ["esc", "close"],
];

function count(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "es"}`;
}

function owners(n: number): string {
    return `${n} owner${n === 1 ? "" : "s"}`;
}

function swatchClass(g: ResMonGroup): string {
    if (g.ownerkind === "arc") {
        return "bg-secondary";
    }
    if (g.ownerkind !== "runcmd" && g.runtime === "claude") {
        return "bg-rt-claude";
    }
    if (g.ownerkind !== "runcmd" && g.runtime === "pi") {
        return "bg-rt-pi";
    }
    // a run command, or a plain terminal tab
    return "bg-ink-mid";
}

// the RAM chip the popover hangs from: the one clicked, else the app bar's (a `g m` open)
function anchorChip(): HTMLElement | null {
    const clicked = resmonOpener();
    if (clicked != null && clicked.getBoundingClientRect().height > 0) {
        return clicked;
    }
    const chip = document.querySelector<HTMLElement>("[data-resmon-readout]");
    return chip != null && chip.getBoundingClientRect().height > 0 ? chip : null;
}

// below the chip, its right edge on the chip's, kept inside the window
function measureAnchor(): { top: number; right: number; maxHeight: number } {
    const chip = anchorChip()?.getBoundingClientRect();
    const top = chip ? chip.bottom + ANCHOR_GAP_PX : 44;
    const widest = Math.max(EDGE_PX, window.innerWidth - WIDTH_PX - EDGE_PX);
    const right = chip ? Math.min(Math.max(window.innerWidth - chip.right, EDGE_PX), widest) : 12;
    return { top, right, maxHeight: Math.min(MAX_HEIGHT_PX, window.innerHeight - top - EDGE_PX) };
}

function ConfirmRow({ text, verb, className }: { text: string; verb: string; className?: string }) {
    return (
        <div
            data-resmon-confirm=""
            className={cn(
                "flex items-center gap-2.5 rounded-md border border-error/30 bg-error/10 px-2.5 text-[12px]",
                className
            )}
        >
            <span className="min-w-0 flex-1 text-error-soft">{text}</span>
            <button
                type="button"
                onClick={() => void confirmResMon()}
                className="h-[22px] cursor-pointer rounded-[5px] border border-error/45 bg-error/15 px-2.5 text-[11.5px] font-semibold text-error-soft hover:bg-error/20"
            >
                {verb}
            </button>
            <button
                type="button"
                onClick={() => dispatchResMon({ type: "cancel" })}
                className="h-[22px] cursor-pointer rounded-[5px] border border-edge-mid bg-surface-raised px-2.5 text-[11.5px] text-ink-mid hover:border-edge-strong"
            >
                Cancel
            </button>
        </div>
    );
}

function Note({ note }: { note: ResMonUi["notes"][string] }) {
    if (note.tone === "note") {
        return (
            <div role="status" className="mb-1.5 ml-[34px] mr-3.5 text-[11.5px] text-muted">
                {note.text}
            </div>
        );
    }
    return (
        <div
            role="alert"
            className="mx-2.5 mb-2 flex items-center gap-2 rounded-md border border-error/30 bg-error/10 px-2.5 py-[7px] text-[12px] text-error-soft"
        >
            <CircleAlert size={13} strokeWidth={2} aria-hidden className="shrink-0 text-error" />
            {note.text}
        </div>
    );
}

function ProcessRow({ g, line, ui, now }: { g: ResMonGroup; line: ResMonLine; ui: ResMonUi; now: number }) {
    const { row, index, depth } = line;
    const c = ui.confirm;
    if (c?.kind === "row" && c.key === g.key && c.pid === row.pid) {
        return (
            <ConfirmRow
                text={killConfirmText(row, subtreeSize(g.rows, index))}
                verb="Kill"
                className="mx-2.5 my-0.5 py-1.5"
            />
        );
    }
    const at = `${g.key}/${row.pid}`;
    const label = rowLabel(row);
    const cursor = ui.cursor === at;
    return (
        <div
            data-resmon-row={row.pid}
            data-resmon-cursor={cursor ? "" : undefined}
            title={`pid ${row.pid}`}
            className={cn(GRID, "h-7", cursor && "bg-surface-selected")}
        >
            <span className="flex min-w-0 items-baseline gap-2" style={{ paddingLeft: depth * INDENT_PX }}>
                <span className="w-2.5 shrink-0 text-[11px] text-ink-faint">{depth > 0 ? "└" : ""}</span>
                <span className="whitespace-nowrap text-[12px] text-secondary">{label.name}</span>
                <span className="truncate text-[11px] text-muted">{label.cmd}</span>
            </span>
            <span className="text-right tabular-nums text-[11px] text-ink-mid">{fmtAge(row.createts ?? 0, now)}</span>
            <span className="text-right tabular-nums text-[12px] text-primary">{fmtCpu(row.cpu)}</span>
            <span className="text-right tabular-nums text-[12px] text-secondary">{fmtMem(row.mem)}</span>
            <span className="flex justify-end">
                {row.tag ? (
                    <span className="rounded-[4px] bg-white/[0.05] px-1.5 py-px text-[10.5px] text-muted">
                        {row.tag}
                    </span>
                ) : g.killable ? (
                    <button
                        type="button"
                        aria-label={`Kill ${label.name} (${row.pid})`}
                        onClick={() => dispatchResMon({ type: "askKill", groups: orderGroups(currentGroups()), at })}
                        className="flex h-5 w-[22px] cursor-pointer items-center justify-center rounded-[5px] border border-edge-mid bg-surface-raised text-ink-mid hover:border-edge-strong hover:text-secondary"
                    >
                        <X size={11} strokeWidth={2.4} aria-hidden />
                    </button>
                ) : null}
            </span>
        </div>
    );
}

// the line under a group's rows that swaps its compact view for the whole tree and back
function MoreRow({ g, view, ui }: { g: ResMonGroup; view: ResMonView; ui: ResMonUi }) {
    const cursor = ui.cursor === `${g.key}/${MORE_ROW}`;
    const what = `${view.hidden} helper ${view.hidden === 1 ? "process" : "processes"}`;
    return (
        <div
            data-resmon-more=""
            data-resmon-cursor={cursor ? "" : undefined}
            className={cn(GRID, "h-7", cursor && "bg-surface-selected")}
        >
            <button
                type="button"
                title="Launchers, consoles, wsh, and the shells that only wrap a command"
                onClick={() => dispatchResMon({ type: "toggleFull", groups: orderGroups(currentGroups()), key: g.key })}
                className="flex min-w-0 cursor-pointer items-baseline gap-2 text-left text-[11.5px] text-muted hover:text-secondary"
                style={{ paddingLeft: INDENT_PX }}
            >
                <span className="w-2.5 shrink-0" />
                {view.full ? `Hide ${what}` : `+ ${what}`}
            </button>
            <span />
            <span className="text-right tabular-nums text-[11px] text-muted">
                {view.full ? "" : fmtCpu(view.hiddenCpu)}
            </span>
            <span className="text-right tabular-nums text-[11px] text-muted">
                {view.full ? "" : fmtMem(view.hiddenMem)}
            </span>
            <span />
        </div>
    );
}

function currentGroups(): ResMonGroup[] {
    return globalStore.get(resmonSnapshotAtom)?.groups ?? [];
}

function GroupBlock({ g, ui, now }: { g: ResMonGroup; ui: ResMonUi; now: number }) {
    const expanded = isExpanded(ui, g);
    const view = groupView(g, ui);
    const targets = killChildrenTargets(g);
    const groupConfirm = ui.confirm?.kind === "group" && ui.confirm.key === g.key;
    const note = ui.notes[g.key];
    const cursor = ui.cursor === g.key;
    return (
        <div data-resmon-group={g.key} className="border-b border-border">
            <div
                data-resmon-cursor={cursor ? "" : undefined}
                className={cn(GRID, "h-[34px]", cursor && "bg-surface-selected")}
            >
                <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => dispatchResMon({ type: "toggle", groups: orderGroups(currentGroups()), key: g.key })}
                    className="flex min-w-0 cursor-pointer items-center gap-2 text-left"
                >
                    <ChevronRight
                        size={12}
                        strokeWidth={2.2}
                        aria-hidden
                        className={cn("shrink-0 text-ink-mid transition-transform", expanded && "rotate-90")}
                    />
                    <span className={cn("h-2 w-2 shrink-0 rounded-[2px]", swatchClass(g))} />
                    {/* the label is what tells groups apart, so the kind words give way first */}
                    <span className="max-w-full shrink-0 truncate text-[12.5px] font-semibold text-primary">
                        {g.label}
                    </span>
                    <span className="min-w-0 truncate text-[11px] text-muted">
                        {ownerKindWords(g.ownerkind)} · {count(g.rows.length, "process")}
                    </span>
                </button>
                <span />
                <span className="text-right tabular-nums text-[12px] font-medium text-primary">{fmtCpu(g.cpu)}</span>
                <span className="text-right tabular-nums text-[12px] text-secondary">{fmtMem(g.mem)}</span>
                <span className="flex justify-end">
                    {g.killable && targets.length > 0 && (
                        <button
                            type="button"
                            onClick={() =>
                                dispatchResMon({ type: "askChildren", groups: orderGroups(currentGroups()), at: g.key })
                            }
                            className="h-5 cursor-pointer whitespace-nowrap rounded-[5px] border border-edge-mid bg-surface-raised px-[7px] text-[11px] text-ink-mid hover:border-edge-strong hover:bg-surface-hover hover:text-secondary"
                        >
                            Kill children
                        </button>
                    )}
                </span>
            </div>
            {groupConfirm && (
                <ConfirmRow
                    text={killChildrenConfirmText(g)}
                    verb={`Kill ${targets.length}`}
                    className="mx-2.5 mb-2 py-2"
                />
            )}
            {note && <Note note={note} />}
            {expanded && (
                <div className="pb-1.5">
                    {view.lines.map((line) => (
                        <ProcessRow key={line.row.pid} g={g} line={line} ui={ui} now={now} />
                    ))}
                    {view.hidden > 0 && <MoreRow g={g} view={view} ui={ui} />}
                </div>
            )}
        </div>
    );
}

export function ResMonPopover({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(resmonOpenAtom);
    const snap = useAtomValue(resmonSnapshotAtom);
    const ui = useAtomValue(resmonUiAtom);
    const cap = useWorkerCapacity();
    const bindings = useMemo(() => buildResMonBindings(model), [model]);
    useKeybindings(bindings);
    const visible = open && (snap == null || snap.supported);
    const panelRef = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState({ top: 44, right: 12, maxHeight: MAX_HEIGHT_PX });

    useEffect(() => {
        if (!open) {
            dispatchResMon({ type: "close" });
        }
    }, [open]);

    useLayoutEffect(() => {
        if (!visible) {
            return;
        }
        const measure = () => setAnchor(measureAnchor());
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [visible, snap]);

    // the popover's keys need focus outside a field: opened from the agent terminal, the xterm would keep it
    useEffect(() => {
        if (!visible) {
            return;
        }
        const prev = document.activeElement as HTMLElement | null;
        panelRef.current?.focus({ preventScroll: true });
        const onDown = (e: PointerEvent) => {
            const t = e.target as Element | null;
            if (t?.closest?.("[data-resmon-popover], [data-resmon-readout]") == null) {
                globalStore.set(resmonOpenAtom, false);
            }
        };
        window.addEventListener("pointerdown", onDown, true);
        return () => {
            window.removeEventListener("pointerdown", onDown, true);
            // an outside click already moved focus where the user wanted it; only an Escape close hands it back
            const active = document.activeElement;
            if (
                prev?.isConnected &&
                (active == null || active === document.body || panelRef.current?.contains(active))
            ) {
                prev.focus({ preventScroll: true });
            }
        };
    }, [visible]);

    useEffect(() => {
        panelRef.current?.querySelector("[data-resmon-cursor]")?.scrollIntoView({ block: "nearest" });
    }, [ui.cursor]);

    const loading = snap == null || !snap.ready;
    const groups = loading ? [] : orderGroups(snap.groups);
    const empty = groups.every((g) => g.ownerkind === "arc");
    const procs = groups.reduce((n, g) => n + g.rows.length, 0);
    const now = snap?.ts || Date.now();
    const busy = loading ? null : busyWords(snap);

    // above the avatar (z-60), which sits in the same corner; below the modals (z-70)
    return (
        <div className="pointer-events-none fixed z-[65]" style={{ top: anchor.top, right: anchor.right }}>
            <PopoverReveal open={visible} origin="top right" className="pointer-events-auto">
                <div
                    ref={panelRef}
                    tabIndex={-1}
                    role="dialog"
                    aria-label="Resource Manager"
                    data-resmon-popover=""
                    style={{ maxHeight: anchor.maxHeight }}
                    className="flex w-[700px] flex-col overflow-hidden rounded-[10px] border border-edge-mid bg-surface-raised shadow-popover outline-none"
                >
                    <div className="flex items-baseline gap-2.5 px-3.5 pb-2.5 pt-3">
                        <span className="text-[13.5px] font-semibold text-primary">Resource Manager</span>
                        {!loading && (
                            <span className="text-[11.5px] text-muted">
                                {owners(groups.length)} · {count(procs, "process")}
                            </span>
                        )}
                        {/* the totals the footer readout used to carry, and the free RAM the chip shows */}
                        {!loading && (
                            <span
                                data-resmon-totals=""
                                className={cn("ml-auto text-[11.5px]", busy ? "text-warning-soft" : "text-muted")}
                            >
                                Arc{" "}
                                <span className={cn("tabular-nums", !busy && "text-primary")}>
                                    {fmtCpu(snap.cpu, 0)}
                                </span>{" "}
                                CPU ·{" "}
                                <span className={cn("tabular-nums", !busy && "text-primary")}>{fmtMem(snap.mem)}</span>
                                {busy ? <span className="font-semibold text-warning"> · {busy}</span> : null}
                                {cap != null ? ` · ${capacityChipLabel(cap)}` : null}
                            </span>
                        )}
                        <span className={cn("text-[11.5px] text-muted", loading && "ml-auto")}>every 2s</span>
                    </div>
                    {loading ? (
                        <div
                            role="status"
                            className="border-t border-border px-3.5 pb-8 pt-7 text-center text-[12px] text-muted"
                        >
                            Reading agent processes…
                        </div>
                    ) : (
                        <>
                            <div className={cn(GRID, "h-6 border-y border-border text-[10.5px] text-muted")}>
                                <span>Process</span>
                                <span className="text-right">Running</span>
                                <span className="text-right">CPU</span>
                                <span className="text-right">Memory</span>
                                <span />
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto">
                                {groups.map((g) => (
                                    <GroupBlock key={g.key} g={g} ui={ui} now={now} />
                                ))}
                                {empty && (
                                    <div className="flex flex-col items-center gap-1 px-3.5 pb-6 pt-5">
                                        <span className="text-[12.5px] text-secondary">No agent processes</span>
                                        <span className="text-[11.5px] text-muted">
                                            Agent tabs, run workers and run commands show here while they run.
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div className="flex h-[30px] shrink-0 items-center gap-3.5 border-t border-border px-3.5 text-[11.5px] text-muted">
                                {HINTS.map(([k, label]) => (
                                    <span key={k} className="flex items-center gap-[5px]">
                                        <span className="rounded-[5px] border border-edge-mid px-[5px] font-mono text-[10.5px] text-primary">
                                            {k}
                                        </span>
                                        {label}
                                    </span>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </PopoverReveal>
        </div>
    );
}
