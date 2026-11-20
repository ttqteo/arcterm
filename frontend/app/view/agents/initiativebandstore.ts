// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Initiative tab's chunk switch (docs/superpowers/specs/2026-11-14-chat-initiative-link-design.md, now drawn by the
// rail's railinitiativepane.tsx): its ops are planned by initiativeband.ts, and this file only sends them. The Chat band
// that held the switch's rows, and the per-agent state of which part of it was expanded, are gone.

import { globalStore } from "@/app/store/jotaiStore";
import { effortDetailAtom, loadEffortDetail, mutateEffortOps } from "@/app/view/jarvis/effortstore";
import { SWITCH_NOTE } from "./chatinitiative";
import { holdSwitchLine, queueSwitchLine } from "./chatinitiativestore";
import { chatBoxText, submitIntoChatBox } from "./chatinsert";
import { switchPlan } from "./initiativeband";

declare global {
    interface Window {
        // DEV: a string makes a chunk switch's second write fail with it before it is sent, so a CDP scenario can
        // see the rollback; the rollback itself runs for real
        __initiativeSwitchFail?: string;
    }
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Moves the agent in tab `tabId` to the chunk `toLabel` of the initiative `oref` (decisions 5 and 11 of the plan). Two
 *  writes, since a batch validates against the state before any of its ops: the detach from the old chunk, then the attach
 *  to the chosen one. When the attach fails the old chunk is put back (the rollback) and this rejects with the attach's
 *  error, with the rollback's too when it failed as well; no line is queued. On success the switched line waits for the
 *  agent's next message. The initiative is read first when it is not loaded. A refusal rejects with wavesrv's message, for
 *  the tab to show; nothing is swallowed. */
export async function switchAgentChunk(oref: string, tabId: string, toLabel: string): Promise<boolean> {
    if (globalStore.get(effortDetailAtom).get(oref) == null) {
        await loadEffortDetail(oref);
    }
    const effort = globalStore.get(effortDetailAtom).get(oref);
    if (effort == null) {
        throw new Error("This initiative could not be read");
    }
    const plan = switchPlan(effort, tabId, toLabel);
    if (plan.attach.length === 0) {
        return false; // the agent is on it already
    }
    if (plan.detach != null) {
        await mutateEffortOps(oref, plan.detach);
    }
    try {
        const fail = import.meta.env.DEV && typeof window !== "undefined" ? window.__initiativeSwitchFail : undefined;
        if (fail != null) {
            throw new Error(fail);
        }
        await mutateEffortOps(oref, plan.attach);
    } catch (e) {
        const message = messageOf(e);
        if (plan.rollback != null) {
            try {
                await mutateEffortOps(oref, plan.rollback);
            } catch (r) {
                throw new Error(`${message}; and the old chunk could not be restored: ${messageOf(r)}`);
            }
        }
        throw new Error(message);
    }
    queueSwitchLine(tabId, plan.line);
    return true;
}

/** The tab's Switch to this chunk: moves the agent and tells it at once, its switched line going in front of SWITCH_NOTE
 *  through the chat box's own send (the wait behind a prompt, the scroll), when the agent is awake and its box is empty.
 *  A draft in the box (the line then goes with it), an asleep agent or no box leave the line waiting for the person's next
 *  message, as before. The waiting line is held back meanwhile, so it never flashes on the path that sends. */
export async function switchAndTell(oref: string, agentId: string, toLabel: string, awake: boolean): Promise<void> {
    holdSwitchLine(agentId, true);
    let sent = false;
    try {
        const switched = await switchAgentChunk(oref, agentId, toLabel);
        // the box lets the hold go itself once it tried the send (chatcomposer.tsx)
        sent = switched && awake && chatBoxText(agentId).trim() === "" && submitIntoChatBox(agentId, SWITCH_NOTE);
    } finally {
        if (!sent) {
            holdSwitchLine(agentId, false);
        }
    }
}
