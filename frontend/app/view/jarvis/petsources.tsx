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

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { floatMiniAtom } from "@/app/view/agents/floatstore";
import { usePlanDonuts } from "@/app/view/agents/usagemeters";
import { focusedBlockId } from "@/util/focusutil";
import { isMacOS } from "@/util/platformutil";
import { useEffect } from "react";
import { readUntilLanded } from "./petboot";
import {
    askAgent,
    eventFromAsk,
    eventFromNotify,
    eventFromResume,
    eventFromRunLanded,
    eventFromSlept,
    eventFromVolunteer,
    shouldSpeakAsk,
    type AskGateCtx,
} from "./petjoin";
import { quotaCrossings, quotaEvent, quotaReadings } from "./petquota";
import { markQuotaSaid, pushPetEvent, quotaSaidSet, removePetEvent } from "./petstore";

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

// A window crossing 85% or running out is said once per cycle (petquota.ts). The donuts tick with the 1s clock, so
// this runs every second; it is a filter over a handful of readings and pushes nothing on a quiet tick.
function useQuotaVoice(model: AgentsViewModel): void {
    const donuts = usePlanDonuts(model);
    useEffect(() => {
        const crossings = quotaCrossings(quotaReadings(donuts), quotaSaidSet());
        if (crossings.length === 0) {
            return;
        }
        const now = Date.now();
        for (const c of crossings) {
            pushPetEvent(quotaEvent(c, now));
        }
        markQuotaSaid(crossings.flatMap((c) => [...(c.alsoSaid ?? []), c.key]));
    }, [donuts]);
}

export function PetSources({ model }: { model: AgentsViewModel }) {
    useQuotaVoice(model);
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
                    // folded, the floated terminal is hidden: its question is Sprout's to say
                    folded: globalStore.get(floatMiniAtom),
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
        // the machine slept: news only when agents were working through it. A status from before the sleep is still the
        // roster's when this lands, so "working" is what they were doing when it fell asleep.
        const unsubSlept = waveEventSubscribeSingle({
            eventType: "system:slept",
            handler: (event) => {
                const working = globalStore.get(model.agentsAtom).filter((a) => a.state === "working").length;
                const mapped = eventFromSlept(event?.data as SleptData | undefined, working, isMacOS());
                if (mapped != null) {
                    pushPetEvent(mapped);
                }
            },
        });
        return () => {
            mounted = false;
            unsubSlept();
            unsubLanded();
            unsubVolunteer();
            unsubNotify();
            unsubAsk();
        };
    }, []);
    return null;
}
