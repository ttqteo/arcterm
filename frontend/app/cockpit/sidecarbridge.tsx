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
// agentsAtom, liveEntriesByIdAtom and sentIdsAtom, and the Cockpit's filters and ~15 s structural clock, since the wall
// shows only what the Cockpit's grid shows (sidecarsnapshot.ts wallAgentIds); never the 1 s nowAtom tick (it reads
// `now` once per build): a subscription to the tick would re-emit forever. It never makes the main window stream more
// agents.
//
// Part 2 adds, still only while a page is live (every timer and subscription stops on sidecar:closed, a hold and unmount):
//   - the machine: one GetMachineStatsCommand at hello, then every 5 s, and the memorypressure events between; each
//     reading goes through the strain model's `trackStrain`, and the snapshot carries the rounded figures and the strain;
//   - the heavy agents, only while a strain band exists: by RAM the Consumers reading (loadConsumers every 5 s), by CPU
//     the per-agent CPU reading every 2 s; neither runs while the band is down;
//   - Stop and Sleep from a band row, and the older act (scrollback) answered on sidecar:older.
// The wall holds only agents the main window streams (asking, working, idle within the grace window), so a tile's rows
// come from that stream, or from `kept` once it stops.

import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { entriesToShow } from "@/app/view/agents/agentrowmodel";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { sleepWithConfirm } from "@/app/view/agents/agentsleep";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { answerAgentAsk } from "@/app/view/agents/askanswer";
import { hiddenAgentIds } from "@/app/view/agents/cockpitsurfacemodel";
import { CONSUMERS_POLL_MS, consumersReadingAtom, loadConsumers } from "@/app/view/agents/consumersstore";
import { idsWithEntriesAtom, liveEntriesByIdAtom } from "@/app/view/agents/livetranscriptatoms";
import { openTarget } from "@/app/view/jarvis/openref";
import { isMacOS, isWindows } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getAllWindows } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { jobQueueAtom } from "./jobqueuestore";
import {
    CPU_POLL_MS,
    EMPTY_FEED,
    EMPTY_NOTES,
    MACHINE_POLL_MS,
    afterClosed,
    afterEmit,
    afterHello,
    answerOlder,
    applyPressure,
    attachNotes,
    heavyPolls,
    machineOf,
    planChange,
    readingFresh,
    readingOf,
    roundHeavy,
    runningJobs,
    setNote,
    sleepNote,
    stopNote,
    strainOf,
    syncNotes,
    validateAct,
    type FeedState,
    type HeavyNotes,
} from "./sidecarbridgemodel";
import { olderFromMemory, readOlderFromFile } from "./sidecarhistory";
import {
    keptMessages,
    messageRows,
    scopeTiles,
    sidecarSnapshot,
    wallAgentIds,
    type CockpitScope,
} from "./sidecarsnapshot";
import {
    EMPTY_TRACK,
    heavyAgents,
    strainBy,
    strainNow,
    trackStrain,
    type MachineReading,
    type StrainTrack,
} from "./sidecarstrainmodel";
import {
    SIDECAR_ACT_EVENT,
    SIDECAR_CLOSED_EVENT,
    SIDECAR_OLDER_EVENT,
    SIDECAR_SNAPSHOT_EVENT,
    type SidecarAct,
    type SidecarMessage,
    type SidecarSnapshot,
    type SidecarStrain,
} from "./sidecartypes";
import { showMain } from "./traybridge";

// the window label src-tauri/src/sidecar.rs gives the page
const SIDECAR_LABEL = "sidecar";

declare global {
    interface Window {
        // DEV test seams for the sidecar-wall CDP scenario (decisions 13 and 14); all are compiled out of a production build
        // every act the bridge received, in order, valid or not
        __sidecarActs?: unknown[];
        // true: the bridge is not live (it emits nothing) and ignores hello, so the page stays on its waiting state;
        // clearing it lets the next hello through
        __sidecarHold?: boolean;
        // a machine reading used in place of the machine read and the memorypressure event while it is set
        __sidecarMachine?: MachineStatsData;
        // the heavy-agent readings used in place of the consumers and CPU polls while it is set; with it set a stop or
        // sleep act is logged in __sidecarActs and not run, and the row's note reads "Not run (fixture)"
        __sidecarHeavy?: { consumers?: CommandGetConsumersRtnData; agentcpu?: AgentCpuData };
        // re-reads the seams and rebuilds now, so a scenario needs no 5 s wait
        __sidecarRefresh?: () => Promise<void>;
        // starts the strain track over and pushes these readings through it in order, then rebuilds: the scenario feeds
        // 27 readings 5 s apart ending now to reach the 120 s CPU streak without waiting
        __sidecarFeed?: (readings: MachineReading[]) => void;
    }
}

function log(msg: string): void {
    getApi().sendLog(`[sidecar] ${msg}`);
}

function platformName(): "windows" | "macos" | "other" {
    return isWindows() ? "windows" : isMacOS() ? "macos" : "other";
}

export function SidecarBridge({ model }: { model: AgentsViewModel }) {
    useEffect(() => {
        let mounted = true;
        let live = false;
        let feed: FeedState = EMPTY_FEED;
        // the rows each tile last showed (decision 3): an agent whose stream stops keeps them
        let kept: Record<string, SidecarMessage[]> = {};
        let timer: ReturnType<typeof setTimeout> | null = null;

        // The machine and the strain band (decisions 8 to 11).
        let stats: MachineStatsData | null = null; // the last poll, with memorypressure events laid over it
        let track: StrainTrack = EMPTY_TRACK;
        let notes: HeavyNotes = EMPTY_NOTES;
        let cpuReading: { data: AgentCpuData; at: number } | null = null;
        let polls = heavyPolls(null);
        let machineTimer: ReturnType<typeof setInterval> | null = null;
        let offPressure: (() => void) | null = null;
        let consumersTimer: ReturnType<typeof setInterval> | null = null;
        let cpuTimer: ReturnType<typeof setInterval> | null = null;
        // a poll that keeps failing logs once, not every 2 s; a success lets the next failure log again
        const failedLogged = new Set<string>();
        const failure = (what: string, e: unknown) => {
            if (!failedLogged.has(what)) {
                failedLogged.add(what);
                log(`${what} failed: ${e instanceof Error ? e.message : String(e)}`);
            }
        };
        const recovered = (what: string) => failedLogged.delete(what);

        const cancelTimer = () => {
            if (timer != null) {
                clearTimeout(timer);
                timer = null;
            }
        };
        const machineSeam = (): MachineStatsData | null =>
            import.meta.env.DEV ? (window.__sidecarMachine ?? null) : null;
        const heavySeam = () => (import.meta.env.DEV ? (window.__sidecarHeavy ?? null) : null);

        // Stops every timer and subscription of the machine and the heavy polls and forgets what they read: the page is
        // gone (or held), and the next one starts from nothing.
        const stopFeeds = () => {
            if (machineTimer != null) {
                clearInterval(machineTimer);
                machineTimer = null;
            }
            offPressure?.();
            offPressure = null;
            if (consumersTimer != null) {
                clearInterval(consumersTimer);
                consumersTimer = null;
            }
            if (cpuTimer != null) {
                clearInterval(cpuTimer);
                cpuTimer = null;
            }
            stats = null;
            track = EMPTY_TRACK;
            notes = EMPTY_NOTES;
            cpuReading = null;
            polls = heavyPolls(null);
            failedLogged.clear();
        };

        const held = () => import.meta.env.DEV && window.__sidecarHold === true;
        // a hold makes the bridge not live, not only deaf to hello: a snapshot sent mid-hold would overwrite the waiting
        // state the scenario is shooting
        const isLive = () => {
            if (held()) {
                live = false;
                cancelTimer();
                stopFeeds();
                return false;
            }
            return live;
        };

        // the roster's blockId of a tile, what Stop and the CPU reading name an agent by
        const blockIds = () => new Map(globalStore.get(model.agentsAtom).map((a) => [a.id, a.blockId]));

        // the heavy rows by the band's measure, from a fresh reading (a reading a panel took an hour ago names no one)
        const heavyRows = (by: "ram" | "cpu", tiles: SidecarSnapshot["tiles"]) => {
            const seam = heavySeam();
            let consumers: CommandGetConsumersRtnData | null = null;
            let cpu: AgentCpuData | null = null;
            if (seam != null) {
                consumers = seam.consumers ?? null;
                cpu = seam.agentcpu ?? null;
            } else {
                const now = Date.now();
                const r = globalStore.get(consumersReadingAtom);
                consumers = readingFresh(r.lastOkMs, now) ? r.data : null;
                cpu = cpuReading != null && readingFresh(cpuReading.at, now) ? cpuReading.data : null;
            }
            const blocks = blockIds();
            // the notes go on after they are synced to the rows, so heavyAgents gets none
            return heavyAgents(by, tiles, consumers, cpu, (id) => blocks.get(id), {});
        };

        // the Cockpit's own filters, read where its surface keeps them (cockpitsurface.tsx)
        const cockpitScope = (agents: AgentVM[]): CockpitScope => ({
            now: globalStore.get(model.structuralNowAtom),
            dismissed: globalStore.get(model.dismissedAtom),
            backgrounded: globalStore.get(model.backgroundedIdsAtom),
            projectFilter: globalStore.get(model.projectFilterAtom),
            liveOnly: globalStore.get(model.liveOnlyAtom),
            hidden: hiddenAgentIds(agents, globalStore.get(idsWithEntriesAtom), globalStore.get(model.lineageAtom)),
        });

        const assemble = (): SidecarSnapshot => {
            const agents = globalStore.get(model.agentsAtom);
            const base = sidecarSnapshot(
                agents,
                globalStore.get(liveEntriesByIdAtom),
                globalStore.get(model.sentIdsAtom),
                kept,
                globalStore.get(model.nowAtom)
            );
            // the snapshot already falls back to `kept` for a tile with no rows of its own, so what it holds is the
            // roster's rows and nothing for an agent that has left
            kept = keptMessages(base);

            const state = strainNow(track);
            let strain: SidecarStrain | undefined;
            if (state != null) {
                const rows = heavyRows(strainBy(state), base.tiles);
                notes = syncNotes(
                    notes,
                    state.level,
                    rows.map((r) => r.id)
                );
                strain = strainOf(
                    state,
                    base.counts.working,
                    runningJobs(globalStore.get(jobQueueAtom)),
                    attachNotes(roundHeavy(rows), notes.byId)
                );
            } else {
                notes = syncNotes(notes, null, []);
            }
            // the wall shows what the Cockpit's grid shows; the band above ranked the whole roster, idle agents included,
            // since an idle agent holding memory is the one to put to sleep
            return {
                ...scopeTiles(base, wallAgentIds(agents, cockpitScope(agents))),
                ...(stats != null ? { machine: machineOf(stats, platformName()) } : {}),
                ...(strain != null ? { strain } : {}),
            };
        };

        // the heavy polls the band needs now: started when a strain band appears, stopped when it goes or its measure moves
        const syncPolls = () => {
            polls = heavyPolls(strainNow(track));
            if (polls.consumers && consumersTimer == null) {
                consumersTimer = setInterval(() => void pollConsumers(), CONSUMERS_POLL_MS);
                void pollConsumers();
            } else if (!polls.consumers && consumersTimer != null) {
                clearInterval(consumersTimer);
                consumersTimer = null;
            }
            if (polls.cpu && cpuTimer == null) {
                cpuTimer = setInterval(() => void pollCpu(), CPU_POLL_MS);
                void pollCpu();
            } else if (!polls.cpu && cpuTimer != null) {
                clearInterval(cpuTimer);
                cpuTimer = null;
            }
            if (!polls.cpu) {
                cpuReading = null;
            }
        };

        // a build and the polls it starts: the ones the band needs
        const build = (): SidecarSnapshot => {
            const snap = assemble();
            syncPolls();
            return snap;
        };

        const send = (snap: SidecarSnapshot) => {
            feed = afterEmit(snap, Date.now());
            emitTo(SIDECAR_LABEL, SIDECAR_SNAPSHOT_EVENT, snap).catch((e) => log(`snapshot not sent: ${String(e)}`));
        };

        // a store changed: the trailing emit of a throttled burst builds its own fresh snapshot when it fires
        function onChange(): void {
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
        }

        // ---- the machine ----
        const takeStats = (s: MachineStatsData) => {
            stats = s;
            track = trackStrain(track, readingOf(s, Date.now()));
            onChange();
        };

        const readMachine = async (): Promise<void> => {
            const seam = machineSeam();
            if (seam != null) {
                takeStats(seam);
                return;
            }
            try {
                const s = await RpcApi.GetMachineStatsCommand(TabRpcClient);
                recovered("machine read");
                // dropped when the page closed while the read was out, or a seam took over
                if (machineTimer != null && machineSeam() == null) {
                    takeStats(s);
                }
            } catch (e) {
                failure("machine read", e);
            }
        };

        const startMachine = () => {
            if (machineTimer != null) {
                return;
            }
            machineTimer = setInterval(() => void readMachine(), MACHINE_POLL_MS);
            offPressure = waveEventSubscribeSingle({
                eventType: "memorypressure",
                handler: (e) => {
                    if (machineSeam() != null) {
                        return;
                    }
                    // laid over the last poll, so the reading it makes carries that poll's CPU and total
                    const next = applyPressure(stats, e.data as MemoryPressureData);
                    if (next != null) {
                        takeStats(next);
                    }
                },
            });
            void readMachine();
        };

        // ---- the heavy agents ----
        async function pollConsumers(): Promise<void> {
            if (heavySeam() != null) {
                return;
            }
            // loadConsumers keeps its own failure in consumersReadingAtom; the stale reading is refused by readingFresh
            await loadConsumers();
        }

        async function pollCpu(): Promise<void> {
            if (heavySeam() != null) {
                return;
            }
            try {
                const data = await RpcApi.AgentCpuCommand(TabRpcClient);
                recovered("agent CPU read");
                // dropped when the band went down while the read was out
                if (polls.cpu) {
                    cpuReading = { data, at: Date.now() };
                    onChange();
                }
            } catch (e) {
                failure("agent CPU read", e);
            }
        }

        // after a Stop: read again what the band measures by, so the row's process is gone at once
        const refreshHeavy = async () => {
            if (polls.consumers) {
                await pollConsumers();
            }
            if (polls.cpu) {
                await pollCpu();
            }
        };

        // a Stop or Sleep outcome onto the row it was pressed on
        const noteRow = (id: string, note: string) => {
            notes = setNote(notes, id, note);
            onChange();
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
            startMachine();
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
                    // act.key is the ask the page showed: a newer ask the throttle has not sent yet takes nothing
                    const sent = answerAgentAsk(model, act.id, { 0: new Set([act.option]) }, {}, act.key);
                    if (!sent) {
                        log(
                            `answer ${act.option + 1} to ${act.id} refused: nothing sent (the agent is gone, its ask was already answered or changed, or it has no ask to answer)`
                        );
                    }
                    return;
                }
                case "older":
                    fireAndForget(async () => {
                        const vm = globalStore.get(model.agentsAtom).find((a) => a.id === act.id);
                        const entries = globalStore.get(liveEntriesByIdAtom)[act.id] ?? [];
                        const answer = await answerOlder(
                            act,
                            {
                                // the rows the main window holds, as part 1's snapshot reads them (a fixture agent's previousInfo too)
                                all: messageRows(entriesToShow(entries, vm?.previousInfo), Infinity),
                                shown: feed.lastSent?.tiles.find((t) => t.id === act.id)?.messages ?? [],
                                path: vm?.transcriptPath,
                                agent: vm?.agent,
                            },
                            { memory: olderFromMemory, file: readOlderFromFile },
                            log
                        );
                        // nothing is kept after the answer
                        await emitTo(SIDECAR_LABEL, SIDECAR_OLDER_EVENT, answer).catch((e) =>
                            log(`older answer to ${act.id} not sent: ${String(e)}`)
                        );
                    });
                    return;
                case "stop":
                    fireAndForget(async () => {
                        if (heavySeam() != null) {
                            noteRow(act.id, "Not run (fixture)");
                            return;
                        }
                        const block = blockIds().get(act.id);
                        if (block == null) {
                            noteRow(act.id, "Couldn't stop it: the agent has no terminal");
                            return;
                        }
                        try {
                            await RpcApi.StopProcessCommand(TabRpcClient, { blockid: block, pid: act.pid });
                        } catch (e) {
                            noteRow(act.id, stopNote(e));
                        }
                        await refreshHeavy();
                    });
                    return;
                case "sleep":
                    fireAndForget(async () => {
                        if (heavySeam() != null) {
                            noteRow(act.id, "Not run (fixture)");
                            return;
                        }
                        const vm = globalStore.get(model.agentsAtom).find((a) => a.id === act.id);
                        if (vm == null) {
                            noteRow(act.id, "Couldn't put it to sleep: the agent is gone");
                            return;
                        }
                        const outcome = await sleepWithConfirm({ id: vm.id, name: vm.name });
                        noteRow(act.id, sleepNote(outcome));
                        if (outcome === "asked") {
                            // the confirm opened in the main window: bring it up
                            await showMain(model);
                        }
                    });
                    return;
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
        fireAndForget(async () => {
            const windows = await getAllWindows();
            if (mounted && windows.some((w) => w.label === SIDECAR_LABEL)) {
                hello();
            }
        });

        if (import.meta.env.DEV) {
            window.__sidecarRefresh = async () => {
                await readMachine();
                await refreshHeavy();
                onChange();
            };
            window.__sidecarFeed = (readings) => {
                // from nothing: the track ignores a reading older than the last it took, so feeding on top of the live
                // track would drop these
                track = EMPTY_TRACK;
                for (const r of readings) {
                    track = trackStrain(track, r);
                }
                onChange();
            };
        }

        const offs = [
            globalStore.sub(model.agentsAtom, onChange),
            globalStore.sub(liveEntriesByIdAtom, onChange),
            globalStore.sub(model.sentIdsAtom, onChange),
            // the Cockpit's filters, and its ~15 s clock that ends a just-finished agent's grace window; a rebuild that
            // changes no tile sends nothing (planChange)
            globalStore.sub(model.dismissedAtom, onChange),
            globalStore.sub(model.backgroundedIdsAtom, onChange),
            globalStore.sub(model.projectFilterAtom, onChange),
            globalStore.sub(model.liveOnlyAtom, onChange),
            globalStore.sub(model.structuralNowAtom, onChange),
            // the heavy readings and the running jobs only matter to a band that exists
            globalStore.sub(consumersReadingAtom, () => {
                if (polls.consumers) {
                    onChange();
                }
            }),
            globalStore.sub(jobQueueAtom, () => {
                if (polls.consumers || polls.cpu) {
                    onChange();
                }
            }),
        ];
        const listeners = [
            listen<unknown>(SIDECAR_ACT_EVENT, (e) => onAct(e.payload)),
            listen(SIDECAR_CLOSED_EVENT, () => {
                live = false;
                feed = afterClosed();
                cancelTimer();
                stopFeeds();
            }),
        ];
        return () => {
            mounted = false;
            cancelTimer();
            stopFeeds();
            if (import.meta.env.DEV) {
                delete window.__sidecarRefresh;
                delete window.__sidecarFeed;
            }
            offs.forEach((off) => off());
            listeners.forEach((p) => void p.then((off) => off()));
        };
    }, [model]);

    return null;
}
