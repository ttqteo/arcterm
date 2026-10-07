// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";

// Single owner of the 1s now-clock. Mounted once for the app lifetime (cockpit root) so every
// surface's age/quiet/countdown leaf reads a live nowAtom without each surface running its own
// interval. Previously three surfaces (cockpit, focus rail, usage) each ticked while the tick-less
// ones (sessions, app bar) silently froze their "now". It owns the coarse structural clock too: a
// surface re-rendering on it is cheap, and a quiescent fleet's idle-grace collapse, stream teardown and
// usage rollover still roll over on their own.
const STRUCTURAL_TICK_MS = 15000;

export function NowTicker({ model }: { model: AgentsViewModel }) {
    useEffect(() => {
        const t = setInterval(() => globalStore.set(model.nowAtom, Date.now()), 1000);
        const s = setInterval(() => globalStore.set(model.structuralNowAtom, Date.now()), STRUCTURAL_TICK_MS);
        return () => {
            clearInterval(t);
            clearInterval(s);
        };
    }, [model]);
    return null;
}
