// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Ambient attribution render bits: task tag chips (row-level) and a "relevant past decision" card block
// (detail-level), over engine D's real edges. Confidence is encoded the way the U3 graph encodes it —
// informing edges dash, weaker buckets recede — so a provisional edge never reads as canonical.
// ageLabel is imported from ./ambient (inlined there) so this stays jarvis-free.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { ageLabel, type AmbientRef, type AmbientTag } from "./ambient";
import { AMBIENT_BOX, AMBIENT_EYEBROW } from "./ambientcard";
import { ambientProviderAtom, ensureAmbient } from "./ambientstore";

// Bucket -> chip weight. Mirrors jarvisgraphderive.attributionStyle's three steps, expressed as tokens
// rather than raw opacity: a chip is text, and the graph's 0.35 floor is unreadable at 9px.
function chipTone(tag: AmbientTag): string {
    switch (tag.bucket) {
        case "strong":
            return "border-edge-mid text-secondary";
        case "medium":
            return "border-edge-faint text-muted";
        default:
            return "border-edge-faint text-muted opacity-70";
    }
}

function tagTitle(tag: AmbientTag): string {
    return `${tag.label} · ${tag.bucket} confidence · ${tag.state}`;
}

export function AmbientTags({ oref, links }: AmbientRef) {
    const provider = useAtomValue(ambientProviderAtom);
    useEffect(ensureAmbient, []);
    const tags = provider.tagsFor({ oref, links });
    if (tags.length === 0) {
        return null;
    }
    return (
        <span className="flex flex-wrap items-center gap-1">
            {tags.map((t) => (
                <span
                    key={t.taskId}
                    title={tagTitle(t)}
                    className={cn(
                        "rounded-[4px] border px-1.5 py-px text-[9px] uppercase tracking-[.06em]",
                        t.state === "informing" ? "border-dashed" : "border-solid",
                        chipTone(t)
                    )}
                >
                    {t.label}
                </span>
            ))}
        </span>
    );
}

export function RelevantDecisions({ oref, links }: AmbientRef) {
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
                <div key={d.id} className={AMBIENT_BOX}>
                    <div className="text-[12.5px] font-semibold text-secondary">{d.title}</div>
                    <div className="text-[11px] text-muted">{ageLabel(d.ageMs)}</div>
                </div>
            ))}
        </div>
    );
}
