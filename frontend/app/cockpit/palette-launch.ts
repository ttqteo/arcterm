// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure builder for the palette's "Start in #project" block: the ways to act on typed text that names
// nothing. The typed query is the *goal*, not a filter — these rows are never ranked. The component
// injects the impure deps and renders LaunchItem's presentational fields.

import type { RunShape } from "@/app/view/agents/runconfig";

export type LaunchIcon = "quick" | "orchestrate" | "ask";

export interface LaunchItem {
    key: string; // launch:quick | launch:orchestrate | launch:consult:<runtime>
    icon: LaunchIcon;
    title: string;
    desc: string; // mono subtitle describing the mode
    verb: "Open" | "Ask";
    echo: string; // one-line echo of what firing this row does to the goal
    run: () => void;
    alt?: { echo: string; run: () => void }; // Mod+Enter
    chord?: string; // the key that reaches this row from anywhere in the block
}

export interface LaunchDeps {
    // the New run window, prefilled: its project picker is where the project is settled, so a run never
    // starts in a project the palette guessed
    open: (goal: string, shape: RunShape) => void;
    consult: (runtime: string, goal: string) => void; // one-shot answer, no worker
}

// claude and pi are the runtimes this cockpit actually runs; the second row is the second opinion
export const CONSULT_RUNTIMES = ["claude", "pi"] as const;

// Empty goal -> []. Otherwise the run rows, Quick first (preselected by the caller), and with a project the
// ask rows, which post into that project's channel and so cannot go without one. Ctrl+Enter orchestrates
// from any of them, so Orchestrate is one chord rather than a trip down the list.
export function buildLaunchItems(query: string, projectName: string | undefined, deps: LaunchDeps): LaunchItem[] {
    const goal = query.trim();
    if (!goal) {
        return [];
    }
    const where = projectName ? `, #${projectName} preselected` : "";
    const orchestrate = {
        echo: "Opens an orchestrator run instead",
        run: () => deps.open(goal, "orchestrator"),
    };
    const runs: LaunchItem[] = [
        {
            key: "launch:quick",
            icon: "quick",
            title: "Quick",
            desc: "one worker, no plan",
            verb: "Open",
            echo: `Opens the New run window with “${goal}” as a Quick run${where}`,
            run: () => deps.open(goal, "quick"),
            alt: orchestrate,
        },
        {
            key: "launch:orchestrate",
            icon: "orchestrate",
            title: "Orchestrate",
            desc: "a lead plans tasks, workers run them",
            verb: "Open",
            echo: `Opens the New run window with “${goal}” as an orchestrator run${where}`,
            run: orchestrate.run,
            chord: "Mod:Enter",
        },
    ];
    if (!projectName) {
        return runs;
    }
    const [primary, second] = CONSULT_RUNTIMES;
    return [
        ...runs,
        {
            key: `launch:consult:${primary}`,
            icon: "ask",
            title: `Ask · ${primary}`,
            desc: "one-shot answer, no worker",
            verb: "Ask",
            echo: `Asks ${primary} about “${goal}”, nothing is spawned`,
            run: () => deps.consult(primary, goal),
            alt: orchestrate,
        },
        {
            key: `launch:consult:${second}`,
            icon: "ask",
            title: `Ask · ${second}`,
            desc: `a second opinion from ${second}`,
            verb: "Ask",
            echo: `Asks ${second} about “${goal}”, nothing is spawned`,
            run: () => deps.consult(second, goal),
            alt: orchestrate,
        },
    ];
}
