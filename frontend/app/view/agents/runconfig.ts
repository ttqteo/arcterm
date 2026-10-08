// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the run launcher draws, as data. The launcher replaced the composer footer's chip strip, where
// shape, engine/adaptive and the Lead->Workers pickers competed for one wrapping 10px row; the sections a
// given shape actually has are decided here so the view stays a renderer.

export type RunShape = "orchestrator" | "quick";

// Mirror of the Go ceiling the launcher states in prose. It is a const, not a wire type, so codegen
// does not carry it; runconfig.test.ts reads the Go source and fails if it drifts.
export const MAX_PARALLELISM = 8; // orchestrate.MaxParallelism (pkg/orchestrate/dag.go)

export const DEFAULT_PARALLELISM = 3;

// Where an orchestrator starts. A goal gets a lead that works it with you and hands the engine a plan; a plan
// file skips that turn, because a plan you already wrote does not need a lead to transcribe it.
export type StartFrom = "goal" | "plan";
export const START_OPTIONS: StartFrom[] = ["goal", "plan"];
export const DEFAULT_START: StartFrom = "goal";

// Said in full because a plan start runs with no lead, and a user who is not told when one appears reads its
// absence as a broken launch.
export function startNote(start: StartFrom): string {
    return start === "goal"
        ? "A lead works the goal with you in its terminal, then hands the engine a plan."
        : "The engine runs the plan now. A lead starts only if something needs judgment: a question, a failure, a hung worker, a conflict or a failed Verify.";
}

export interface ShapeCard {
    id: RunShape;
    desc: string;
}

// The descriptions say what the machine does, not what the word means, in the design's words (design L1702).
export const SHAPE_CARDS: ShapeCard[] = [
    { id: "orchestrator", desc: "lead plans, workers fan out" },
    { id: "quick", desc: "one worker, one goal" },
];

export function clampParallelism(n: number): number {
    if (!Number.isFinite(n)) {
        return DEFAULT_PARALLELISM;
    }
    return Math.min(MAX_PARALLELISM, Math.max(1, Math.round(n)));
}

// What a channel's saved profile says about the launcher. Every field is nullable because a profile that is
// silent about one must leave the launcher's own default standing rather than silently replacing it — the
// same "no opinion" rule the lead route already follows.
export interface ProfileRunDefaults {
    shape: RunShape | null;
    parallelism: number | null;
    workerRoute: RoutePin | null;
    // not nullable: false is the profile's own answer (Same as lead or its worker route), not silence
    reviewerPicks: boolean;
    reviewerRoute: RoutePin | null;
}

export function profileRunDefaults(profile: JarvisProfile | null | undefined): ProfileRunDefaults {
    const mode = profile?.defaultmode ?? "";
    const width = profile?.parallelism ?? 0;
    return {
        // a pipeline default has no card to land on, so it leaves the launcher's baseline standing
        shape: mode === "quick" || mode === "orchestrator" ? mode : null,
        // a width only counts when it is a width; anything else is the profile saying nothing
        parallelism: width > 0 ? clampParallelism(width) : null,
        workerRoute: profile?.workerroute ?? null,
        reviewerPicks: profile?.reviewerpicks ?? false,
        reviewerRoute: profile?.reviewerroute ?? null,
    };
}

export interface RunLauncherFace {
    showStart: boolean;
    showParallelism: boolean;
    showWorkerRoute: boolean;
}

// The start, the width and the worker route belong to the orchestrator: parallelism and WorkerRoute are read
// only when the engine spawns dag children, and a quick run has no plan to start from.
export function runLauncherFace(shape: RunShape): RunLauncherFace {
    const orchestrator = shape === "orchestrator";
    return { showStart: orchestrator, showParallelism: orchestrator, showWorkerRoute: orchestrator };
}

// PlanPreview is the launcher's last reading of a plan path: its parsed shape, or the parser's refusal.
export interface PlanPreview {
    path: string;
    result?: CommandDagPlanPreviewRtnData;
    error?: string;
}

export interface LaunchBlockerInput {
    shape: RunShape;
    start: StartFrom;
    goal: string;
    planPath: string;
    preview: PlanPreview | null;
}

// launchBlocker says why a launch cannot start yet, or null when it can. A plan start waits for a preview of
// the exact path it will send, so a plan that will not parse is refused before anything is created.
export function launchBlocker(input: LaunchBlockerInput): string | null {
    if (input.shape === "orchestrator" && input.start === "plan") {
        const path = input.planPath.trim();
        if (path === "") {
            return "Give the plan's absolute path";
        }
        if (input.preview == null || input.preview.path !== path) {
            return "Reading the plan…";
        }
        return input.preview.error ?? null;
    }
    return input.goal.trim() === "" ? "Write the goal" : null;
}
