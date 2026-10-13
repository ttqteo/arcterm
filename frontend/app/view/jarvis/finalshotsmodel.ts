// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Final check's screenshots as data (.superpowers/design/final-shots: Main, Viewer, States boards). The engine
// copies each round's shots.json manifest, or a plain PNG listing, onto the dag (FinalStage.shots) and keeps every
// finished round in pastfinals; the run sheet row, the dock button and the viewer all read it from here.

export type ShotVerdict = "pass" | "fail" | "none"; // none: a plain listing entry
export type ShotScenario = { name: string; files: string[]; steps: FinalShotStep[]; verdict: ShotVerdict };
export type ShotRound = {
    round: number;
    state: string; // the stage's state: passed | unverified | failed
    outDir: string;
    manifest: boolean;
    scenarios: ShotScenario[]; // failed first, then the rest, each group in manifest order
    shotCount: number;
};
export type FinalCheckEntry = {
    tone: "pass" | "fail" | "warn"; // dot: passed / failed / unverified
    head: string;
    right: string;
    dockLabel: string;
    dockAccent: boolean; // latest round failed
    dockDisabled: boolean; // no shots
    strip: { name: string; file: string; verdict: ShotVerdict }[]; // one per scenario of the latest round, its first file
    caption: string | null; // the newest earlier failed round, when there is one
    latestRound: number;
};

const FINISHED_STATES = new Set(["passed", "unverified", "failed"]);
const TONES: Record<string, FinalCheckEntry["tone"]> = { passed: "pass", failed: "fail", unverified: "warn" };

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// "4", "4 and 5", "1, 2 and 3"
function joinAnd(items: string[]): string {
    return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function toScenario(shot: FinalShot, manifest: boolean): ShotScenario {
    const steps = shot.steps ?? [];
    const verdict: ShotVerdict = !manifest ? "none" : steps.some((st) => st.state === "fail") ? "fail" : "pass";
    return { name: shot.name, files: shot.files ?? [], steps, verdict };
}

function toRound(stage: FinalStage): ShotRound {
    const manifest = !!stage.shotsmanifest;
    const all = (stage.shots ?? []).map((shot) => toScenario(shot, manifest));
    const scenarios = [...all.filter((s) => s.verdict === "fail"), ...all.filter((s) => s.verdict !== "fail")];
    return {
        round: stage.round,
        state: stage.state,
        outDir: stage.outdir ?? "",
        manifest,
        scenarios,
        shotCount: scenarios.reduce((n, s) => n + s.files.length, 0),
    };
}

// finished rounds, oldest first
export function shotRounds(group: TaskGroup | null): ShotRound[] {
    if (group == null) {
        return [];
    }
    const stages = [...(group.pastfinals ?? [])];
    if (group.final != null && FINISHED_STATES.has(group.final.state)) {
        stages.push(group.final);
    }
    return stages.map(toRound);
}

function stepCounts(s: ShotScenario): { failed: number; skipped: number; ran: number } {
    const failed = s.steps.filter((st) => st.state === "fail").length;
    const skipped = s.steps.filter((st) => st.state === "skip").length;
    return { failed, skipped, ran: s.steps.length - skipped };
}

// "4/5", "1 failed, 4 of 5 passed, 1 skipped"; a plain listing entry has no steps to tally
export function scenarioTally(s: ShotScenario): { short: string; long: string } {
    if (s.verdict === "none") {
        return { short: "", long: "" };
    }
    const { failed, skipped, ran } = stepCounts(s);
    const long =
        (failed ? `${failed} failed, ` : "") +
        `${ran - failed} of ${ran} passed` +
        (skipped ? `, ${skipped} skipped` : "");
    return { short: `${ran - failed}/${ran}`, long };
}

// "40 of 42 steps passed, 4 skipped"; a plain listing counts its screenshots instead
export function roundTally(r: ShotRound): string {
    if (!r.manifest) {
        return plural(r.shotCount, "screenshot");
    }
    let failed = 0;
    let skipped = 0;
    let ran = 0;
    for (const s of r.scenarios) {
        const c = stepCounts(s);
        failed += c.failed;
        skipped += c.skipped;
        ran += c.ran;
    }
    return `${ran - failed} of ${ran} steps passed` + (skipped ? `, ${skipped} skipped` : "");
}

export function roundLabel(r: ShotRound): string {
    return `Round ${r.round} ${r.state}`;
}

export function shotPath(r: ShotRound, file: string): string {
    return `${r.outDir}/${file}`;
}

// guards a dag update that shrinks the round on screen; a round pick resets the selection instead
export function clampSelection(r: ShotRound, s: number, k: number): { s: number; k: number } {
    const clamp = (i: number, len: number) => Math.max(0, Math.min(i, len - 1));
    const si = clamp(s, r.scenarios.length);
    return { s: si, k: clamp(k, r.scenarios[si]?.files.length ?? 0) };
}

// ← → walk every screenshot of the round: past a scenario's last shot into the next scenario's first, before its first
// into the previous one's last. A plain listing is one shot per scenario, where stopping at the edge did nothing at all.
// Null at the round's ends.
export function stepShot(r: ShotRound, s: number, k: number, d: 1 | -1): { s: number; k: number } | null {
    if (k + d >= 0 && k + d < (r.scenarios[s]?.files.length ?? 0)) {
        return { s, k: k + d };
    }
    for (let si = s + d; si >= 0 && si < r.scenarios.length; si += d) {
        const n = r.scenarios[si].files.length;
        if (n > 0) {
            return { s: si, k: d === 1 ? 0 : n - 1 };
        }
    }
    return null;
}

function failedScenarios(r: ShotRound): ShotScenario[] {
    return r.scenarios.filter((s) => s.verdict === "fail");
}

function failingStepCount(s: ShotScenario): number {
    return s.steps.filter((st) => st.state === "fail").length;
}

function entryHead(r: ShotRound): string {
    const failed = failedScenarios(r);
    let what: string;
    if (failed.length === 1) {
        what = `${failed[0].name} ${plural(failingStepCount(failed[0]), "step")}`;
    } else if (failed.length > 1) {
        what = `${failed.length} scenarios failed`;
    } else if (r.shotCount === 0) {
        what = "no screenshots";
    } else if (r.manifest) {
        what = plural(r.scenarios.length, "scenario");
    } else {
        what = plural(r.shotCount, "screenshot");
    }
    return `${r.state} · ${what}`;
}

function entryRight(r: ShotRound, roundCount: number, pending: boolean): string {
    if (r.shotCount === 0) {
        return "";
    }
    const shots = plural(r.shotCount, "shot");
    if (pending) {
        return `${shots} · round ${r.round}`;
    }
    return roundCount > 1 ? `${shots} · ${roundCount} rounds` : shots;
}

// "Round 1 failed on jarvis-peek steps 4 and 5."
function failCaption(r: ShotRound): string {
    const parts = failedScenarios(r).map((s) => {
        const at = s.steps.flatMap((st, i) => (st.state === "fail" ? [String(i + 1)] : []));
        return `${s.name} ${at.length === 1 ? "step" : "steps"} ${joinAnd(at)}`;
    });
    return parts.length ? `Round ${r.round} failed on ${parts.join(", ")}.` : `Round ${r.round} failed.`;
}

export function finalCheckEntry(group: TaskGroup | null): FinalCheckEntry | null {
    if (!group?.finalcmd) {
        return null;
    }
    const rounds = shotRounds(group);
    if (rounds.length === 0) {
        return null;
    }
    const latest = rounds[rounds.length - 1];
    // a fix round's tasks are running, or the next round's commands or verifier are: the latest finished round
    // stays on show, named by its number, since a round can run for many minutes
    const pending = group.final != null && !FINISHED_STATES.has(group.final.state);
    const earlierFailed = rounds
        .slice(0, -1)
        .reverse()
        .find((r) => r.state === "failed");
    return {
        tone: TONES[latest.state] ?? "warn",
        head: entryHead(latest),
        right: entryRight(latest, rounds.length, pending),
        dockLabel: `Screenshots · ${latest.shotCount}`,
        dockAccent: latest.state === "failed",
        dockDisabled: latest.shotCount === 0,
        strip: latest.scenarios
            .filter((s) => s.files.length > 0)
            .map((s) => ({ name: s.name, file: s.files[0], verdict: s.verdict })),
        caption: earlierFailed ? failCaption(earlierFailed) : null,
        latestRound: latest.round,
    };
}
