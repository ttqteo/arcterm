// frontend/app/view/agents/syncbar.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Diff panel's sync cluster: the branch's counts against its upstream and the Fetch, Pull and Push buttons, with the
// pull confirmation that names the agents a pull would change files under, and the strip that explains a refused pull or
// push. The words and the button states are syncstate.ts's, the writes syncstore.ts's (Fetch is comparestore's); this
// file draws them. With the panel folded the diff header shows only the counts (SyncCounts), never the buttons.

import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowDownToLine, ArrowUpFromLine, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAge, projectOf, type AgentVM } from "./agentsviewmodel";
import { quickTerminal } from "./agenttree";
import { workingAgents } from "./commitstore";
import { fetchStateOf, fetchStatesAtom } from "./comparestore";
import type { DiffScope } from "./diffscope";
import type { FilesState } from "./filesstore";
import { SyncFailureNotice } from "./gitstatepanels";
import { syncView, terminalProjectName, type SyncButton, type SyncKind, type SyncViewModel } from "./syncstate";
import { dismissSyncFailure, fetchNow, runPull, runPush, syncRunAtom, syncRunOf } from "./syncstore";
import { agentCwdsAtom } from "./worktreesidebarstore";

// What the bar says about `state`'s branch before any action runs: the counts and the title that names the upstream.
function countsView(state: FilesState | null, fetchedAgo = "", running: SyncKind | null = null): SyncViewModel {
    return syncView({
        branch: state?.branch ?? "",
        upstream: state?.upstream ?? "",
        ahead: state?.upstreamAhead ?? 0,
        behind: state?.upstreamBehind ?? 0,
        running,
        fetchedAgo,
    });
}

// The counts alone, `↑2 ↓0`: the bar's and the folded diff header's, so both read the same text under the same title. A
// branch that is both ahead and behind has diverged, which the amber says; "no upstream" and "detached" are not counts.
export function SyncCounts({ state, className }: { state: FilesState | null; className?: string }) {
    const view = countsView(state);
    const counted = view.counts.startsWith("↑");
    const diverged = counted && (state?.upstreamAhead ?? 0) > 0 && (state?.upstreamBehind ?? 0) > 0;
    return (
        <span
            data-sync-counts
            title={view.countsTitle}
            className={cn(
                "flex-none whitespace-nowrap text-[11px] tabular-nums",
                diverged ? "text-warning" : counted ? "text-ink-mid" : "text-muted",
                className
            )}
        >
            {view.counts}
        </span>
    );
}

const ICON: Record<SyncKind, ComponentType<{ size?: number; className?: string }>> = {
    fetch: RefreshCw,
    pull: ArrowDownToLine,
    push: ArrowUpFromLine,
};

const ICON_BUTTON =
    "flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[6px] text-ink-mid hover:bg-surface-hover hover:text-ink-hi disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-mid";

function SyncIconButton({ kind, button, onClick }: { kind: SyncKind; button: SyncButton; onClick: () => void }) {
    const Icon = ICON[kind];
    return (
        <button
            data-sync={kind}
            onClick={onClick}
            disabled={button.disabled}
            aria-label={button.label}
            title={button.spinning ? `${button.label}…` : button.title}
            className={ICON_BUTTON}
        >
            {button.spinning ? <LoaderCircle size={14} className="animate-spin text-accent" /> : <Icon size={14} />}
        </button>
    );
}

// The popover that asks before a pull changes files under running agents. It sits under the top bar's right edge, as the
// board draws it, and keeps its keys: Escape closes it instead of leaving the surface.
function PullConfirm({
    behind,
    branch,
    names,
    anchor,
    onConfirm,
    onCancel,
}: {
    behind: number;
    branch: string;
    names: string[];
    anchor: RefObject<HTMLSpanElement | null>;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const popRef = useRef<HTMLDivElement>(null);
    const commits = behind > 0 ? `${behind} ${behind === 1 ? "commit" : "commits"}` : "";
    useEffect(() => {
        popRef.current?.querySelector<HTMLElement>("[data-pull-confirm-yes]")?.focus();
    }, []);
    // a click anywhere else closes it; the Pull button toggles it on its own click, so it is not "outside"
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (t != null && (popRef.current?.contains(t) || anchor.current?.contains(t))) {
                return;
            }
            onCancel();
        };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [anchor, onCancel]);
    return (
        <div
            ref={popRef}
            data-pull-confirm
            role="dialog"
            aria-label="Confirm pull"
            data-owns-keys
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    onCancel();
                }
            }}
            className="absolute right-[8px] top-[44px] z-30 flex w-[270px] max-w-[calc(100%-16px)] flex-col gap-[8px] rounded-[10px] border border-edge-mid bg-surface-raised p-[12px] shadow-popover-md"
        >
            <div className="text-[12px] font-semibold text-ink-hi">
                {commits ? `Pull ${commits} into ${branch}?` : `Pull into ${branch}?`}
            </div>
            <div className="text-[11.5px] leading-[1.5] text-ink-mid">
                {names.length === 1 ? "1 agent is" : `${names.length} agents are`} working in this worktree. Pull
                changes files under {names.length === 1 ? "it" : "them"}:{" "}
                {names.map((n, i) => (
                    <span key={`${i}:${n}`}>
                        {i > 0 ? ", " : ""}
                        <span className="text-ink-hi">{n}</span>
                    </span>
                ))}
                .
            </div>
            <div className="mt-[2px] flex justify-end gap-[8px]">
                <button
                    data-pull-confirm-no
                    onClick={onCancel}
                    className="h-[28px] rounded-[7px] border border-edge-mid px-[12px] text-[11.5px] font-semibold text-ink-mid hover:border-edge-strong hover:text-ink-hi"
                >
                    Cancel
                </button>
                <button
                    data-pull-confirm-yes
                    onClick={onConfirm}
                    className="h-[28px] rounded-[7px] bg-accent px-[12px] text-[11.5px] font-semibold text-background hover:bg-accenthover"
                >
                    {commits ? `Pull ${commits}` : "Pull"}
                </button>
            </div>
        </div>
    );
}

// Fetch, Pull and Push for the branch in `state` against its upstream, with its counts. Nothing until the surface has read
// a repository: there is no branch to sync before then, or in a folder that is not one.
export function SyncBar({ agents, state }: { agents: AgentVM[]; state: FilesState | null }) {
    const cwd = state?.cwd ?? undefined;
    const fetch = fetchStateOf(useAtomValue(fetchStatesAtom), cwd);
    const run = syncRunOf(useAtomValue(syncRunAtom), cwd);
    const agentCwds = useAtomValue(agentCwdsAtom);
    const [confirming, setConfirming] = useState(false);
    const pullRef = useRef<HTMLSpanElement>(null);

    // a pull asked about one worktree must not be answered for the next one the source switches to
    useEffect(() => setConfirming(false), [cwd]);

    if (cwd == null || !state?.isRepo) {
        return null;
    }
    const age = fetch.at > 0 ? formatAge(Date.now() - fetch.at * 1000) : "";
    const view = countsView(
        state,
        age === "just now" ? "under a minute" : age,
        run.running ?? (fetch.running ? "fetch" : null)
    );
    const names = workingAgents(cwd, agents, agentCwds);
    const pull = () => {
        setConfirming(false);
        fireAndForget(() => runPull(cwd));
    };
    return (
        <>
            <SyncCounts state={state} />
            <SyncIconButton kind="fetch" button={view.fetch} onClick={() => fireAndForget(() => fetchNow(cwd))} />
            <span ref={pullRef} className="flex flex-none">
                <SyncIconButton
                    kind="pull"
                    button={view.pull}
                    // a pull rewrites files under any agent working here, so it asks first when there is one
                    onClick={() => (names.length > 0 ? setConfirming((c) => !c) : pull())}
                />
            </span>
            {view.push.label === "Publish" ? (
                <button
                    data-sync="push"
                    onClick={() => fireAndForget(() => runPush(cwd))}
                    disabled={view.push.disabled}
                    aria-label="Publish"
                    title={view.push.spinning ? "Publishing…" : view.push.title}
                    className="flex h-[24px] flex-none items-center gap-[5px] rounded-[6px] border border-edge-mid px-[9px] text-[11px] font-semibold text-ink-hi hover:border-edge-strong disabled:opacity-40"
                >
                    {view.push.spinning ? (
                        <LoaderCircle size={12} className="animate-spin text-accent" />
                    ) : (
                        <ArrowUpFromLine size={12} />
                    )}
                    Publish
                </button>
            ) : (
                <SyncIconButton kind="push" button={view.push} onClick={() => fireAndForget(() => runPush(cwd))} />
            )}
            {confirming && names.length > 0 ? (
                <PullConfirm
                    behind={state.upstreamBehind}
                    branch={state.branch}
                    names={names}
                    anchor={pullRef}
                    onConfirm={pull}
                    onCancel={() => setConfirming(false)}
                />
            ) : null}
        </>
    );
}

// The strip under the top bar that explains the last Pull or Push git refused, until it is dismissed or the next one starts.
export function SyncFailure({
    model,
    agents,
    scope,
    state,
}: {
    model: AgentsViewModel;
    agents: AgentVM[];
    scope: DiffScope | null;
    state: FilesState | null;
}) {
    const cwd = state?.cwd ?? undefined;
    const failure = syncRunOf(useAtomValue(syncRunAtom), cwd).failure;
    if (cwd == null || failure == null) {
        return null;
    }
    const origin = scope?.repo.origin;
    const agent = origin?.kind === "agent" ? agents.find((a) => a.id === origin.id) : undefined;
    return (
        <SyncFailureNotice
            kind={failure.kind}
            failure={failure.failure}
            branch={state?.branch ?? ""}
            upstream={state?.upstream ?? ""}
            onOpenTerminal={() =>
                quickTerminal(model, terminalProjectName(origin, agent ? projectOf(agent) : "", cwd), cwd)
            }
            onDismiss={() => dismissSyncFailure(cwd)}
        />
    );
}
