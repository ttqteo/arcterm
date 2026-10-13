// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The titles of sleeping agents' conversations, read from their own transcripts. A sleeping agent has no process to
// report its ai-title, and the Conversations archive that stands in for it holds only the newest sessions
// (sessionsarchivestore's LIMIT): an agent asleep behind more of them read as its project's name. Claude Code writes the
// ai-title again near the end of every turn, so the transcript's tail holds it. Each path is read once a launch.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
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

/** Reads the title of each sleeping agent's transcript as it appears on the roster. In the always-mounted shell, since
 *  every surface names agents (the sidebar, the Consumers panel, the header). */
export function useSleeperTitles(model: AgentsViewModel): void {
    const agents = useAtomValue(model.agentsAtom);
    useEffect(() => {
        for (const s of sleepersToTitle(agents, asked)) {
            asked.add(titleKey(s.path));
            fireAndForget(() => loadSleeperTitle(s.path, s.agent));
        }
    }, [agents]);
}
