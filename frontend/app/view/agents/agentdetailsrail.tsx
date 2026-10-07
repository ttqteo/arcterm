// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CollapsibleRail, type RailSection } from "@/app/element/collapsiblerail";
import { easeFluidCss, MOTION, popoverReveal } from "@/app/element/motiontokens";
import { railSectionOpenAtom } from "@/app/element/railsections";
import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowLeft, ArrowUpRight, ChevronLeft, FileText, LayoutList, LayoutTemplate } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { driveAgent, NUDGE_INPUT } from "./agentactions";
import { agentDiffScope, openDiff } from "./agentdiffnav";
import {
    cacheRewriteTitle,
    contextLevel,
    contextNote,
    contextTokens,
    filesSummary,
    offersContextReset,
    railAction,
    railStatusLine,
    toolChips,
} from "./agentrailmodel";
import { RailResizeGrip, RailStats, RailTabStrip, useWideWidth } from "./agentrailpanel";
import {
    bgTaskStatusLabel,
    planAgentRail,
    planRailStats,
    type AgentRailSectionId,
    type BgTaskLabel,
} from "./agentrailsections";
import { openFileInPanel, railPanelsAtom, railTabDefaultAtom, selectRailTab } from "./agentrailstore";
import { fileLabel, panelFor, RAIL_OVERVIEW_PX } from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import { displayAgeMs, formatAgeShort, recentActions, summarizeActions, type AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import { agentCacheStatusAtom, formatCacheCountdown, loadCacheStatusForAgent } from "./cachestatusstore";
import { canvasStateAtom, selectCanvasTab } from "./canvasstore";
import { ASK_OWNER_USER } from "./childaskmodel";
import { FileTab } from "./filetab";
import { capFiles, statusColor } from "./gitstatus";
import { entriesAtomFor, liveEntriesByIdAtom } from "./livetranscriptatoms";
import { prettyModel } from "./modellabel";
import { artifactsView } from "./railartifacts";
import { RAIL_ICON } from "./railicons";
import { RAIL_ROW, RAIL_ROW_ACTION } from "./railrow";
import { loadRailForAgent, railStateAtom, railVisibleAtom } from "./railstore";
import { UploadsSection } from "./railuploads";
import { agentProject, roleRunId } from "./runlineage";
import { NeedsYouSection, RunSection, TaskSection, useRunAsks } from "./runrailsections";
import { SubLabel } from "./sectionlabel";
import type { SubagentState } from "./session-models/sessionviewmodel";
import { spendHeadline } from "./sessionusage";
import { StatusDot } from "./statusdot";
import { backgroundTasksByIdAtom, focusSubagentAtom, subagentsByIdAtom } from "./subagentsstore";
import { TokenUsageSection } from "./tokenusagesection";
import type { BackgroundTask } from "./transcriptprojection";
import { loadSessionUsage, sessionUsageAtom, UsageUnavailable } from "./transcriptusagestore";
import { pickAndAttach } from "./uploadsingest";
import { uploadsAtom } from "./uploadsstore";
import { fmt } from "./usagestats";

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

const RING_R = 6;
const RING_C = 2 * Math.PI * RING_R;

// ContextRing is the context window as a 16px ring, filled clockwise from the top in its level's color
function ContextRing({ pct, level }: { pct: number; level: "ok" | "warn" | "hot" }) {
    const reduce = useReducedMotion();
    const filled = Math.min(100, Math.max(0, pct)) / 100;
    return (
        <svg
            width={16}
            height={16}
            viewBox="0 0 16 16"
            aria-hidden
            className={cn("shrink-0 -rotate-90", GAUGE_TEXT[level])}
        >
            <circle cx={8} cy={8} r={RING_R} fill="none" strokeWidth={2.5} className="stroke-border" />
            <circle
                cx={8}
                cy={8}
                r={RING_R}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - filled)}
                style={{ transition: reduce ? undefined : `stroke-dashoffset ${MOTION.durMacro}s ${easeFluidCss}` }}
            />
        </svg>
    );
}

// StatusLine is the rail's first row: the context window (ring, percent and the tokens in it) on the left, the
// session's spend on the right, opening Token usage. The context's note is its tooltip. onReset, when given, offers
// Compact and Clear under the row: they shrink what every turn re-reads.
function StatusLine({
    ctx,
    spend,
    onReset,
    onSpend,
}: {
    ctx?: { pct: number; max?: number };
    spend?: { text: string; title: string };
    onReset?: (cmd: string) => void;
    onSpend: () => void;
}) {
    if (ctx == null && spend == null) {
        return null;
    }
    const level = ctx ? contextLevel(ctx.pct, ctx.max) : "ok";
    const tokens = ctx ? contextTokens(ctx.pct, ctx.max) : undefined;
    const note = ctx ? contextNote(ctx.pct, ctx.max) : "";
    return (
        <div data-rail-status className="flex flex-col gap-[3px] pb-[8px] pt-[2px]">
            <div className="flex min-w-0 items-center gap-[8px]">
                {ctx ? (
                    <span
                        title={`Context window ${Math.round(ctx.pct)}%${note ? ` · ${note}` : ""}`}
                        className="flex min-w-0 items-center gap-[7px]"
                    >
                        <ContextRing pct={ctx.pct} level={level} />
                        <span className={cn("text-[12px] font-semibold tabular-nums", GAUGE_TEXT[level])}>
                            {Math.round(ctx.pct)}%
                        </span>
                        {tokens ? (
                            <span className="truncate text-[11px] tabular-nums text-muted">· {tokens}</span>
                        ) : null}
                    </span>
                ) : null}
                <span className="flex-1" />
                {spend ? (
                    <button
                        type="button"
                        onClick={onSpend}
                        title={spend.title}
                        className="-mr-[6px] flex-none cursor-pointer rounded-[6px] px-[6px] py-[2px] text-[12px] font-semibold tabular-nums text-success hover:bg-surface-hover"
                    >
                        {spend.text}
                    </button>
                ) : null}
            </div>
            {onReset ? (
                <div className="flex gap-[4px] pl-[17px]">
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
        </div>
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
            <span className="min-w-0 flex-1 truncate">{path}</span>
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

// A background command: what it is for, the command itself under it, and its status. With an output file it opens
// that file in the panel's File tab with its Live toggle, following the output while the task runs.
function BackgroundTaskRow({ task, live, onOpen }: { task: BackgroundTask; live: boolean; onOpen?: () => void }) {
    const label = bgTaskStatusLabel(task.status, live);
    const showCommand = task.command != null && task.command !== task.label;
    const body = (
        <>
            <span className={cn("mt-[5px] h-[6px] w-[6px] shrink-0 self-start rounded-full", BG_DOT[label])} />
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="truncate text-[11.5px] text-secondary">{task.label}</span>
                {showCommand ? (
                    <span className="truncate font-mono text-[10.5px] text-muted">{task.command}</span>
                ) : null}
            </span>
            <span className="self-start whitespace-nowrap text-[10.5px] text-muted">{label}</span>
        </>
    );
    const cls = "flex w-full items-center gap-[10px] rounded-[8px] bg-surface-raised px-[11px] py-[8px] text-left";
    if (onOpen == null) {
        return (
            <div title={task.command} data-bg-task={task.toolUseId} className={cls}>
                {body}
            </div>
        );
    }
    return (
        <button
            type="button"
            data-bg-task={task.toolUseId}
            title={`${task.command ?? task.label}\n\nOpen its output`}
            onClick={onOpen}
            className={cn(cls, "cursor-pointer hover:bg-surface-hover")}
        >
            {body}
        </button>
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
    // an agent's uploads are keyed by its terminal block (uploadsstore.ts); one with no terminal has none
    const uploads = useAtomValue(uploadsAtom(agent.blockId ?? ""));
    const cacheStatus = useAtomValue(agentCacheStatusAtom);
    const sessionUsage = useAtomValue(sessionUsageAtom);
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
    const panels = useAtomValue(railPanelsAtom);
    const defaultTab = useAtomValue(railTabDefaultAtom);
    const panel = panelFor(panels, agent.id, defaultTab);
    const wide = useWideWidth();
    const fileRef = panel.file.current;
    const showRail = () => globalStore.set(railVisibleAtom, true);

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
        setAgentView(agent.id, "canvas", Date.now());
    };

    const age = formatAgeShort(displayAgeMs(agent, now));
    const isClaude = (agent.agent || "claude") === "claude";
    // "—" is a cache nobody has read yet; the line leaves it out rather than say so
    const cacheCountdown = isClaude ? formatCacheCountdown(cacheStatus, now) : "—";
    const branch = ended ? ended.branch : railState?.branch;
    const worktree = ended ? undefined : railState?.worktree;
    const live = agent.blockId != null && !ended;
    const action = sub ? null : railAction(agent.state, live);
    const offerReset =
        ctxPct != null &&
        offersContextReset({ isClaude, state: agent.state, level: contextLevel(ctxPct, usage?.contextmax), live });

    const fileCount = ended ? ended.files.length : railState?.isRepo ? changes.length : null;
    const railInput = {
        inSubagent: sub != null,
        needsYou: !sub && roleRun && role?.kind === "lead" ? yours.length : 0,
        subagents: subs.length,
        files: fileCount,
        artifacts: artifacts.rows.length,
        uploads: uploads.length,
        bgTasks: bgTasks.length,
        hasRun: role != null && roleRun != null,
    };
    const plan = planAgentRail(railInput);
    const usageLoaded = sessionUsage != null && sessionUsage !== UsageUnavailable ? sessionUsage : null;
    const spend =
        usageLoaded && usageLoaded.totalTokens > 0
            ? (() => {
                  const h = spendHeadline(usageLoaded);
                  return { text: h.text, title: `${h.caption} · ${fmt(usageLoaded.totalTokens)} tokens` };
              })()
            : undefined;
    // the transcript's own models when its usage is read, else the roster's family label
    const modelLabel =
        usageLoaded && usageLoaded.models.length > 0
            ? usageLoaded.models.map((m) => prettyModel(m.model)).join(", ")
            : agent.model
              ? prettyModel(agent.model)
              : "";
    const project = agentProject(lineage, agents, agent);

    // a strip count, or the spend, opens its section on Overview: open it, then bring it into view once it has rendered
    const openSection = (id: AgentRailSectionId) => {
        selectRailTab(agent.id, "overview");
        showRail();
        globalStore.set(railSectionOpenAtom, (prev) => ({ ...prev, [id]: true }));
        requestAnimationFrame(() => {
            const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            document
                .querySelector(`aside[aria-label="Agent details"] [data-rail-section="${id}"]`)
                ?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
        });
    };
    const LABEL: Record<AgentRailSectionId, string> = {
        subagent: "Subagent",
        status: "Status",
        needs: "Needs you",
        subagents: "Subagents",
        files: "Files changed",
        artifacts: "Artifacts",
        uploads: "Uploads",
        bgtasks: "Background tasks",
        run: role?.kind === "worker" ? "Task" : "Run",
        details: "Details",
        usage: "Token usage",
    };
    const ICON: Record<AgentRailSectionId, ReactNode> = {
        subagent: RAIL_ICON.subagents,
        status: RAIL_ICON.context,
        needs: RAIL_ICON.bell,
        subagents: RAIL_ICON.subagents,
        files: RAIL_ICON.files,
        artifacts: RAIL_ICON.artifacts,
        uploads: RAIL_ICON.attach,
        bgtasks: RAIL_ICON.terminal,
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
        status: () => (
            <StatusLine
                ctx={!sub && ctxPct != null ? { pct: ctxPct, max: usage?.contextmax } : undefined}
                spend={spend}
                onReset={offerReset ? drive : undefined}
                onSpend={() => openSection("usage")}
            />
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
                                <div className="truncate text-[10.5px] text-muted">{s.model ?? ""}</div>
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
                    <span
                        title={artifacts.topic}
                        className="min-w-0 flex-1 truncate text-[10.5px] text-muted"
                    >
                        {artifacts.topic}
                    </span>
                    {artifacts.unseen ? (
                        <span
                            role="img"
                            aria-label="updated since you last looked"
                            className="h-[5px] w-[5px] shrink-0 rounded-full bg-accent"
                        />
                    ) : null}
                </div>
                {artifacts.rows.map((r, i) => (
                    <button
                        key={`${r.name}:${i}`}
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
        uploads: () => <UploadsSection agent={agent} now={now} />,
        bgtasks: () => (
            <div className="flex flex-col gap-[7px]">
                {bgTasks.map((t) => (
                    <BackgroundTaskRow
                        key={t.toolUseId}
                        task={t}
                        live={live}
                        onOpen={
                            t.outputFile != null
                                ? () =>
                                      openFileInPanel(model, agent.id, {
                                          abs: t.outputFile!,
                                          root: null,
                                          reread: Date.now(),
                                          live: bgTaskStatusLabel(t.status, live) === "running" ? "on" : "off",
                                      })
                                : undefined
                        }
                    />
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
                        <DetailLine label="Project">{project || "—"}</DetailLine>
                        <DetailLine label="Branch" title={branch || undefined}>
                            <span>{branch || "—"}</span>
                        </DetailLine>
                        {worktree ? (
                            <DetailLine label="Worktree" title={railState?.cwd ?? undefined} clipStart>
                                <span>{worktree}</span>
                            </DetailLine>
                        ) : null}
                        {modelLabel ? <DetailLine label="Model">{modelLabel}</DetailLine> : null}
                    </>
                )}
                {tools.length > 0 ? (
                    <div className="flex min-w-0 items-baseline gap-[10px]">
                        <span className="w-[52px] shrink-0 text-[12px] text-muted">Tools</span>
                        <div className="flex min-w-0 flex-1 flex-wrap gap-[5px]">
                            {tools.map((t) => (
                                <span
                                    key={t.verb}
                                    className="flex items-baseline gap-[4px] rounded-sm border border-edge-mid bg-surface-raised px-[6px] py-[1px] text-[10.5px] font-medium tabular-nums"
                                >
                                    <span className={t.dim ? "text-muted" : "text-secondary"}>{t.verb}</span>
                                    <span className="text-muted">×{t.count}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        ),
        usage: () => <TokenUsageSection />,
    };
    // closed, Details reads as where the agent works: its project and branch, or a subagent's model
    const detailsSummary = sub
        ? subVM?.model
            ? prettyModel(subVM.model)
            : ""
        : [project, branch].filter(Boolean).join(" · ");
    const sections: RailSection[] = plan.map((p) => ({
        id: p.id,
        label: LABEL[p.id],
        icon: ICON[p.id],
        header: p.id === "details" && p.header ? { ...p.header, summary: detailsSummary || undefined } : p.header,
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
            width={panel.tab === "overview" ? RAIL_OVERVIEW_PX : wide.width}
            tabs={
                <>
                    <RailTabStrip agentId={agent.id} panel={panel} />
                    <RailStats
                        stats={planRailStats(railInput)}
                        canAttach={agent.blockId != null}
                        onOpen={openSection}
                        onAttach={() => {
                            if (agent.blockId) {
                                fireAndForget(() => pickAndAttach(agent.blockId!));
                            }
                        }}
                    />
                </>
            }
            body={
                panel.tab === "file" && fileRef != null ? (
                    <FileTab model={model} agent={agent} file={panel.file} />
                ) : undefined
            }
            edge={panel.tab !== "overview" ? <RailResizeGrip width={wide.width} max={wide.max} /> : undefined}
            stripTabs={[
                {
                    key: "overview",
                    icon: <LayoutList size={17} strokeWidth={1.8} aria-hidden />,
                    ariaLabel: "Overview",
                    onClick: () => {
                        selectRailTab(agent.id, "overview");
                        showRail();
                    },
                },
                ...(fileRef != null
                    ? [
                          {
                              key: "file",
                              icon: <FileText size={17} strokeWidth={1.8} aria-hidden />,
                              ariaLabel: `File ${fileLabel(fileRef).name}`,
                              onClick: () => {
                                  selectRailTab(agent.id, "file");
                                  showRail();
                              },
                          },
                      ]
                    : []),
            ]}
            strip={{
                content: (
                    <RailStrip needs={yours.length} ctxPct={sub ? undefined : ctxPct} ctxMax={usage?.contextmax} />
                ),
                title: `${stripTitle} (${formatChordString("d")})`,
            }}
            footer={
                sub ? undefined : (
                    <div className="flex items-center gap-[9px]">
                        <StatusDot state={ended ? "idle" : agent.state} />
                        <span
                            title={cacheCountdown !== "—" ? cacheRewriteTitle(ctxPct, usage?.contextmax) : undefined}
                            className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-muted"
                        >
                            {railStatusLine({ state: agent.state, age, ended: ended != null, cache: cacheCountdown })}
                        </span>
                        {action?.kind === "resume" ? (
                            <button
                                type="button"
                                onClick={() => drive(NUDGE_INPUT)}
                                title="nudge the agent to continue from idle"
                                className="flex-none cursor-pointer rounded-[6px] border border-accent/45 bg-accent/10 px-[14px] py-[5px] text-[12px] font-medium text-accent-soft hover:bg-accent/[0.18]"
                            >
                                Resume
                            </button>
                        ) : action?.kind === "stop" ? (
                            <button
                                type="button"
                                onClick={() => drive("\x1b")}
                                title="interrupt the current turn (Esc in the terminal also stops)"
                                className="flex-none cursor-pointer rounded-[6px] border border-error/30 bg-transparent px-[14px] py-[5px] text-[12px] font-medium text-error hover:bg-error/10"
                            >
                                Stop
                            </button>
                        ) : null}
                    </div>
                )
            }
        />
    );
}
