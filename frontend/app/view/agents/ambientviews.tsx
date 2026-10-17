// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Ambient attribution render bits: task tag chips (row-level) and a "relevant past decision" card block
// (detail-level), over engine D's real edges. Confidence is encoded the way the U3 graph encodes it —
// informing edges dash, weaker buckets recede — so a provisional edge never reads as canonical.
// ageLabel is imported from ./ambient (inlined there). A tag and a decision open their record through the
// router, Ctrl peeking it.

import { openOrPeek } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, type MouseEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { ageLabel, type AmbientRef, type AmbientTag } from "./ambient";
import { ambientProviderAtom, ensureAmbient } from "./ambientstore";

// the ambient surface treatment: recessed panel, never the emphasis of the row it sits in.
const AMBIENT_BOX = "rounded-[9px] border border-border bg-surface px-3 py-2";
const AMBIENT_EYEBROW = "text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted";

// Bucket -> chip weight. Mirrors jarvisgraphderive.attributionStyle's three steps, expressed as tokens
// rather than raw opacity: a chip is text, so its ink never drops below muted (the contrast floor) and
// the edge carries the weaker steps.
function chipTone(tag: AmbientTag): string {
    switch (tag.bucket) {
        case "strong":
            return "border-edge-strong text-secondary";
        case "medium":
            return "border-edge-mid text-muted";
        default:
            return "border-edge-faint text-muted";
    }
}

function openRecord(model: AgentsViewModel, e: MouseEvent, dossierId: string, anchor?: string) {
    fireAndForget(() => openOrPeek(model, { kind: "record", dossierId, anchor }, e));
}

function tagTitle(tag: AmbientTag): string {
    return `${tag.label} · ${tag.bucket} confidence · ${tag.state}`;
}

type AmbientViewProps = AmbientRef & { model: AgentsViewModel };

export function AmbientTags({ model, oref, links }: AmbientViewProps) {
    const provider = useAtomValue(ambientProviderAtom);
    useEffect(ensureAmbient, []);
    const tags = provider.tagsFor({ oref, links });
    if (tags.length === 0) {
        return null;
    }
    return (
        <span className="flex flex-wrap items-center gap-1">
            {tags.map((t) => (
                <button
                    key={t.taskId}
                    type="button"
                    title={`${tagTitle(t)} · open the record`}
                    onClick={(e) => openRecord(model, e, t.taskId)}
                    className={cn(
                        "cursor-pointer rounded-[4px] border px-1.5 py-px text-[10.5px] uppercase tracking-[.06em] hover:border-accent hover:text-primary",
                        t.state === "informing" ? "border-dashed" : "border-solid",
                        chipTone(t)
                    )}
                >
                    {t.label}
                </button>
            ))}
        </span>
    );
}

export function RelevantDecisions({ model, oref, links }: AmbientViewProps) {
    const provider = useAtomValue(ambientProviderAtom);
    useEffect(ensureAmbient, []);
    const decisions = provider.decisionsFor({ oref, links });
    if (decisions.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-col gap-1.5">
            <div className={AMBIENT_EYEBROW}>Relevant past decisions</div>
            {decisions.map((d) => (
                <button
                    key={d.id}
                    type="button"
                    title="Open the decision in its record"
                    onClick={(e) => openRecord(model, e, d.taskId, d.id)}
                    className={cn(
                        AMBIENT_BOX,
                        "cursor-pointer text-left hover:border-edge-strong hover:bg-surface-hover"
                    )}
                >
                    <div className="text-[12.5px] font-semibold text-secondary">{d.title}</div>
                    <div className="text-[11px] text-muted">{ageLabel(d.ageMs)}</div>
                </button>
            ))}
        </div>
    );
}
