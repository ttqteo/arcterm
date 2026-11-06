// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A council's report in the Brief's 640px sheet (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md, decision 8;
// board Council.dc.html). The head names the council; the body is the verdict (or the round of a council at work, or
// what a failed or stopped one finished), the ranked directions with their First step and two actions, Ask next, the
// folded Also raised / Matrix line, and the foot's Open chat and Full report. What each shows is councilsheetmodel.ts.
// The Agent surface's own report (councilsummary.tsx) stays the full one; Open chat goes there.

import { globalStore } from "@/app/store/jotaiStore";
import { showCouncil } from "@/app/view/agents/agentcenter";
import { openRefInCode } from "@/app/view/agents/agentrailstore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { councilChatDraftAtom, useCouncil } from "@/app/view/agents/councilstore";
import { projectNameOf } from "@/app/view/agents/councilsummarymodel";
import { openAgentLauncher } from "@/app/view/agents/launcherstore";
import { projectListAtom, projectsAtom } from "@/app/view/agents/projectsstore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { briefUndo } from "./briefundo";
import {
    chunkLabelFor,
    councilSheetHead,
    councilVerdict,
    matrixRows,
    reportPath,
    sheetAsks,
    sheetDirections,
    sheetFold,
    workOnInput,
    type SheetDirection,
} from "./councilsheetmodel";
import { addChunkOp } from "./effortstore";
import { InitiativePicker } from "./initiativepicker";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const LABEL = "text-[12.5px] font-semibold text-primary";
const FOOT_BTN = cn(
    "h-7 flex-none cursor-pointer rounded-[6px] border border-edge-faint bg-surface-raised px-2.5 text-[12px] text-secondary hover:border-edge-strong hover:text-primary disabled:cursor-default disabled:opacity-40",
    FOCUS
);

/** The sheet's head: `council · <mode>`, the question in two lines, `project · N experts · <state> <age>`, ×. */
export function CouncilSheetHead({ councilId, onClose }: { councilId: string; onClose: () => void }) {
    const c = useCouncil(councilId);
    const projects = useAtomValue(projectsAtom);
    const head = c != null ? councilSheetHead(c, projects, Date.now()) : null;
    return (
        <header
            data-council-sheet-head
            className="flex flex-none items-start gap-2.5 border-b border-edge-faint px-5 pt-4 pb-3"
        >
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="self-start rounded-[4px] border border-edge-faint px-[5px] py-px text-[10.5px] text-muted">
                    {head?.chip ?? "council"}
                </span>
                <span
                    data-council-sheet-question
                    title={head?.question}
                    className="line-clamp-2 text-[16px] font-semibold leading-[21px] text-primary"
                >
                    {head?.question ?? "Reading the council…"}
                </span>
                {head != null ? (
                    <span data-council-sheet-meta className="text-[11.5px] text-muted">
                        {head.meta}
                    </span>
                ) : null}
            </div>
            <button
                type="button"
                aria-label="Close (Esc)"
                title="Close (Esc)"
                onClick={onClose}
                className={cn(
                    "flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-primary",
                    FOCUS
                )}
            >
                <X size={15} aria-hidden />
            </button>
        </header>
    );
}

function Verdict({ c, model }: { c: Council; model: AgentsViewModel }) {
    const v = councilVerdict(c);
    const box = "flex flex-col gap-1.5 rounded-[10px] border border-edge-faint bg-surface-raised px-3.5 py-3";
    if (v.kind === "working") {
        return (
            <div data-council-sheet-verdict="working" className={box}>
                <span className="text-[10.5px] font-semibold text-working">Still at work</span>
                <span data-council-sheet-round className="text-[14.5px] font-semibold leading-5 text-primary">
                    {v.step}
                </span>
                <span className="text-[12.5px] leading-[18px] text-secondary">{v.line}</span>
                <button
                    type="button"
                    data-council-sheet-live
                    onClick={() => showCouncil(c.id, "discussion", model)}
                    className={cn(
                        "self-start cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-[12px] font-semibold text-accent hover:text-accenthover",
                        FOCUS
                    )}
                >
                    Watch the discussion ↗
                </button>
            </div>
        );
    }
    if (v.kind === "ended") {
        return (
            <div data-council-sheet-verdict="ended" className={box}>
                <span className="text-[10.5px] font-semibold text-error">{v.title}</span>
                <span className="text-[12.5px] leading-[18px] text-secondary">{v.finished}</span>
                {v.error !== "" ? (
                    <span className="line-clamp-2 text-[12px] leading-[17px] text-muted">{v.error}</span>
                ) : null}
                {v.answer !== "" ? (
                    <span className="text-[13.5px] font-semibold leading-5 text-primary">{v.answer}</span>
                ) : null}
            </div>
        );
    }
    return (
        <div data-council-sheet-verdict="verdict" className={box}>
            <span className="text-[10.5px] font-semibold text-muted">Verdict</span>
            <span data-council-sheet-answer className="text-[14.5px] font-semibold leading-5 text-primary">
                {v.answer}
            </span>
            {v.summary !== "" ? (
                <span title={v.summary} className="line-clamp-3 text-[12.5px] leading-[18px] text-secondary">
                    {v.summary}
                </span>
            ) : null}
        </div>
    );
}

function DirectionCard({
    d,
    onWorkOn,
    onAdd,
}: {
    d: SheetDirection;
    onWorkOn: () => void;
    onAdd: (anchor: HTMLElement) => void;
}) {
    return (
        <div
            data-council-sheet-direction={d.rank}
            className="flex flex-col gap-[7px] rounded-[8px] border border-edge-faint px-3 py-[11px]"
        >
            <div className="flex items-start gap-[9px]">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-edge-mid text-[11px] font-semibold text-primary">
                    {d.rank}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px] text-primary">{d.title}</span>
                <span
                    data-council-sheet-outcome
                    className={cn(
                        "max-w-[180px] flex-none truncate text-[10.5px] font-semibold",
                        d.agreed ? "text-success" : "text-warning"
                    )}
                >
                    {d.outcome}
                </span>
            </div>
            {d.step !== "" ? (
                <div data-council-sheet-step className="flex flex-col gap-0.5 pl-[29px]">
                    <span className="text-[10.5px] font-semibold text-accent">First step</span>
                    <span title={d.step} className="line-clamp-2 text-[12px] leading-[17px] text-secondary">
                        {d.step}
                    </span>
                </div>
            ) : null}
            <div className="flex items-center gap-1.5 pl-[29px]">
                <button
                    type="button"
                    data-council-sheet-work-on
                    onClick={onWorkOn}
                    title="Open a new agent on this, prefilled"
                    className={cn(
                        "h-6 cursor-pointer rounded-[6px] border border-edge-strong bg-surface-raised px-[9px] text-[11px] font-semibold text-primary hover:bg-surface-hover",
                        FOCUS
                    )}
                >
                    Work on
                </button>
                <button
                    type="button"
                    data-council-sheet-add
                    onClick={(e) => onAdd(e.currentTarget)}
                    title="Add the first step to an initiative as a chunk"
                    className={cn(
                        "h-6 cursor-pointer rounded-[6px] border border-edge-faint bg-transparent px-[9px] text-[11px] text-secondary hover:border-edge-strong hover:text-primary",
                        FOCUS
                    )}
                >
                    Add to initiative…
                </button>
                <span className="flex-1" />
                {d.from !== "" ? (
                    <span data-council-sheet-from className="text-[10.5px] text-ink-faint">
                        {d.from}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

// The folded line: Also raised N · Matrix · N proposals, opening both in place.
function Fold({ c }: { c: Council }) {
    const [open, setOpen] = useState(false);
    const fold = sheetFold(c);
    const matrix = useMemo(() => (open ? matrixRows(c) : []), [c, open]);
    if (fold == null) {
        return null;
    }
    const kept = c.summary?.kept != null ? [...c.summary.kept].sort((a, b) => a.rank - b.rank) : [];
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
        <div data-council-sheet-fold className="flex flex-col gap-2">
            <button
                type="button"
                data-council-sheet-fold-toggle
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className={cn(
                    "flex h-[30px] cursor-pointer items-center gap-2 rounded-[6px] border border-edge-faint bg-transparent px-2.5 text-left hover:border-edge-mid",
                    FOCUS
                )}
            >
                {fold.kept > 0 ? (
                    <>
                        <span className="text-[12px] text-secondary">{fold.keptLabel}</span>
                        <span className="text-[11px] tabular-nums text-ink-faint">{fold.kept}</span>
                    </>
                ) : null}
                <span className="flex-1" />
                <span className="text-[11px] text-muted">Matrix · {fold.proposals} proposals</span>
                <Chevron size={12} aria-hidden className="text-muted" />
            </button>
            {open ? (
                <div data-council-sheet-fold-body className="flex flex-col gap-3 px-1">
                    {kept.length > 0 ? (
                        <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-muted">{fold.keptLabel}</span>
                            {kept.map((d, i) => (
                                <span key={`${d.rank}-${i}`} className="text-[12px] leading-[17px] text-secondary">
                                    {d.title}
                                </span>
                            ))}
                        </div>
                    ) : null}
                    <div data-council-sheet-matrix className="flex flex-col">
                        <span className="pb-1 text-[11px] font-semibold text-muted">Matrix</span>
                        {matrix.map((r) => (
                            <div
                                key={r.id}
                                className={cn(
                                    "flex min-h-[24px] items-center gap-2 border-b border-edge-faint text-[11.5px]",
                                    r.out && "opacity-50"
                                )}
                            >
                                <span className="w-9 flex-none font-mono text-[10.5px] text-ink-faint">{r.id}</span>
                                <span className="min-w-0 flex-1 truncate text-secondary" title={r.title}>
                                    {r.title}
                                </span>
                                <span className="w-20 flex-none truncate text-muted">{r.author}</span>
                                <span className="w-14 flex-none text-right tabular-nums text-muted">{r.standing}</span>
                                <span className="w-20 flex-none truncate text-right text-ink-faint">{r.outcome}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/** The sheet's body and foot: the verdict, the directions, Ask next, the fold, Open chat and Full report. */
export function CouncilSheetBody({ model, councilId }: { model: AgentsViewModel; councilId: string }) {
    const c = useCouncil(councilId);
    const projectList = useAtomValue(projectListAtom);
    const [adding, setAdding] = useState<{ d: SheetDirection; anchor: HTMLElement } | null>(null);
    const directions = useMemo(() => (c != null ? sheetDirections(c) : []), [c]);
    const asks = useMemo(() => (c != null ? sheetAsks(c) : []), [c]);
    if (c == null) {
        return (
            <div data-council-sheet-state="loading" className="flex min-h-0 flex-1 flex-col gap-2 p-5">
                <span className="h-16 animate-pulse rounded-[10px] bg-edge-mid motion-reduce:animate-none" />
                <span className="text-[12px] text-secondary">Reading the council…</span>
            </div>
        );
    }
    const path = reportPath(c);

    // Ask in chat drafts the question in the Discussion's box, to edit and send there (as the report's Ask next does)
    const askInChat = (fill: string) => {
        globalStore.set(councilChatDraftAtom(c.id), (d) => ({ ...d, texts: { ...d.texts, [""]: fill } }));
        showCouncil(c.id, "discussion", model);
    };
    const addTo = (oref: string) => {
        const pick = adding;
        setAdding(null);
        if (pick == null || oref === "new") {
            return;
        }
        const label = chunkLabelFor(pick.d);
        fireAndForget(async () => {
            try {
                await addChunkOp(oref, label);
                briefUndo.notify(`Added “${label}” to the initiative`);
            } catch (e) {
                briefUndo.error(`Could not add the chunk: ${e instanceof Error ? e.message : String(e)}`);
            }
        });
    };
    const openReport = () =>
        fireAndForget(async () => {
            try {
                await openRefInCode(model, { abs: c.docpath ?? "", root: c.project });
            } catch (e) {
                briefUndo.error(`Could not open the report: ${e instanceof Error ? e.message : String(e)}`);
            }
        });

    return (
        <>
            <div
                data-council-sheet-body
                data-council-id={c.id}
                className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-3.5"
            >
                <Verdict c={c} model={model} />
                {directions.length > 0 ? (
                    <section data-council-sheet-directions className="flex flex-col gap-2">
                        <div className="flex items-baseline gap-2">
                            <span className={LABEL}>Directions</span>
                            <span className="text-[11px] text-muted">{directions.length} · ranked</span>
                        </div>
                        {directions.map((d) => (
                            <DirectionCard
                                key={d.rank}
                                d={d}
                                onWorkOn={() => openAgentLauncher(model, workOnInput(c, d, projectList))}
                                onAdd={(anchor) => setAdding({ d, anchor })}
                            />
                        ))}
                    </section>
                ) : null}
                {asks.length > 0 ? (
                    <section data-council-sheet-asks className="flex flex-col gap-1">
                        <span className={LABEL}>Ask next</span>
                        {asks.map((a) => (
                            <div key={a.text} data-council-sheet-ask className="flex min-h-[30px] items-center gap-2">
                                <span className="w-24 flex-none truncate text-[10.5px] text-muted" title={a.to}>
                                    {a.to}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[12px] text-secondary" title={a.text}>
                                    {a.text}
                                </span>
                                <button
                                    type="button"
                                    data-council-sheet-ask-chat
                                    onClick={() => askInChat(a.fill)}
                                    className={cn(
                                        "h-[22px] flex-none cursor-pointer rounded-[6px] border border-edge-faint bg-transparent px-2 text-[10.5px] text-secondary hover:border-edge-strong hover:text-primary",
                                        FOCUS
                                    )}
                                >
                                    Ask in chat
                                </button>
                            </div>
                        ))}
                    </section>
                ) : null}
                <Fold key={c.id} c={c} />
            </div>
            <footer
                data-council-sheet-foot
                className="flex flex-none items-center gap-2 border-t border-edge-faint px-5 py-2.5"
            >
                <button
                    type="button"
                    data-council-sheet-chat
                    onClick={() => showCouncil(c.id, "discussion", model)}
                    className={FOOT_BTN}
                >
                    Open chat
                </button>
                <button
                    type="button"
                    data-council-sheet-report
                    disabled={path === ""}
                    title={path === "" ? "The council has not saved its report yet" : undefined}
                    onClick={openReport}
                    className={FOOT_BTN}
                >
                    Full report ↗
                </button>
                <span className="flex-1" />
                {path !== "" ? (
                    <span data-council-sheet-path title={path} className="min-w-0 truncate text-[11px] text-muted">
                        {path}
                    </span>
                ) : null}
            </footer>
            <InitiativePicker
                open={adding != null}
                anchor={adding?.anchor ?? null}
                // the council's project's initiatives come first
                project={projectNameOf(projectList, c.project) ?? ""}
                newLabel={null}
                pickVerb="add to"
                onPick={addTo}
                onClose={() => {
                    adding?.anchor.focus({ preventScroll: true });
                    setAdding(null);
                }}
            />
        </>
    );
}
