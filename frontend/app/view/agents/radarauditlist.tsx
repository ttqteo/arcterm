// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { Check, Loader2, X } from "lucide-react";
import { auditStateText, type AuditRow, type AuditState } from "./radarmodel";
import { AUDIT_STATE_TEXT } from "./radarstyles";
import { SubLabel } from "./sectionlabel";

const GLYPH = "h-[13px] w-[13px] self-center";

function StateGlyph({ state }: { state: AuditState }) {
    switch (state) {
        case "clean":
        case "hits":
            return <Check className={cn(GLYPH, "text-success")} strokeWidth={2.4} />;
        case "running":
            return (
                <Loader2
                    className={cn(GLYPH, "animate-spin text-accent-soft motion-reduce:animate-none")}
                    strokeWidth={2.4}
                />
            );
        case "failed":
            return <X className={cn(GLYPH, "text-error")} strokeWidth={2.4} />;
        default:
            return (
                <span className="ml-[3px] h-[7px] w-[7px] self-center rounded-full border-[1.5px] border-edge-strong" />
            );
    }
}

function AuditRowView({ row, live, framed }: { row: AuditRow; live: boolean; framed: boolean }) {
    return (
        <div
            data-radar-audit-row={row.sha}
            data-audit-state={row.state}
            className={cn(
                "grid gap-3",
                live
                    ? "grid-cols-[14px_68px_minmax(0,1fr)_72px] items-center"
                    : "grid-cols-[14px_68px_minmax(0,1fr)_52px] items-baseline",
                framed ? "bg-background px-3.5" : "rounded-[7px] px-2 py-[7px]",
                framed && (live ? "py-2" : "pb-2.5 pt-[9px]")
            )}
        >
            <StateGlyph state={row.state} />
            <span className={cn("font-mono text-[11.5px]", row.state === "queued" ? "text-muted" : "text-ink-hi")}>
                {row.sha}
            </span>
            <span className="flex min-w-0 flex-col gap-[3px]">
                <span
                    className={cn(
                        "truncate text-[12.5px]",
                        live && row.state !== "running" ? "text-muted" : "text-secondary"
                    )}
                >
                    {row.subject}
                </span>
                {!live && row.detail ? (
                    <span className={cn("truncate text-xs", row.state === "failed" ? "text-error-soft" : "text-muted")}>
                        {row.detail}
                    </span>
                ) : null}
            </span>
            <span
                className={cn(
                    "text-right text-[10.5px] uppercase tracking-[0.06em]",
                    // a finished clean audit is not what to watch in a live scan
                    live && row.state === "clean" ? "text-muted" : AUDIT_STATE_TEXT[row.state]
                )}
            >
                {auditStateText(row)}
            </span>
        </div>
    );
}

// The audited-commit list: the live scan, the finished scan with no findings, and the header popover.
// framed draws its own table border; the popover is already a panel, so it leaves that off.
export function RadarAuditList({
    rows,
    title,
    tally,
    live = false,
    framed = true,
}: {
    rows: AuditRow[];
    title: string;
    tally: React.ReactNode;
    live?: boolean;
    framed?: boolean;
}) {
    return (
        <div
            data-radar-audit-list
            className={cn(
                "flex flex-col text-left",
                framed && "gap-px overflow-hidden rounded-[10px] border border-edge-mid bg-edge-faint"
            )}
        >
            <div className={cn("flex items-center gap-2.5", framed ? "bg-surface px-3.5 py-2" : "px-2 pb-2 pt-1.5")}>
                <SubLabel className="flex-1">{title}</SubLabel>
                <span className="text-[11px] tabular-nums text-ink-mid">{tally}</span>
            </div>
            {rows.map((row) => (
                <AuditRowView key={row.commit} row={row} live={live} framed={framed} />
            ))}
        </div>
    );
}
