// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Jarvis's condition is: one expression and one posture, from signals the rest of the app already
// computes. Pure — no atoms, no pixels, no React. That separation is what makes petview.tsx a swappable
// renderer rather than the thing that decides (design §5).
//
// The precedence is strict and lives here and nowhere else (design §3):
//   1 tired — a rate-limit window depleting, the 5-hour or the weekly one. Cyclical, legible within a day, and
//     not your fault. The only condition the creature wears.
//   2 ram-full — no more worker fits in free RAM (workercapacity.ts). A peek line only: on an 8 GB Mac the reserve
//     for one heavy job keeps it on nearly all day, and wearing it made the tired look mean nothing.
// Nothing present => at-rest.
//
// Every input field is optional, and an absent field is "no signal" — never "signal absent". That
// distinction is load-bearing rather than pedantic: a source that has not answered yet cannot present here
// as a clean bill of health.

import { formatReset, usageLevel } from "@/app/view/agents/agentsviewmodel";
import { providerLabel } from "@/app/view/agents/cockpitrailmodel";
import { formatGB } from "@/app/view/agents/workercapacity";

export interface PetSignals {
    // rank 1: highest 5-hour utilisation across providers (0..100). `resetAt` is epoch SECONDS, matching
    // AgentUsage.fivehourreset and formatReset — the whole cockpit carries this window in seconds.
    // `provider` is required because the reading is per-provider and the highest wins: unnamed, a codex
    // window reads as a claude one, and the countdown belongs to whichever provider won.
    // `window` is whichever of the provider's two windows is tighter (petquota.ts tightestWindow).
    rateLimit?: { provider: string; window: QuotaWindow; pct: number; resetAt?: number };
    // rank 1: the worker-capacity reading (GetWorkerCapacityCommand), in bytes. `more` is how many more
    // workers fit; 0 is a full RAM. perWorker is a typical worker, heavy the heaviest job, reserve the room held
    // back for the live workers' growth and one heavy job (pkg/workercap).
    memory?: { more: number; available: number; perWorker: number; heavy: number; reserve: number };
    // posture: kinds only. The creature never renders a count — the nav badge owns that (design §3).
    attention?: { reviewGates: number; escalations: number; blockedWorkers: number };
}

export type QuotaWindow = "5h" | "week";

export type PetExpression =
    | { kind: "ram-full"; available: number; perWorker: number; heavy: number; reserve: number }
    | { kind: "tired"; provider: string; window: QuotaWindow; pct: number; resetAt?: number }
    | { kind: "at-rest" };

export type PetPosture = "review-gate" | "escalation" | "blocked-worker" | "none";

// The rank of each expression, exported so the precedence is assertable rather than inferred from the
// order of ifs below.
export const EXPRESSION_RANK: Record<PetExpression["kind"], number> = {
    tired: 1,
    "ram-full": 2,
    "at-rest": 3,
};

// The tired look (slow walk, long rests, the sweat drop) means the quota and nothing else.
export function wearsTired(kind: PetExpression["kind"]): boolean {
    return kind === "tired";
}

// tiredness starts where the cockpit's own usage bands stop being "ok" (>60%), so every consumer reports
// the same window honestly even when a higher-priority expression owns the creature.
export function isWindowConstrained(rateLimit: PetSignals["rateLimit"]): boolean {
    return rateLimit != null && usageLevel(rateLimit.pct) !== "ok";
}

// Every standing condition, ranked. The creature wears one face, but the peek lists them all — stating only
// the winner is what made the old panel print the loser a second time as a tile. at-rest is never a member:
// an empty list is how quiet is spelled.
export function conditionsFor(signals: PetSignals): PetExpression[] {
    const out: PetExpression[] = [];
    const rl = signals.rateLimit;
    if (rl != null && isWindowConstrained(rl)) {
        out.push({ kind: "tired", provider: rl.provider, window: rl.window, pct: rl.pct, resetAt: rl.resetAt });
    }
    const mem = signals.memory;
    if (mem != null && mem.more <= 0) {
        out.push({
            kind: "ram-full",
            available: mem.available,
            perWorker: mem.perWorker,
            heavy: mem.heavy,
            reserve: mem.reserve,
        });
    }
    return out;
}

// The face the creature wears: the highest-ranked condition it wears, or at-rest. Delegating rather than
// repeating the predicates keeps the corner and the panel from disagreeing: when the creature wears a
// condition, the peek's lead line IS this.
export function expressionFor(signals: PetSignals): PetExpression {
    return conditionsFor(signals).find((c) => wearsTired(c.kind)) ?? { kind: "at-rest" };
}

// Gate before escalation before ask, which is the order pkg/jarvis/attention.go itself sorts by ("a gate
// blocks a whole pipeline, an ask blocks one worker"). Reading it back differently here would make the
// creature and the Needs-you rail disagree about which waiting matters most.
export function postureFor(signals: PetSignals): PetPosture {
    const a = signals.attention;
    if (a == null) {
        return "none";
    }
    if (a.reviewGates > 0) {
        return "review-gate";
    }
    if (a.escalations > 0) {
        return "escalation";
    }
    if (a.blockedWorkers > 0) {
        return "blocked-worker";
    }
    return "none";
}

export const WINDOW_NAME: Record<QuotaWindow, string> = { "5h": "5-hour window", week: "weekly window" };

// First person, because the creature is Jarvis with a face rather than a separate character (design §2).
// Here rather than in the renderer so the bubble and the peek cannot word the same condition differently.
export function conditionLine(expr: PetExpression, nowMs: number): string {
    switch (expr.kind) {
        case "ram-full":
            return `RAM is tight: ${formatGB(expr.available)} free, and one more worker needs ${formatGB(expr.reserve + expr.perWorker)} (room for a heavy job like tsc, ~${formatGB(expr.heavy)}).`;
        case "tired": {
            const pct = Math.round(expr.pct);
            const who = providerLabel(expr.provider);
            const window = WINDOW_NAME[expr.window];
            const back = expr.resetAt != null ? formatReset(expr.resetAt, nowMs) : null;
            // a window at 100 is not running low, it is gone. Reading the same at 86% and at 100%
            // understates the one state where there is nothing left to spend.
            if (pct >= 100) {
                return back != null ? `${who}'s ${window} is spent. Back in ${back}.` : `${who}'s ${window} is spent.`;
            }
            return back != null
                ? `Running low on ${who}: ${pct}% of the ${window} used, back in ${back}.`
                : `Running low on ${who}: ${pct}% of the ${window} used.`;
        }
        case "at-rest":
            return "Nothing needs saying.";
    }
}

const POSTURE_LINE: Record<PetPosture, string> = {
    "review-gate": "A review gate is waiting on you.",
    escalation: "Something escalated to you.",
    "blocked-worker": "A worker is blocked on your reply.",
    none: "",
};

export function postureLine(posture: PetPosture): string {
    return POSTURE_LINE[posture];
}
