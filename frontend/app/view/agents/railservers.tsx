// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's Servers section: the processes listening in the agent's project (pkg/devservers), one row each,
// a failed read as one muted line above them. Polled by devserversstore.ts; labels and log matching are
// devserversmodel.ts. A row opens a port in the browser and, for a server this agent started with a background
// command, that command's output; it also copies and stops the process.

import { getApi } from "@/app/store/global";
import { fireAndForget } from "@/util/util";
import { Copy, FileText, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openFileInPanel } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import {
    copyText,
    matchLogTask,
    ownerLabel,
    portsLabel,
    serverLabel,
    serverUrl,
    uptimeLabel,
    type DevServerRow,
} from "./devserversmodel";
import { stopDevServer } from "./devserversstore";
import type { BackgroundTask } from "./transcriptprojection";

// how long a first click on Stop waits for the second
const STOP_CONFIRM_MS = 3000;

const ACTION_BTN =
    "flex h-[18px] min-w-[18px] cursor-pointer items-center justify-center rounded-[5px] px-[3px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// One listening process: its ports (each opens in the browser), what it runs and for how long, then its PID and who
// started it. Log, Copy and Stop appear on the second line while the row is hovered or focused; Stop asks twice.
function DevServerItem({
    row,
    now,
    logTask,
    onOpenLog,
}: {
    row: DevServerRow;
    now: number;
    logTask: BackgroundTask | undefined;
    onOpenLog: (task: BackgroundTask) => void;
}) {
    const [confirming, setConfirming] = useState(false);
    const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (confirmTimer.current != null) {
                clearTimeout(confirmTimer.current);
            }
        },
        []
    );
    const stop = () => {
        if (!confirming) {
            setConfirming(true);
            confirmTimer.current = setTimeout(() => setConfirming(false), STOP_CONFIRM_MS);
            return;
        }
        if (confirmTimer.current != null) {
            clearTimeout(confirmTimer.current);
        }
        setConfirming(false);
        fireAndForget(() => stopDevServer(row));
    };
    return (
        <div
            data-dev-server={row.pid}
            className="group/server flex items-start gap-[10px] rounded-[8px] bg-surface-raised px-[11px] py-[8px]"
        >
            <span className="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full bg-success" />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <div className="flex min-w-0 items-baseline gap-[6px]">
                    {row.ports.map((port) => (
                        <button
                            key={port}
                            type="button"
                            data-dev-server-port={port}
                            title={`Open ${serverUrl(port)}`}
                            onClick={() => getApi().openExternal(serverUrl(port))}
                            className="shrink-0 cursor-pointer rounded-[4px] font-mono text-[11.5px] font-semibold text-accent-soft hover:bg-surface-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            {portsLabel([port])}
                        </button>
                    ))}
                    <span title={row.cmdline} className="min-w-0 flex-1 truncate text-[11.5px] text-secondary">
                        {serverLabel(row)}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[10.5px] tabular-nums text-muted">
                        {uptimeLabel(row.createms, now)}
                    </span>
                </div>
                <div className="flex min-w-0 items-center gap-[6px]">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted">
                        PID {row.pid} · {ownerLabel(row)}
                    </span>
                    <span
                        className={
                            confirming
                                ? "-my-[2px] flex shrink-0 items-center gap-[2px]"
                                : "-my-[2px] flex shrink-0 items-center gap-[2px] opacity-0 focus-within:opacity-100 group-hover/server:opacity-100"
                        }
                    >
                        {logTask != null ? (
                            <button
                                type="button"
                                data-dev-server-log
                                title="Open its log"
                                aria-label="Open its log"
                                onClick={() => onOpenLog(logTask)}
                                className={ACTION_BTN}
                            >
                                <FileText size={12} aria-hidden />
                            </button>
                        ) : null}
                        <button
                            type="button"
                            data-dev-server-copy
                            title="Copy PID and command"
                            aria-label="Copy PID and command"
                            onClick={() => fireAndForget(() => navigator.clipboard.writeText(copyText(row)))}
                            className={ACTION_BTN}
                        >
                            <Copy size={12} aria-hidden />
                        </button>
                        <button
                            type="button"
                            data-dev-server-stop
                            title={confirming ? "Click again to stop it" : "Stop it and what it started"}
                            aria-label={confirming ? "Confirm stop" : "Stop"}
                            onClick={stop}
                            className={
                                confirming
                                    ? "flex h-[18px] min-w-[18px] cursor-pointer items-center justify-center rounded-[5px] border border-error/30 px-[6px] text-[10.5px] font-semibold text-error hover:bg-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    : ACTION_BTN
                            }
                        >
                            {confirming ? "Stop?" : <Square size={12} aria-hidden />}
                        </button>
                    </span>
                </div>
            </div>
        </div>
    );
}

export function ServersSection({
    model,
    agentId,
    servers,
    failed,
    bgTasks,
    now,
}: {
    model: AgentsViewModel;
    agentId: string;
    servers: DevServerRow[];
    failed: boolean;
    bgTasks: BackgroundTask[];
    now: number;
}) {
    // a server's log is its launching background task's output file, followed live (the task is running)
    const openLog = (task: BackgroundTask) =>
        openFileInPanel(model, agentId, { abs: task.outputFile!, root: null, reread: Date.now(), live: "on" });
    return (
        <div data-rail-servers className="flex flex-col gap-[7px]">
            {failed ? (
                <div data-dev-servers-failed className="text-[11.5px] text-muted">
                    Could not read listening ports
                </div>
            ) : null}
            {servers.map((row) => (
                <DevServerItem
                    key={`${row.pid}:${row.createms}`}
                    row={row}
                    now={now}
                    logTask={matchLogTask(row, bgTasks)}
                    onOpenLog={openLog}
                />
            ))}
        </div>
    );
}
