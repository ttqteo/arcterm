// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer's Servers popover (docs/superpowers/specs/2026-10-08-machine-servers-design.md): every listening process
// on the machine grouped by repo, each with what holds it, and per row open a port, read the log, copy, stop. Opened
// from the Servers chip. machineservers.ts decides what each row shows; this draws, and machineserversstore.ts polls.
// A stray server (no owner) can be restarted in arcterm: stopped, then run again in a terminal, whose pane is its log.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { pushToast } from "@/app/cockpit/notificationstore";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { SkeletonLine } from "@/app/element/skeleton";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronRight, Copy, FileText, Pin, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openFileInPanel, openRefInCode } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import { pinServerAsApp, suggestForFolder } from "./appsuggeststore";
import { copyText, portsLabel, serverUrl, uptimeLabel, type TerminalLog } from "./devserversmodel";
import { buildMachineServers, logHost, restartPlan, type MachineBadge, type MachineRow } from "./machineservers";
import {
    forgetMachineServer,
    loadMachineServers,
    machineServersOpenAtom,
    machineServersReadingAtom,
    useMachineServersPoll,
} from "./machineserversstore";
import { projectListAtom } from "./projectsstore";
import { ACTION_BTN, ServerStopButton } from "./railservers";
import { ensureServicesFeed, servicesAtom, stopService } from "./servicesstore";
import { backgroundTasksByIdAtom } from "./subagentsstore";
import { openTerminalLog } from "./terminallog";

// how often the uptimes are recomputed while the popover is open
const NOW_TICK_MS = 30_000;

const NO_OWNER_TIP = "Still running. No agent, terminal or open app holds it.";
// a process started outside arcterm whose output goes to a console or a pipe, which no other process can read (one
// writing to a file has that file as its log)
const NO_LOG_TIP = "No log here: it was started outside arcterm, and its output goes to the console that started it.";
const NO_LOG_RESTART_TIP = `${NO_LOG_TIP} Restart it in arcterm to see it.`;
const RESTART_TIP = "Restart in arcterm: stop it and run it again in a terminal, which shows its output";
// how long Restart waits for its second click
const RESTART_CONFIRM_MS = 3000;
const BADGE = "rounded-[4px] px-1 text-[10.5px]";

// a StopDevServer refusal that says the listed process is no longer the one running (pkg/devservers)
const ALREADY_EXITED = /is not running|PID was reused|no longer the server/i;

function close(): void {
    globalStore.set(machineServersOpenAtom, false);
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

async function stopServer(row: MachineRow): Promise<void> {
    try {
        if (row.badge.kind === "service" && row.badge.serviceId != null) {
            // wavesrv supervises a held service: killing its process from outside reads as a crash and restarts it
            await stopService(row.badge.serviceId);
        } else {
            await RpcApi.StopDevServerCommand(TabRpcClient, { pid: row.server.pid, createms: row.server.createms });
        }
        forgetMachineServer(row.server);
    } catch (e) {
        const text = errorText(e);
        if (ALREADY_EXITED.test(text)) {
            pushToast({ title: "That process already exited", message: "The list is refreshed.", level: "info" });
        } else {
            pushToast({ title: "Couldn't stop it", message: text, level: "error" });
        }
        // either way the list is out of date
        fireAndForget(() => loadMachineServers());
    }
}

// Restart in arcterm: stop the server, then run the line that starts it (restartPlan) in a terminal in its folder, which
// takes the centre. A stop refused for another reason than the process being gone runs nothing: the port is still held.
async function restartServer(model: AgentsViewModel, row: MachineRow): Promise<void> {
    const s = row.server;
    const plan = restartPlan(s, await suggestForFolder(s.cwd), globalStore.get(projectListAtom));
    try {
        await RpcApi.StopDevServerCommand(TabRpcClient, { pid: s.pid, createms: s.createms });
    } catch (e) {
        const text = errorText(e);
        if (!ALREADY_EXITED.test(text)) {
            pushToast({ title: "Couldn't stop it", message: text, level: "error" });
            fireAndForget(() => loadMachineServers());
            return;
        }
    }
    forgetMachineServer(s);
    await launchAgent(model, {
        runtime: "terminal",
        startupCommand: plan.command,
        task: "",
        projectPath: plan.cwd,
        projectName: plan.projectName,
    });
}

// Restart asks twice, as Stop does: it stops the server too
function RestartButton({
    onRestart,
    onConfirmingChange,
}: {
    onRestart: () => void;
    onConfirmingChange: (confirming: boolean) => void;
}) {
    const [confirming, setConfirmingState] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const setConfirming = (c: boolean) => {
        setConfirmingState(c);
        onConfirmingChange(c);
    };
    useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
    const click = () => {
        clearTimeout(timer.current ?? undefined);
        if (!confirming) {
            setConfirming(true);
            timer.current = setTimeout(() => setConfirming(false), RESTART_CONFIRM_MS);
            return;
        }
        setConfirming(false);
        onRestart();
    };
    return (
        <button
            type="button"
            data-machine-server-restart
            title={confirming ? "Click again to restart it in arcterm" : RESTART_TIP}
            aria-label={confirming ? "Confirm restart in arcterm" : "Restart in arcterm"}
            onClick={click}
            className={cn(
                ACTION_BTN,
                confirming && "border border-edge-strong px-[6px] text-[10.5px] font-semibold text-primary"
            )}
        >
            {confirming ? "Restart here?" : <RotateCw size={12} aria-hidden />}
        </button>
    );
}

function Badge({ badge, model }: { badge: MachineBadge; model: AgentsViewModel }) {
    if (badge.kind === "noowner") {
        return (
            <span data-machine-server-badge="noowner" title={NO_OWNER_TIP} className={cn(BADGE, "text-warning")}>
                {badge.text}
            </span>
        );
    }
    if (badge.kind === "app" || badge.tabId == null) {
        return (
            <span data-machine-server-badge={badge.kind} className={cn(BADGE, "text-muted")}>
                {badge.text}
            </span>
        );
    }
    const tabId = badge.tabId;
    return (
        <button
            type="button"
            data-machine-server-badge={badge.kind}
            title={`Open ${badge.text}`}
            onClick={() => {
                close();
                fireAndForget(() => openTarget(model, { kind: "agent", tabId }));
            }}
            className={cn(
                BADGE,
                "cursor-pointer bg-surface-hover text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            )}
        >
            {badge.text}
        </button>
    );
}

// One listening process, laid out like the rail's: ports (each opens in the browser), what it runs and for how long;
// then its PID, what holds it, its Log (always shown, faint with a reason when there is none), and Pin as app / Copy /
// Restart in arcterm (a stray server's) / Stop while the row is hovered or focused. Restart and Stop ask twice.
// A held service's server (badge `app · <name>`) has no Pin, being an app already, and its Stop goes through wavesrv.
function ServerRow({ row, model, now }: { row: MachineRow; model: AgentsViewModel; now: number }) {
    const [stopConfirming, setStopConfirming] = useState(false);
    const [restartConfirming, setRestartConfirming] = useState(false);
    const confirming = stopConfirming || restartConfirming;
    const s = row.server;
    const openLog = (log: NonNullable<MachineRow["log"]>) => {
        openFileInPanel(model, log.agentId, {
            abs: log.task.outputFile!,
            root: null,
            reread: Date.now(),
            live: true,
            title: `${portsLabel(s.ports)} ${row.label}`,
        });
        fireAndForget(() => openTarget(model, { kind: "agent", tabId: log.agentId }));
        close();
    };
    // the file its output goes to, followed live in an agent's side panel (the focused one's); with no agent, the editor
    const openFileLog = (abs: string) => {
        const host = logHost(globalStore.get(model.focusIdAtom), globalStore.get(model.agentsAtom));
        if (host == null) {
            fireAndForget(() => openRefInCode(model, { abs, root: null }));
        } else {
            openFileInPanel(model, host, {
                abs,
                root: null,
                reread: Date.now(),
                live: true,
                title: `${portsLabel(s.ports)} ${row.label}`,
            });
            fireAndForget(() => openTarget(model, { kind: "agent", tabId: host }));
        }
        close();
    };
    // a server in an arcterm terminal: that terminal, with its search box open
    const openTermLog = (log: TerminalLog) => {
        openTerminalLog(model, log);
        close();
    };
    return (
        <div
            data-machine-server={s.pid}
            className="group/server flex items-start gap-[10px] px-3 py-[6px] hover:bg-surface-hover"
        >
            <span className="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full bg-success" />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <div className="flex min-w-0 items-baseline gap-[6px]">
                    {s.ports.map((port) => (
                        <button
                            key={port}
                            type="button"
                            data-machine-server-port={port}
                            title={`Open ${serverUrl(port)}`}
                            onClick={() => getApi().openExternal(serverUrl(port))}
                            className="shrink-0 cursor-pointer rounded-[4px] text-[11.5px] tabular-nums font-semibold text-accent-soft hover:bg-surface-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            {portsLabel([port])}
                        </button>
                    ))}
                    <span
                        data-machine-server-label
                        title={s.cmdline}
                        className="min-w-0 flex-1 truncate text-[11.5px] text-secondary"
                    >
                        {row.label}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[10.5px] tabular-nums text-muted">
                        {uptimeLabel(s.createms, now)}
                    </span>
                </div>
                <div className="flex min-w-0 items-center gap-[6px]">
                    <span className="shrink-0 text-[10.5px] tabular-nums text-muted">PID {s.pid}</span>
                    <Badge badge={row.badge} model={model} />
                    <span
                        className={cn(
                            "-my-[2px] ml-auto flex shrink-0 items-center gap-[2px]",
                            !confirming && "opacity-0 focus-within:opacity-100 group-hover/server:opacity-100"
                        )}
                    >
                        {row.badge.kind === "service" ? null : (
                            <button
                                type="button"
                                data-machine-server-pin
                                title="Pin as app"
                                aria-label="Pin as app"
                                onClick={() => {
                                    fireAndForget(() => pinServerAsApp(model, s));
                                    close();
                                }}
                                className={ACTION_BTN}
                            >
                                <Pin size={12} aria-hidden />
                            </button>
                        )}
                        <button
                            type="button"
                            data-machine-server-copy
                            title="Copy PID and command"
                            aria-label="Copy PID and command"
                            onClick={() => fireAndForget(() => navigator.clipboard.writeText(copyText(s)))}
                            className={ACTION_BTN}
                        >
                            <Copy size={12} aria-hidden />
                        </button>
                        {row.restart ? (
                            <RestartButton
                                onRestart={() => {
                                    fireAndForget(() => restartServer(model, row));
                                    close();
                                }}
                                onConfirmingChange={setRestartConfirming}
                            />
                        ) : null}
                        <ServerStopButton
                            confirmLabel={row.stopConfirm}
                            onStop={() => fireAndForget(() => stopServer(row))}
                            onConfirmingChange={setStopConfirming}
                        />
                    </span>
                    {/* Log stays in view: the one action a row is opened for, at the row end */}
                    <span className="-my-[2px] flex shrink-0 items-center">
                        {row.log != null || row.termLog != null || row.fileLog != null ? (
                            <button
                                type="button"
                                data-machine-server-log
                                data-machine-server-termlog={row.log == null && row.termLog != null ? "" : undefined}
                                data-machine-server-filelog={row.log == null && row.termLog == null ? "" : undefined}
                                title={row.fileLog != null ? `Open its live log (${row.fileLog})` : "Open its live log"}
                                aria-label="Open its live log"
                                onClick={() =>
                                    row.log != null
                                        ? openLog(row.log)
                                        : row.termLog != null
                                          ? openTermLog(row.termLog)
                                          : openFileLog(row.fileLog!)
                                }
                                className={ACTION_BTN}
                            >
                                <FileText size={12} aria-hidden />
                            </button>
                        ) : (
                            <span
                                data-machine-server-nolog
                                title={row.restart ? NO_LOG_RESTART_TIP : NO_LOG_TIP}
                                aria-label={row.restart ? NO_LOG_RESTART_TIP : NO_LOG_TIP}
                                className="flex h-[18px] min-w-[18px] items-center justify-center px-[3px] text-muted opacity-40"
                            >
                                <FileText size={12} aria-hidden />
                            </span>
                        )}
                    </span>
                </div>
            </div>
        </div>
    );
}

export function MachineServersPanel({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(machineServersOpenAtom);
    const reading = useAtomValue(machineServersReadingAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const bgTasks = useAtomValue(backgroundTasksByIdAtom);
    const services = useAtomValue(servicesAtom);
    useEffect(() => ensureServicesFeed(), []);
    // the panel is always mounted, so this keeps its state between openings
    const [otherOpen, setOtherOpen] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    // the one poll for chip and popover
    useMachineServersPoll(open);
    useEffect(() => {
        if (!open) {
            return;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
        return () => clearInterval(timer);
    }, [open]);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            // a confirm over the panel owns Esc: it closes alone and the panel stays
            if (e.key !== "Escape" || modalsModel.hasOpenModals()) {
                return;
            }
            e.stopPropagation();
            close();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open]);
    const view = useMemo(
        () =>
            reading.servers == null
                ? null
                : buildMachineServers(
                      reading.servers,
                      [...agents, ...terminals],
                      bgTasks,
                      (services ?? []).map((s) => ({ id: s.id, name: s.name, tabid: s.tabid }))
                  ),
        [reading.servers, agents, terminals, bgTasks, services]
    );
    return (
        <>
            {open ? <div data-machine-servers-backdrop className="fixed inset-0 z-50" onClick={close} /> : null}
            <PopoverReveal
                open={open}
                origin="bottom right"
                // its chip sits at the footer's right end, so it rises from just above it
                className="fixed bottom-[42px] right-4 z-[60] w-[520px] max-h-[60vh] overflow-y-auto rounded-lg border border-edge-strong bg-surface-raised shadow-popover"
            >
                <div data-machine-servers-panel role="dialog" aria-label="Servers on this machine">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                        <span className="flex-1 text-[12px] text-secondary">Servers on this machine</span>
                        {reading.servers != null ? (
                            <span data-machine-servers-count className="text-[12px] tabular-nums text-secondary">
                                {reading.servers.length}
                            </span>
                        ) : null}
                    </div>
                    {reading.failed ? (
                        <div data-machine-servers-failed className="px-3 py-1.5 text-[11.5px] text-warning">
                            Could not read listening ports
                        </div>
                    ) : null}
                    <div data-machine-servers-list className={cn("py-1", reading.failed && "opacity-60")}>
                        {view == null ? (
                            <div className="flex flex-col gap-2 px-3 py-2">
                                <SkeletonLine className="w-3/4" />
                                <SkeletonLine className="w-2/3" />
                            </div>
                        ) : view.groups.length === 0 && view.other.length === 0 ? (
                            <div data-machine-servers-empty className="px-3 py-2 text-[12px] text-muted">
                                Nothing is listening.
                            </div>
                        ) : (
                            <>
                                {view.groups.map((g) => (
                                    <div key={g.repo}>
                                        <div
                                            data-machine-servers-group={g.title}
                                            title={g.repo}
                                            className="px-3 pb-0.5 pt-1.5 text-[11px] text-muted"
                                        >
                                            {g.title}
                                        </div>
                                        {g.rows.map((r) => (
                                            <ServerRow key={r.key} row={r} model={model} now={now} />
                                        ))}
                                    </div>
                                ))}
                                {view.other.length > 0 ? (
                                    <div>
                                        <button
                                            type="button"
                                            data-machine-servers-other
                                            aria-expanded={otherOpen}
                                            onClick={() => setOtherOpen((o) => !o)}
                                            className="flex w-full cursor-pointer items-center gap-1 px-3 pb-0.5 pt-1.5 text-left text-[11px] text-muted hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                        >
                                            <ChevronRight
                                                size={12}
                                                aria-hidden
                                                className={cn("shrink-0", otherOpen && "rotate-90")}
                                            />
                                            <span className="min-w-0 flex-1 truncate">
                                                Other ({view.other.length}) {view.otherNames}
                                            </span>
                                        </button>
                                        {otherOpen
                                            ? view.other.map((r) => (
                                                  <ServerRow key={r.key} row={r} model={model} now={now} />
                                              ))
                                            : null}
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>
            </PopoverReveal>
        </>
    );
}
