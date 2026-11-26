// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The plan reviewer's model picks as the dag modal's banner and the selected task's rail show them, and the dag actions that change
// them (setmodel, leadmodels in pkg/orchestrate/modelroute.go).

import { isWaiting, LIGHT_PICK, routeFace, taskRoute } from "./taskroute";

export type PickModel = "sonnet" | "lead";

export interface PickRow {
    id: string;
    title: string;
    reason: string;
    model: PickModel;
    waiting: boolean;
    changed: boolean;
    runningModel: string;
}

function onLightPick(r: RoutePin): boolean {
    return r.runtime === LIGHT_PICK.runtime && r.model === LIGHT_PICK.model;
}

// pickRows lists the tasks the reviewer moved off the lead's model, and every task the owner changed since. A
// reviewer pick that left a task on the lead is not listed: there is nothing to undo.
export function pickRows(group: TaskGroup, owner: Run): PickRow[] {
    if (!group.reviewerpicks) return [];
    const rows: PickRow[] = [];
    for (const task of group.tasks ?? []) {
        const { route } = taskRoute(task, owner, group);
        const light = onLightPick(route);
        const changed = task.modelsource === "owner";
        if (!changed && !(task.pickreason && light)) continue;
        const waiting = isWaiting(task);
        rows.push({
            id: task.id,
            title: task.label || task.id,
            reason: task.pickreason ?? "",
            model: light ? "sonnet" : "lead",
            waiting,
            changed,
            runningModel: waiting ? "" : routeFace(route),
        });
    }
    return rows;
}

// picksBanner is null once no listed task waits: the picks are then settled, and the cards keep their source.
export function picksBanner(group: TaskGroup, owner: Run): { onLight: number; total: number } | null {
    const rows = pickRows(group, owner);
    if (!rows.some((r) => r.waiting)) return null;
    return { onLight: rows.filter((r) => r.model === "sonnet").length, total: group.tasks.length };
}

// an empty target clears the task's pin, which puts it back on the lead's model
export function setModelPayload(group: TaskGroup, taskId: string, model: PickModel): CommandDagActionData {
    const target = model === "sonnet" ? LIGHT_PICK : { runtime: "", model: "" };
    return {
        channelid: group.channelid,
        runid: group.runid,
        taskid: taskId,
        action: "setmodel",
        runtime: target.runtime,
        model: target.model,
    };
}

export function leadModelsPayload(group: TaskGroup): CommandDagActionData {
    return { channelid: group.channelid, runid: group.runid, taskid: "", action: "leadmodels" };
}
