// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit's side of the menu bar / tray popover (spec 2026-10-15-tray-popover-design.md): it keeps the icon's
// count and red dot current (set_tray_status), and while the popover is open it sends it a TraySnapshot built from
// the cockpit's own stores and carries out what trayActPlan decides for each TrayAct it sends back. The host
// (src-tauri/src/tray.rs) handles close, restart, quit, show log and the OS's monitor itself. Mounted once in the
// cockpit shell, which lives as long as arcterm does, folded into Sprout or not.

import { pushToast } from "@/app/cockpit/notificationstore";
import { getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { showCanvases } from "@/app/view/agents/agentcenter";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { consumersReadingAtom, loadConsumers, useConsumersPoll } from "@/app/view/agents/consumersstore";
import { floatMiniAtom, restoreFromSprout } from "@/app/view/agents/floatstore";
import { openSettingsSection } from "@/app/view/agents/settingsstore";
import { cleanToast } from "@/app/view/agents/storagemodel";
import { cleanStorage, storageReportAtom, useStorageReport } from "@/app/view/agents/storagestore";
import { usePlanDonuts } from "@/app/view/agents/usagemeters";
import { openTarget } from "@/app/view/jarvis/openref";
import { runAct } from "@/app/view/jarvis/petactrun";
import { queueRows } from "@/app/view/jarvis/petpeekmodel";
import { isMacOS, isWindows } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { jobQueueAtom } from "./jobqueuestore";
import { trayActPlan, type TrayStep } from "./trayactmodel";
import { trayBadge, traySnapshot } from "./traysnapshot";
import type { TrayAct, TrayPage } from "./traytypes";

const MACHINE_POLL_MS = 1000;

async function showMain(model: AgentsViewModel): Promise<void> {
    if (globalStore.get(floatMiniAtom)) {
        await restoreFromSprout(model);
    }
    const win = getCurrentWindow();
    try {
        await win.unminimize();
        await win.show();
        await win.setFocus();
    } catch {
        // the browser app has no window to raise
    }
}

async function clean(step: Extract<TrayStep, { kind: "clean" }>): Promise<void> {
    try {
        const result = await cleanStorage(step.category, step.itemids, { olderthandays: step.olderthandays });
        pushToast({
            title: "Storage",
            message: cleanToast(result),
            level: result.skipped?.length ? "warn" : "info",
        });
    } catch (e) {
        pushToast({ title: "Storage", message: `Couldn't clean: ${String(e)}`, level: "error" });
    }
}

async function stop(step: Extract<TrayStep, { kind: "stop" }>): Promise<void> {
    try {
        await RpcApi.StopProcessCommand(TabRpcClient, { blockid: step.blockid, pid: step.pid });
    } catch (e) {
        // a refusal (the process exited, or its pid is no longer under the agent) comes back as the message to show
        pushToast({ title: "Free up", message: String(e), level: "warn" });
    }
    await loadConsumers();
}

export function TrayBridge({ model }: { model: AgentsViewModel }) {
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const messages = useAtomValue(channelMessagesAtom);
    const peekRows = useMemo(() => queueRows(items, agents, messages), [items, agents, messages]);
    const trayOn = (useAtomValue(getSettingsKeyAtom("app:tray")) as boolean | undefined) ?? true;
    const [pressure, setPressure] = useState("");
    const [open, setOpen] = useState(false);
    const [page, setPage] = useState<TrayPage>("main");
    const [machine, setMachine] = useState<MachineStatsData | null>(null);
    // when wavesrv last answered: the popover's offline page shows it, frozen once wavesrv has gone
    const [heardAt, setHeardAt] = useState<number | null>(null);
    const jobQueue = useAtomValue(jobQueueAtom);
    const donuts = usePlanDonuts(model);
    const storage = useStorageReport(false);
    const consumers = useAtomValue(consumersReadingAtom).data;
    const now = useAtomValue(model.nowAtom);
    useConsumersPoll(open && page === "freeup");

    // the icon's red dot: one reading at start, then each change wavesrv publishes
    useEffect(() => {
        RpcApi.GetMachineStatsCommand(TabRpcClient)
            .then((m) => {
                setPressure(m.pressure);
                setHeardAt(Date.now());
            })
            .catch(() => {});
        return waveEventSubscribeSingle({
            eventType: "memorypressure",
            handler: (e) => setPressure((e.data as MemoryPressureData)?.level ?? ""),
        });
    }, []);

    const badge = trayBadge(peekRows, pressure);
    useEffect(() => {
        void invoke("set_tray_status", { count: badge.count, alert: badge.alert, visible: trayOn }).catch(() => {});
    }, [badge.count, badge.alert, trayOn]);

    useEffect(() => {
        if (!open) {
            return;
        }
        let live = true;
        const read = () =>
            RpcApi.GetMachineStatsCommand(TabRpcClient)
                .then((m) => {
                    if (live) {
                        setMachine(m);
                        setPressure(m.pressure);
                        setHeardAt(Date.now());
                    }
                })
                .catch(() => {});
        void read();
        const t = setInterval(read, MACHINE_POLL_MS);
        return () => {
            live = false;
            clearInterval(t);
        };
    }, [open]);

    const platform = isMacOS() ? "mac" : isWindows() ? "win" : "other";
    const snapshot = useMemo(
        () => traySnapshot({ platform, machine, jobQueue, agents, peekRows, donuts, storage, consumers, heardAt, now }),
        [platform, machine, jobQueue, agents, peekRows, donuts, storage, consumers, heardAt, now]
    );
    useEffect(() => {
        if (open) {
            void emit("tray:snapshot", snapshot).catch(() => {});
        }
    }, [open, snapshot]);

    // the act handler reads the latest rows, jobs and report through a ref, so the listener is registered once
    const latest = useRef({ peekRows, agents, jobQueue });
    latest.current = { peekRows, agents, jobQueue };
    useEffect(() => {
        const carryOut = async (step: TrayStep) => {
            switch (step.kind) {
                case "hello":
                    setOpen(true);
                    setPage("main");
                    return;
                case "page":
                    setPage(step.page);
                    return;
                case "nothing":
                    return;
                case "settings":
                    openSettingsSection(model, step.section);
                    return;
                case "surface":
                    globalStore.set(model.surfaceAtom, step.surface);
                    return;
                case "gallery":
                    showCanvases(model);
                    return;
                case "act":
                    await runAct(model, step.act);
                    return;
                case "target":
                    await openTarget(model, step.target);
                    return;
                case "run-now":
                    await RpcApi.JobQueueRunNowCommand(TabRpcClient, { id: step.id });
                    return;
                case "skip":
                    await RpcApi.JobQueueSkipCommand(TabRpcClient, { id: step.id });
                    return;
                case "config":
                    await RpcApi.SetConfigCommand(TabRpcClient, step.patch);
                    return;
                case "stop":
                    await stop(step);
                    return;
                case "clean":
                    await clean(step);
                    return;
            }
        };
        const onAct = (a: TrayAct) => {
            const plan = trayActPlan(a, {
                ...latest.current,
                storage: globalStore.get(storageReportAtom),
                now: Date.now(),
            });
            if (plan == null) {
                return; // close, restart, quit, show log, the OS's monitor: the host's
            }
            fireAndForget(async () => {
                if (plan.raise) {
                    await showMain(model);
                }
                await carryOut(plan.step);
            });
        };
        const offs = [
            listen<TrayAct>("tray:act", (e) => onAct(e.payload)),
            listen("tray:closed", () => setOpen(false)),
        ];
        return () => offs.forEach((p) => void p.then((off) => off()));
    }, [model]);

    return null;
}
