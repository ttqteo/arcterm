// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sidecar's resource panel: the title bar's machine figures, clicked, drop this under the bar. It lists what Sidecar
// itself, the rest of arcterm and each agent take in CPU and RAM, then the processes outside arcterm holding at least
// 200 MB, from the snapshot's `resources` (sidecarresources.ts builds it in the main window). It runs on the slim page:
// only the types, the pure models and React.

import { cn } from "@/util/util";
import { useEffect, useRef } from "react";
import { formatBytes } from "./sidecarstrainmodel";
import type { SidecarResourceRow, SidecarResources } from "./sidecartypes";

function cpuText(cpu: number | undefined): string {
    if (cpu == null) {
        return "—";
    }
    return cpu < 0.1 ? "0%" : `${cpu.toFixed(1).replace(/\.0$/, "")}%`;
}

function Row({ row }: { row: SidecarResourceRow }) {
    const own = row.kind === "sidecar";
    return (
        <div
            data-sidecar-resource={row.key}
            className={cn("flex items-baseline gap-3 rounded px-2 py-[3px]", own && "bg-surface-hover")}
        >
            <span
                className={cn(
                    "min-w-0 flex-1 truncate text-[12.5px]",
                    own ? "font-semibold text-primary" : "text-secondary"
                )}
                title={row.label}
            >
                {row.label}
                {row.count != null && row.count > 1 ? <span className="text-muted"> ({row.count})</span> : null}
            </span>
            <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-secondary">{cpuText(row.cpu)}</span>
            <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-primary">
                {row.mem != null ? formatBytes(row.mem) : "—"}
            </span>
        </div>
    );
}

function Heading({ children }: { children: string }) {
    return (
        <div className="flex items-baseline gap-3 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span className="flex-1">{children}</span>
            <span className="w-12 text-right">CPU</span>
            <span className="w-16 text-right">RAM</span>
        </div>
    );
}

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

    const state = resources?.state ?? "measuring";
    const othersMin = resources?.othersMin;
    return (
        <div
            ref={ref}
            data-sidecar-resources
            data-state={state}
            role="dialog"
            aria-label="Resources"
            className={cn(
                "absolute z-40 flex max-h-[min(70vh,560px)] flex-col overflow-y-auto rounded-lg border border-edge-strong bg-surface-raised p-1.5 shadow-popover-md",
                small ? "inset-x-2 top-[36px]" : "left-3.5 top-[42px] w-[400px]"
            )}
        >
            {state === "unsupported" ? (
                <div className="px-2 py-2 text-[12.5px] text-muted">
                    Process figures are read on Windows only for now.
                </div>
            ) : (
                <>
                    <Heading>arcterm</Heading>
                    {(resources?.rows ?? []).map((r) => (
                        <Row key={r.key} row={r} />
                    ))}
                    {resources == null || resources.rows.length === 0 ? (
                        <div className="px-2 py-1 text-[12px] text-muted">Measuring…</div>
                    ) : null}
                    {resources != null && resources.others.length > 0 ? (
                        <>
                            <Heading>
                                {othersMin != null ? `Other apps over ${formatBytes(othersMin)}` : "Other apps"}
                            </Heading>
                            {resources.others.map((r) => (
                                <Row key={r.key} row={r} />
                            ))}
                        </>
                    ) : null}
                    <div className="px-2 pb-0.5 pt-2 text-[11px] text-muted">
                        RAM is each process&apos;s private working set, as Task Manager shows it. CPU is a share of the
                        whole machine{state === "measuring" ? "; it reads after the second sample" : ""}.
                    </div>
                </>
            )}
        </div>
    );
}
