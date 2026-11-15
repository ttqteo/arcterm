// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit's side of the Sidecar window (spec 2026-11-13-sidecar-design.md, section 2): while a Sidecar page is
// live it builds a SidecarSnapshot from the cockpit's own stores and emits it to the `sidecar` window, and it carries out
// each SidecarAct the page sends back. The page keeps no store and boots no cockpit. Mounted once in the cockpit shell,
// beside TrayBridge, which lives as long as arcterm does.
//
// It does no work while no page is live. A page is live from its `hello` until the host's `sidecar:closed`; it
// re-sends `hello` every 2 s until its first snapshot arrives, so either launch order works. The stores it watches are
// agentsAtom, liveEntriesByIdAtom and sentIdsAtom, never the 1 s nowAtom tick (it reads `now` once per build): a
// subscription to the tick would re-emit forever. It never makes the main window stream more agents.

import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { answerAgentAsk } from "@/app/view/agents/askanswer";
import { liveEntriesByIdAtom } from "@/app/view/agents/livetranscriptatoms";
import { openTarget } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getAllWindows } from "@tauri-apps/api/window";
import { useEffect } from "react";
import {
    EMPTY_FEED,
    afterClosed,
    afterEmit,
    afterHello,
    planChange,
    validateAct,
    type FeedState,
} from "./sidecarbridgemodel";
import { keptMessages, sidecarSnapshot } from "./sidecarsnapshot";
import {
    SIDECAR_ACT_EVENT,
    SIDECAR_CLOSED_EVENT,
    SIDECAR_SNAPSHOT_EVENT,
    type SidecarAct,
    type SidecarMessage,
    type SidecarSnapshot,
} from "./sidecartypes";
import { showMain } from "./traybridge";

// the window label src-tauri/src/sidecar.rs gives the page
const SIDECAR_LABEL = "sidecar";

declare global {
    interface Window {
        // DEV test seams for the sidecar-wall CDP scenario (decision 13); both are compiled out of a production build
        // every act the bridge received, in order, valid or not
        __sidecarActs?: unknown[];
        // true: the bridge is not live (it emits nothing) and ignores hello, so the page stays on its waiting state;
        // clearing it lets the next hello through
        __sidecarHold?: boolean;
    }
}

function log(msg: string): void {
    getApi().sendLog(`[sidecar] ${msg}`);
}

export function SidecarBridge({ model }: { model: AgentsViewModel }) {
    useEffect(() => {
        let live = false;
        let feed: FeedState = EMPTY_FEED;
        // the rows each tile last showed (decision 3): an agent whose stream stops keeps them
        let kept: Record<string, SidecarMessage[]> = {};
        let timer: ReturnType<typeof setTimeout> | null = null;

        const cancelTimer = () => {
            if (timer != null) {
                clearTimeout(timer);
                timer = null;
            }
        };
        const held = () => import.meta.env.DEV && window.__sidecarHold === true;
        // a hold makes the bridge not live, not only deaf to hello: a snapshot sent mid-hold would overwrite the waiting
        // state the scenario is shooting
        const isLive = () => {
            if (held()) {
                live = false;
                cancelTimer();
                return false;
            }
            return live;
        };

        const build = (): SidecarSnapshot => {
            const snap = sidecarSnapshot(
                globalStore.get(model.agentsAtom),
                globalStore.get(liveEntriesByIdAtom),
                globalStore.get(model.sentIdsAtom),
                kept,
                globalStore.get(model.nowAtom)
            );
            // the snapshot already falls back to `kept` for a tile with no rows of its own, so what it holds is the
            // roster's rows and nothing for an agent that has left
            kept = keptMessages(snap);
            return snap;
        };

        const send = (snap: SidecarSnapshot) => {
            feed = afterEmit(snap, Date.now());
            emitTo(SIDECAR_LABEL, SIDECAR_SNAPSHOT_EVENT, snap).catch((e) => log(`snapshot not sent: ${String(e)}`));
        };

        // a store changed: the trailing emit of a throttled burst builds its own fresh snapshot when it fires
        const onChange = () => {
            if (!isLive()) {
                return;
            }
            const snap = build();
            const step = planChange(feed, snap, timer != null, Date.now());
            switch (step.kind) {
                case "emit":
                    cancelTimer();
                    send(snap);
                    return;
                case "later":
                    timer = setTimeout(() => {
                        timer = null;
                        onChange();
                    }, step.delayMs);
                    return;
                case "none":
                    return;
            }
        };

        const hello = () => {
            if (held()) {
                return;
            }
            live = true;
            // a reloaded or reopened page has none of the last snapshot: this one goes out even if nothing changed
            feed = afterHello(feed);
            cancelTimer();
            send(build());
        };

        const carryOut = (act: SidecarAct) => {
            switch (act.kind) {
                case "hello":
                    hello();
                    return;
                case "open":
                    fireAndForget(async () => {
                        const result = await openTarget(model, { kind: "agent", tabId: act.id });
                        if (result.ok === false) {
                            log(`open ${act.id} failed: ${result.message}`);
                        }
                        // raised either way: a failed open says why in a toast of the main window
                        await showMain(model);
                    });
                    return;
                case "answer": {
                    const sent = answerAgentAsk(model, act.id, { 0: new Set([act.option]) }, {});
                    if (!sent) {
                        log(
                            `answer ${act.option + 1} to ${act.id} refused: nothing sent (the agent is gone, its ask was already answered, or it has no ask to answer)`
                        );
                    }
                    return;
                }
            }
        };

        const onAct = (raw: unknown) => {
            if (import.meta.env.DEV) {
                (window.__sidecarActs ??= []).push(raw);
            }
            const check = validateAct(raw, feed.lastSent);
            if (check.ok === false) {
                log(`act refused: ${check.reason}`);
                return;
            }
            carryOut(check.act);
        };

        // The page sends hello only until its first snapshot, so a main window that reloads (a dev full reload, a
        // scenario's teardown) while Sidecar stays open would hear none, and Sidecar would keep its last snapshot,
        // stale. One look for the window at mount stands in for that hello. A page still loading misses this emit and
        // its own hello loop answers it.
        let mounted = true;
        fireAndForget(async () => {
            const windows = await getAllWindows();
            if (mounted && windows.some((w) => w.label === SIDECAR_LABEL)) {
                hello();
            }
        });

        const offs = [
            globalStore.sub(model.agentsAtom, onChange),
            globalStore.sub(liveEntriesByIdAtom, onChange),
            globalStore.sub(model.sentIdsAtom, onChange),
        ];
        const listeners = [
            listen<unknown>(SIDECAR_ACT_EVENT, (e) => onAct(e.payload)),
            listen(SIDECAR_CLOSED_EVENT, () => {
                live = false;
                feed = afterClosed();
                cancelTimer();
            }),
        ];
        return () => {
            mounted = false;
            cancelTimer();
            offs.forEach((off) => off());
            listeners.forEach((p) => void p.then((off) => off()));
        };
    }, [model]);

    return null;
}
