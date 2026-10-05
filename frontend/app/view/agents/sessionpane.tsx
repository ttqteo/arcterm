// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's `session` centre mode: one ended session read as its transcript, with Resume. It is SoloDetail
// (sessionsdetail.tsx) in the centre column, so it is the same read History gives a solo session: useTranscript feeding
// NarrationTimeline, and a primary button on runSessionPrimary, which resumes through launchAgent into a new tab on the
// same transcript. Which session is the model's sessionsSelAtom.

import { useAtomValue } from "jotai";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { overlayLive, resolveSelectedSession, sessionsArchiveAtom } from "./sessionsarchivestore";
import { SoloDetail } from "./sessionsdetail";
import { TranscriptSkeleton } from "./transcriptskeleton";

export function SessionPane({ model }: { model: AgentsViewModel }) {
    const sel = useAtomValue(model.sessionsSelAtom);
    const archive = useAtomValue(sessionsArchiveAtom);
    const roster = useAtomValue(model.agentsAtom);
    // the overlay never reads the clock, so the 1s now-tick is not a dependency
    const session = useMemo(
        () => (archive == null ? undefined : resolveSelectedSession(overlayLive(archive, roster, 0), sel)),
        [archive, roster, sel]
    );
    return (
        <div data-agent-session className="flex min-h-0 min-w-0 flex-1 flex-col px-8 py-[22px]">
            <button
                type="button"
                data-session-back
                onClick={showTerminal}
                className="mb-3 flex w-fit flex-none cursor-pointer items-center gap-[6px] rounded-[6px] px-[6px] py-[3px] text-[12px] text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ArrowLeft size={13} aria-hidden />
                Back to terminal
            </button>
            <div className="flex min-h-0 flex-1 flex-col">
                {archive == null ? (
                    <TranscriptSkeleton className="pt-3" />
                ) : session == null ? (
                    <div className="py-4 text-[13px] text-muted">This session is no longer in the archive.</div>
                ) : (
                    <SoloDetail model={model} session={session} />
                )}
            </div>
        </div>
    );
}
