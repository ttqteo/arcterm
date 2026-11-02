// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's Councils region: every council still at work (running, waiting on you, queued) and the ones that ended in
// the last seven days, one line each, as the Runs region draws its runs. The Agent tree files the same councils under
// their projects; this is the one place that lists them across projects. A row opens the council through the router
// (`council:<id>`), which lands on the view it was last shown on, the Summary once it has one.
//
// Pure: no React.

import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { panel, treeMeta, UNTITLED_COUNCIL, type CouncilTone } from "@/app/view/agents/councilmodel";
import { SEVEN_DAYS_MS } from "./briefingmodel";
import { projectName, type BriefLine, type LineTone } from "./briefrows";

export const COUNCIL_CAP = 5;

const LIVE_STATES = new Set(["running", "awaiting-you", "queued"]);

/** Pure: a council something still works on, or that waits on the person. */
export function isLiveCouncil(c: Pick<Council, "state">): boolean {
    return LIVE_STATES.has(c.state);
}

export type CouncilDot = "live" | "asking" | "done" | "idle";

export type CouncilLine = BriefLine & { dot: CouncilDot; live: boolean };

const TONE: Record<CouncilTone, LineTone> = {
    working: "ok",
    asking: "asking",
    error: "error",
    muted: "muted",
};

// the person's move first, then what runs, then what waits its turn, then what ended
function rank(c: Council, tone: CouncilTone): number {
    if (tone === "asking") {
        return 0;
    }
    if (c.state === "running") {
        return 1;
    }
    if (c.state === "queued") {
        return 2;
    }
    return 3;
}

function dotOf(c: Council, tone: CouncilTone): CouncilDot {
    if (tone === "asking") {
        return "asking";
    }
    if (c.state === "running") {
        return "live";
    }
    return c.state === "done" ? "done" : "idle";
}

/** Pure: the councils the region draws, in its order. `null` (not loaded yet) is none. A closed council is left out, and
 *  so is an ended one older than seven days by its last save; a live one is kept however old. */
export function councilLines(
    councils: readonly Council[] | null | undefined,
    projects: Record<string, { path?: string }> | null,
    now: number
): CouncilLine[] {
    const kept = (councils ?? []).filter(
        (c) => !c.closed && (isLiveCouncil(c) || now - (c.updated || c.created) <= SEVEN_DAYS_MS)
    );
    const rows = kept.map((c) => {
        const { text, tone } = treeMeta(c);
        const ts = c.updated || c.created;
        const live = isLiveCouncil(c);
        const experts = panel(c).length;
        const line: CouncilLine = {
            id: "councils:" + c.id,
            kind: "council",
            kindTone: tone === "asking" ? "asking" : "muted",
            title: c.feature.trim() || UNTITLED_COUNCIL,
            note: "",
            meta: [projectName(c.project, projects), `${experts} expert${experts === 1 ? "" : "s"}`]
                .filter((p) => p !== "")
                .join(" · "),
            state: text,
            stateTone: TONE[tone],
            progress: null,
            target: { oref: "council:" + c.id },
            why: "",
            age: formatAge(now - ts),
            detail: "",
            hasReport: c.summary != null,
            dot: dotOf(c, tone),
            live,
        };
        return { line, rank: rank(c, tone), ts };
    });
    rows.sort((a, b) => a.rank - b.rank || b.ts - a.ts);
    return rows.map((r) => r.line);
}

/** Pure: the region head's meta, `2 live`, or how far back it reaches when nothing is live. */
export function councilsMeta(lines: readonly CouncilLine[]): string {
    const live = lines.filter((l) => l.live).length;
    return live > 0 ? `${live} live` : "7 days";
}
