// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Consumers panel (spec 2026-10-08-consumers-panel-design.md): every live agent with its RAM and its tokens and
// spend of the last 10 minutes, a run's workers under their run, and Stop / → Sonnet per row; free RAM and the 5-hour
// quota in the header, arcterm's own processes below. Opened from the RAM chip (ranked by RAM) and the plan-usage
// meters (ranked by tokens). Rows are ranked when it opens and keep their place while it is open. consumers.ts
// decides; this draws.

import { pushToast } from "@/app/cockpit/notificationstore";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Moon, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import { sleepWithConfirm, wakeAgent, wakeErrorToast } from "./agentsleep";
import {
    buildConsumers,
    holdOrder,
    PANEL_WIDTH,
    panelPlacement,
    ramLabel,
    staleLine,
    STATE_DOT,
    stopWorkerMessage,
    switchToastText,
    type ConsumerRow,
} from "./consumers";
import { consumersOpenAtom, consumersOpenerAtom, consumersReadingAtom, useConsumersPoll } from "./consumersstore";
import { usePlanDonuts } from "./usagemeters";
import { fmt, usd } from "./usagestats";
import { formatGB } from "./workercapacity";

// whether `/model` switches a Claude session inside a running turn: the consumers-panel plan's Task 1 could not check
// it (no tmux), so a mid-turn switch is worded as waiting for the next turn
const MODEL_SWITCH_APPLIES_MIDTURN = false;

// stopping a worker waits for it to exit
const STOP_TIMEOUT_MS = 60_000;

function close(): void {
    globalStore.set(consumersOpenAtom, null);
}

function stop(row: ConsumerRow, model: AgentsViewModel): void {
    const dag = row.dag;
    if (dag == null) {
        confirmCloseSession(row.vm, model);
        return;
    }
    // a worker's tab is named for its project, so its toasts name the task
    modalsModel.pushModal("ConfirmModal", {
        title: "Stop worker",
        message: stopWorkerMessage(row),
        confirmLabel: "Stop worker",
        destructive: true,
        onConfirm: () =>
            fireAndForget(async () => {
                try {
                    await RpcApi.DagActionCommand(
                        TabRpcClient,
                        { channelid: dag.channelid, runid: dag.runid, taskid: dag.taskid, action: "stop" },
                        { timeout: STOP_TIMEOUT_MS }
                    );
                    pushToast({
                        title: `Worker ${dag.taskid} stopped`,
                        message: "Its task waits until you retry or skip it.",
                        level: "info",
                    });
                } catch (e) {
                    pushToast({ title: `Couldn't stop worker ${dag.taskid}`, message: String(e), level: "error" });
                }
            }),
    });
}

function toSonnet(row: ConsumerRow): void {
    fireAndForget(async () => {
        try {
            const rtn = await RpcApi.AgentsSetModelCommand(TabRpcClient, { tab: row.id, model: "sonnet" });
            pushToast({
                title: switchToastText(row.name, rtn.midturn, MODEL_SWITCH_APPLIES_MIDTURN),
                message: "Its model label changes with its next status.",
                level: "info",
            });
        } catch (e) {
            pushToast({ title: `Couldn't switch ${row.name} to Sonnet`, message: String(e), level: "error" });
        }
    });
}

const ROW_ACTION =
    "cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";

function Row({ row, model }: { row: ConsumerRow; model: AgentsViewModel }) {
    // the call in flight; a sleep or a wake takes seconds, and a second press would only be refused by the server
    const [pending, setPending] = useState<"sleep" | "wake" | null>(null);
    const run = (kind: "sleep" | "wake", call: () => Promise<void>) => {
        setPending(kind);
        fireAndForget(async () => {
            try {
                await call();
            } finally {
                setPending(null);
            }
        });
    };
    const wake = () =>
        run("wake", async () => {
            try {
                await wakeAgent(row.id);
            } catch (e) {
                wakeErrorToast(row.name, e);
            }
        });
    return (
        <div data-consumer-row={row.id} className="flex items-center gap-2 px-3 py-[5px] hover:bg-surface-hover">
            {row.sleeping ? (
                // 10px against the dot's 7px: the margins keep the name where the dot's rows have it
                <Moon data-consumer-moon size={10} className="-mx-[1.5px] flex-none text-muted" aria-label="sleeping" />
            ) : (
                <span
                    className={cn("h-[7px] w-[7px] flex-none rounded-full", STATE_DOT[row.state])}
                    aria-label={row.state}
                />
            )}
            <button
                type="button"
                data-consumer-open
                title={`Open ${row.name}`}
                onClick={() => {
                    close();
                    fireAndForget(() => openTarget(model, { kind: "agent", tabId: row.id }));
                }}
                className="min-w-0 flex-1 cursor-pointer truncate text-left text-[12.5px] text-primary"
            >
                {row.name}
                {row.project ? <span className="ml-1.5 text-[11px] text-muted">{row.project}</span> : null}
            </button>
            {row.model ? (
                <span
                    data-consumer-opus={row.opus ? "" : undefined}
                    title={row.opus ? "Runs on Opus" : undefined}
                    className={cn("text-[11px] font-semibold", row.opus ? "text-warning" : "text-muted")}
                >
                    {row.model}
                </span>
            ) : null}
            <span data-consumer-ram title="RAM" className="w-[64px] text-right text-[12px] tabular-nums text-secondary">
                {row.ramBytes === undefined ? "—" : ramLabel(row.ramBytes)}
            </span>
            <span
                data-consumer-tokens
                title="Tokens and estimated spend, last 10 minutes"
                className="flex w-[112px] items-center justify-end gap-1 text-[12px] tabular-nums text-secondary"
            >
                {row.burn ? (
                    <TriangleAlert
                        data-consumer-burn
                        size={12}
                        className="text-warning"
                        aria-label="Spending fastest"
                    />
                ) : null}
                {row.tokens === undefined ? "—" : `${fmt(row.tokens)} · ${usd(row.spendUsd ?? 0)}`}
            </span>
            {row.canSonnet ? (
                <button
                    type="button"
                    data-consumer-sonnet
                    title="Switch this session to Sonnet (/model sonnet)"
                    onClick={() => toSonnet(row)}
                    className={ROW_ACTION}
                >
                    → Sonnet
                </button>
            ) : null}
            {row.canSleep ? (
                <button
                    type="button"
                    data-consumer-sleep
                    title="End this agent's process to free its RAM; Wake or a message resumes it"
                    disabled={pending != null}
                    onClick={() => run("sleep", () => sleepWithConfirm(row.vm))}
                    className={ROW_ACTION}
                >
                    Sleep
                </button>
            ) : null}
            {row.sleeping ? (
                <button
                    type="button"
                    data-consumer-wake
                    title="Relaunch this agent where its conversation left off"
                    disabled={pending != null}
                    onClick={wake}
                    className={ROW_ACTION}
                >
                    {pending === "wake" ? "Waking…" : "Wake"}
                </button>
            ) : null}
            <button
                type="button"
                data-consumer-stop
                title={row.dag ? "Stop this worker; its task is not retried" : "End this agent's session"}
                onClick={() => stop(row, model)}
                className="cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-error hover:border-edge-strong hover:bg-surface-hover"
            >
                Stop
            </button>
        </div>
    );
}

// measured from the opener while open, and again when the window resizes, which moves the opener
export function usePanelPlacement(open: boolean, opener: Element | null) {
    const [, setSize] = useState(0);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onResize = () => setSize((n) => n + 1);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [open]);
    const rect = opener?.isConnected ? opener.getBoundingClientRect() : null;
    return panelPlacement(rect, { width: window.innerWidth, height: window.innerHeight });
}

export function ConsumersPanel({ model }: { model: AgentsViewModel }) {
    const sort = useAtomValue(consumersOpenAtom);
    const open = sort != null;
    const reading = useAtomValue(consumersReadingAtom);
    const agents = useAtomValue(model.agentsAtom);
    const fiveHour = usePlanDonuts(model).find((d) => d.provider === "claude")?.fivehour.pct;
    const placement = usePanelPlacement(open, useAtomValue(consumersOpenerAtom));
    useConsumersPoll(open);
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
    // the order the panel first drew, held while it is open so a new reading never moves a row
    const heldOrder = useRef<string[] | null>(null);
    if (!open) {
        heldOrder.current = null;
    }
    let view = reading.data != null && sort != null ? buildConsumers(reading.data, agents, sort) : null;
    if (view != null) {
        const held = holdOrder(view, heldOrder.current);
        view = held.view;
        heldOrder.current = held.order;
    }
    return (
        <>
            {open ? <div data-consumers-backdrop className="fixed inset-0 z-50" onClick={close} /> : null}
            <PopoverReveal
                open={open}
                origin={placement.origin}
                // it hangs from the control that opened it (the RAM chip, the usage meters), wherever that sits
                style={{ right: placement.right, top: placement.top, bottom: placement.bottom, width: PANEL_WIDTH }}
                className="fixed z-[60] overflow-hidden rounded-lg border border-edge-strong bg-surface-raised shadow-popover"
            >
                <div data-consumers-panel data-sort={sort ?? ""} role="dialog" aria-label="Consumers">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                        <span data-consumers-header className="flex-1 text-[12px] text-secondary">
                            {view ? `${formatGB(view.freeBytes)} free of ${formatGB(view.totalBytes)}` : "Reading…"}
                            {fiveHour != null ? ` · 5h quota ${Math.round(fiveHour)}%` : ""}
                        </span>
                    </div>
                    {reading.failed ? (
                        <div data-consumers-stale className="px-3 py-1.5 text-[11.5px] text-warning">
                            {staleLine(reading.lastOkMs)}
                        </div>
                    ) : null}
                    <div
                        data-consumers-list
                        className={cn("max-h-[56vh] overflow-y-auto py-1", reading.failed && "opacity-60")}
                    >
                        {view == null ? (
                            <div data-consumers-loading className="flex flex-col gap-2 px-3 py-2">
                                <SkeletonLine className="w-3/4" />
                                <SkeletonLine className="w-2/3" />
                            </div>
                        ) : view.groups.length === 0 ? (
                            <div data-consumers-empty className="px-3 py-2 text-[12px] text-muted">
                                No agents running.
                            </div>
                        ) : (
                            view.groups.map((g) => (
                                <div key={g.key}>
                                    {g.label ? (
                                        <div className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                                            {g.label}
                                        </div>
                                    ) : null}
                                    {g.rows.map((r) => (
                                        <Row key={r.id} row={r} model={model} />
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                    <div className="border-t border-border px-3 py-1.5">
                        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">arcterm</div>
                        {(view?.own ?? []).map((o) => (
                            <div
                                key={o.label}
                                data-consumers-own={o.label}
                                className="flex items-center justify-between py-[2px] text-[12px] text-secondary"
                            >
                                <span>{o.label}</span>
                                <span className="tabular-nums">{o.bytes === undefined ? "—" : ramLabel(o.bytes)}</span>
                            </div>
                        ))}
                        <div
                            data-consumers-agents
                            className="flex items-center justify-between py-[2px] text-[12px] text-secondary"
                        >
                            <span>Agents</span>
                            <span className="tabular-nums">
                                {view?.agentsBytes === undefined ? "—" : ramLabel(view.agentsBytes)}
                            </span>
                        </div>
                        <div
                            data-consumers-app-total
                            title="Everything arcterm runs: the rows above"
                            className="mt-[3px] flex items-center justify-between border-t border-border pt-[4px] text-[12px] font-semibold text-primary"
                        >
                            <span>Total, with agents</span>
                            <span className="tabular-nums">
                                {view?.appBytes === undefined ? "—" : ramLabel(view.appBytes)}
                            </span>
                        </div>
                    </div>
                    <div className="flex justify-end border-t border-border px-3 py-1.5">
                        <button
                            type="button"
                            data-consumers-open-usage
                            onClick={() => {
                                close();
                                globalStore.set(model.surfaceAtom, "usage");
                            }}
                            className="cursor-pointer text-[11.5px] text-accent hover:underline"
                        >
                            Open Usage
                        </button>
                    </div>
                </div>
            </PopoverReveal>
        </>
    );
}
