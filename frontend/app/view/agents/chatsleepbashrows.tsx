// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The `!` commands run while the agent slept (chatsleepbash.ts), under the conversation until a message carries them:
// each the `!` row it would have been, with how it ended, and, when it failed, Ask agent to fix, which wakes the agent
// with it. × drops a run, so the agent never reads it.

import { fireAndForget } from "@/util/util";
import { X } from "lucide-react";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { CommandCard } from "./chatconversation";
import { runFailed, runShell, runStatus, type SleepRun } from "./chatsleepbash";
import { askToFix, dropSleepRun, useSleepRuns } from "./chatsleepbashstore";
import { useWaking } from "./wakingstore";

const LINK = "cursor-pointer text-secondary hover:text-primary disabled:cursor-default disabled:opacity-40";

export function SleepRunRows({ agent, entries }: { agent: AgentVM; entries: AgentEntry[] | undefined }) {
    const runs = useSleepRuns(agent.id);
    const waking = useWaking(agent.id);
    return (
        <>
            {runs.map((run) => (
                <SleepRunRow key={run.id} agent={agent} run={run} entries={entries} waking={waking} />
            ))}
        </>
    );
}

function SleepRunRow({
    agent,
    run,
    entries,
    waking,
}: {
    agent: AgentVM;
    run: SleepRun;
    entries: AgentEntry[] | undefined;
    waking: boolean;
}) {
    const done = run.result;
    const failed = done != null && runFailed(done);
    const note =
        run.error != null ? (
            `Couldn't run: ${run.error}`
        ) : done == null ? (
            <span className="shimmer-jarvis">Running · the agent stays asleep</span>
        ) : (
            `${runStatus(done)} · goes to the agent with your next message`
        );
    const actions = (
        <>
            {failed ? (
                <button
                    type="button"
                    data-chat-asleep-fix=""
                    disabled={waking}
                    onClick={() => fireAndForget(() => askToFix(agent, run.id, entries))}
                    className={LINK}
                >
                    Ask agent to fix
                </button>
            ) : null}
            <button
                type="button"
                aria-label="Drop this run"
                title="Drop: the agent never reads it"
                onClick={() => dropSleepRun(agent.id, run.id)}
                className="cursor-pointer text-muted hover:text-primary"
            >
                <X size={12} strokeWidth={1.8} />
            </button>
        </>
    );
    return (
        <div data-chat-asleep-run="" className="flex flex-col">
            <CommandCard
                command={run.command}
                bash
                shell={done != null ? runShell(done) : undefined}
                note={note}
                noteTone={run.error != null || failed ? "error" : undefined}
                actions={actions}
            />
        </div>
    );
}
