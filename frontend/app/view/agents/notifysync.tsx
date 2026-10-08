// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Tells you when an agent needs you or finished, in the always-mounted shell since that can happen while any surface
// shows. notifyevents.ts decides what and where; this feeds it the roster, the attention list and `wsh notify`, holds a
// burst for COALESCE_MS, and delivers to the toast stack or to notify_os. A click on either lands through openref /
// openNeedsTarget, as the palette's Enter does.

import { pushToast } from "@/app/cockpit/notificationstore";
import { openNeedsTarget } from "@/app/cockpit/openneeds";
import { needsRows, needsTarget } from "@/app/cockpit/palette-needs";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openTarget } from "@/app/view/jarvis/openref";
import { pushPetEvent } from "@/app/view/jarvis/petstore";
import { fireAndForget } from "@/util/util";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { centerModeAtom } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { attentionAtom, attentionLoadedAtom } from "./attentionstore";
import { floatModeAtom } from "./floatstore";
import { agentGridAtom } from "./gridstore";
import {
    answerLine,
    coalesce,
    COALESCE_MS,
    diffEvents,
    notifyEventOf,
    osText,
    parseTarget,
    petEventOfNeeds,
    routeNotify,
    snapshotOf,
    toastOf,
    type NotifyEvent,
    type NotifyRoute,
    type NotifySnapshot,
    type NotifyTarget,
    type RouteCtx,
} from "./notifyevents";
import { viewingIds } from "./unreadagents";

const ACTIVATED_EVENT = "os-notify-activated"; // notify.rs ACTIVATED_EVENT

function openNotifyTarget(model: AgentsViewModel, t: NotifyTarget): void {
    switch (t.kind) {
        case "agent":
            // through the one router, so an agent that has gone says so instead of opening nothing
            fireAndForget(() => openTarget(model, { kind: "agent", tabId: t.agentId }));
            return;
        case "attention": {
            const item = globalStore.get(attentionAtom).find((i) => i.key === t.key);
            if (
                item == null ||
                !openNeedsTarget(model, needsTarget(needsRows([item], globalStore.get(model.agentsAtom))[0]))
            ) {
                globalStore.set(model.surfaceAtom, "cockpit");
            }
            return;
        }
        case "cockpit":
            globalStore.set(model.surfaceAtom, "cockpit");
            return;
        case "none":
            return;
    }
}

// an answer read this long after it was written belongs to an earlier turn, not the one that just finished
const ANSWER_FRESH_MS = 2 * 60_000;

// the line of a finished agent's last answer its OS toast shows, "" for any other event or when it cannot be read
// within two seconds: the toast then keeps its own body
async function osAnswer(e: NotifyEvent): Promise<string> {
    if (e.kind !== "reply" || e.target.kind !== "agent") {
        return "";
    }
    try {
        const read = await RpcApi.AgentsReadCommand(TabRpcClient, { tab: e.target.agentId }, { timeout: 2000 });
        return read?.answer && Date.now() - read.answerts < ANSWER_FRESH_MS ? answerLine(read.answer) : "";
    } catch {
        return "";
    }
}

export function NotifySync({ model }: { model: AgentsViewModel }): null {
    const agents = useAtomValue(model.agentsAtom);
    const attention = useAtomValue(attentionAtom);
    const attentionLoaded = useAtomValue(attentionLoadedAtom);
    const focused = useAtomValue(atoms.documentHasFocus);
    const floating = useAtomValue(floatModeAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const center = useAtomValue(centerModeAtom);
    const grid = useAtomValue(agentGridAtom);
    const os = (useAtomValue(getSettingsKeyAtom("notify:os")) as boolean | undefined) ?? true;
    const toast = (useAtomValue(getSettingsKeyAtom("notify:toast")) as boolean | undefined) ?? true;
    const reply = (useAtomValue(getSettingsKeyAtom("notify:reply")) as boolean | undefined) ?? true;

    // routing reads the state at the moment of the event, through a ref so the subscriptions below stay put
    const ctx = useRef<RouteCtx>(null);
    ctx.current = {
        focused,
        floating,
        viewing: viewingIds(focused, surface === "agent", center, focusId, grid),
        settings: { os, toast, reply },
    };
    const buffer = useRef<{ route: NotifyRoute; event: NotifyEvent }[]>([]);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const deliver = (route: NotifyRoute, e: NotifyEvent) => {
        if (route === "toast") {
            pushToast({
                ...toastOf(e),
                onOpen: e.target.kind === "none" ? undefined : () => openNotifyTarget(model, e.target),
            });
        } else if (route === "os") {
            void osAnswer(e).then((answer) =>
                invoke("notify_os", { ...osText(e, answer), target: JSON.stringify(e.target), loud: e.loud }).catch(
                    () => {}
                )
            );
        }
    };
    const flush = () => {
        timer.current = null;
        const held = buffer.current;
        buffer.current = [];
        for (const route of ["os", "toast"] as const) {
            for (const e of coalesce(held.filter((h) => h.route === route).map((h) => h.event))) {
                deliver(route, e);
            }
        }
    };
    const enqueue = (events: NotifyEvent[]) => {
        for (const event of events) {
            const route = routeNotify(event, ctx.current!);
            if (route === "os" || route === "toast") {
                buffer.current.push({ route, event });
            } else if (route === "avatar") {
                // the pet says a decision in place of its toast; its other avatar events come from its own sources
                const said = petEventOfNeeds(event, Date.now());
                if (said != null) {
                    pushPetEvent(said);
                }
            }
        }
        if (buffer.current.length > 0 && timer.current == null) {
            timer.current = setTimeout(flush, COALESCE_MS);
        }
    };

    const prev = useRef<NotifySnapshot | null>(null);
    useEffect(() => {
        const next = snapshotOf(agents, attention, attentionLoaded);
        enqueue(diffEvents(prev.current, next));
        prev.current = next;
    }, [agents, attention, attentionLoaded]);

    useEffect(
        () =>
            waveEventSubscribeSingle({
                eventType: "notify",
                handler: (event) => {
                    const e = notifyEventOf(event?.data as NotifyCommandData | undefined);
                    if (e != null) {
                        enqueue([e]);
                    }
                },
            }),
        []
    );

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let live = true;
        listen<string>(ACTIVATED_EVENT, (e) => openNotifyTarget(model, parseTarget(e.payload)))
            .then((u) => (live ? (unlisten = u) : u()))
            .catch(() => {});
        return () => {
            live = false;
            unlisten?.();
            if (timer.current != null) {
                clearTimeout(timer.current);
            }
        };
    }, [model]);

    return null;
}
