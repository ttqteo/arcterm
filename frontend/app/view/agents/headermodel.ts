// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the left side of the agent header shows (docs/superpowers/specs/2026-11-16-agent-header-redesign-design.md),
// rendered by agentheader.tsx. The header's width level, the one run link that replaces the old lead / origin / started-runs
// arrows, the run menu's sections, and each width level's shorter strings. No React, no Wave runtime.

import { isTerminal } from "./runmodel";
import type { RunOrigin } from "./runorigin";

// The header's width level, read from its own width: every cluster stays, only its words shorten.
export type HeaderWidth = "wide" | "narrow" | "tiny";

// below these widths (px) the header is narrow (a 2x2 split's cell) and very narrow
export const NARROW_PX = 720;
export const TINY_PX = 480;

export function headerWidth(px: number): HeaderWidth {
    if (px > 0 && px < TINY_PX) {
        return "tiny";
    }
    if (px > 0 && px < NARROW_PX) {
        return "narrow";
    }
    // 0 is a header not laid out yet, which reads as wide until it is measured
    return "wide";
}

// The linked initiative's words after its ◇ icon: its title, or "initiative" when it has none of its own (the title is
// the agent's name). initiativeLinkText carries its own ◇ for the places that draw no icon.
export function initiativeTitle(agentName: string, effort: { title: string } | undefined): string {
    return effort == null || effort.title === agentName ? "initiative" : effort.title;
}

// The share of the header the name keeps before it truncates, and the gap between the clusters.
export function headerLayout(width: HeaderWidth): { nameMax: string | undefined; clusterGap: number } {
    if (width === "tiny") {
        return { nameMax: "34%", clusterGap: 10 };
    }
    if (width === "narrow") {
        return { nameMax: "42%", clusterGap: 10 };
    }
    return { nameMax: undefined, clusterGap: 18 };
}

// The model's family, its first word: "opus 5.5" → "opus". A narrow header shows only that.
export function modelShown(model: string, width: HeaderWidth): string {
    if (width === "wide") {
        return model;
    }
    return model.trim().split(/\s+/)[0] ?? model;
}

// The unlinked `/ + initiative` loses its word below the wide level (`/ +`).
export function unlinkedText(width: HeaderWidth): string {
    return width === "wide" ? "initiative" : "";
}

// A linked initiative's title shows until the very narrow level, where its ◇ stands alone (the title in its tooltip).
export function initiativeTitleShown(width: HeaderWidth): boolean {
    return width !== "tiny";
}

// Split, Float and Fullscreen fold into More below the wide level.
export function foldsIntoMore(width: HeaderWidth): boolean {
    return width !== "wide";
}

export type RunRef = { oid: string; goal?: string; status: string; createdts?: number };

const shortId = (id: string) => id.slice(0, 8);

const goalLine = (goal: string | undefined) => goal?.trim().split("\n")[0] || "an untitled run";

// What the header knows about the agent's place among runs.
export type RunLinkInput = {
    // a run's worker or its final stage: the way back is the lead
    lineage?: { kind: "worker" | "stage"; leadName?: string; runTitle?: string } | null;
    // the run this agent is the session of: a lead's, or a Quick run's agent's
    ownRunId?: string | null;
    // the runs it started (startedRunsShown: cancelled ones neither counted nor listed)
    started: readonly RunRef[];
};

// What a click on the run link does.
export type RunLinkClick =
    | { kind: "lead" } // focus the lead (a worker or a stage session)
    | { kind: "open"; runId: string } // open that one run
    | { kind: "menu" } // the run menu (runMenuSections)
    | { kind: "none" }; // a worker whose lead is not in the roster

export type RunLink = {
    icon: "workflow" | "up";
    text: string; // at the wide level
    short: string; // narrow and very narrow
    mono: boolean; // the text is a run id
    title: string;
    click: RunLinkClick;
};

// The one run link, or null when the agent has nothing to do with a run. A lead (or a Quick run's agent) shows its own
// run's id even when it also started runs; the menu lists both.
export function runLink(input: RunLinkInput): RunLink | null {
    const { lineage, ownRunId, started } = input;
    if (lineage != null) {
        const lead = lineage.leadName;
        return {
            icon: "up",
            text: lead ?? lineage.runTitle ?? "no lead",
            short: "lead",
            mono: false,
            title: lead != null ? `Go to the lead, ${lead}` : "The run's lead is not open",
            click: lead != null ? { kind: "lead" } : { kind: "none" },
        };
    }
    if (ownRunId) {
        return {
            icon: "workflow",
            text: `run ${shortId(ownRunId)}`,
            short: shortId(ownRunId),
            mono: true,
            title: "This run, the session it started from and the runs this session started",
            click: { kind: "menu" },
        };
    }
    if (started.length === 0) {
        return null;
    }
    if (started.length === 1) {
        const run = started[0];
        return {
            icon: "workflow",
            text: `run ${shortId(run.oid)}`,
            short: shortId(run.oid),
            mono: true,
            title: `A run this session started (${run.status}): ${goalLine(run.goal)}. Open it`,
            click: { kind: "open", runId: run.oid },
        };
    }
    const active = started.filter((r) => !isTerminal(r.status)).length;
    return {
        icon: "workflow",
        text: active > 0 ? `${started.length} runs · ${active} active` : `${started.length} runs`,
        short: String(started.length),
        mono: false,
        title: "Runs this session started: pick one to open",
        click: { kind: "menu" },
    };
}

// One row of the run menu: `target` null is a row that only says something (a closed session).
export type RunMenuRow = {
    label: string;
    meta: string;
    target: { kind: "run"; runId: string } | { kind: "origin"; origin: RunOrigin } | null;
};
export type RunMenuSection = { head: string; rows: RunMenuRow[] };

// The run menu, in sections: This run, Started from, Started runs (the ones still going first, as runsStartedBy sorts
// them). A section with nothing in it is left out.
export function runMenuSections(
    own: RunRef | null,
    origin: RunOrigin | null,
    started: readonly RunRef[]
): RunMenuSection[] {
    const sections: RunMenuSection[] = [];
    if (own != null) {
        sections.push({
            head: "This run",
            rows: [
                {
                    label: `run ${shortId(own.oid)} · ${goalLine(own.goal)}`,
                    meta: own.status,
                    target: { kind: "run", runId: own.oid },
                },
            ],
        });
    }
    if (origin != null) {
        sections.push({
            head: "Started from",
            rows: [
                origin.kind === "gone"
                    ? { label: "a closed session", meta: "closed", target: null }
                    : { label: origin.name, meta: "session", target: { kind: "origin", origin } },
            ],
        });
    }
    const others = started.filter((r) => r.oid !== own?.oid);
    if (others.length > 0) {
        sections.push({
            head: "Started runs",
            rows: others.map((r) => ({
                label: goalLine(r.goal),
                meta: r.status,
                target: { kind: "run", runId: r.oid },
            })),
        });
    }
    return sections;
}
