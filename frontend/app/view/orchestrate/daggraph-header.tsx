import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useAtomValue } from "jotai";
import { useRunUsage } from "../agents/runtokenstore";
import { modelsText, summarizeUsage, usageText } from "../agents/runusage";
import { chipGroups, pickNext, type ChipGroup } from "./dagcanvas";
import { selectedTaskIdAtom } from "./dagstore";
import { reviewersChip, workersChip } from "./taskroute";

// a chip's dot: filled for the groups that are doing or done something, an open ring for those that are not
const CHIP_DOT = new Map<ChipGroup["key"], string>([
    ["attention", "border-warning bg-warning"],
    ["live", "border-accent bg-accent"],
    ["done", "border-success bg-success"],
    ["waiting", "border-ink-faint"],
    ["inert", "border-muted"],
]);

// the summary chips: how many tasks are in each group, and a click steps the selection through that group
function SummaryChips({ tasks }: { tasks: TaskNode[] }) {
    const selected = useAtomValue(selectedTaskIdAtom);
    return (
        <div className="flex flex-none items-center gap-1.5">
            {chipGroups(tasks).map((g) => (
                <button
                    key={g.key}
                    type="button"
                    title={`Select the next task that is ${g.label}`}
                    onClick={() => {
                        const next = pickNext(tasks, g.kinds, selected);
                        if (next != null) globalStore.set(selectedTaskIdAtom, next);
                    }}
                    className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-edge-mid bg-surface-raised px-2 py-[3px] text-[11.5px] text-secondary hover:border-edge-strong"
                >
                    <span className={`h-[7px] w-[7px] rounded-full border-[1.5px] ${CHIP_DOT.get(g.key)}`} />
                    {`${g.count} ${g.label}`}
                </button>
            ))}
        </div>
    );
}

const ROUTE_CHIP =
    "flex-none rounded-[5px] border border-edge-mid px-[7px] py-0.5 text-[10.5px] text-ink-mid";

// graph header: the owning run's goal, the summary chips, the workers and reviewers routes, the derived status
// pill, cancel. No back button: the modal header above it already closes, and a second close one row down read
// as two different exits.
// No dag id either: the modal subtitle names the run, and the dag's uuid identified it to nobody.
export function DagGraphHeader({ group, owner }: { group: TaskGroup; owner: Run }) {
    const status = group.status;
    const tone =
        status === "done" || status === "awaiting-review"
            ? "border-success/50 bg-success/10 text-success"
            : status === "blocked" || status === "awaiting-plan"
              ? "border-warning/60 bg-warning/10 text-warning"
              : status === "cancelled"
                ? "border-edge-mid bg-surface-raised text-muted"
                : "border-accent/50 bg-accent/10 text-accent-soft";
    const label = status.split("-").join(" ");
    const done = group.tasks.filter((t) => t.state === "done").length;
    const usage = useRunUsage(group.channelid, group.runid);
    const spent = summarizeUsage(usage?.rows);
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-4 py-2.5">
            <div className="min-w-48 flex-1">
                <div className="truncate text-[15px] font-bold tracking-[-0.01em] text-primary">
                    {group.title || "orchestration dag"}
                </div>
                <div className="text-[10.5px] tabular-nums text-ink-mid">
                    parallelism {group.parallelism} · {done}/{group.tasks.length} done
                    {spent ? ` · ${usageText(spent, usage.sealed)}` : ""}
                </div>
                {spent ? (
                    <div className="truncate text-[10.5px] tabular-nums text-ink-mid">{modelsText(spent)}</div>
                ) : null}
            </div>
            <SummaryChips tasks={group.tasks} />
            <span className={ROUTE_CHIP}>{workersChip(group, owner)}</span>
            <span className={ROUTE_CHIP}>{reviewersChip(group, owner)}</span>
            <span
                className={`rounded-[5px] border px-2 py-0.5 text-[10.5px] uppercase tracking-wide ${tone}`}
            >
                {label}
            </span>
            {/* awaiting-plan is cancellable too: abandoning a run at its gate is a normal answer, and the
                alternative would be approving work you do not want in order to be allowed to stop it */}
            {group.status === "running" ||
            group.status === "awaiting-review" ||
            group.status === "awaiting-plan" ||
            group.status === "plan-review" ||
            group.status === "finalizing" ? (
                <button
                    type="button"
                    onClick={() =>
                        void RpcApi.DagActionCommand(TabRpcClient, {
                            channelid: group.channelid,
                            runid: group.runid,
                            taskid: "",
                            action: "cancel",
                        })
                    }
                    className="rounded border border-edge-mid px-2.5 py-1 text-[11.5px] font-semibold text-secondary hover:border-warning/60 hover:text-warning"
                >
                    Cancel
                </button>
            ) : null}
        </div>
    );
}
