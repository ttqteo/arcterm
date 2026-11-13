// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The words and rules of the chat view's permission card (permissioncard.tsx), pure so they are tested without a
// render. The queue itself lives in wavesrv (pkg/agentperm) and reaches the card through permissionstore.ts.

import type { AgentVM } from "./agentsviewmodel";
import type { TuiOption } from "./tuiscreen";

const TITLES: Record<string, string> = {
    Bash: "Wants to run a command",
    Edit: "Wants to edit a file",
    MultiEdit: "Wants to edit a file",
    Write: "Wants to write a file",
    NotebookEdit: "Wants to edit a notebook",
    WebFetch: "Wants to fetch a page",
    WebSearch: "Wants to search the web",
    // the subagent dialog arcterm's gate hook puts up (Task is the tool's old name)
    Agent: "Wants to start a subagent",
    Task: "Wants to start a subagent",
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

/** Pure: the request the card draws, or undefined. An AskUserQuestion at the head is also a permission request (Claude
 *  Code raises one for the question dialog, and wavesrv keeps it to know when the question is over), but while the chat
 *  shows the question's own choices (`askShown`) that card answers it: a second card with its input as raw JSON and only
 *  "Answer in Terminal" would ask the same thing twice. */
export function cardHead<T extends Pick<AgentPermissionRequest, "toolname">>(
    requests: readonly T[],
    askShown: boolean
): T | undefined {
    const head = requests[0];
    return head != null && askShown && head.toolname === "AskUserQuestion" ? undefined : head;
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

/** Pure: the label of the dialog's second option when it is a "Yes, and …" one (Allow, and don't ask again), which the
 *  card offers as a button typing `2`. null for a dialog of two options, or an option 2 that does not start with "Yes"
 *  (a plan dialog's "No, keep planning"), since the server types `2` whatever the label says. */
export function secondChoice(options: readonly TuiOption[]): string | null {
    if (options.length < 3) {
        return null;
    }
    const second = options[1];
    return second.n === 2 && /^yes\b/i.test(second.label) ? second.label : null;
}

/** One of the card's buttons, picked from the keyboard: Allow, the prompt's second "Yes, and …" option, or Deny. */
export type PermissionChoice = "allow" | "second" | "deny";

/** Pure: the card's choices in the order it draws its buttons; the second is there only while its label was read. */
export function permissionChoices(hasSecond: boolean): PermissionChoice[] {
    return hasSecond ? ["allow", "second", "deny"] : ["allow", "deny"];
}

/** Pure: what a choice sends, as its button does. */
export function choiceAnswer(choice: PermissionChoice): { allow: boolean; choice?: 2 } {
    return choice === "deny" ? { allow: false } : choice === "second" ? { allow: true, choice: 2 } : { allow: true };
}

/** Pure: the highlighted choice once the choices changed. It is kept by what it is, not where it sat: the second button
 *  joins the row a moment after the card shows (its label is read off the terminal), and the place that held Deny then
 *  holds "Yes, and don't ask again". A choice no longer offered falls back to Allow. */
export function keptChoice(choices: readonly PermissionChoice[], current: PermissionChoice): PermissionChoice {
    return choices.includes(current) ? current : "allow";
}

/** Pure: the highlight after ↑ (delta -1) or ↓ (+1), held at the ends as the prompt's own list is. */
export function moveChoice(
    choices: readonly PermissionChoice[],
    current: PermissionChoice,
    delta: -1 | 1
): PermissionChoice {
    const at = choices.indexOf(keptChoice(choices, current));
    return choices[Math.min(choices.length - 1, Math.max(0, at + delta))];
}

/** Pure: what a key in the chat box does while the card can be answered: ↑ and ↓ move its highlight, Enter sends the
 *  highlighted choice. Only in an empty box, with no modifier and no IME composition under way: with text in the box the
 *  keys stay the box's (Enter queues the message, Send holding it until the prompt is answered). */
export function permissionBoxKey(
    e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean },
    boxEmpty: boolean
): "up" | "down" | "pick" | null {
    if (!boxEmpty || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) {
        return null;
    }
    return e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "Enter" ? "pick" : null;
}
