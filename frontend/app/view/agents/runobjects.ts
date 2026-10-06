// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The run object and dag of each orchestrator run a list draws, read from the object store (each loaded on its first
// read), for runView (sessionsruns.ts). Shared by Conversation History and the sidebar's Conversations section.

import * as WOS from "@/app/store/wos";
import { atom, useAtomValue } from "jotai";
import { useMemo } from "react";

export type RunObjects = Record<string, { run?: Run; dag?: TaskGroup }>;

export function useRunObjects(runIds: string[]): RunObjects {
    const key = runIds.join(",");
    const objsAtom = useMemo(
        () =>
            atom((get) => {
                const out: RunObjects = {};
                for (const id of key.split(",").filter(Boolean)) {
                    const run = get(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", id)));
                    const dag = run?.dagoref
                        ? get(WOS.getWaveObjectAtom<TaskGroup>(WOS.makeORef("dag", run.dagoref)))
                        : undefined;
                    out[id] = { run, dag };
                }
                return out;
            }),
        [key]
    );
    return useAtomValue(objsAtom);
}
