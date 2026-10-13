// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The final stage as every site draws it: the Agent tree's row, the stage pane, the rails and the DAG's last
// node all read this one view. Derived from the dag's FinalStage and the run's final-step events, which alone
// keep a finished step's duration and result. No React, no store.

import type { AgentVM } from "./agentsviewmodel";
import { fmtDuration } from "./runcompletion";
import { detailOf } from "./runtimeline";

export type FinalStepKey = "tree" | "check" | "verify" | "final" | "verifier";
// notrun: the stage ended before it. stopped: a human ended the stage while it ran.
export type FinalStepState = "waiting" | "running" | "passed" | "failed" | "unverified" | "stopped" | "notrun";
export type FinalTone = "wait" | "run" | "pass" | "fail" | "warn";

export interface FinalStep {
    key: FinalStepKey;
    label: string;
    state: FinalStepState;
    tone: FinalTone;
    // a finished step's duration, or a running step's elapsed
    ms?: number;
    text: string;
    // the plan's own command; for tree and verifier, what the step does
    command: string;
    // where a command step that ended kept its output; ts is its end, so a rerun's output is not read from cache
    kept?: { path: string; ts: number };
}

export interface FinalRoundLine {
    round: number;
    tone: FinalTone;
    text: string;
}

export interface FinalStageView {
    // whether the tree has a row
    visible: boolean;
    round: number;
    // final.state, "" when not started
    state: string;
    tone: FinalTone;
    steps: FinalStep[];
    // the command step running; the verifier when only it runs
    running?: FinalStepKey;
    // the verifier works beside a running command
    alongside: boolean;
    // 1-based position of the running step, 0 when none
    stepIndex: number;
    // the running step's elapsed, or a finished stage's total
    elapsedMs?: number;
    // the round's time: since its start while it runs, the total once it has ended
    stageMs?: number;
    // ids of the tasks not done yet, in plan order
    waitsOn: string[];
    // final.output while a command runs, else ""
    output: string;
    detail: string;
    unverified: string[];
    // earlier rounds, oldest first
    past: FinalRoundLine[];
    subline: string;
    nodeMeta: string;
    headline: string;
    // "next Final, then the verifier"; "" when nothing follows
    next: string;
}

const FINAL_STEP_EVENT = "final-step";
// the engine's finalEndedByHuman, trimmed: what opens the reason of a stage a human ended
const ENDED_BY_HUMAN = "ended by the human:";
const RUNNING_STATES = new Set(["checking", "final", "verifying"]);
const TASK_FINISHED = new Set(["done", "skipped"]);

const LABELS: Record<FinalStepKey, string> = {
    tree: "Tree",
    check: "Check",
    verify: "Verify",
    final: "Final",
    verifier: "Verifier",
};
const WHAT_IT_DOES: Partial<Record<FinalStepKey, string>> = {
    tree: "prepares the tree the stage runs in",
    verifier: "judges the merged result",
};
const STEP_TONES: Record<FinalStepState, FinalTone> = {
    waiting: "wait",
    notrun: "wait",
    running: "run",
    passed: "pass",
    failed: "fail",
    unverified: "warn",
    stopped: "warn",
};
const STEP_WORDS: Record<FinalStepState, string> = {
    waiting: "waiting",
    notrun: "not run",
    running: "running",
    passed: "passed",
    failed: "failed",
    unverified: "unverified",
    stopped: "stopped",
};
const STAGE_TONES: Record<string, FinalTone> = {
    checking: "run",
    final: "run",
    verifying: "run",
    passed: "pass",
    failed: "fail",
    unverified: "warn",
};

// the steps whose output the engine keeps once they end (keepFinalStepOutput)
const KEPT_STEPS = new Set<FinalStepKey>(["check", "verify", "final"]);

/** Pure: where the engine keeps a round's finished step output, beside its ARC_FINAL_OUT (finalStepsDir in
 *  pkg/orchestrate/final.go). */
export function finalStepOutputPath(outDir: string, key: FinalStepKey): string {
    return `${outDir}-steps/${key}.txt`;
}

type StepEvent = { ts: number; ms: number; ok: boolean };
type StepEventDetail = { round?: number; step?: string; ms?: number; ok?: boolean };
type Commands = Pick<TaskGroup, "check" | "verify" | "finalcmd">;

function stepKeys(group: Commands): FinalStepKey[] {
    const commands = (["check", "verify", "final"] as const).filter((k) => commandOf(group, k) !== "");
    return commands.length > 0 ? ["tree", ...commands, "verifier"] : ["verifier"];
}

function commandOf(group: Commands, key: FinalStepKey): string {
    return finalStepCommand({ ...group, final: { state: "", round: 0, step: key } });
}

// the newest event of each of a round's steps: a restart reruns a step
function roundEvents(events: RunEvent[], round: number): Map<string, StepEvent> {
    const byStep = new Map<string, StepEvent>();
    for (const e of events) {
        if (e.kind !== FINAL_STEP_EVENT) {
            continue;
        }
        const d = detailOf<StepEventDetail>(e);
        if (d?.round !== round || !d.step || (byStep.get(d.step)?.ts ?? -Infinity) >= e.ts) {
            continue;
        }
        byStep.set(d.step, { ts: e.ts, ms: d.ms ?? 0, ok: d.ok === true });
    }
    return byStep;
}

function endedByHuman(stage: FinalStage): boolean {
    return [stage.detail ?? "", ...(stage.unverified ?? [])].some((s) => s.startsWith(ENDED_BY_HUMAN));
}

// the command step an ended stage stopped at, or -1 when its commands all ran and the verifier ended it
function endedAt(stage: FinalStage, group: Commands, commands: FinalStepKey[], evs: Map<string, StepEvent>): number {
    // with a Final command the verifier starts only once the commands are over
    if (group.finalcmd && stage.verifierrunid) {
        return -1;
    }
    if (endedByHuman(stage)) {
        return commands.findIndex((k) => evs.get(k)?.ok !== true);
    }
    if (stage.state === "unverified") {
        return evs.get("tree")?.ok === false ? commands.indexOf("tree") : -1;
    }
    // the engine opens a command's failure with its name; any other detail is the verifier's. The detail
    // decides first: a Check that could not verify is not ok either, yet the stage goes on past it
    const detail = stage.detail ?? "";
    if (detail !== "") {
        const named = /^(Check|Verify|Final) `/.exec(detail)?.[1];
        return commands.findIndex((k) => LABELS[k] === named);
    }
    const ran = commands.filter((k) => evs.has(k));
    const last = ran[ran.length - 1];
    return last != null && evs.get(last).ok === false ? commands.indexOf(last) : -1;
}

function stepStates(
    stage: FinalStage | undefined,
    group: Commands,
    keys: FinalStepKey[],
    evs: Map<string, StepEvent>
): FinalStepState[] {
    const commands = keys.slice(0, -1);
    // a step the stage went on past: not ok means it could not verify, since a failure ends the stage
    const settled = (k: FinalStepKey): FinalStepState => (evs.get(k)?.ok === false ? "unverified" : "passed");
    const state = stage?.state ?? "";
    if (state === "") {
        return keys.map(() => "waiting");
    }
    if (state === "passed") {
        return [...commands.map(settled), "passed"];
    }
    if (RUNNING_STATES.has(state)) {
        const reviewing = state === "verifying";
        const at = commands.indexOf(stage.step as FinalStepKey);
        const verifier = reviewing || (state === "checking" && !!stage.verifierrunid) ? "running" : "waiting";
        return [
            ...commands.map((k, i): FinalStepState => {
                if (reviewing || i < at || (at < 0 && evs.has(k))) {
                    return settled(k);
                }
                return i === at ? "running" : "waiting";
            }),
            verifier,
        ];
    }
    const ending: FinalStepState = endedByHuman(stage) ? "stopped" : state === "failed" ? "failed" : "unverified";
    const at = endedAt(stage, group, commands, evs);
    if (at < 0) {
        return [...commands.map(settled), ending];
    }
    return keys.map((k, i) => (i < at ? settled(k) : i === at ? ending : "notrun"));
}

function withTime(word: string, ms: number | undefined, sep = " "): string {
    return ms == null ? word : `${word}${sep}${fmtDuration(ms)}`;
}

function span(from: number | undefined, to: number | undefined): number | undefined {
    return from && to && to >= from ? to - from : undefined;
}

function buildSteps(
    stage: FinalStage | undefined,
    group: Commands,
    evs: Map<string, StepEvent>,
    now: number,
    verifierRun: Pick<Run, "completedts"> | undefined
): FinalStep[] {
    const keys = stepKeys(group);
    const states = stepStates(stage, group, keys, evs);
    // startedts is the verifier session's start only once there is one
    const verifierStart = stage?.verifierrunid ? stage.startedts : undefined;
    return keys.map((key, i) => {
        const state = states[i];
        let ms: number | undefined;
        if (key === "verifier") {
            ms =
                state === "running"
                    ? span(verifierStart, now)
                    : state !== "waiting" && state !== "notrun"
                      ? span(verifierStart, verifierRun?.completedts)
                      : undefined;
        } else if (state === "running") {
            ms = span(stage.stepts, now);
        } else if (state !== "waiting" && state !== "notrun") {
            ms = evs.get(key)?.ms;
        }
        const ended = evs.get(key);
        const kept =
            ended && stage?.outdir && KEPT_STEPS.has(key)
                ? { path: finalStepOutputPath(stage.outdir, key), ts: ended.ts }
                : undefined;
        return {
            key,
            label: LABELS[key],
            state,
            tone: STEP_TONES[state],
            ms,
            text: withTime(STEP_WORDS[state], ms),
            command: WHAT_IT_DOES[key] ?? commandOf(group, key),
            kept,
        };
    });
}

// how an ended stage reads in a line: "failed at Final", "unverified", "passed"
function outcomeText(stage: FinalStage, steps: FinalStep[]): string {
    if (stage.state !== "failed") {
        return stage.state;
    }
    const stopped = steps.find((s) => s.state === "stopped");
    if (stopped) {
        return `failed, stopped at ${stopped.label}`;
    }
    const failed = steps.find((s) => s.state === "failed");
    return failed ? `failed at ${failed.label}` : "failed";
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function joinDot(parts: (string | undefined)[]): string {
    return parts.filter(Boolean).join(" · ");
}

function nextText(steps: FinalStep[]): string {
    const names = steps
        .filter((s) => s.state === "waiting")
        .map((s) => (s.key === "verifier" ? "the verifier" : s.label));
    if (!steps.some((s) => s.state === "running") || names.length === 0) {
        return "";
    }
    return names.length === 1
        ? `next ${names[0]}`
        : `next ${names.slice(0, -1).join(", ")}, then ${names[names.length - 1]}`;
}

const HIDDEN: FinalStageView = {
    visible: false,
    round: 1,
    state: "",
    tone: "wait",
    steps: [],
    alongside: false,
    stepIndex: 0,
    waitsOn: [],
    output: "",
    detail: "",
    unverified: [],
    past: [],
    subline: "",
    nodeMeta: "",
    headline: "",
    next: "",
};

/** Pure: the final stage of a dag, for every site that draws it. verifierRun is the Run of the current
 *  round's verifier session, undefined while there is none or it has not loaded. */
export function finalStageView(
    group: TaskGroup | undefined,
    events: RunEvent[],
    now: number,
    verifierRun?: Pick<Run, "completedts">
): FinalStageView {
    const tasks = group?.tasks ?? [];
    if (group == null || tasks.length === 0) {
        return HIDDEN;
    }
    const stage = group.final;
    const round = stage?.round || 1;
    const state = stage?.state ?? "";
    const evs = roundEvents(events, round);
    const steps = buildSteps(stage, group, evs, now, verifierRun);
    const isRunning = RUNNING_STATES.has(state);
    const ended = state !== "" && !isRunning;

    const command = steps.find((s) => s.state === "running" && s.key !== "verifier");
    const verifier = steps[steps.length - 1];
    const verifierRunning = verifier.state === "running";
    const running = command ?? (verifierRunning ? verifier : undefined);
    const alongside = command != null && verifierRunning;

    const total = steps.every((s) => s.ms != null) ? steps.reduce((sum, s) => sum + s.ms, 0) : undefined;
    const starts = [...evs.values()].map((e) => e.ts - e.ms);
    // with commands and no event left, startedts may already be the verifier's start, not the round's
    const startedTs = stage?.verifierrunid && steps.length > 1 ? undefined : stage?.startedts;
    const roundStart = starts.length > 0 ? Math.min(...starts) : startedTs;

    const waitsOn = tasks.filter((t) => !TASK_FINISHED.has(t.state)).map((t) => t.id);
    const roundText = `round ${round}`;
    const outcome = ended ? outcomeText(stage, steps) : "";
    const reasons = stage?.unverified ?? [];

    let subline: string;
    let nodeMeta: string;
    let headline: string;
    if (command) {
        const time = command.ms == null ? undefined : fmtDuration(command.ms);
        const position = `step ${steps.indexOf(command) + 1} of ${steps.length}`;
        subline = joinDot([command.label, time, alongside ? "verifier alongside" : position]);
        nodeMeta = joinDot([roundText, command.label, alongside ? "verifier" : time]);
        headline = joinDot([roundText, finalStageActivity(stage), time]);
    } else if (running) {
        const time = running.ms == null ? undefined : fmtDuration(running.ms);
        subline = joinDot(["verifier reviewing", time]);
        nodeMeta = joinDot([roundText, "verifier", time]);
        headline = joinDot([roundText, "verifier reviewing", time]);
    } else if (isRunning) {
        // between two commands the stage names no step
        subline = "starting";
        nodeMeta = headline = joinDot([roundText, "starting"]);
    } else if (state === "failed") {
        subline = joinDot([outcome, roundText]);
        nodeMeta = headline = joinDot([roundText, outcome]);
    } else if (state === "unverified") {
        subline = joinDot(["unverified", reasons.length > 0 ? plural(reasons.length, "reason") : undefined]);
        nodeMeta = headline = joinDot([roundText, "unverified"]);
    } else if (ended) {
        const time = total == null ? undefined : fmtDuration(total);
        subline = joinDot([state, time]);
        nodeMeta = headline = joinDot([roundText, state, time]);
    } else if (round > 1) {
        subline = waitsOn.length > 0 ? `${roundText} after ${plural(waitsOn.length, "fix task")}` : roundText;
        nodeMeta = headline = waitsOn.length > 0 ? `${roundText} waits on ${waitsOn.join(", ")}` : roundText;
    } else if (waitsOn.length > 0) {
        subline = `after ${plural(waitsOn.length, "more task")}`;
        nodeMeta = headline = "waits on every task";
    } else {
        subline = "starting";
        nodeMeta = headline = joinDot([roundText, "starting"]);
    }

    const past = [...(group.pastfinals ?? [])]
        .sort((a, b) => a.round - b.round)
        .map((p): FinalRoundLine => {
            const pastSteps = buildSteps(p, group, roundEvents(events, p.round), now, undefined);
            return {
                round: p.round,
                tone: STAGE_TONES[p.state] ?? "wait",
                text: joinDot([`round ${p.round}`, outcomeText(p, pastSteps)]),
            };
        });

    return {
        visible: group.status === "finalizing" || state !== "" || round > 1,
        round,
        state,
        tone: STAGE_TONES[state] ?? "wait",
        steps,
        running: running?.key,
        alongside,
        stepIndex: running ? steps.indexOf(running) + 1 : 0,
        elapsedMs: running ? running.ms : ended ? total : undefined,
        stageMs: isRunning ? span(roundStart, now) : ended ? total : undefined,
        waitsOn,
        output: command ? (stage.output ?? "") : "",
        detail: stage?.detail ?? "",
        unverified: reasons,
        past,
        subline,
        nodeMeta,
        headline,
        next: nextText(steps),
    };
}

// final.step: the plan command the final stage is running
const FINAL_STEP_LABELS: Record<string, string> = {
    tree: "preparing the tree",
    check: "running Check",
    verify: "running Verify",
    final: "running Final",
};

/** Pure: what a running final stage is doing, or undefined when it is not running. With no Final command the
 *  verifier works alongside Check and Verify, so both show. */
export function finalStageActivity(final: FinalStage | undefined): string | undefined {
    if (final?.state === "verifying") {
        return "verifier reviewing";
    }
    if (final?.state !== "checking" && final?.state !== "final") {
        return undefined;
    }
    const step = FINAL_STEP_LABELS[final.step ?? ""] ?? "starting";
    return final.state === "checking" && final.verifierrunid ? `${step} · verifier alongside` : step;
}

/** Pure: the plan's own command behind the final stage's running step, so the label stays generic and the
 *  detail is whatever this project runs. */
export function finalStepCommand(group: Pick<TaskGroup, "check" | "verify" | "finalcmd" | "final">): string {
    switch (group.final?.step) {
        case "check":
            return group.check ?? "";
        case "verify":
            return group.verify ?? "";
        case "final":
            return group.finalcmd ?? "";
        default:
            return "";
    }
}

const FINAL_STAGE_PREFIX = "final:";

// finalStageId is what the stage's row is focused by while no verifier session stands for it.
export function finalStageId(runId: string): string {
    return `${FINAL_STAGE_PREFIX}${runId}`;
}

export function isFinalStageId(id: string): boolean {
    return id.startsWith(FINAL_STAGE_PREFIX);
}

export function finalStageRunId(id: string): string | undefined {
    return isFinalStageId(id) ? id.slice(FINAL_STAGE_PREFIX.length) : undefined;
}

/** Pure: the id a click on the row focuses: the current round's verifier agent when it is in the roster, else
 *  the stage's own. A tab an earlier round's verifier left is not the row. */
export function finalRowFocusId(
    run: { runId: string; dag?: TaskGroup },
    agents: Pick<AgentVM, "id" | "runId">[]
): string {
    const verifierRunId = run.dag?.final?.verifierrunid;
    const agent = verifierRunId ? agents.find((a) => a.runId === verifierRunId) : undefined;
    return agent?.id ?? finalStageId(run.runId);
}

/** Pure: whether a step's output can be opened: a command running, or one that ended and kept its output. */
export function stepHasOutput(step: FinalStep): boolean {
    return step.kept != null || (step.state === "running" && KEPT_STEPS.has(step.key));
}

/** Pure: the step whose output a site shows: the one picked while it has output to open, else the running command
 *  once it has printed. */
export function shownStep(view: FinalStageView, picked: FinalStepKey | null): FinalStep | undefined {
    const pick = view.steps.find((s) => s.key === picked && stepHasOutput(s));
    return pick ?? (view.output !== "" ? view.steps.find((s) => s.key === view.running) : undefined);
}

/** Pure: the last `lines` lines of a command's output. */
export function outputTail(output: string, lines: number): string {
    if (lines <= 0) {
        return "";
    }
    return output.replace(/\s+$/, "").split(/\r?\n/).slice(-lines).join("\n");
}
