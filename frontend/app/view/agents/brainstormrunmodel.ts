// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The brainstorm's Run step: where the run its design was handed to stands, read from the run itself (its dag's
// final stage, its land) rather than from the brainstorm file, and what closing the brainstorm deletes. Pure.

import { canvasDir, join } from "./canvasmodel";
import { runProgress, type RunInfo } from "./runlineage";

export type RunStepState =
    | "missing"
    | "loading"
    | "planning"
    | "building"
    | "final"
    | "final-failed"
    | "unverified"
    | "landing"
    | "held"
    | "merged"
    | "cancelled";

export interface RunStepView {
    state: RunStepState;
    headline: string;
    detail: string;
    // the run's state in the Agent tree's brainstorm line, "" while loading
    tree: string;
    merged: boolean;
    canClose: boolean;
    // why a merged run cannot close the brainstorm, null otherwise
    closeOff: string | null;
    sha?: string;
    done: number;
    total: number;
    round?: number;
}

const ID_CHARS = 8;
const SHA_CHARS = 7;
const FINAL_RUNNING = new Set(["checking", "final", "verifying"]);
const PLANNING_STATUSES = new Set(["planning", "awaiting-review", "plan-review"]);

export function shortRunId(runId: string): string {
    return runId.slice(0, ID_CHARS);
}

function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
}

function tasksLanded(done: number, total: number, where: string): string {
    const count = done === total ? `All ${total} ${plural(total, "task", "tasks")}` : `${done} of ${total} tasks`;
    return `${count} landed on ${where}`;
}

type Base = Omit<RunStepView, "state" | "headline" | "detail" | "tree">;

// runStepView says where the run stands and what happens next, in the Run step's card and the tree line.
export function runStepView(runId: string, run: RunInfo | undefined, loaded: boolean): RunStepView {
    const id8 = shortRunId(runId);
    if (run == null) {
        const base: Base = { merged: false, canClose: false, closeOff: null, done: 0, total: 0 };
        return loaded
            ? {
                  ...base,
                  state: "missing",
                  headline: `Arc can’t find run ${id8}`,
                  detail: "The run may have been deleted. The design stays in the brainstorm file.",
                  tree: "not found",
              }
            : { ...base, state: "loading", headline: `Reading run ${id8}`, detail: "", tree: "" };
    }
    const final = run.dag?.final ?? run.digest?.final;
    const finalState = final?.state ?? "";
    const { done, total } = runProgress(run.dag);
    const into = run.base ?? "its base";
    // a run on its own branch lands its tasks there; one without lands them straight on its base
    const where = run.landPath ? `wave/${id8}` : into;
    const notMerged = run.landPath ? `, so nothing has merged into ${into} yet` : "";
    const base: Base = { merged: false, canClose: false, closeOff: null, done, total, round: final?.round };

    if (run.status === "cancelled" || run.dag?.status === "cancelled") {
        return {
            ...base,
            state: "cancelled",
            headline: "The run was cancelled",
            detail: `${tasksLanded(done, total, where)} before it stopped. Nothing more builds or merges.`,
            tree: "cancelled",
        };
    }
    if (run.land?.state === "landed") {
        const sha = run.land.commit ? run.land.commit.slice(0, SHA_CHARS) : undefined;
        const passed = finalState === "passed";
        return {
            ...base,
            state: "merged",
            headline: sha ? `Built and merged into ${into} at ${sha}` : `Built and merged into ${into}`,
            detail: passed
                ? "The final check passed."
                : finalState === "unverified"
                  ? "The final check could not verify everything."
                  : "The final check did not pass.",
            tree: "merged",
            merged: true,
            canClose: passed,
            closeOff: passed
                ? null
                : finalState === "unverified"
                  ? "The final check could not verify everything, so the brainstorm stays until you have seen what went unverified."
                  : "The final check did not pass, so the brainstorm stays.",
            sha,
        };
    }
    if (run.land?.state === "held") {
        const reason = run.land.reason ? `: ${run.land.reason}` : "";
        return {
            ...base,
            state: "held",
            headline: `The run is built, but merging into ${into} is held`,
            detail: `The merge is held${reason}. The run shows what holds it and lands once it clears.`,
            tree: "land held",
        };
    }
    if (run.land?.state === "pending") {
        return {
            ...base,
            state: "landing",
            headline: `The run is merging into ${into}`,
            detail: `${tasksLanded(done, total, where)} and the final check passed. The branch merges next.`,
            tree: "landing",
        };
    }
    if (finalState === "failed") {
        return {
            ...base,
            state: "final-failed",
            headline:
                done === total
                    ? "The run built every task, but its final check failed"
                    : "The run’s final check failed",
            detail: `${tasksLanded(done, total, where)}. The final check failed in round ${final!.round}${notMerged}. The run shows what failed and reruns the check.`,
            tree: "final failed",
        };
    }
    if (finalState === "unverified") {
        return {
            ...base,
            state: "unverified",
            headline: "The run’s final check could not verify everything",
            detail: `${tasksLanded(done, total, where)}. Nothing failed, but the final check in round ${final!.round} could not verify everything${notMerged}. The run shows what went unverified.`,
            tree: "final unverified",
        };
    }
    if (FINAL_RUNNING.has(finalState)) {
        return {
            ...base,
            state: "final",
            headline: "Every task landed; the final check is running",
            detail: `${tasksLanded(done, total, where)}. The final check verifies the whole in round ${final!.round}; the run merges into ${into} once it passes.`,
            tree: "final check",
        };
    }
    if (finalState === "passed") {
        return {
            ...base,
            state: "landing",
            headline: `The run passed its final check and is merging into ${into}`,
            detail: `${tasksLanded(done, total, where)}. The run merges once its lead wraps up.`,
            tree: "landing",
        };
    }
    if (run.dag == null || total === 0 || PLANNING_STATUSES.has(run.status ?? "")) {
        return {
            ...base,
            state: "planning",
            headline: "The run is planning",
            detail: "The run is turning the design into tasks. Building starts once its plan is ready.",
            tree: "planning",
        };
    }
    return {
        ...base,
        state: "building",
        headline: `The run is building: ${done} of ${total} tasks landed`,
        detail: `Tasks land on ${where} as they pass. Then the final check verifies the whole, and the run merges into ${into}.`,
        tree: `building ${done}/${total}`,
    };
}

// runTreeText is the run's half of the brainstorm's tree line: the state leads, since the id only names the link target.
export function runTreeText(runId: string, view: Pick<RunStepView, "tree">): string {
    const id = `run ${shortRunId(runId)}`;
    return view.tree ? `${view.tree} · ${id}` : id;
}

// one plain folder name: the topic and canvas come from an agent-written file, and Close deletes what they name
function badSegment(name: string): boolean {
    return name.trim() === "" || name === "." || name === ".." || /[\\/]/.test(name);
}

// closeTargets is what closing the brainstorm deletes, in order: its canvas first, so a failed first delete leaves
// the brainstorm, and its Close, in place.
export function closeTargets(
    cwd: string,
    topic: string,
    canvas?: string
): { ok: true; paths: string[] } | { ok: false; reason: string } {
    if (badSegment(topic)) {
        return { ok: false, reason: `Arc won’t delete the topic “${topic}”: it is not one folder name` };
    }
    if (canvas != null && badSegment(canvas)) {
        return { ok: false, reason: `Arc won’t delete the canvas “${canvas}”: it is not one folder name` };
    }
    const brainstorm = join(cwd, ".superpowers", "brainstorm", topic);
    return { ok: true, paths: canvas != null ? [canvasDir(cwd, canvas), brainstorm] : [brainstorm] };
}
