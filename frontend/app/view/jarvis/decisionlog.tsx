// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DialogButton } from "@/app/modals/dialogbutton";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useId, useRef, useState } from "react";
import { pendingDecisionAnchorAtom } from "./petstore";
import { ageLabel } from "./recallderive";
import { appendDecision } from "./recordactions";
import { decisionHeading, validateDecisionDraft } from "./tasksderive";

// how long the anchored card stays lit after a volunteered utterance navigated here
const FLASH_MS = 2_000;

const FIELD_LABEL = "mb-1 block font-mono text-[10.5px] font-semibold uppercase tracking-[.1em] text-muted";
const FIELD =
    "w-full rounded border border-edge-mid bg-background px-2.5 py-1.5 text-[13px] text-primary outline-none placeholder:text-muted focus:border-accent-700";

function DecisionCardRow({ card }: { card: DecisionCard }) {
    const anchor = useAtomValue(pendingDecisionAnchorAtom);
    const ref = useRef<HTMLDivElement | null>(null);
    const highlighted = anchor != null && anchor === card.id;
    const { title, body } = decisionHeading(card);
    useEffect(() => {
        if (!highlighted) {
            return;
        }
        ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        // clear once honoured so re-selecting this record later does not re-flash
        const t = setTimeout(() => globalStore.set(pendingDecisionAnchorAtom, null), FLASH_MS);
        return () => clearTimeout(t);
    }, [highlighted]);
    return (
        <div
            ref={ref}
            className={cn(
                "rounded-lg border px-3.5 py-3 transition-colors",
                highlighted ? "border-accent bg-accent/8" : "border-border bg-surface"
            )}
        >
            <div className="flex items-baseline gap-2">
                <h4 className="m-0 min-w-0 flex-1 text-[13px] font-semibold text-primary">{title}</h4>
                {/* the age is what the app says everywhere; the exact date stays on hover */}
                <span
                    title={card.created ? new Date(card.created).toLocaleString() : undefined}
                    className="flex-none text-[11px] text-muted"
                >
                    {card.created ? ageLabel(Date.now() - card.created) : ""}
                </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                <span className="rounded bg-surface-hover px-1.5 py-0.5">{card.actor}</span>
                {card.status !== "active" ? (
                    <span className="rounded bg-warning/12 px-1.5 py-0.5 text-warning">{card.status}</span>
                ) : null}
            </div>
            {body ? (
                <div className="mt-2 whitespace-pre-wrap text-[13px] leading-[1.55] text-secondary">{body}</div>
            ) : null}
        </div>
    );
}

function AppendForm({ dossierId, onDone }: { dossierId: string; onDone: () => void }) {
    const [summary, setSummary] = useState("");
    const [rationale, setRationale] = useState("");
    const [busy, setBusy] = useState(false);
    const err = validateDecisionDraft(summary, rationale);
    const summaryId = useId();
    const rationaleId = useId();
    // a failed write keeps the form open with both fields intact: closing on failure would discard what the
    // user wrote and assert a decision that is not in the log. tasksErrorAtom carries the reason.
    const submit = () => {
        if (err != null || busy) return;
        setBusy(true);
        void appendDecision(dossierId, summary.trim(), rationale.trim(), []).then((ok) => {
            setBusy(false);
            if (ok) onDone();
        });
    };
    return (
        <div className="rounded-lg border border-accent/30 bg-surface px-3.5 py-3">
            <label htmlFor={summaryId} className={FIELD_LABEL}>
                Summary
            </label>
            <input
                id={summaryId}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What was decided, in a line"
                className={cn(FIELD, "mb-2.5")}
            />
            <label htmlFor={rationaleId} className={FIELD_LABEL}>
                Rationale
            </label>
            <textarea
                id={rationaleId}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Why — what it was weighed against"
                rows={4}
                className={cn(FIELD, "mb-2.5 resize-y")}
            />
            <div className="flex items-center justify-end gap-2">
                <DialogButton variant="secondary" onClick={onDone}>
                    Cancel
                </DialogButton>
                <DialogButton variant="primary" onClick={submit} disabled={err != null || busy}>
                    {busy ? "Adding…" : "Add decision"}
                </DialogButton>
            </div>
        </div>
    );
}

export function DecisionLog({ decisions, dossierId }: { decisions: DecisionCard[]; dossierId: string }) {
    const [adding, setAdding] = useState(false);
    return (
        <div className="flex flex-col gap-2.5">
            {decisions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3.5 py-4 text-[12.5px] text-muted">
                    No decisions yet.
                </div>
            ) : (
                decisions.map((c) => <DecisionCardRow key={c.id} card={c} />)
            )}
            {adding ? (
                <AppendForm dossierId={dossierId} onDone={() => setAdding(false)} />
            ) : (
                <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="self-start rounded border border-border px-3 py-1.5 text-[12.5px] font-semibold text-secondary hover:bg-surface-hover"
                >
                    + Add decision
                </button>
            )}
        </div>
    );
}
