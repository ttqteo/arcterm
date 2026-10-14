// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The land line, as the cockpit reads it: runs that finish close together land one after another in their project's
// checkout, and a land whose turn has not come waits as `queued`. This is Go's orchestrate.LandPlace on the
// frontend's copies of the runs: the tree row says "#2 in line" and the run sheet names the land ahead.
// Pure: no React, no Wave runtime imports.

import { runTitle, type RunInfo } from "./runlineage";

// what a place is read from: a lineage RunInfo has these, and landSlotOfRun reads them off a run object
export type LandSlot = Pick<RunInfo, "runId" | "title" | "projectPath" | "land">;

/** Pure: a project path as Go's filepath.Clean keys the line (the engine's claimProject uses the same key):
 *  one separator, no trailing one, no dot segments. Case is kept, as Go keeps it. */
export function landProjectKey(path: string | undefined): string {
    if (!path) {
        return "";
    }
    const slashed = path.replace(/\\/g, "/");
    const rooted = slashed.startsWith("/");
    const parts: string[] = [];
    for (const part of slashed.split("/")) {
        if (part === "" || part === ".") {
            continue;
        }
        if (part === "..") {
            const last = parts[parts.length - 1];
            // nothing above a root or a drive ("C:"); a relative path keeps the dots it cannot resolve
            if (last != null && last !== ".." && !/^[A-Za-z]:$/.test(last)) {
                parts.pop();
                continue;
            }
            if (rooted || (last != null && last !== "..")) {
                continue;
            }
        }
        parts.push(part);
    }
    return (rooted ? "/" : "") + parts.join("/");
}

/** Pure: a run object as a place is read from it. The title is the lineage's (runTitle) minus the dag's own. */
export function landSlotOfRun(run: Run): LandSlot {
    return { runId: run.id, title: runTitle(run, undefined), projectPath: run.projectpath, land: run.land };
}

// the driver gives the turn to the oldest queued land, then the lowest run id (pkg/orchestrate/landline.go)
function lands(a: LandSlot, b: LandSlot): number {
    return (a.land?.queuedts ?? 0) - (b.land?.queuedts ?? 0) || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0);
}

/** Pure: where a queued land stands in its project's line, mirroring Go's LandPlace: 1, plus one for each queued land
 *  of the project ahead of it, plus one more while a land of the project is in its turn (`pending`). `ahead` is the
 *  land just before it. place 0 when the land is not queued or its project is not known. A `resolving` land does
 *  not hold the turn, so it counts for nothing. */
export function landPlace(run: LandSlot, runs: LandSlot[]): { place: number; ahead: LandSlot | undefined } {
    const key = landProjectKey(run.projectPath);
    if (run.land?.state !== "queued" || key === "") {
        return { place: 0, ahead: undefined };
    }
    const sameProject = runs.filter((r) => r.runId !== run.runId && landProjectKey(r.projectPath) === key);
    const older = sameProject.filter((r) => r.land?.state === "queued" && lands(r, run) < 0).sort(lands);
    const inTurn = sameProject.find((r) => r.land?.state === "pending");
    return {
        place: 1 + older.length + (inTurn ? 1 : 0),
        ahead: older.length > 0 ? older[older.length - 1] : inTurn,
    };
}
