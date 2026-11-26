// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New dialog's plan table for a run (Main.dc.html): which model each task of a previewed plan will run on,
// before anything is created. A Model line only counts on Reviewer picks (spec §3), so on any other workers
// setting it is still shown, struck through, rather than hidden: the plan says it and the run will not.

import { shortModel } from "../agents/modelname";
import { routeFace } from "../orchestrate/taskroute";

export type PlanModelTone = "plan-live" | "plan-ignored" | "at-review" | "workers";

export interface PlanModelRow {
    id: string;
    title: string;
    lane: string;
    needs: string;
    model: string;
    tone: PlanModelTone;
}

export interface WorkersSetting {
    picks: boolean;
    // the workers model's short name, from workersModelName
    model: string;
}

function modelCell(task: DagPlanPreviewTask, workers: WorkersSetting): Pick<PlanModelRow, "model" | "tone"> {
    if (task.model) {
        return { model: `${shortModel(task.model)} · plan`, tone: workers.picks ? "plan-live" : "plan-ignored" };
    }
    return workers.picks ? { model: "at review", tone: "at-review" } : { model: workers.model, tone: "workers" };
}

export function planModelRows(tasks: DagPlanPreviewTask[], workers: WorkersSetting): PlanModelRow[] {
    return tasks.map((task) => ({
        id: task.id,
        title: task.title,
        lane: String(task.lane),
        needs: task.deps?.length ? task.deps.join(", ") : "–",
        ...modelCell(task, workers),
    }));
}

export function planMixLine(tasks: DagPlanPreviewTask[], workers: WorkersSetting): { text: string; accent: boolean } {
    const lines = tasks.filter((task) => task.model).length;
    if (workers.picks) {
        return { text: `${lines} set by the plan · ${tasks.length - lines} picked at review`, accent: true };
    }
    return { text: `all on ${workers.model}${lines > 0 ? " · plan lines ignored" : ""}`, accent: false };
}

// "lead" only while the lead's route is still being resolved: the workers then run on whatever it becomes.
export function workersModelName(workerRoute: RoutePin | null, leadRoute: RoutePin | null): string {
    const route = workerRoute ?? leadRoute;
    return route != null ? routeFace(route) : "lead";
}
