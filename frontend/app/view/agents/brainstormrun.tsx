// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The brainstorm's Run step: the design handed over and where the run it started stands, read from the run
// itself. Once the run merged with its final check passed, Close deletes the brainstorm's scaffolding.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { decisionParts, partGist, type BrainstormFile, type BrainstormPart, type PartState } from "./brainstormmodel";
import { closeTargets, runStepView, shortRunId, type RunStepState, type RunStepView } from "./brainstormrunmodel";
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
    loading: "bg-muted",
};

// os.RemoveAll already treats a missing path as removed; this covers a server that reports it instead
const NOT_FOUND = /no such file|cannot find|does not exist|not exist|not found/i;

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
                                <span title={f.spec} className="truncate font-mono text-[10.5px] text-muted">
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
                    <StateCard agent={agent} s={s} f={f} runId={runId} view={view} />
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
    agent,
    s,
    f,
    runId,
    view,
}: {
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
    runId: string;
    view: RunStepView;
}) {
    const closing = view.canClose;
    const detail = closing ? closeDetail(s.topic, f.canvas) : view.detail;
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
                {view.closeOff ? (
                    <span data-brainstorm-close-off className="text-[13px] leading-[1.5] text-ink-mid">
                        {view.closeOff}
                    </span>
                ) : null}
            </div>
            {closing ? <CloseButton agentId={agent.id} s={s} f={f} runId={runId} /> : null}
        </div>
    );
}

function closeDetail(topic: string, canvas: string | undefined): string {
    const deletes = `.superpowers/brainstorm/${topic}${canvas ? ` and the ${canvas} canvas` : ""}`;
    return `The final check passed. The spec stays in docs/. The brainstorm file and its mockups were scaffolding for the design: closing deletes ${deletes}.`;
}

function CloseButton({
    agentId,
    s,
    f,
    runId,
}: {
    agentId: string;
    s: BrainstormState;
    f: BrainstormFile;
    runId: string;
}) {
    const act = useAction();
    const targets = closeTargets(s.cwd, s.topic, f.canvas);
    const refusal = "reason" in targets ? targets.reason : null;
    const error = refusal ?? act.error;
    return (
        <div className="flex max-w-[45%] flex-none flex-col items-end gap-[6px]">
            <button
                type="button"
                data-brainstorm-close
                disabled={refusal != null || act.busy}
                onClick={() => void act.run(() => closeBrainstorm(agentId, runId))}
                className={SWAP_PRIMARY_BTN}
            >
                Close the brainstorm
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
async function closeBrainstorm(agentId: string, runId: string): Promise<void> {
    const read = globalStore.get(runInfoAtom(runId));
    if (!runStepView(runId, read.run, read.loaded).canClose) {
        throw new Error("The run is no longer merged with its final check passed, so the brainstorm stays.");
    }
    const s = globalStore.get(brainstormAtom(agentId));
    const f = s != null ? shownBrainstormFile(s) : null;
    if (s == null || f == null) {
        throw new Error("Arc has no brainstorm file to close.");
    }
    const targets = closeTargets(s.cwd, s.topic, f.canvas);
    if ("reason" in targets) {
        throw new Error(targets.reason);
    }
    // in order: a failed first delete leaves the brainstorm, and this button, for a retry
    for (const path of targets.paths) {
        try {
            await RpcApi.FileDeleteCommand(TabRpcClient, { path, recursive: true });
        } catch (e) {
            if (!NOT_FOUND.test(errText(e))) {
                throw new Error(`Arc could not delete ${path}: ${errText(e)}`);
            }
        }
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
            className="grid grid-cols-[7px_minmax(120px,230px)_minmax(0,1fr)_max-content] items-start gap-x-[12px] border-t border-edge-faint px-[14px] py-[8px]"
        >
            <span className={cn(PART_DOT[p.state], "mt-[6px]")} />
            <span className="text-[13.5px] font-semibold leading-[1.45] text-primary">{p.title}</span>
            <span className="min-w-0 text-[13.5px] leading-[1.45] text-secondary">{partGist(f, p)}</span>
            <span className="mt-[2px] font-mono text-[10.5px] text-muted">{p.from ?? ""}</span>
        </div>
    );
}
