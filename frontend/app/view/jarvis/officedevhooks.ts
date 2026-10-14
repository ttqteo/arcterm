// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DEV-only seam for the run office's CDP scenarios (jarvis-office, jarvis-office-bench, jarvis-office-floor), installed
// by BriefSurface and never imported in a production build. __officeFixture hands the model made-up runs, so a scenario
// can draw every state and the bench can draw 104 desks without starting real workers. __officeJarvis hands Jarvis's
// floor a made-up roster, posture and clock. __officeProbe reads what the bench budgets.

import { globalStore } from "@/app/store/jotaiStore";
import { officeFloor, type OfficeRun } from "./officemodel";
import { OFFICE_TOKENS, spriteCacheSize } from "./officesprites";
import { jarvisFixtureAtom, officeClockRunning, officeFixtureAtom, type JarvisFixture } from "./officeview";

type FixtureRun = {
    title: string;
    run: OfficeRun;
    agents?: { id: string; runId: string; state: "asking" | "working" | "idle" }[];
};

export function installOfficeDevHooks(): void {
    const w = window as unknown as {
        __officeFixture?: (runs: FixtureRun[] | null) => void;
        __officeJarvis?: (fixture: JarvisFixture | null) => void;
        __officeProbe?: () => { cache: number; clock: boolean; desks: number; floors: number; unresolved: string[] };
    };
    w.__officeFixture = (runs) =>
        globalStore.set(
            officeFixtureAtom,
            runs == null ? null : runs.map((r) => ({ title: r.title, floor: officeFloor(r.run, r.agents ?? []) }))
        );
    w.__officeJarvis = (fixture) => globalStore.set(jarvisFixtureAtom, fixture);
    w.__officeProbe = () => {
        const style = getComputedStyle(document.documentElement);
        return {
            cache: spriteCacheSize(),
            clock: officeClockRunning(),
            desks: document.querySelectorAll("[data-office-desk]").length,
            floors: document.querySelectorAll("[data-office-floor]").length,
            // a token Tailwind dropped for want of a literal use reads back empty and its person draws without it
            unresolved: OFFICE_TOKENS.filter((name) => style.getPropertyValue(name).trim() === ""),
        };
    };
}
