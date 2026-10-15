// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Consumers panel (spec 2026-10-08-consumers-panel-design.md): every live agent with its RAM and its tokens and
// spend of the last 10 minutes, a run's workers under their run, and Stop / → Sonnet per row; free RAM and the 5-hour
// quota in the header, arcterm's own processes below. Opened from the RAM chip (ranked by RAM) and the plan-usage
// meters (ranked by tokens). Where the Resource Manager runs (Windows) it is the compact panel instead: a one-line
// header with Arc's CPU, and per agent its CPU, RAM, spend and the heaviest command it runs, every action (kill that
// command, → Sonnet, Sleep, Stop) in one ⋯ menu; model and tokens move to the row's tooltip. Rows are ranked when it
// opens and keep their place while it is open. consumers.ts decides; this draws.

import { pushToast } from "@/app/cockpit/notificationstore";
import { busyWords, fmtCpu, fmtMem } from "@/app/cockpit/resmon";
import {
    clearResMonNote,
    killAgentCommand,
    pollResMon,
    resmonNotesAtom,
    resmonSnapshotAtom,
    resmonSupportedAtom,
} from "@/app/cockpit/resmonstore";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { SkeletonLine } from "@/app/element/skeleton";
import { DialogButton } from "@/app/modals/dialogbutton";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openTarget } from "@/app/view/jarvis/openref";
import { officeClocks, officeDomNodes, officeMeter, officeMeterAtom } from "@/app/view/office/officeclock";
import { spriteCacheStats } from "@/app/view/office/spritecache";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ArrowRight, CircleAlert, Ellipsis, Moon, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { closeSessions, confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import { sleepWithConfirm, wakeAgent, wakeErrorToast } from "./agentsleep";
import { toggleInSet } from "./cockpitsurfacemodel";
import {
    buildConsumers,
    canPick,
    closePickedConfirm,
    closePickedLabel,
    COMPACT_WIDTH,
    holdOrder,
    PANEL_WIDTH,
    panelPlacement,
    pickedRows,
    pickState,
    ramBar,
    ramLabel,
    SLEEPING_GROUP,
    sleepingByProject,
    staleLine,
    STATE_DOT,
    stopWorkerMessage,
    switchToastText,
    togglePickAll,
    withSwapBytes,
    type ConsumerRow,
    type ConsumersView,
} from "./consumers";
import { consumersOpenAtom, consumersOpenerAtom, consumersReadingAtom, useConsumersPoll } from "./consumersstore";
import { officeAnimation, officeAnimationAtom } from "./officestore";
import { TickBox } from "./tickbox";
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

// the columns after the name, shared by the header row and every agent row so they line up down the panel
const COL_MODEL = "w-[60px] flex-none";
const COL_RAM = "w-[54px] flex-none text-right";
const COL_TOKENS = "w-[46px] flex-none text-right";
const COL_SPEND = "w-[46px] flex-none text-right";
// room for → Sonnet, Sleep and Stop side by side, so a row's numbers never move when its actions show
const COL_ACTIONS = "w-[104px] flex-none";

const ICON_ACTION =
    "flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-selected hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50";
const TEXT_ACTION =
    "flex h-[22px] flex-none cursor-pointer items-center gap-0.5 whitespace-nowrap rounded border border-edge-mid px-1.5 text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-selected hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50";

// the rows ticked to close together, and whether any is: once one is, every row that can be ticked shows its tick
interface Picking {
    picked: ReadonlySet<string>;
    any: boolean;
    toggle: (id: string) => void;
}

// as wide as a tick, so a row's name stays put when its state turns into one
const SLOT = "flex h-[14px] w-[14px] flex-none items-center justify-center";

// a row's head: its state, a dot or (asleep) the moon, which turns into its tick on hover. A run's lead and worker keep
// the dot alone (canPick: they close with their run)
function PickSlot({ row, pick }: { row: ConsumerRow; pick: Picking }) {
    const mark = row.sleeping ? (
        <Moon data-consumer-moon size={10} className="flex-none text-muted" aria-label="sleeping" />
    ) : (
        <span className={cn("h-[7px] w-[7px] flex-none rounded-full", STATE_DOT[row.state])} aria-label={row.state} />
    );
    if (!canPick(row)) {
        return <span className={SLOT}>{mark}</span>;
    }
    return (
        <span className={SLOT}>
            <span className={cn(pick.any ? "hidden" : "flex group-focus-within:hidden group-hover:hidden")}>
                {mark}
            </span>
            <span className={cn(pick.any ? "flex" : "hidden group-focus-within:flex group-hover:flex")}>
                <TickBox
                    state={pick.picked.has(row.id) ? "all" : "none"}
                    label={`Select ${row.name}`}
                    title="Select to close with others"
                    onToggle={() => pick.toggle(row.id)}
                    attrs={{ "data-consumer-pick": row.id }}
                />
            </span>
        </span>
    );
}

function Row({
    row,
    model,
    pick,
    underProject,
}: {
    row: ConsumerRow;
    model: AgentsViewModel;
    pick: Picking;
    underProject?: boolean; // under its project's head in Sleeping, which names the project already
}) {
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
        <div
            data-consumer-row={row.id}
            className="group mx-1 flex h-[30px] items-center gap-2.5 rounded-md px-2 hover:bg-surface-hover"
        >
            <PickSlot row={row} pick={pick} />
            <button
                type="button"
                data-consumer-open
                title={row.project ? `Open ${row.name} (${row.project})` : `Open ${row.name}`}
                onClick={() => {
                    close();
                    fireAndForget(() => openTarget(model, { kind: "agent", tabId: row.id }));
                }}
                className={cn(
                    "min-w-0 flex-1 cursor-pointer truncate text-left text-[12.5px] hover:underline",
                    row.sleeping ? "text-muted" : "text-primary"
                )}
            >
                {row.name}
                {row.project && !underProject ? (
                    <span className="ml-1.5 text-[11px] text-ink-faint">{row.project}</span>
                ) : null}
            </button>
            <span
                data-consumer-opus={row.opus ? "" : undefined}
                title={row.opus ? "Runs on Opus" : undefined}
                className={cn(COL_MODEL, "truncate text-[11px]", row.opus ? "text-warning" : "text-muted")}
            >
                {row.model}
            </span>
            <span data-consumer-ram title="RAM" className={cn(COL_RAM, "text-[12px] tabular-nums text-secondary")}>
                {row.ramBytes === undefined ? "—" : ramLabel(row.ramBytes)}
            </span>
            {/* one element for both numbers, split into the two columns */}
            <span data-consumer-tokens className="flex flex-none items-center gap-2.5 text-[12px] tabular-nums">
                <span title="Tokens, last 10 minutes" className={cn(COL_TOKENS, "text-secondary")}>
                    {row.burn ? (
                        <TriangleAlert
                            data-consumer-burn
                            size={11}
                            className="mr-1 inline align-[-1px] text-warning"
                            aria-label="Spending fastest"
                        />
                    ) : null}
                    {row.tokens === undefined ? "—" : fmt(row.tokens)}
                </span>
                <span
                    title="Estimated spend, last 10 minutes"
                    className={cn(COL_SPEND, row.spendUsd ? "text-secondary" : "text-ink-faint")}
                >
                    {row.tokens === undefined ? "—" : usd(row.spendUsd ?? 0)}
                </span>
            </span>
            {/* shown on hover or keyboard focus, so a panel of ten agents is not thirty buttons; Wake stays, the one
                thing to do with a sleeping agent */}
            <span className={cn(COL_ACTIONS, "flex items-center justify-end gap-0.5")}>
                <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100">
                    {row.canSonnet ? (
                        <button
                            type="button"
                            data-consumer-sonnet
                            title="Switch this session to Sonnet (/model sonnet)"
                            onClick={() => toSonnet(row)}
                            className={cn(TEXT_ACTION, "mr-0.5")}
                        >
                            <ArrowRight size={11} aria-hidden />
                            Sonnet
                        </button>
                    ) : null}
                    {row.canSleep ? (
                        <button
                            type="button"
                            data-consumer-sleep
                            title="Sleep: end this agent's process to free its RAM; Wake or a message resumes it"
                            aria-label="Sleep"
                            disabled={pending != null}
                            onClick={() => run("sleep", () => sleepWithConfirm(row.vm))}
                            className={ICON_ACTION}
                        >
                            <Moon size={13} />
                        </button>
                    ) : null}
                </span>
                {row.sleeping ? (
                    <button
                        type="button"
                        data-consumer-wake
                        title="Relaunch this agent where its conversation left off"
                        disabled={pending != null}
                        onClick={wake}
                        className={cn(TEXT_ACTION, "mr-0.5")}
                    >
                        {pending === "wake" ? "Waking…" : "Wake"}
                    </button>
                ) : null}
                <button
                    type="button"
                    data-consumer-stop
                    title={row.dag ? "Stop this worker; its task is not retried" : "Stop: end this agent's session"}
                    aria-label="Stop"
                    onClick={() => stop(row, model)}
                    className={cn(
                        ICON_ACTION,
                        "opacity-0 transition-opacity duration-100 hover:text-error group-focus-within:opacity-100 group-hover:opacity-100"
                    )}
                >
                    <Square size={10} className="fill-current" />
                </button>
            </span>
        </div>
    );
}

const SECTION_LABEL = "text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint";

function ColumnHeads() {
    return (
        <div aria-hidden className={cn(SECTION_LABEL, "mx-1 flex items-center gap-2.5 px-2 pb-1 pt-1.5")}>
            <span className="w-[14px] flex-none" />
            <span className="min-w-0 flex-1">Agent</span>
            <span className={COL_MODEL}>Model</span>
            <span className={COL_RAM}>RAM</span>
            <span className="flex flex-none gap-2.5" title="Last 10 minutes">
                <span className={COL_TOKENS}>Tokens</span>
                <span className={COL_SPEND}>Spend</span>
            </span>
            <span className={COL_ACTIONS} />
        </div>
    );
}

// free RAM and the swap in use in words, and a bar of all RAM: what arcterm with its agents holds in it, everything
// else in use, and free
function MemoryHeader({
    view,
    fiveHour,
    onOpenUsage,
}: {
    view: ConsumersView | null;
    fiveHour?: number;
    onOpenUsage: () => void;
}) {
    const bar = view ? ramBar(view) : null;
    const withSwap = view ? withSwapBytes(view) : undefined;
    return (
        <div className="flex flex-col gap-1.5 border-b border-border px-3 pb-2.5 pt-2">
            <div className="flex items-baseline gap-3">
                <div data-consumers-header className="flex flex-1 items-baseline gap-3">
                    <span className="flex-1 text-[12px] text-muted">
                        {view ? (
                            <>
                                <span className="text-[13px] font-semibold text-primary">
                                    {formatGB(view.freeBytes)}
                                </span>
                                {` free of ${formatGB(view.totalBytes)}`}
                                {view.swapBytes > 0 ? (
                                    <span
                                        data-consumers-swap
                                        title="Swapped out to disk, every app's: macOS adds swap as RAM runs short"
                                    >
                                        {` · ${ramLabel(view.swapBytes)} swap`}
                                    </span>
                                ) : null}
                            </>
                        ) : (
                            "Reading…"
                        )}
                    </span>
                    {fiveHour != null ? (
                        <span className="text-[11.5px] text-muted" title="Claude's 5-hour plan window used">
                            5h quota <span className="tabular-nums text-secondary">{`${Math.round(fiveHour)}%`}</span>
                        </span>
                    ) : null}
                </div>
                <button
                    type="button"
                    data-consumers-open-usage
                    onClick={onOpenUsage}
                    className="flex cursor-pointer items-center gap-0.5 text-[11.5px] text-accent hover:underline"
                >
                    Open Usage
                    <ArrowRight size={11} aria-hidden />
                </button>
            </div>
            <div className="flex h-[5px] overflow-hidden rounded-full bg-surface">
                {bar ? (
                    <>
                        <span className="h-full bg-accent" style={{ width: `${bar.appPct}%` }} />
                        <span className="h-full bg-ink-faint" style={{ width: `${bar.otherPct}%` }} />
                    </>
                ) : null}
            </div>
            {bar && view ? (
                <div className="flex items-center gap-3 text-[10.5px] text-muted">
                    <span
                        data-consumers-in-ram
                        className="flex items-center gap-1"
                        title={
                            withSwap === undefined
                                ? "What arcterm and its agents hold in RAM now"
                                : `What arcterm and its agents hold in RAM now. With what macOS compressed or swapped out of them, ${ramLabel(withSwap)}: the figure Activity Monitor adds up`
                        }
                    >
                        <span className="h-[6px] w-[6px] rounded-full bg-accent" />
                        arcterm {view.inRamBytes === undefined ? "—" : ramLabel(view.inRamBytes)}
                        {withSwap === undefined ? null : ` in RAM · ${ramLabel(withSwap)} with swap`}
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="h-[6px] w-[6px] rounded-full bg-ink-faint" />
                        other apps {ramLabel(bar.otherBytes)}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

function Stat({ label, bytes, ...rest }: { label: string; bytes?: number } & Record<`data-${string}`, string>) {
    return (
        <div {...rest} className="flex min-w-0 flex-col">
            <span className="text-[10.5px] text-ink-faint">{label}</span>
            <span className="text-[12px] tabular-nums text-secondary">
                {bytes === undefined ? "—" : ramLabel(bytes)}
            </span>
        </div>
    );
}

// The office's own cost while the Cockpit shows Office (cockpit office spec, "Its cost in the RAM panel"): its JS
// time, the people it draws, its sprite images and its DOM nodes, read once a second while the panel is open. No
// heap figure: WKWebView has no performance.memory, and Interface above already holds the whole webview.
const OFFICE_JS_TIP =
    "The office's own JavaScript per second, as a share of one core. It leaves out the browser's layout and paint: for the whole webview, watch Interface where the panel reads its CPU, or arcterm's WebKit process in Activity Monitor with the animation on, then off.";

function officeCost() {
    const s = spriteCacheStats("plan");
    const c = officeClocks();
    return {
        js: officeMeter.share(Date.now()),
        entries: s.entries,
        kb: Math.round(s.bytes / 1024),
        nodes: officeDomNodes(),
        running: c.frame || c.walk,
    };
}

function Figure({ label, value, title }: { label: string; value: string; title?: string }) {
    return (
        <div title={title} className="flex min-w-0 flex-col">
            <span className="text-[10.5px] text-ink-faint">{label}</span>
            <span className="text-[12px] tabular-nums text-secondary">{value}</span>
        </div>
    );
}

function OfficeLine() {
    const counts = useAtomValue(officeMeterAtom);
    const [raw, setAnim] = useAtom(officeAnimationAtom);
    const on = officeAnimation(raw);
    const [cost, setCost] = useState(officeCost);
    const mounted = counts != null;
    useEffect(() => {
        if (!mounted) {
            return;
        }
        setCost(officeCost());
        const id = window.setInterval(() => setCost(officeCost()), 1000);
        return () => window.clearInterval(id);
    }, [mounted]);
    if (counts == null) {
        return null;
    }
    const state = !on
        ? "animation off · everyone holds still"
        : cost.running
          ? `animating · ${counts.walking} walking · ${counts.animated} at work`
          : "still · nothing moves";
    return (
        <div data-consumers-office className="flex flex-col gap-1.5 border-t border-border pt-2">
            <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-ink-faint">Office</span>
                <span className={cn("size-1.5 rounded-full", on && cost.running ? "bg-working" : "bg-edge-strong")} />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-secondary">{state}</span>
                <button type="button" data-consumers-office-toggle onClick={() => setAnim(!on)} className={TEXT_ACTION}>
                    {on ? "Turn animation off" : "Turn animation on"}
                </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
                <Figure label="Office JS" value={`${cost.js} %`} title={OFFICE_JS_TIP} />
                <Figure label="People" value={String(counts.people)} />
                <Figure label="Images" value={`${cost.entries} · ${cost.kb} KB`} />
                <Figure label="DOM nodes" value={cost.nodes.toLocaleString()} />
            </div>
        </div>
    );
}

const COL_CPU = "w-[40px] flex-none text-right";

function askKill(row: ConsumerRow): void {
    const cmd = row.work?.command;
    if (cmd == null) {
        return;
    }
    modalsModel.pushModal("ConfirmModal", {
        title: "Kill command",
        message: `Kill ${cmd.label} and what it started? ${row.name} keeps running.`,
        confirmLabel: "Kill",
        destructive: true,
        onConfirm: () => {
            clearResMonNote(row.id);
            fireAndForget(() => killAgentCommand(row.id, cmd));
        },
    });
}

function rowMenu(row: ConsumerRow, model: AgentsViewModel): ContextMenuItem[] {
    const cmd = row.work?.command;
    const items: ContextMenuItem[] = [];
    if (cmd != null) {
        items.push({ label: `Kill ${cmd.label}`, danger: true, click: () => askKill(row) });
    }
    if (row.canSonnet) {
        items.push({ label: "Switch to Sonnet", click: () => toSonnet(row) });
    }
    if (row.canSleep) {
        items.push({ label: "Sleep", click: () => fireAndForget(() => sleepWithConfirm(row.vm)) });
    }
    if (items.length > 0) {
        items.push({ type: "separator" });
    }
    items.push({ label: row.dag ? "Stop worker" : "Stop agent", danger: true, click: () => stop(row, model) });
    return items;
}

// the name in full (the row truncates it), the model and tokens the compact row leaves out, and the command in full
function compactTitle(row: ConsumerRow): string {
    const parts = [row.name, row.model, row.tokens === undefined ? null : `${fmt(row.tokens)} tokens in 10 min`];
    const cmd = row.work?.command;
    if (cmd != null) {
        parts.push(`running ${cmd.label} (${fmtMem(cmd.mem)})`);
    }
    return parts.filter(Boolean).join(" · ");
}

function CompactRow({
    row,
    model,
    ready,
    pick,
}: {
    row: ConsumerRow;
    model: AgentsViewModel;
    ready: boolean;
    pick: Picking;
}) {
    const note = useAtomValue(resmonNotesAtom)[row.id];
    const [waking, setWaking] = useState(false);
    const cmd = row.work?.command;
    const wake = () => {
        setWaking(true);
        fireAndForget(async () => {
            try {
                await wakeAgent(row.id);
            } catch (e) {
                wakeErrorToast(row.name, e);
            } finally {
                setWaking(false);
            }
        });
    };
    return (
        <div>
            <div
                data-consumer-row={row.id}
                title={compactTitle(row)}
                className="group mx-1 flex h-[30px] items-center gap-2.5 rounded-md px-2 hover:bg-surface-hover"
            >
                <PickSlot row={row} pick={pick} />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <button
                        type="button"
                        data-consumer-open
                        onClick={() => {
                            close();
                            fireAndForget(() => openTarget(model, { kind: "agent", tabId: row.id }));
                        }}
                        className={cn(
                            "min-w-0 cursor-pointer truncate text-left text-[12.5px] hover:underline",
                            row.sleeping ? "text-muted" : "text-primary"
                        )}
                    >
                        {row.name}
                    </button>
                    {cmd != null ? (
                        <span
                            data-consumer-command
                            className="min-w-0 shrink-[999] truncate font-mono text-[11px] text-muted"
                        >
                            {cmd.label}
                        </span>
                    ) : null}
                </span>
                <span data-consumer-cpu className={cn(COL_CPU, "text-[12px] tabular-nums text-secondary")}>
                    {row.work == null || !ready ? "–" : fmtCpu(row.work.cpu)}
                </span>
                <span data-consumer-ram className={cn(COL_RAM, "text-[12px] tabular-nums text-secondary")}>
                    {row.ramBytes === undefined ? "–" : ramLabel(row.ramBytes)}
                </span>
                <span
                    data-consumer-tokens
                    title="Estimated spend, last 10 minutes"
                    className={cn(
                        COL_SPEND,
                        "whitespace-nowrap text-[12px] tabular-nums",
                        row.spendUsd ? "text-secondary" : "text-ink-faint"
                    )}
                >
                    {row.burn ? (
                        <TriangleAlert
                            data-consumer-burn
                            size={11}
                            className="mr-1 inline align-[-1px] text-warning"
                            aria-label="Spending fastest"
                        />
                    ) : null}
                    {row.tokens === undefined ? "—" : usd(row.spendUsd ?? 0)}
                </span>
                <span className="flex w-[52px] flex-none items-center justify-end">
                    {row.sleeping ? (
                        <button
                            type="button"
                            data-consumer-wake
                            title="Relaunch this agent where its conversation left off"
                            disabled={waking}
                            onClick={wake}
                            className={TEXT_ACTION}
                        >
                            {waking ? "Waking…" : "Wake"}
                        </button>
                    ) : (
                        <button
                            type="button"
                            data-consumer-menu
                            aria-label={`Actions for ${row.name}`}
                            aria-haspopup="menu"
                            onClick={(e) => {
                                // under the button, not at the pointer: Enter or Space on it has no pointer position
                                const r = e.currentTarget.getBoundingClientRect();
                                ContextMenuModel.getInstance().showContextMenu(rowMenu(row, model), {
                                    preventDefault: () => e.preventDefault(),
                                    stopPropagation: () => e.stopPropagation(),
                                    clientX: r.left,
                                    clientY: r.bottom + 2,
                                } as React.MouseEvent);
                            }}
                            className={ICON_ACTION}
                        >
                            <Ellipsis size={14} />
                        </button>
                    )}
                </span>
            </div>
            {note ? (
                <div
                    data-consumer-note
                    role={note.tone === "alert" ? "alert" : "status"}
                    className={cn(
                        "mb-1 ml-[38px] mr-3 flex items-center gap-1.5 text-[11.5px]",
                        note.tone === "alert" ? "text-error-soft" : "text-muted"
                    )}
                >
                    {note.tone === "alert" ? (
                        <CircleAlert size={12} className="flex-none text-error" aria-hidden />
                    ) : null}
                    {note.text}
                </div>
            ) : null}
        </div>
    );
}

function CompactHeads() {
    return (
        <div aria-hidden className="mx-1 flex items-center gap-2.5 px-2 pb-1 pt-1.5 text-[11px] text-ink-faint">
            <span className="w-[14px] flex-none" />
            <span className="min-w-0 flex-1">Agent</span>
            <span className={COL_CPU}>CPU</span>
            <span className={COL_RAM}>RAM</span>
            <span className={COL_SPEND} title="Estimated spend, last 10 minutes">
                10 min
            </span>
            <span className="w-[52px] flex-none" />
        </div>
    );
}

// one line: the free RAM (arcterm against other apps in its tooltip), Arc's CPU, the 5-hour quota, the way to Usage
function CompactHeader({
    view,
    snap,
    fiveHour,
    onOpenUsage,
}: {
    view: ConsumersView | null;
    snap: ResMonSnapshotData | null;
    fiveHour?: number;
    onOpenUsage: () => void;
}) {
    const bar = view ? ramBar(view) : null;
    const busy = snap?.ready ? busyWords(snap) : null;
    return (
        <div className="flex items-baseline gap-3.5 border-b border-border px-3 py-2.5 text-[12px] text-muted">
            <span
                data-consumers-header
                title={
                    view && bar
                        ? `other apps ${ramLabel(bar.otherBytes)} · ${formatGB(view.totalBytes)} in all${view.swapBytes > 0 ? ` · ${ramLabel(view.swapBytes)} swap` : ""}`
                        : undefined
                }
                className="flex-1"
            >
                {view ? (
                    <>
                        <span className="text-[13px] font-semibold text-primary">{formatGB(view.freeBytes)}</span> free
                    </>
                ) : (
                    "Reading…"
                )}
            </span>
            {/* what arcterm itself holds: its own processes and every agent, and their CPU as a share of all cores, as
                Task Manager counts it; the CPU joins once a second sample gives it */}
            <span
                data-consumers-arc
                title="What arcterm and its agents use: memory, and CPU as a share of all cores (as Task Manager counts it)"
                className={busy ? "text-warning-soft" : undefined}
            >
                arcterm{" "}
                <span className={cn("tabular-nums", busy ? "font-semibold text-warning" : "text-secondary")}>
                    {view?.appBytes === undefined ? "—" : ramLabel(view.appBytes)}
                </span>
                {snap?.ready ? (
                    <>
                        {" · "}
                        <span
                            data-consumers-cpu
                            className={cn("tabular-nums", busy ? "font-semibold text-warning" : "text-secondary")}
                        >
                            {fmtCpu(snap.cpu, 0)}
                        </span>{" "}
                        CPU
                    </>
                ) : null}
                {busy ? ` · ${busy}` : null}
            </span>
            {fiveHour != null ? (
                <span title="Claude's 5-hour plan window used">
                    5h <span className="tabular-nums text-secondary">{`${Math.round(fiveHour)}%`}</span>
                </span>
            ) : null}
            <button
                type="button"
                data-consumers-open-usage
                onClick={onOpenUsage}
                className="flex cursor-pointer items-center gap-0.5 text-[11.5px] text-accent hover:underline"
            >
                Usage
                <ArrowRight size={11} aria-hidden />
            </button>
        </div>
    );
}

// one line under the list: what the header's arcterm figure is made of, the agents and arcterm's own processes
function CompactOwn({ view }: { view: ConsumersView | null }) {
    if (view == null) {
        return null;
    }
    const parts = [{ label: "Agents", bytes: view.agentsBytes, agents: true }, ...view.own];
    return (
        <>
            <div
                title="What the arcterm figure above is made of: every agent, the webview that draws the cockpit (Interface), wavesrv (Server), the Tauri host, and the plain terminals"
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-border bg-surface px-3 py-1.5 text-[11.5px] text-muted"
            >
                {parts.map((p) => (
                    <span
                        key={p.label}
                        {...("agents" in p ? { "data-consumers-agents": "" } : { "data-consumers-own": p.label })}
                    >
                        {p.label}{" "}
                        <span className="tabular-nums text-secondary">
                            {p.bytes === undefined ? "—" : ramLabel(p.bytes)}
                        </span>
                    </span>
                ))}
            </div>
            <div className="px-3 pb-1.5">
                <OfficeLine />
            </div>
        </>
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

// a group's rows as the panel lays them out: Sleeping bunched under a head per project when its agents come from more
// than one; every other group, and Sleeping of one project, as one bunch with no head
function bunchesOf(g: { key: string; rows: ConsumerRow[] }): { project: string; head: boolean; rows: ConsumerRow[] }[] {
    const bunches = g.key === SLEEPING_GROUP ? sleepingByProject(g.rows) : [];
    if (bunches.length < 2) {
        return [{ project: "", head: false, rows: g.rows }];
    }
    return bunches.map((b) => ({ ...b, head: true }));
}

export function ConsumersPanel({ model }: { model: AgentsViewModel }) {
    const sort = useAtomValue(consumersOpenAtom);
    const open = sort != null;
    const reading = useAtomValue(consumersReadingAtom);
    const agents = useAtomValue(model.agentsAtom);
    const fiveHour = usePlanDonuts(model).find((d) => d.provider === "claude")?.fivehour.pct;
    const placement = usePanelPlacement(open, useAtomValue(consumersOpenerAtom));
    const compact = useAtomValue(resmonSupportedAtom);
    const snap = useAtomValue(resmonSnapshotAtom);
    useConsumersPoll(open);
    // read at once on open, past the hidden-document gate: the panel is in view; a kill's note lasts while it is open
    useEffect(() => {
        if (open) {
            void pollResMon(true);
        } else {
            globalStore.set(resmonNotesAtom, {});
        }
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
    // the order the panel first drew, held while it is open so a new reading never moves a row
    const heldOrder = useRef<string[] | null>(null);
    if (!open) {
        heldOrder.current = null;
    }
    // the rows ticked to close together, forgotten when the panel closes
    const [picked, setPicked] = useState<Set<string>>(() => new Set());
    useEffect(() => {
        if (!open) {
            setPicked(new Set());
        }
    }, [open]);
    const openUsage = () => {
        close();
        globalStore.set(model.surfaceAtom, "usage");
    };
    let view =
        reading.data != null && sort != null ? buildConsumers(reading.data, agents, sort, compact ? snap : null) : null;
    if (view != null) {
        const held = holdOrder(view, heldOrder.current);
        view = held.view;
        heldOrder.current = held.order;
    }
    const chosen = view != null ? pickedRows(view, picked) : [];
    const pick: Picking = {
        picked,
        any: chosen.length > 0,
        toggle: (id) => setPicked((p) => toggleInSet(p, id)),
    };
    // the ticked agents close at once when none of them is working; their conversations stay under Conversations
    const closePicked = () => {
        const rows = chosen;
        const closeNow = () => {
            closeSessions(rows.map((r) => r.vm));
            setPicked(new Set());
            pushToast({
                title: rows.length === 1 ? `Closed ${rows[0].name}` : `Closed ${rows.length} agents`,
                message: "",
                level: "info",
            });
        };
        const ask = closePickedConfirm(rows);
        if (ask == null) {
            closeNow();
            return;
        }
        modalsModel.pushModal("ConfirmModal", {
            title: "Close agents",
            message: ask,
            confirmLabel: closePickedLabel(rows),
            destructive: true,
            onConfirm: closeNow,
        });
    };
    return (
        <>
            {open ? <div data-consumers-backdrop className="fixed inset-0 z-50" onClick={close} /> : null}
            <PopoverReveal
                open={open}
                origin={placement.origin}
                // it hangs from the control that opened it (the app bar's usage button), wherever that sits
                style={{
                    right: placement.right,
                    top: placement.top,
                    bottom: placement.bottom,
                    width: compact ? COMPACT_WIDTH : PANEL_WIDTH,
                }}
                className="fixed z-[60] overflow-hidden rounded-lg border border-edge-strong bg-surface-raised shadow-popover"
            >
                <div data-consumers-panel data-sort={sort ?? ""} role="dialog" aria-label="Consumers">
                    {compact ? (
                        <CompactHeader view={view} snap={snap} fiveHour={fiveHour} onOpenUsage={openUsage} />
                    ) : (
                        <MemoryHeader view={view} fiveHour={fiveHour} onOpenUsage={openUsage} />
                    )}
                    {reading.failed ? (
                        <div data-consumers-stale className="px-3 py-1.5 text-[11.5px] text-warning">
                            {staleLine(reading.lastOkMs)}
                        </div>
                    ) : null}
                    <div
                        data-consumers-list
                        className={cn("max-h-[56vh] overflow-y-auto pb-1.5", reading.failed && "opacity-60")}
                    >
                        {view == null ? (
                            <div data-consumers-loading className="flex flex-col gap-2 px-3 py-2.5">
                                <SkeletonLine className="w-3/4" />
                                <SkeletonLine className="w-2/3" />
                            </div>
                        ) : view.groups.length === 0 ? (
                            <div data-consumers-empty className="px-3 py-3 text-[12px] text-muted">
                                No agents running.
                            </div>
                        ) : (
                            <>
                                {compact ? <CompactHeads /> : <ColumnHeads />}
                                {view.groups.map((g) => (
                                    <div key={g.key}>
                                        {g.key === SLEEPING_GROUP ? (
                                            // its tick, over the rows' ticks, picks every sleeping agent at once
                                            <div
                                                className={cn(
                                                    SECTION_LABEL,
                                                    "mx-1 mt-1.5 flex items-center gap-2.5 px-2 pb-0.5 pt-1"
                                                )}
                                            >
                                                <span className={SLOT}>
                                                    <TickBox
                                                        state={pickState(picked, g.rows)}
                                                        label="Select every sleeping agent"
                                                        title="Select every sleeping agent, to close them together"
                                                        onToggle={() => setPicked((p) => togglePickAll(p, g.rows))}
                                                        attrs={{ "data-consumers-pick-sleeping": "" }}
                                                    />
                                                </span>
                                                <span>{g.label}</span>
                                            </div>
                                        ) : g.label ? (
                                            <div className={cn(SECTION_LABEL, "mt-1.5 px-3 pb-0.5 pt-1")}>
                                                {g.label}
                                            </div>
                                        ) : null}
                                        {bunchesOf(g).map((b) => (
                                            <div
                                                key={b.project}
                                                data-consumers-sleeping-project={b.head ? b.project : undefined}
                                            >
                                                {b.head ? (
                                                    // sleeping agents of more than one project: a tick for each one's
                                                    <div className="mx-1 flex items-center gap-2.5 px-2 pb-0.5 pt-1">
                                                        <span className={SLOT}>
                                                            <TickBox
                                                                state={pickState(picked, b.rows)}
                                                                label={`Select every sleeping agent in ${b.project}`}
                                                                title={`Select every sleeping agent in ${b.project}, to close them together`}
                                                                onToggle={() =>
                                                                    setPicked((p) => togglePickAll(p, b.rows))
                                                                }
                                                                attrs={{ "data-consumers-pick-project": b.project }}
                                                            />
                                                        </span>
                                                        <span className="truncate text-[11.5px] font-medium text-secondary">
                                                            {b.project}
                                                        </span>
                                                    </div>
                                                ) : null}
                                                {b.rows.map((r) =>
                                                    compact ? (
                                                        <CompactRow
                                                            key={r.id}
                                                            row={r}
                                                            model={model}
                                                            ready={!!snap?.ready}
                                                            pick={pick}
                                                        />
                                                    ) : (
                                                        <Row
                                                            key={r.id}
                                                            row={r}
                                                            model={model}
                                                            pick={pick}
                                                            underProject={b.head}
                                                        />
                                                    )
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                    {chosen.length > 0 ? (
                        <div
                            data-consumers-pickbar
                            className="flex items-center gap-2 border-t border-border px-3 py-2"
                        >
                            <span className="flex-1 text-[12px] text-muted">
                                <span className="tabular-nums text-secondary">{chosen.length}</span> selected
                            </span>
                            <DialogButton
                                className="px-[10px] py-[5px] text-[12px]"
                                onClick={() => setPicked(new Set())}
                            >
                                Clear
                            </DialogButton>
                            <DialogButton
                                variant="danger"
                                data-consumers-close-picked
                                className="px-[10px] py-[5px] text-[12px]"
                                onClick={closePicked}
                            >
                                {closePickedLabel(chosen)}
                            </DialogButton>
                        </div>
                    ) : null}
                    {compact ? (
                        <CompactOwn view={view} />
                    ) : (
                        <div className="flex flex-col gap-1.5 border-t border-border bg-surface px-3 pb-2 pt-2">
                            <div className="flex items-center gap-2">
                                <span className={cn(SECTION_LABEL, "flex-1")}>arcterm</span>
                                <span
                                    className="text-[11.5px] text-muted"
                                    title="Everything arcterm runs: its own processes and every agent"
                                >
                                    Total, with agents{" "}
                                    <span
                                        data-consumers-app-total
                                        className="text-[12px] font-semibold tabular-nums text-primary"
                                    >
                                        {view?.appBytes === undefined ? "—" : ramLabel(view.appBytes)}
                                    </span>
                                </span>
                            </div>
                            <div className="grid grid-cols-5 gap-2">
                                <Stat data-consumers-agents="" label="Agents" bytes={view?.agentsBytes} />
                                {(view?.own ?? []).map((o) => (
                                    <Stat key={o.label} data-consumers-own={o.label} label={o.label} bytes={o.bytes} />
                                ))}
                            </div>
                            <OfficeLine />
                        </div>
                    )}
                </div>
            </PopoverReveal>
        </>
    );
}
