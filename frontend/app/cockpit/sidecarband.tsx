// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar strain band (spec 2026-11-13-sidecar-design.md, section 4; board E-strain-band): one band over the wall
// when the machine is strained, saying what is strained and since when, and naming the agents that weigh most with a
// Stop and a Sleep for each. It draws the snapshot's `strain` and sends `stop` and `sleep` acts; the wall holds whether
// the × hid it. Stop asks in place first (page-local state), and there is no band-wide action. Nothing here animates.
// The page is storeless: only the types, the pure models and React.

import { cn } from "@/util/util";
import { useState, type MouseEvent } from "react";
import { bandTitle, bandWhy, formatBytes } from "./sidecarstrainmodel";
import type { SidecarAct, SidecarHeavy, SidecarMachine, SidecarStrain } from "./sidecartypes";

export interface SidecarBandProps {
    strain: SidecarStrain;
    machine?: SidecarMachine;
    // the page's clock: the snapshot's `now` plus the time since it arrived, so "RAM high for 3 min" ages like the tiles
    now: number;
    onHide: () => void;
    send: (act: SidecarAct) => void;
}

// a weight as the band words it: RAM in bytes, CPU in percent of the machine
function weightText(w: { ramBytes?: number; cpuPct?: number }): string {
    if (w.ramBytes != null) {
        return formatBytes(w.ramBytes);
    }
    return w.cpuPct != null ? `${Math.round(w.cpuPct)}%` : "";
}

export function SidecarBand({ strain, machine, now, onHide, send }: SidecarBandProps) {
    const red = strain.level === "red";
    return (
        <div
            data-sidecar-band
            data-level={strain.level}
            role="status"
            className={cn(
                "mx-5 mt-3 flex shrink-0 flex-col gap-2.5 rounded-lg border px-3.5 py-3",
                red ? "border-error bg-error/12" : "border-warning bg-warning/12"
            )}
        >
            <div className="flex items-center gap-2.5">
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={cn("shrink-0", red ? "text-error" : "text-warning")}
                    aria-hidden="true"
                >
                    <path d="M12 9v4M12 17h.01" />
                    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
                <span
                    data-sidecar-band-title
                    className={cn("shrink-0 text-[14px] font-semibold", red ? "text-error" : "text-warning")}
                >
                    {bandTitle(strain)}
                </span>
                <span data-sidecar-band-why className="min-w-0 text-[13px] text-secondary">
                    {bandWhy(strain, machine, now)}
                </span>
                <span className="flex-1" />
                <button
                    type="button"
                    data-sidecar-band-close
                    aria-label="Hide until it changes"
                    title="Hide until it changes"
                    tabIndex={-1}
                    // a click must not leave the button holding focus: Enter belongs to the wall, not to it
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onHide}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-primary"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                </button>
            </div>
            {strain.heavy.length === 0 ? (
                <div data-sidecar-band-finding className="text-[12.5px] text-muted">
                    Finding the heaviest agents…
                </div>
            ) : (
                <div className="flex gap-2.5">
                    {strain.heavy.map((h) => (
                        <HeavyRow key={h.id} h={h} send={send} />
                    ))}
                </div>
            )}
        </div>
    );
}

const BUTTON =
    "flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-md border border-edge-strong bg-surface-hover px-[9px] text-[12px] text-primary hover:bg-surface-selected active:scale-100";

function HeavyRow({ h, send }: { h: SidecarHeavy; send: (act: SidecarAct) => void }) {
    // the confirm is for one process: if the row's process changes while it is open, the question no longer fits and the
    // row goes back to its buttons, so a Stop never ends a process the person was not asked about
    const [confirm, setConfirm] = useState<number | null>(null);
    const proc = h.process;
    if (confirm != null && proc?.pid !== confirm) {
        setConfirm(null);
    }
    const asking = proc != null && confirm === proc.pid;
    // none of these may keep focus after a press: Enter and the arrows belong to the wall
    const press = { type: "button" as const, tabIndex: -1, onMouseDown: (e: MouseEvent) => e.preventDefault() };
    return (
        <div
            data-sidecar-heavy={h.id}
            className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md border border-edge-strong bg-surface-raised px-2.5 py-2"
        >
            <div className="flex items-center gap-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline gap-2">
                        <span className="min-w-0 truncate text-[13px] font-semibold text-primary" title={h.name}>
                            {h.name}
                        </span>
                        <span className="shrink-0 text-[12px] tabular-nums text-secondary">{weightText(h)}</span>
                    </div>
                    {proc != null && (
                        <div
                            data-sidecar-heavy-process
                            className="flex min-w-0 gap-1.5 font-mono text-[11px] text-secondary"
                            title={proc.command}
                        >
                            <span className="min-w-0 truncate">{proc.command}</span>
                            {weightText(proc) !== "" && <span className="shrink-0">{`·  ${weightText(proc)}`}</span>}
                        </div>
                    )}
                </div>
                {asking ? (
                    <div data-sidecar-confirm className="flex min-w-0 flex-[1.4] items-center gap-2">
                        <span className="min-w-0 text-[12px] leading-[1.35] text-secondary">
                            Stop <span className="break-all font-mono text-primary">{proc.command}</span>? The
                            agent&apos;s build ends; the agent keeps running.
                        </span>
                        <button
                            {...press}
                            data-sidecar-confirm-stop
                            onClick={() => {
                                setConfirm(null);
                                send({ kind: "stop", id: h.id, pid: proc.pid });
                            }}
                            className="flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-md bg-accent px-[9px] text-[12px] font-semibold text-background active:scale-100"
                        >
                            Stop
                        </button>
                        <button
                            {...press}
                            data-sidecar-confirm-cancel
                            onClick={() => setConfirm(null)}
                            className={BUTTON}
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <div className="flex shrink-0 items-center gap-1.5">
                        {proc != null && (
                            <button
                                {...press}
                                data-sidecar-heavy-stop
                                onClick={() => setConfirm(proc.pid)}
                                className={BUTTON}
                            >
                                Stop
                            </button>
                        )}
                        <button
                            {...press}
                            data-sidecar-heavy-sleep
                            onClick={() => send({ kind: "sleep", id: h.id })}
                            className={BUTTON}
                        >
                            Sleep agent
                        </button>
                    </div>
                )}
            </div>
            {h.note != null && (
                <div data-sidecar-heavy-note className="text-[11.5px] text-muted">
                    {h.note}
                </div>
            )}
        </div>
    );
}
