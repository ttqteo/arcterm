// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The selected task's peek: what it is, who works on it, and what can be done to it, in the shell beside its
// node. The graph mounts it per task (key={task.id}), so its open panels never follow the selection.

import { Markdown } from "@/app/element/markdown";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { CircleAlert } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import type { AgentsViewModel } from "../agents/agents";
import { runAtom } from "../agents/channelsstore";
import { InlineMarkdown } from "../agents/inlinemarkdown";
import { RoutePicker } from "../agents/routepicker";
import { useRunUsage } from "../agents/runtokenstore";
import { modelsText, summarizeUsage, usageText } from "../agents/runusage";
import { ActivityLine, StatusLine } from "../agents/statusline";
import { META_TEXT } from "../jarvis/briefstyle";
import { glyphKind, wordOf } from "./dagcanvas";
import { descriptionLead } from "./dagdescription";
import type { TaskBrief } from "./dagdigest";
import { closeDagModal, dagModalAgentsContextAtom } from "./dagmodalstate";
import { wordTone } from "./dagnodes";
import { peekActions, taskPeek, type PeekAction } from "./dagpeek";
import {
    DagPeekCard,
    PEEK_BTN,
    PEEK_BTN_ACCENT,
    PEEK_BTN_ACCENT_OPEN,
    PEEK_BTN_PRIMARY,
    type PeekPlace,
} from "./dagpeekcard";
import { dagActionError, dagActionRoute, routeSourceLabel, type DagViewNode } from "./dagstore";
import { escalatePayload } from "./escalate";
import { TaskModelPick } from "./modelpicksview";
import { openTaskWorker, resolveTaskWorker, type TaskWorkerView } from "./taskcorrelate";

const HINT = "double-click opens its worker · Esc closes";

const DT = "text-[11px] leading-4 text-ink-mid";
const DD = "m-0 min-w-0 font-mono text-[11px] leading-4";
const DD_SUB = "truncate text-muted";

export function DagTaskPeek({
    group,
    owner,
    view,
    task,
    digestTask,
    briefs,
    place,
}: {
    group: TaskGroup;
    owner: Run;
    view: DagViewNode;
    task: TaskNode;
    digestTask: DagTaskDigest | undefined;
    briefs: Map<string, TaskBrief>;
    place: PeekPlace;
}) {
    const [escalating, setEscalating] = useState(false);
    const [escalateRoute, setEscalateRoute] = useState<RoutePin | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const agentsCtx = useAtomValue(dagModalAgentsContextAtom);
    const childRun = useAtomValue<Run | undefined>(
        (task.runid ? runAtom(task.runid) : NO_RUN_ATOM) as Atom<Run | undefined>
    );
    // the shared 1s ticker drives the Verify elapsed; without the roster context there is no ticker
    const tick = useAtomValue(agentsCtx?.model.nowAtom ?? NO_TICK_ATOM);
    const worker = resolveTaskWorker({ id: task.id, runid: task.runid }, childRun, agentsCtx?.agents ?? []);
    const peek = taskPeek(task, digestTask, briefs, tick || Date.now());

    // escalate opens the route picker; every other action is sent, and a refusal is shown on the card instead
    // of vanishing into an unhandled rejection
    const onAction = (a: PeekAction) => {
        if (a.picker) {
            setEscalating(!escalating);
            setEscalateRoute(null);
            return;
        }
        setActionError(null);
        runAction(group, view, a.action).catch((e) => setActionError(dagActionError(a.action, view.id, e)));
    };
    const onRequeue = () => {
        if (escalateRoute == null) return;
        setActionError(null);
        runEscalate(group, view, escalateRoute).catch((e) => setActionError(dagActionError("escalate", view.id, e)));
        setEscalating(false);
        setEscalateRoute(null);
    };

    return (
        <DagPeekCard
            place={place}
            attrs={{ "data-dag-task-peek": task.id }}
            label={`${task.id} details`}
            closeLabel="Close task details"
            glyph={glyphKind(task)}
            title={view.label}
            meta={
                <>
                    <span className="text-secondary">{task.id}</span>
                    <span>·</span>
                    <span className={wordTone(task)}>{wordOf(task)}</span>
                    {view.gate ? <span className="rounded-[5px] border border-edge-mid px-[5px]">gate</span> : null}
                    {view.meta ? (
                        <>
                            <span>·</span>
                            <span className="min-w-0 truncate">{view.meta}</span>
                        </>
                    ) : null}
                </>
            }
            panel={
                escalating ? (
                    <EscalatePanel
                        taskId={task.id}
                        route={escalateRoute}
                        onRoute={setEscalateRoute}
                        onCancel={() => {
                            setEscalating(false);
                            setEscalateRoute(null);
                        }}
                        onRequeue={onRequeue}
                    />
                ) : actionError ? (
                    <div
                        role="alert"
                        className="flex items-center gap-1.5 border-t border-border px-3 py-[7px] text-[11.5px] text-error"
                    >
                        <CircleAlert size={12} aria-hidden className="flex-none" />
                        {actionError}
                    </div>
                ) : undefined
            }
            actions={peekActions(view.actions).map((a) => (
                <button
                    key={a.action}
                    type="button"
                    data-dag-peek-action={a.action}
                    aria-expanded={a.picker ? escalating : undefined}
                    onClick={() => onAction(a)}
                    className={actionClass(a, escalating)}
                >
                    {a.label}
                </button>
            ))}
            hint={HINT}
        >
            {worker.agent && agentsCtx ? <ActivityLine agent={worker.agent} nowAtom={agentsCtx.model.nowAtom} /> : null}
            {peek.rows.length > 0 ? (
                <div className="flex flex-col gap-[3px]">
                    {peek.rows.map((row, i) => (
                        <div
                            key={i}
                            className={cn(
                                "font-mono text-[10.5px] leading-[14px]",
                                row.tone === "warning" ? "text-warning" : "text-muted"
                            )}
                        >
                            {row.text}
                        </div>
                    ))}
                </div>
            ) : null}
            {agentsCtx ? <WorkerSession worker={worker} model={agentsCtx.model} /> : null}
            <dl className="m-0 grid grid-cols-[54px_minmax(0,1fr)] gap-x-2.5 gap-y-2">
                <dt className={DT}>Worker</dt>
                <dd
                    className={DD}
                    data-dag-node-route={`${view.route.source}:${view.route.runtime}:${view.route.model}`}
                >
                    <div className="text-secondary">
                        {view.route.runtime} / {view.route.model || "default"}
                    </div>
                    <div className={DD_SUB}>
                        {routeSourceLabel(view.route.source)} · {view.route.resolvedModel}
                    </div>
                </dd>
                <dt className={DT}>Review</dt>
                <dd className={DD}>
                    <div className={reviewTone(view.review.state)}>{view.review.state}</div>
                    <div className={DD_SUB}>{view.review.route}</div>
                </dd>
                <TaskModelPick group={group} owner={owner} task={task} />
                <TokensRow group={group} taskId={task.id} />
            </dl>
            <Description text={task.description} />
            {peek.verify ? (
                <div data-dag-peek-verify={task.id} className="flex flex-col gap-1">
                    <div className={META_TEXT}>{peek.verify.heading}</div>
                    {peek.verify.tail ? (
                        <pre
                            className={cn(
                                "m-0 max-h-[110px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-edge-mid bg-surface-code px-2 py-1.5 font-mono text-[10.5px] leading-[14px]",
                                peek.verify.tone === "warning" ? "text-warning" : "text-secondary"
                            )}
                        >
                            {peek.verify.tail}
                        </pre>
                    ) : null}
                </div>
            ) : null}
        </DagPeekCard>
    );
}

function actionClass(a: PeekAction, escalating: boolean): string {
    if (a.primary) return PEEK_BTN_PRIMARY;
    if (a.picker) return escalating ? PEEK_BTN_ACCENT_OPEN : PEEK_BTN_ACCENT;
    return PEEK_BTN;
}

function reviewTone(state: string): string {
    if (state.startsWith("passed")) return "text-success";
    if (state === "failed") return "text-warning";
    return "text-secondary";
}

function TokensRow({ group, taskId }: { group: TaskGroup; taskId: string }) {
    const usage = useRunUsage(group.channelid, group.runid);
    const spent = summarizeUsage(usage?.rows, taskId);
    return (
        <>
            <dt className={DT}>Tokens</dt>
            <dd className={DD}>
                <div className={spent ? "text-secondary" : "text-muted"}>
                    {spent ? usageText(spent, usage.sealed) : "none yet"}
                </div>
                {spent ? <div className={DD_SUB}>{modelsText(spent)}</div> : null}
            </dd>
        </>
    );
}

// the lead is the card's summary; the full description is the plan's own Markdown, so its bullets and
// "Done when" line draw as written
function Description({ text }: { text: string | undefined }) {
    const [open, setOpen] = useState(false);
    const { lead, more } = descriptionLead(text);
    if (!lead && !more) return null;
    return (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
            {open ? (
                <Markdown text={text} scrollable={false} fontSizeOverride={12} />
            ) : (
                <div className="line-clamp-3 text-[12px] leading-[1.55] text-secondary">
                    <InlineMarkdown text={lead} plainLinks />
                </div>
            )}
            {more ? (
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    aria-expanded={open}
                    className="cursor-pointer self-start border-0 bg-transparent p-0 text-[11.5px] font-semibold text-accent-soft hover:text-accent"
                >
                    {open ? "Show less" : "Read the full description"}
                </button>
            ) : null}
        </div>
    );
}

function EscalatePanel({
    taskId,
    route,
    onRoute,
    onCancel,
    onRequeue,
}: {
    taskId: string;
    route: RoutePin | null;
    onRoute: (r: RoutePin | null) => void;
    onCancel: () => void;
    onRequeue: () => void;
}) {
    return (
        <div data-dag-peek-escalate className="flex flex-col gap-2 border-t border-accent/35 bg-accent/6 px-3 py-2.5">
            <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-ink-hi">Re-queue {taskId} on</span>
                <RoutePicker value={route} canInherit={false} onChange={onRoute} placement="top-start" />
            </div>
            <span className="text-[11px] text-ink-mid">One judged hop: a second failure blocks this task for you.</span>
            <div className="flex justify-end gap-1.5">
                <button type="button" onClick={onCancel} className={cn(PEEK_BTN, "font-normal")}>
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={route == null}
                    onClick={onRequeue}
                    className={cn(PEEK_BTN_PRIMARY, "disabled:cursor-not-allowed disabled:opacity-50")}
                >
                    Re-queue on model
                </button>
            </div>
        </div>
    );
}

const SESSION_BOX = "flex min-w-0 items-center gap-2 rounded-[8px] border border-edge-mid px-[9px] py-[7px]";
const SESSION_BTN = "flex-none cursor-pointer rounded-[6px] border px-2 py-[3px] font-mono text-[10.5px]";

// WorkerSession is the task's worker treatment: the shared status line when dispatched, with Open in Agent,
// and the explicit pending and worker-unavailable states. A double-click or Enter on the node opens the same
// place as the button.
function WorkerSession({ worker, model }: { worker: TaskWorkerView; model: AgentsViewModel }) {
    const open = (e: MouseEvent) => {
        e.stopPropagation();
        openFromGraph(worker, model);
    };
    if (worker.state === "pending") {
        return (
            <div className={cn(SESSION_BOX, "border-dashed font-mono text-[11px] text-ink-mid")}>
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-edge-strong" />
                Not dispatched yet
            </div>
        );
    }
    if (worker.state === "dispatched" && worker.agent) {
        return (
            <SessionBox>
                <StatusLine agent={worker.agent} nowAtom={model.nowAtom} className="min-w-0 flex-1" />
                <button
                    type="button"
                    onClick={open}
                    className={cn(SESSION_BTN, "border-accent/50 font-bold text-accent-soft hover:border-accent")}
                >
                    Open in Agent ↗
                </button>
            </SessionBox>
        );
    }
    return (
        <SessionBox>
            <span className="flex-1 font-mono text-[11px] text-ink-mid">Worker session unavailable</span>
            <button
                type="button"
                onClick={open}
                className={cn(SESSION_BTN, "border-edge-mid text-secondary hover:border-edge-strong")}
            >
                View child run
            </button>
        </SessionBox>
    );
}

function SessionBox({ children }: { children: ReactNode }) {
    return <div className={cn(SESSION_BOX, "bg-surface")}>{children}</div>;
}

// stable no-run atom for a task that has not been dispatched (runAtom is oref-cached, so per-run atoms keep
// identity across renders; a static Atom is needed for the no-run slot so the hook count never varies)
const NO_RUN_ATOM = atom<Run | undefined>(undefined);
const NO_TICK_ATOM = atom(0);

// runEscalate re-queues a failed/stalled task on the exact model the human picked; one judged hop.
function runEscalate(group: TaskGroup, view: DagViewNode, route: RoutePin) {
    return RpcApi.DagActionCommand(TabRpcClient, escalatePayload(group.channelid, group.runid, view.id, route));
}

// runAction dispatches the task's action to the dag commands; the resulting waveobj update re-derives the
// graph. "resolve" is merge --continue: it finishes a squash merge the human resolved in the project tree, or
// re-runs a failed Verify after their fix; the remaining actions go through the engine's dag action RPC.
// escalate is never sent from here: it opens the picker before this is called.
function runAction(group: TaskGroup, view: DagViewNode, action: string) {
    const data = { channelid: group.channelid, runid: group.runid, taskid: view.id, action };
    const mergeData = { channelid: group.channelid, runid: group.runid, taskid: view.id };
    switch (dagActionRoute(action)) {
        case "merge":
            return RpcApi.DagMergeCommand(TabRpcClient, mergeData);
        case "continue":
            return RpcApi.DagMergeContinueCommand(TabRpcClient, mergeData);
        default:
            return RpcApi.DagActionCommand(TabRpcClient, data);
    }
}

// openTaskFromGraph opens a task's worker from a double-click or Enter, to the same place the peek's button
// goes. It loads the child run first rather than reading its atom: only the selected task's run is
// subscribed, and an unloaded run would resolve a live worker as unavailable.
export async function openTaskFromGraph(task: TaskNode): Promise<void> {
    const childRun = task.runid ? await WOS.loadAndPinWaveObject<Run>(WOS.makeORef("run", task.runid)) : undefined;
    const ctx = globalStore.get(dagModalAgentsContextAtom);
    if (ctx == null) return;
    openFromGraph(resolveTaskWorker({ id: task.id, runid: task.runid }, childRun, ctx.agents), ctx.model);
}

// openFromGraph is openTaskWorker for the graph's own entry points. A child run lands on the Brief, the
// surface this modal covers, so the modal closes first; left open, the run opened out of sight behind it and
// the press looked like it did nothing.
export function openFromGraph(worker: TaskWorkerView, model: AgentsViewModel): void {
    if (worker.state === "unavailable") closeDagModal();
    openTaskWorker(worker, model);
}
