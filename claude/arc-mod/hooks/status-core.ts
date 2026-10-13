// turn.complete -> `wsh agentstatus --state idle` arguments. kept free of the engine so vitest can run
// it; register.ts does the call.

export type TurnEnd = { reason: string; agentId?: string };

// claude runs no Stop settings hook for a turn that did not end in an answer (an interrupt, an API
// error, a refusal), so the cockpit would read working until the idle notification. an answered turn
// stays with Stop, and a subagent's turn ends inside a session that is still working. a question dismissed
// in claude's own dialog ends its turn as an answer with no Stop, so a turn that put one there reports too.
export function idleArgs(turn: TurnEnd, transcriptPath: string | null, isAskInDialog = false): string[] | null {
    if (turn.agentId || (turn.reason === "answer" && !isAskInDialog)) {
        return null;
    }
    const args = ["agentstatus", "--state", "idle", "--agent", "claude"];
    if (transcriptPath) {
        args.push("--transcript", transcriptPath);
    }
    return args;
}
