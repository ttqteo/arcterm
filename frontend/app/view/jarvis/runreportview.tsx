// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A finished run's report, structured (design L508-537): the lead line, then each section with its count,
// a commit hash that opens its diff, and the task tag. "raw markdown" shows the file as filed.

import { diffScopeOfRun, openDiff } from "@/app/view/agents/agentdiffnav";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { SectionLabel } from "@/app/view/agents/sectionlabel";
import { cn } from "@/util/util";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { briefUndo } from "./briefundo";
import { parseRunReport, type ReportItem } from "./runreport";

const LINK = "cursor-pointer text-[10.5px] text-accent-soft hover:text-accent";
const DOT: Record<ReportItem["dot"], string> = {
    ok: "bg-success",
    warn: "bg-asking",
    accent: "bg-accent-soft",
    faint: "bg-edge-strong",
    muted: "bg-ink-mid",
};

export function RunReportView({ model, run, compact }: { model: AgentsViewModel; run: Run; compact?: boolean }) {
    const [raw, setRaw] = useState(false);
    const report = parseRunReport(run.report ?? "");
    if (report == null) {
        return null;
    }
    return (
        <div data-jarvis-run-report className={cn("flex flex-col", compact ? "gap-2.5" : "gap-3.5 pt-4")}>
            <div className="flex items-center gap-2.5">
                <SectionLabel>run report</SectionLabel>
                <span className="min-w-0 truncate text-[10.5px] text-muted">{report.title}</span>
                <span className="flex-1" />
                <button type="button" onClick={() => setRaw(!raw)} className={cn(LINK, "flex-none")}>
                    {raw ? "structured" : "raw markdown"}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        void navigator.clipboard?.writeText(run.report ?? "");
                        briefUndo.notify("Copied the run report");
                    }}
                    className={cn(LINK, "flex-none")}
                >
                    copy
                </button>
            </div>
            {report.lead !== "" ? (
                <div className="break-words text-[11px] leading-[1.55] text-secondary">{report.lead}</div>
            ) : null}
            {raw ? (
                <pre className="m-0 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-border bg-surface px-[13px] py-3 font-mono text-[11px] leading-[1.6] text-secondary">
                    {run.report}
                </pre>
            ) : (
                <>
                    {report.sections.map((sec) => (
                        <div key={sec.heading} className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2 pb-1">
                                <SectionLabel>{sec.heading}</SectionLabel>
                                <span className="text-[10.5px] tabular-nums text-muted">{sec.count}</span>
                            </div>
                            {sec.items.map((it, n) => (
                                <div
                                    key={n}
                                    className="flex items-baseline gap-2.5 border-b border-edge-faint py-[7px]"
                                >
                                    <span
                                        className={cn(
                                            "h-1.5 w-1.5 flex-none -translate-y-px rounded-full",
                                            DOT[it.dot]
                                        )}
                                    />
                                    {it.hash !== "" ? (
                                        <button
                                            type="button"
                                            title="Open this commit's diff"
                                            onClick={() => openDiff(model, diffScopeOfRun(run))}
                                            className="w-16 flex-none cursor-pointer text-left font-mono text-[11px] text-accent-soft hover:underline"
                                        >
                                            {it.hash}
                                        </button>
                                    ) : null}
                                    <span
                                        className={cn(
                                            "min-w-0 flex-1 text-pretty break-words text-[12.5px] leading-[1.5]",
                                            it.dim ? "text-ink-mid" : "text-ink-hi"
                                        )}
                                    >
                                        {it.text}
                                    </span>
                                    {it.tag !== "" ? (
                                        <span className="flex-none rounded-[5px] border border-edge-mid px-1.5 font-mono text-[10.5px] leading-[17px] text-ink-mid">
                                            {it.tag}
                                        </span>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    ))}
                    <button
                        type="button"
                        onClick={() => openDiff(model, diffScopeOfRun(run))}
                        className={cn(LINK, "inline-flex items-center gap-1 self-start")}
                    >
                        open the repository diff
                        <ArrowUpRight size={11} aria-hidden />
                    </button>
                </>
            )}
        </div>
    );
}
