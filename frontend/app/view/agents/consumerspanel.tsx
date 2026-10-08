// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Consumers panel (spec 2026-10-08-consumers-panel-design.md): every live agent by RAM or by tokens of the last
// 10 minutes, a run's workers under their run, and Stop / → Sonnet per row. The RAM view shows each row's RAM, free
// RAM and arcterm's own processes; the Tokens view shows each row's tokens and spend and the 5-hour quota. Opened from
// the RAM chip (RAM) and the plan-usage meters (Tokens). Rows are ranked when it opens and keep their place while it
// is open. consumers.ts decides; this draws.

import { pushToast } from "@/app/cockpit/notificationstore";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { Segmented } from "@/app/element/segmented";
import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import {
    buildConsumers,
    holdOrder,
    ramLabel,
    staleLine,
    STATE_DOT,
    stopWorkerMessage,
    switchToastText,
    type ConsumerRow,
    type ConsumersSort,
} from "./consumers";
import { consumersOpenAtom, consumersReadingAtom, useConsumersPoll } from "./consumersstore";
import { usePlanDonuts } from "./usagemeters";
import { fmt, usd } from "./usagestats";
import { formatGB } from "./workercapacity";

// whether `/model` switches a Claude session inside a running turn: the consumers-panel plan's Task 1 could not check
// it (no tmux), so a mid-turn switch is worded as waiting for the next turn
const MODEL_SWITCH_APPLIES_MIDTURN = false;

// stopping a worker waits for it to exit
const STOP_TIMEOUT_MS = 60_000;

const SORTS: { key: ConsumersSort; label: string }[] = [
    { key: "ram", label: "RAM" },
    { key: "tokens", label: "Tokens" },
];

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

function Row({ row, model, sort }: { row: ConsumerRow; model: AgentsViewModel; sort: ConsumersSort }) {
    return (
        <div data-consumer-row={row.id} className="flex items-center gap-2 px-3 py-[5px] hover:bg-surface-hover">
            <span
                className={cn("h-[7px] w-[7px] flex-none rounded-full", STATE_DOT[row.state])}
                aria-label={row.state}
            />
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
            {sort === "ram" ? (
                <span data-consumer-ram className="w-[72px] text-right text-[12px] tabular-nums text-secondary">
                    {row.ramBytes === undefined ? "—" : ramLabel(row.ramBytes)}
                </span>
            ) : (
                <span
                    data-consumer-tokens
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
            )}
            {row.canSonnet ? (
                <button
                    type="button"
                    data-consumer-sonnet
                    title="Switch this session to Sonnet (/model sonnet)"
                    onClick={() => toSonnet(row)}
                    className="cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover"
                >
                    → Sonnet
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

export function ConsumersPanel({ model }: { model: AgentsViewModel }) {
    const sort = useAtomValue(consumersOpenAtom);
    const open = sort != null;
    const reading = useAtomValue(consumersReadingAtom);
    const agents = useAtomValue(model.agentsAtom);
    const fiveHour = usePlanDonuts(model).find((d) => d.provider === "claude")?.fivehour.pct;
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
    // the order the panel first drew, held while it is open so switching views or a new reading never moves a row
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
                origin="top right"
                className="absolute right-0 top-[calc(100%+7px)] z-[60] w-[520px] overflow-hidden rounded-lg border border-edge-strong bg-surface-raised shadow-popover"
            >
                <div data-consumers-panel data-sort={sort ?? ""} role="dialog" aria-label="Consumers">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                        <span data-consumers-header className="flex-1 text-[12px] text-secondary">
                            {sort === "tokens"
                                ? `Tokens, last 10 min${fiveHour != null ? ` · 5h quota ${Math.round(fiveHour)}%` : ""}`
                                : view
                                  ? `${formatGB(view.freeBytes)} free of ${formatGB(view.totalBytes)}`
                                  : "Reading…"}
                        </span>
                        <Segmented
                            value={sort ?? "ram"}
                            options={SORTS}
                            onChange={(v) => globalStore.set(consumersOpenAtom, v)}
                            ariaLabel="Sort by"
                        />
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
                                        <Row key={r.id} row={r} model={model} sort={sort ?? "ram"} />
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                    {sort !== "tokens" ? (
                        <div className="border-t border-border px-3 py-1.5">
                            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                                arcterm
                            </div>
                            {(view?.own ?? []).map((o) => (
                                <div
                                    key={o.label}
                                    data-consumers-own={o.label}
                                    className="flex items-center justify-between py-[2px] text-[12px] text-secondary"
                                >
                                    <span>{o.label}</span>
                                    <span className="tabular-nums">
                                        {o.bytes === undefined ? "—" : ramLabel(o.bytes)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
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
