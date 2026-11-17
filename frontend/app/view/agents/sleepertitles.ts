// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The titles of sleeping agents' conversations, read from their own transcripts. A sleeping agent has no process to
// report its ai-title, and the Conversations archive that stands in for it holds only the newest sessions
// (sessionsarchivestore's LIMIT): an agent asleep behind more of them read as its project's name. Claude Code writes the
// ai-title again near the end of every turn, so the transcript's tail holds it. Each path is read once a launch, one
// at a time; a read that fails is tried again.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { projectorFor } from "./transcriptregistry";

// the last ai-title sat within 24 lines of the end in every sleeping transcript measured
const TITLE_TAIL_LINES = 100;

// titleKey(transcript path) -> the title read from it
export const transcriptTitlesAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

// the paths already read (or being read), so a roster change never reads one twice
const asked = new Set<string>();

/** Pure: a transcript path compared without case or separator. */
export function titleKey(path: string): string {
    return path.replace(/\\/g, "/").toLowerCase();
}

/** Pure: the sleeping agents' transcripts not asked for yet, each once. An awake agent's status reports its title. */
export function sleepersToTitle(
    agents: Pick<AgentVM, "sleeping" | "transcriptPath" | "agent">[],
    done: ReadonlySet<string>
): { path: string; agent?: string }[] {
    const seen = new Set(done);
    const out: { path: string; agent?: string }[] = [];
    for (const a of agents) {
        if (!a.sleeping || !a.transcriptPath || seen.has(titleKey(a.transcriptPath))) {
            continue;
        }
        seen.add(titleKey(a.transcriptPath));
        out.push({ path: a.transcriptPath, agent: a.agent });
    }
    return out;
}

/** Read one transcript's tail and keep its title, when it has one. */
export async function loadSleeperTitle(path: string, agent: string | undefined): Promise<void> {
    const rtn = await RpcApi.GetAgentTranscriptCommand(TabRpcClient, { path, maxlines: TITLE_TAIL_LINES });
    const extract = projectorFor(agent, path).extractTitle;
    const title = extract?.(rtn?.lines ?? [])?.trim();
    if (title) {
        globalStore.set(transcriptTitlesAtom, (m) => ({ ...m, [titleKey(path)]: title }));
    }
}

// a failed read waits RETRY_MS times its count before the next try, and stops after MAX_TRIES
const RETRY_MS = 15_000;
const MAX_TRIES = 4;

type SleeperRead = { path: string; agent?: string };

/** The reads of sleeping agents' titles, one at a time. At launch every sleeper is read at once, each tail a few
 *  hundred KB: as a burst they landed while the window was still loading, wavesrv's websocket write timed out and the
 *  connection was replaced, and the reads it carried failed. A failed read used to be forgotten for the whole launch,
 *  so its agent read as its project's name until arcterm restarted; it is now tried again after a wait. `schedule`
 *  stands in for setTimeout in tests. */
export function sleeperTitleQueue(
    read: (path: string, agent: string | undefined) => Promise<void>,
    schedule: (fn: () => void, ms: number) => void
): (items: SleeperRead[]) => void {
    const pending: SleeperRead[] = [];
    const failures = new Map<string, number>();
    let draining = false;
    const drain = async () => {
        if (draining) {
            return;
        }
        draining = true;
        try {
            while (pending.length > 0) {
                const s = pending.shift();
                try {
                    await read(s.path, s.agent);
                } catch (e) {
                    const n = (failures.get(titleKey(s.path)) ?? 0) + 1;
                    failures.set(titleKey(s.path), n);
                    console.log("sleeper title: reading", s.path, "failed", `(try ${n} of ${MAX_TRIES}):`, e);
                    if (n < MAX_TRIES) {
                        schedule(() => enqueue([s]), RETRY_MS * n);
                    }
                }
            }
        } finally {
            draining = false;
        }
    };
    const enqueue = (items: SleeperRead[]) => {
        pending.push(...items);
        void drain();
    };
    return enqueue;
}

const enqueueSleeperTitles = sleeperTitleQueue(loadSleeperTitle, (fn, ms) => setTimeout(fn, ms));

/** Reads the title of each sleeping agent's transcript as it appears on the roster. In the always-mounted shell, since
 *  every surface names agents (the sidebar, the Consumers panel, the header). */
export function useSleeperTitles(model: AgentsViewModel): void {
    const agents = useAtomValue(model.agentsAtom);
    useEffect(() => {
        const next = sleepersToTitle(agents, asked);
        for (const s of next) {
            asked.add(titleKey(s.path));
        }
        if (next.length > 0) {
            enqueueSleeperTitles(next);
        }
    }, [agents]);
}
