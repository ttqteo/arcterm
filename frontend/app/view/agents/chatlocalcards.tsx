// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cards Chat draws for a bare /usage, /context, /tasks, /stats, /skills, /help or /status (chatlocal.ts): what
// Claude Code shows in a panel on its own screen, drawn from what the cockpit already keeps, live. Each says it was
// drawn here and not sent, and offers the real panel in the Terminal (it sends the command there and shows that screen).

import { Meter } from "@/app/element/meter";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { Eye, SquareTerminal, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { submitToAgent } from "./agentsubmit";
import { formatAgeShort, formatAgo, formatReset, formatTokens, usageLevel, type AgentVM } from "./agentsviewmodel";
import { contextWarn } from "./chatfootermodel";
import { replaceChatBox } from "./chatinsert";
import { contextFigures, formatUsd, sessionIdOf, taskGroups, type LocalCard } from "./chatlocal";
import { setChatMode } from "./chatmodestore";
import { usageBarVisible } from "./cockpitrailmodel";
import { backgroundTaskKind, backgroundTaskSubline } from "./monitortasks";
import { planWindows } from "./ratelimitstore";
import type { SubagentVM } from "./session-models/sessionviewmodel";
import { groupOf, slashGroups, type SlashCommand } from "./slashcommands";
import { fetchSlashCommands } from "./slashmenu";
import {
    backgroundTasksByIdAtom,
    focusSubagentAtom,
    monitorPeekAtom,
    refreshSubagents,
    stopBackgroundTask,
    subagentsByIdAtom,
} from "./subagentsstore";
import type { BackgroundTask } from "./transcriptprojection";
import { usePlanDonuts } from "./usagemeters";
import { allUsageStatsAtom, loadUsage, usageErrorAtom, usageLoadedAtom } from "./usagestore";

const NO_BLOCK: Atom<Block | undefined> = atom(undefined as Block | undefined);

// neutral while ok, as the app bar's meters: amber and red are the signal
const LEVEL_FILL: Record<"ok" | "warn" | "hot", string> = { ok: "bg-muted", warn: "bg-warning", hot: "bg-error" };
const LEVEL_TEXT: Record<"ok" | "warn" | "hot", string> = {
    ok: "text-primary",
    warn: "text-warning",
    hot: "text-error",
};

const LINK = "cursor-pointer text-[11.5px] text-secondary hover:text-primary";

function useBlockCwd(agent: AgentVM): string {
    const block = useAtomValue(
        agent.blockId ? WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", agent.blockId)) : NO_BLOCK
    );
    return block?.meta?.["cmd:cwd"] ?? agent.cwd ?? "";
}

function CardFrame({
    card,
    title,
    onClose,
    onTerminal,
    actions,
    children,
}: {
    card: LocalCard;
    title: string;
    onClose: () => void;
    /** the real panel: absent while the agent sleeps (it has no screen to show it on) */
    onTerminal?: () => void;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section
            data-chat-local={card.panel}
            aria-label={title}
            className="flex flex-col overflow-hidden rounded-[12px] border border-edge-mid bg-surface-raised"
        >
            <header className="flex items-center gap-2 border-b border-edge-faint py-[7px] pl-[14px] pr-[8px]">
                <span className="font-mono text-[12.5px] text-primary">{card.command}</span>
                <span className="text-[13px] font-medium text-primary">{title}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted">shown by arcterm · not sent</span>
                <button
                    type="button"
                    aria-label="Close"
                    title="Close"
                    onClick={onClose}
                    className="flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline focus-visible:outline-accent"
                >
                    <X size={13} strokeWidth={2} aria-hidden />
                </button>
            </header>
            <div className="flex flex-col gap-3 px-[14px] py-[10px]">{children}</div>
            {actions != null || onTerminal != null ? (
                <footer className="flex items-center gap-4 border-t border-edge-faint px-[14px] py-[7px]">
                    {actions}
                    <span className="flex-1" />
                    {onTerminal != null ? (
                        <button
                            type="button"
                            data-chat-local-terminal
                            onClick={onTerminal}
                            title={`Send ${card.command} to Claude Code and show its own panel`}
                            className={LINK}
                        >
                            Open in Terminal
                        </button>
                    ) : null}
                </footer>
            ) : null}
        </section>
    );
}

// one labelled bar: "5-hour window ▓▓▓░ 42% · resets in 2h 11m"
function BarRow({ label, pct, level, note }: { label: string; pct: number; level?: boolean; note?: string | null }) {
    const lvl = level === false ? "ok" : usageLevel(pct);
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-[12.5px]">
                <span className="text-secondary">{label}</span>
                <span className="flex-1" />
                <span className={cn("tabular-nums font-medium", LEVEL_TEXT[lvl])}>{Math.round(pct)}%</span>
            </div>
            <Meter pct={pct} fill={LEVEL_FILL[lvl]} height={6} radius={3} />
            {note != null ? <span className="text-[11px] tabular-nums text-muted">{note}</span> : null}
        </div>
    );
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
    return (
        <div className="flex items-baseline gap-3 text-[12.5px]">
            <span className="w-[92px] flex-none text-muted">{label}</span>
            <span className={cn("min-w-0 text-ink-hi [overflow-wrap:anywhere]", mono && "font-mono text-[12px]")}>
                {children}
            </span>
        </div>
    );
}

function UsageBody({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const now = useAtomValue(model.nowAtom);
    const claude = usePlanDonuts(model).find((d) => d.provider === "claude");
    const stale = claude?.stale != null;
    const windows =
        claude == null
            ? []
            : planWindows(claude).filter((w) => usageBarVisible(w.w.pct, stale, w.w.reset) && w.w.pct != null);
    const usage = agent.usage;
    return (
        <>
            {windows.length > 0 ? (
                <div className="flex flex-col gap-2.5">
                    {windows.map((w) => (
                        <BarRow
                            key={w.key}
                            label={w.label}
                            pct={w.w.pct!}
                            note={w.w.reset != null ? `resets in ${formatReset(w.w.reset, now)}` : null}
                        />
                    ))}
                    {stale ? (
                        <span className="text-[11px] text-muted">
                            as of {formatAgo(now - claude!.stale!.capturedAt)}
                        </span>
                    ) : null}
                </div>
            ) : (
                <span className="text-[12.5px] text-muted">
                    No plan usage yet: Claude reports it after its first reply.
                </span>
            )}
            <div className="flex flex-col gap-1 border-t border-edge-faint pt-2.5">
                <Fact label="This session">{usage?.costusd != null ? formatUsd(usage.costusd) : "no cost yet"}</Fact>
                {usage?.contextpct != null ? <Fact label="Context">{Math.round(usage.contextpct)}% used</Fact> : null}
                {usage?.account ? <Fact label="Account">{usage.account}</Fact> : null}
            </div>
        </>
    );
}

function ContextBody({ agent }: { agent: AgentVM }) {
    const f = contextFigures(agent.usage);
    if (f == null) {
        return (
            <span className="text-[12.5px] text-muted">
                No context reading yet: it comes with Claude's first reply.
            </span>
        );
    }
    const warn = contextWarn(f.pct);
    return (
        <>
            <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2">
                    <span
                        className={cn("text-[20px] font-semibold tabular-nums", warn ? "text-warning" : "text-primary")}
                    >
                        {Math.round(f.pct)}%
                    </span>
                    <span className="text-[12.5px] tabular-nums text-secondary">
                        {f.used != null ? `${f.used} of ${f.max} tokens` : "of the context window"}
                    </span>
                </div>
                <Meter pct={f.pct} fill={warn ? "bg-warning" : "bg-muted"} height={8} radius={4} />
            </div>
            {f.left != null ? <Fact label="Left">{f.left} tokens</Fact> : null}
            {agent.model ? <Fact label="Model">{agent.model}</Fact> : null}
            {warn ? (
                <span className="text-[12px] text-warning">
                    Nearly full: compact soon, or Claude compacts on its own and loses detail.
                </span>
            ) : null}
            <span className="text-[11px] text-muted">
                The breakdown by part (tools, memory, messages) is in the Terminal.
            </span>
        </>
    );
}

function TaskRow({
    task,
    now,
    onStop,
    onPeek,
}: {
    task: BackgroundTask;
    now: number;
    onStop?: () => void;
    onPeek?: () => void;
}) {
    const monitor = backgroundTaskKind(task) === "monitor";
    const Icon = monitor ? Eye : SquareTerminal;
    const running = task.status === "running";
    return (
        <div data-chat-local-task className="flex items-center gap-2.5">
            <span className="relative flex h-4 w-4 flex-none items-center justify-center text-muted">
                <Icon size={13} strokeWidth={1.8} aria-hidden />
            </span>
            <button
                type="button"
                disabled={onPeek == null}
                onClick={onPeek}
                title={onPeek != null ? "Show its output" : undefined}
                className="flex min-w-0 flex-1 flex-col items-start text-left enabled:cursor-pointer enabled:hover:text-primary"
            >
                <span
                    className={cn("max-w-full truncate text-[12.5px] text-ink-hi", !monitor && "font-mono text-[12px]")}
                >
                    {task.label}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted">
                    {running ? (
                        <span className="h-[6px] w-[6px] rounded-full bg-working pulse-dot" aria-hidden />
                    ) : null}
                    {backgroundTaskSubline(task, now)}
                </span>
            </button>
            {running && onStop != null ? (
                <button type="button" onClick={onStop} className={cn(LINK, "flex-none")}>
                    Stop
                </button>
            ) : null}
        </div>
    );
}

const SUB_STATE: Record<SubagentVM["state"], { text: string; dot: string }> = {
    working: { text: "working", dot: "bg-working pulse-dot" },
    success: { text: "done", dot: "bg-success/45" },
    done: { text: "done", dot: "bg-success/45" },
    failure: { text: "failed", dot: "bg-error" },
};

function TasksBody({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const now = useAtomValue(model.nowAtom);
    const tasks = useAtomValue(backgroundTasksByIdAtom)[agent.id];
    const subs = useAtomValue(subagentsByIdAtom)[agent.id] ?? [];
    // read again on open: the tree refreshes on transcript activity, which a quiet agent has none of
    useEffect(() => {
        fireAndForget(() => refreshSubagents(agent.id, agent.transcriptPath));
    }, [agent.id, agent.transcriptPath]);
    const g = taskGroups(tasks);
    const live = agent.blockId != null && agent.sleeping == null;
    const stop = (t: BackgroundTask) =>
        live ? () => fireAndForget(() => stopBackgroundTask(agent.id, agent.blockId!, t)) : undefined;
    const peek = (t: BackgroundTask) =>
        t.taskId != null ? () => globalStore.set(monitorPeekAtom, { agentId: agent.id, taskId: t.taskId!, origin: "tree" }) : undefined;
    if (g.running.length === 0 && g.ended.length === 0 && subs.length === 0) {
        return <span className="text-[12.5px] text-muted">No background tasks or subagents in this session.</span>;
    }
    return (
        <>
            {g.running.length > 0 || g.ended.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-medium text-muted">
                        Background tasks{g.running.length > 0 ? ` · ${g.running.length} running` : ""}
                    </span>
                    {[...g.running, ...g.ended].map((t) => (
                        <TaskRow key={t.toolUseId} task={t} now={now} onStop={stop(t)} onPeek={peek(t)} />
                    ))}
                    {g.endedMore > 0 ? (
                        <span className="text-[11px] text-muted">and {g.endedMore} more ended</span>
                    ) : null}
                </div>
            ) : null}
            {subs.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-medium text-muted">Subagents</span>
                    {subs.map((s) => {
                        const st = SUB_STATE[s.state];
                        const open =
                            s.transcriptPath != null
                                ? () =>
                                      globalStore.set(focusSubagentAtom, {
                                          parentId: agent.id,
                                          agentId: s.id,
                                          transcriptPath: s.transcriptPath!,
                                          label: s.type,
                                      })
                                : undefined;
                        return (
                            <button
                                key={s.id}
                                type="button"
                                data-chat-local-subagent
                                disabled={open == null}
                                onClick={open}
                                title={open != null ? "Open its conversation" : undefined}
                                className="flex items-center gap-2.5 text-left enabled:cursor-pointer enabled:hover:text-primary"
                            >
                                <span className="flex h-4 w-4 flex-none items-center justify-center">
                                    <span className={cn("h-[7px] w-[7px] rounded-full", st.dot)} aria-hidden />
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-hi">{s.type}</span>
                                <span className="flex-none text-[11px] text-muted">
                                    {st.text}
                                    {s.model ? ` · ${s.model}` : ""}
                                </span>
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </>
    );
}

function StatsBody() {
    const loaded = useAtomValue(usageLoadedAtom);
    const failed = useAtomValue(usageErrorAtom);
    const stats = useAtomValue(allUsageStatsAtom);
    useEffect(() => {
        if (!globalStore.get(usageLoadedAtom)) {
            fireAndForget(() => loadUsage());
        }
    }, []);
    if (!loaded) {
        return <span className="text-[12.5px] text-muted">Reading your sessions…</span>;
    }
    const t = stats.totals;
    const top = stats.providers
        .flatMap((p) => p.models)
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 3);
    return (
        <>
            <div className="grid grid-cols-3 gap-3">
                <Figure label="Today" value={formatTokens(t.tokensToday)} sub="tokens" />
                <Figure label="Last 7 days" value={formatTokens(t.tokensWeek)} sub="tokens" />
                <Figure label="7-day spend" value={formatUsd(t.spendWeekUsd)} sub="at API prices" />
            </div>
            <Fact label="Active days">{t.activeDays}</Fact>
            {top.length > 0 ? (
                <Fact label="Top models">{top.map((m) => `${m.model} ${formatTokens(m.tokens)}`).join(" · ")}</Fact>
            ) : null}
            {failed ? (
                <span className="text-[11px] text-warning">Could not refresh: showing the last read.</span>
            ) : null}
        </>
    );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
    return (
        <div className="flex flex-col gap-0.5 rounded-[8px] bg-surface px-3 py-2">
            <span className="text-[11px] text-muted">{label}</span>
            <span className="text-[17px] font-semibold tabular-nums text-primary">{value}</span>
            <span className="text-[11px] text-muted">{sub}</span>
        </div>
    );
}

// /skills lists the skills and plugin commands; /help every command, by group. A pick puts it in the box.
function CommandsBody({ agent, skillsOnly }: { agent: AgentVM; skillsOnly: boolean }) {
    const cwd = useBlockCwd(agent);
    const [got, setGot] = useState<{ commands: SlashCommand[]; live: boolean } | null>(null);
    useEffect(() => {
        let stale = false;
        fetchSlashCommands(agent.blockId, cwd).then((r) => {
            if (!stale) {
                setGot(r);
            }
        });
        return () => {
            stale = true;
        };
    }, [agent.blockId, cwd]);
    if (got == null) {
        return <span className="text-[12.5px] text-muted">Reading the commands…</span>;
    }
    const shown = skillsOnly
        ? got.commands.filter((c) => groupOf(c) === "Skills" || groupOf(c) === "Plugins")
        : got.commands;
    const groups = slashGroups(shown);
    if (groups.length === 0) {
        return <span className="text-[12.5px] text-muted">No skills in this session.</span>;
    }
    return (
        <div className="flex max-h-[320px] flex-col gap-3 overflow-y-auto pr-1">
            {groups.map((g) => (
                <div key={g.title} className="flex flex-col gap-0.5">
                    <span className="pb-1 text-[11px] font-medium text-muted">
                        {g.title} · {g.items.length}
                    </span>
                    {g.items.map((c) => (
                        <button
                            key={c.name}
                            type="button"
                            data-chat-local-command={c.name}
                            onClick={() => replaceChatBox(agent.id, `/${c.name} `)}
                            title={`Put /${c.name} in the box`}
                            className="flex cursor-pointer items-baseline gap-3 rounded-[6px] px-1.5 py-[3px] text-left hover:bg-surface-hover"
                        >
                            <span className="flex-none font-mono text-[12px] text-primary">/{c.name}</span>
                            <span className="min-w-0 truncate text-[11.5px] text-muted">{c.description ?? ""}</span>
                        </button>
                    ))}
                </div>
            ))}
            {!got.live ? (
                <span className="text-[11px] text-muted">From disk: the session has not published its own list.</span>
            ) : null}
        </div>
    );
}

function StatusBody({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const now = useAtomValue(model.nowAtom);
    const cwd = useBlockCwd(agent);
    const session = sessionIdOf(agent.transcriptPath);
    const usage = agent.usage;
    const account = usage?.account || agent.loginEmail;
    return (
        <div className="flex flex-col gap-1">
            <Fact label="Agent">{agent.name}</Fact>
            {agent.model ? <Fact label="Model">{agent.model}</Fact> : null}
            {account ? <Fact label="Account">{account}</Fact> : null}
            {cwd ? <Fact label="Directory">{cwd}</Fact> : null}
            {session != null ? (
                <Fact label="Session" mono>
                    {session}
                </Fact>
            ) : null}
            <Fact label="State">
                {agent.sleeping != null
                    ? `asleep for ${formatAgeShort(now - agent.sleeping.since)}`
                    : agent.state === "working"
                      ? "working"
                      : agent.state === "asking"
                        ? "waiting on you"
                        : "idle"}
            </Fact>
            {usage?.contextpct != null ? <Fact label="Context">{Math.round(usage.contextpct)}% used</Fact> : null}
            {usage?.costusd != null ? <Fact label="Cost">{formatUsd(usage.costusd)}</Fact> : null}
        </div>
    );
}

const TITLES: Record<LocalCard["panel"], string> = {
    usage: "Usage",
    context: "Context",
    tasks: "Tasks",
    stats: "Stats",
    skills: "Skills",
    help: "Commands",
    status: "Status",
};

export function ChatLocalCard({
    model,
    agent,
    card,
    onClose,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    card: LocalCard;
    onClose: () => void;
}) {
    const blockId = agent.blockId;
    const awake = blockId != null && agent.sleeping == null;
    const onTerminal = awake
        ? () => {
              onClose();
              fireAndForget(() => submitToAgent(blockId, card.command));
              setChatMode(agent.id, "terminal");
          }
        : undefined;
    let body: ReactNode;
    let actions: ReactNode = null;
    switch (card.panel) {
        case "usage":
        case "stats":
            body = card.panel === "usage" ? <UsageBody model={model} agent={agent} /> : <StatsBody />;
            actions = (
                <button type="button" onClick={() => globalStore.set(model.surfaceAtom, "usage")} className={LINK}>
                    Open Usage
                </button>
            );
            break;
        case "context":
            body = <ContextBody agent={agent} />;
            actions = awake ? (
                <button
                    type="button"
                    onClick={() => {
                        onClose();
                        fireAndForget(() => submitToAgent(blockId, "/compact"));
                    }}
                    title="Send /compact: Claude summarizes the conversation so far to free context"
                    className={LINK}
                >
                    Compact now
                </button>
            ) : null;
            break;
        case "tasks":
            body = <TasksBody model={model} agent={agent} />;
            break;
        case "skills":
        case "help":
            body = <CommandsBody agent={agent} skillsOnly={card.panel === "skills"} />;
            break;
        case "status":
            body = <StatusBody model={model} agent={agent} />;
            break;
    }
    return (
        <CardFrame card={card} title={TITLES[card.panel]} onClose={onClose} onTerminal={onTerminal} actions={actions}>
            {body}
        </CardFrame>
    );
}
