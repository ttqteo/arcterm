// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The brainstorm's Run step: where the run its design was handed to stands, read from the run itself (its dag's
// final stage, its land) rather than from the brainstorm file, and what closing the brainstorm deletes. Pure.

import { join } from "./canvasmodel";
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
    | "done"
    | "blocked"
    | "cancelled";

export interface RunStepView {
    state: RunStepState;
    headline: string;
    detail: string;
    // the run's state in the Agent tree's brainstorm line, "" while loading
    tree: string;
    merged: boolean;
    canClose: boolean;
    // a merged run whose final check did not pass: Close asks first, saying this; null otherwise
    closeWarn: string | null;
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
        const base: Base = { merged: false, canClose: false, closeWarn: null, done: 0, total: 0 };
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
    const base: Base = { merged: false, canClose: false, closeWarn: null, done, total, round: final?.round };

    // a done run's cancelled dag is the dag the engine closed when the run ended (endedRunSettles): it reads by its land
    if (run.status === "cancelled" || (run.dag?.status === "cancelled" && run.status !== "done")) {
        return {
            ...base,
            state: "cancelled",
            headline: "The run was cancelled",
            detail: `${tasksLanded(done, total, where)} before it stopped. Nothing more builds or merges.`,
            tree: "cancelled",
        };
    }
    if (run.mode === "quick") {
        return quickStepView(run, base);
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
            // the run is in its base either way: an unpassed final asks first rather than keeping the brainstorm
            canClose: true,
            closeWarn: passed
                ? null
                : finalState === "unverified"
                  ? "The final check could not verify everything. Open the run first to see what went unverified; closing accepts it as it is."
                  : "The final check did not pass, though the run merged. Open the run first to see what failed; closing accepts it as it is.",
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

// a quick run has no plan, final check or land of its own, so its status is all there is to read; done, its worker's
// report is the only word on what it verified, and the person closes the brainstorm on it
function quickStepView(run: RunInfo, base: Base): RunStepView {
    switch (run.status) {
        case "done":
            return {
                ...base,
                state: "done",
                headline: "The quick run is done",
                detail: "A quick run has no final check or merge of its own: its report says what it changed and verified.",
                tree: "done",
                canClose: true,
            };
        case "blocked":
            return {
                ...base,
                state: "blocked",
                headline: "The quick run is blocked",
                detail: "Its worker stopped on something it needs from you. The run shows what.",
                tree: "blocked",
            };
        default:
            return {
                ...base,
                state: "building",
                headline: "The quick run is working",
                detail: "One worker builds the design straight from the spec, with no plan. Its report lands in the run when it is done.",
                tree: "working",
            };
    }
}

// runTreeText is the run's half of the brainstorm's tree line: the state leads, since the id only names the link target.
export function runTreeText(runId: string, view: Pick<RunStepView, "tree">): string {
    const id = `run ${shortRunId(runId)}`;
    return view.tree ? `${view.tree} · ${id}` : id;
}

// RunClose is what closing the brainstorm also closes of its run: a done run's outcome is accepted (the run's
// Accept, which clears its unverified item), the worktrees its cleanup left behind are removed, and the sessions it
// still holds end.
export interface RunClose {
    ack: boolean;
    // task ids whose worktree the run's cleanup could not remove
    cleanup: string[];
    tabIds: string[];
}

export function runClose(run: RunInfo | undefined, tabIds: string[]): RunClose {
    if (run == null) {
        return { ack: false, cleanup: [], tabIds };
    }
    const cleanup = (run.digest?.tasks ?? [])
        .filter((t) => t.humanactions?.includes("retry-cleanup"))
        .map((t) => t.taskid);
    return { ack: run.status === "done", cleanup, tabIds };
}

// whether Close touches the run at all, which names the button "Close brainstorm and run"
export function closesRun(c: RunClose): boolean {
    return c.cleanup.length > 0 || c.tabIds.length > 0;
}

// runCloseText is the run's half of the Close line, "" when Close leaves the run as it is
export function runCloseText(c: RunClose): string {
    const parts: string[] = [];
    if (c.tabIds.length > 0) {
        parts.push(
            c.tabIds.length === 1 ? "ends the run’s 1 open session" : `ends the run’s ${c.tabIds.length} open sessions`
        );
    }
    if (c.cleanup.length > 0) {
        parts.push(
            c.cleanup.length === 1
                ? "removes the 1 worktree its cleanup left"
                : `removes the ${c.cleanup.length} worktrees its cleanup left`
        );
    }
    if (parts.length === 0) {
        return "";
    }
    return ` It also ${parts.join(" and ")}.`;
}

// one plain folder name: the topic and canvas come from an agent-written file, and Close deletes what they name
function badSegment(name: string): boolean {
    return name.trim() === "" || name === "." || name === ".." || /[\\/]/.test(name);
}

// closeTarget is what closing the brainstorm deletes: its folder alone. Its canvas stays, in the Canvas gallery.
export function closeTarget(cwd: string, topic: string): { ok: true; path: string } | { ok: false; reason: string } {
    if (badSegment(topic)) {
        return { ok: false, reason: `Arc won’t delete the topic “${topic}”: it is not one folder name` };
    }
    return { ok: true, path: join(cwd, ".superpowers", "brainstorm", topic) };
}
