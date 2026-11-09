// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The words and rules of the chat view's permission card (permissioncard.tsx), pure so they are tested without a
// render. The queue itself lives in wavesrv (pkg/agentperm) and reaches the card through permissionstore.ts.

import type { AgentVM } from "./agentsviewmodel";

const TITLES: Record<string, string> = {
    Bash: "Wants to run a command",
    Edit: "Wants to edit a file",
    MultiEdit: "Wants to edit a file",
    Write: "Wants to write a file",
    NotebookEdit: "Wants to edit a notebook",
    WebFetch: "Wants to fetch a page",
    WebSearch: "Wants to search the web",
};

/** Pure: the card's heading for the tool that asks. */
export function permissionTitle(toolName: string): string {
    return TITLES[toolName] ?? `Wants to use ${toolName}`;
}

/** Pure: how long the request has waited, "waiting 4s" / "waiting 2m" / "waiting 1h". A clock behind `ts` reads 0s. */
export function waitingFor(ts: number, now: number): string {
    const seconds = Math.max(0, Math.floor((now - ts) / 1000));
    if (seconds < 60) {
        return `waiting ${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `waiting ${minutes}m`;
    }
    return `waiting ${Math.floor(minutes / 60)}h`;
}

/** Pure: "N more waiting" for the requests queued behind the one on the card; "" when there are none. */
export function moreWaiting(n: number): string {
    return n > 0 ? `${n} more waiting` : "";
}

/** Pure: the card shows only for an agent that is awake and not idle, so a queue a killed process left behind (it
 *  never reported Stop) stays hidden. */
export function cardShown(agent: Pick<AgentVM, "state" | "sleeping">): boolean {
    return agent.sleeping == null && agent.state !== "idle";
}

/** Pure: the request's summary as the card prints it in mono: a Bash command gets a `$ ` prompt. */
export function permissionSummaryLine(request: Pick<AgentPermissionRequest, "toolname" | "summary">): string {
    return request.toolname === "Bash" ? `$ ${request.summary}` : request.summary;
}

/** Pure: the ids of `prev` that `next` no longer holds. The store forgets their in-flight lock. */
export function requestsGone(prev: readonly { id: string }[], next: readonly { id: string }[]): string[] {
    const alive = new Set(next.map((r) => r.id));
    return prev.filter((r) => !alive.has(r.id)).map((r) => r.id);
}

/** An answer that did not go through, kept per agent. wavesrv refuses a request only once it is no longer the head, so
 *  the refused request has already left the queue by the time the line is drawn: the line belongs to the agent's card,
 *  not to a request. `headId` is the head of the queue when the line was raised (null when the queue was empty). */
export type Refusal = { id: string; message: string; ts: number; headId: string | null };

/** How long a refusal line stays on the card when nothing else clears it. */
export const REFUSAL_MS = 8000;

/** Pure: the id of the request at the head of a queue, null for an empty one. */
export function headIdOf(requests: readonly { id: string }[]): string | null {
    return requests[0]?.id ?? null;
}

/** Pure: whether a refusal line goes away. It clears when a different request becomes the head (or the head leaves and
 *  the queue empties), and after `REFUSAL_MS`. It does not clear because the refused request left the queue, which is
 *  how a refusal always arrives. (The next answer for the same agent clears it too; the store does that.) */
export function refusalClears(refusal: Pick<Refusal, "ts" | "headId">, headId: string | null, now: number): boolean {
    return headId !== refusal.headId || now - refusal.ts >= REFUSAL_MS;
}

/** Pure: the line the card shows when an answer did not go through. The server's refusal ("that request is no longer
 *  waiting") travels as the rejection's message. */
export function answerFailureMessage(err: unknown): string {
    const text = (err instanceof Error ? err.message : typeof err === "string" ? err : "").trim();
    return text !== "" ? text : "Could not send the answer";
}
