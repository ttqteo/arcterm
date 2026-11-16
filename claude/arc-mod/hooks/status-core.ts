// turn.complete -> `wsh agentstatus --state idle` arguments, and the working report that takes such an idle back
// when the next turn is already under way. kept free of the engine so vitest can run it; register.ts does the call.

export type TurnEnd = { reason: string; agentId?: string };

// claude runs no Stop settings hook for a turn that did not end in an answer (an interrupt, an API
// error, a refusal), so the cockpit would read working until the idle notification. an answered turn
// stays with Stop, and a subagent's turn ends inside a session that is still working. a question dismissed
// in claude's own dialog ends its turn as an answer with no Stop, so a turn that put one there reports too.
export function idleArgs(turn: TurnEnd, transcriptPath: string | null, isAskInDialog = false): string[] | null {
    if (turn.agentId || (turn.reason === "answer" && !isAskInDialog)) {
        return null;
    }
    return statusArgs("idle", transcriptPath);
}

function statusArgs(state: "idle" | "working", transcriptPath: string | null): string[] {
    const args = ["agentstatus", "--state", state, "--agent", "claude"];
    if (transcriptPath) {
        args.push("--transcript", transcriptPath);
    }
    return args;
}

// The mod's own status reports, sent one after another. A message queued while a tool runs interrupts the tool and
// starts the next turn at once, so the interrupted turn's idle (a wsh process spawned at its turn.complete) can land
// after the next turn's UserPromptSubmit working. wavesrv then holds the agent idle and drops every tool hook's working
// as reported after its turn ended (wshserver.go outOfTurnStatus): Chat shows no working line and the roster reads idle
// for the whole turn. So the first main-loop step after an idle this mod sent reports working again, queued behind
// that idle so it lands last.
export type Report = (args: string[]) => Promise<void>;

export class TurnStatus {
    private chain: Promise<void> = Promise.resolve();
    private idleSent = false;

    // a turn ended: reports its idle when idleArgs gives one; resolves once the report is done
    ended(args: string[] | null, run: Report): Promise<void> {
        if (args === null) {
            return Promise.resolve();
        }
        this.idleSent = true;
        return this.enqueue(args, run);
    }

    // a step of a turn ran: a main-loop one after the mod's idle takes that idle back. a subagent's step says nothing
    // of the session's own turn
    stepped(agentId: string | undefined, transcriptPath: string | null, run: Report): Promise<void> {
        if (agentId !== undefined || !this.idleSent) {
            return this.chain;
        }
        this.idleSent = false;
        return this.enqueue(statusArgs("working", transcriptPath), run);
    }

    private enqueue(args: string[], run: Report): Promise<void> {
        this.chain = this.chain.then(() => run(args)).catch(() => undefined);
        return this.chain;
    }
}
