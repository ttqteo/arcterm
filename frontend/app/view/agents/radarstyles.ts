// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Presentational token maps for the Radar surface, shared by the master list and detail pane so the
// two never disagree on a color. Pure class-string lookups — no logic lives here (see radarmodel.ts).

import type { AuditState, InvestigationTone, ListGroupMeta } from "./radarmodel";

// Severity → pill classes + dot color. Unknown severities fall back to the low/accent styling.
const SEVERITY_PILL: Record<string, string> = {
    high: "bg-error/15 text-error",
    medium: "bg-warning/15 text-warning",
    low: "bg-accent/15 text-accent",
};

export function severityPill(severity: string): string {
    return SEVERITY_PILL[severity] ?? SEVERITY_PILL.low;
}

// List group tone → text/dot color, keyed by ListGroupMeta.tone.
export const LIST_TONE_TEXT: Record<ListGroupMeta["tone"], string> = {
    open: "text-accent",
    muted: "text-muted",
};

export const LIST_TONE_DOT: Record<ListGroupMeta["tone"], string> = {
    open: "bg-accent",
    muted: "bg-muted",
};

// Audit state → status text color. The live scan list draws a clean row muted instead, since a finished
// clean audit is not what to watch there.
export const AUDIT_STATE_TEXT: Record<AuditState, string> = {
    queued: "text-muted",
    running: "text-accent-soft",
    clean: "text-success",
    hits: "text-accent-soft",
    failed: "text-error",
};

// Investigation tone → text and dot color, keyed by InvestigationView.tone.
export const INVESTIGATION_TEXT: Record<InvestigationTone, string> = {
    live: "text-accent-soft",
    success: "text-success",
    warning: "text-warning",
    muted: "text-muted",
};

export const INVESTIGATION_DOT: Record<InvestigationTone, string> = {
    live: "bg-accent-soft",
    success: "bg-success",
    warning: "bg-warning",
    muted: "bg-muted",
};
