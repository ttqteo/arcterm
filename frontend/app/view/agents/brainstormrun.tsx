// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The brainstorm's Run step: the design handed over and where the run it started stands, read from the run
// itself. Once the run merged (or a quick run is done), Close deletes the brainstorm file and ends its agent, and
// closes what is left of the run: accepts its outcome, ends its open sessions, removes the worktrees its cleanup
// left. A merged run whose final check did not pass asks first. The canvas stays, in the Canvas gallery.

import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { closeSessions } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { decisionParts, partGist, type BrainstormFile, type BrainstormPart, type PartState } from "./brainstormmodel";
import {
    closesRun,
    closeTarget,
    runClose,
    runCloseText,
    runStepView,
    shortRunId,
    type RunClose,
    type RunStepState,
    type RunStepView,
} from "./brainstormrunmodel";
import { brainstormAtom, shownBrainstormFile, type BrainstormState } from "./brainstormstore";
import {
    CheckMark,
    DOT,
    DOT_ASKED,
    DOT_GUESS,
    DOT_OPEN,
    DOT_YOURS,
    ERROR_LINE,
    errText,
    StaleBanner,
    Toolbar,
    useAction,
} from "./brainstormui";
import { runAgentsOf } from "./runlineage";
import { runInfoAtom, useRunInfo } from "./runlineagestore";
import { RunSection, useRunAsks } from "./runrailsections";
import { SWAP_BTN, SWAP_PRIMARY_BTN } from "./swapbar";

const PART_DOT: Record<PartState, string> = {
    yours: DOT_YOURS,
    guess: DOT_GUESS,
    asked: DOT_ASKED,
    open: DOT_OPEN,
};

const STATE_DOT: Partial<Record<RunStepState, string>> = {
    "final-failed": "bg-error",
    held: "bg-error",
    cancelled: "bg-error",
    missing: "bg-error",
    unverified: "bg-warning",
    blocked: "bg-warning",
    loading: "bg-muted",
};

// os.RemoveAll already treats a missing path as removed; this covers a server that reports it instead
const NOT_FOUND = /no such file|cannot find|does not exist|not exist|not found/i;

// a worktree removal reaps what holds the tree first and takes tens of seconds: the budget `wsh jarvis dag
// retry-cleanup` gives it
const CLEANUP_TIMEOUT_MS = 60_000;

export function RunStep({
    model,
    agent,
    s,
    f,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
}) {
    const runId = f.run!;
    const { run, loaded } = useRunInfo(runId);
    const asks = useRunAsks(run);
    const view = runStepView(runId, run, loaded);
    const lineage = useAtomValue(model.lineageAtom);
    const agents = useAtomValue(model.agentsAtom);
    const rc = runClose(
        run,
        runAgentsOf(lineage, agents, runId).map((a) => a.id)
    );
    return (
        <>
            <Toolbar topic={s.topic} f={f} progress={false} merged={view.merged} />
            <StaleBanner s={s} />
            <div className="flex min-h-0 flex-1">
                <div
                    data-brainstorm-run={view.state}
                    className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto bg-background px-[22px] pb-[30px] pt-[22px] *:flex-none"
                >
                    <div className="flex items-start gap-[14px] border-b border-border px-[14px] pb-[12px]">
                        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                            <h1 className="m-0 text-[18px] font-bold text-primary">{f.title}</h1>
                            {f.spec ? (
                                <span title={f.spec} className="truncate text-[10.5px] text-muted">
                                    {f.spec}
                                </span>
                            ) : null}
                        </div>
                        {view.state !== "missing" ? (
                            <button
                                type="button"
                                data-brainstorm-open-run
                                onClick={() => void openTarget(model, { kind: "run", runId })}
                                className={cn("flex-none", view.merged ? SWAP_BTN : SWAP_PRIMARY_BTN)}
                            >
                                Open run {shortRunId(runId)}
                            </button>
                        ) : null}
                    </div>
                    <StateCard model={model} agent={agent} s={s} f={f} runId={runId} view={view} rc={rc} />
                    <HandedOver f={f} caption={!view.merged} />
                </div>
                {run != null ? (
                    <aside
                        data-brainstorm-run-rail
                        aria-label="The run"
                        className="w-[460px] flex-none overflow-y-auto border-l border-border bg-surface px-[24px] py-[22px]"
                    >
                        <RunSection model={model} run={run} asks={asks} />
                    </aside>
                ) : null}
            </div>
        </>
    );
}

function StateCard({
    model,
    agent,
    s,
    f,
    runId,
    view,
    rc,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
    runId: string;
    view: RunStepView;
    rc: RunClose;
}) {
    const closing = view.canClose;
    const detail = closing ? closeDetail(view, s.topic, f.canvas, agent.state === "idle", rc) : view.detail;
    return (
        <div
            data-brainstorm-run-card
            className={cn(
                "mx-[14px] flex gap-[12px] rounded-[8px] border border-edge-mid bg-surface-raised",
                view.merged ? "items-center px-[16px] py-[14px]" : "items-start px-[14px] py-[12px]"
            )}
        >
            {view.merged ? (
                <CheckMark />
            ) : (
                <span className={cn(DOT, "mt-[5px]", STATE_DOT[view.state] ?? "bg-accent")} />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                <span className={cn("font-semibold text-primary", view.merged ? "text-[14px]" : "text-[13.5px]")}>
                    {view.headline}
                </span>
                {detail ? <span className="text-[13px] leading-[1.5] text-ink-mid">{detail}</span> : null}
                {closing && view.closeWarn ? (
                    <span data-brainstorm-close-warn className="text-[13px] leading-[1.5] text-warning">
                        {view.closeWarn}
                    </span>
                ) : null}
            </div>
            {closing ? <CloseButton model={model} agent={agent} s={s} runId={runId} view={view} rc={rc} /> : null}
        </div>
    );
}

// an agent at work is left running: the brainstorm is done, but it may have moved on to something else
function closeDetail(
    view: RunStepView,
    topic: string,
    canvas: string | undefined,
    idle: boolean,
    rc: RunClose
): string {
    const kept = canvas ? ` The ${canvas} canvas stays in the Canvas gallery.` : "";
    const agent = idle ? " and ends this agent" : "; this agent is at work, so it keeps running";
    return `${view.detail} The spec stays in docs/.${kept} Closing deletes .superpowers/brainstorm/${topic}${agent}.${runCloseText(rc)}`;
}

function CloseButton({
    model,
    agent,
    s,
    runId,
    view,
    rc,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    s: BrainstormState;
    runId: string;
    view: RunStepView;
    rc: RunClose;
}) {
    const act = useAction();
    const target = closeTarget(s.cwd, s.topic);
    const refusal = "reason" in target ? target.reason : null;
    const error = refusal ?? act.error;
    const label = closesRun(rc) ? "Close brainstorm and run" : "Close the brainstorm";
    const close = () => void act.run(() => closeBrainstorm(model, agent, runId));
    const onClick = () => {
        if (view.closeWarn == null) {
            close();
            return;
        }
        modalsModel.pushModal("ConfirmModal", {
            title: label,
            message: `${view.closeWarn}${runCloseText(rc)}`,
            confirmLabel: label,
            destructive: true,
            onConfirm: close,
        });
    };
    return (
        <div className="flex max-w-[45%] flex-none flex-col items-end gap-[6px]">
            <button
                type="button"
                data-brainstorm-close
                disabled={refusal != null || act.busy}
                onClick={onClick}
                className={SWAP_PRIMARY_BTN}
            >
                {label}
            </button>
            {error != null ? (
                <span data-brainstorm-close-error className={cn(ERROR_LINE, "text-right")}>
                    {error}
                </span>
            ) : null}
        </div>
    );
}

// the gate and the targets are read again at the click, not trusted from the render that drew the button
async function closeBrainstorm(model: AgentsViewModel, agent: AgentVM, runId: string): Promise<void> {
    const read = globalStore.get(runInfoAtom(runId));
    if (!runStepView(runId, read.run, read.loaded).canClose) {
        throw new Error("The run is no longer merged or done, so the brainstorm stays.");
    }
    const s = globalStore.get(brainstormAtom(agent.id));
    if (s == null || shownBrainstormFile(s) == null) {
        throw new Error("Arc has no brainstorm file to close.");
    }
    const target = closeTarget(s.cwd, s.topic);
    if ("reason" in target) {
        throw new Error(target.reason);
    }
    const runTabs = runAgentsOf(globalStore.get(model.lineageAtom), globalStore.get(model.agentsAtom), runId);
    const rc = runClose(
        read.run,
        runTabs.map((a) => a.id)
    );
    // a failed accept leaves everything for a retry, as a failed delete does
    if (rc.ack && read.run != null) {
        await RpcApi.AckRunCommand(TabRpcClient, { channelid: read.run.channelId, runid: runId });
    }
    // the sessions end before the cleanup, which a shell still in a worktree would hold
    if (runTabs.length > 0) {
        closeSessions(runTabs, "brainstorm closed with its run");
    }
    // a tree that still cannot be removed does not hold the close: the run keeps its Cleanup failed line for it
    await Promise.allSettled(
        rc.cleanup.map((taskid) =>
            RpcApi.DagActionCommand(
                TabRpcClient,
                { channelid: read.run!.channelId, runid: runId, taskid, action: "retry-cleanup" },
                { timeout: CLEANUP_TIMEOUT_MS }
            )
        )
    );
    // a failed delete leaves the brainstorm, its agent and this button for a retry
    try {
        await RpcApi.FileDeleteCommand(TabRpcClient, { path: target.path, recursive: true });
    } catch (e) {
        if (!NOT_FOUND.test(errText(e))) {
            throw new Error(`Arc could not delete ${target.path}: ${errText(e)}`);
        }
    }
    if (agent.state === "idle") {
        closeSessions([agent], "brainstorm closed after its run landed");
    }
}

function HandedOver({ f, caption }: { f: BrainstormFile; caption: boolean }) {
    const parts = decisionParts(f);
    return (
        <section data-brainstorm-handed aria-label="What you handed over" className="flex flex-col">
            <div className="flex items-baseline gap-[8px] px-[14px] pb-[6px]">
                <h2 className="m-0 text-[13px] font-semibold text-secondary">What you handed over · {parts.length}</h2>
                {caption ? <span className="text-[12px] text-muted">the design the run builds from</span> : null}
            </div>
            {parts.map((p) => (
                <HandedRow key={p.id} f={f} p={p} />
            ))}
        </section>
    );
}

function HandedRow({ f, p }: { f: BrainstormFile; p: BrainstormPart }) {
    return (
        <div
            data-brainstorm-handed-row={p.id}
            className="grid grid-cols-[7px_minmax(120px,230px)_minmax(0,1fr)] items-start gap-x-[12px] border-t border-edge-faint px-[14px] py-[8px]"
        >
            <span className={cn(PART_DOT[p.state], "mt-[6px]")} />
            <span className="text-[13.5px] font-semibold leading-[1.45] text-primary">{p.title}</span>
            {/* the from line sits under the gist, as on the brainstorm's part row: a column of its own sized to
                max-content took the row's width and squeezed the gist to one word a line */}
            <span className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-[13.5px] leading-[1.45] text-secondary">{partGist(f, p)}</span>
                {p.from ? (
                    <span title={p.from} className="truncate text-[10.5px] text-muted">
                        {p.from}
                    </span>
                ) : null}
            </span>
        </div>
    );
}
