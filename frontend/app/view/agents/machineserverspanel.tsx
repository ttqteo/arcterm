// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer's Servers popover (docs/superpowers/specs/2026-10-08-machine-servers-design.md): every listening process
// on the machine grouped by repo, each with what holds it, and per row open a port, read the log, copy, stop. Opened
// from the Servers chip. machineservers.ts decides what each row shows; this draws, and machineserversstore.ts polls.

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
import { ChevronRight, Copy, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { openFileInPanel } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import { copyText, portsLabel, serverUrl, uptimeLabel } from "./devserversmodel";
import { buildMachineServers, type MachineBadge, type MachineRow } from "./machineservers";
import {
    forgetMachineServer,
    loadMachineServers,
    machineServersOpenAtom,
    machineServersReadingAtom,
    useMachineServersPoll,
} from "./machineserversstore";
import { ACTION_BTN, ServerStopButton } from "./railservers";
import { backgroundTasksByIdAtom } from "./subagentsstore";

// how often the uptimes are recomputed while the popover is open
const NOW_TICK_MS = 30_000;

const NO_OWNER_TIP = "Still running. No agent, terminal or open app holds it.";
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
        await RpcApi.StopDevServerCommand(TabRpcClient, { pid: row.server.pid, createms: row.server.createms });
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
// then its PID, what holds it, and Log / Copy / Stop while the row is hovered or focused. Stop asks twice.
function ServerRow({ row, model, now }: { row: MachineRow; model: AgentsViewModel; now: number }) {
    const [confirming, setConfirming] = useState(false);
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
                            className="shrink-0 cursor-pointer rounded-[4px] font-mono text-[11.5px] font-semibold text-accent-soft hover:bg-surface-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
                    <span className="shrink-0 font-mono text-[10.5px] text-muted">PID {s.pid}</span>
                    <Badge badge={row.badge} model={model} />
                    <span
                        className={cn(
                            "-my-[2px] ml-auto flex shrink-0 items-center gap-[2px]",
                            !confirming && "opacity-0 focus-within:opacity-100 group-hover/server:opacity-100"
                        )}
                    >
                        {row.log != null ? (
                            <button
                                type="button"
                                data-machine-server-log
                                title="Open its log"
                                aria-label="Open its log"
                                onClick={() => openLog(row.log!)}
                                className={ACTION_BTN}
                            >
                                <FileText size={12} aria-hidden />
                            </button>
                        ) : null}
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
                        <ServerStopButton
                            confirmLabel={row.stopConfirm}
                            onStop={() => fireAndForget(() => stopServer(row))}
                            onConfirmingChange={setConfirming}
                        />
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
            reading.servers == null ? null : buildMachineServers(reading.servers, [...agents, ...terminals], bgTasks),
        [reading.servers, agents, terminals, bgTasks]
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
