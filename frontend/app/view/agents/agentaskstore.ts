// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { loadAttention } from "./attentionstore";

// keyed by block ORef string ("block:<uuid>"); null = no pending ask
const agentAskAtoms = new Map<string, PrimitiveAtom<AgentAskData>>();

// Ask ids whose answer has been sent but not yet confirmed by the agent's clear; the answer bar locks
// on these so a second click cannot re-send. It lives beside the ask atoms rather than on the view
// model because the two events that release the lock — the clear, and the server putting the ask back
// because the answer never landed — both arrive here.
export const sentAskIdsAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;

function forgetSentAsk(askId: string) {
    const next = new Set(globalStore.get(sentAskIdsAtom));
    if (next.delete(askId)) {
        globalStore.set(sentAskIdsAtom, next);
    }
}

export function getAgentAskAtom(oref: string): PrimitiveAtom<AgentAskData> {
    let askAtom = agentAskAtoms.get(oref);
    if (!askAtom) {
        askAtom = atom(null) as PrimitiveAtom<AgentAskData>;
        agentAskAtoms.set(oref, askAtom);
    }
    return askAtom;
}

// drops the block's ask when the server holds another or none. Only the ask the check was made for goes: one raised
// while the check was out is the agent's current question
function recheckAsk(oref: string) {
    const askAtom = getAgentAskAtom(oref);
    const checked = globalStore.get(askAtom);
    if (checked == null) {
        return;
    }
    void (async () => {
        let pendingId: string;
        try {
            pendingId = await RpcApi.AgentAskPendingCommand(TabRpcClient, oref);
        } catch (err) {
            console.warn(`checking the pending ask of ${oref} failed`, err);
            return;
        }
        if (pendingId === checked.askid || globalStore.get(askAtom)?.askid !== checked.askid) {
            return;
        }
        globalStore.set(askAtom, null);
        forgetSentAsk(checked.askid);
        void loadAttention();
    })();
}

let subscribed = false;
export function setupAgentAskSubscription() {
    if (subscribed) {
        return;
    }
    subscribed = true;
    waveEventSubscribeSingle({
        eventType: "agent:ask",
        handler: (event) => {
            const data = event.data as AgentAskData;
            if (data?.oref == null) {
                return;
            }
            const askAtom = getAgentAskAtom(data.oref);
            if (!data.cleared) {
                globalStore.set(askAtom, data);
                // a raise carrying a note is the server putting this ask back under its original id
                // because the typed answer never reached the agent (agentask.AnswerUnconfirmedNote).
                // The human has to answer it again, so release the lock the first answer took.
                if (data.note) {
                    forgetSentAsk(data.askid);
                }
                return;
            }
            forgetSentAsk(data.askid);
            // clear only the ask the event names. A clear for an ask this block has already replaced
            // (a late duplicate, a persisted event redelivered on reconnect) must not blank the
            // question currently on screen.
            if (globalStore.get(askAtom)?.askid === data.askid) {
                globalStore.set(askAtom, null);
            }
            // the nav-rail badges are a server-computed list on a 10s poll: without this an answered
            // question kept a "needs you" count for up to ten seconds after its card was gone.
            void loadAttention();
        },
    });
    // an ask no clear reached (an event lost, an ask the server replaced) hides while its agent works and read as
    // asking at every idle until a reload; going idle checks the ask on screen against the one the server holds
    waveEventSubscribeSingle({
        eventType: "agent:status",
        handler: (event) => {
            const data = event.data as AgentStatusData;
            if (data?.oref != null && data.state === "idle") {
                recheckAsk(data.oref);
            }
        },
    });
    // closing an agent's terminal retires its pending ask, but that happens server-side inside the
    // attention gather (pkg/jarvis/attention.go) — so ask for a recount instead of waiting out the poll.
    waveEventSubscribeSingle({
        eventType: "blockclose",
        handler: () => void loadAttention(),
    });
}
