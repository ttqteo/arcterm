import { Markdown } from "@/app/element/markdown";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { META_TEXT } from "@/app/view/jarvis/briefstyle";
import { atom, useAtomValue, type Atom } from "jotai";
import { useEffect, useState } from "react";
import type { AgentsViewModel } from "../agents/agents";
import type { AgentVM } from "../agents/agentsviewmodel";
import { runAtom } from "../agents/channelsstore";
import { RoutePicker } from "../agents/routepicker";
import { useRunUsage } from "../agents/runtokenstore";
import { modelsText, summarizeUsage, usageText } from "../agents/runusage";
import { StatusLine } from "../agents/statusline";
import { closeDagModal, dagModalAgentsContextAtom } from "./dagmodalstate";
import { dagActionError, dagActionRoute, routeSourceLabel, type DagViewNode } from "./dagstore";
import { escalatePayload } from "./escalate";
import { TaskModelPick } from "./modelpicksview";
import { openTaskWorker, resolveTaskWorker, type TaskWorkerView } from "./taskcorrelate";

// the mockup's open rail (RAIL_H_DESC 340) minus its closed rail (RAIL_H 108): the description gets exactly
// the height the rail grows by, so opening it never pushes the header or actions out of the rail
const DESC_MAX_PX = 232;

const ACTION_BTN =
    "cursor-pointer rounded-[8px] border border-edge-mid px-2.5 py-1 text-[11.5px] font-semibold hover:border-edge-strong";

// the selected task's rail under the graph: what it is, what can be done to it, who is working on it, and its
// full description on demand. The escalate / error state is per task, so it resets when the selection moves.
export function DagDetailRail({
    group,
    owner,
    view,
    task,
    descOpen,
    onToggleDesc,
}: {
    group: TaskGroup;
    owner: Run;
    view: DagViewNode;
    task: TaskNode;
    descOpen: boolean;
    onToggleDesc: () => void;
}) {
    const [escalating, setEscalating] = useState(false);
    const [escalateRoute, setEscalateRoute] = useState<RoutePin | null>(null);
    const [actionError, setActionError] = useState<{ taskId: string; text: string } | null>(null);
    const agentsCtx = useAtomValue(dagModalAgentsContextAtom);
    const usage = useRunUsage(group.channelid, group.runid);
    const spent = summarizeUsage(usage?.rows, task.id);

    // selecting another task closes a half-open picker instead of carrying it over to the new task
    useEffect(() => {
        setEscalating(false);
        setEscalateRoute(null);
        setActionError(null);
    }, [view.id]);

    // escalate opens the route picker; every other action is sent, and a refusal is shown on the rail instead of
    // vanishing into an unhandled rejection
    const onTaskAction = (action: string) => {
        if (dagActionRoute(action) === "pick-route") {
            setEscalating(!escalating);
            return;
        }
        setActionError(null);
        runAction(group, view, action).catch((e) => {
            setActionError({ taskId: view.id, text: dagActionError(action, view.id, e) });
        });
    };

    const hasDesc = !!task.description?.trim();
    const showDesc = hasDesc && descOpen;
    return (
        <div className="flex flex-none flex-col gap-1.5 border-t border-border bg-lane px-4 py-2.5">
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className={META_TEXT}>
                        {view.id} · {view.state}
                        {view.gate ? " · gate" : ""}
                    </div>
                    <div className="truncate text-[13px] font-semibold text-ink-hi">{view.label}</div>
                    <div
                        className="truncate text-[10.5px] tabular-nums text-secondary"
                        data-dag-node-route={`${view.route.source}:${view.route.runtime}:${view.route.model}`}
                    >
                        <span className="text-ink-mid">worker</span> · {routeSourceLabel(view.route.source)} ·{" "}
                        {view.route.runtime} / {view.route.model || "default"} · {view.route.resolvedModel}
                        {view.meta ? ` · ${view.meta}` : ""}
                    </div>
                    <div className="truncate text-[10.5px] tabular-nums text-secondary">
                        <span className="text-ink-mid">review</span> · {view.reviewLine}
                    </div>
                    {spent ? (
                        <div className="truncate text-[10.5px] tabular-nums text-secondary">
                            <span className="text-ink-mid">tokens</span> · {usageText(spent, usage.sealed)} ·{" "}
                            {modelsText(spent)}
                        </div>
                    ) : null}
                </div>
                <div className="flex flex-none gap-1.5">
                    {hasDesc ? (
                        <button
                            type="button"
                            onClick={onToggleDesc}
                            aria-expanded={descOpen}
                            className={`flex cursor-pointer items-center gap-[5px] rounded-[8px] border px-2.5 py-1 text-[11.5px] font-semibold ${
                                descOpen
                                    ? "border-accent/50 bg-accent/12 text-accent-soft"
                                    : "border-edge-mid text-secondary hover:border-edge-strong"
                            }`}
                        >
                            Description
                            <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
                                <path
                                    d={descOpen ? "M2 6.5l3-3 3 3" : "M2 3.5l3 3 3-3"}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={1.6}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </button>
                    ) : null}
                    {view.actions.map((a) =>
                        dagActionRoute(a) === "pick-route" ? (
                            <button
                                key={a}
                                type="button"
                                onClick={() => onTaskAction(a)}
                                aria-expanded={escalating}
                                className={`${ACTION_BTN} bg-surface text-accent hover:text-accent-soft`}
                            >
                                {a}…
                            </button>
                        ) : (
                            <button
                                key={a}
                                type="button"
                                onClick={() => onTaskAction(a)}
                                className={`${ACTION_BTN} text-secondary hover:text-primary`}
                            >
                                {a}
                            </button>
                        )
                    )}
                </div>
            </div>
            <TaskModelPick key={view.id} group={group} owner={owner} task={task} />
            {escalating && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-1.5">
                    <RoutePicker
                        value={escalateRoute}
                        canInherit={false}
                        onChange={setEscalateRoute}
                        placement="top-start"
                    />
                    <span className="text-[10.5px] text-ink-mid">
                        one judged hop — a second failure blocks this task for you
                    </span>
                    <div className="ml-auto flex gap-1.5">
                        <button
                            type="button"
                            onClick={() => setEscalating(false)}
                            className={`${ACTION_BTN} font-normal text-secondary`}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={escalateRoute == null}
                            onClick={() => {
                                if (escalateRoute) {
                                    setActionError(null);
                                    runEscalate(group, view, escalateRoute).catch((e) => {
                                        setActionError({
                                            taskId: view.id,
                                            text: dagActionError("escalate", view.id, e),
                                        });
                                    });
                                    setEscalating(false);
                                    setEscalateRoute(null);
                                }
                            }}
                            className="cursor-pointer rounded-[8px] bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Re-queue on model
                        </button>
                    </div>
                </div>
            )}
            {actionError?.taskId === view.id ? (
                <div className="text-[11.5px] text-error">{actionError.text}</div>
            ) : null}
            {!escalating && agentsCtx ? (
                <SelectedTaskWorker taskNode={task} model={agentsCtx.model} agents={agentsCtx.agents} />
            ) : null}
            {showDesc ? (
                <div className="min-h-0 overflow-y-auto border-t border-border pt-2" style={{ maxHeight: DESC_MAX_PX }}>
                    <Markdown text={task.description} scrollable fontSizeOverride={12} />
                </div>
            ) : null}
        </div>
    );
}

// SelectedTaskWorker renders the selected task's worker treatment in the modal rail: the shared status
// line when dispatched, Open in Agent navigation, and the explicit pending / worker-unavailable states
// per spec 6.2. A single node click only selects; a double-click or Enter opens the same place as the button.
function SelectedTaskWorker({
    taskNode,
    model,
    agents,
}: {
    taskNode: TaskNode;
    model: AgentsViewModel;
    agents: AgentVM[];
}) {
    const childRun = useAtomValue<Run | undefined>(
        (taskNode.runid ? runAtom(taskNode.runid) : NO_RUN_ATOM) as Atom<Run | undefined>
    );
    const worker: TaskWorkerView = resolveTaskWorker({ id: taskNode.id, runid: taskNode.runid }, childRun, agents);
    if (worker.state === "pending") {
        return (
            <div className={`flex items-center gap-1.5 ${META_TEXT}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-edge-strong" />
                Not dispatched yet
            </div>
        );
    }
    if (worker.state === "dispatched" && worker.agent) {
        return (
            <div className="flex min-w-0 items-center gap-2">
                <StatusLine agent={worker.agent} nowAtom={model.nowAtom} className="min-w-0 flex-1" />
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        openFromGraph(worker, model);
                    }}
                    className="flex-none cursor-pointer rounded-[5px] border border-accent/50 px-1.5 py-0.5 text-[10.5px] font-bold text-accent-soft hover:border-accent"
                >
                    Open in Agent ↗
                </button>
            </div>
        );
    }
    return (
        <div className={`flex min-w-0 items-center gap-2 ${META_TEXT}`}>
            <span className="shrink-0">Worker session unavailable</span>
            <div className="flex-1" />
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    openFromGraph(worker, model);
                }}
                className="flex-none cursor-pointer rounded-[5px] border border-edge-mid px-1.5 py-0.5 text-[10.5px] text-secondary hover:border-edge-strong"
            >
                View child run
            </button>
        </div>
    );
}

// stable no-run atom for a task that has not been dispatched (runAtom is oref-cached, so per-run atoms keep
// identity across renders; a static Atom is needed for the no-run slot so the hook count never varies)
const NO_RUN_ATOM = atom<Run | undefined>(undefined);

// openTaskFromGraph opens a task's worker from a double-click or Enter, to the same place the rail's button
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
function openFromGraph(worker: TaskWorkerView, model: AgentsViewModel): void {
    if (worker.state === "unavailable") closeDagModal();
    openTaskWorker(worker, model);
}

// runEscalate re-queues a failed/stalled task on the exact model the human picked; one judged hop.
function runEscalate(group: TaskGroup, view: DagViewNode, route: RoutePin) {
    return RpcApi.DagActionCommand(TabRpcClient, escalatePayload(group.channelid, group.runid, view.id, route));
}

// runAction dispatches the task's action to the dag commands; the resulting waveobj update re-derives the
// graph. "resolve" is merge --continue: it finishes a squash merge the human resolved in the project tree, or
// re-runs a failed Verify after their fix; the remaining actions go through the engine's dag action RPC.
// escalate is never sent from here: dagActionRoute routes it to the picker before this is called.
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
