// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a tour step opens before it shows: the Profile through its atom, the newest run's sheet through the router,
// and an initiative's card by clicking it, the way a person opens one. Covered by the jarvis-tour CDP scenario, not
// by unit tests.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { fireAndForget } from "@/util/util";
import { briefProfileAtom, briefRunListAtom, briefSheetOpenAtom } from "./jarvisstore";
import type { TourPrepare, TourStep } from "./jarvistour";
import { openAddress } from "./openref";

function click(selector: string): boolean {
    const el = document.querySelector<HTMLElement>(selector);
    el?.click();
    return el != null;
}

export function openPrepare(p: TourPrepare, model: AgentsViewModel): boolean {
    switch (p) {
        case "profile":
            if (globalStore.get(briefProfileAtom) != null) {
                return false;
            }
            globalStore.set(briefProfileAtom, "");
            return true;
        case "newestRun": {
            if (globalStore.get(briefSheetOpenAtom)) {
                return false;
            }
            // the run the Brief lists first: its live runs in row order, which the sheet's Previous / Next step
            // through. openAddress reports a run it cannot open; the steps then show as centered cards
            const runId = globalStore.get(briefRunListAtom)[0];
            if (runId != null) {
                fireAndForget(() => openAddress(model, `run:${runId}`));
                return true;
            }
            // no live run: the first Shipped row that opens a sheet ([data-peek]), through the same router
            return click('[data-jarvis-brief-row="shipped"][data-peek]');
        }
        case "firstInitiative":
            if (document.querySelector('[data-jarvis-initiative-card="open"]') != null) {
                return false;
            }
            return click('[data-jarvis-initiative-card="closed"] > [role="button"]');
    }
}

export function closePrepare(p: TourPrepare): void {
    switch (p) {
        case "profile":
            globalStore.set(briefProfileAtom, null);
            return;
        case "newestRun":
            globalStore.set(briefSheetOpenAtom, false);
            return;
        case "firstInitiative":
            click('[data-jarvis-initiative-card="open"] > [role="button"]');
            return;
    }
}

/** The rects a step lights: the first of its target alternatives that matches, then the first match of each `also`. */
export function targetRects(step: TourStep): DOMRect[] {
    const main = (step.target ?? []).map((sel) => document.querySelector(sel)).find((e) => e != null);
    const also = (step.also ?? []).map((sel) => document.querySelector(sel));
    return [main, ...also].filter((e): e is Element => e != null).map((e) => e.getBoundingClientRect());
}
