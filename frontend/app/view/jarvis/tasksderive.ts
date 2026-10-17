// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure derivation for the Tasks surface (U2). No React, no I/O — unit-tested directly.

export type DossierGroupKey = "active" | "paused" | "done";

export interface DossierGroup {
    key: DossierGroupKey;
    label: string;
    items: SpaceSummary[];
}

// groupDossiers buckets the flat dossier list into Active / Paused / Done (completed+archived),
// preserving the backend's newest-updated ordering within each group and omitting empty groups.
export function groupDossiers(list: SpaceSummary[]): DossierGroup[] {
    const active = list.filter((d) => d.status === "active");
    const paused = list.filter((d) => d.status === "paused");
    const done = list.filter((d) => d.status === "completed" || d.status === "archived");
    const groups: DossierGroup[] = [];
    if (active.length) groups.push({ key: "active", label: "Active", items: active });
    if (paused.length) groups.push({ key: "paused", label: "Paused", items: paused });
    if (done.length) groups.push({ key: "done", label: "Done", items: done });
    return groups;
}

// The valid status transitions offered in the UI for each current status.
const STATUS_TRANSITIONS: Record<string, string[]> = {
    active: ["paused", "completed", "archived"],
    paused: ["active", "completed", "archived"],
    completed: ["active", "archived"],
    archived: ["active"],
};

export function allowedTransitions(status: string): string[] {
    return STATUS_TRANSITIONS[status] ?? [];
}

// completed/archived are terminal — the UI confirms before applying them.
export function isTerminalTransition(status: string): boolean {
    return status === "completed" || status === "archived";
}

// validateDecisionDraft returns an error message, or null when the draft is submittable.
export function validateDecisionDraft(summary: string, rationale: string): string | null {
    if (rationale.trim() === "") return "Rationale is required.";
    if (summary.trim() === "") return "Summary is required.";
    return null;
}

// decisionHeading splits a decision card into the title it is listed under and the prose beneath it. The
// summary it was filed under is the title; a decision written before summaries were stamped falls back to
// its rationale's first line (markdown markers stripped), and that line then leaves the body so it is not
// read twice.
export function decisionHeading(card: Pick<DecisionCard, "summary" | "rationale">): { title: string; body: string } {
    const summary = card.summary?.trim() ?? "";
    const rationale = card.rationale.trim();
    if (summary !== "") {
        return { title: summary, body: rationale };
    }
    const lines = rationale.split("\n");
    const first = lines.findIndex((l) => l.trim() !== "");
    if (first < 0) {
        return { title: "", body: "" };
    }
    const title = lines[first].trim().replace(/^[#>*+\-\s]+/, "");
    return {
        title,
        body: lines
            .slice(first + 1)
            .join("\n")
            .trim(),
    };
}
