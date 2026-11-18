// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sidecar's resources, Task Manager's way, in two frames from the same parts: on the wall a band across the bottom of the
// dashboard (charts, arcterm's rows, the other apps, side by side); in the small form the title bar's machine figures,
// clicked, drop a panel under the bar with the same parts stacked. Either shows the machine's CPU, RAM and GPU charts, then
// what Sidecar itself, the rest of arcterm and each agent take, then the processes outside arcterm holding at least
// 200 MB, from the snapshot's `resources` (sidecarresources.ts builds it in the main window). Each row leads with its
// mark, as Task Manager's do: the arcterm mark, an agent's runtime logo, an app's own icon (pkg/resmon reads it from the
// executable). Both wear the HUD skin (spec 2026-11-18-sidecar-hud-design.md): a `hud-panel` ground, corner brackets on a
// box that does not scroll, `HudLabel` titles, circuit dividers, mono figures. It runs on the slim page: only the types,
// the pure models and React.

import { ArctermMark } from "@/app/element/arctermmark";
import { runtimeLogo } from "@/app/view/agents/runtimelogo";
import { cn } from "@/util/util";
import { useEffect, useRef, type ReactNode } from "react";
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

function Row({ row }: { row: SidecarResourceRow }) {
    const own = row.kind === "sidecar";
    return (
        <div
            data-sidecar-resource={row.key}
            className={cn("flex items-center gap-3 rounded-sm px-2 py-[3px]", own && "bg-hud-line")}
        >
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
                    {row.count != null && row.count > 1 ? <span className="text-hud-muted"> ({row.count})</span> : null}
                </span>
            </span>
            <span className={cn(NUM, "w-11 text-hud-muted")}>{cpuText(row.cpu)}</span>
            <span className={cn(NUM, "w-9 text-hud-muted")}>{row.gpu != null ? `${row.gpu}%` : "—"}</span>
            <span className={cn(NUM, "w-16 text-hud-text")}>{row.mem != null ? formatBytes(row.mem) : "—"}</span>
        </div>
    );
}

// the section's title (CSS uppercases it) and the table's column heads, under a circuit-line divider where it follows
// another section
function Heading({ children, divider = true }: { children: string; divider?: boolean }) {
    return (
        <>
            {divider && <HudDivider className="mx-2 mt-2.5" />}
            <div className="flex items-baseline gap-3 px-2 pb-1 pt-1.5">
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

function OtherRows({ resources, divider }: { resources: SidecarResources | undefined; divider?: boolean }) {
    if (resources == null || resources.others.length === 0) {
        return null;
    }
    const min = resources.othersMin;
    return (
        <>
            <Heading divider={divider}>{min != null ? `Other apps over ${formatBytes(min)}` : "Other apps"}</Heading>
            {resources.others.map((r) => (
                <Row key={r.key} row={r} />
            ))}
        </>
    );
}

// the page runs on the machine it measures, so its own user agent says whose figures pkg/resmon read
const ON_MAC = /Mac/.test(navigator.userAgent);

function noteText(state: SidecarResources["state"]): string {
    const ram = ON_MAC
        ? "RAM is each process's memory footprint, as Activity Monitor shows it."
        : "RAM is each process's private working set and GPU its busiest engine, as Task Manager shows them.";
    return `${ram} CPU is a share of the whole machine${state === "measuring" ? "; it reads after the second sample" : ""}.`;
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
export function SidecarResourcesBand({ resources }: { resources: SidecarResources | undefined }) {
    const state = resources?.state ?? "measuring";
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
                <span className="min-w-0 truncate text-[11px] text-hud-muted" title={noteText(state)}>
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
                        <OtherRows resources={resources} divider={false} />
                    </BandCol>
                </div>
            )}
        </section>
    );
}

/** The panel the title bar's figures drop in the small form: the band's parts stacked. */
export function SidecarResourcesPanel(props: { resources: SidecarResources | undefined; onClose: () => void }) {
    const { resources, onClose } = props;
    const ref = useRef<HTMLDivElement>(null);
    const state = resources?.state ?? "measuring";

    // Escape and a press outside close it; the title bar's figures toggle it themselves, so a press on them is left out
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };
        const onDown = (e: MouseEvent) => {
            const target = e.target as Element | null;
            if (ref.current?.contains(target) || target?.closest("[data-sidecar-machine]") != null) {
                return;
            }
            onClose();
        };
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("mousedown", onDown, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("mousedown", onDown, true);
        };
    }, [onClose]);

    return (
        <div
            ref={ref}
            data-sidecar-resources="panel"
            data-state={state}
            role="dialog"
            aria-label="Resources"
            // the popover's shadow stays: floating chrome, drawn once, not a glow that follows the beat
            // it fills the window under the title bar: the small form has no room to show the dashboard beside it
            className="absolute inset-x-2 top-[36px] bottom-2 z-40 flex flex-col overflow-hidden rounded-lg border border-hud-line bg-hud-panel shadow-popover-md"
        >
            <HudBrackets size={18} radius={12} />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-3">
                {state === "unsupported" ? (
                    <Unsupported />
                ) : (
                    <>
                        <Charts resources={resources} className="px-2 pb-1 pt-1.5" />
                        <ArctermRows resources={resources} />
                        <OtherRows resources={resources} />
                        <div className="px-2 pb-0.5 pt-2.5 text-[11px] leading-[1.4] text-hud-muted">
                            {noteText(state)}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
