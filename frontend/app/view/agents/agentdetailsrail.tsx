// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CollapsibleRail, type RailSection } from "@/app/element/collapsiblerail";
import { Meter } from "@/app/element/meter";
import { easeFluidCss, MOTION, popoverReveal } from "@/app/element/motiontokens";
import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowLeft, ArrowUpRight, ChevronLeft, LayoutTemplate } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { driveAgent, NUDGE_INPUT } from "./agentactions";
import { agentDiffScope, openDiff } from "./agentdiffnav";
import {
    cacheRewriteTitle,
    contextLevel,
    contextNote,
    filesSummary,
    offersContextReset,
    railAction,
    toolChips,
} from "./agentrailmodel";
import { bgTaskStatusLabel, planAgentRail, type AgentRailSectionId, type BgTaskLabel } from "./agentrailsections";
import type { AgentsViewModel } from "./agents";
import { displayAgeMs, formatAgeShort, recentActions, summarizeActions, type AgentVM } from "./agentsviewmodel";
import { agentCacheStatusAtom, formatCacheCountdown, loadCacheStatusForAgent } from "./cachestatusstore";
import { canvasStateAtom, selectCanvasTab, setCanvasMode } from "./canvasstore";
import { ASK_OWNER_USER } from "./childaskmodel";
import { capFiles, statusColor } from "./gitstatus";
import { entriesAtomFor, liveEntriesByIdAtom } from "./livetranscriptatoms";
import { prettyModel } from "./modellabel";
import { artifactsView } from "./railartifacts";
import { RAIL_ICON } from "./railicons";
import { RAIL_ROW, RAIL_ROW_ACTION } from "./railrow";
import { loadRailForAgent, railStateAtom, railVisibleAtom } from "./railstore";
import { agentProject, roleRunId } from "./runlineage";
import { NeedsYouSection, RunSection, TaskSection, useRunAsks } from "./runrailsections";
import { SubLabel } from "./sectionlabel";
import type { SubagentState } from "./session-models/sessionviewmodel";
import { backgroundTasksByIdAtom, focusSubagentAtom, subagentsByIdAtom } from "./subagentsstore";
import { TokenUsageSection } from "./tokenusagesection";
import type { BackgroundTask } from "./transcriptprojection";
import { loadSessionUsage } from "./transcriptusagestore";

const GAUGE_FILL: Record<"ok" | "warn" | "hot", string> = {
    ok: "bg-accent",
    warn: "bg-warning",
    hot: "bg-error",
};

const GAUGE_TEXT: Record<"ok" | "warn" | "hot", string> = {
    ok: "text-accent",
    warn: "text-warning",
    hot: "text-error",
};

const SUB_COLOR: Record<SubagentState, string> = {
    working: "var(--color-accent)",
    success: "var(--color-success)",
    failure: "var(--color-error)",
    done: "var(--color-muted)",
};

const RailFilesCap = 8; // a 296px rail can't show a large worktree; the summary line under it counts them all
const USAGE_REFRESH_MS = 15_000;

// Details is the rail's facts about the session: its project, its branch and the worktree it works in, how long it
// has been in its state, and how full its context window is.
function DetailLine({
    label,
    title,
    clipStart,
    children,
}: {
    label: string;
    title?: string;
    // clipStart elides the start of a long value instead of its end, for a path whose tail names it
    clipStart?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="flex min-w-0 items-baseline gap-[10px]">
            <span className="w-[52px] shrink-0 text-[12px] text-muted">{label}</span>
            <span
                title={title}
                dir={clipStart ? "rtl" : undefined}
                className="min-w-0 flex-1 truncate text-left text-[11.5px] font-medium tabular-nums text-secondary"
            >
                {clipStart ? <bdi dir="ltr">{children}</bdi> : children}
            </span>
        </div>
    );
}

const RESET_BTN =
    "flex-none cursor-pointer rounded-[6px] px-[6px] py-[2px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover";

// onReset, when given, offers Compact and Clear under the note: they shrink what every turn re-reads
function ContextLine({ pct, max, onReset }: { pct: number; max?: number; onReset?: (cmd: string) => void }) {
    const level = contextLevel(pct, max);
    const note = contextNote(pct, max);
    return (
        <>
            <div title={note || undefined} className="flex min-w-0 items-center gap-[10px]">
                <span className="w-[52px] shrink-0 text-[12px] text-muted">Context</span>
                <Meter pct={pct} fill={GAUGE_FILL[level]} height={5} radius={3} track="bg-border" className="flex-1" />
                <span className={cn("w-[34px] text-right text-[11.5px] font-semibold tabular-nums", GAUGE_TEXT[level])}>
                    {Math.round(pct)}%
                </span>
            </div>
            {note ? <div className="pl-[62px] text-[10.5px] tabular-nums text-muted">{note}</div> : null}
            {onReset ? (
                <div className="flex gap-[4px] pl-[56px]">
                    <button
                        type="button"
                        onClick={() => onReset("/compact\r")}
                        title="summarize the conversation so far and keep going from the summary"
                        className={RESET_BTN}
                    >
                        Compact
                    </button>
                    <button
                        type="button"
                        onClick={() => onReset("/clear\r")}
                        title="start a fresh conversation; /resume brings this one back"
                        className={RESET_BTN}
                    >
                        Clear
                    </button>
                </div>
            ) : null}
        </>
    );
}

// RailStrip is the collapsed rail: the expand chevron, a badge for questions waiting on you, and the context
// window as a vertical gauge, so both read without opening the rail.
function RailStrip({ needs, ctxPct, ctxMax }: { needs: number; ctxPct?: number; ctxMax?: number }) {
    const level = ctxPct != null ? contextLevel(ctxPct, ctxMax) : "ok";
    const reduce = useReducedMotion();
    const tween = (props: string[]) =>
        reduce ? undefined : props.map((p) => `${p} ${MOTION.durMacro}s ${easeFluidCss}`).join(", ");
    return (
        <>
            <span className="relative block h-[18px] w-[18px]">
                <span className="flex h-[18px] w-[18px] items-center justify-center">
                    <ChevronLeft size={18} aria-hidden />
                </span>
                <AnimatePresence initial={false}>
                    {needs > 0 ? (
                        <motion.span
                            key="needs"
                            variants={popoverReveal}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="absolute -right-[8px] -top-[6px] flex h-[16px] min-w-[16px] items-center justify-center rounded-[8px] border-2 border-surface bg-warning px-[3px] text-[10.5px] font-bold tabular-nums leading-none text-on-warning"
                        >
                            {needs}
                        </motion.span>
                    ) : null}
                </AnimatePresence>
            </span>
            {ctxPct != null ? (
                <>
                    <span className="relative block h-[44px] w-[4px] overflow-hidden rounded-[2px] bg-border">
                        <span
                            className={cn("absolute inset-x-0 bottom-0", GAUGE_FILL[level])}
                            style={{
                                height: `${Math.min(100, Math.max(0, ctxPct))}%`,
                                transition: tween(["height", "background-color"]),
                            }}
                        />
                    </span>
                    <span
                        className={cn("text-[10.5px] font-semibold tabular-nums", GAUGE_TEXT[level])}
                        style={{ transition: tween(["color"]) }}
                    >
                        {Math.round(ctxPct)}%
                    </span>
                </>
            ) : null}
        </>
    );
}

function FileRow({
    status,
    path,
    adds,
    dels,
    onClick,
}: {
    status: string;
    path: string;
    adds: number;
    dels: number;
    onClick?: () => void;
}) {
    const body = (
        <>
            <span className={cn("flex-none font-bold", statusColor(status))}>{status}</span>
            <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
            <span className="flex-none text-[10.5px] tabular-nums text-diff-added">+{adds}</span>
            {dels > 0 ? <span className="flex-none text-[10.5px] tabular-nums text-diff-removed">−{dels}</span> : null}
        </>
    );
    const cls =
        "flex items-center gap-[8px] rounded-sm px-[5px] py-[3px] text-left text-[11.5px] font-medium text-secondary";
    if (!onClick) {
        return <div className={cls}>{body}</div>;
    }
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(cls, "cursor-pointer hover:bg-surface-hover hover:text-primary")}
        >
            {body}
        </button>
    );
}

const BG_DOT: Record<BgTaskLabel, string> = {
    running: "bg-accent",
    completed: "bg-success",
    failed: "bg-error",
    stopped: "bg-muted",
    unknown: "bg-muted",
};

function BackgroundTaskRow({ task, live }: { task: BackgroundTask; live: boolean }) {
    const label = bgTaskStatusLabel(task.status, live);
    return (
        <div
            title={task.command}
            className="flex items-center gap-[10px] rounded-[8px] bg-surface-raised px-[11px] py-[8px]"
        >
            <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", BG_DOT[label])} />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-secondary">{task.label}</span>
            <span className="whitespace-nowrap text-[10.5px] text-muted">{label}</span>
        </div>
    );
}

// SealedFiles lists what a done task's run recorded it changed. The worktree is gone, so there is no diff to open.
function SealedFiles({ files }: { files: EvidenceFile[] }) {
    if (files.length === 0) {
        return <div className="text-[11.5px] text-muted">No changes</div>;
    }
    const changes = files.map((f) => ({ path: f.path, status: f.stat, adds: f.add, dels: f.del }));
    const { shown } = capFiles(changes, RailFilesCap);
    return (
        <>
            <div className="flex flex-col gap-[7px]">
                {shown.map((f) => (
                    <FileRow key={f.path} status={f.status} path={f.path} adds={f.adds} dels={f.dels} />
                ))}
            </div>
            <div className="mt-[8px] text-[10.5px] tabular-nums text-muted">{filesSummary(changes)}</div>
        </>
    );
}

export function AgentDetailsRail({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const liveEntries = useAtomValue(entriesAtomFor(agent.id));
    const subs = useAtomValue(subagentsByIdAtom)[agent.id] ?? [];
    const bgTasks = useAtomValue(backgroundTasksByIdAtom)[agent.id] ?? [];
    const focusSub = useAtomValue(focusSubagentAtom);
    const sub = focusSub?.parentId === agent.id ? focusSub : null;
    const subVM = sub ? subs.find((s) => s.id === sub.agentId) : undefined;
    const subEntries = useAtomValue(liveEntriesByIdAtom)[sub ? `sub:${sub.agentId}` : ""] ?? [];
    const entries = sub ? subEntries : liveEntries.length > 0 ? liveEntries : (agent.previousInfo ?? []);
    const lineage = useAtomValue(model.lineageAtom);
    const agents = useAtomValue(model.agentsAtom);
    const usage = agent.usage;
    const ctxPct = usage?.contextpct;
    const tools = toolChips(summarizeActions(recentActions(entries, 0)).byVerb);
    const railState = useAtomValue(railStateAtom);
    const cacheStatus = useAtomValue(agentCacheStatusAtom);
    const now = useAtomValue(model.nowAtom);
    const role = lineage.roles[agent.id];
    const roleRun = role ? lineage.runs[roleRunId(role)] : undefined;
    const asks = useRunAsks(roleRun);
    const yours = asks.filter(
        (a) =>
            a.owner === ASK_OWNER_USER &&
            (role?.kind === "lead" || (role?.kind === "worker" && a.taskid === role.taskId))
    );
    const endedWorker = useAtomValue(model.endedWorkerAtom);
    const ended = endedWorker?.agent.id === agent.id ? endedWorker : undefined;
    const artifacts = artifactsView(useAtomValue(canvasStateAtom(agent.id)));

    useEffect(() => {
        fireAndForget(() => loadRailForAgent(agent.id, agent.transcriptPath, agent.blockId));
    }, [agent.id, agent.transcriptPath, agent.blockId]);

    // re-read while focused: every turn writes the cache again, so a status read once at focus
    // counts down to "expired" under an agent that is still working
    useEffect(() => {
        fireAndForget(() => loadCacheStatusForAgent(agent.id, agent.transcriptPath));
        const refresh = setInterval(() => {
            fireAndForget(() => loadCacheStatusForAgent(agent.id, agent.transcriptPath, { silent: true }));
        }, USAGE_REFRESH_MS);
        return () => clearInterval(refresh);
    }, [agent.id, agent.transcriptPath]);

    // token usage follows the transcript in view: a subagent's own while its interior is open
    const usageId = sub ? `sub:${sub.agentId}` : agent.id;
    const usagePath = sub ? sub.transcriptPath : agent.transcriptPath;
    useEffect(() => {
        fireAndForget(() => loadSessionUsage(usageId, usagePath));
        const refresh = setInterval(() => {
            fireAndForget(() => loadSessionUsage(usageId, usagePath, { silent: true }));
        }, USAGE_REFRESH_MS);
        return () => clearInterval(refresh);
    }, [usageId, usagePath]);

    const changes = railState?.changes?.files ?? [];
    const { shown: shownFiles } = capFiles(changes, RailFilesCap);

    // A path is only worth linking when the rail resolved a working directory to resolve it against.
    const openFileDiff = (path?: string) => {
        globalStore.set(model.focusIdAtom, agent.id);
        openDiff(model, agentDiffScope(agent.id, agent.name), railState?.cwd && path ? path : undefined);
    };
    const drive = (data: string) => driveAgent(agent.blockId, data);
    // a board's row opens the agent's canvas on that board alone (its own tab, not the All view)
    const openArtifact = (board: string) => {
        selectCanvasTab(agent.id, board);
        setCanvasMode(agent.id, "canvas", Date.now());
    };

    const age = formatAgeShort(displayAgeMs(agent, now));
    const isClaude = (agent.agent || "claude") === "claude";
    // "—" is a cache nobody has read yet; the line leaves it out rather than say so
    const cacheCountdown = isClaude ? formatCacheCountdown(cacheStatus, now) : "—";
    const branch = ended ? ended.branch : railState?.branch;
    const worktree = ended ? undefined : railState?.worktree;
    const live = agent.blockId != null && !ended;
    const action = sub ? null : railAction(agent.state, age, live);
    const offerReset =
        ctxPct != null &&
        offersContextReset({ isClaude, state: agent.state, level: contextLevel(ctxPct, usage?.contextmax), live });

    const fileCount = ended ? ended.files.length : railState?.isRepo ? changes.length : null;
    const plan = planAgentRail({
        inSubagent: sub != null,
        needsYou: !sub && roleRun && role?.kind === "lead" ? yours.length : 0,
        subagents: subs.length,
        files: fileCount,
        artifacts: artifacts.rows.length,
        uploads: 0, // no upload records exist yet; the Uploads work feeds this
        bgTasks: bgTasks.length,
        terminals: 0,
        terminalsOther: 0,
        tools: tools.length,
        hasRun: role != null && roleRun != null,
    });
    const LABEL: Record<AgentRailSectionId, string> = {
        subagent: "Subagent",
        needs: "Needs you",
        subagents: "Subagents",
        files: "Files changed",
        artifacts: "Artifacts",
        uploads: "Uploads",
        bgtasks: "Background tasks",
        terminals: "Terminals",
        tools: "Tools used",
        run: role?.kind === "worker" ? "Task" : "Run",
        details: "Details",
        usage: "Token usage",
    };
    const ICON: Record<AgentRailSectionId, ReactNode> = {
        subagent: RAIL_ICON.subagents,
        needs: RAIL_ICON.bell,
        subagents: RAIL_ICON.subagents,
        files: RAIL_ICON.files,
        artifacts: RAIL_ICON.artifacts,
        uploads: RAIL_ICON.attach,
        bgtasks: RAIL_ICON.terminal,
        terminals: RAIL_ICON.terminal,
        tools: RAIL_ICON.tools,
        run: RAIL_ICON.autonomy,
        details: RAIL_ICON.info,
        usage: RAIL_ICON.usage,
    };
    // thunks: a section the plan leaves out is never built (run would touch a roleRun that may not exist)
    const CONTENT: Record<AgentRailSectionId, () => ReactNode> = {
        subagent: () => (
            <div className="flex flex-col gap-[6px]">
                <SubLabel>Subagent of {agent.name}</SubLabel>
                <div className="flex items-center gap-[8px]">
                    <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full"
                        style={{ background: SUB_COLOR[subVM?.state ?? "done"] }}
                    />
                    <span className="min-w-0 truncate text-[14px] font-semibold text-primary">{sub?.label}</span>
                    {subVM ? (
                        <span className="ml-auto text-[10.5px] font-semibold" style={{ color: SUB_COLOR[subVM.state] }}>
                            {subVM.state === "failure" ? "failed" : subVM.state}
                        </span>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={() => globalStore.set(focusSubagentAtom, null)}
                    className="-ml-[6px] inline-flex w-fit cursor-pointer items-center gap-[4px] rounded-[7px] px-[6px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
                >
                    <ArrowLeft size={11} aria-hidden />
                    back to {agent.name}
                </button>
            </div>
        ),
        // only the lead's rail: a worker's own question is already on screen, in its terminal's picker
        needs: () => <NeedsYouSection key={agent.id} model={model} run={roleRun!} asks={yours} />,
        subagents: () => (
            <div className="flex flex-col gap-[7px]">
                {subs.map((s) => {
                    const path = s.transcriptPath;
                    return (
                        <div
                            key={s.id}
                            onClick={
                                path
                                    ? () =>
                                          globalStore.set(focusSubagentAtom, {
                                              parentId: agent.id,
                                              agentId: s.id,
                                              transcriptPath: path,
                                              label: s.type || "subagent",
                                          })
                                    : undefined
                            }
                            className={cn(
                                "flex items-center gap-[10px] rounded-[10px] border border-border bg-surface px-[11px] py-[9px]",
                                path && "cursor-pointer hover:border-edge-strong"
                            )}
                        >
                            <span
                                className="h-[6px] w-[6px] shrink-0 rounded-full"
                                style={{ background: SUB_COLOR[s.state] }}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[11.5px] font-semibold text-secondary">
                                    {s.type || "subagent"}
                                </div>
                                <div className="truncate font-mono text-[10.5px] text-muted">{s.model ?? ""}</div>
                            </div>
                            <span
                                className="whitespace-nowrap text-[10.5px] font-semibold"
                                style={{ color: SUB_COLOR[s.state] }}
                            >
                                {s.state === "failure" ? "failed" : s.state}
                            </span>
                        </div>
                    );
                })}
            </div>
        ),
        files: () =>
            ended ? (
                <SealedFiles files={ended.files} />
            ) : railState == null ? (
                <div aria-hidden="true" className="flex flex-col gap-2">
                    {["w-[80%]", "w-[60%]", "w-[70%]"].map((w, i) => (
                        <SkeletonLine key={i} className={cn("h-[10px]", w)} />
                    ))}
                </div>
            ) : !railState.isRepo ? (
                <div className="text-[11.5px] text-muted">Not a git repository</div>
            ) : shownFiles.length === 0 ? (
                <div className="text-[11.5px] text-muted">No changes</div>
            ) : (
                <>
                    <div className="flex flex-col gap-[7px]">
                        {shownFiles.map((f) => (
                            <FileRow
                                key={f.path}
                                status={f.status}
                                path={f.path}
                                adds={f.adds}
                                dels={f.dels}
                                onClick={() => openFileDiff(f.path)}
                            />
                        ))}
                    </div>
                    <div className="mt-[8px] flex items-center gap-[10px] text-[10.5px] tabular-nums">
                        <span className="text-muted">{filesSummary(changes)}</span>
                        <span className="flex-1" />
                        <button
                            type="button"
                            onClick={() => openFileDiff()}
                            className="inline-flex cursor-pointer items-center gap-[3px] rounded-[7px] px-[6px] py-[3px] font-semibold text-accent-soft hover:bg-surface-hover"
                        >
                            View diff
                            <ArrowUpRight size={11} aria-hidden />
                        </button>
                    </div>
                </>
            ),
        artifacts: () => (
            <div className="flex flex-col gap-[7px]">
                <div className="flex min-w-0 items-center gap-[6px]">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted">
                        {artifacts.topic}
                    </span>
                    {artifacts.unseen ? (
                        <span
                            aria-label="updated since you last looked"
                            className="h-[5px] w-[5px] shrink-0 rounded-full bg-accent"
                        />
                    ) : null}
                </div>
                {artifacts.rows.map((r) => (
                    <button
                        key={r.name}
                        type="button"
                        title={r.title}
                        onClick={() => openArtifact(r.name)}
                        className={cn(RAIL_ROW, RAIL_ROW_ACTION)}
                    >
                        <LayoutTemplate size={13} aria-hidden className="shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    </button>
                ))}
            </div>
        ),
        uploads: () => null,
        bgtasks: () => (
            <div className="flex flex-col gap-[7px]">
                {bgTasks.map((t) => (
                    <BackgroundTaskRow key={t.toolUseId} task={t} live={live} />
                ))}
            </div>
        ),
        terminals: () => null,
        tools: () => (
            <div className="flex flex-wrap gap-[7px]">
                {tools.map((t) => (
                    <span
                        key={t.verb}
                        className="flex items-baseline gap-[5px] rounded-sm border border-edge-mid bg-surface-raised px-[9px] py-[4px] text-[11px] font-medium tabular-nums"
                    >
                        <span className={t.dim ? "text-muted" : "text-secondary"}>{t.verb}</span>
                        <span className="text-[10.5px] text-muted">×{t.count}</span>
                    </span>
                ))}
            </div>
        ),
        run: () =>
            role?.kind === "worker" ? (
                <TaskSection key={agent.id} model={model} run={roleRun!} taskId={role.taskId} asks={asks} />
            ) : (
                <RunSection key={agent.id} model={model} run={roleRun!} asks={asks} />
            ),
        details: () => (
            <div className="flex flex-col gap-[6px]">
                {sub ? (
                    <>
                        <DetailLine label="Model">{subVM?.model ? prettyModel(subVM.model) : "—"}</DetailLine>
                        <DetailLine label="Session">
                            {subVM == null ? "—" : subVM.state === "failure" ? "failed" : subVM.state}
                        </DetailLine>
                    </>
                ) : (
                    <>
                        <DetailLine label="Project">{agentProject(lineage, agents, agent) || "—"}</DetailLine>
                        <DetailLine label="Branch" title={branch || undefined}>
                            <span className="font-mono">{branch || "—"}</span>
                        </DetailLine>
                        {worktree ? (
                            <DetailLine label="Worktree" title={railState?.cwd ?? undefined} clipStart>
                                <span className="font-mono">{worktree}</span>
                            </DetailLine>
                        ) : null}
                        <DetailLine
                            label="Session"
                            title={cacheCountdown !== "—" ? cacheRewriteTitle(ctxPct, usage?.contextmax) : undefined}
                        >
                            {ended ? (
                                <>ended {age} ago</>
                            ) : (
                                <>
                                    {agent.state} {age}
                                </>
                            )}
                            {cacheCountdown !== "—" ? (
                                <>
                                    <span className="text-muted"> · </span>
                                    cache {cacheCountdown}
                                </>
                            ) : null}
                        </DetailLine>
                        {ctxPct != null ? (
                            <ContextLine
                                pct={ctxPct}
                                max={usage?.contextmax}
                                onReset={offerReset ? drive : undefined}
                            />
                        ) : null}
                    </>
                )}
            </div>
        ),
        usage: () => <TokenUsageSection />,
    };
    const sections: RailSection[] = plan.map((p) => ({
        id: p.id,
        label: LABEL[p.id],
        icon: ICON[p.id],
        header: p.header,
        content: CONTENT[p.id](),
    }));

    const stripTitle = [
        "Agent details",
        ctxPct != null ? `context ${Math.round(ctxPct)}%` : "",
        yours.length > 0 ? `${yours.length} waiting on you` : "",
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <CollapsibleRail
            openAtom={railVisibleAtom}
            ariaLabel="Agent details"
            sections={sections}
            strip={{
                content: (
                    <RailStrip needs={yours.length} ctxPct={sub ? undefined : ctxPct} ctxMax={usage?.contextmax} />
                ),
                title: `${stripTitle} (${formatChordString("d")})`,
            }}
            footer={
                action ? (
                    <div className="flex items-center gap-[10px]">
                        <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">{action.hint}</span>
                        {action.kind === "resume" ? (
                            <button
                                type="button"
                                onClick={() => drive(NUDGE_INPUT)}
                                title="nudge the agent to continue from idle"
                                className="flex-none cursor-pointer rounded-[6px] border border-accent/45 bg-accent/10 px-[16px] py-[7px] text-[12px] font-medium text-accent-soft hover:bg-accent/[0.18]"
                            >
                                Resume
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => drive("\x1b")}
                                title="interrupt the current turn"
                                className="flex-none cursor-pointer rounded-[6px] border border-error/30 bg-transparent px-[16px] py-[7px] text-[12px] font-medium text-error hover:bg-error/10"
                            >
                                Stop
                            </button>
                        )}
                    </div>
                ) : undefined
            }
        />
    );
}
