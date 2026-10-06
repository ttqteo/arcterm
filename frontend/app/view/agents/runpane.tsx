// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's `run` centre mode: one orchestrator run's detail without History's list around it. It is RunDetail
// (sessionsdetail.tsx) in the centre column, the read History gives a run: its members, and the one in view read. Which
// run is the model's sessionsSelAtom ("run:<id>"), which member its sessionsMemberAtom, the run's first member with a
// session (defaultMember) when that names none of them.

import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo } from "react";
import { showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import type { RunInfo } from "./runlineage";
import { runDigestsAtom, useRunDigests } from "./runlineagestore";
import { useRunObjects } from "./runobjects";
import { loadSessionsArchive, overlayLive, sessionsArchiveAtom, sessionsErrorAtom } from "./sessionsarchivestore";
import { RunDetail } from "./sessionsdetail";
import { defaultMember, groupRunSessions, memberLiveSession, memberSession, runIdOfSel, runView } from "./sessionsruns";
import { TranscriptSkeleton } from "./transcriptskeleton";

export function RunPane({ model }: { model: AgentsViewModel }) {
    const sel = useAtomValue(model.sessionsSelAtom);
    const member = useAtomValue(model.sessionsMemberAtom);
    const archive = useAtomValue(sessionsArchiveAtom);
    const loadError = useAtomValue(sessionsErrorAtom);
    const roster = useAtomValue(model.agentsAtom);
    const now = useAtomValue(model.nowAtom);
    const digests = useAtomValue(runDigestsAtom);
    const runId = runIdOfSel(sel) ?? "";
    // as SessionPane: the pane can open before the surface's scan has landed
    const archiveMissing = archive == null;
    useEffect(() => {
        if (archiveMissing) {
            fireAndForget(loadSessionsArchive);
        }
    }, [archiveMissing]);
    // the overlay never reads the clock, so the 1s now-tick is not a dependency
    const group = useMemo(
        () =>
            archive == null
                ? undefined
                : groupRunSessions(overlayLive(archive, roster, 0)).runs.find((g) => g.runId === runId),
        [archive, roster, runId]
    );
    const objs = useRunObjects(runId ? [runId] : [])[runId];
    // only a live run can raise a question
    useRunDigests(
        group?.live
            ? [
                  {
                      runId,
                      channelId: group.channelId || objs?.dag?.channelid || "",
                      title: "",
                      project: "",
                      dag: objs?.dag,
                  },
              ]
            : ([] as RunInfo[])
    );
    const lead = memberSession(group?.lead);
    const leadAgent = lead?.liveId ? roster.find((a) => a.id === lead.liveId) : undefined;
    const view =
        group == null
            ? undefined
            : runView({
                  group,
                  run: objs?.run,
                  dag: objs?.dag,
                  digest: digests[runId],
                  leadAtPrompt: leadAgent?.atPrompt,
                  now,
              });
    const inView =
        view?.members.find((m) => m.key === member) ?? view?.members.find((m) => m.key === defaultMember(view));
    return (
        <div data-agent-run-pane={runId} className="flex min-h-0 min-w-0 flex-1 flex-col px-8 py-[22px]">
            <button
                type="button"
                data-agent-session-back
                onClick={showTerminal}
                className="mb-3 flex w-fit flex-none cursor-pointer items-center gap-[6px] rounded-[6px] px-[6px] py-[3px] text-[12px] text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ArrowLeft size={13} aria-hidden />
                Back to terminal
            </button>
            <div className="flex min-h-0 flex-1 flex-col">
                {archive == null ? (
                    <TranscriptSkeleton className="pt-3" />
                ) : view == null || inView == null ? (
                    <div className="py-4 text-[13px] text-muted">
                        {loadError ? "Could not read the session archive." : "This run is not in the archive yet."}
                    </div>
                ) : (
                    <RunDetail
                        model={model}
                        view={view}
                        member={inView}
                        memberSession={memberLiveSession(inView, runId, roster)}
                        now={now}
                    />
                )}
            </div>
        </div>
    );
}
