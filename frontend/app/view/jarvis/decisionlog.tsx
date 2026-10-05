// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { pendingDecisionAnchorAtom } from "./petstore";
import { appendDecision } from "./recordactions";
import { validateDecisionDraft } from "./tasksderive";

// how long the anchored card stays lit after a volunteered utterance navigated here
const FLASH_MS = 2_000;

function fmtDate(ms: number): string {
    if (!ms) return "";
    return new Date(ms).toISOString().slice(0, 10);
}

function DecisionCardRow({ card }: { card: DecisionCard }) {
    const anchor = useAtomValue(pendingDecisionAnchorAtom);
    const ref = useRef<HTMLDivElement | null>(null);
    const highlighted = anchor != null && anchor === card.id;
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
            <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted">
                <span className="tabular-nums">{fmtDate(card.created)}</span>
                <span className="rounded bg-surface-hover px-1.5 py-0.5">{card.actor}</span>
                {card.status !== "active" ? (
                    <span className="rounded bg-warning/12 px-1.5 py-0.5 text-warning">{card.status}</span>
                ) : null}
            </div>
            <div className="whitespace-pre-wrap text-[13px] leading-[1.55] text-secondary">{card.rationale}</div>
        </div>
    );
}

function AppendForm({ dossierId, onDone }: { dossierId: string; onDone: () => void }) {
    const [summary, setSummary] = useState("");
    const [rationale, setRationale] = useState("");
    const [busy, setBusy] = useState(false);
    const err = validateDecisionDraft(summary, rationale);
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
            <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Short summary (filename)"
                className="mb-2 w-full rounded border border-border bg-background px-2.5 py-1.5 text-[13px] text-primary outline-none focus:border-accent"
            />
            <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Rationale — why this decision was made"
                rows={4}
                className="mb-2 w-full resize-y rounded border border-border bg-background px-2.5 py-1.5 text-[13px] text-primary outline-none focus:border-accent"
            />
            <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={onDone}
                    className="cursor-pointer rounded px-3 py-1.5 text-[12.5px] font-semibold text-muted hover:text-secondary"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={submit}
                    disabled={err != null || busy}
                    className={cn(
                        "cursor-pointer rounded bg-accent px-3 py-1.5 text-[12.5px] font-bold text-background hover:bg-accenthover",
                        (err != null || busy) && "cursor-not-allowed opacity-50"
                    )}
                >
                    {busy ? "Adding…" : "Add decision"}
                </button>
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
