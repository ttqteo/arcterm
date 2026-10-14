// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The final stage's shared views: the Agent surface's pane and rails and the DAG's node and rail all draw the
// stage with these, from the one view finalstage.ts derives. Nothing here decides a state, a time or a label.

import * as WOS from "@/app/store/wos";
import { finalCheckEntry } from "@/app/view/jarvis/finalshotsmodel";
import { FinalShotsViewer } from "@/app/view/jarvis/finalshotsviewer";
import { imageStatus, localFileUrl, type LocalImageStatus } from "@/app/view/jarvis/localimage";
import { finalStageEndable } from "@/app/view/jarvis/runsheetmodel";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { cn } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { useEffect, useState } from "react";
import { dockButtonClass, EndFinalForm } from "./endfinalform";
import {
    finalStageView,
    outputTail,
    stepHasOutput,
    type FinalRoundLine,
    type FinalStageView,
    type FinalStep,
    type FinalStepKey,
    type FinalTone,
} from "./finalstage";
import { useRunEvents } from "./runeventstore";

const NO_RUN: Atom<Run | undefined> = atom(undefined as Run | undefined);

// useFinalStageView is the stage's view for a site that draws it, with the run's events and the current
// round's verifier Run read here so no site wires them itself.
export function useFinalStageView(
    group: TaskGroup | undefined,
    runId: string,
    channelId: string,
    now: number
): FinalStageView {
    const events = useRunEvents(runId, channelId);
    const verifierRunId = group?.final?.verifierrunid;
    const verifierRun = useAtomValue(
        verifierRunId ? WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", verifierRunId)) : NO_RUN
    );
    return finalStageView(group, events, now, verifierRun ?? undefined);
}

const MARK: Record<FinalTone, string> = {
    wait: "border border-muted",
    run: "bg-accent",
    pass: "bg-success",
    fail: "bg-error",
    warn: "bg-warning",
};
const SEGMENT: Record<FinalTone, string> = { ...MARK, wait: "bg-edge-strong" };
const STATE_INK: Record<FinalTone, string> = {
    wait: "text-muted",
    run: "text-accent-soft",
    pass: "text-secondary",
    fail: "text-error",
    warn: "text-warning",
};
const LINK = "cursor-pointer text-[10.5px] font-semibold text-accent-soft hover:text-accent";

function StepMark({ tone }: { tone: FinalTone }) {
    return <span aria-hidden className={cn("size-[7px] flex-none rounded-full", MARK[tone])} />;
}

function StepLabel({ step }: { step: FinalStep }) {
    return (
        <span className={cn("text-[11.5px] font-medium", step.tone === "wait" ? "text-ink-mid" : "text-ink-hi")}>
            {step.label}
        </span>
    );
}

function StepText({ step }: { step: FinalStep }) {
    return (
        <span
            className={cn("flex-none whitespace-nowrap text-[10.5px] tabular-nums font-medium", STATE_INK[step.tone])}
        >
            {step.text}
        </span>
    );
}

export type KeptOutput = { status: LocalImageStatus; text: string };

// useKeptOutput reads the output a step that ended kept on disk, through wavesrv as the screenshots are.
export function useKeptOutput(kept: FinalStep["kept"]): KeptOutput {
    const [out, setOut] = useState<KeptOutput>({ status: "loading", text: "" });
    const path = kept?.path;
    const ts = kept?.ts;
    useEffect(() => {
        if (path == null) {
            return;
        }
        let cancelled = false;
        setOut({ status: "loading", text: "" });
        (async () => {
            try {
                // the endpoint lets the webview cache, and a rerun of the step rewrites the same file
                const resp = await fetch(`${localFileUrl(getWebServerEndpoint(), path)}&v=${ts}`);
                const status = imageStatus(resp.status);
                const text = status === "ok" ? await resp.text() : "";
                if (!cancelled) {
                    setOut({ status, text });
                }
            } catch (e) {
                console.error("final stage: cannot read the output of", path, e);
                if (!cancelled) {
                    setOut({ status: "error", text: "" });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [path, ts]);
    return out;
}

const KEPT_EMPTY: Record<LocalImageStatus, string> = {
    loading: "loading the output...",
    ok: "the step printed nothing",
    missing: "no output kept: the step ran before Arc kept it, or it was swept",
    error: "could not read the step's output",
};

// A step's kept output whole, or a line saying why there is none.
export function FinalKeptOutput({ kept, className }: { kept: FinalStep["kept"]; className?: string }) {
    const out = useKeptOutput(kept);
    if (out.text.trim() === "") {
        return <span className="text-[10.5px] text-muted">{KEPT_EMPTY[out.status]}</span>;
    }
    return <FinalOutput output={out.text} className={className} />;
}

// One row per step: mark, label, state text. A row whose step kept its output opens it beneath.
export function FinalStepList({ steps }: { steps: FinalStep[] }) {
    const [open, setOpen] = useState<FinalStepKey | null>(null);
    return (
        <div className="flex flex-col">
            {steps.map((step) => {
                const opens = step.kept != null;
                const isOpen = opens && open === step.key;
                return (
                    <div key={step.key} className="flex flex-col border-b border-edge-faint">
                        <div
                            data-final-step={step.key}
                            data-final-step-state={step.state}
                            role={opens ? "button" : undefined}
                            aria-expanded={opens ? isOpen : undefined}
                            onClick={opens ? () => setOpen(isOpen ? null : step.key) : undefined}
                            className={cn("flex items-center gap-[9px] py-1.5", opens && "cursor-pointer")}
                        >
                            <StepMark tone={step.tone} />
                            <StepLabel step={step} />
                            <span className="flex-1" />
                            <StepText step={step} />
                        </div>
                        {isOpen ? (
                            <div className="sc mb-1.5 max-h-[320px] overflow-auto">
                                <FinalKeptOutput kept={step.kept} />
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

// The pipeline: one bordered cell per step, the shown one accented, else the running one. showCommand adds each
// step's command. With onPick, a step whose output can be opened is clickable.
export function FinalStepCells({
    steps,
    showCommand,
    shown,
    onPick,
}: {
    steps: FinalStep[];
    showCommand?: boolean;
    shown?: FinalStepKey;
    onPick?: (key: FinalStepKey) => void;
}) {
    return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
            {steps.map((step) => {
                const pickable = onPick != null && stepHasOutput(step);
                return (
                    <div
                        key={step.key}
                        data-final-step={step.key}
                        data-final-step-state={step.state}
                        role={pickable ? "button" : undefined}
                        aria-pressed={pickable ? step.key === shown : undefined}
                        onClick={pickable ? () => onPick(step.key) : undefined}
                        className={cn(
                            "flex min-w-0 flex-col gap-1 rounded-[8px] border px-2.5 py-2",
                            step.key === shown
                                ? "border-accent/50"
                                : !shown && step.state === "running"
                                  ? "border-working/50"
                                  : "border-edge-mid",
                            step.state === "running" && "bg-lane",
                            pickable && step.key !== shown && "cursor-pointer hover:border-edge-strong"
                        )}
                    >
                        {showCommand ? (
                            <>
                                <span className="flex items-center gap-1.5">
                                    <StepMark tone={step.tone} />
                                    <StepLabel step={step} />
                                    <span className="flex-1" />
                                    <StepText step={step} />
                                </span>
                                <span title={step.command} className="truncate font-mono text-[10.5px] text-muted">
                                    {step.command}
                                </span>
                            </>
                        ) : (
                            <>
                                <span className="flex items-center gap-1.5">
                                    <StepMark tone={step.tone} />
                                    <StepLabel step={step} />
                                </span>
                                <StepText step={step} />
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// The 3px strip: one segment per step.
export function FinalStepStrip({ view }: { view: FinalStageView }) {
    const label = view.stepIndex > 0 ? `step ${view.stepIndex} of ${view.steps.length}` : view.headline;
    return (
        <span role="img" aria-label={label} className="flex h-[3px] gap-0.5">
            {view.steps.map((step) => (
                <span
                    key={step.key}
                    data-final-step={step.key}
                    data-final-step-state={step.state}
                    className={cn("flex-1 rounded-[1.5px]", SEGMENT[step.tone])}
                />
            ))}
        </span>
    );
}

// A running command's output tail, its last `lines` lines when given. Draws nothing with no output.
export function FinalOutput({ output, lines, className }: { output: string; lines?: number; className?: string }) {
    const text = lines == null ? output.trimEnd() : outputTail(output, lines);
    if (text === "") {
        return null;
    }
    return (
        <div
            data-final-output
            className={cn(
                "overflow-hidden whitespace-pre rounded-[6px] border border-edge-mid bg-surface-code px-[9px] py-[7px] font-mono text-[10.5px] leading-[1.55] text-ink-mid",
                className
            )}
        >
            {text}
        </div>
    );
}

function PastRound({ line }: { line: FinalRoundLine }) {
    return (
        <div data-final-past-round={line.round} className="flex items-center gap-[9px] py-1">
            <StepMark tone={line.tone} />
            <span className="text-[10.5px] tabular-nums text-ink-mid">{line.text}</span>
        </div>
    );
}

// a line per earlier round, oldest first
export function FinalPastRounds({ past }: { past: FinalRoundLine[] }) {
    if (past.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-col">
            {past.map((line) => (
                <PastRound key={line.round} line={line} />
            ))}
        </div>
    );
}

// What an ended stage came to: a failure's detail whole, every unverified reason, and a line per earlier
// round. Long text scrolls inside it, never cut.
export function FinalOutcome({ view, className }: { view: FinalStageView; className?: string }) {
    if (view.detail === "" && view.unverified.length === 0 && view.past.length === 0) {
        return null;
    }
    return (
        <div className={cn("sc flex min-h-0 flex-col gap-2 overflow-y-auto", className)}>
            {view.detail !== "" ? (
                <div className="whitespace-pre-wrap break-words rounded-[6px] border border-edge-mid bg-surface-code px-[9px] py-[7px] font-mono text-[10.5px] leading-[1.55] text-ink-hi">
                    {view.detail}
                </div>
            ) : null}
            {view.unverified.length > 0 ? (
                <ul className="flex flex-col gap-1">
                    {view.unverified.map((reason, i) => (
                        <li key={i} className="flex items-baseline gap-[9px] text-[12px] leading-[1.5] text-secondary">
                            <span aria-hidden className="size-[7px] flex-none rounded-full bg-warning" />
                            <span className="min-w-0 whitespace-pre-wrap break-words">{reason}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
            <FinalPastRounds past={view.past} />
        </div>
    );
}

// The Final command's screenshots, opened in the run sheet's viewer. Draws nothing when there are none.
export function FinalShotsLink({ group }: { group: TaskGroup | undefined }) {
    const [open, setOpen] = useState(false);
    const entry = finalCheckEntry(group ?? null);
    if (group == null || entry == null || entry.dockDisabled) {
        return null;
    }
    return (
        <>
            <button
                type="button"
                data-final-shots-link
                onClick={() => setOpen(true)}
                className={cn(LINK, "self-start")}
            >
                {entry.dockLabel}
            </button>
            {/* the viewer mounts only while open: mounting is what claims the keys and the modal stack */}
            {open ? (
                <FinalShotsViewer group={group} initial={{ round: entry.latestRound }} onClose={() => setOpen(false)} />
            ) : null}
        </>
    );
}

// End final stage, while the stage runs. The form opens under the button, and a refusal from the engine
// stays beside it.
export function EndFinalStage({
    group,
    channelId,
    runId,
}: {
    group: TaskGroup | undefined;
    channelId: string;
    runId: string;
}) {
    const [ending, setEnding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const endable = finalStageEndable(group ?? null);
    // a stage that stops being endable closes the form, or a later round's final stage would open on it
    if (ending && !endable) {
        setEnding(false);
    }
    if (!endable) {
        return null;
    }
    return (
        <div className="relative flex flex-none items-center gap-2">
            {error != null ? <span className="text-[11px] text-error">{error}</span> : null}
            <button
                type="button"
                data-final-end
                aria-expanded={ending}
                onClick={() => {
                    setError(null);
                    setEnding(true);
                }}
                className={dockButtonClass()}
            >
                End final stage
            </button>
            {ending ? (
                <div className="absolute right-0 top-full z-10 mt-1.5 w-[340px] rounded-[9px] border border-edge-mid bg-surface-raised p-2.5">
                    <EndFinalForm
                        channelId={channelId}
                        runId={runId}
                        onClose={() => setEnding(false)}
                        onError={setError}
                    />
                </div>
            ) : null}
        </div>
    );
}
