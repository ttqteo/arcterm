// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveObjectValue } from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useState } from "react";
import { shortModel } from "../agents/modelname";
import { dagActionError, useDagGroup } from "./dagstore";
import { leadModelsPayload, pickRows, picksBanner, setModelPayload, type PickModel } from "./modelpicks";
import { workersRoute } from "./taskroute";

function usePicksSource(dagOref: string, runId: string): { group: TaskGroup; owner: Run } | null {
    const [group] = useDagGroup(dagOref);
    const [owner] = useWaveObjectValue<Run>(`run:${runId}`);
    return group != null && owner != null ? { group, owner } : null;
}

// the "lead" choice clears the task's pin, which lands it on the workers route: the lead's own model on a
// Reviewer picks run, since choosing Reviewer picks clears the workers route
function leadShort(group: TaskGroup, owner: Run): string {
    return shortModel(workersRoute(group, owner).model);
}

export function ModelPicksBanner({ dagOref, runId }: { dagOref: string; runId: string }) {
    const src = usePicksSource(dagOref, runId);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const banner = src ? picksBanner(src.group, src.owner) : null;
    if (src == null || banner == null) return null;
    const { group } = src;
    const allToLead = () => {
        setBulkError(null);
        RpcApi.DagActionCommand(TabRpcClient, leadModelsPayload(group)).catch((e) => {
            setBulkError(e instanceof Error ? e.message : String(e));
        });
    };
    return (
        <div
            data-model-picks-banner
            className="flex flex-none items-center gap-2.5 border-b border-border bg-surface-raised px-4 py-2"
        >
            <span className="size-[7px] flex-none rounded-full bg-success" />
            <span className="text-[12.5px] text-ink-hi">
                The plan reviewer put{" "}
                <b className="font-semibold">
                    {banner.onLight} of {banner.total} tasks
                </b>{" "}
                on sonnet. Select a task to change its model.
            </span>
            <span className="flex-1" />
            {bulkError && <span className="min-w-0 truncate text-[11px] text-error">{bulkError}</span>}
            <button
                type="button"
                onClick={allToLead}
                className="flex-none cursor-pointer rounded-md border border-edge-mid px-2.5 py-0.5 text-[11px] font-semibold text-secondary hover:border-edge-strong hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
                Put waiting tasks back on {leadShort(group, src.owner)}
            </button>
        </div>
    );
}

// the selected task's pick in the detail rail: changeable while the task waits, shown read-only while it runs. A
// refusal (the task started meanwhile, or this machine cannot run the model) stays on the row; mount it keyed by
// task so the error does not follow the selection.
export function TaskModelPick({ group, owner, task }: { group: TaskGroup; owner: Run; task: TaskNode }) {
    const [error, setError] = useState<string | null>(null);
    const row = pickRows(group, owner).find((r) => r.id === task.id);
    if (row == null || (!row.waiting && task.state !== "running")) return null;
    const lead = leadShort(group, owner);
    const setModel = (model: PickModel) => {
        setError(null);
        RpcApi.DagActionCommand(TabRpcClient, setModelPayload(group, row.id, model)).catch((e) => {
            setError(dagActionError("setmodel", row.id, e));
        });
    };
    return (
        <div data-model-pick={row.id} className="flex flex-col gap-1 border-t border-border pt-1.5">
            <div className="flex items-center gap-2.5">
                <span className="flex-none text-[10.5px] text-ink-mid">model</span>
                {row.waiting ? (
                    <div
                        role="group"
                        aria-label={`${row.id} model`}
                        className="flex flex-none gap-0.5 rounded-[7px] border border-border bg-surface-raised p-0.5"
                    >
                        <ToggleButton on={row.model === "sonnet"} label="sonnet" onClick={() => setModel("sonnet")} />
                        <ToggleButton on={row.model === "lead"} label={lead} onClick={() => setModel("lead")} />
                    </div>
                ) : (
                    <span className="flex flex-none items-center gap-1.5 text-[10.5px] text-success">
                        <span className="size-[7px] rounded-full bg-success pulse-dot" />
                        running on {row.runningModel}
                    </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-mid" title={row.reason}>
                    {row.reason ? `Plan reviewer: ${row.reason}` : ""}
                </span>
                <span
                    className={cn("flex-none text-[10.5px]", row.changed ? "text-accent-soft" : "text-muted")}
                >
                    {!row.waiting ? "" : row.changed ? "you changed it" : "waiting"}
                </span>
            </div>
            {!row.waiting && (
                <div className="text-[11px] text-muted">
                    A task that already started keeps its model. If it fails, retry it on {lead} from here.
                </div>
            )}
            {error && <div className="text-[11px] text-error">{error}</div>}
        </div>
    );
}

function ToggleButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-pressed={on}
            onClick={on ? undefined : onClick}
            className={cn(
                "cursor-pointer rounded-[5px] px-2 py-0.5 text-[10.5px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                on ? "bg-accentbg text-accent-soft" : "text-ink-mid hover:text-ink-hi"
            )}
        >
            {label}
        </button>
    );
}
