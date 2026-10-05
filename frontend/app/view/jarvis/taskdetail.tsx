// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ConfirmDialog } from "@/app/modals/confirmdialog";
import { cn } from "@/util/util";
import { Lock } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DecisionLog } from "./decisionlog";
import { setDossierStatus } from "./recordactions";
import { STAGE_GUTTER } from "./stagemeasure";
import { allowedTransitions, isTerminalTransition } from "./tasksderive";

// A machine-maintained region: muted panel + a lock glyph, non-editable. The visible expression of
// the write-ownership model's inside-Wave tier (spec §4).
//
// The label names the field and stays on the quiet tier; its value is what gets read, on `secondary`. Putting
// both on the same tone is what made this panel one flat colour.
function MachineField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="mb-3">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                <Lock size={10} strokeWidth={2} className="text-muted" />
                {label}
            </div>
            <div className="text-[13px] leading-[1.55] text-secondary">{children}</div>
        </div>
    );
}

// A dossier's status is the one field scanned before anything else is read, so it is the one chip on this
// surface that carries colour. Grey-on-grey put it at the same weight as the transition buttons beside it.
// `paused` was missing, so a paused dossier fell through to the default grey and read as archived — the one
// status whose whole point is "still live, just not now". The four keys here are the full vocabulary
// (jarvisdossier.SetStatus).
//
// Deliberately not shared with the Subjects column's row chip: this is the only status indicator on a record
// you have opened, so it stays legible, while a row in a list of seventeen needs `completed` to recede.
// Same vocabulary, opposite emphasis.
const STATUS_TONE: Record<string, string> = {
    active: "bg-success/12 text-success",
    paused: "bg-warning/12 text-warning",
    completed: "bg-accent/12 text-accent-soft",
    archived: "bg-surface-hover text-muted",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="mb-6">
            <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.08em] text-primary">{title}</h2>
            {children}
        </div>
    );
}

function StatusControl({ dossierId, status }: { dossierId: string; status: string }) {
    const [pending, setPending] = useState<string | null>(null);
    const apply = (next: string) => {
        if (isTerminalTransition(next)) {
            setPending(next);
        } else {
            setDossierStatus(dossierId, next);
        }
    };
    return (
        <>
            <div className="flex items-center gap-1.5">
                {allowedTransitions(status).map((next) => (
                    <button
                        key={next}
                        type="button"
                        onClick={() => apply(next)}
                        className="cursor-pointer rounded border border-border px-2 py-0.5 text-[11px] text-secondary hover:bg-surface-hover"
                    >
                        → {next}
                    </button>
                ))}
            </div>
            {pending != null ? (
                <ConfirmDialog
                    tone={pending === "archived" ? "danger" : "warning"}
                    title={`Mark this task ${pending}?`}
                    body={`This sets the dossier status to "${pending}". You can reactivate it later.`}
                    confirmLabel={`Yes, ${pending}`}
                    cancelLabel="Cancel"
                    onConfirm={() => {
                        setDossierStatus(dossierId, pending);
                        setPending(null);
                    }}
                    onClose={() => setPending(null)}
                />
            ) : null}
        </>
    );
}

// showDecisions=false when the caller renders the decision log itself: on the merged surface a dossier
// subject's record band shows the record's fields while its thread below owns the record's activity.
//
// statusWritable=false is a read-only mount: a caller that writes the status itself must not render the
// transitions twice.
export function TaskDetail({
    detail,
    showDecisions = true,
    statusWritable = true,
}: {
    detail: DossierDetail;
    showDecisions?: boolean;
    statusWritable?: boolean;
}) {
    // The dossier scaffold seeds an empty "## Notes" heading; the read projection keeps it. Strip that
    // redundant leading heading so the FE's own "Notes" section is the only heading and a dossier with
    // no real notes renders no Notes section at all.
    const notes = detail.notes.replace(/^##\s+Notes\s*/i, "").trim();
    // A Go nil slice (a dossier with no recorded acceptance/blockers/refs/decisions, e.g. backfilled
    // history) marshals as JSON null, not []; normalize once so every section below can just check .length.
    const acceptance = detail.acceptance ?? [];
    const blockers = detail.blockers ?? [];
    const refs = detail.refs ?? [];
    const decisions = detail.decisions ?? [];
    return (
        <div className={cn(STAGE_GUTTER, "py-6")}>
            <div className="mb-5">
                <div className="flex items-center gap-2.5">
                    {/* not capped: a heading is scanned, not read line by line, so the reading measure buys
                        nothing here and costs a wrap — an objective that fits on one line was being broken
                        into two with half the Stage empty beside it. */}
                    <h1 className="text-[22px] font-bold tracking-[-0.02em] text-primary">{detail.objective}</h1>
                    {detail.ticket ? (
                        <span className="flex-none rounded bg-surface-hover px-2 py-0.5 font-mono text-[11px] text-ink-mid">
                            {detail.ticket}
                        </span>
                    ) : null}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[12px] text-muted">
                    <span
                        data-record-status={detail.status}
                        className={cn(
                            "rounded px-1.5 py-0.5 font-semibold",
                            STATUS_TONE[detail.status] ?? "bg-surface-hover text-ink-mid"
                        )}
                    >
                        {detail.status}
                    </span>
                    {detail.confidence ? (
                        <span>
                            confidence: <span className="text-ink-mid">{detail.confidence}</span>
                        </span>
                    ) : null}
                    {statusWritable ? <StatusControl dossierId={detail.id} status={detail.status} /> : null}
                </div>
            </div>

            <Section title="Machine-maintained">
                <div className="rounded-xl border border-border bg-surface/50 px-4 py-3.5">
                    {acceptance.length > 0 ? (
                        <MachineField label="Acceptance">
                            <ul className="list-inside list-disc">
                                {acceptance.map((a, i) => (
                                    <li key={i}>{a}</li>
                                ))}
                            </ul>
                        </MachineField>
                    ) : null}
                    {detail.state ? (
                        <MachineField label="State">
                            <div className="whitespace-pre-wrap">{detail.state}</div>
                        </MachineField>
                    ) : null}
                    {blockers.length > 0 ? (
                        <MachineField label="Blockers">
                            <ul className="list-inside list-disc">
                                {blockers.map((b, i) => (
                                    <li key={i}>{b}</li>
                                ))}
                            </ul>
                        </MachineField>
                    ) : null}
                    {refs.length > 0 ? (
                        <MachineField label="Refs">
                            <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                                {refs.map((r) => (
                                    <span key={r} className="rounded bg-surface-hover px-1.5 py-0.5">
                                        {r}
                                    </span>
                                ))}
                            </div>
                        </MachineField>
                    ) : null}
                </div>
            </Section>

            {notes ? (
                <Section title="Notes">
                    <div className="whitespace-pre-wrap text-[13px] leading-[1.6] text-secondary">{notes}</div>
                </Section>
            ) : null}

            {showDecisions ? (
                <Section title="Decisions">
                    <DecisionLog decisions={decisions} dossierId={detail.id} />
                </Section>
            ) : null}
        </div>
    );
}
