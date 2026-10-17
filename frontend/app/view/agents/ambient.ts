// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Ambient attribution: the real dossier edges from attribution engine D, projected for row task-tags and
// "relevant past decision" cards. The provider is built over ONE whole-vault ResolveAmbient read (see
// ambientstore) — never a lookup per row. An object with no attribution yields nothing; the ambient layer
// must never invent an edge.

export interface AmbientTag {
    label: string;
    taskId: string;
    bucket: string; // weak | medium | strong
    state: string; // informing | confirmed
}

// AmbientDecisionCard is the render shape (the wire type AmbientDecision is a generated global).
export interface AmbientDecisionCard {
    id: string;
    taskId: string; // the dossier the decision belongs to, which is what opening it lands on
    title: string;
    ageMs: number;
}

// AmbientRef is an object's handle into the attribution map. `oref` covers what D attributes directly —
// a Run, and a Radar finding through the run that investigated it. `links` covers vault notes, whose
// attribution is their own [[wikilinks]] to a dossier. Both may be absent: then there is no tag.
export interface AmbientRef {
    oref?: string;
    links?: string[];
}

export interface AmbientProvider {
    tagsFor(ref: AmbientRef): AmbientTag[];
    decisionsFor(ref: AmbientRef): AmbientDecisionCard[];
}

// A [[wikilink]] is an authored reference, not an inference — it carries no confidence bucket of its own,
// so it renders at the same weight as a confirmed edge.
const LINK_BUCKET = "strong";
const LINK_STATE = "confirmed";

// The ambient card is a glance, not the decision log (that is the Tasks surface). Newest few only.
const MAX_DECISIONS = 3;

// Inlined from recallderive.ageLabel so ambient stays jarvis-free (agents must not import the jarvis view).
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export function ageLabel(ageMs: number): string {
    if (ageMs < MIN) return "just now";
    if (ageMs < HOUR) return `${Math.floor(ageMs / MIN)}m ago`;
    if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)}h ago`;
    return `${Math.floor(ageMs / DAY)}d ago`;
}

// ambientRefForFinding maps a Radar finding to its attribution handle. A finding has no dossier edge of
// its own; it inherits the attribution of the run that investigated it. Never investigated -> no tag.
export function ambientRefForFinding(finding: { investigation?: RadarInvestigation }): AmbientRef {
    const runId = finding.investigation?.runid;
    return runId ? { oref: "run:" + runId } : {};
}

export function makeAmbientProvider(
    data: CommandResolveAmbientRtnData | null,
    now: () => number = () => Date.now()
): AmbientProvider {
    const labels = new Map<string, string>();
    for (const t of data?.tasks ?? []) {
        labels.set(t.id, t.label);
    }
    const edgesByORef = new Map<string, AmbientEdge[]>();
    for (const e of data?.edges ?? []) {
        const list = edgesByORef.get(e.oref);
        if (list) {
            list.push(e);
        } else {
            edgesByORef.set(e.oref, [e]);
        }
    }
    const decisionsByTask = new Map<string, AmbientDecision[]>();
    for (const d of data?.decisions ?? []) {
        const list = decisionsByTask.get(d.dossierid);
        if (list) {
            list.push(d);
        } else {
            decisionsByTask.set(d.dossierid, [d]);
        }
    }

    // Attributed edges first (confidence-descending, as the server ordered them), then wikilinks. Deduped
    // by task: an object reachable both ways is one tag, and the stronger inferred edge wins.
    const tagsFor = (ref: AmbientRef): AmbientTag[] => {
        const out: AmbientTag[] = [];
        const seen = new Set<string>();
        for (const e of (ref.oref ? edgesByORef.get(ref.oref) : undefined) ?? []) {
            if (seen.has(e.dossierid)) continue;
            seen.add(e.dossierid);
            out.push({
                label: labels.get(e.dossierid) ?? e.dossierid,
                taskId: e.dossierid,
                bucket: e.bucket,
                state: e.state,
            });
        }
        for (const link of ref.links ?? []) {
            const label = labels.get(link);
            if (label == null || seen.has(link)) continue; // a link to a non-dossier note is not attribution
            seen.add(link);
            out.push({ label, taskId: link, bucket: LINK_BUCKET, state: LINK_STATE });
        }
        return out;
    };

    return {
        tagsFor,
        decisionsFor(ref) {
            const at = now();
            const out: AmbientDecisionCard[] = [];
            const seen = new Set<string>();
            for (const tag of tagsFor(ref)) {
                for (const d of decisionsByTask.get(tag.taskId) ?? []) {
                    if (seen.has(d.id)) continue;
                    seen.add(d.id);
                    out.push({ id: d.id, taskId: d.dossierid, title: d.title, ageMs: Math.max(0, at - d.created) });
                }
            }
            return out.slice(0, MAX_DECISIONS);
        },
    };
}

// The pre-load state: no data, so no tags anywhere. Identical to the provider over an empty vault.
export const emptyAmbientProvider: AmbientProvider = makeAmbientProvider(null);
