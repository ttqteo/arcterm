// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sidecar's resources, Task Manager's way, in two frames from the same parts: on the wall a band across the bottom of the
// dashboard (charts, arcterm's rows, the other apps, side by side); in the small form the title bar's machine figures,
// clicked, switch the body under the bar to a view of the same parts stacked, as a tab does. Either shows the machine's CPU, RAM and GPU charts, then
// what Sidecar itself, the rest of arcterm and each agent take, then the processes outside arcterm holding at least
// 200 MB, from the snapshot's `resources` (sidecarresources.ts builds it in the main window). Each row leads with its
// mark, as Task Manager's do: the arcterm mark, an agent's runtime logo, an app's own icon (pkg/resmon reads it from the
// executable). Both wear the HUD skin (spec 2026-11-18-sidecar-hud-design.md): the band a `hud-panel` ground with corner
// brackets, the small form's view the window's own ground, `HudLabel` titles, circuit dividers, mono figures. It runs on the slim page: only the types,
// the pure models and React.

import { ArctermMark } from "@/app/element/arctermmark";
import { runtimeLogo } from "@/app/view/agents/runtimelogo";
import { cn } from "@/util/util";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HudBrackets, HudDivider, HudLabel } from "./sidecarhud";
import { SidecarResourceCharts } from "./sidecarresourcecharts";
import { formatBytes } from "./sidecarstrainmodel";
import type { SidecarResourceRow, SidecarResources } from "./sidecartypes";

function cpuText(cpu: number | undefined): string {
    if (cpu == null) {
        return "—";
    }
    return cpu < 0.1 ? "0%" : `${cpu.toFixed(1).replace(/\.0$/, "")}%`;
}

// a figure: JetBrains Mono, tabular, so the columns line up
const NUM = "shrink-0 text-right font-mono text-[12px] tabular-nums";
const MARK = "flex size-4 shrink-0 items-center justify-center";

// a row's mark where it has no icon of its own: a window for an app, a prompt for a command an agent or run started
function Glyph({ kind }: { kind: "app" | "command" }) {
    return (
        <span data-sidecar-resource-mark="glyph" className={cn(MARK, "text-hud-muted")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                {kind === "app" ? <path d="M3 9h18" /> : <path d="M7 10l3 2.5L7 15M12 15h5" />}
            </svg>
        </span>
    );
}

// the row's mark, as Task Manager leads each row with the app's icon
function RowMark({ row }: { row: SidecarResourceRow }) {
    if (row.kind === "sidecar" || row.kind === "arcterm") {
        return (
            <span data-sidecar-resource-mark="arcterm" className={cn(MARK, "text-hud-glow")}>
                <ArctermMark width={15} height={11} />
            </span>
        );
    }
    const src = row.kind === "agent" ? runtimeLogo(row.runtime) : row.icon;
    if (src == null) {
        return <Glyph kind={row.kind === "agent" ? "command" : "app"} />;
    }
    return (
        <img
            data-sidecar-resource-mark="icon"
            src={src}
            alt=""
            draggable={false}
            className="size-4 shrink-0 object-contain"
        />
    );
}

/** End task on the other apps' rows: which row asks "End …?" now, and what to do with an answer. */
export interface EndTask {
    confirming: string | null; // the row key asking
    ask: (key: string | null) => void;
    end: (name: string) => void;
}

const ACTION = "shrink-0 rounded-sm px-1.5 py-[1px] text-[11px] font-medium";

// the x that asks to end an app: shown while the row is hovered or the x has the keyboard's focus
function EndButton({ row, onAsk }: { row: SidecarResourceRow; onAsk: () => void }) {
    return (
        <button
            type="button"
            data-sidecar-end={row.key}
            title={`End task: close every ${row.label} process`}
            aria-label={`End ${row.label}`}
            onClick={onAsk}
            onKeyDown={(e) => e.stopPropagation()}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-hud-muted opacity-0 hover:bg-errorbg hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
        >
            <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
        </button>
    );
}

// the row asking before it ends anything: Chrome's 18 processes and their unsaved tabs go together
function ConfirmRow({ row, task }: { row: SidecarResourceRow; task: EndTask }) {
    const endRef = useRef<HTMLButtonElement>(null);
    useEffect(() => endRef.current?.focus(), []);
    const what = row.count != null && row.count > 1 ? `${row.count} ${row.label}` : row.label;
    return (
        <div
            data-sidecar-resource={row.key}
            data-sidecar-end-confirm
            role="group"
            aria-label={`End ${row.label}?`}
            // Enter and Space press these buttons only: the dashboard under the view hears keys on the window
            onKeyDown={(e) => e.stopPropagation()}
            className="flex items-center gap-2 rounded-sm bg-errorbg px-2 py-[3px]"
        >
            <RowMark row={row} />
            <span
                className="min-w-0 flex-1 truncate text-[12.5px] text-error"
                title={`End ${what}? Unsaved work in it is lost.`}
            >
                End {what}?
            </span>
            <button
                ref={endRef}
                type="button"
                data-sidecar-end-yes
                onClick={() => {
                    task.ask(null);
                    task.end(row.label);
                }}
                className={cn(ACTION, "bg-error text-hud-bg hover:opacity-90")}
            >
                End
            </button>
            <button
                type="button"
                data-sidecar-end-no
                onClick={() => task.ask(null)}
                className={cn(ACTION, "text-hud-muted hover:text-hud-text")}
            >
                Cancel
            </button>
        </div>
    );
}

function Row({ row, task }: { row: SidecarResourceRow; task?: EndTask }) {
    const own = row.kind === "sidecar";
    if (task != null && task.confirming === row.key) {
        return <ConfirmRow row={row} task={task} />;
    }
    const endable = task != null && row.kind === "other" && row.endable === true;
    return (
        <div data-sidecar-resource={row.key} className={cn("group rounded-sm px-2 py-[3px]", own && "bg-hud-line")}>
            <div className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                    <RowMark row={row} />
                    <span
                        className={cn(
                            "min-w-0 flex-1 truncate text-[12.5px]",
                            own ? "font-semibold text-hud-text" : "text-hud-text/80"
                        )}
                        title={row.label}
                    >
                        {row.label}
                        {row.count != null && row.count > 1 ? (
                            <span className="text-hud-muted"> ({row.count})</span>
                        ) : null}
                    </span>
                    {endable && <EndButton row={row} onAsk={() => task.ask(row.key)} />}
                </span>
                <span className={cn(NUM, "w-11 text-hud-muted")}>{cpuText(row.cpu)}</span>
                <span className={cn(NUM, "w-9 text-hud-muted")}>{row.gpu != null ? `${row.gpu}%` : "—"}</span>
                <span className={cn(NUM, "w-16 text-hud-text")}>{row.mem != null ? formatBytes(row.mem) : "—"}</span>
            </div>
            {row.note != null && (
                <div data-sidecar-end-note className="truncate pl-6 text-[11px] text-warning" title={row.note}>
                    {row.note}
                </div>
            )}
        </div>
    );
}

// the section's title (CSS uppercases it) and the table's column heads, under a circuit-line divider where it follows
// another section
function Heading({ children, divider = true, title }: { children: string; divider?: boolean; title?: string }) {
    return (
        <>
            {divider && <HudDivider className="mx-2 mt-2.5" />}
            <div className="flex items-baseline gap-3 px-2 pb-1 pt-1.5" title={title}>
                <HudLabel className="min-w-0 flex-1 truncate">{children}</HudLabel>
                <HudLabel className="w-11 text-right">CPU</HudLabel>
                <HudLabel className="w-9 text-right">GPU</HudLabel>
                <HudLabel className="w-16 text-right">RAM</HudLabel>
            </div>
        </>
    );
}

function Unsupported() {
    return (
        <div className="px-2 py-2 text-[12.5px] text-hud-muted">
            Process figures are read on Windows and macOS only.
        </div>
    );
}

function Charts({ resources, className }: { resources: SidecarResources | undefined; className?: string }) {
    return (
        <SidecarResourceCharts
            history={resources?.history ?? []}
            memTotal={resources?.memTotal}
            className={className}
        />
    );
}

function ArctermRows({ resources, divider }: { resources: SidecarResources | undefined; divider?: boolean }) {
    return (
        <>
            <Heading divider={divider}>arcterm</Heading>
            {(resources?.rows ?? []).map((r) => (
                <Row key={r.key} row={r} />
            ))}
            {resources == null || resources.rows.length === 0 ? (
                <div className="px-2 py-1 text-[12px] text-hud-muted">Measuring…</div>
            ) : null}
        </>
    );
}

// "Other apps" alone: with the floor in it ("Other apps over 200 MB") the uppercase title was cut at the small form's
// 340 px, beside the three column heads. The floor is in its tooltip and in the note under the view.
function OtherRows(props: { resources: SidecarResources | undefined; divider?: boolean; task?: EndTask }) {
    const { resources, divider, task } = props;
    if (resources == null || resources.others.length === 0) {
        return null;
    }
    const min = resources.othersMin;
    return (
        <>
            <Heading
                divider={divider}
                title={min != null ? `Processes outside arcterm holding over ${formatBytes(min)}, by app` : undefined}
            >
                Other apps
            </Heading>
            {resources.others.map((r) => (
                <Row key={r.key} row={r} task={task} />
            ))}
        </>
    );
}

// the page runs on the machine it measures, so its own user agent says whose figures pkg/resmon read
const ON_MAC = /Mac/.test(navigator.userAgent);

function noteText(state: SidecarResources["state"], othersMin?: number): string {
    const ram = ON_MAC
        ? "RAM is each process's memory footprint, as Activity Monitor shows it."
        : "RAM is each process's private working set and GPU its busiest engine, as Task Manager shows them.";
    const cpu = `CPU is a share of the whole machine${state === "measuring" ? "; it reads after the second sample" : ""}.`;
    const others = othersMin != null ? ` Other apps lists those holding over ${formatBytes(othersMin)}.` : "";
    return `${ram} ${cpu}${others}`;
}

/** End task's state for a view: the row asking, and the act that ends an app. Escape while a row asks cancels it. */
function useEndTask(send: ((name: string) => void) | undefined): EndTask | undefined {
    const [confirming, setConfirming] = useState<string | null>(null);
    useEffect(() => {
        if (confirming == null) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                // ahead of the panel's own Escape, which would leave the view
                e.preventDefault();
                e.stopImmediatePropagation();
                setConfirming(null);
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [confirming]);
    if (send == null) {
        return undefined;
    }
    return { confirming, ask: setConfirming, end: send };
}

// a column of the band: it scrolls on its own, so a long list never pushes the others
function BandCol({ children, name }: { children: ReactNode; name: string }) {
    return (
        <div data-sidecar-resources-col={name} className="flex min-h-0 min-w-0 flex-col overflow-y-auto">
            {children}
        </div>
    );
}

/**
 * The wall's Resources band, across the bottom of the dashboard: a rounded `hud-panel` box with a `hud-line` border and
 * corner brackets, its title and the note on one line, then three columns side by side: the machine's charts, arcterm's
 * rows, the other apps. The brackets sit on the box, which never scrolls; each column scrolls inside it.
 */
export function SidecarResourcesBand(props: {
    resources: SidecarResources | undefined;
    onEnd?: (name: string) => void;
}) {
    const { resources } = props;
    const state = resources?.state ?? "measuring";
    const task = useEndTask(props.onEnd);
    return (
        <section
            data-sidecar-resources="band"
            data-state={state}
            aria-label="Resources"
            className="relative mx-6 mb-4 flex min-h-0 flex-[2_1_0%] flex-col gap-2 overflow-hidden rounded-lg border border-hud-line bg-hud-panel px-5 py-3"
        >
            <HudBrackets size={18} radius={12} />
            <div className="flex shrink-0 items-center gap-[18px]">
                <HudLabel className="shrink-0 text-[12px]">Resources</HudLabel>
                <HudDivider className="min-w-0 flex-1" />
                <span
                    className="min-w-0 truncate text-[11px] text-hud-muted"
                    title={noteText(state, resources?.othersMin)}
                >
                    RAM: private working set · CPU: share of the machine
                </span>
            </div>
            {state === "unsupported" ? (
                <Unsupported />
            ) : (
                <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-6">
                    <BandCol name="charts">
                        <Charts resources={resources} className="px-1 pt-1" />
                    </BandCol>
                    <BandCol name="arcterm">
                        <ArctermRows resources={resources} divider={false} />
                    </BandCol>
                    <BandCol name="others">
                        <OtherRows resources={resources} divider={false} task={task} />
                    </BandCol>
                </div>
            )}
        </section>
    );
}

/** The small form's Resources view: the title bar's figures switch the body under the bar to it, as a tab does, and
 * back; the band's parts stacked. */
export function SidecarResourcesPanel(props: {
    resources: SidecarResources | undefined;
    onClose: () => void;
    onEnd?: (name: string) => void;
    // why the window's alert frame is up: the view covers the dashboard that shows it
    alert?: { tone: "error" | "warning"; text: string } | null;
}) {
    const { resources, onClose, alert } = props;
    const state = resources?.state ?? "measuring";
    const task = useEndTask(props.onEnd);

    // Escape switches back; a press elsewhere does not, as a tab stays until another is picked (and the bar above it is
    // the window's drag region)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    return (
        <div
            data-sidecar-resources="panel"
            data-state={state}
            role="region"
            aria-label="Resources"
            // the whole body under the title bar, on the window's own ground: a view switched to, not a box over the
            // dashboard, so no border, corner brackets or shadow
            className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-hud-bg"
        >
            {alert != null && (
                // the frame stays up over this view: this says why, and switches back to the dashboard that shows it
                <button
                    type="button"
                    data-sidecar-resources-alert={alert.tone}
                    onClick={onClose}
                    title={`${alert.text}. Back to the dashboard`}
                    className={cn(
                        "mx-2.5 mt-2.5 flex shrink-0 items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[12px]",
                        alert.tone === "error" ? "bg-errorbg text-error" : "bg-askingbg text-warning"
                    )}
                >
                    <span className="shrink-0">⚠</span>
                    <span className="min-w-0 flex-1 truncate">{alert.text}</span>
                    <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.14em] opacity-80">
                        Show
                    </span>
                </button>
            )}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-3">
                {state === "unsupported" ? (
                    <Unsupported />
                ) : (
                    <>
                        <Charts resources={resources} className="px-2 pb-1 pt-1.5" />
                        <ArctermRows resources={resources} />
                        <OtherRows resources={resources} task={task} />
                        <div className="px-2 pb-0.5 pt-2.5 text-[11px] leading-[1.4] text-hud-muted">
                            {noteText(state, resources?.othersMin)}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
