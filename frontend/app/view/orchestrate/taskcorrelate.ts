// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isPeekGesture } from "@/app/cockpit/ctrlheld";
import { isEditableTarget } from "@/app/store/keybindings/dispatcher";
import { fireAndForget } from "@/util/util";
import type { AgentsViewModel } from "../agents/agents";
import type { AgentVM } from "../agents/agentsviewmodel";
import { jumpToAgent } from "../agents/channelsprimitives";
import type { OpenTarget } from "../jarvis/address";
import { openOrPeek, type OpenGesture } from "../jarvis/openref";

// A dag task's worker correlation, resolved purely from the child run + roster. Explicit degradation
// states match spec 6.2: a pending task (no child run yet) is "pending"; a run with no reachable
// worker session is "unavailable" with its runId kept for the child-run fallback.
export type TaskWorkerView = {
    state: "dispatched" | "pending" | "unavailable";
    tabId?: string;
    runId?: string;
    agent?: AgentVM;
};

export type TaskWorkerTask = {
    id: string;
    runid?: string;
};

// resolveTaskWorker correlates a task to its worker: the child run's first recorded tab oref matched
// against the live roster. A run that exists but whose worker session is gone (no tab oref, or the tab
// no longer has a roster row) resolves unavailable — never fabricated.
export function resolveTaskWorker(task: TaskWorkerTask, childRun: Run | undefined, roster: AgentVM[]): TaskWorkerView {
    if (!task.runid) {
        return { state: "pending" };
    }
    const runId = task.runid;
    if (!childRun) {
        return { state: "unavailable", runId };
    }
    for (const phase of childRun.phases ?? []) {
        for (const oref of phase.workerorefs ?? []) {
            if (!oref.startsWith("tab:")) {
                continue;
            }
            const tabId = oref.slice(4);
            const agent = roster.find((a) => a.id === tabId);
            if (agent) {
                return { state: "dispatched", tabId, runId, agent };
            }
        }
    }
    return { state: "unavailable", runId };
}

// workerActivityText says what a row shows in place of live activity, or null when the worker is
// reachable and its own activity line should render. An unreachable worker gets an explicit
// "unavailable" — rendering it as idle would be a fabricated claim about a session nobody can see.
export function workerActivityText(view: TaskWorkerView): string | null {
    if (view.state === "dispatched" && view.agent) {
        return null;
    }
    return view.state === "pending" ? "Not dispatched yet" : "Activity unavailable";
}

// taskWorkerTarget is where a resolved worker view goes: dispatched is the agent tab; unavailable is the
// child run on its own channel's sheet; pending has no navigable target.
export function taskWorkerTarget(view: TaskWorkerView): OpenTarget | null {
    if (view.state === "dispatched" && view.tabId) {
        return { kind: "agent", tabId: view.tabId };
    }
    if (view.state === "unavailable" && view.runId) {
        return { kind: "run", runId: view.runId };
    }
    return null;
}

// openTaskWorker goes to the worker's target; a Ctrl+click peeks it instead.
export function openTaskWorker(view: TaskWorkerView, model: AgentsViewModel, event?: OpenGesture): void {
    const target = taskWorkerTarget(view);
    if (target == null) {
        return;
    }
    if (target.kind === "agent" && !isPeekGesture(event)) {
        jumpToAgent(model, target.tabId);
        return;
    }
    fireAndForget(() => openOrPeek(model, target, event));
}

// enterOpensTask reports whether Enter in the graph opens the selected task's worker. A focused button or
// link already takes Enter as its click, and a field takes it as text; opening the worker as well would do
// two things on one press.
export function enterOpensTask(active: Element | null): boolean {
    if (active?.tagName === "BUTTON" || active?.tagName === "A") {
        return false;
    }
    return !isEditableTarget(active);
}
