// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the verdict card's Fix and Skip buttons do: send the one line to the agent as a prompt (a sleeping agent is woken
// with it), the way a brainstorm line goes (brainstormsend.ts), then keep the record that pairs the line with the user
// message it causes, so Chat folds the card into its ✓ row and draws that message nothing. The record is kept only once
// the send succeeded: a failure throws with the agent's name and leaves the card as it was.

import type { AgentVM } from "./agentsviewmodel";
import { tauriPromptIO, type PromptIO } from "./brainstormsend";
import type { SentAnswer } from "./chatbrainstorm";
import { recordBrainstormAnswer } from "./chatbrainstormstore";
import { userTextCount } from "./chatpending";
import { verdictRecord } from "./chatverdict";

/** What was sent: `fix` with how many findings were ticked, or `skip`. */
export type SentVerdict = { kind: "fix"; fixed: number } | { kind: "skip" };

export function sendVerdict(
    agent: AgentVM,
    key: string,
    outcome: SentVerdict,
    line: string,
    io: PromptIO = tauriPromptIO,
    now: number = Date.now()
): Promise<void> {
    return sendCardLine(
        agent,
        line,
        (seen) => verdictRecord(key, outcome.kind, outcome.kind === "fix" ? outcome.fixed : 0, line, seen, now),
        io
    );
}

/** One line to the agent, sent as a prompt, or as the wake of a sleeping agent, with no Chat record: the message it
 *  causes draws as any other the person sent (Verify's Ask the agent to rerun). Throws with the agent's name when it
 *  cannot be sent. */
export async function sendAgentLine(agent: AgentVM, line: string, io: PromptIO = tauriPromptIO): Promise<void> {
    if (!agent.blockId) {
        throw new Error("This agent has no terminal to send to");
    }
    const fail = (what: string, e: unknown): Error =>
        new Error(`${what} ${agent.name}: ${e instanceof Error ? e.message : String(e)}`);
    if (agent.sleeping) {
        try {
            await io.wake(agent.id, line);
        } catch (e) {
            throw fail("Couldn't wake", e);
        }
    } else {
        try {
            await io.prompt(agent.blockId, line);
        } catch (e) {
            throw fail("Couldn't send to", e);
        }
    }
}

/** A Chat card's one line to the agent (a verdict's Fix or Skip, a commit suggestion's Commit): sent as a prompt, or as
 *  the wake of a sleeping agent, then `record` (given how many user messages already held the line) is kept. */
export async function sendCardLine(
    agent: AgentVM,
    line: string,
    record: (seen: number) => SentAnswer,
    io: PromptIO = tauriPromptIO
): Promise<void> {
    // counted before the line goes: `seen` must not include the message the send is about to cause
    const seen = userTextCount(io.entries?.(agent) ?? [], line);
    await sendAgentLine(agent, line, io);
    recordBrainstormAnswer(agent.id, record(seen));
}
