// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council whose chat the Agent panel's Council tab shows (railcouncil.ts), read from the list of every council that
// councilstore.ts keeps current on `council:changed`. The tab and its key `c` (bindings.ts) read it here, so the two
// always agree on which council that is.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentVM } from "./agentsviewmodel";
import { councilListAtom, useCouncils } from "./councilstore";
import { sessionIdFromTranscript } from "./launch";
import { agentCouncil } from "./railcouncil";

type AgentIds = Pick<AgentVM, "transcriptPath" | "sessionId">;

// a council names the session that started it by its transcript's file name (wsh's blockSession); a pi agent's control
// session id is the other name it may go by
function sessionsOf(agent: AgentIds): (string | undefined)[] {
    return [sessionIdFromTranscript(agent.transcriptPath), agent.sessionId];
}

/** The council the agent started most recently, as the list holds it now; null for none (or before the first read). */
export function agentCouncilNow(agent: AgentIds): Council | null {
    return agentCouncil(globalStore.get(councilListAtom("")), sessionsOf(agent));
}

/** The council the agent started most recently, kept current; null for none. */
export function useAgentCouncil(agent: AgentIds): Council | null {
    return agentCouncil(useCouncils(""), sessionsOf(agent));
}
