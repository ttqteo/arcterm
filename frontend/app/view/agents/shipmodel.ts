// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Ship: the commit → pull and resolve → push an agent is asked for at the end of its work, as one click. Pure: when the
// Agent header offers its Ship chip (and Alt+S takes it), and the prompts the chip, the header's "…" menu, the palette
// and the Diff's sync failure hand the agent. shipstore.ts reads git and sends them.

import type { AgentVM } from "./agentsviewmodel";

export type ShipKind = "ship" | "commit";

// The shared rules every prompt states: the checkout may hold other sessions' edits, and a push the person asked for
// here is their yes, so the agent does not stop to ask "push?" again.
const OWN_FILES =
    "only your own files, never another session's edits in this checkout: build the commit from a private index " +
    "(GIT_INDEX_FILE) so nothing someone else staged rides along";
const RECONCILE =
    "fetch, then bring this branch up to its upstream: rebase your unpushed commits onto it, or merge when any of " +
    "them is a merge commit. Resolve every conflict keeping both sides' intent; when one needs a call only I can " +
    "make, stop and ask me";
const PUSH =
    "push. When commits that are not yours sit on top of yours, push only up to your own " +
    "(git push origin <sha>:<branch>). This message is my yes to push";

export const SHIP_PROMPTS: Record<ShipKind, string> = {
    commit:
        `Commit what you changed in this session and have not committed yet: ${OWN_FILES}. Write the message in this ` +
        "repo's style. Don't pull or push. Tell me the commit in one line.",
    ship:
        "Ship your work, in this order:\n" +
        `1. Commit what you changed in this session and have not committed yet: ${OWN_FILES}. Skip this when you ` +
        "have nothing uncommitted.\n" +
        `2. ${capitalize(RECONCILE)}.\n` +
        "3. When anything came in, run the checks that cover the files you touched.\n" +
        `4. ${capitalize(PUSH)}.\n` +
        "Then tell me in one line what you pushed.",
};

/** The prompt the Diff's sync failure hands the agent working there: git refused a Pull (the branches diverged, and
 *  Pull here only fast-forwards) or a Push (the upstream has commits the branch lacks). A refused Push asked to push,
 *  so the prompt goes on to it; a refused Pull asked only to pull. */
export function mergePrompt(kind: "pull" | "push", cwd: string, branch: string, upstream: string): string {
    const where = `${branch || "This branch"} in ${cwd}`;
    const why =
        kind === "pull"
            ? `${where} and ${upstream || "its upstream"} have diverged`
            : `${upstream || "The upstream"} has commits ${where} lacks`;
    const then =
        kind === "pull"
            ? "Run the checks that cover the files you resolved. Don't push. Tell me in one line what came in and what you resolved."
            : `Run the checks that cover the files you resolved, then ${PUSH}. Tell me in one line what you pushed.`;
    return `${why}. ${capitalize(RECONCILE)}. ${then}`;
}

/** The label of the Diff sync failure's button that hands `mergePrompt` to `name`. */
export function mergeLabel(kind: "pull" | "push", name: string): string {
    return kind === "pull" ? `Ask ${name} to merge` : `Ask ${name} to pull and push`;
}

// What one live read of the agent's repo (the working tree against HEAD, GitChangesCommand with no ref) says.
export interface ShipGit {
    // files changed and not committed, anyone's: the checkout can be shared
    dirty: number;
    // commits the upstream lacks
    ahead: number;
    // "origin/main", or "" when the branch tracks nothing
    upstream: string;
}

export interface ShipOffer {
    kind: ShipKind;
    title: string;
}

/** Pure: whether `agent` can take a Ship or Commit prompt at all: an agent (not a terminal or a background agent) with
 *  a live terminal, awake and back at its prompt, and no run's (a run's engine merges its work itself). */
export function canShip(agent: Pick<AgentVM, "kind" | "blockId" | "state" | "sleeping" | "runId">): boolean {
    return (
        (agent.kind == null || agent.kind === "agent") &&
        agent.blockId != null &&
        agent.state === "idle" &&
        agent.sleeping == null &&
        agent.runId == null
    );
}

/** Pure: the Ship chip the header shows for `agent`, or null. Only an agent whose last turn did git work offers it, so
 *  the agents beside it in a shared checkout stay quiet: a turn that left edits offers it while the tree is dirty or
 *  ahead, a turn that committed only while the branch is ahead (the dirty files are someone else's then). A branch with
 *  no upstream has nowhere to push, so its edits offer Commit instead. An agent stopped on part n/m of something waits
 *  on your reply, not on a ship. `git` is the last read of its repo (shipstore.ts), null until one lands. */
export function shipOffer(
    agent: Pick<AgentVM, "kind" | "blockId" | "state" | "sleeping" | "runId" | "step" | "edited" | "committed">,
    git: ShipGit | null | undefined
): ShipOffer | null {
    if (!canShip(agent) || agent.step || git == null) {
        return null;
    }
    const uncommitted = agent.edited === true && git.dirty > 0;
    const unpushed = (agent.edited === true || agent.committed === true) && git.ahead > 0;
    if (git.upstream === "") {
        return uncommitted
            ? { kind: "commit", title: `Commit its changes (${files(git.dirty)}); the branch tracks no upstream` }
            : null;
    }
    if (!uncommitted && !unpushed) {
        return null;
    }
    const what = [uncommitted ? files(git.dirty) : "", git.ahead > 0 ? `↑${git.ahead}` : ""].filter(Boolean).join(", ");
    return {
        kind: "ship",
        title: `${uncommitted ? "Commit its changes, pull" : "Pull"} and resolve, then push to ${git.upstream} (${what})`,
    };
}

function files(n: number): string {
    return `${n} ${n === 1 ? "file" : "files"}`;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
