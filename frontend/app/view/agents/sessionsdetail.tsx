// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Conversation History's right pane: a run (its lead and tasks, and the session of the one in view) or a single
// session, each read as its transcript or its lifecycle events. @theme tokens only.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ArrowLeft, Check } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { showTerminal } from "./agentcenter";
import { openDiff, projectDiffScope } from "./agentdiffnav";
import type { AgentsViewModel } from "./agents";
import type { AgentEntry } from "./agentsviewmodel";
import { formatAgeShort, formatTokens } from "./agentsviewmodel";
import { CompactTranscript } from "./compacttranscript";
import type { Runtime } from "./launch";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { activityAtomFor } from "./livetranscriptatoms";
import { runtimeMeta } from "./runtimemeta";
import type { LiveSession } from "./sessionsarchivestore";
import { LEAD_MEMBER, sessionPrimary, type RunMember, type RunView, type Status, type StatusKey } from "./sessionsruns";
import { atBottom } from "./transcriptfollow";
import { projectorFor } from "./transcriptregistry";
import { TranscriptSkeleton } from "./transcriptskeleton";

const STATUS_STYLE: Record<StatusKey, { color: string; mark: "pulse" | "dot" | "check" | "ring" | "none" }> = {
    running: { color: "var(--color-working)", mark: "pulse" },
    asking: { color: "var(--color-asking)", mark: "pulse" },
    review: { color: "var(--color-accent)", mark: "dot" },
    idle: { color: "var(--color-ink-mid)", mark: "dot" },
    pending: { color: "var(--color-muted)", mark: "ring" },
    done: { color: "var(--color-muted)", mark: "check" },
    failed: { color: "var(--color-error)", mark: "dot" },
    muted: { color: "var(--color-muted)", mark: "none" },
};

// landed recedes to grey so a running task never reads as finished
export const SEG_COLOR: Record<StatusKey, string> = {
    running: "var(--color-working)",
    asking: "var(--color-asking)",
    review: "var(--color-accent)",
    idle: "var(--color-ink-mid)",
    pending: "var(--color-edge-strong)",
    done: "var(--color-muted)",
    failed: "var(--color-error)",
    muted: "var(--color-edge-strong)",
};

const EVENT_COLOR: Record<string, string> = {
    started: "var(--color-success)",
    asked: "var(--color-asking)",
    committed: "var(--color-accent)",
    errored: "var(--color-error)",
    finished: "var(--color-muted)",
};
export function eventColor(t: string): string {
    return EVENT_COLOR[t] ?? "var(--color-muted)";
}

// the one status marker a row carries: a dot, a check or a ring, then its word
export function StatusMark({ status, className }: { status: Status; className?: string }) {
    const st = STATUS_STYLE[status.key];
    return (
        <span
            className={cn("inline-flex flex-none items-center gap-[5px] text-[10.5px] tabular-nums", className)}
            style={{ color: st.color }}
        >
            {st.mark === "pulse" || st.mark === "dot" ? (
                <span
                    className={cn("h-1.5 w-1.5 rounded-full", st.mark === "pulse" && "pulse-dot")}
                    style={{ backgroundColor: st.color }}
                />
            ) : null}
            {st.mark === "check" ? <Check size={11} strokeWidth={2.6} aria-hidden /> : null}
            {st.mark === "ring" ? <span className="h-[5px] w-[5px] rounded-full border border-muted" /> : null}
            <span className="truncate">{status.text}</span>
        </span>
    );
}

// A session's primary action: Jump to the live agent, else Resume the ended session (if resumable).
// Shared by the detail buttons (mouse) and list-nav Enter (keyboard) so both do exactly one thing.
export function runSessionPrimary(model: AgentsViewModel, session: LiveSession) {
    if (session.live && session.liveId) {
        globalStore.set(model.focusIdAtom, session.liveId);
        globalStore.set(model.surfaceAtom, "agent");
        showTerminal();
        return;
    }
    if (session.resumecommand) {
        const piResume =
            session.runtime === "pi" && session.resumeargs?.length
                ? { startupArgs: session.resumeargs, resumePath: session.transcriptpath }
                : {};
        fireAndForget(() =>
            launchAgent(model, {
                runtime: session.runtime as Runtime,
                startupCommand: session.resumecommand,
                task: "",
                projectPath: session.projectpath,
                projectName: session.projectname || "agent",
                ...piResume,
            })
        );
    }
}

function PrimaryButton({ model, session, strong }: { model: AgentsViewModel; session: LiveSession; strong?: boolean }) {
    const primary = sessionPrimary(session);
    if (primary == null) {
        return null;
    }
    return (
        <button
            type="button"
            onClick={() => runSessionPrimary(model, session)}
            className={cn(
                // one height with the view toggle beside it, so the header row stays one tight line
                "flex h-7 flex-none cursor-pointer items-center rounded-[7px] px-[11px] text-[12px] font-semibold",
                strong && session.live
                    ? "bg-accent text-background hover:opacity-90"
                    : "border border-edge-strong bg-surface-raised text-secondary hover:border-accent hover:text-accent-soft"
            )}
        >
            {primary === "jump" ? "Jump →" : "Resume →"}
        </button>
    );
}

function ViewToggle({ model, className }: { model: AgentsViewModel; className?: string }) {
    const [view, setView] = useAtom(model.sessionsViewAtom);
    const options: { key: typeof view; label: string }[] = [
        { key: "activity", label: "Activity" },
        { key: "transcript", label: "Transcript" },
    ];
    return (
        <div
            role="group"
            aria-label="Session view"
            className={cn(
                "flex h-7 flex-none items-stretch gap-0.5 rounded-[7px] border border-border bg-background p-0.5",
                className
            )}
        >
            {options.map((o) => (
                <button
                    key={o.key}
                    type="button"
                    aria-pressed={view === o.key}
                    onClick={() => setView(o.key)}
                    className={cn(
                        "flex cursor-pointer items-center rounded-[5px] px-[9px] text-[11px] font-semibold",
                        view === o.key ? "bg-accentbg text-primary" : "text-ink-mid hover:text-primary"
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

function Meta({ items, className }: { items: { k: string; v: string }[]; className?: string }) {
    return (
        <div className={cn("flex flex-wrap items-center gap-3.5 text-[11px] tabular-nums", className)}>
            {items.map((m) => (
                <span key={m.k}>
                    <span className="text-muted">{m.k} </span>
                    <span className="text-secondary">{m.v}</span>
                </span>
            ))}
        </div>
    );
}

// A running session's transcript grows while it is read. The stream (livetranscript.ts) watches the file and stamps
// its activity on every chunk; each stamp re-reads the window, which keeps the read the same shape as a finished
// session's (the stream's own window is only its last few hundred lines).
function useTranscriptChanges(
    path: string | undefined,
    runtime: string | undefined,
    live: boolean
): number | undefined {
    const streamId = live && path ? `transcript-read:${path}` : "";
    useEffect(() => {
        if (!streamId) {
            return;
        }
        startTranscriptStream(streamId, path, runtime);
        return () => stopTranscriptStream(streamId);
    }, [streamId]);
    return useAtomValue(activityAtomFor(streamId));
}

function useTranscript(session: LiveSession | undefined): AgentEntry[] | null {
    const [entries, setEntries] = useState<AgentEntry[] | null>(null);
    const path = session?.transcriptpath;
    const runtime = session?.runtime;
    const changed = useTranscriptChanges(path, runtime, session?.live ?? false);
    // a new session starts from the skeleton; a re-read of the same one keeps showing the last read until it lands
    useEffect(() => {
        setEntries(null);
    }, [path, runtime]);
    useEffect(() => {
        let cancelled = false;
        if (!path || !runtime) {
            setEntries([]);
            return;
        }
        fireAndForget(async () => {
            try {
                // Pi's parent-linked active branch needs the complete file; other runtimes tail the recent window.
                const maxlines = runtime === "pi" ? -1 : 2000;
                const rtn = await RpcApi.GetAgentTranscriptCommand(TabRpcClient, { path, maxlines });
                const projected = projectorFor(runtime, path).project(rtn.lines ?? []);
                if (!cancelled) {
                    setEntries(projected);
                }
            } catch (e) {
                console.warn(`reading transcript ${path} failed`, e);
                if (!cancelled) {
                    setEntries([]);
                }
            }
        });
        return () => {
            cancelled = true;
        };
    }, [path, runtime, changed]);
    return entries;
}

function clock(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function ActivityList({ events }: { events: SessionEvent[] }) {
    return (
        <div className="flex flex-col">
            {events.map((e, i) => (
                <div
                    key={i}
                    className="grid grid-cols-[44px_8px_minmax(0,1fr)] gap-x-3.5 border-b border-edge-faint py-2.5"
                >
                    <span className="pt-0.5 text-[10.5px] tabular-nums text-muted">{clock(e.ts)}</span>
                    <span
                        className="mt-[7px] h-[7px] w-[7px] rounded-full"
                        style={{ backgroundColor: eventColor(e.type) }}
                    />
                    <span className="min-w-0">
                        <span className="block text-[13px] leading-[1.5] text-secondary">{e.text}</span>
                        <span
                            className="mt-0.5 block text-[10.5px] uppercase tracking-[0.06em]"
                            style={{ color: eventColor(e.type) }}
                        >
                            {e.type}
                        </span>
                    </span>
                </div>
            ))}
        </div>
    );
}

// SessionBody is the scrolling read of one session: its transcript, opened at the end, or its events.
function SessionBody({
    model,
    session,
    empty,
    className,
}: {
    model: AgentsViewModel;
    session?: LiveSession;
    empty: string;
    className?: string;
}) {
    const view = useAtomValue(model.sessionsViewAtom);
    const entries = useTranscript(view === "transcript" ? session : undefined);
    const scrollRef = useRef<HTMLDivElement>(null);
    // opened at the end; after that, a re-read of a running session follows only a reader who is still at the end
    const opened = useRef<string | undefined>(undefined);
    const following = useRef(true);
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el || !entries?.length) {
            return;
        }
        const key = session?.transcriptpath;
        if (opened.current !== key || following.current) {
            el.scrollTop = el.scrollHeight;
            opened.current = key;
            following.current = true;
        }
    }, [entries]);

    let body: ReactNode;
    if (session == null) {
        body = <div className="py-4 text-[13px] text-muted">{empty}</div>;
    } else if (view === "activity") {
        body =
            session.events.length > 0 ? (
                <ActivityList events={session.events} />
            ) : (
                <div className="py-4 text-[13px] text-muted">No activity yet.</div>
            );
    } else if (entries == null) {
        body = <TranscriptSkeleton className="pt-3" />;
    } else if (entries.length === 0) {
        body = <div className="py-4 text-[13px] text-muted">No transcript to show.</div>;
    } else {
        body = (
            <CompactTranscript
                entries={entries}
                active={session.live}
                onReview={
                    session.projectpath
                        ? () => openDiff(model, projectDiffScope(session.projectname || "project", session.projectpath))
                        : undefined
                }
            />
        );
    }
    return (
        <div
            ref={scrollRef}
            onScroll={(e) => {
                following.current = atBottom(e.currentTarget);
            }}
            className={cn("min-h-0 flex-1 overflow-y-auto", className)}
        >
            {body}
        </div>
    );
}

function sessionMeta(s: LiveSession | undefined, extra: { k: string; v: string }[] = []): { k: string; v: string }[] {
    if (s == null) {
        return extra;
    }
    return [
        { k: "runtime", v: runtimeMeta(s.runtime).label.toLowerCase() },
        ...extra,
        { k: "branch", v: s.branch || "—" },
        { k: "time", v: s.durationms > 0 ? formatAgeShort(s.durationms) : "—" },
        { k: "tokens", v: s.tokenstotal > 0 ? `${formatTokens(s.tokenstotal)} tok` : "—" },
    ];
}

function RuntimeTile({ runtime }: { runtime: string }) {
    const rt = runtimeMeta(runtime);
    return (
        <span
            className={cn(
                "flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[10px] border text-[15px]",
                rt.text,
                rt.softBg,
                rt.line
            )}
        >
            {rt.glyph}
        </span>
    );
}

// the header's one meta line: "arcterm · main · 16h · 19.2M tok", each value named in its tooltip; an unknown one is left out
function MetaLine({ items }: { items: { k: string; v: string }[] }) {
    const known = items.filter((m) => m.v !== "—");
    return (
        <span className="min-w-0 shrink-[2] truncate text-[11px] tabular-nums text-muted">
            {known.map((m, i) => (
                <Fragment key={m.k}>
                    {i > 0 ? <span className="text-ink-faint"> · </span> : null}
                    <span title={m.k}>{m.v}</span>
                </Fragment>
            ))}
        </span>
    );
}

// onBack: the Agent surface's session pane puts its way back to the terminal at the start of the header row
export function SoloDetail({
    model,
    session,
    onBack,
}: {
    model: AgentsViewModel;
    session: LiveSession;
    onBack?: () => void;
}) {
    const rt = runtimeMeta(session.runtime);
    const status: Status = session.live
        ? session.needsAttention
            ? { key: "asking", text: "asking" }
            : { key: "running", text: "running" }
        : { key: "done", text: "done" };
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="mb-1 flex flex-none items-center gap-2.5 border-b border-edge-faint pb-2">
                {onBack ? (
                    <button
                        type="button"
                        data-agent-session-back
                        onClick={onBack}
                        title="Back to terminal"
                        aria-label="Back to terminal"
                        className="-ml-1.5 flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <ArrowLeft size={14} aria-hidden />
                    </button>
                ) : null}
                <span className={cn("flex-none text-[13px]", rt.text)} title={rt.label}>
                    {rt.glyph}
                </span>
                {/* centred, not baseline: StatusMark opens with an icon, whose box bottom would sit on the title's
                    baseline and lift "✓ done" above the line */}
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <h2 className="min-w-0 truncate text-[15px] font-semibold text-primary">
                        {session.task || "(untitled session)"}
                    </h2>
                    <StatusMark status={status} />
                    <MetaLine
                        items={[{ k: "project", v: session.projectname || "—" }, ...sessionMeta(session).slice(1)]}
                    />
                </div>
                <ViewToggle model={model} />
                <PrimaryButton model={model} session={session} strong />
            </div>
            <SessionBody model={model} session={session} empty="" className="pb-2" />
        </div>
    );
}

function memberEmpty(m: RunMember): string {
    if (m.status.key === "pending") {
        return m.waitsOn?.length ? `Starts when task ${m.waitsOn.join(", ")} lands.` : "Not started yet.";
    }
    return m.key === LEAD_MEMBER ? "No lead session recorded." : "No session recorded for this task.";
}

function MemberRow({
    model,
    view,
    member,
    current,
}: {
    model: AgentsViewModel;
    view: RunView;
    member: RunMember;
    current: boolean;
}) {
    const rt = runtimeMeta(view.runtime);
    const isLead = member.key === LEAD_MEMBER;
    return (
        <button
            type="button"
            aria-current={current}
            onClick={() => globalStore.set(model.sessionsMemberAtom, member.key)}
            className={cn(
                "grid h-[30px] flex-none cursor-pointer grid-cols-[22px_minmax(0,1fr)_150px_56px_36px] items-center gap-x-3 rounded-[6px] px-2 text-left",
                current ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <span className={cn("text-center text-[10.5px] tabular-nums", isLead ? rt.text : "text-muted")}>
                {isLead ? rt.glyph : member.num}
            </span>
            <span
                className={cn(
                    "truncate text-[12.5px]",
                    member.status.key === "done" ? "text-ink-mid" : "text-secondary"
                )}
            >
                {member.label}
            </span>
            <StatusMark status={member.status} />
            <span className="text-right text-[10.5px] tabular-nums text-muted">
                {member.tokens > 0 ? formatTokens(member.tokens) : "—"}
            </span>
            <span className="text-right text-[10.5px] tabular-nums text-muted">
                {member.durationMs > 0 ? formatAgeShort(member.durationMs) : "—"}
            </span>
        </button>
    );
}

export function RunDetail({
    model,
    view,
    member,
    memberSession,
    now,
}: {
    model: AgentsViewModel;
    view: RunView;
    member: RunMember;
    // the session the member in view opens, including a live one the scan has not picked up yet
    memberSession?: LiveSession;
    now: number;
}) {
    const lead = view.members[0].session;
    const head: Status =
        view.live || view.head.key !== "done" ? view.head : { key: "done", text: `done · ${view.head.text} ago` };
    const elapsed = (view.live ? now : view.lastactivets) - view.startedts;
    const meta = [
        { k: "lead", v: `${runtimeMeta(view.runtime).glyph} ${view.runtime}` },
        ...(view.plan ? [{ k: "plan", v: view.plan }] : []),
        { k: "project", v: view.project || "—" },
        { k: "time", v: formatAgeShort(elapsed) },
        { k: "tokens", v: view.tokens > 0 ? `${formatTokens(view.tokens)} tok` : "—" },
    ];
    // a stage member has no task number: its label names it
    const title =
        member.key === LEAD_MEMBER ? "Lead" : member.num ? `Task ${member.num} · ${member.label}` : member.label;
    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="flex flex-none items-start gap-3.5 border-b border-edge-faint pb-4">
                <RuntimeTile runtime={view.runtime} />
                <div className="min-w-0 flex-1">
                    <div className="mb-[7px] flex items-center gap-3">
                        <h2 className="truncate text-[19px] font-bold tracking-[-0.01em] text-primary">{view.title}</h2>
                        <StatusMark status={head} />
                    </div>
                    <Meta items={meta} />
                </div>
                <div className="flex flex-none gap-2">
                    <button
                        type="button"
                        data-peek
                        onClick={(e) => fireAndForget(() => openOrPeek(model, { kind: "run", runId: view.runId }, e))}
                        className="cursor-pointer rounded-[7px] border border-edge-mid bg-surface-raised px-3 py-[7px] text-[12px] font-semibold text-ink-mid hover:text-primary"
                    >
                        Open in Orchestrate
                    </button>
                    {lead?.live ? (
                        <button
                            type="button"
                            onClick={() => runSessionPrimary(model, lead)}
                            className="cursor-pointer rounded-[7px] bg-accent px-[13px] py-[7px] text-[12px] font-semibold text-background hover:opacity-90"
                        >
                            Jump to lead →
                        </button>
                    ) : null}
                </div>
            </div>

            {view.ask ? (
                <div className="flex flex-none items-center gap-3 rounded-lg bg-askingbg py-2.5 pl-3.5 pr-3">
                    <span className="h-[7px] w-[7px] flex-none pulse-dot rounded-full bg-asking" />
                    <span className="min-w-0 flex-1 text-[13px] leading-[1.45] text-secondary">
                        <span className="font-semibold text-ink-hi">Task {view.ask.num} asks:</span> {view.ask.text}
                    </span>
                    <button
                        type="button"
                        onClick={() => globalStore.set(model.sessionsMemberAtom, view.ask!.member)}
                        className="flex-none cursor-pointer rounded-[7px] border border-edge-strong bg-surface-raised px-[11px] py-1.5 text-[12px] font-semibold text-secondary hover:text-primary"
                    >
                        Show task
                    </button>
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col gap-3.5">
                <div role="group" aria-label="Sessions in this run" className="flex flex-none flex-col">
                    <div className="flex items-center gap-2.5 pb-1.5">
                        <h3 className={cn(REGION_LABEL, "text-muted")}>In this run</h3>
                        <div className="h-px flex-1 bg-edge-faint" />
                        <span className="text-[10.5px] tabular-nums text-muted">
                            {view.total > 0 ? `${view.landed}/${view.total} landed` : "planning"}
                        </span>
                    </div>
                    <div className="flex max-h-[186px] flex-col gap-px overflow-y-auto">
                        {view.members.map((m) => (
                            <MemberRow
                                key={m.key}
                                model={model}
                                view={view}
                                member={m}
                                current={m.key === member.key}
                            />
                        ))}
                    </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[10px] border border-edge-mid bg-surface">
                    <div className="flex-none border-b border-edge-faint px-4 pb-2.5 pt-3">
                        <div className="mb-1.5 flex items-center gap-3">
                            <h3 className="min-w-0 flex-1 truncate text-[15px] font-bold text-primary">{title}</h3>
                            <ViewToggle model={model} />
                            {memberSession ? <PrimaryButton model={model} session={memberSession} /> : null}
                        </div>
                        <Meta items={sessionMeta(memberSession, [{ k: "status", v: member.status.text }])} />
                    </div>
                    <SessionBody
                        model={model}
                        session={memberSession}
                        empty={memberEmpty(member)}
                        className="px-4 pb-4 pt-1"
                    />
                </div>
            </div>
        </div>
    );
}
