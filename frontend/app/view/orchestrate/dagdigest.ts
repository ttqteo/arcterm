// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The orchestrator status digest hook: loads DagStatusCommand's {Group, Digest} and accepts a response
// only when it is fresh (Digest.DagVersion == observed TaskGroup.Version) and belongs to the newest
// outstanding request (spec 9). A stale/failed digest never replaces task facts — the caller renders
// them behind "Refreshing status".

import { useCallback, useEffect, useRef, useState } from "react";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useRunEvents } from "../agents/runeventstore";
import { useDagGroup } from "./dagstore";

export type DigestState = {
    digest?: DagStatusDigest;
    loading: boolean;
    // derived, never stored: see digestStale
    stale: boolean;
    error?: string;
    // when the held digest was last confirmed current; absent until one has been accepted
    lastUpdatedTs?: number;
    retry?: () => void;
};

// TaskBrief is the little the next-step line needs to name a task: its label, and enough state to say
// whether it is still executing or already finished and waiting to be integrated.
export type TaskBrief = { label: string; state: string };

export function taskBriefs(group: TaskGroup | undefined): Map<string, TaskBrief> {
    const briefs = new Map<string, TaskBrief>();
    for (const t of group?.tasks ?? []) {
        briefs.set(t.id, { label: t.label || t.id, state: t.state });
    }
    return briefs;
}

// events whose arrival means the current digest may be out of date: ask/answer/clear, and the boundaries
// digest.timing derives from. Not activity ticks — those never re-request the digest.
const REFRESH_EVENT_KINDS = new Set([
    "child-ask",
    "child-answered",
    "child-ask-cleared",
    "task-spawned",
    "task-done",
    "task-failed",
    "task-review-started",
    "task-review-passed",
    "task-review-failed",
    "task-merge-started",
    "task-merged",
    "task-verify-passed",
    "task-verify-failed",
    "final-step",
    "final-ended",
    "dag-done",
]);

// acceptDigest decides whether candidate may replace the current digest: its DagVersion must equal the
// observed group version, and it must be the response to the newest outstanding request (an older
// same-version response loses to a newer request, spec 10.2 ask-changes-during-load race).
export function acceptDigest(
    candidate: DagStatusDigest,
    observedVersion: number,
    requestToken: number,
    newestToken: number
): boolean {
    return candidate.dagversion === observedVersion && requestToken === newestToken;
}

// shouldRefreshDigest reports whether a runevent kind schedules another digest load. Only the
// digest-relevant kinds count; a plain activity tick must not re-request.
export function shouldRefreshDigest(eventKind: string | undefined): boolean {
    return eventKind != null && REFRESH_EVENT_KINDS.has(eventKind);
}

// MAX_NAMED_TASKS caps how many tasks one next-step line names before summarising. A line that grows
// with the dag stops being readable at exactly the width where it matters.
const MAX_NAMED_TASKS = 2;

function labelOf(id: string, briefs?: Map<string, TaskBrief>): string {
    return briefs?.get(id)?.label || id;
}

function nameList(ids: string[] | undefined, briefs: Map<string, TaskBrief> | undefined, name = labelOf): string {
    if (ids == null || ids.length === 0) {
        return "";
    }
    const shown = ids.slice(0, MAX_NAMED_TASKS).map((id) => name(id, briefs));
    const rest = ids.length - shown.length;
    return shown.join(", ") + (rest > 0 ? ` +${rest} more` : "");
}

export function firstLine(text: string | undefined): string {
    return (text ?? "").split("\n")[0].trim();
}

// waitingText says why a queued task has not started, shared by the run sheet's row and the graph's peek.
export function waitingText(td: DagTaskDigest | undefined, briefs: Map<string, TaskBrief>): string {
    const blockers = td?.blockingtaskids ?? [];
    if (td?.waitreason === "dependency" && blockers.length > 0) {
        return `waiting on ${blockers.map((id) => labelOf(id, briefs)).join(", ")}`;
    }
    if (td?.waitreason === "parallelism") {
        return "waiting for a worker slot";
    }
    return "not dispatched yet";
}

// blockerName says what a blocking task is actually waiting for. A dependency that is already done yet
// still blocks its successor is waiting to be integrated, not to finish — the distinction the reader
// needs to know whether anything is running at all.
function blockerName(id: string, briefs?: Map<string, TaskBrief>): string {
    const label = labelOf(id, briefs);
    return briefs?.get(id)?.state === "done" ? `${label}'s merge` : label;
}

// nextStepText renders the typed next-step kind as a short imperative line for the overview header,
// naming the tasks the digest already identifies ("ship it waiting on scaffold API's merge"). Falls
// back to the generic phrasing when the step carries no ids, and to the raw id when no label is known:
// presentation only, and never a task name this UI invented. The digest contract stays typed and is
// never re-derived here.
export function nextStepText(next: DagNextStep, briefs?: Map<string, TaskBrief>): string {
    const named = nameList(next.taskids, briefs);
    switch (next.kind) {
        case "human-action": {
            if (next.actions?.length === 1 && next.actions[0] === "retry-cleanup") {
                return `worktrees not removed${named ? `: ${named}` : ""} — wsh jarvis dag retry-cleanup`;
            }
            const actions = next.actions?.join(" / ") ?? "action";
            return `waiting on you — ${actions}` + (named ? `: ${named}` : "");
        }
        case "lead-action": {
            const actions = next.actions?.join(" / ") ?? "action";
            return `waiting on the lead — ${actions}` + (named ? `: ${named}` : "");
        }
        case "plan-gate":
            return "waiting on you — approve the plan to start workers";
        case "merge-ready":
            return "merge ready for review" + (named ? `: ${named}` : "");
        case "dispatch":
            return named ? `dispatching ${named}` : "dispatching next task";
        case "parallelism-wait": {
            const busy = nameList(next.blockingtaskids, briefs);
            return busy ? `waiting for a slot — ${busy} still running` : "waiting on parallelism limit";
        }
        case "verify-wait":
            return "running Verify" + (named ? ` after ${named}` : "");
        case "final-wait":
            return "verifying the merged result";
        case "dependency-wait": {
            const blockers = nameList(next.blockingtaskids, briefs, blockerName);
            return named && blockers ? `${named} waiting on ${blockers}` : "waiting on dependencies";
        }
        case "cleanup-wait":
            return "waiting on worktree cleanup" + (named ? `: ${named}` : "");
        case "terminal":
            return next.terminalstatus
                ? `finished (${next.terminalstatus})`
                : "finished with no status (digest contract error)";
        default:
            return "refreshing status";
    }
}

// cleanupOnly is a needs-you digest whose only ask of the human is removing worktrees the engine could not.
// Nothing is asking, so "Waiting on you" sends the human looking for a question that is not there.
export function cleanupOnly(digest: DagStatusDigest | undefined): boolean {
    if (digest?.health !== "needs-you") {
        return false;
    }
    const acting = (digest.tasks ?? []).filter((td) => (td.humanactions?.length ?? 0) > 0);
    return (
        acting.length > 0 &&
        acting.every((td) => td.humanactions.length === 1 && td.humanactions[0] === "retry-cleanup")
    );
}

// formatElapsed is the overview's short clock ("45s", "12m", "1h5m").
export function formatElapsed(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) {
        return `${s}s`;
    }
    const m = Math.floor(s / 60);
    if (m < 60) {
        return `${m}m`;
    }
    return `${Math.floor(m / 60)}h${m % 60}m`;
}

// verifyHeading is how a running Verify names itself wherever it appears — the worker row and the graph
// peek — so the two cannot word it differently.
export function verifyHeading(startedTs: number | undefined, nowMs: number): string {
    const parts = ["Verify running"];
    if (startedTs) {
        parts.push(formatElapsed(Math.max(0, nowMs - startedTs)));
    }
    return parts.join(" · ");
}

// verifyRowLine is a worker row's Verify line: its age, and the last line Verify printed. Both come from
// the digest, which derives them once for this row and for the CLI's. Verify runs outside a block, so
// without this the row shows a reaped worker as though it were the live thing.
export function verifyRowLine(td: DagTaskDigest | undefined, nowMs: number): string {
    return [verifyHeading(td?.verifystartedts, nowMs), td?.verifylastline].filter(Boolean).join(" · ");
}

// reportChips is the run card's copy of the numbers the lead reports from. A zero carries no news and is
// left out; an untested run is always said.
export function reportChips(report: DagReportDigest | undefined): string[] {
    if (report == null) {
        return [];
    }
    const chips: string[] = [];
    if (report.workerms > 0) {
        chips.push(`workers ${formatElapsed(report.workerms)}`);
    }
    if (report.commits?.length) {
        chips.push(`landed ${report.commits.length}`);
    }
    if (report.answered > 0) {
        chips.push(`answered ${report.answered}`);
    }
    if (report.forwarded > 0) {
        chips.push(`forwarded ${report.forwarded}`);
    }
    if (report.unverified) {
        chips.push("unverified");
    }
    return chips;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// planShapeText is how a plan reads before and after it starts: how much work, how many lanes it runs in,
// and the longest chain of tasks that wait on one another. Go computes the numbers (PlanShapeOf), so + Run
// and the run card cannot disagree about a plan's lanes.
export function planShapeText(shape: DagPlanShape | undefined): string | null {
    if (shape == null || shape.tasks === 0) {
        return null;
    }
    return `${plural(shape.tasks, "task")} · ${plural(shape.lanes, "lane")} · longest chain ${shape.longestchain}`;
}

// planWarnings names the two things a hand-written plan most often leaves out (spec §1): dependencies, so
// every task queues in one lane, and a Verify line, so nothing is tested where lanes merge.
export function planWarnings(shape: DagPlanShape, verify: string | undefined): string[] {
    const out: string[] = [];
    if (shape.lanes === 1 && shape.tasks > 1) {
        out.push("serial");
    }
    if (!verify) {
        out.push("unverified");
    }
    return out;
}

// --- degradation views (spec 8): what the overview may claim, given the digest's state ---------

// HEALTH_TONE maps the digest's health enum onto tone tokens. Absent from the map means the digest
// said something this UI does not understand — which is never a reason to paint it healthy.
const HEALTH_TONE: Record<string, string> = {
    "needs-you": "text-warning",
    stalled: "text-error",
    healthy: "text-success",
    done: "text-muted",
    cancelled: "text-muted",
};

// digestStale reports whether the held digest describes a DAG version that has already moved on. It is
// a fact about the two versions, so the caller derives it every render rather than storing a flag: a
// stored flag can only flip when a request *returns*, which left the previous version's health and
// counts reading as current for the whole reload.
//
// A refresh that failed counts too: refreshes also run on events that leave the version alone (a child's ask), so
// the held digest can be behind at an unchanged version, and reading it as current would keep its old health.
export function digestStale(
    digest: DagStatusDigest | undefined,
    observedVersion: number | undefined,
    error?: string
): boolean {
    return digest != null && (digest.dagversion !== observedVersion || error != null);
}

// the waits before the hook re-asks for a digest whose refresh failed; its readers (the graph) offer no retry
export const DIGEST_RETRY_MS = [5_000, 30_000, 120_000];

// healthView is the single decision about what the health strip says. Three rules it must never break:
// an unavailable digest is never rendered as healthy, a stale digest's health is not shown as if it
// were current, and a refresh that failed is not dressed up as one still in flight — the reader can
// wait out the second, but only the first is theirs to retry.
export function healthView(state: DigestState): { text: string; tone: string } {
    if (state.digest == null) {
        return { text: state.loading ? "Loading status…" : "DAG status unavailable", tone: "text-muted" };
    }
    if (state.stale) {
        return state.error != null && !state.loading
            ? { text: "Status update failed", tone: "text-warning" }
            : { text: "Refreshing status", tone: "text-muted" };
    }
    return { text: state.digest.health, tone: HEALTH_TONE[state.digest.health] ?? "text-muted" };
}

// lastUpdatedText says when the shown status was last confirmed current, so a reader can tell a quiet
// DAG from one whose status stopped arriving. Null until a digest has actually been accepted.
export function lastUpdatedText(state: DigestState, nowMs: number): string | null {
    if (state.lastUpdatedTs == null || state.lastUpdatedTs <= 0) {
        return null;
    }
    const secs = Math.max(0, Math.floor((nowMs - state.lastUpdatedTs) / 1000));
    if (secs < 60) {
        return `updated ${secs}s ago`;
    }
    const mins = Math.floor(secs / 60);
    return mins < 60 ? `updated ${mins}m ago` : `updated ${Math.floor(mins / 60)}h ago`;
}

// nextStepView returns the next-engine-move line, or null when there is no claim the UI is entitled
// to make. A stale digest's "next" is a statement about a DAG version that has already moved on.
export function nextStepView(state: DigestState, briefs?: Map<string, TaskBrief>): string | null {
    if (state.digest == null || state.stale) {
        return null;
    }
    return nextStepText(state.digest.next, briefs);
}

// freshCounts returns the counts only while they are current, for the same reason.
export function freshCounts(state: DigestState): DagStatusCounts | undefined {
    return state.digest == null || state.stale ? undefined : state.digest.counts;
}

// useDagDigest loads the status digest for an orchestrator run and keeps it fresh: initially, on any
// observed TaskGroup.Version change (via the live WOS group), on digest-relevant run events, and on an
// explicit retry. A running request token guards out-of-order responses. Errors keep the last good
// digest and surface the failure, so the caller can say "out of date" instead of inventing health.
export function useDagDigest(channelId: string, runId: string, dagOref: string): DigestState {
    const [group] = useDagGroup(dagOref);
    const observedVersion = group?.version;
    const events = useRunEvents(runId, channelId);
    const [state, setState] = useState<Omit<DigestState, "stale" | "retry">>({ loading: true });
    const requestTokenRef = useRef(0);
    const newestTokenRef = useRef(0);
    const seenEventsRef = useRef(new Set<string>());
    // unseen digest-relevant events and explicit retries bump this nonce and re-trigger the load effect
    const [refreshNonce, setRefreshNonce] = useState(0);
    const nextNonce = useRef(0);

    const retry = useCallback(() => {
        nextNonce.current++;
        setRefreshNonce(nextNonce.current);
    }, []);
    // consecutive failed refreshes, which pace the automatic retries; a success resets it
    const failures = useRef(0);

    // mark newly seen digest-relevant events once; each bump triggers the load effect below
    useEffect(() => {
        let bumped = false;
        for (const ev of events) {
            if (shouldRefreshDigest(ev.kind) && !seenEventsRef.current.has(ev.id)) {
                seenEventsRef.current.add(ev.id);
                nextNonce.current++;
                bumped = true;
            }
        }
        if (bumped) {
            setRefreshNonce(nextNonce.current);
        }
    }, [events]);

    useEffect(() => {
        if (observedVersion == null) {
            return;
        }
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        const token = ++requestTokenRef.current;
        newestTokenRef.current = token;
        setState((s) => ({ ...s, loading: true }));
        RpcApi.DagStatusCommand(TabRpcClient, { channelid: channelId, runid: runId })
            .then((rtn) => {
                if (cancelled) {
                    return;
                }
                if (!acceptDigest(rtn.digest, observedVersion, token, newestTokenRef.current)) {
                    // the held digest is still whatever it was; staleness follows from its version
                    setState((s) => ({ ...s, loading: false }));
                    return;
                }
                failures.current = 0;
                setState({ digest: rtn.digest, loading: false, error: undefined, lastUpdatedTs: Date.now() });
            })
            .catch((err: unknown) => {
                if (cancelled) {
                    return;
                }
                setState((s) => ({ ...s, loading: false, error: String(err) }));
                const wait = DIGEST_RETRY_MS[failures.current++];
                if (wait != null) {
                    retryTimer = setTimeout(retry, wait);
                }
            });
        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
        };
    }, [channelId, runId, dagOref, observedVersion, refreshNonce]);

    return { ...state, stale: digestStale(state.digest, observedVersion, state.error), retry };
}
