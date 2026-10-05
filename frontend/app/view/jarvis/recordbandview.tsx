// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The record band: docked above the thread, never a destination. Its whole job is to make attribution
// legible at a glance — a weak inferred link must not read like a confirmed one — so the collapsed line
// carries each edge's state, confidence and line style.

import { composerReveal } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import type { AmbientTag } from "@/app/view/agents/ambient";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Lock } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { EdgeControls } from "./edgecontrolsview";
import { briefPeekRecordAtom } from "./jarvisstore";
import { acceptEdge, detachedEdgesAtom, loadDetachedEdges } from "./recordactions";
import { edgeLabel, edgeLineStyle, recordBandCase } from "./recordband";
import { RecordPicker } from "./recordpicker";
import { STAGE_BAND_INSET, STAGE_GUTTER, STAGE_SCROLLER } from "./stagemeasure";
import type { SubjectKind } from "./subjects";
import { TaskDetail } from "./taskdetail";

function MachineGlyph() {
    return (
        <span className="flex-none text-muted" title="inferred by Jarvis — you can correct it">
            <Lock size={10} strokeWidth={2} />
        </span>
    );
}

// shrinkable, not flex-none: a record label is arbitrary length, and an unshrinkable chip is what pushed
// the band's trailing label past the Stage's right edge and over the rail. The line style and the edge
// state stay fixed-width — those are the signal; the label is what can give.
function EdgeChip({ tag }: { tag: AmbientTag }) {
    const line = edgeLineStyle(tag);
    return (
        <span className="flex min-w-0 items-center gap-[7px] rounded-[6px] border border-border px-2 py-[3px]">
            <span
                className="w-4 flex-none"
                style={{ borderTopStyle: line.style, borderTopWidth: line.weightPx, borderTopColor: "currentColor" }}
            />
            <span className="truncate text-[11.5px] font-semibold text-secondary">{tag.label}</span>
            <span className="flex-none text-[9.5px] text-muted">{edgeLabel(tag)}</span>
        </span>
    );
}

export function RecordBand({
    kind,
    tags,
    detail,
    runORef,
    open,
    onToggle,
}: {
    kind: SubjectKind;
    tags: AmbientTag[];
    detail: DossierDetail | null;
    // the run every edge on this band is an edge *of*. null off a channel, or before a run resolves.
    runORef: string | null;
    open: boolean;
    onToggle: () => void;
}) {
    const band = recordBandCase({ kind, tags });
    // a dossier subject IS the record, so its panel is always open and has no collapse affordance.
    const expandable = band.case === "one" || band.case === "several";
    const showPanel = band.case === "subject" || (expandable && open);
    const [attaching, setAttaching] = useState(false);
    const detachedByKey = useAtomValue(detachedEdgesAtom);
    const detached = runORef != null ? (detachedByKey[runORef] ?? []) : [];
    useEffect(() => {
        if (runORef != null) {
            loadDetachedEdges(runORef);
        }
    }, [runORef]);
    // every edge, primary included: the primary had no row of its own, so the one edge most likely to be
    // wrong was the one edge with nowhere to correct it from.
    const edges: AmbientTag[] =
        band.case === "one" ? [band.edge] : band.case === "several" ? [band.primary, ...band.others] : [];

    // the row's content sits in the shared gutter; the button around it stays full-bleed so its hover tint
    // covers the whole band rather than stopping at the gutter's edges.
    const rowClass = cn(STAGE_GUTTER, "flex items-center gap-2.5 py-2.5");
    // the collapsed row carries no nested interactive element, so the whole row can be the control — the
    // expanded per-record rows below are siblings and stay individually reachable. As a div + onClick it was
    // mouse-only, on a surface whose thesis is keyboard operability.
    const row = (
        <>
            {band.case === "none" ? (
                attaching && runORef != null ? (
                    <RecordPicker
                        onPick={(dossierId) => {
                            acceptEdge(dossierId, runORef);
                            setAttaching(false);
                        }}
                        onCancel={() => setAttaching(false)}
                    />
                ) : (
                    <>
                        <span className="text-[11px] text-muted">No record attributed to this run</span>
                        <div className="flex-1" />
                        <button
                            type="button"
                            disabled={runORef == null}
                            onClick={() => setAttaching(true)}
                            className="flex-none cursor-pointer rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold text-muted hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Attach a record
                        </button>
                    </>
                )
            ) : band.case === "one" ? (
                <>
                    <MachineGlyph />
                    <span className="flex-none font-mono text-[11px] font-semibold text-accent-soft">
                        {band.edge.taskId}
                    </span>
                    <EdgeChip tag={band.edge} />
                    <div className="flex-1" />
                    <span className="flex-none text-[11px] font-semibold text-muted">
                        {open ? "Collapse" : "Expand the record"}
                    </span>
                </>
            ) : band.case === "several" ? (
                <>
                    <MachineGlyph />
                    {/* only the primary edge plus a count: a chip per attributed record put 826px of
                            content in a 790px box at 1440 and drew the trailing label over the rail. The
                            expanded panel below already lists the others as clickable rows. Deliberately
                            not flex-wrap — a band that changes height on selection pushes the thread. */}
                    <EdgeChip tag={band.primary} />
                    <span className="flex-none text-[10.5px] tabular-nums text-muted">+{band.others.length} more</span>
                    <div className="flex-1" />
                    <span className="flex-none text-[11px] font-semibold text-muted">
                        {open ? "Collapse" : "Expand"}
                    </span>
                </>
            ) : (
                <>
                    <MachineGlyph />
                    <span className="flex-none font-mono text-[11px] font-semibold text-accent-soft">
                        {detail?.id ?? ""}
                    </span>
                    <span className="min-w-0 truncate text-[12.5px] font-semibold text-secondary">
                        Selected directly from Records — no run beneath it
                    </span>
                    <div className="flex-1" />
                    <span className="flex-none text-[11px] text-muted">the subject itself</span>
                </>
            )}
        </>
    );

    return (
        // the inset goes on the rows, not on this wrapper: the expanded panel below is a scroller and
        // reserves the same 10px itself, so insetting both would end its content 10px short of the rows'.
        <div className="flex-none border-b border-border bg-surface">
            {expandable ? (
                // data-jarvis-band-toggle: the `e` key presses this button rather than re-deriving whether the
                // band can open — the button exists only when it can (buildJarvisBindings).
                <button
                    type="button"
                    data-jarvis-band-toggle
                    onClick={onToggle}
                    aria-expanded={open}
                    className={cn(
                        STAGE_BAND_INSET,
                        "w-full cursor-pointer text-left transition-colors duration-[140ms] hover:bg-surface-hover"
                    )}
                >
                    <div className={rowClass}>{row}</div>
                </button>
            ) : (
                <div className={STAGE_BAND_INSET}>
                    <div className={rowClass}>{row}</div>
                </div>
            )}
            {/* the disclosure animates its own height: the band sits above the thread, so an instant 420px
                panel shoved the thread down a screenful with nothing to follow. initial={false} so a subject
                you left expanded is already open when you come back rather than replaying the reveal. */}
            <AnimatePresence initial={false}>
                {showPanel && detail != null ? (
                    <motion.div
                        key="panel"
                        variants={composerReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden"
                    >
                        <div className={cn(STAGE_SCROLLER, "max-h-[420px] border-t border-border bg-background")}>
                            <TaskDetail detail={detail} showDecisions={band.case !== "subject"} />
                        </div>
                    </motion.div>
                ) : null}
                {/* one row per edge — expanding must never produce a tab strip. The open-the-record button
                    and the correction controls are siblings, never nested: a control inside a control is the
                    keyboard defect JC19 was filed to fix. */}
                {expandable && open ? (
                    <motion.div
                        key="edges"
                        variants={composerReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden"
                    >
                        <div className={cn(STAGE_BAND_INSET, "border-t border-border")}>
                            <div className={cn(STAGE_GUTTER, "flex flex-col gap-px py-2")}>
                                {edges.map((e) => (
                                    <div
                                        key={e.taskId}
                                        className="flex items-center gap-2 rounded-[7px] px-1 py-1 transition-colors duration-[140ms] hover:bg-surface-hover"
                                    >
                                        <button
                                            type="button"
                                            // the Brief's peek is the surface's one record destination, so the
                                            // band sends its edges there rather than being told where to send them.
                                            onClick={() => globalStore.set(briefPeekRecordAtom, e.taskId)}
                                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                                        >
                                            <EdgeChip tag={e} />
                                            <span className="text-[10.5px] text-muted">open this record</span>
                                        </button>
                                        {runORef != null ? (
                                            <EdgeControls
                                                dossierId={e.taskId}
                                                runORef={runORef}
                                                state={e.state}
                                                subjectLabel={e.label}
                                            />
                                        ) : null}
                                    </div>
                                ))}
                                {detached.map((d) => (
                                    <div
                                        key={"detached-" + d.dossierId}
                                        className="flex items-center gap-2 rounded-[7px] px-1 py-1 opacity-70"
                                    >
                                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
                                            Detached · {d.label}
                                        </span>
                                        <EdgeControls
                                            dossierId={d.dossierId}
                                            runORef={d.runORef}
                                            state="detached"
                                            subjectLabel={d.label}
                                        />
                                    </div>
                                ))}
                                {runORef != null && !attaching ? (
                                    <button
                                        type="button"
                                        onClick={() => setAttaching(true)}
                                        className="cursor-pointer self-start rounded-[6px] px-1 py-1 text-[11px] font-semibold text-muted hover:text-accent"
                                    >
                                        + Attach another record
                                    </button>
                                ) : null}
                                {runORef != null && attaching ? (
                                    <RecordPicker
                                        onPick={(dossierId) => {
                                            acceptEdge(dossierId, runORef);
                                            setAttaching(false);
                                        }}
                                        onCancel={() => setAttaching(false)}
                                    />
                                ) : null}
                            </div>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
