// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sidecar's resources, two ways from one body: on a wall with room (sidecarlayout.ts resourcesColumnFits) a column
// beside the dashboard; elsewhere the title bar's machine figures, clicked, drop a panel under the bar. Either shows the
// machine's CPU, RAM and GPU charts, then what Sidecar itself, the rest of arcterm and each agent take, then the
// processes outside arcterm holding at least 200 MB, from the snapshot's `resources` (sidecarresources.ts builds it in
// the main window). Both wear the HUD skin (spec 2026-11-18-sidecar-hud-design.md): a `hud-panel` ground, corner brackets
// on a box that does not scroll, `HudLabel` titles, circuit dividers, mono figures. It runs on the slim page: only the
// types, the pure models and React.

import { cn } from "@/util/util";
import { useEffect, useRef } from "react";
import { HudBrackets, HudDivider, HudLabel } from "./sidecarhud";
import { RESOURCES_COL_PX } from "./sidecarlayout";
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

function Row({ row }: { row: SidecarResourceRow }) {
    const own = row.kind === "sidecar";
    return (
        <div
            data-sidecar-resource={row.key}
            className={cn("flex items-baseline gap-3 rounded-sm px-2 py-[3px]", own && "bg-hud-line")}
        >
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
            <span className={cn(NUM, "w-11 text-hud-muted")}>{cpuText(row.cpu)}</span>
            <span className={cn(NUM, "w-9 text-hud-muted")}>{row.gpu != null ? `${row.gpu}%` : "—"}</span>
            <span className={cn(NUM, "w-16 text-hud-text")}>{row.mem != null ? formatBytes(row.mem) : "—"}</span>
        </div>
    );
}

// a circuit-line divider, then the section's title (CSS uppercases it) and the table's column heads
function Heading({ children }: { children: string }) {
    return (
        <>
            <HudDivider className="mx-2 mt-2.5" />
            <div className="flex items-baseline gap-3 px-2 pb-1 pt-1.5">
                <HudLabel className="min-w-0 flex-1 truncate">{children}</HudLabel>
                <HudLabel className="w-11 text-right">CPU</HudLabel>
                <HudLabel className="w-9 text-right">GPU</HudLabel>
                <HudLabel className="w-16 text-right">RAM</HudLabel>
            </div>
        </>
    );
}

// the charts, the arcterm rows and the other apps; the caller gives the frame
function ResourcesBody({ resources }: { resources: SidecarResources | undefined }) {
    const state = resources?.state ?? "measuring";
    if (state === "unsupported") {
        return (
            <div className="px-2 py-2 text-[12.5px] text-hud-muted">
                Process figures are read on Windows only for now.
            </div>
        );
    }
    const othersMin = resources?.othersMin;
    return (
        <>
            <SidecarResourceCharts
                history={resources?.history ?? []}
                memTotal={resources?.memTotal}
                className="px-2 pb-1 pt-1.5"
            />
            <Heading>arcterm</Heading>
            {(resources?.rows ?? []).map((r) => (
                <Row key={r.key} row={r} />
            ))}
            {resources == null || resources.rows.length === 0 ? (
                <div className="px-2 py-1 text-[12px] text-hud-muted">Measuring…</div>
            ) : null}
            {resources != null && resources.others.length > 0 ? (
                <>
                    <Heading>{othersMin != null ? `Other apps over ${formatBytes(othersMin)}` : "Other apps"}</Heading>
                    {resources.others.map((r) => (
                        <Row key={r.key} row={r} />
                    ))}
                </>
            ) : null}
            <div className="px-2 pb-0.5 pt-2.5 text-[11px] leading-[1.4] text-hud-muted">
                RAM is each process&apos;s private working set and GPU its busiest engine, as Task Manager shows them.
                CPU is a share of the whole machine{state === "measuring" ? "; it reads after the second sample" : ""}.
            </div>
        </>
    );
}

/**
 * The wall's Resources column, beside the dashboard: a rounded `hud-panel` box with a `hud-line` border (which sets it
 * apart from the wall, a gap of 8 px round it) and corner brackets bending round its corners. The brackets sit on this
 * box, which never scrolls; the list scrolls inside it, or they would ride up with the content.
 */
export function SidecarResourcesColumn({ resources }: { resources: SidecarResources | undefined }) {
    return (
        <aside
            data-sidecar-resources="column"
            data-state={resources?.state ?? "measuring"}
            aria-label="Resources"
            className="relative my-2 mr-2 flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-hud-line bg-hud-panel"
            style={{ width: RESOURCES_COL_PX }}
        >
            <HudBrackets size={18} radius={12} />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-3">
                <div className="px-2 pb-1.5">
                    <HudLabel>Resources</HudLabel>
                </div>
                <ResourcesBody resources={resources} />
            </div>
        </aside>
    );
}

/** The panel the title bar's figures drop when the wall has no room for the column, and in the small form. */
export function SidecarResourcesPanel(props: {
    resources: SidecarResources | undefined;
    small: boolean;
    onClose: () => void;
}) {
    const { resources, small, onClose } = props;
    const ref = useRef<HTMLDivElement>(null);

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
            data-state={resources?.state ?? "measuring"}
            role="dialog"
            aria-label="Resources"
            // the popover's shadow stays: floating chrome, drawn once, not a glow that follows the beat
            className={cn(
                "absolute z-40 flex max-h-[min(80vh,640px)] flex-col overflow-hidden rounded-lg border border-hud-line bg-hud-panel shadow-popover-md",
                small ? "inset-x-2 top-[36px]" : "left-3.5 top-[42px] w-[420px]"
            )}
        >
            <HudBrackets size={18} radius={12} />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-3">
                <ResourcesBody resources={resources} />
            </div>
        </div>
    );
}
