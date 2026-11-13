// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the plan handoff card reads from outside the transcript (docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md
// section 3, decision 9 of its plan): the plan file's title, task count and width (chathandoff.ts reads them from the
// text), and how many runs are active against `runs:maxactive`. Each piece the card cannot read is left out of its facts
// line, so a failure here only ever shortens the line.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useState } from "react";
import { resolveCwd } from "./agentcwdresolve";
import type { AgentVM } from "./agentsviewmodel";
import { planFacts, type PlanFacts } from "./chathandoff";
import { resolvePath } from "./pathlinks";

// the facts of each plan file read so far, by absolute path
export const planFactsAtom = atom<Record<string, PlanFacts>>({}) as PrimitiveAtom<Record<string, PlanFacts>>;
// the paths asked for: one read per path, a failed one included (it is logged once and the line goes without)
const requested = new Set<string>();

/** Reads the plan file at `abs` once and keeps its facts. A path already asked for is not read again, whether the read is
 *  in flight, done or failed; a failed read is logged once and leaves the facts out. */
export async function loadPlanFacts(abs: string): Promise<void> {
    if (requested.has(abs)) {
        return;
    }
    requested.add(abs);
    try {
        const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: abs } });
        if (data?.data64 == null) {
            throw new Error("the file has no content");
        }
        const facts = planFacts(base64ToString(data.data64));
        globalStore.set(planFactsAtom, (cur) => ({ ...cur, [abs]: facts }));
    } catch (e) {
        console.warn(`[chat] plan facts not read from ${abs}:`, e instanceof Error ? e.message : String(e));
    }
}

/** The facts of the plan at `path` (relative paths resolve against `cwd`), null until read and when it cannot be: no
 *  path, a relative path with no folder to resolve it in, or a failed read. */
export function usePlanFacts(path: string | null, cwd: string | undefined): PlanFacts | null {
    const abs = path == null ? null : resolvePath(cwd, path);
    const facts = useAtomValue(planFactsAtom);
    useEffect(() => {
        if (abs != null) {
            void loadPlanFacts(abs);
        }
    }, [abs]);
    return abs != null ? (facts[abs] ?? null) : null;
}

/** The agent's working directory, for resolving a relative plan path; undefined until it is known and when it cannot be. */
export function useAgentCwd(agent: AgentVM | undefined): string | undefined {
    const transcriptPath = agent?.transcriptPath;
    const blockId = agent?.blockId;
    const [cwd, setCwd] = useState<string | undefined>(undefined);
    useEffect(() => {
        let live = true;
        if (transcriptPath == null && blockId == null) {
            setCwd(undefined);
            return;
        }
        void resolveCwd(transcriptPath, blockId).then((dir) => {
            if (live) {
                setCwd(dir ?? undefined);
            }
        });
        return () => {
            live = false;
        };
    }, [transcriptPath, blockId]);
    return cwd;
}

/** Runs active and the cap (`runs:maxactive`, 0 for none), read on mount and again on every `runqueue:changed`; null until
 *  read and when the read fails. */
export function useRunSlots(): { active: number; max: number } | null {
    const [slots, setSlots] = useState<{ active: number; max: number } | null>(null);
    useEffect(() => {
        let live = true;
        // the newest read wins: a slow one that started earlier never overwrites it
        let seq = 0;
        const read = () => {
            const mine = ++seq;
            RpcApi.RunQueueListCommand(TabRpcClient)
                .then((data) => {
                    if (live && mine === seq) {
                        setSlots({ active: data.active, max: data.maxactive });
                    }
                })
                .catch(() => {
                    if (live && mine === seq) {
                        setSlots(null);
                    }
                });
        };
        const unsub = waveEventSubscribeSingle({ eventType: "runqueue:changed", handler: read });
        read();
        return () => {
            live = false;
            unsub();
        };
    }, []);
    return slots;
}
