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
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronRight, CircleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    fmtAge,
    fmtCpu,
    fmtMem,
    isExpanded,
    killChildrenConfirmText,
    killChildrenTargets,
    killConfirmText,
    orderGroups,
    ownerKindWords,
    rowLabel,
    subtreeSize,
    type ResMonUi,
} from "./resmon";
import { resmonOpener } from "./resmonreadout";
import { confirmResMon, dispatchResMon, resmonOpenAtom, resmonSnapshotAtom, resmonUiAtom } from "./resmonstore";

const GRID = "grid grid-cols-[minmax(0,1fr)_60px_64px_64px_76px_84px] items-center px-3.5";
const INDENT_PX = 14;
// the popover's bottom edge sits this far above the readout that opened it
const ANCHOR_GAP_PX = 6;
const MAX_HEIGHT_PX = 760;
const TOP_MARGIN_PX = 12;
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

// the readout the popover hangs from: the one clicked, else whichever is on screen (a `g m` open)
function anchorReadout(): HTMLElement | null {
    const clicked = resmonOpener();
    if (clicked != null && clicked.getBoundingClientRect().height > 0) {
        return clicked;
    }
    const all = [...document.querySelectorAll<HTMLElement>("[data-resmon-readout]")];
    return all.reverse().find((el) => el.getBoundingClientRect().height > 0) ?? null;
}

// 6px above the readout, and never over the bar it sits in: the Cockpit's hints bar is taller than the footer
function measureAnchor(): { bottom: number; maxHeight: number } {
    const readout = anchorReadout();
    const top = readout
        ? Math.min(
              readout.getBoundingClientRect().top - ANCHOR_GAP_PX,
              readout.parentElement?.getBoundingClientRect().top ?? Infinity
          )
        : window.innerHeight;
    const bottom = window.innerHeight - top;
    return { bottom, maxHeight: Math.min(MAX_HEIGHT_PX, window.innerHeight - bottom - TOP_MARGIN_PX) };
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

function ProcessRow({
    g,
    row,
    index,
    ui,
    now,
}: {
    g: ResMonGroup;
    row: ProcessInfo;
    index: number;
    ui: ResMonUi;
    now: number;
}) {
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
            className={cn(GRID, "h-7", cursor && "bg-surface-selected")}
        >
            <span className="flex min-w-0 items-baseline gap-2" style={{ paddingLeft: row.depth * INDENT_PX }}>
                <span className="w-2.5 shrink-0 font-mono text-[11px] text-ink-faint">{row.depth > 0 ? "└" : ""}</span>
                <span className="whitespace-nowrap font-mono text-[12px] text-secondary">{label.name}</span>
                <span className="truncate font-mono text-[11px] text-muted">{label.cmd}</span>
            </span>
            <span className="text-right font-mono text-[11px] text-muted">{row.pid}</span>
            <span className="text-right font-mono text-[11px] text-ink-mid">{fmtAge(row.createts ?? 0, now)}</span>
            <span className="text-right font-mono text-[12px] text-primary">{fmtCpu(row.cpu)}</span>
            <span className="text-right font-mono text-[12px] text-secondary">{fmtMem(row.mem)}</span>
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

function currentGroups(): ResMonGroup[] {
    return globalStore.get(resmonSnapshotAtom)?.groups ?? [];
}

function GroupBlock({ g, ui, now }: { g: ResMonGroup; ui: ResMonUi; now: number }) {
    const expanded = isExpanded(ui, g.key);
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
                    onClick={() => dispatchResMon({ type: "toggle", key: g.key })}
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
                <span />
                <span className="text-right font-mono text-[12px] font-medium text-primary">{fmtCpu(g.cpu)}</span>
                <span className="text-right font-mono text-[12px] text-secondary">{fmtMem(g.mem)}</span>
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
                    {g.rows.map((row, i) => (
                        <ProcessRow key={row.pid} g={g} row={row} index={i} ui={ui} now={now} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function ResMonPopover({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(resmonOpenAtom);
    const snap = useAtomValue(resmonSnapshotAtom);
    const ui = useAtomValue(resmonUiAtom);
    const bindings = useMemo(() => buildResMonBindings(model), [model]);
    useKeybindings(bindings);
    const visible = open && (snap == null || snap.supported);
    const panelRef = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState({ bottom: 34, maxHeight: MAX_HEIGHT_PX });

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

    // above the avatar (z-60), which sits in the same corner; below the modals (z-70)
    return (
        <div className="pointer-events-none fixed right-3 z-[65]" style={{ bottom: anchor.bottom }}>
            <PopoverReveal open={visible} origin="bottom right" className="pointer-events-auto">
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
                        <span className="ml-auto text-[11.5px] text-muted">updated every 2s</span>
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
                                <span className="text-right">PID</span>
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
