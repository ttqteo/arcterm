// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run office's floor (run office spec): who sits at which desk, in which pose, saying what. Pure, so every
// engine state is a table row a test can read; officeview.tsx draws a Floor and decides nothing.
//
// A desk's pose is the task's engine state (pkg/orchestrate/dag.go), except that an agent at a prompt raises its hand:
// a question waiting on the person outranks whatever the task is doing. Every desk carries a label in words, so no
// state is told by pose or colour alone.

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import type { RunStageKey } from "@/app/view/agents/runstage";
import type { DeskPose } from "./officesprite";

export type { DeskPose };
export type DeskScreen = "off" | "note" | "prompt" | "lines" | "diff" | "wait" | "fail" | "conflict" | "bar" | "check";
export type DeskTone = "muted" | "working" | "asking" | "error" | "done";

export interface Desk {
    key: string; // the task id, or "lead"
    state: string; // the engine state, or the run stage for the lead
    pose: DeskPose;
    visitor: boolean; // a reviewer stands behind with a clipboard
    screen: DeskScreen;
    bubble: string; // "" for none
    tone: DeskTone;
    dim: boolean;
    animated: boolean; // reads the frame clock
    label: string;
    tip: string;
    shirt: number; // graphlane slot 1..6; 0 is the lead's shirt
    look: number; // skin and hair 1..4
    agentId?: string; // the tab a click opens
}

export interface Floor {
    runId: string;
    lead: Desk;
    desks: Desk[];
    board: DeskTone[]; // the lead's wall board, a square per task
}

export interface OfficeRun {
    runId: string;
    stage: RunStageKey;
    tasks: Pick<TaskNode, "id" | "label" | "state" | "runid" | "reviewrunid">[];
}

type OfficeAgent = Pick<AgentVM, "id" | "runId" | "state">;
type Look = Pick<Desk, "pose" | "visitor" | "screen" | "bubble" | "tone" | "dim"> & { word: string };

const look = (word: string, l: Partial<Look> & Pick<Look, "pose" | "screen">): Look => ({
    word,
    visitor: false,
    bubble: "",
    tone: "muted",
    dim: false,
    ...l,
});

const TASK_LOOK: Record<string, Look> = {
    pending: look("waits", { pose: "empty", screen: "note", dim: true }),
    ready: look("starting", { pose: "stand", screen: "prompt" }),
    running: look("typing", { pose: "type", screen: "lines", tone: "working" }),
    stalled: look("stalled", { pose: "slump", screen: "wait", bubble: "?", tone: "asking" }),
    reviewing: look("in review", { pose: "lean", visitor: true, screen: "diff" }),
    "review-failed": look("review failed", { pose: "hands", screen: "fail", bubble: "!", tone: "error" }),
    "blocked-merge": look("merge blocked", { pose: "box", screen: "conflict", bubble: "⇄", tone: "error" }),
    verifying: look("verifying", { pose: "box", screen: "bar", tone: "working" }),
    "verify-failed": look("verify failed", { pose: "hands", screen: "fail", bubble: "×", tone: "error" }),
    done: look("done", { pose: "lean", screen: "check", tone: "done" }),
    failed: look("failed", { pose: "hands", screen: "fail", bubble: "×", tone: "error" }),
    cancelled: look("cancelled", { pose: "empty", screen: "off", dim: true }),
    skipped: look("skipped", { pose: "empty", screen: "off", dim: true }),
};

/** Every engine task state the office draws: pending, then the live ones, then the closed ones. */
export const TASK_STATES = Object.keys(TASK_LOOK);

// a worker or reviewer is at the desk only from ready through verify-failed; a pending, done or closed desk opens the
// run (spec "Click"), even while the finished worker's tab is still in the roster
const LIVE_STATES = new Set(TASK_STATES.slice(TASK_STATES.indexOf("ready"), TASK_STATES.indexOf("verify-failed") + 1));

const LEAD_LOOK: Record<RunStageKey, Look> = {
    planning: look("planning", { pose: "type", screen: "lines" }),
    "plan-review": look("plan review", { pose: "lean", visitor: true, screen: "diff" }),
    working: look("watching", { pose: "lean", screen: "lines", tone: "working" }),
    "final-check": look("final check", { pose: "box", screen: "bar", tone: "working" }),
    "wrapping-up": look("wrapping up", { pose: "type", screen: "lines", tone: "working" }),
    landing: look("landing", { pose: "box", screen: "bar", tone: "working" }),
    "land-held": look("land held", { pose: "hands", screen: "fail", bubble: "!", tone: "error" }),
    landed: look("landed", { pose: "empty", screen: "check", tone: "done", dim: true }),
    complete: look("complete", { pose: "empty", screen: "check", tone: "done", dim: true }),
    cancelled: look("cancelled", { pose: "empty", screen: "off", dim: true }),
};

const ASKING: Omit<Look, "word"> = {
    pose: "handup",
    visitor: false,
    screen: "wait",
    bubble: "!",
    tone: "asking",
    dim: false,
};

function hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h;
}

function desk(
    key: string,
    state: string,
    l: Look,
    asking: boolean,
    label: string,
    tip: string,
    shirt: number,
    agentId: string | undefined
): Desk {
    const shown = asking ? { ...l, ...ASKING } : l;
    return {
        key,
        state,
        pose: shown.pose,
        visitor: shown.visitor,
        screen: shown.screen,
        bubble: shown.bubble,
        tone: shown.tone,
        dim: shown.dim,
        animated: shown.pose === "type" || shown.pose === "handup" || shown.screen === "bar",
        label: asking ? "Needs you" : label,
        tip: tip + (agentId ? " Click to open its terminal." : " Click to open the run."),
        shirt,
        look: (hash(key) % 4) + 1,
        agentId,
    };
}

/** A run's floor: its lead by the run's stage, and a desk per dag task in task order. */
export function officeFloor(run: OfficeRun, agents: OfficeAgent[]): Floor {
    const byRun = new Map<string, OfficeAgent>();
    for (const a of agents) {
        if (a.runId) {
            byRun.set(a.runId, a);
        }
    }
    const desks = run.tasks.map((t, i) => {
        const l = TASK_LOOK[t.state] ?? look(t.state, { pose: "empty", screen: "off", dim: true });
        const worker = t.runid ? byRun.get(t.runid) : undefined;
        const reviewer = t.reviewrunid ? byRun.get(t.reviewrunid) : undefined;
        const asking = worker?.state === "asking" || reviewer?.state === "asking";
        const n = i + 1;
        return desk(
            t.id,
            t.state,
            l,
            asking,
            `${n} · ${l.word}`,
            `Task ${n} · ${t.label || t.id} · ${asking ? "needs you" : l.word}.`,
            (i % 6) + 1,
            asking || LIVE_STATES.has(t.state) ? (worker ?? reviewer)?.id : undefined
        );
    });
    const leadAgent = byRun.get(run.runId);
    const ll = LEAD_LOOK[run.stage];
    const leadAsking = leadAgent?.state === "asking";
    const lead = desk(
        "lead",
        run.stage,
        ll,
        leadAsking,
        `lead · ${ll.word}`,
        `Lead · ${leadAsking ? "needs you" : ll.word}.`,
        0,
        leadAgent?.id
    );
    return { runId: run.runId, lead, desks, board: desks.map((d) => d.tone) };
}

// The Jarvis floor (run office spec, "Jarvis's floor"): Jarvis in the corner office, and a desk for every agent no run
// spawned. It is drawn whenever the office is on, so the office is never empty, and the creature sits here instead of
// walking the footer: there is one Jarvis.

export type JarvisActivity = "watch" | "tired" | "work" | "sleep" | "read" | "music" | "ball";

/** What Jarvis does at the desk with nothing else going on, a new one every PASTIME_MS. */
export const JARVIS_PASTIMES = ["read", "music", "ball"] as const;
export const PASTIME_MS = 3 * 60_000;
/** The empty desks of a floor with no agent at all, so it still reads as an office. */
export const FREE_DESKS = 3;

const JARVIS_WORD: Record<JarvisActivity, string> = {
    watch: "on watch",
    tired: "tired",
    work: "working",
    sleep: "asleep",
    read: "reading",
    music: "music",
    ball: "playing ball",
};

const JARVIS_TONE: Partial<Record<JarvisActivity, DeskTone>> = { watch: "asking", work: "working" };

export interface JarvisSeat {
    activity: JarvisActivity;
    label: string;
    tip: string;
    tone: DeskTone;
    night: boolean;
}

export interface JarvisFloor {
    jarvis: JarvisSeat;
    desks: Desk[];
}

export type DirectAgent = Pick<AgentVM, "id" | "name" | "state" | "runId" | "kind" | "sleeping">;

export interface JarvisInput {
    agents: DirectAgent[];
    // the creature's posture is not "none": a review gate, an escalation or a worker at a prompt (petcondition.ts)
    watch: boolean;
    // the creature's tired expression: a plan window nearly used
    tired: boolean;
    now: Date;
}

const isNight = (hour: number) => hour >= 23 || hour < 7;

/** The agents that get a desk on Jarvis's floor: the ones no run spawned, never a terminal or a background agent. */
export function directAgents<T extends DirectAgent>(agents: T[]): T[] {
    return agents.filter((a) => !a.runId && a.kind !== "terminal" && a.kind !== "background");
}

// Something waiting on you comes first, then the quota, then the agents at work (Jarvis works when they do, at any
// hour), then the night; otherwise a pastime, a new one every PASTIME_MS.
export function jarvisActivity(input: { watch: boolean; tired: boolean; working: boolean; now: Date }): JarvisActivity {
    if (input.watch) {
        return "watch";
    }
    if (input.tired) {
        return "tired";
    }
    if (input.working) {
        return "work";
    }
    if (isNight(input.now.getHours())) {
        return "sleep";
    }
    return JARVIS_PASTIMES[Math.floor(input.now.getTime() / PASTIME_MS) % JARVIS_PASTIMES.length];
}

const AGENT_LOOK = {
    working: look("typing", { pose: "type", screen: "lines", tone: "working" }),
    idle: look("idle", { pose: "lean", screen: "prompt" }),
    asleep: look("asleep", { pose: "empty", screen: "off", dim: true }),
};
const AGENT_RANK: Record<DirectAgent["state"], number> = { asking: 0, working: 1, idle: 2 };

/** Jarvis's floor: Jarvis by what is going on, then a desk per direct agent (asking, working, idle), or free desks. */
export function jarvisFloor(input: JarvisInput): JarvisFloor {
    const mine = directAgents(input.agents);
    const asking = mine.some((a) => a.state === "asking");
    const activity = jarvisActivity({
        watch: input.watch || asking,
        tired: input.tired,
        working: mine.some((a) => a.state === "working"),
        now: input.now,
    });
    const word = JARVIS_WORD[activity];
    const jarvis: JarvisSeat = {
        activity,
        label: `jarvis · ${word}`,
        tip: `Jarvis · ${activity === "watch" ? "something waits on you" : word}. Click to open Jarvis.`,
        tone: JARVIS_TONE[activity] ?? "muted",
        night: isNight(input.now.getHours()),
    };
    const sorted = mine
        .map((a, i) => ({ a, i }))
        .sort((x, y) => AGENT_RANK[x.a.state] - AGENT_RANK[y.a.state] || x.i - y.i)
        .map((x) => x.a);
    const desks = sorted.map((a, i) => {
        const l = a.sleeping != null ? AGENT_LOOK.asleep : a.state === "working" ? AGENT_LOOK.working : AGENT_LOOK.idle;
        const name = a.name || a.id;
        const isAsking = a.state === "asking";
        return desk(
            a.id,
            a.sleeping != null ? "asleep" : a.state,
            l,
            isAsking,
            `${name} · ${l.word}`,
            `${name} · ${isAsking ? "needs you" : l.word}.`,
            (i % 6) + 1,
            a.id
        );
    });
    if (desks.length === 0) {
        for (let i = 0; i < FREE_DESKS; i++) {
            const free = desk(
                `free-${i + 1}`,
                "free",
                AGENT_LOOK.asleep,
                false,
                "free desk",
                "",
                (i % 6) + 1,
                undefined
            );
            desks.push({ ...free, tip: "A free desk. Click to start an agent." });
        }
    }
    return { jarvis, desks };
}
