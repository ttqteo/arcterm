// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The final stage as the Route DAG's last node: where it sits in the layout and how an edge into it is drawn.
// The stage's own state comes from finalstage.ts. Pure.

import { edgeStyle, type EdgeFocus, type EdgeStyle } from "./dagcanvas";
import type { LayoutTask } from "./daglayout";

export const FINAL_NODE_ID = "final";

// withFinalNode adds the final node after the tasks, depending on every task no other task depends on. A fix
// round's tasks depend on nothing before them, so they are sinks too and get their own edges.
export function withFinalNode(tasks: LayoutTask[]): LayoutTask[] {
    if (tasks.length === 0) return tasks;
    const depended = new Set(tasks.flatMap((t) => t.deps ?? []));
    const sinks = tasks.filter((t) => !depended.has(t.id)).map((t) => t.id);
    return [...tasks, { id: FINAL_NODE_ID, deps: sinks }];
}

// selectedTaskOf is the selection as a task id: the final node shares the graph's selection and is not a task.
export function selectedTaskOf(selected: string | null): string | null {
    return selected === FINAL_NODE_ID ? null : selected;
}

// finalEdgeStyle draws an edge into the final node as edgeStyle draws one into a task: waiting while its
// source is not done, live while the stage runs, satisfied otherwise. An ended stage is never "needs-you":
// its card says how it ended.
export function finalEdgeStyle(src: TaskNode, stageRunning: boolean, focus: EdgeFocus | null): EdgeStyle {
    return edgeStyle(src, { id: FINAL_NODE_ID, state: stageRunning ? "running" : "pending" }, focus);
}
