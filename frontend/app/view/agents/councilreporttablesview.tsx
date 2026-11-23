// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Report's two tables, first under the answer (docs/superpowers/specs/2026-11-23-council-report-tables-design.md
// decision 5): Việc cần làm / To do, a row per ranked direction (what to do, why, the files it touches, its kind), and
// Số liệu / Figures, a row per figure Go verified (the value, what it measures, the `path:line` it comes from). Rows,
// words and the fallbacks for a council summarized before the new fields are councilreporttables.ts's (this file has a
// longer name than it: a .ts and a .tsx of one name cannot both be imported). They read as quiet
// data tables, not cards: a hairline under each row, the task in primary ink, the rest muted, no fill. Long text wraps
// (a long path breaks anywhere), so at a narrow pane the table shrinks to it; a table that still cannot fit scrolls in
// its own box and never moves the page.
//
// Markers for the CDP scenario (council-report-tables): data-council-section="todo" / "figures", a row
// data-council-todo-row={rank} / data-council-figure-row, and in a to-do row data-council-todo-cell={task|why|files|kind},
// a why cell that is the reasoning's first sentence (no `why` written) also data-council-todo-why-fallback.
// The failed figures list (About the council's) is FailedFiguresTable: data-council-failed-row.

import { viewFade } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { motion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { figureRows, reportLangOf, reportWords, todoRows, type FailedFigureRow } from "./councilreporttables";

const H2 = "m-0 text-[19px] font-semibold tracking-[-0.01em] text-primary";
const TH = "border-b border-edge-mid px-3 py-2 text-left text-[12px] font-medium text-muted";
const TD = "border-t border-edge-faint px-3 py-[10px] align-top [overflow-wrap:anywhere]";

// an empty cell is a dash, as the saved report's is
function Dash() {
    return <span className="text-muted">—</span>;
}

// a section of the Report with its heading and a table, fading in as it mounts like the page's other sections
function TableSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
    return (
        <motion.section
            variants={viewFade}
            initial="initial"
            animate="animate"
            data-council-section={id}
            aria-label={title}
            className="flex min-w-0 flex-col gap-4"
        >
            <h2 className={H2}>{title}</h2>
            <div data-council-table-scroll className="max-w-full overflow-x-auto">
                {children}
            </div>
        </motion.section>
    );
}

/** Việc cần làm / To do: a row per ranked direction. Draws nothing when the summary ranked none. */
export function TodoTable({ c }: { c: Council }) {
    const rows = useMemo(() => todoRows(c), [c]);
    const words = reportWords(reportLangOf(c));
    if (rows.length === 0) {
        return null;
    }
    return (
        <TableSection id="todo" title={words.todo}>
            <table className="w-full border-collapse text-[13.5px] leading-[1.5]">
                <thead>
                    <tr>
                        <th scope="col" className={cn(TH, "w-px pl-0")}>
                            {words.rank}
                        </th>
                        <th scope="col" className={TH}>
                            {words.task}
                        </th>
                        <th scope="col" className={TH}>
                            {words.why}
                        </th>
                        <th scope="col" className={TH}>
                            {words.files}
                        </th>
                        <th scope="col" className={cn(TH, "pr-0")}>
                            {words.kind}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.rank} data-council-todo-row={r.rank}>
                            <td data-council-todo-cell="rank" className={cn(TD, "pl-0 tabular-nums text-muted")}>
                                {r.rank}
                            </td>
                            <td data-council-todo-cell="task" className={cn(TD, "font-semibold text-primary")}>
                                {r.task !== "" ? r.task : <Dash />}
                            </td>
                            <td
                                data-council-todo-cell="why"
                                data-council-todo-why-fallback={r.whyFallback ? "" : undefined}
                                className={cn(TD, "text-secondary")}
                            >
                                {r.why !== "" ? r.why : <Dash />}
                            </td>
                            <td data-council-todo-cell="files" className={cn(TD, "text-[12.5px] text-secondary")}>
                                {r.files.length > 0 ? (
                                    <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
                                        {r.files.map((f) => (
                                            <li key={f}>{f}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <Dash />
                                )}
                            </td>
                            <td data-council-todo-cell="kind" className={cn(TD, "pr-0 text-[12.5px] text-secondary")}>
                                {r.kind !== "" ? r.kind : <Dash />}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableSection>
    );
}

/** Số liệu / Figures: a row per figure Go verified. Draws nothing when there is none. */
export function FiguresTable({ c }: { c: Council }) {
    const rows = useMemo(() => figureRows(c), [c]);
    const words = reportWords(reportLangOf(c));
    if (rows.length === 0) {
        return null;
    }
    return (
        <TableSection id="figures" title={words.figures}>
            <table className="w-full border-collapse text-[13.5px] leading-[1.5]">
                <thead>
                    <tr>
                        <th scope="col" className={cn(TH, "pl-0")}>
                            {words.value}
                        </th>
                        <th scope="col" className={TH}>
                            {words.measures}
                        </th>
                        <th scope="col" className={cn(TH, "pr-0")}>
                            {words.source}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={`${r.ref}:${r.value}:${i}`} data-council-figure-row>
                            <td
                                data-council-figure-cell="value"
                                className={cn(TD, "whitespace-nowrap pl-0 font-semibold tabular-nums text-primary")}
                            >
                                {r.value !== "" ? r.value : <Dash />}
                            </td>
                            <td data-council-figure-cell="measures" className={cn(TD, "text-secondary")}>
                                {r.measures !== "" ? r.measures : <Dash />}
                            </td>
                            {/* a cite is a code reference to read character by character: the one mono cell */}
                            <td
                                data-council-figure-cell="source"
                                className={cn(TD, "pr-0 font-mono text-[12px] text-muted")}
                            >
                                {r.ref !== "" ? r.ref : <Dash />}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableSection>
    );
}

/** The figures that did not check out, with Go's note, for About the council: the side file's four columns (Value,
 *  Measures, Source, Why) under a line that says what the list is. It is about how the council worked, so its words are
 *  English like the rest of that fold, as the side file's are. */
export function FailedFiguresTable({ rows }: { rows: FailedFigureRow[] }) {
    return (
        <div className="flex min-w-0 flex-col gap-3">
            <p className="m-0 text-[13px] leading-[1.5] text-muted">
                The seats declared these numbers; Go could not confirm them against the files, so the Figures table
                leaves them out.
            </p>
            <div data-council-table-scroll className="max-w-full overflow-x-auto">
                <table className="w-full border-collapse text-[13.5px] leading-[1.5]">
                    <thead>
                        <tr>
                            <th scope="col" className={cn(TH, "pl-0")}>
                                Value
                            </th>
                            <th scope="col" className={TH}>
                                Measures
                            </th>
                            <th scope="col" className={TH}>
                                Source
                            </th>
                            <th scope="col" className={cn(TH, "pr-0")}>
                                Why
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={`${r.ref}:${r.value}:${i}`} data-council-failed-row>
                                <td
                                    className={cn(TD, "whitespace-nowrap pl-0 font-semibold tabular-nums text-primary")}
                                >
                                    {r.value !== "" ? r.value : <Dash />}
                                </td>
                                <td className={cn(TD, "text-secondary")}>
                                    {r.measures !== "" ? r.measures : <Dash />}
                                </td>
                                <td className={cn(TD, "font-mono text-[12px] text-muted")}>
                                    {r.ref !== "" ? r.ref : <Dash />}
                                </td>
                                <td data-council-failed-note className={cn(TD, "pr-0 text-secondary")}>
                                    {r.note}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
