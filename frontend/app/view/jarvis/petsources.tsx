// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Always-mounted (cockpit root) driver for the two registers that read the backend: Voice and the rank-1
// condition. Renders nothing. The adapters it feeds are pure and live in petjoin.ts; this file is only the
// plumbing — when to read, and what to subscribe to.
//
// Three sources, three different cadences, each for a stated reason:
//
//   Launch narrative  — read ONCE. It is written at a run's rest boundary and read from the DB, so it is
//                       durable; re-reading it on a timer would find the same row.
//   jarvis:volunteer  — subscribed, plus a history backlog at mount. The backlog is what makes "while you
//                       were out" work when it fired before this window opened. Note the broker's persist
//                       buffer is in-memory, so a wavesrv restart replays nothing — the durable half of
//                       Voice is the launch narrative above, which is why that one reads the DB.

import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { focusedBlockId } from "@/util/focusutil";
import { useEffect } from "react";
import { readUntilLanded } from "./petboot";
import {
    askAgent,
    eventFromAsk,
    eventFromNotify,
    eventFromResume,
    eventFromRunLanded,
    eventFromVolunteer,
    shouldSpeakAsk,
    type AskGateCtx,
} from "./petjoin";
import { pushPetEvent, removePetEvent } from "./petstore";

const ACTIVITY_BACKLOG = 20;

// session-unique sequence for notify event ids (the events themselves are session-scoped)
let notifySeq = 0;

// Each loader returns whether the read landed, never whether it found anything: "the vault has no narrative"
// is a successful read, "the backend did not answer" is not, and only the second is worth retrying.
async function loadLaunchNarrative(): Promise<boolean> {
    try {
        const event = eventFromResume(await RpcApi.GetLatestResumeCommand(TabRpcClient));
        if (event != null) {
            pushPetEvent(event);
        }
        return true; // no narrative is a normal state, not an error worth retrying
    } catch {
        return false;
    }
}

// scope "" because the event is published scope-less, as a fact about your work rather than about one
// object, which the history read expresses as an empty scope rather than an omitted field.
async function loadVolunteerBacklog(): Promise<boolean> {
    try {
        const events = await RpcApi.EventReadHistoryCommand(TabRpcClient, {
            event: "jarvis:volunteer",
            scope: "",
            maxitems: ACTIVITY_BACKLOG,
        });
        for (const e of events ?? []) {
            const mapped = eventFromVolunteer(e?.data as VolunteerData | undefined);
            if (mapped != null) {
                pushPetEvent(mapped);
            }
        }
        return true;
    } catch {
        return false; // the live subscription still covers anything from here on
    }
}

export function PetSources({ model }: { model: AgentsViewModel }) {
    useEffect(() => {
        // Retried until each lands: both are one-shot, so a read lost to a backend that was not ready at
        // mount would otherwise stay lost for the session. See petboot.ts.
        let mounted = true;
        const live = () => mounted;
        void readUntilLanded({ read: loadLaunchNarrative, live });
        void readUntilLanded({ read: loadVolunteerBacklog, live });
        const unsubVolunteer = waveEventSubscribeSingle({
            eventType: "jarvis:volunteer",
            handler: (event) => {
                const mapped = eventFromVolunteer(event?.data);
                if (mapped != null) {
                    pushPetEvent(mapped);
                }
            },
        });
        const unsubNotify = waveEventSubscribeSingle({
            eventType: "notify",
            handler: (event) => {
                const mapped = eventFromNotify(event?.data as NotifyCommandData | undefined, Date.now(), ++notifySeq);
                if (mapped != null) {
                    pushPetEvent(mapped);
                }
            },
        });
        const unsubAsk = waveEventSubscribeSingle({
            eventType: "agent:ask",
            handler: (event) => {
                const data = event?.data as AgentAskData | undefined;
                const out = eventFromAsk(data);
                if (out.cancelId != null) {
                    removePetEvent(out.cancelId);
                    return;
                }
                if (out.event == null) {
                    return;
                }
                const agent = askAgent(globalStore.get(model.agentsAtom), data?.oref);
                const ctx: AskGateCtx = {
                    surface: globalStore.get(model.surfaceAtom),
                    focusTabId: globalStore.get(model.focusIdAtom),
                    askTabId: agent?.id,
                    focusedBlockId: focusedBlockId(),
                    // routeNotify's own test: focused, with toasts on (the setting defaults to on)
                    toastSays:
                        globalStore.get(atoms.documentHasFocus) &&
                        ((globalStore.get(getSettingsKeyAtom("notify:toast")) as boolean | undefined) ?? true),
                };
                if (!shouldSpeakAsk(data?.oref, ctx)) {
                    return;
                }
                // `agent:<tabId>` is an address openAddress lands on the agent (address.ts reads it as an
                // alias of tab:). A roster-less ask still speaks, just with no open affordance — the same rule
                // as a volunteer with no ref.
                pushPetEvent(
                    agent != null
                        ? {
                              ...out.event,
                              sources: [{ ref: `agent:${agent.id}`, title: agent.name || "the ask", sourceType: "" }],
                          }
                        : out.event
                );
            },
        });
        // unscoped: a landed run is news on every surface, whichever run is in view
        const unsubLanded = waveEventSubscribeSingle({
            eventType: "run:event",
            handler: (event) => {
                const mapped = eventFromRunLanded(event?.data as RunEventData | undefined);
                if (mapped != null) {
                    pushPetEvent(mapped);
                }
            },
        });
        return () => {
            mounted = false;
            unsubLanded();
            unsubVolunteer();
            unsubNotify();
            unsubAsk();
        };
    }, []);
    return null;
}
